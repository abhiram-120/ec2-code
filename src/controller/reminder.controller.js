const Users = require('../models/users');
const ReceiveReminder = require('../models/receiveReminder');
const { Op, Sequelize } = require('sequelize');
const admin = require('firebase-admin');
const serviceAccount = require('../../tulkka-firebase-adminsdk-douvv-4b2c75eda1.json');
const { whatsappReminderAddClass } = require('../cronjobs/reminder');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

function loadServiceAccount() {
    const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const defaultPath = path.join(__dirname, '../../tulkka-firebase-adminsdk-douvv-4b2c75eda1.json');
    const resolvedPath = envPath || defaultPath;
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

if (!admin.apps.length) {
    const serviceAccount = loadServiceAccount();
    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
}

function calculateReminderDates(originalDate) {
    // Make sure originalDate is a valid Date object
    if (!(originalDate instanceof Date) || isNaN(originalDate)) {
        throw new Error('Invalid date provided');
    }

    const now = new Date();

    // Calculate reminder dates
    const thirtyMinutesBefore = new Date(originalDate);
    thirtyMinutesBefore.setMinutes(originalDate.getMinutes() - 30);

    const oneHourBefore = new Date(originalDate);
    oneHourBefore.setHours(originalDate.getHours() - 1);

    const fourHoursBefore = new Date(originalDate);
    fourHoursBefore.setHours(originalDate.getHours() - 4);

    const twentyFourHoursBefore = new Date(originalDate);
    twentyFourHoursBefore.setHours(originalDate.getHours() - 24);

    // Ensure dates are not before the current date and time
    const ensureNotBeforeNow = (date) => (date < now ? 'PAST' : date);

    return {
        thirtyMinutesBefore: ensureNotBeforeNow(thirtyMinutesBefore),
        oneHourBefore: ensureNotBeforeNow(oneHourBefore),
        fourHoursBefore: ensureNotBeforeNow(fourHoursBefore),
        twentyFourHoursBefore: ensureNotBeforeNow(twentyFourHoursBefore)
    };
}

const sendPushNotification = async (payload, fcmTokens) => {
    try {
        if (fcmTokens.length === 0) {
            return;
        }

        const notification = {
            notification: payload,
            data: payload,
            tokens: fcmTokens
        };

        const response = await admin.messaging().sendMulticast(notification);

    } catch (err) {
        // console.error('Error sending push notification:', err);
    }
};

// Register new student
async function receiveReminder(req, res) {
    try {
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        // Check if user exists
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        let t1 = req.body.t1;
        let t2 = req.body.t2;

        const existingReminder = await ReceiveReminder.findOne({
            where: { student_id: user.id }
        });

        if (existingReminder) {
            await existingReminder.update({ reminder_time: { a, b } });
            return res.status(200).json({ status: 'success', message: 'Reminder time updated successfully' });
        }

        await ReceiveReminder.create({
            student_id: user.id,
            reminder_time: { t1, t2 }
        });

        return res.status(200).json({ status: 'success', message: 'Reminder time created successfully' });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// add Notification Time
async function addNotificationTime(req, res) {
    try {
        // Find the user
        let user = await Users.findOne({
            where: { id: req.userId }
        });

        // Check if user exists
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const notificationTime = req.body.notificationTime;
        const notificationChannels = req.body.notificationChannels;

        await Users.update({ lesson_notifications: notificationTime, notification_channels: notificationChannels }, { where: { id: user.id }, returning: true, plain: true });

        user = await Users.findOne({
            where: { id: user.id }
        });
        notifiedStudent = {
            'notification_channels': notificationChannels,
            'lesson_notifications': notificationTime
        }

        // In-app notification: settings updated successfully
        try {
            await whatsappReminderAddClass('Notification_settings_updated_success', notifiedStudent, user.id);
        } catch (notifyErr) {
            // Do not block the API if notification fails
            console.error('Error sending Notification_settings_updated_success notification:', notifyErr);
        }
        // Return the response
        return res.status(200).json({
            status: 'success',
            message: 'Notification Reminder time updated',
            data: user
        });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

// Get Notification Time
async function getNotificationTime(req, res) {
    try {
        let user = await Users.findOne({
            attributes: ['lesson_notifications', 'notification_channels'],
            where: { id: req.userId }
        });
        // Check if user exists
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        return res.status(200).json({ status: 'success', message: 'Notification Reminder time', data: user });
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            message: err.message
        });
    }
}

module.exports = {
    sendPushNotification,
    calculateReminderDates,
    receiveReminder,
    addNotificationTime,
    getNotificationTime
};
