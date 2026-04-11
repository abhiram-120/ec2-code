const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');
const moment = require('moment');
const User = require('./users');

const Class = sequelize.define(
    'Class',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        student_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            // references:{
            //     model: 'UserSubscriptionDetails',
            //     key: 'user_id'
            // }
            references: {
                model: 'users',
                key: 'id'
            }
        },
        teacher_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        feedback_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            defaultValue: null
        },
        meeting_start: {
            type: DataTypes.DATE,
            defaultValue: null
        },
        meeting_end: {
            type: DataTypes.DATE,
            defaultValue: null
        },
        status: {
            type: DataTypes.STRING(50),
            defaultValue: 'pending'
        },
        join_url: {
            type: DataTypes.TEXT
        },
        admin_url: {
            type: DataTypes.TEXT
        },
        zoom_id: {
            type: DataTypes.BIGINT,
            defaultValue: null
        },
        student_goal: {
            type: DataTypes.TEXT
        },
        student_goal_note: {
            type: DataTypes.TEXT
        },
        question_and_answer: {
            type: DataTypes.STRING(200),
            defaultValue: null
        },
        next_month_class_term: {
            type: DataTypes.BOOLEAN,
            defaultValue: 0,
            allowNull: false
        },
        is_present: {
            type: DataTypes.BOOLEAN,
            defaultValue: 1,
            allowNull: false
        },
        bonus_class: {
            type: DataTypes.BOOLEAN,
            defaultValue: 0,
            allowNull: false
        },
        is_trial: {
            type: DataTypes.BOOLEAN,
            defaultValue: 0
        },
        subscription_id: {
            type: DataTypes.INTEGER,
            defaultValue: null
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false
        },
        class_type: {
            type: DataTypes.STRING(255),
            defaultValue: 'app'
        },
        is_regular_hide: {
            type: DataTypes.BOOLEAN,
            defaultValue: 0
        },
        booked_by: {
            type: DataTypes.ENUM('user', 'admin', 'support_agent', 'teacher', 'sales_role', 'sales_appointment_setter'),
            allowNull: true,
            comment: 'Role of the person who booked the class'
        },
        booked_by_admin_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'ID of the admin who booked the class'
        },
        demo_class_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Reference to trial_class_registrations table'
        },
        cancellation_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Reason for cancellation if class was cancelled'
        },
        cancelled_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'ID of user who cancelled the class',
            references: {
                model: 'users',
                key: 'id'
            }
        },
        cancelled_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Timestamp when the class was cancelled'
        },
        canceled_by: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        get_classes_for_extension: {
            type: DataTypes.ENUM('updated', 'not_updated'),
            defaultValue: 'not_updated',
            allowNull: false,
            comment: 'Status for getClassesForExtension - whether the class has been updated or not'
        },
        batch_id: {
            type: DataTypes.STRING(255),
            allowNull: true,
            defaultValue: null,
            comment: 'Batch ID to group classes from the same regular class pattern'
        },
        recording_status: {
            type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
            allowNull: false,
            defaultValue: 'pending'
        },

        recording_url: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        is_game_approved: {
            type: DataTypes.BOOLEAN,
            defaultValue: 0,
            allowNull: false,
            comment: 'Whether the game approval has been completed for this class'
        },
        zoom_meeting_id: {
            type: DataTypes.BIGINT,
            defaultValue: null
        },
        payment_status: {
            type: DataTypes.ENUM('paid', 'unpaid'),
            allowNull: false,
            defaultValue: 'unpaid'
        },
        zoom_unique_meeting_id: {
            type: DataTypes.STRING(255),
            defaultValue: null
        },
        zoom_unique_join_url: {
            type: DataTypes.TEXT,
            defaultValue: null
        },
        zoom_retry_count: {
            type: DataTypes.TINYINT,
            defaultValue: 0
        }
    },
    {
        tableName: 'classes',
        timestamps: true, // Enable timestamps
        createdAt: 'created_at', // Specify the field name for createdAt
        updatedAt: 'updated_at', // Specify the field name for updatedAt
        underscored: true
    }
);

// ─── afterCreate hook: notify EC2 to create a unique Zoom meeting ─────────────
// Fire-and-forget — class booking never fails due to Zoom being down.
// If the call fails, the EC2 retry cron (every 15 min) will create the meeting anyway.
Class.addHook('afterCreate', (classInstance) => {
    setImmediate(async () => {
        try {
            const axios = require('axios');
            const https = require('https');
            const secret =
                process.env.ZOOM_INTERNAL_SECRET || 'tulkka-zoom-internal-2026';
            const apiPort =
                Number(process.env.PORT) ||
                Number(process.env.HTTP_PORT) ||
                3000;
            const publicZoomUrl =
                process.env.ZOOM_INTERNAL_PUBLIC_URL ||
                'https://ec2-13-63-69-253.eu-north-1.compute.amazonaws.com/api/internal/create-zoom';
            const body = {
                classId: classInstance.id,
                teacherId: classInstance.teacher_id,
                meetingStart: classInstance.meeting_start,
                meetingEnd: classInstance.meeting_end
            };
            const tlsInsecure =
                process.env.ZOOM_INTERNAL_TLS_INSECURE === '1' ||
                process.env.ZOOM_INTERNAL_TLS_INSECURE === 'true';

            const attempts = [];
            if (process.env.ZOOM_INTERNAL_CREATE_URL) {
                attempts.push({
                    url: process.env.ZOOM_INTERNAL_CREATE_URL,
                    httpsAgent: tlsInsecure ? new https.Agent({ rejectUnauthorized: false }) : undefined
                });
            } else {
                // 1) Same host (Vinay EC2): avoids TLS to self. Works even if ZOOM_USE_LOOPBACK is missing in PM2 env.
                attempts.push({
                    url: `http://127.0.0.1:${apiPort}/api/internal/create-zoom`,
                    httpsAgent: undefined
                });
                // 2) Remote API (Ashish): loopback fails — call Vinay; cert is self-signed so TLS must be relaxed here.
                attempts.push({
                    url: publicZoomUrl,
                    httpsAgent: new https.Agent({ rejectUnauthorized: false })
                });
            }

            let lastErr;
            for (const { url, httpsAgent } of attempts) {
                try {
                    await axios.post(url, body, {
                        headers: { 'x-internal-secret': secret },
                        timeout: 15000,
                        ...(httpsAgent ? { httpsAgent } : {})
                    });
                    lastErr = null;
                    break;
                } catch (e) {
                    lastErr = e;
                }
            }
            if (lastErr) {
                throw lastErr;
            }
        } catch (err) {
            if (process.env.ZOOM_INTERNAL_DEBUG === '1' || process.env.ZOOM_INTERNAL_DEBUG === 'true') {
                console.error('[Class.afterCreate create-zoom]', err.message);
            }
        }
    });
});

// Export the model to use it in other parts of your application
module.exports = Class;
