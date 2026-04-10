'use strict';

const Class = require('../../models/classes');
const User = require('../../models/users');
const ZoomService = require('../../services/zoom.service');
const { syncZoomMeetingToPg } = require('../../services/zoom-pg-sync');

/**
 * POST /api/internal/create-zoom
 * Called by Ashish's server afterCreate hook when a class is booked.
 * Creates a unique Zoom meeting and writes zoom_unique_meeting_id back to MySQL + Postgres.
 *
 * Auth: x-internal-secret header must match INTERNAL_SECRET env var.
 */
async function createZoomMeeting(req, res) {
    const authHeader = req.headers['x-internal-secret'];
    if (!authHeader || authHeader !== process.env.INTERNAL_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { classId, teacherId, meetingStart, meetingEnd } = req.body;

    if (!classId || !teacherId || !meetingStart) {
        return res.status(400).json({ error: 'Missing required fields: classId, teacherId, meetingStart' });
    }

    try {
        // Idempotent — if meeting already exists, skip
        const existing = await Class.findOne({
            where: { id: classId },
            attributes: ['id', 'zoom_unique_meeting_id']
        });

        if (existing?.zoom_unique_meeting_id) {
            return res.status(200).json({
                success: true,
                alreadyExists: true,
                classId,
                meetingId: existing.zoom_unique_meeting_id
            });
        }

        const teacher = await User.findByPk(teacherId, { attributes: ['id', 'email'] });

        if (!teacher?.email) {
            return res.status(404).json({ error: `Teacher ${teacherId} not found or has no email` });
        }

        const durationMinutes = meetingEnd
            ? Math.ceil((new Date(meetingEnd) - new Date(meetingStart)) / 60000)
            : 55;

        const meeting = await ZoomService.createMeeting(
            teacher.email,
            meetingStart,
            durationMinutes,
            `Tulkka Class ${classId}`
        );

        await Class.update(
            { zoom_unique_meeting_id: meeting.id, zoom_unique_join_url: meeting.join_url },
            { where: { id: classId } }
        );

        await syncZoomMeetingToPg(classId, meeting.id, meeting.join_url);

        console.log(`[InternalZoom] class ${classId} → meeting ${meeting.id}`);

        return res.status(200).json({
            success: true,
            classId,
            meetingId: meeting.id,
            joinUrl: meeting.join_url
        });

    } catch (err) {
        console.error(`[InternalZoom] Error for class ${classId}: ${err.message}`);
        return res.status(500).json({ error: err.message });
    }
}

module.exports = { createZoomMeeting };
