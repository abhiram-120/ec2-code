const express = require('express');
const router = express.Router();
const AuthValidator = require('../middleware/verify-token');
const notificationController = require('../controller/notification.controller');

router.get('/', AuthValidator, notificationController.listNotifications);
router.put('/read-all', AuthValidator, notificationController.markAllNotificationsRead);
router.put('/:id/read', AuthValidator, notificationController.markNotificationRead);

module.exports = router;
