const { Op } = require('sequelize');
const moment = require('moment-timezone');
const TrialClassRegistration = require('../../models/trialClassRegistration');
const Class = require('../../models/classes');
const User = require('../../models/users');
const { getTimezoneForCountry } = require('../../utils/countryTimezones');


/**
 * GET /automation/trial-classes/upcoming
 * Returns upcoming trial classes (meeting_start > now) with linked classes table data
 *
 * Query params:
 *   page, limit, teacher_id, sales_agent_id, language, search, sort_direction
 */
const getUpcomingTrialClasses = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            teacher_id,
            sales_agent_id,
            language,
            search,
            sort_direction = 'asc'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const whereClause = {
            meeting_start: { [Op.gt]: new Date() },
            status: { [Op.notIn]: ['cancelled', 'completed', 'converted'] },
            ai_informed: false
        };

        if (teacher_id) whereClause.teacher_id = teacher_id;
        if (sales_agent_id) whereClause.booked_by = sales_agent_id;
        if (language) whereClause.language = language;
        if (search) {
            whereClause[Op.or] = [
                { student_name: { [Op.like]: `%${search}%` } },
                { mobile: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } }
            ];
        }

        const { count, rows } = await TrialClassRegistration.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: Class,
                    as: 'classInfo',
                    attributes: [
                        'id', 'status', 'join_url', 'zoom_id', 'is_present',
                        'meeting_start', 'meeting_end', 'booked_by', 'recording_status'
                    ],
                    required: false
                },
                {
                    model: User,
                    as: 'teacher',
                    attributes: ['id', 'full_name', 'email', 'timezone']
                },
                {
                    model: User,
                    as: 'salesAgent',
                    attributes: ['id', 'full_name', 'email', 'role_name']
                }
            ],
            order: [['meeting_start', sort_direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC']],
            limit: parseInt(limit),
            offset
        });

        const formatted = rows.map((trial) => {
            const t = trial.toJSON();

            const studentTimezone = getTimezoneForCountry(t.country_code);

            const meetingStartUtc = moment.utc(t.meeting_start);
            const meetingEndUtc = moment.utc(t.meeting_end);

            const classInfoStartUtc = t.classInfo ? moment.utc(t.classInfo.meeting_start) : null;
            const classInfoEndUtc   = t.classInfo ? moment.utc(t.classInfo.meeting_end)   : null;

            return {
                id: t.id,
                studentName: t.student_name,
                parentName: t.parent_name || null,
                age: t.age,
                mobile: t.mobile,
                countryCode: t.country_code,
                email: t.email,
                language: t.language,
                meetingTime: {
                    utc: {
                        start: meetingStartUtc.format('YYYY-MM-DD HH:mm:ss'),
                        end: meetingEndUtc.format('YYYY-MM-DD HH:mm:ss')
                    },
                    studentLocal: {
                        timezone: studentTimezone,
                        start: meetingStartUtc.tz(studentTimezone).format('YYYY-MM-DD HH:mm:ss'),
                        end: meetingEndUtc.tz(studentTimezone).format('YYYY-MM-DD HH:mm:ss')
                    }
                },
                status: t.status,
                trialClassStatus: t.trial_class_status,
                description: t.description,
                teacher: t.teacher
                    ? {
                          id: t.teacher.id,
                          name: t.teacher.full_name,
                          email: t.teacher.email,
                          timezone: t.teacher.timezone
                      }
                    : null,
                salesAgent: t.salesAgent
                    ? {
                          id: t.salesAgent.id,
                          name: t.salesAgent.full_name,
                          email: t.salesAgent.email,
                          role: t.salesAgent.role_name
                      }
                    : null,
                classInfo: t.classInfo
                    ? {
                          id: t.classInfo.id,
                          status: t.classInfo.status,
                          joinUrl: t.classInfo.join_url,
                          zoomId: t.classInfo.zoom_id,
                          isPresent: t.classInfo.is_present,
                          meetingTime: {
                              utc: {
                                  start: classInfoStartUtc.format('YYYY-MM-DD HH:mm:ss'),
                                  end: classInfoEndUtc.format('YYYY-MM-DD HH:mm:ss')
                              },
                              studentLocal: {
                                  timezone: studentTimezone,
                                  start: classInfoStartUtc.tz(studentTimezone).format('YYYY-MM-DD HH:mm:ss'),
                                  end: classInfoEndUtc.tz(studentTimezone).format('YYYY-MM-DD HH:mm:ss')
                              }
                          },
                          recordingStatus: t.classInfo.recording_status
                      }
                    : null,
                createdAt: t.created_at
            };
        });

        return res.status(200).json({
            status: 'success',
            data: {
                trials: formatted,
                total: count,
                pages: Math.ceil(count / parseInt(limit)),
                currentPage: parseInt(page)
            }
        });
    } catch (error) {
        console.error('Error in getUpcomingTrialClasses:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * PATCH /automation/trial-classes/:id/call-result
 * Update call result (trial_class_status + notes) after a call and log to history
 *
 * Body: { trial_class_status, notes? }
 */
const updateCallResult = async (req, res) => {
    try {
        const { id, ai_call_result, notes } = req.body;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'id is required'
            });
        }

        if (!ai_call_result) {
            return res.status(400).json({
                status: 'error',
                message: 'ai_call_result is required'
            });
        }

        const trialClass = await TrialClassRegistration.findByPk(id);
        if (!trialClass) {
            return res.status(404).json({
                status: 'error',
                message: 'Trial class registration not found'
            });
        }

        await trialClass.update({
            ai_call_result,
            ai_informed: true,
            ai_informed_at: new Date(),
            ...(notes !== undefined && { status_change_notes: notes })
        });

        return res.status(200).json({
            status: 'success',
            message: 'Call result updated successfully',
            data: {
                id: trialClass.id,
                aiCallResult: ai_call_result,
                aiInformedAt: trialClass.ai_informed_at,
                notes: notes || null
            }
        });
    } catch (error) {
        console.error('Error in updateCallResult:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    getUpcomingTrialClasses,
    updateCallResult
};
