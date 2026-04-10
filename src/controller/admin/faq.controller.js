const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');
const config = require('../../config/config');
const { sequelize } = require('../../connection/connection');
const Faq = require('../../models/faq');
const FaqTranslation = require('../../models/faq_translation');

const ALLOWED_LANGUAGES = new Set(['EN', 'ES', 'FR', 'DE', 'HE']);
const ALLOWED_CATEGORIES = new Set([
    'GETTING_STARTED',
    'LEARNING_FEATURES',
    'CLASSES_AND_LESSONS',
    'PROGRESS_TRACKING',
    'TECHNICAL_HELP'
]);

AWS.config.update({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: 'eu-central-1'
});

const s3 = new AWS.S3();

const uploadFaqAttachment = multer({
    limits: {
        fileSize: 100 * 1024 * 1024
    },
    storage: multerS3({
        s3,
        bucket: config.AWS_BUCKET,
        acl: 'public-read',
        contentType: multerS3.AUTO_CONTENT_TYPE,
        metadata(req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key(req, file, cb) {
            const timestamp = Date.now();
            cb(null, `faqs/attachments/${timestamp}-${file.originalname}`);
        }
    }),
    fileFilter(req, file, cb) {
        const ok =
            (file.mimetype && file.mimetype.startsWith('image/')) ||
            (file.mimetype && file.mimetype.startsWith('video/')) ||
            file.mimetype === 'application/pdf';
        if (ok) {
            cb(null, true);
        } else {
            cb(new Error('Only image, video, or PDF files are allowed'), false);
        }
    }
});

function conditionalFaqUpload(req, res, next) {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
        return uploadFaqAttachment.single('attachment')(req, res, (err) => {
            if (err) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message: err.message || 'Invalid file upload',
                    timestamp: new Date().toISOString()
                });
            }
            next();
        });
    }
    next();
}

function parseBool(value, defaultValue = true) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return value.toLowerCase() === 'true' || value === '1';
    }
    return Boolean(value);
}

function normalizeTranslations(raw) {
    if (raw == null) {
        return null;
    }
    let parsed = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
        return null;
    }
    return parsed;
}

const createFaq = async (req, res) => {
    try {
        let translations;
        let is_active = true;
        let category = null;

        if (req.file) {
            translations = normalizeTranslations(req.body.translations);
            is_active = parseBool(req.body.is_active, true);
            category = req.body.category || null;
        } else {
            translations = normalizeTranslations(req.body.translations);
            is_active = parseBool(req.body.is_active, true);
            category = req.body.category || null;
        }

        if (category != null) {
            category = String(category).trim().toUpperCase();
            if (!ALLOWED_CATEGORIES.has(category)) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message:
                        'Invalid category. Allowed: GETTING_STARTED, LEARNING_FEATURES, CLASSES_AND_LESSONS, PROGRESS_TRACKING, TECHNICAL_HELP',
                    timestamp: new Date().toISOString()
                });
            }
        }

        if (!translations) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'translations must be a non-empty array',
                timestamp: new Date().toISOString()
            });
        }

        for (const row of translations) {
            if (!row || typeof row.language !== 'string' || !row.question || !row.answer) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message: 'Each translation requires language, question, and answer',
                    timestamp: new Date().toISOString()
                });
            }
            const lang = String(row.language).toUpperCase();
            if (!ALLOWED_LANGUAGES.has(lang)) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message: `Invalid language: ${row.language}. Allowed: EN, ES, FR, DE, HE`,
                    timestamp: new Date().toISOString()
                });
            }
        }

        const seen = new Set();
        for (const row of translations) {
            const lang = String(row.language).toUpperCase();
            if (seen.has(lang)) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message: `Duplicate language in translations: ${lang}`,
                    timestamp: new Date().toISOString()
                });
            }
            seen.add(lang);
        }

        let attachment_url = null;
        let attachment_mime_type = null;
        if (req.file) {
            attachment_url = req.file.location;
            attachment_mime_type = req.file.mimetype || null;
        }

        if (!Faq.associations?.translations) {
            Faq.hasMany(FaqTranslation, { foreignKey: 'faq_id', as: 'translations' });
        }
        if (!FaqTranslation.associations?.faq) {
            FaqTranslation.belongsTo(Faq, { foreignKey: 'faq_id', as: 'faq' });
        }

        const created = await sequelize.transaction(async (transaction) => {
            const faq = await Faq.create(
                {
                    is_active,
                    category,
                    attachment_url,
                    attachment_mime_type,
                    created_at: new Date(),
                    updated_at: new Date()
                },
                { transaction }
            );

            const rows = translations.map((t) => ({
                faq_id: faq.id,
                language: String(t.language).toUpperCase(),
                question: String(t.question),
                answer: String(t.answer),
                created_at: new Date(),
                updated_at: new Date()
            }));

            await FaqTranslation.bulkCreate(rows, { transaction });

            return await Faq.findByPk(faq.id, {
                include: [{ model: FaqTranslation, as: 'translations' }],
                transaction
            });
        });

        res.status(201).json({
            success: true,
            status: 'success',
            message: 'FAQ created successfully',
            data: created,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error creating FAQ:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to create FAQ',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

const updateFaq = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'Invalid FAQ id',
                timestamp: new Date().toISOString()
            });
        }

        const faq = await Faq.findByPk(id);
        if (!faq) {
            return res.status(404).json({
                success: false,
                status: 'error',
                message: 'FAQ not found',
                timestamp: new Date().toISOString()
            });
        }

        const translations = normalizeTranslations(req.body.translations);
        if (!translations) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'translations must be a non-empty array',
                timestamp: new Date().toISOString()
            });
        }

        for (const row of translations) {
            if (!row || typeof row.language !== 'string' || !row.question || !row.answer) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message: 'Each translation requires language, question, and answer',
                    timestamp: new Date().toISOString()
                });
            }
            const lang = String(row.language).toUpperCase();
            if (!ALLOWED_LANGUAGES.has(lang)) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message: `Invalid language: ${row.language}. Allowed: EN, ES, FR, DE, HE`,
                    timestamp: new Date().toISOString()
                });
            }
        }

        const seen = new Set();
        for (const row of translations) {
            const lang = String(row.language).toUpperCase();
            if (seen.has(lang)) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message: `Duplicate language in translations: ${lang}`,
                    timestamp: new Date().toISOString()
                });
            }
            seen.add(lang);
        }

        let category = typeof req.body.category === 'undefined' ? faq.category : (req.body.category || null);
        if (category != null) {
            category = String(category).trim().toUpperCase();
            if (!ALLOWED_CATEGORIES.has(category)) {
                return res.status(400).json({
                    success: false,
                    status: 'error',
                    message:
                        'Invalid category. Allowed: GETTING_STARTED, LEARNING_FEATURES, CLASSES_AND_LESSONS, PROGRESS_TRACKING, TECHNICAL_HELP',
                    timestamp: new Date().toISOString()
                });
            }
        }

        const is_active = typeof req.body.is_active === 'undefined' ? faq.is_active : parseBool(req.body.is_active, faq.is_active);
        const removeAttachment = parseBool(req.body.remove_attachment, false);

        let attachment_url = faq.attachment_url;
        let attachment_mime_type = faq.attachment_mime_type;
        if (removeAttachment) {
            attachment_url = null;
            attachment_mime_type = null;
        }
        if (req.file) {
            attachment_url = req.file.location;
            attachment_mime_type = req.file.mimetype || null;
        }

        if (!Faq.associations?.translations) {
            Faq.hasMany(FaqTranslation, { foreignKey: 'faq_id', as: 'translations' });
        }
        if (!FaqTranslation.associations?.faq) {
            FaqTranslation.belongsTo(Faq, { foreignKey: 'faq_id', as: 'faq' });
        }

        const updated = await sequelize.transaction(async (transaction) => {
            await Faq.update(
                {
                    is_active,
                    category,
                    attachment_url,
                    attachment_mime_type,
                    updated_at: new Date()
                },
                { where: { id }, transaction }
            );

            await FaqTranslation.destroy({ where: { faq_id: id }, transaction });

            const rows = translations.map((t) => ({
                faq_id: id,
                language: String(t.language).toUpperCase(),
                question: String(t.question),
                answer: String(t.answer),
                created_at: new Date(),
                updated_at: new Date()
            }));
            await FaqTranslation.bulkCreate(rows, { transaction });

            return await Faq.findByPk(id, {
                include: [{ model: FaqTranslation, as: 'translations' }],
                transaction
            });
        });

        return res.status(200).json({
            success: true,
            status: 'success',
            message: 'FAQ updated successfully',
            data: updated,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error updating FAQ:', error);
        return res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to update FAQ',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

const deleteFaq = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'Invalid FAQ id',
                timestamp: new Date().toISOString()
            });
        }

        const faq = await Faq.findByPk(id);
        if (!faq) {
            return res.status(404).json({
                success: false,
                status: 'error',
                message: 'FAQ not found',
                timestamp: new Date().toISOString()
            });
        }

        await sequelize.transaction(async (transaction) => {
            await FaqTranslation.destroy({ where: { faq_id: id }, transaction });
            await Faq.destroy({ where: { id }, transaction });
        });

        return res.status(200).json({
            success: true,
            status: 'success',
            message: 'FAQ deleted successfully',
            data: { id },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error deleting FAQ:', error);
        return res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to delete FAQ',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

const listFaqsPublic = async (req, res) => {
    try {
        if (!Faq.associations?.translations) {
            Faq.hasMany(FaqTranslation, { foreignKey: 'faq_id', as: 'translations' });
        }
        if (!FaqTranslation.associations?.faq) {
            FaqTranslation.belongsTo(Faq, { foreignKey: 'faq_id', as: 'faq' });
        }

        const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';
        const languageRaw = req.query.language;
        const language = typeof languageRaw === 'string' && languageRaw.trim() ? languageRaw.trim().toUpperCase() : null;
        const categoryRaw = req.query.category;
        const category = typeof categoryRaw === 'string' && categoryRaw.trim() ? categoryRaw.trim().toUpperCase() : null;

        if (language && !ALLOWED_LANGUAGES.has(language)) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: `Invalid language filter: ${languageRaw}. Allowed: EN, ES, FR, DE, HE`,
                timestamp: new Date().toISOString()
            });
        }

        if (category && !ALLOWED_CATEGORIES.has(category)) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message:
                    `Invalid category filter: ${categoryRaw}. Allowed: GETTING_STARTED, LEARNING_FEATURES, CLASSES_AND_LESSONS, PROGRESS_TRACKING, TECHNICAL_HELP`,
                timestamp: new Date().toISOString()
            });
        }

        const pageRaw = req.query.page;
        const limitRaw = req.query.limit;
        const page = Math.max(1, Number.parseInt(String(pageRaw || '1'), 10) || 1);
        const limitRequested = Number.parseInt(String(limitRaw || '10'), 10);
        const limit = Math.min(100, Math.max(1, Number.isFinite(limitRequested) ? limitRequested : 10));
        const offset = (page - 1) * limit;

        const where = includeInactive ? {} : { is_active: true };
        if (category) {
            where.category = category;
        }

        const include = [
            {
                model: FaqTranslation,
                as: 'translations',
                ...(language ? { where: { language }, required: true } : {})
            }
        ];

        const { rows: faqs, count: total } = await Faq.findAndCountAll({
            where,
            include,
            distinct: true,
            limit,
            offset,
            order: [
                ['id', 'DESC'],
                [{ model: FaqTranslation, as: 'translations' }, 'language', 'ASC']
            ]
        });

        const data = (faqs || []).map((faq) => ({
            id: faq.id,
            is_active: faq.is_active,
            category: faq.category || null,
            attachment_url: faq.attachment_url || null,
            attachment_mime_type: faq.attachment_mime_type || null,
            created_at: faq.created_at,
            updated_at: faq.updated_at,
            translations: (faq.translations || []).map((t) => ({
                id: t.id,
                language: t.language,
                question: t.question,
                answer: t.answer,
                created_at: t.created_at,
                updated_at: t.updated_at
            }))
        }));

        const totalPages = Math.max(1, Math.ceil((total || 0) / limit));

        return res.status(200).json({
            success: true,
            status: 'success',
            message: 'FAQs fetched successfully',
            data: {
                items: data,
                pagination: {
                    page,
                    limit,
                    total: total || 0,
                    total_pages: totalPages
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching FAQs:', error);
        return res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to fetch FAQs',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

const updateFaqStatus = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'Invalid FAQ id',
                timestamp: new Date().toISOString()
            });
        }

        const is_active = parseBool(req.body?.is_active, true);

        const faq = await Faq.findByPk(id);
        if (!faq) {
            return res.status(404).json({
                success: false,
                status: 'error',
                message: 'FAQ not found',
                timestamp: new Date().toISOString()
            });
        }

        faq.is_active = is_active;
        faq.updated_at = new Date();
        await faq.save();

        return res.status(200).json({
            success: true,
            status: 'success',
            message: 'FAQ status updated successfully',
            data: {
                id: faq.id,
                is_active: faq.is_active,
                category: faq.category || null,
                updated_at: faq.updated_at
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error updating FAQ status:', error);
        return res.status(500).json({
            success: false,
            status: 'error',
            message: 'Failed to update FAQ status',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = {
    uploadFaqAttachment,
    conditionalFaqUpload,
    createFaq,
    updateFaq,
    deleteFaq,
    listFaqsPublic,
    updateFaqStatus
};
