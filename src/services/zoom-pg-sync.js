'use strict';

/**
 * Syncs zoom_unique_meeting_id and zoom_unique_join_url to Postgres classes table.
 * Called after MySQL is updated — keeps both DBs in sync.
 * Silent failure — if Postgres is down, MySQL already has the data.
 */

const { Pool } = require('pg');

let _pool = null;

function getPool() {
    if (!_pool) {
        const host = process.env.PG_HOST;
        if (!host) return null; // Postgres not configured, skip
        _pool = new Pool({
            host,
            port: parseInt(process.env.PG_PORT || 5432),
            database: process.env.PG_DATABASE,
            user: process.env.PG_USER,
            password: process.env.PG_PASSWORD,
        });
    }
    return _pool;
}

/**
 * Update zoom fields on Postgres classes table by class id.
 * The row must already exist (Postgres is populated by a separate MySQL→PG sync process).
 * Logs a warning if 0 rows affected — means Postgres row isn't there yet (timing race or sync stopped).
 * @param {number|string} classId
 * @param {string} meetingId
 * @param {string} joinUrl
 */
async function syncZoomMeetingToPg(classId, meetingId, joinUrl) {
    const pool = getPool();
    if (!pool) return;
    try {
        const result = await pool.query(
            `UPDATE clean.classes SET zoom_unique_meeting_id = $1, zoom_unique_join_url = $2 WHERE class_id = $3`,
            [String(meetingId), joinUrl, classId]
        );
        if (result.rowCount === 0) {
            console.warn(`[PgSync] class ${classId} not found in clean.classes — MySQL updated but PG skipped`);
        } else {
            console.log(`[PgSync] class ${classId} → meeting ${meetingId}`);
        }
    } catch (err) {
        console.error(`[PgSync] Failed for class ${classId}: ${err.message}`);
    }
}

module.exports = { syncZoomMeetingToPg };
