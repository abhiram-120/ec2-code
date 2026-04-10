'use strict';

const axios = require('axios');

// ─── Token cache (module-level, lives for process lifetime) ────────────────
let _tokenCache = { token: null, expiresAt: 0 };

/**
 * Get a Zoom Server-to-Server OAuth access token.
 * Caches the token until 60 seconds before expiry.
 *
 * @returns {Promise<string>} Bearer token
 */
async function getAccessToken() {
    if (_tokenCache.token && Date.now() < _tokenCache.expiresAt - 60_000) {
        return _tokenCache.token;
    }

    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;
    const accountId = process.env.ZOOM_ACCOUNT_ID;

    const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    try {
        const response = await axios.post(
            `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
            {},
            {
                headers: {
                    Authorization: `Basic ${authString}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        const { access_token, expires_in } = response.data;
        _tokenCache = {
            token: access_token,
            expiresAt: Date.now() + expires_in * 1000,
        };

        return access_token;
    } catch (error) {
        console.error('[ZoomService] Auth error:', error.response?.data || error.message);
        throw new Error('Failed to authenticate with Zoom');
    }
}

/**
 * Create a unique Zoom meeting for a specific class.
 *
 * @param {string} teacherEmail  - Teacher's Zoom account email
 * @param {Date|string} startTime - Meeting start time (ISO string or Date)
 * @param {number} durationMinutes - Duration in minutes
 * @param {string} topic - Meeting topic shown in Zoom
 * @returns {Promise<{id: string, join_url: string}>}
 */
async function createMeeting(teacherEmail, startTime, durationMinutes, topic) {
    const token = await getAccessToken();

    const response = await axios.post(
        `https://api.zoom.us/v2/users/${encodeURIComponent(teacherEmail)}/meetings`,
        {
            topic,
            type: 2, // scheduled meeting (not PMI)
            start_time: new Date(startTime).toISOString(),
            duration: durationMinutes,
            settings: {
                join_before_host: true,
                approval_type: 2,
                audio: 'both',
                auto_recording: 'cloud',
            },
        },
        {
            headers: { Authorization: `Bearer ${token}` },
        }
    );

    return {
        id: String(response.data.id),
        join_url: response.data.join_url,
    };
}

/**
 * Delete a Zoom meeting (e.g. when a class is cancelled).
 * Silently ignores 404 (meeting already gone).
 *
 * @param {string} meetingId
 * @returns {Promise<void>}
 */
async function deleteMeeting(meetingId) {
    const token = await getAccessToken();

    try {
        await axios.delete(`https://api.zoom.us/v2/meetings/${meetingId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch (error) {
        if (error.response?.status === 404) return; // already gone, not an error
        console.error('[ZoomService] Delete error:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Update an existing Zoom meeting's start time and duration (e.g. rescheduled class).
 *
 * @param {string} meetingId
 * @param {Date|string} startTime
 * @param {number} durationMinutes
 * @returns {Promise<void>}
 */
async function updateMeeting(meetingId, startTime, durationMinutes) {
    const token = await getAccessToken();

    await axios.patch(
        `https://api.zoom.us/v2/meetings/${meetingId}`,
        {
            start_time: new Date(startTime).toISOString(),
            duration: durationMinutes,
        },
        {
            headers: { Authorization: `Bearer ${token}` },
        }
    );
}

/** Reset token cache — used in unit tests only */
function _resetTokenCache() {
    _tokenCache = { token: null, expiresAt: 0 };
}

module.exports = { getAccessToken, createMeeting, deleteMeeting, updateMeeting, _resetTokenCache };
