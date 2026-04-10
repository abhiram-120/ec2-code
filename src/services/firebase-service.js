// firebase-service.js
const { admin, db, messaging } = require('./firebase-admin');

class FirebaseService {
    /**
     * Resolve collection name per environment.
     * With separate Firestore databases, keep collection names the same.
     */
    collectionName(base) {
        return base;
    }
    /**
     * Send push notification to single device
     * @param {string} registrationToken - FCM token of the device
     * @param {Object} notification - Notification payload
     * @param {Object} data - Optional data payload
     * @param {Object} meta - Optional metadata for logging
     * @param {boolean} [meta.logToFirestore=true] - Set false to suppress Firestore logging
     * @returns {Promise<Object>} - Response from FCM
     */
    async sendNotificationToDevice(registrationToken, notification, data = {}, 
        meta = {}) {
        try {
            if (process.env.NOTIFICATIONS_ENABLED === 'false') {
                const userLabel = meta.userId ? `user ${meta.userId}` : 'user';
                const templateLabel = meta.template ? `, template: ${meta.template}` : '';
                console.log(`[SUPPRESSED] In-app notification for ${userLabel}${templateLabel}`);
                return { success: true, suppressed: true };
            }

            const message = {
                token: registrationToken,
                notification: {
                    title: notification.title,
                    body: notification.body
                },
                // iOS specific configuration (equivalent to apns in PHP)
                apns: {
                    headers: {
                        'apns-priority': '10',
                    },
                    payload: {
                        aps: {
                            alert: {
                                title: notification.title,
                                body: notification.body,
                            },
                            sound: 'default',
                            badge: 1,
                            'content-available': 1,
                            'mutable-content': 1,
                        }
                    }
                },
                // Android specific configuration
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        channel_id: 'default'
                    }
                }
            };

            // Add custom data if provided
            if (Object.keys(data).length > 0) {
                message.data = data;
            }

            const messageId = await messaging.send(message);

            const shouldLog = meta?.logToFirestore !== false;
            if (shouldLog) {
                this.logSuccessToFirestore({
                    messageId,
                    registrationToken,
                    notification,
                    data,
                    meta
                }).catch(err => {
                    console.error('Failed to log notification to Firestore:', err.message);
                });
            }

            return {
                success: true,
                messageId
            };

        } catch (error) {
            console.error('Error sending FCM notification:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send notifications to multiple devices
     * @param {Array<string>} registrationTokens - Array of FCM tokens
     * @param {Object} notification - Notification payload
     * @param {Object} data - Optional data payload
     * @param {Object} meta - Optional metadata for logging
     * @returns {Promise<Array>} - Array of responses
     */
    async sendNotificationToMultipleDevices(registrationTokens, notification, data = {}, meta = {}) {
        const promises = registrationTokens.map(token =>
            this.sendNotificationToDevice(token, notification, data, meta)
        );

        return Promise.allSettled(promises);
    }

    /**
     * Log successful notification to Firestore
     * Only runs after a successful FCM send
     */
    async logSuccessToFirestore({ messageId, registrationToken, notification, data = {}, meta = {} }) {
        await db.collection(this.collectionName('notifications')).add({
            messageId,
            tokenSuffix: registrationToken ? registrationToken.slice(-8) : null,
            title: notification?.title || null,
            body: notification?.body || null,
            data: data || {},
            context: meta.context || {},
            userId: meta.userId ? String(meta.userId) : null,
            userName: meta.userName || null,
            template: meta.template || null,
            languageSent: meta.languageSent || null,
            translations: meta.translations && typeof meta.translations === 'object' ? meta.translations : {},
            channel: meta.channel || 'inapp',
            environment: process.env.NODE_ENV || 'development',
            isRead: false,
            readAt: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    /**
     * Get notifications for a user
     * @param {string|number} userId - User ID
     * @param {number} limit - Max number of notifications
     * @returns {Promise<Array>} - Notifications list
     */
    async getNotifications(userId, options = 20, page = 1) {
        try {
            let limit = 20;
            let pageNum = 1;
            let startAfterId = null;

            if (typeof options === 'object' && options !== null) {
                limit = parseInt(options.limit ?? 20, 10);
                pageNum = parseInt(options.page ?? 1, 10);
                startAfterId = options.startAfter || null;
            } else {
                limit = parseInt(options, 10);
                pageNum = parseInt(page, 10);
            }

            if (!Number.isFinite(limit) || limit <= 0) limit = 20;
            if (!Number.isFinite(pageNum) || pageNum <= 0) pageNum = 1;

            const collection = db.collection(this.collectionName('notifications'));
            let query = collection
                .where('userId', '==', String(userId))
                .orderBy('createdAt', 'desc');

            if (startAfterId) {
                const docSnap = await collection.doc(startAfterId).get();
                if (docSnap.exists) {
                    query = query.startAfter(docSnap);
                }
            } else if (pageNum > 1) {
                query = query.offset((pageNum - 1) * limit);
            }

            const snapshot = await query.limit(limit).get();
            const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const nextCursor = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null;

            const totalSnap = await collection
                .where('userId', '==', String(userId))
                .count()
                .get();
            const total = totalSnap.data().count || 0;

            return { items, nextCursor, total };
        } catch (error) {
            console.error('Error fetching notifications from Firestore:', error);
            return { items: [], nextCursor: null, total: 0 };
        }
    }

    /**
     * Mark a notification as read
     * @param {string} notificationId - Firestore document ID
     * @returns {Promise<boolean>} - Success status
     */
    async markAsRead(notificationId) {
        try {
            await db.collection(this.collectionName('notifications'))
                .doc(notificationId)
                .update({
                    isRead: true,
                    readAt: admin.firestore.FieldValue.serverTimestamp()
                });
            return true;
        } catch (error) {
            console.error('Error marking notification as read:', error);
            return false;
        }
    }

    /**
     * Mark all notifications as read for a user
     * @param {string|number} userId - User ID
     * @returns {Promise<boolean>} - Success status
     */
    async markAllAsRead(userId) {
        try {
            const snapshot = await db.collection(this.collectionName('notifications'))
                .where('userId', '==', String(userId))
                .where('isRead', '==', false)
                .get();

            const batch = db.batch();
            snapshot.docs.forEach(doc => {
                batch.update(doc.ref, {
                    isRead: true,
                    readAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });

            await batch.commit();
            return true;
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
            return false;
        }
    }

    /**
     * Update read status for a list of notifications belonging to a user
     * @param {string|number} userId - User ID
     * @param {Array<{id: string, isRead: boolean}>} notifications - Notifications to update
     * @returns {Promise<{success: boolean, updatedCount: number, skippedIds: Array<string>}>}
     */
    async updateReadStatuses(userId, notifications = []) {
        try {
            if (!Array.isArray(notifications) || notifications.length === 0) {
                return { success: false, updatedCount: 0, skippedIds: [] };
            }

            const collection = db.collection(this.collectionName('notifications'));
            const refs = notifications.map(item => collection.doc(String(item.id)));
            const snapshots = await Promise.all(refs.map(ref => ref.get()));

            const batch = db.batch();
            let updatedCount = 0;
            const skippedIds = [];

            snapshots.forEach((docSnap, index) => {
                const item = notifications[index];

                if (!docSnap.exists || docSnap.data()?.userId !== String(userId)) {
                    skippedIds.push(String(item.id));
                    return;
                }

                batch.update(docSnap.ref, {
                    isRead: item.isRead,
                    readAt: item.isRead ? admin.firestore.FieldValue.serverTimestamp() : null
                });
                updatedCount += 1;
            });

            if (updatedCount === 0) {
                return { success: false, updatedCount, skippedIds };
            }

            await batch.commit();
            return { success: true, updatedCount, skippedIds };
        } catch (error) {
            console.error('Error updating notification read statuses:', error);
            return { success: false, updatedCount: 0, skippedIds: [] };
        }
    }

    /**
     * Get unread notifications count for a user
     * @param {string|number} userId - User ID
     * @returns {Promise<number>}
     */
    async getUnreadCount(userId) {
        try {
            const snapshot = await db.collection(this.collectionName('notifications'))
                .where('userId', '==', String(userId))
                .where('isRead', '==', false)
                .count()
                .get();

            return snapshot.data().count || 0;
        } catch (error) {
            console.error('Error fetching unread notifications count:', error);
            return 0;
        }
    }

    /**
     * Parse FCM token string (handles both single token and JSON array)
     * Equivalent to the token parsing logic in your PHP code
     * @param {string} fcmTokenString - Token string from database
     * @returns {Array<string>} - Array of valid tokens
     */
    parseFcmTokens(fcmTokenString) {
        if (!fcmTokenString) return [];

        try {
            // Check if it's a JSON array
            if (fcmTokenString.startsWith('[')) {
                const tokens = JSON.parse(fcmTokenString);
                return Array.isArray(tokens) ? tokens.filter(token => token && token.trim()) : [];
            } else {
                // Single token
                return [fcmTokenString.trim()];
            }
        } catch (error) {
            console.error('Error parsing FCM tokens:', error);
            return [];
        }
    }
}

module.exports = FirebaseService;
