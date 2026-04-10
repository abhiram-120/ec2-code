'use strict';

/**
 * Cron: Retry Zoom meeting creation for classes that failed at booking time.
 *
 * Runs every 15 minutes. Picks up classes where zoom_unique_meeting_id IS NULL
 * and zoom_retry_count < 5. Processes max 20 per run to avoid bursts.
 *
 * After 5 failed attempts, the class is excluded from retries permanently.
 * An admin can find them with:
 *   SELECT id, teacher_id, meeting_start FROM classes
 *   WHERE zoom_unique_meeting_id IS NULL AND zoom_retry_count >= 5;
 */

const cron = require('node-cron');
const { Op } = require('sequelize');
const Class = require('../models/classes');
const User = require('../models/users');
const ZoomService = require('../services/zoom.service');
const { syncZoomMeetingToPg } = require('../services/zoom-pg-sync');
const fs = require('fs');
const path = require('path');

const MAX_RETRIES = 5;
const BATCH_SIZE = 20;
const LOOKBACK_DAYS = 7;

let isRunning = false;

function log(msg) {
    const line = `[${new Date().toISOString()}] [ZoomRetry] ${msg}`;
    console.log(line);
    try {
        const logDir = path.join(__dirname, '..', 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const file = path.join(logDir, `zoom-meeting-retry-${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(file, line + '\n');
    } catch (_) {}
}

async function retryPendingMeetings() {
    if (isRunning) {
        log('Previous run still active, skipping.');
        return;
    }
    isRunning = true;

    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

        const classes = await Class.findAll({
            where: {
                zoom_unique_meeting_id: null,
                zoom_retry_count: { [Op.lt]: MAX_RETRIES },
                created_at: { [Op.gte]: cutoff },
                status: { [Op.notIn]: ['canceled', 'cancelled'] },
            },
            order: [['created_at', 'ASC']],
            limit: BATCH_SIZE,
        });

        if (classes.length === 0) return;
        log(`Processing ${classes.length} class(es) missing Zoom meetings`);

        for (const classRecord of classes) {
            try {
                const teacher = await User.findByPk(classRecord.teacher_id, {
                    attributes: ['id', 'email'],
                });

                if (!teacher?.email) {
                    log(`No email for teacher_id=${classRecord.teacher_id}, class_id=${classRecord.id} — giving up`);
                    await Class.update(
                        { zoom_retry_count: MAX_RETRIES },
                        { where: { id: classRecord.id } }
                    );
                    continue;
                }

                const durationMinutes = Math.ceil(
                    (new Date(classRecord.meeting_end) - new Date(classRecord.meeting_start)) / 60000
                ) || 55;

                const meeting = await ZoomService.createMeeting(
                    teacher.email,
                    classRecord.meeting_start,
                    durationMinutes,
                    `Tulkka Class ${classRecord.id}`
                );

                await Class.update(
                    {
                        zoom_unique_meeting_id: meeting.id,
                        zoom_unique_join_url: meeting.join_url,
                    },
                    { where: { id: classRecord.id } }
                );

                // Sync to Postgres simultaneously
                await syncZoomMeetingToPg(classRecord.id, meeting.id, meeting.join_url);

                log(`OK: class ${classRecord.id} → meeting ${meeting.id}`);
            } catch (err) {
                log(`FAIL: class ${classRecord.id} (attempt ${classRecord.zoom_retry_count + 1}): ${err.message}`);
                await Class.update(
                    { zoom_retry_count: classRecord.zoom_retry_count + 1 },
                    { where: { id: classRecord.id } }
                );
            }
        }
    } catch (err) {
        log(`Unexpected error: ${err.message}`);
    } finally {
        isRunning = false;
    }
}

// Run every 15 minutes
cron.schedule('*/15 * * * *', retryPendingMeetings, {
    timezone: 'Asia/Jerusalem',
});

log('Zoom meeting retry cron started (every 15 min)');
