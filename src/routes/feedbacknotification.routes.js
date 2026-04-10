const express = require('express');
const router = express.Router();

const feedbackNotificationController = require('../controller/feedbacknotification.controller');

// Endpoint (NO auth) - use only in trusted environments
router.post('/feedback-notification', feedbackNotificationController.sendFeedbackNotification);

module.exports = router;

