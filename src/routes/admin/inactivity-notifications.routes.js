const express = require('express');
const router = express.Router();
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const controller = require('../../controller/admin/inactivity-notifications.controller');

const ensureNotificationsRead = checkPermission('notifications', 'read');
const ensureNotificationsCreate = checkPermission('notifications', 'create');

router.get('/users', AuthValidator, ensureNotificationsRead, controller.listInactiveUsers);
router.post('/send', AuthValidator, ensureNotificationsCreate, controller.sendInactivityNotification);
router.get('/booking-users', AuthValidator, ensureNotificationsRead, controller.listBookingReminderUsers);
router.post('/booking-send', AuthValidator, ensureNotificationsCreate, controller.sendBookingReminder);

module.exports = router;

