'use strict';

const http = require('http');

const FASTAPI_BASE = (process.env.FASTAPI_URL || 'http://16.16.169.47:8000').replace(/\/$/, '');

/**
 * Simple GET request to the FastAPI service (HTTP only).
 * Returns parsed JSON or throws an error.
 */
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`FastAPI response parse error: ${e.message}`));
                    }
                } else {
                    reject(new Error(`FastAPI HTTP ${res.statusCode} for ${url}: ${data}`));
                }
            });
        });
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error(`FastAPI request timed out: ${url}`));
        });
        req.on('error', reject);
    });
}

/**
 * GET /v1/audio/class-status
 * Returns { found, status, request_id } for the Zoom recording that overlaps
 * the given class time window.
 *
 * @param {string|number} meeting_id  - classes.zoom_id
 * @param {string}        meeting_start - ISO 8601, e.g. classes.meeting_start.toISOString()
 * @param {string}        meeting_end   - ISO 8601
 */
async function getClassAnalysisStatus(meeting_id, meeting_start, meeting_end) {
    const params = new URLSearchParams({
        meeting_id: String(meeting_id),
        meeting_start,
        meeting_end,
    });
    return httpGet(`${FASTAPI_BASE}/v1/audio/class-status?${params}`);
}

/**
 * GET /v1/audio/results/request/{request_id}
 * Returns the full analysis object including game_raw_response.
 *
 * @param {string} request_id - UUID from getClassAnalysisStatus()
 */
async function getAnalysisResults(request_id) {
    return httpGet(`${FASTAPI_BASE}/v1/audio/results/request/${encodeURIComponent(request_id)}`);
}

module.exports = { getClassAnalysisStatus, getAnalysisResults };
