'use strict';

const express = require('express');
const router = express.Router();
const { createZoomMeeting } = require('../../controller/internal/zoom-meeting.controller');

// No public auth middleware — secured via x-internal-secret header inside controller
router.post('/create-zoom', createZoomMeeting);

module.exports = router;
