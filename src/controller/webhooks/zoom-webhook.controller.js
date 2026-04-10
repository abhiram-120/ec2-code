'use strict';

const crypto = require('crypto');
const Class = require('../../models/classes');
const ZoomTranscription = require('../../models/zoomTranscription.model');

/**
 * Verify Zoom webhook signature.
 * Zoom signs requests with HMAC-SHA256 using ZOOM_WEBHOOK_SECRET_TOKEN.
 *
 * @param {object} req - Express request
 * @returns {boolean}
 */
function isValidSignature(req) {
    const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    const signature = req.headers['x-zm-signature'];
    const timestamp = req.headers['x-zm-request-timestamp'];

    if (!secret || !signature || !timestamp) return false;

    const payload = `v0:${timestamp}:${JSON.stringify(req.body)}`;
    const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `v0=${hash}` === signature;
}

/**
 * Main Zoom webhook handler.
 * Handles:
 *   - endpoint.url_validation  (Zoom ownership challenge on webhook registration)
 *   - recording.completed      (link recording to class via zoom_unique_meeting_id)
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleZoomWebhook(req, res) {
    if (!isValidSignature(req)) {
        return res.status(401).end();
    }

    const { event, payload } = req.body;

    // ── Zoom ownership challenge ───────────────────────────────────────────
    if (event === 'endpoint.url_validation') {
        const { plainToken } = payload;
        const encryptedToken = crypto
            .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
            .update(plainToken)
            .digest('hex');
        return res.json({ plainToken, encryptedToken });
    }

    // ── Recording completed ────────────────────────────────────────────────
    if (event === 'recording.completed') {
        const meetingId = payload?.object?.id;
        const hostEmail = payload?.object?.host_email;

        if (!meetingId) {
            console.warn('[ZoomWebhook] recording.completed received without meeting id');
            return res.status(200).json({ received: true });
        }

        try {
            const classRecord = await Class.findOne({
                where: { zoom_unique_meeting_id: String(meetingId) },
            });

            if (!classRecord) {
                console.warn(`[ZoomWebhook] No class found for zoom_unique_meeting_id=${meetingId}`);
                return res.status(200).json({ received: true });
            }

            const existingTranscription = await ZoomTranscription.findOne({
                where: { meeting_id: String(meetingId) },
            });

            if (existingTranscription) {
                await ZoomTranscription.update(
                    {
                        class_id: String(classRecord.id),
                        teacher_id: String(classRecord.teacher_id),
                        user_id: String(classRecord.student_id || classRecord.teacher_id),
                    },
                    { where: { meeting_id: String(meetingId) } }
                );
            } else {
                await ZoomTranscription.create({
                    meeting_id: String(meetingId),
                    class_id: String(classRecord.id),
                    teacher_id: String(classRecord.teacher_id),
                    user_id: String(classRecord.student_id || classRecord.teacher_id),
                    teacher_email: hostEmail || '',
                    transcription_status: 'pending',
                });
            }

            console.log(`[ZoomWebhook] Linked meeting ${meetingId} to class ${classRecord.id}`);
        } catch (err) {
            console.error('[ZoomWebhook] Error processing recording.completed:', err.message);
        }
    }

    return res.status(200).json({ received: true });
}

module.exports = { handleZoomWebhook };
