// connection
const { sequelize } = require('../../connection/connection');

// models
const Class = require('../../models/classes');
const GameSession = require('../../models/game-session');
const StudentProgress = require('../../models/student_progress');
const PointsLedger = require('../../models/points_ledger');
const Users = require('../../models/users');

const { getClassAnalysisStatus, getAnalysisResults } = require('../../utils/fastapi-client');

// Maps route exercise_type param → key in game_raw_response JSON
const EXERCISE_TYPE_MAP = {
    flashcard:         'flashcards',
    fill_blank:        'fill_in_the_blanks',
    spelling_bee:      'spelling_bee',
    grammar_challenge: 'grammar_challenge',
    sentence_builder:  'sentence_builder',
    advanced_cloze:    'advanced_cloze',
};

// Maps API exercise_type to value stored in MySQL game_sessions.game_type
const EXERCISE_TYPE_TO_DB_GAME_TYPE = {
    flashcard: 'flashcard',
    fill_blank: 'fill_blank',
    spelling_bee: 'spelling_bee',
    grammar_challenge: 'grammar_challenge',
    sentence_builder: 'sentence_builder',
    advanced_cloze: 'advanced_cloze',
};

function getDbGameType(exercise_type) {
    return EXERCISE_TYPE_TO_DB_GAME_TYPE[exercise_type] || exercise_type;
}

function extractCefrLevel(levelText) {
    const m = String(levelText || '').match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
    return m ? m[1].toUpperCase() : null;
}

function toYmdDate(value) {
    if (!value) return null;

    // Handles ISO/SQL style strings first (e.g. "2026-03-24T13:30:00.000Z", "2026-03-24 13:30:00")
    const valueAsString = String(value);
    const ymdMatch = valueAsString.match(/^(\d{4}-\d{2}-\d{2})/);
    if (ymdMatch) return ymdMatch[1];

    // Handles Date objects and other parseable date strings
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return null;
    return parsedDate.toISOString().slice(0, 10);
}

// Rename DB field names to frontend-facing keys per game type
function transformExerciseData(exercise_type, item) {
    switch (exercise_type) {
        case 'flashcard':
            return {
                word:              item.word_base,
                meaning_en:        item.meaning_en,
                translation:       item.translation_native,
                example_sentence:  item.example_sentence,
                ipa_pronunciation: item.ipa_pronunciation,
            };
        case 'fill_blank':
            return {
                question:              item.question_sentence,
                options:               item.options,
                answer:                item.correct_answer,
                translation:           item.explanation_translated,
            };
        case 'spelling_bee':
            return {
                word:              item.word,
                meaning:           item.meaning,
                hint:              item.context_hint,
                difficulty:        item.difficulty,
                ipa_audio_string:  item.ipa_audio_string,
            };
        case 'grammar_challenge':
            return {
                question:       item.question,
                options:        item.options,
                correct_answer: item.correct_option,
                explanation:    item.explanation_english,
                grammar_rule:   item.grammar_rule_tested,
            };
        case 'sentence_builder':
            return {
                correct_sentence: item.correct_sentence,
                scrambled_words:  item.scrambled_words,
                hint:             item.hint,
                translation:      item.translation     ?? null,
                topic_context:    item.topic_context   ?? null,
            };
        case 'advanced_cloze':
            return {
                context:          item.context_setting,
                sentence:         item.sentence_with_two_blanks,
                blank_1_options:  item.blank_1_options,
                blank_2_options:  item.blank_2_options,
                correct_answers:  item.correct_answer_pair,
                category:         item.category,
            };
        default:
            return item;
    }
}

/**
 * GET ended + present classes, then return FastAPI game_raw_response per class.
 *
 * Query params:
 * - userId (optional): if provided, filters to that student_id; else uses req.userId
 * - exercise_type (optional): if provided, returns only that game section per class
 */
const getAllGames = async (req, res) => {
    try {
        const studentId = req.query.userId || req.userId;
        const {
            exercise_type,
            status: session_status,
            teacher_name,
            date,
            page: pageQuery,
            limit: limitQuery
        } = req.query;
        const page = Math.max(parseInt(pageQuery, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(limitQuery, 10) || 10, 1), 100);
        if (!studentId) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_REQUEST',
                message: 'userId is required'
            });
        }

        if (exercise_type) {
            const validGameTypes = Object.keys(EXERCISE_TYPE_MAP);
            if (!validGameTypes.includes(exercise_type)) {
                return res.status(400).json({
                    success: false,
                    error: 'INVALID_GAME_TYPE',
                    message: `exercise_type must be one of: ${validGameTypes.join(', ')}`
                });
            }
        }

        if (session_status && !['pending', 'completed'].includes(String(session_status).toLowerCase())) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_STATUS',
                message: "status must be 'pending' or 'completed'"
            });
        }

        const normalizedDate = date ? String(date).trim().slice(0, 10) : null;
        if (normalizedDate) {
            const requestedDate = new Date(`${normalizedDate}T00:00:00`);
            if (Number.isNaN(requestedDate.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
                return res.status(400).json({
                    success: false,
                    error: 'INVALID_DATE',
                    message: 'date must be a valid date (YYYY-MM-DD recommended)'
                });
            }
        }

        const user = await Users.findOne({
            where: { id: studentId },
            attributes: ['id', 'timezone'],
            raw: true
        });

        const classes = await Class.findAll({
            where: {
                student_id: studentId,
                status: 'ended',
                is_present: 1,
            },
            attributes: ['id', 'teacher_id', 'zoom_meeting_id', 'meeting_start', 'meeting_end'],
            order: [['meeting_start', 'DESC']],
            raw: true
        });

        const zoomClasses = (classes || []).filter((cls) => cls.zoom_meeting_id && cls.meeting_start && cls.meeting_end);

        const teacherIds = [...new Set(zoomClasses.map((c) => c.teacher_id).filter(Boolean))];
        const teachers = teacherIds.length
            ? await Users.findAll({
                where: { id: teacherIds },
                attributes: ['id', 'full_name', 'avatar'],
                raw: true
            })
            : [];
        const teacherMap = teachers.reduce((map, t) => { map[t.id] = t; return map; }, {});

        if (!zoomClasses.length) {
            return res.status(200).json({
                success: true,
                message: 'No game content found',
                count: 0,
                timezone: user?.timezone || null,
                data: []
            });
        }

        // Step 1: Ask FastAPI for analysis status of each class (parallel)
        const statusResults = await Promise.all(
            zoomClasses.map((cls) =>
                getClassAnalysisStatus(
                    cls.zoom_meeting_id,
                    new Date(cls.meeting_start).toISOString(),
                    new Date(cls.meeting_end).toISOString()
                )
                    .then((status) => ({ cls, status }))
                    .catch(() => ({ cls, status: null }))
            )
        );

        // Keep only completed analyses
        const completedItems = statusResults.filter(
            (item) => item.status?.found && item.status?.status === 'completed' && item.status?.request_id
        );

        if (!completedItems.length) {
            return res.status(200).json({
                success: true,
                message: 'No completed game content found',
                count: 0,
                timezone: user?.timezone || null,
                data: []
            });
        }

        // Step 2: Fetch full analysis for each completed item (parallel)
        const analysisResults = await Promise.all(
            completedItems.map(({ cls, status }) =>
                getAnalysisResults(status.request_id)
                    .then((analysis) => ({ cls, status, analysis }))
                    .catch(() => null)
            )
        );

        const validResults = analysisResults
            .filter(Boolean)
            .filter(({ analysis }) => analysis && analysis.game_content_status === 'ok' && analysis.game_raw_response);

        // Pull any matching sessions so we can mark each item pending/completed
        const classIds = [...new Set(validResults.map((r) => r.cls?.id).filter(Boolean))];
        const sessionWhere = {
            user_id: studentId,
            class_id: classIds
        };
        if (exercise_type) sessionWhere.game_type = getDbGameType(exercise_type);

        const sessions = classIds.length
            ? await GameSession.findAll({
                where: sessionWhere,
                order: [['completed_at', 'DESC']],
                raw: true
            })
            : [];

        const completedSessions = sessions.filter((s) => s.analysis_id != null);
        const completedKeySet = new Set(
            completedSessions.map((s) => `${s.class_id}:${s.game_type || ''}:${s.analysis_id}`)
        );
        const completedAnyTypeKeySet = new Set(
            completedSessions.map((s) => `${s.class_id}:${s.analysis_id}`)
        );
        const completedSessionByExactKey = completedSessions.reduce((map, s) => {
            const key = `${s.class_id}:${s.game_type || ''}:${s.analysis_id}`;
            if (!map[key]) map[key] = s;
            return map;
        }, {});
        const completedSessionByAnyTypeKey = completedSessions.reduce((map, s) => {
            const key = `${s.class_id}:${s.analysis_id}`;
            if (!map[key]) map[key] = s;
            return map;
        }, {});
        const dbGameType = exercise_type ? getDbGameType(exercise_type) : null;

        const data = validResults.map(({ cls, status, analysis }) => {
            let gameContent = analysis.game_raw_response;
            try {
                gameContent = typeof gameContent === 'string' ? JSON.parse(gameContent) : gameContent;
            } catch (e) {
                // keep as string if parse fails
            }

            // If exercise_type provided, return only that section
            if (exercise_type && gameContent && typeof gameContent === 'object') {
                const gameKey = EXERCISE_TYPE_MAP[exercise_type];
                gameContent = gameContent[gameKey] || [];
            }

            const meetingStart = cls.meeting_start ? new Date(cls.meeting_start) : null;
            const meetingEnd = cls.meeting_end ? new Date(cls.meeting_end) : null;
            let duration_minutes = null;
            let duration = null;
            if (meetingStart && meetingEnd && !Number.isNaN(meetingStart.getTime()) && !Number.isNaN(meetingEnd.getTime())) {
                duration_minutes = Math.floor((meetingEnd - meetingStart) / 60000);
                if (duration_minutes >= 0) {
                    duration = `${Math.floor(duration_minutes / 60)}h ${duration_minutes % 60}m`;
                }
            }

            const total = Array.isArray(gameContent)
                ? gameContent.length
                : (gameContent && typeof gameContent === 'object' ? Object.keys(gameContent).length : 0);

            const relatedTeacher = cls.teacher_id ? teacherMap[cls.teacher_id] : null;

            const exactKey = `${cls.id}:${dbGameType || ''}:${analysis.id}`;
            const anyTypeKey = `${cls.id}:${analysis.id}`;
            const matchedCompletedSession = exercise_type
                ? completedSessionByExactKey[exactKey]
                : completedSessionByAnyTypeKey[anyTypeKey];
            const isCompleted = exercise_type
                ? completedKeySet.has(exactKey)
                : completedAnyTypeKeySet.has(anyTypeKey);

            let score = null;
            if (isCompleted && matchedCompletedSession) {
                const pt = matchedCompletedSession.progress_total;
                if (typeof pt === 'number' && pt > 0) {
                    const correct = matchedCompletedSession.correct_count ?? 0;
                    score = Math.round((correct / pt) * 100);
                }
            }

            return {
                class_id: cls.id,
                duration,
                duration_minutes,
                zoom_meeting_id: cls.zoom_meeting_id,
                request_id: status.request_id,
                analysis_id: analysis.id,
                level: analysis.level,
                total,
                status: isCompleted ? 'completed' : 'pending',
                score: isCompleted ? score : null,
                game_content_status: analysis.game_content_status,
                game_raw_response: gameContent,
                meeting_start: cls.meeting_start,
                meeting_end: cls.meeting_end,
                game_session: isCompleted ? matchedCompletedSession : null,
                teacher: relatedTeacher
                    ? { id: relatedTeacher.id, name: relatedTeacher.full_name, avatar: relatedTeacher.avatar || null }
                    : null,
            };
        });

        let filteredData = session_status
            ? data.filter((d) => d.status === String(session_status).toLowerCase())
            : data;

        if (teacher_name) {
            const teacherNameQuery = String(teacher_name).trim().toLowerCase();
            filteredData = filteredData.filter((d) =>
                d.teacher?.name && String(d.teacher.name).toLowerCase().includes(teacherNameQuery)
            );
        }

        if (normalizedDate) {
            filteredData = filteredData.filter((d) => {
                if (!d.meeting_start) return false;
                const meetingDatePart = toYmdDate(d.meeting_start);
                return meetingDatePart === normalizedDate;
            });
        }

        const total_count = filteredData.length;
        const total_pages = total_count ? Math.ceil(total_count / limit) : 0;
        const offset = (page - 1) * limit;
        const paginatedData = filteredData.slice(offset, offset + limit);

        return res.status(200).json({
            success: true,
            message: 'Game content retrieved successfully',
            count: paginatedData.length,
            total_count,
            page,
            limit,
            total_pages,
            timezone: user?.timezone || null,
            exercise_type: exercise_type || null,
            teacher_name: teacher_name || null,
            date: date || null,
            data: paginatedData
        });
    } catch (error) {
        console.error('Error fetching game raw content:', error);
        return res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: 'An error occurred while fetching game content',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * API 1: Get Game Options
 * Returns available practice options for a game type
 */
// const getGameOptions = async (req, res) => {
//     try {
//         const { game_type } = req.params;
//         const userId = req.userId;

//         const validGameTypes = ['flashcards', 'spelling_bee', 'grammar_challenge', 'advanced_cloze', 'sentence_builder','fill_blank'];
//         if (!validGameTypes.includes(game_type)) {
//             return res.status(400).json({
//                 success: false,
//                 error: 'INVALID_GAME_TYPE',
//                 message: `Game type must be one of: ${validGameTypes.join(', ')}`
//             });
//         }

//         const options = await GameOption.findAll({
//             where: {
//                 game_type: game_type,
//                 is_active: true
//             },
//             attributes: ['id', 'game_type', 'option_key', 'option_label', 'option_description', 'icon_url', 'sort_order'],
//             order: [['sort_order', 'ASC']]
//         });

//         return res.status(200).json({
//             success: true,
//             game_type: game_type,
//             user_id: userId,
//             count: options.length,
//             options: options
//         });

//     } catch (error) {
//         console.error('Error fetching game options:', error);
//         return res.status(500).json({
//             success: false,
//             error: 'SERVER_ERROR',
//             message: 'An error occurred while fetching game options',
//             details: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// };

/**
 * API 2: Get Option Items
 * Returns items for a specific option (topics, lessons, word lists)
 * Updated to include item_id in response
 */
// const getOptionItems = async (req, res) => {
//     try {
//         const { option_key , game_type } = req.params;
//         const userId = req.userId;

//         // Find active game option by key
//         const gameOption = await GameOption.findOne({
//             where: {
//                 option_key: option_key,
//                 game_type: game_type,
//                 is_active: true
//             },
//             attributes: ['id', 'game_type', 'option_key', 'option_label', 'option_description']
//         });

//         if (!gameOption) {
//             return res.status(404).json({
//                 success: false,
//                 error: 'OPTION_NOT_FOUND',
//                 message: `Game option with key '${option_key}' not found or inactive`
//             });
//         }

//         // Fetch all items for this option
//         const optionItems = await GameOptionItem.findAll({
//             where: {
//                 game_option_id: gameOption.id
//             },
//             attributes: ['id', 'option_item'],
//             order: [['id', 'ASC']]
//         });

//         // Include item_id with option_item JSON
//         const items = optionItems.map(item => {
//             const itemData = typeof item.option_item === 'string' 
//                 ? JSON.parse(item.option_item) 
//                 : item.option_item;
            
//             return {
//                 item_id: item.id,
//                 ...itemData
//             };
//         });

//         return res.status(200).json({
//             success: true,
//             option_key: gameOption.option_key,
//             option_label: gameOption.option_label,
//             game_type: gameOption.game_type,
//             total_items: items.length,
//             items: items
//         });

//     } catch (error) {
//         console.error('Error fetching option items:', error);
//         return res.status(500).json({
//             success: false,
//             error: 'SERVER_ERROR',
//             message: 'An error occurred while fetching option items',
//             details: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// };

/**
 * API 3: Start Game Session and Get Exercises
 * Creates session and returns 8 exercises based on selected item
 * Updated to accept item_id parameter
 */
// const getGamesByOption = async (req, res) => {
//     const transaction = await sequelize.transaction();

//     try {
//         const { game_type, option_key, item_id } = req.params;
//         const userId = req.userId;

//         const validGameTypes = ['flashcards', 'spelling_bee', 'grammar_challenge', 'advanced_cloze', 'sentence_builder'];
//         if (!validGameTypes.includes(game_type)) {
//             await transaction.rollback();
//             return res.status(400).json({
//                 success: false,
//                 error: 'INVALID_GAME_TYPE',
//                 message: `Game type must be one of: ${validGameTypes.join(', ')}`
//             });
//         }

//         // Base filter (always)
//         let whereConditions = {
//             exercise_type: game_type,
//             status: 'approved'
//         };

//         // Student based modes
//         if (['by_lesson', 'custom_words', 'mistakes_only'].includes(option_key)) {
//             whereConditions.student_id = userId;
//         }

//         // Item logic
//         if (item_id) {
//             whereConditions.game_option_item_id = item_id;
//         } else {
//             whereConditions.game_option_item_id = null; // only default records
//         }

//         // Fetch exercises (MAX 8, ASC)
//         const exercises = await Game.findAll({
//             where: whereConditions,
//             attributes: [
//                 'id',
//                 'exercise_data',
//                 'class_id',
//                 'exercise_type',
//                 'difficulty',
//                 'hint',
//                 'explanation',
//                 'created_at'
//             ],
//             order: [['id', 'ASC']],
//             limit: 8,
//             transaction
//         });

//         if (!exercises.length) {
//             await transaction.rollback();
//             return res.status(404).json({
//                 success: false,
//                 error: 'NO_EXERCISES_FOUND',
//                 message: 'No exercises found for this selection'
//             });
//         }

//         const firstExercise = exercises[0];

//         // Create session
//         const gameSession = await GameSession.create({
//             user_id: userId,
//             game_type,
//             mode: option_key,
//             selected_item_id: item_id || null,
//             class_id: firstExercise.class_id,
//             topic_id: firstExercise.topic_id,
//             difficulty: firstExercise.difficulty,
//             progress_current: 0,
//             progress_total: exercises.length,
//             correct_count: 0,
//             incorrect_count: 0,
//             status: 'active',
//             started_at: new Date(),
//             created_at: new Date()
//         }, { transaction });

//         // Format exercises
//         const formattedExercises = exercises.map(ex => ({
//             id: ex.id,
//             exercise_data: typeof ex.exercise_data === 'string'
//                 ? JSON.parse(ex.exercise_data)
//                 : ex.exercise_data
//         }));

//         await transaction.commit();

//         return res.status(200).json({
//             success: true,
//             session_id: gameSession.id,
//             game_type,
//             mode: option_key,
//             selected_item_id: item_id || null,
//             exercises_count: formattedExercises.length,
//             exercises: formattedExercises
//         });

//     } catch (error) {
//         await transaction.rollback();
//         console.error('Error fetching games:', error);
//         return res.status(500).json({
//             success: false,
//             error: 'SERVER_ERROR',
//             message: 'An error occurred while fetching games',
//             details: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// };

/* API 4 */
const startGameByClass = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const { exercise_type, class_id } = req.params;
        const userId = req.userId;

        const validGameTypes = Object.keys(EXERCISE_TYPE_MAP);
        if (!validGameTypes.includes(exercise_type)) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                error: 'INVALID_GAME_TYPE',
                message: `Game type must be one of: ${validGameTypes.join(', ')}`
            });
        }

        // 1. Get class row — verify it belongs to this student and has Zoom info
        const classItem = await Class.findOne({
            where: { id: class_id, student_id: userId },
            attributes: ['id', 'zoom_meeting_id', 'meeting_start', 'meeting_end'],
            transaction
        });

        if (!classItem) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                error: 'CLASS_NOT_FOUND',
                message: 'Class not found.'
            });
        }

        if (!classItem.zoom_meeting_id || !classItem.meeting_start || !classItem.meeting_end) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                error: 'NO_RECORDING',
                message: 'No Zoom recording information found for this class.'
            });
        }

        // 2. Ask FastAPI which analysis belongs to this class
        let statusResult;
        try {
            statusResult = await getClassAnalysisStatus(
                classItem.zoom_meeting_id,
                new Date(classItem.meeting_start).toISOString(),
                new Date(classItem.meeting_end).toISOString()
            );
        } catch (err) {
            await transaction.rollback();
            console.error('FastAPI class-status error:', err.message);
            return res.status(503).json({
                success: false,
                error: 'AI_SERVICE_UNAVAILABLE',
                message: 'Could not reach the AI service. Please try again later.'
            });
        }

        if (!statusResult.found) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                error: 'NO_ANALYSIS_FOUND',
                message: 'No AI analysis found for this class.'
            });
        }

        if (statusResult.status !== 'completed') {
            await transaction.rollback();
            return res.status(202).json({
                success: false,
                error: 'ANALYSIS_NOT_READY',
                message: `Your practice content is being prepared (status: ${statusResult.status}). Please check back shortly.`
            });
        }

        // 3. Fetch the full analysis (includes game_raw_response)
        let analysis;
        try {
            analysis = await getAnalysisResults(statusResult.request_id);
        } catch (err) {
            await transaction.rollback();
            console.error('FastAPI results error:', err.message);
            return res.status(503).json({
                success: false,
                error: 'AI_SERVICE_UNAVAILABLE',
                message: 'Could not fetch analysis results. Please try again later.'
            });
        }

        if (analysis.game_content_status !== 'ok') {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                error: 'GAME_CONTENT_NOT_READY',
                message: `Game content is not ready yet (status: ${analysis.game_content_status || 'pending'}). Please check back shortly.`
            });
        }

        // 4. Parse game content and extract the requested exercise type
        let gameContent;
        try {
            gameContent = typeof analysis.game_raw_response === 'string'
                ? JSON.parse(analysis.game_raw_response)
                : analysis.game_raw_response;
        } catch (e) {
            await transaction.rollback();
            console.error('Failed to parse game_raw_response:', e.message);
            return res.status(500).json({
                success: false,
                error: 'GAME_CONTENT_PARSE_ERROR',
                message: 'Failed to parse game content.'
            });
        }

        const gameKey = EXERCISE_TYPE_MAP[exercise_type];
        const exercises = gameContent[gameKey] || [];
        const dbGameType = getDbGameType(exercise_type);
        const cefrLevel = extractCefrLevel(analysis.level);

        if (!exercises.length) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                error: 'NO_EXERCISES_FOUND',
                message: `No exercises found for type '${exercise_type}'.`
            });
        }

        // 5. Create game session in MySQL
        const gameSession = await GameSession.create({
            user_id: userId,
            game_type: dbGameType,
            mode: 'by_class',
            selected_item_id: null,
            class_id: class_id,
            analysis_id: analysis.id,
            difficulty: cefrLevel,
            progress_current: 0,
            progress_total: exercises.length,
            correct_count: 0,
            incorrect_count: 0,
            status: 'active',
            started_at: new Date(),
            created_at: new Date()
        }, { transaction });

        await transaction.commit();

        return res.status(200).json({
            success: true,
            session_id: gameSession.id,
            game_type: exercise_type,
            mode: 'by_class',
            class_id: class_id,
            request_id: statusResult.request_id,
            analysis_id: analysis.id,
            level: analysis.level,
            exercises_count: exercises.length,
            exercises: exercises.map((item, index) => ({
                id: index + 1,
                exercise_data: transformExerciseData(exercise_type, item)
            }))
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error starting game by class:', error);
        return res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: 'An error occurred while starting the game',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * API 5: Submit Game Session Results (PUT — updates existing session)
 * Processes answers and updates student progress
 */
const submitGameSession = async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        const { session_id, answers  } = req.body;
        const userId = req.userId;

        if (!session_id || !answers || !Array.isArray(answers)) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                error: 'INVALID_REQUEST',
                message: 'session_id and answers array are required'
            });
        }

        const correctCount = answers.filter(a => a.is_correct === true).length;
        const incorrectCount = answers.filter(a => a.is_correct === false).length;
        const totalAnswered = correctCount + incorrectCount;
        const accuracy = totalAnswered > 0 ? (correctCount / totalAnswered) * 100 : 0;

        const [affectedRows] = await GameSession.update(
            {
                progress_current: totalAnswered,
                correct_count: correctCount,
                incorrect_count: incorrectCount,
                status: 'completed',
                completed_at: new Date(),
                updated_at: new Date()
            },
            {
                where: {
                    id: session_id,
                    user_id: userId,
                    status: 'active'
                },
                transaction
            }
        );

        if (affectedRows === 0) {
            await transaction.rollback();

            return res.status(404).json({
                success: false,
                error: 'SESSION_NOT_FOUND',
                message: 'Session not found or already completed'
            });
        }

        const session = await GameSession.findOne({
            where: { id: session_id },
            attributes: ['id', 'user_id', 'game_type', 'mode', 'progress_total', 'correct_count', 'incorrect_count'],
            transaction
        });

        const basePoints = correctCount * 10;
        const accuracyBonus = accuracy >= 80 ? 20 : 0;
        const perfectBonus = accuracy === 100 ? 50 : 0;
        const totalPoints = basePoints + accuracyBonus + perfectBonus;

        await PointsLedger.create({
            student_id: userId,
            points: totalPoints,
            source_type: 'game',
            source_id: session_id,
            description: `Completed ${session.game_type} game (${session.mode}): ${correctCount}/${totalAnswered} correct (${accuracy.toFixed(1)}%)`
        }, { transaction });

        let studentProgress = await StudentProgress.findOne({
            where: { student_id: userId },
            transaction
        });

        if (!studentProgress) {
            await StudentProgress.create({
                student_id: userId,
                current_level: 'A1',
                total_points: totalPoints,
                total_classes: 0,
                vocabulary_mastered: correctCount,
                grammar_concepts_learned: 0,
                games_played: 1,
                last_updated: new Date()
            }, { transaction });
        } else {
            await StudentProgress.update(
                {
                    total_points: sequelize.literal(`total_points + ${totalPoints}`),
                    games_played: sequelize.literal('games_played + 1'),
                    vocabulary_mastered: sequelize.literal(`vocabulary_mastered + ${correctCount}`),
                    last_updated: new Date()
                },
                {
                    where: { student_id: userId },
                    transaction
                }
            );
        }

        const achievements = [];
        
        const updatedProgress = await StudentProgress.findOne({
            where: { student_id: userId },
            transaction
        });

        if (updatedProgress.games_played === 1) {
            achievements.push({
                type: 'first_game',
                title: 'First Steps',
                description: 'Completed your first game!',
                bonus_points: 50
            });
            
            await PointsLedger.create({
                student_id: userId,
                points: 50,
                source_type: 'achievement',
                source_id: 'first_game',
                description: 'Achievement unlocked: First Steps'
            }, { transaction });
            
            await StudentProgress.update(
                { total_points: sequelize.literal('total_points + 50') },
                { where: { student_id: userId }, transaction }
            );
        }

        if (updatedProgress.games_played === 10) {
            achievements.push({
                type: 'ten_games',
                title: 'Game Master',
                description: 'Played 10 games!',
                bonus_points: 100
            });
            
            await PointsLedger.create({
                student_id: userId,
                points: 100,
                source_type: 'achievement',
                source_id: 'ten_games',
                description: 'Achievement unlocked: Game Master'
            }, { transaction });
            
            await StudentProgress.update(
                { total_points: sequelize.literal('total_points + 100') },
                { where: { student_id: userId }, transaction }
            );
        }

        if (accuracy === 100) {
            achievements.push({
                type: 'perfect_score',
                title: 'Perfect!',
                description: 'Got 100% on a game!',
                bonus_points: perfectBonus
            });
        }

        await transaction.commit();

        const finalProgress = await StudentProgress.findOne({
            where: { student_id: userId },
            attributes: ['total_points', 'games_played', 'vocabulary_mastered', 'current_level']
        });

        return res.status(200).json({
            success: true,
            message: 'Game session completed successfully',
            session: {
                id: session_id,
                user_id: userId,
                game_type: session.game_type,
                mode: session.mode,
                correct_count: correctCount,
                incorrect_count: incorrectCount,
                total_questions: totalAnswered,
                accuracy: accuracy.toFixed(1),
                status: 'completed'
            },
            points: {
                earned: totalPoints,
                breakdown: {
                    base_points: basePoints,
                    accuracy_bonus: accuracyBonus,
                    perfect_bonus: perfectBonus
                }
            },
            achievements: achievements.length > 0 ? achievements : undefined,
            progress: {
                total_points: finalProgress.total_points,
                games_played: finalProgress.games_played,
                vocabulary_mastered: finalProgress.vocabulary_mastered,
                current_level: finalProgress.current_level
            }
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error submitting game session:', error);
        return res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: 'An error occurred while submitting game session',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    // getGameOptions,
    // getOptionItems,
    // getGamesByOption,
    getAllGames,
    startGameByClass,
    submitGameSession
};