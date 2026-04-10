const { Op } = require('sequelize');
const UserNotification = require('../models/UserNotification');
const NotificationRule = require('../models/NotificationRule');

const FirebaseService = require('../services/firebase-service');

const firebaseService = new FirebaseService();

/**
 * Get notifications for the current user
 */
const listNotifications = async (req, res) => {
    try {
        const { limit = 25, page = 1, startAfter = null } = req.query;
        const userId = req.user?.id || req.userId;
        const result = await firebaseService.getNotifications(userId, {
            limit,
            page,
            startAfter,
            includeTotal: true
        });

        return res.status(200).json({
            status: 'success',
            data: result.items,
            pagination: {
                limit: parseInt(limit, 10),
                page: parseInt(page, 10),
                count: result.items.length,
                nextCursor: result.nextCursor,
                total: result.total
            }
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch notifications',
            details: error.message
        });
    }
};

/**
 * Mark a single notification as read
 */
const markNotificationRead = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Notification ID is required'
            });
        }

        const success = await firebaseService.markAsRead(id);
        return res.status(200).json({
            status: success ? 'success' : 'error',
            message: success ? 'Notification marked as read' : 'Failed to mark notification as read'
        });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to mark notification as read',
            details: error.message
        });
    }
};

/**
 * Mark all notifications as read for the current user
 */
const markAllNotificationsRead = async (req, res) => {
    try {
        const userId = req.user?.id || req.userId;
        const payload = Array.isArray(req.body) ? req.body : req.body?.notifications;

        if (!Array.isArray(payload) || payload.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'notifications must be a non-empty array'
            });
        }

        const invalidItem = payload.find(item =>
            !item ||
            typeof item !== 'object' ||
            !item.id ||
            typeof item.isRead !== 'boolean'
        );

        if (invalidItem) {
            return res.status(400).json({
                status: 'error',
                message: 'Each notification must include id and boolean isRead'
            });
        }

        const result = await firebaseService.updateReadStatuses(userId, payload);

        return res.status(result.success ? 200 : 400).json({
            status: result.success ? 'success' : 'error',
            message: result.success
                ? 'Notifications updated successfully'
                : 'Failed to update notifications',
            data: {
                requested: payload.length,
                updated: result.updatedCount,
                skipped: result.skippedIds
            }
        });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to mark all notifications as read',
            details: error.message
        });
    }
};

/**
 * GET /notifications
 * Get the current user's in-app notifications (paginated, newest first)
 */
const getNotifications = async (req, res) => {
    try {
        const userId = req.userId;
        const { page = 1, limit = 20, unread_only } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const where = { user_id: userId };
        if (unread_only === 'true') {
            where.is_read = false;
        }

        const { count, rows } = await UserNotification.findAndCountAll({
            where,
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset,
            include: [{
                model: NotificationRule,
                as: 'rule',
                attributes: ['id', 'rule_name', 'display_name', 'trigger_type'],
                required: false
            }]
        });

        return res.status(200).json({
            status: 'success',
            message: 'Notifications fetched',
            data: {
                notifications: rows,
                total: count,
                page: parseInt(page),
                totalPages: Math.ceil(count / parseInt(limit)),
                unreadCount: await UserNotification.count({ where: { user_id: userId, is_read: false } })
            }
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * GET /notifications/unread-count
 * Get the count of unread notifications for the current user
 */
const getUnreadCount = async (req, res) => {
    try {
        const userId = req.userId;
        const count = await UserNotification.count({
            where: { user_id: userId, is_read: false }
        });

        return res.status(200).json({
            status: 'success',
            data: { unreadCount: count }
        });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * PATCH /notifications/:id/read
 * Mark a single notification as read
 */
const markAsRead = async (req, res) => {
    try {
        const userId = req.userId;
        const notification = await UserNotification.findOne({
            where: { id: req.params.id, user_id: userId }
        });

        if (!notification) {
            return res.status(404).json({ status: 'error', message: 'Notification not found' });
        }

        await notification.update({
            is_read: true,
            read_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            message: 'Notification marked as read',
            data: notification
        });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * PATCH /notifications/read-all
 * Mark all notifications as read for the current user
 */
const markAllAsRead = async (req, res) => {
    try {
        const userId = req.userId;
        const [updatedCount] = await UserNotification.update(
            { is_read: true, read_at: new Date() },
            { where: { user_id: userId, is_read: false } }
        );

        return res.status(200).json({
            status: 'success',
            message: `${updatedCount} notifications marked as read`,
            data: { updatedCount }
        });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * DELETE /notifications/:id
 * Delete a single notification
 */
const deleteNotification = async (req, res) => {
    try {
        const userId = req.userId;
        const notification = await UserNotification.findOne({
            where: { id: req.params.id, user_id: userId }
        });

        if (!notification) {
            return res.status(404).json({ status: 'error', message: 'Notification not found' });
        }

        await notification.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Notification deleted'
        });
    } catch (error) {
        console.error('Error deleting notification:', error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
};

module.exports = {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    listNotifications,
    markNotificationRead,
    markAllNotificationsRead
};
