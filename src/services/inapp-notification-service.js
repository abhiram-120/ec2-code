// inapp-notification-service.js
const FirebaseService = require('./firebase-service');
const NotificationTemplates = require('../helper/notificationTemplates'); // Your existing template helper
const InAppNotificationTemplates = require('../helper/inAppNotificationTemplates'); // If you have this

class InAppNotificationService {
    constructor() {
        this.firebaseService = new FirebaseService();
    }

    /**
     * Send in-app notification to user
     * Equivalent to the sendNotification function in your PHP helper
     * @param {string} template - Template name
     * @param {Object} options - Template options/variables
     * @param {number} userId - User ID
     * @param {Object} user - User object from database
     * @returns {Promise<boolean>} - Success status
     */
    async sendInAppNotification(template, options, userId, user, opts = {}) {
        try {
            console.log(`Preparing InApp notification for user: ${user.full_name} (ID: ${userId})`);
            const { force = false } = opts;
            
            // Check if user has FCM token
            if (!user.fcm_token) {
                console.log(`Failed to send notification (No FCM token): ${user.full_name}`);
                return false;
            }

            // Parse notification preferences (tolerant)
            let notificationOptions = [];
            try {
                notificationOptions = JSON.parse(user.notification_channels || '[]');
            } catch (parseError) {
                console.warn(`Invalid notification_channels JSON for user ${user.full_name}:`, parseError.message);
                notificationOptions = [];
            }
            const inAppEnabled = notificationOptions.includes('inapp') || user.isAdmin;

            if (!inAppEnabled && !force) {
                console.log(`InApp notifications disabled for user: ${user.full_name}`);
                return false;
            }

            // Get notification content based on template
            const language = user.language || 'HE';
            let inAppNotification = null;

            // Check if template supports in-app notifications (same logic as PHP)
            const inAppSupportedTemplates = [
                'booking_done',
                'regular_class_reminders_24',
                'regular_class_reminders_4',
                'regular_class_reminders_1',
                'new_lesson_reminders_30',
                'lesson_started',
                'homework_received',
                'feedback_received',
                'practice_games_ready',
                'regular_class_book_for_teacher',
                'class_booked_success',
                'class_booking_failed',
                'class_cancelled_success',
                'class_cancelled_success_no_teacher',
                'class_cancellation_failed',
                'class_rescheduled_success',
                'class_rescheduling_failed',
                'homework_submitted_success',
                'homework_submitted_success_no_title',
                'homework_submission_failed',
                'homework_deleted_success',
                'homework_deleted_success_no_title',
                'homework_deletion_failed',
                'settings_updated_success',
                'settings_update_failed',
                'file_uploaded_success',
                'file_uploaded_success_no_name',
                'file_upload_failed',
                'student_class_cancelled',
                'Notification_settings_updated_success',

                // Payment/dunning notifications
                'payment_failed',
                'payment_reminder',
                'subscription_canceled_unpaid',

                // Admin/manual notifications
                'inactivity_login_reminder',
                'remaining_lessons_booking_reminder'
            ];

            if (inAppSupportedTemplates.includes(template)) {
                // Use InAppNotificationTemplates if available, otherwise use regular templates
                if (typeof InAppNotificationTemplates !== 'undefined') {
                    inAppNotification = InAppNotificationTemplates.getNotification(template, language, 'email', options);
                } else {
                    inAppNotification = NotificationTemplates.getNotification(template, language, 'email', options);
                }
            }

            if (!inAppNotification) {
                console.log(`No in-app notification template found for: ${template}`);
                return false;
            }

            // Build translations for both EN and HE for storage
            const translations = {};
            const languagesToStore = ['EN', 'HE'];
            for (const lang of languagesToStore) {
                let localized = null;
                if (inAppSupportedTemplates.includes(template)) {
                    if (typeof InAppNotificationTemplates !== 'undefined') {
                        localized = InAppNotificationTemplates.getNotification(template, lang, 'email', options);
                    } else {
                        localized = NotificationTemplates.getNotification(template, lang, 'email', options);
                    }
                }
                if (localized) {
                    translations[lang.toLowerCase()] = {
                        title: localized.title,
                        body: localized.content
                    };
                }
            }

            // Parse FCM tokens (handle both single token and array format)
            const tokenArray = this.firebaseService.parseFcmTokens(user.fcm_token);

            if (tokenArray.length === 0) {
                console.log(`Failed to send notification (Invalid token format): ${user.full_name}`);
                return false;
            }

            console.log(`Sending FCM notification to ${tokenArray.length} device(s) for user: ${user.full_name}`);

            // Send notification to each device
            let successCount = 0;
            let firstSuccess = null;
            for (const token of tokenArray) {
                const result = await this.firebaseService.sendNotificationToDevice(
                    token,
                    {
                        title: inAppNotification.title,
                        body: inAppNotification.content
                    },
                    {},
                    {
                        userId,
                        userName: user.full_name,
                        template,
                        channel: 'inapp',
                        context: options || {},
                        languageSent: language,
                        translations,
                        // Prevent duplicate Firestore documents when user has multiple device tokens.
                        // We'll log only once after we confirm at least one successful send.
                        logToFirestore: false
                    }
                );

                if (result.success) {
                    successCount++;
                    if (!firstSuccess) {
                        firstSuccess = { messageId: result.messageId, registrationToken: token };
                    }
                    console.log(`Notification sent successfully to device for: ${user.full_name}`);
                } else {
                    console.error(`FCM send failed for user ${user.full_name}:`, result.error);
                }
            }

            if (successCount > 0) {
                try {
                    await this.firebaseService.logSuccessToFirestore({
                        messageId: firstSuccess?.messageId || null,
                        registrationToken: firstSuccess?.registrationToken || null,
                        notification: {
                            title: inAppNotification.title,
                            body: inAppNotification.content
                        },
                        data: {},
                        meta: {
                            userId,
                            userName: user.full_name,
                            template,
                            channel: 'inapp',
                            context: options || {},
                            languageSent: language,
                            translations
                        }
                    });
                } catch (logError) {
                    console.error('Failed to log notification once to Firestore:', logError.message);
                }
            }

            return successCount > 0;

        } catch (error) {
            console.error(`FCM request failed for user ${user.full_name} (ID: ${userId}):`, error.message);
            return false;
        }
    }

    /**
     * Send notification to multiple users
     * @param {string} template - Template name
     * @param {Object} options - Template options
     * @param {Array<Object>} users - Array of user objects
     * @returns {Promise<Object>} - Results summary
     */
    async sendBulkInAppNotifications(template, options, users) {
        const results = {
            total: users.length,
            success: 0,
            failed: 0,
            errors: []
        };

        for (const user of users) {
            try {
                const success = await this.sendInAppNotification(template, options, user.id, user);
                if (success) {
                    results.success++;
                } else {
                    results.failed++;
                }
            } catch (error) {
                results.failed++;
                results.errors.push({
                    userId: user.id,
                    userName: user.full_name,
                    error: error.message
                });
            }
        }

        return results;
    }
}

module.exports = InAppNotificationService;
