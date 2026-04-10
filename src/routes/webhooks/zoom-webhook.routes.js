'use strict';

const express = require('express');
const router = express.Router();
const { handleZoomWebhook } = require('../../controller/webhooks/zoom-webhook.controller');

// No auth middleware — Zoom calls this endpoint directly.
// Authentication is handled inside the controller via HMAC signature verification.
router.post('/', handleZoomWebhook);

module.exports = router;
