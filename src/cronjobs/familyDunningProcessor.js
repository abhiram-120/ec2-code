// src/cronjobs/familyDunningProcessor.js
const cron = require('node-cron');
const { Op } = require('sequelize');
const { sequelize } = require('../connection/connection');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

const Family = require('../models/Family');
const FamilyPastDuePayment = require('../models/FamilyPastDuePayment');
const FamilyDunningSchedule = require('../models/FamilyDunningSchedule');
const User = require('../models/users');
const UserSubscriptionDetails = require('../models/UserSubscriptionDetails');
const { sendReminderNotification, sendCancellationNotification } = require('../services/dunningNotificationService');
const { cancelFamilyRecurringPayment } = require('../services/familyPayplus.service');

// Setup logging for family dunning processor
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function logToFile(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logDate = timestamp.split('T')[0];
    const logFile = path.join(logsDir, `family-dunning-processor-${logDate}.log`);
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;

    fs.appendFileSync(logFile, logEntry);

    if (type === 'error') {
        console.error(`[FAMILY_DUNNING] ${message}`);
    } else {
        console.log(`[FAMILY_DUNNING] ${message}`);
    }
}

/**
 * Process family dunning reminders and grace period expiry
 */
const processFamilyDunningSchedules = async () => {
    logToFile('========== FAMILY DUNNING PROCESSOR STARTING ==========');

    let transaction;
    let processedReminders = 0;
    let expiredFamilies = 0;
    let errors = 0;

    try {
        transaction = await sequelize.transaction();

        // Get all active family dunning schedules that need processing
        const now = new Date();
        const activeSchedules = await FamilyDunningSchedule.findAll({
            where: {
                is_enabled: true,
                is_paused: false,
                next_reminder_at: {
                    [Op.lte]: now
                }
            },
            include: [
                {
                    model: FamilyPastDuePayment,
                    as: 'FamilyPastDuePayment',
                    where: { status: 'past_due' },
                    include: [
                        {
                            model: Family,
                            as: 'Family'
                        }
                    ]
                }
            ],
            transaction
        });

        logToFile(`Found ${activeSchedules.length} active family dunning schedules to process`);

        for (const schedule of activeSchedules) {
            try {
                const pastDuePayment = schedule.FamilyPastDuePayment;
                const family = pastDuePayment.Family;

                if (!family) {
                    logToFile(`Skipping schedule ${schedule.id} - no family found`, 'error');
                    continue;
                }

                logToFile(`Processing family dunning for Family ID: ${family.id}, Past Due Payment ID: ${pastDuePayment.id}`);

                // Check if grace period has expired (Day 30)
                const gracePeriodExpired = moment().isAfter(moment(pastDuePayment.grace_period_expires_at));

                if (gracePeriodExpired) {
                    logToFile(`Grace period expired for family ${family.id} - marking past due as canceled`);

                    await handleFamilyGracePeriodExpiry({
                        family,
                        past_due_payment: pastDuePayment,
                        dunning_schedule: schedule
                    }, transaction);

                    expiredFamilies++;
                } else {
                    // Send reminder if still within grace period
                    const daysRemaining = moment(pastDuePayment.grace_period_expires_at).diff(moment(), 'days');
                    logToFile(`Sending reminder to family ${family.id} - ${daysRemaining} days remaining`);

                    await sendFamilyScheduledReminder({
                        family,
                        past_due_payment: pastDuePayment,
                        dunning_schedule: schedule,
                        days_remaining: daysRemaining
                    }, transaction);

                    processedReminders++;
                }
            } catch (scheduleError) {
                logToFile(`Error processing family schedule ${schedule.id}: ${scheduleError.message}`, 'error');
                errors++;
                continue;
            }
        }

        // Cleanup resolved schedules
        await cleanupFamilyResolvedSchedules(transaction);

        await transaction.commit();

        logToFile('========== FAMILY DUNNING PROCESSOR COMPLETED ==========');
        logToFile(`Results: ${processedReminders} reminders sent, ${expiredFamilies} families marked canceled, ${errors} errors`);

    } catch (error) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                logToFile(`Error rolling back family transaction: ${rollbackError.message}`, 'error');
            }
        }

        logToFile(`Critical error in family dunning processor: ${error.message}`, 'error');
    }
};

/**
 * Send scheduled reminder to family
 */
const sendFamilyScheduledReminder = async (params, transaction) => {
    try {
        const { family, past_due_payment, dunning_schedule, days_remaining } = params;

        // Check if family reminders are paused until a specific date
        if (dunning_schedule.paused_until && moment().isBefore(moment(dunning_schedule.paused_until))) {
            logToFile(`Family ${family.id} reminders paused until ${dunning_schedule.paused_until}`);
            
            const reminderTime = dunning_schedule.reminder_time || '10:00:00';
            const [hours, minutes] = reminderTime.split(':').map(Number);
            const familyTimezone = dunning_schedule.timezone || 'Asia/Jerusalem';
            
            const nextReminderAt = moment(dunning_schedule.paused_until).tz(familyTimezone).add(1, 'day')
                .hour(hours).minute(minutes).second(0).toDate();

            await dunning_schedule.update({
                next_reminder_at: nextReminderAt
            }, { transaction });

            return;
        }

        // Build a user-like object for notification service
        const userLike = {
            id: family.id,
            full_name: family.parent_name,
            email: family.parent_email,
            mobile: family.parent_phone,
            country_code: family.parent_country_code || '+972',
            language: 'EN'
        };

        const notificationResult = await sendReminderNotification({
            user: userLike,
            past_due_payment,
            dunning_schedule,
            payment_link: past_due_payment.payment_link,
            days_remaining
        });

        // Update dunning schedule
        const updateData = {
            last_reminder_sent_at: new Date(),
            total_reminders_sent: dunning_schedule.total_reminders_sent + 1
        };

        await scheduleFamilyNextReminder(dunning_schedule, dunning_schedule.timezone || 'Asia/Jerusalem', transaction, updateData);

        // Update past due payment
        await past_due_payment.update({
            last_reminder_sent_at: new Date(),
            total_reminders_sent: past_due_payment.total_reminders_sent + 1
        }, { transaction });

        logToFile(`Reminder sent to family ${family.id} - total reminders: ${dunning_schedule.total_reminders_sent + 1}`);

        return notificationResult;
    } catch (error) {
        logToFile(`Error in sendFamilyScheduledReminder: ${error.message}`, 'error');
        throw error;
    }
};

/**
 * Handle grace period expiry for family - cancel all child subscriptions and PayPlus recurring payment
 */
const handleFamilyGracePeriodExpiry = async (params, transaction) => {
    try {
        const { family, past_due_payment, dunning_schedule } = params;

        logToFile(`Handling family grace period expiry for family ${family.id}`);

        const userLike = {
            id: family.id,
            full_name: family.parent_name,
            email: family.parent_email,
            mobile: family.parent_phone,
            country_code: family.parent_country_code || '+972',
            language: 'EN'
        };

        // Parse student_ids and subscription_ids from past_due_payment
        let studentIds = [];
        let subscriptionIds = [];

        try {
            if (past_due_payment.student_ids) {
                studentIds = typeof past_due_payment.student_ids === 'string' 
                    ? JSON.parse(past_due_payment.student_ids) 
                    : past_due_payment.student_ids;
                if (!Array.isArray(studentIds)) {
                    studentIds = [];
                }
            }

            if (past_due_payment.subscription_ids) {
                subscriptionIds = typeof past_due_payment.subscription_ids === 'string'
                    ? JSON.parse(past_due_payment.subscription_ids)
                    : past_due_payment.subscription_ids;
                if (!Array.isArray(subscriptionIds)) {
                    subscriptionIds = [];
                }
            }
        } catch (parseError) {
            logToFile(`Error parsing student_ids/subscription_ids for family ${family.id}: ${parseError.message}`, 'error');
        }

        logToFile(`Found ${studentIds.length} student IDs and ${subscriptionIds.length} subscription IDs to cancel for family ${family.id}`);

        // Cancel all child subscriptions
        let canceledSubscriptionsCount = 0;
        let canceledUsersCount = 0;

        if (subscriptionIds.length > 0) {
            // Cancel all subscriptions
            const subscriptionsToCancel = await UserSubscriptionDetails.findAll({
                where: {
                    id: { [Op.in]: subscriptionIds },
                    status: { [Op.in]: ['active', 'inactive'] }
                },
                transaction
            });

            for (const subscription of subscriptionsToCancel) {
                try {
                    await subscription.update({
                        status: 'inactive',
                        is_cancel: 1,
                        cancellation_date: new Date(),
                        cancellation_reason_category: 'payment_issues',
                        cancellation_reason: 'Subscription canceled due to failed family payment after 30-day grace period',
                        cancelled_by_user_id: null, // System cancellation
                        updated_at: new Date()
                    }, { transaction });

                    canceledSubscriptionsCount++;
                    logToFile(`Canceled subscription ${subscription.id} for student ${subscription.student_id}`);
                } catch (subError) {
                    logToFile(`Error canceling subscription ${subscription.id}: ${subError.message}`, 'error');
                }
            }
        }

        // Update all affected users to clear subscription info
        if (studentIds.length > 0) {
            try {
                const updateResult = await User.update({
                    subscription_id: null,
                    subscription_type: null,
                    trial_expired: true,
                    updated_at: Math.floor(Date.now() / 1000)
                }, {
                    where: { id: { [Op.in]: studentIds } },
                    transaction
                });

                canceledUsersCount = updateResult[0] || 0;
                logToFile(`Updated ${canceledUsersCount} users to clear subscription info for family ${family.id}`);
            } catch (userUpdateError) {
                logToFile(`Error updating users for family ${family.id}: ${userUpdateError.message}`, 'error');
            }
        }

        // Cancel PayPlus recurring payment
        try {
            if (
                past_due_payment.recurring_payment_uid &&
                past_due_payment.recurring_payment_uid !== 'undefined' &&
                past_due_payment.recurring_payment_uid !== '' &&
                past_due_payment.recurring_payment_uid !== 'N/A'
            ) {
                const cancelled = await cancelFamilyRecurringPayment(past_due_payment.recurring_payment_uid);
                logToFile(
                    `✅ PayPlus recurring cancellation for family ${family.id} (uid=${past_due_payment.recurring_payment_uid}) result: ${cancelled}`,
                    cancelled ? 'info' : 'error'
                );
            } else {
                logToFile(`No valid recurring_payment_uid for family past due payment ${past_due_payment.id} - skipping PayPlus cancel`);
            }
        } catch (recurringError) {
            logToFile(
                `❌ Error cancelling PayPlus recurring payment for family ${family.id} (uid=${past_due_payment.recurring_payment_uid}): ${recurringError.message}`,
                'error'
            );
            // Do not throw - we still want to mark the past due as canceled locally
        }

        // Mark past due payment as canceled in our DB
        await past_due_payment.update({
            status: 'canceled',
            canceled_at: new Date(),
            cancellation_reason_category: 'payment_issues',
            cancellation_reason: 'Family payment not recovered within grace period - all child subscriptions canceled',
            notes: `${past_due_payment.notes || ''}\n[${new Date().toISOString()}] Grace period expired - ${canceledSubscriptionsCount} subscriptions canceled, ${canceledUsersCount} users updated, PayPlus recurring payment canceled`
        }, { transaction });

        // Disable dunning schedule
        await dunning_schedule.update({
            is_enabled: false,
            next_reminder_at: null,
            updated_at: new Date()
        }, { transaction });

        // Send final cancellation notification (reusing student template, but with family parent data)
        await sendCancellationNotification({
            user: userLike,
            past_due_payment,
            subscription: { type: 'Family Subscription' }
        });

        logToFile(`✅ Family ${family.id} grace period expired - ${canceledSubscriptionsCount} subscriptions canceled, ${canceledUsersCount} users updated, PayPlus recurring payment canceled`);

    } catch (error) {
        logToFile(`Error in handleFamilyGracePeriodExpiry: ${error.message}`, 'error');
        throw error;
    }
};

/**
 * Schedule next reminder for family based on frequency and timezone
 */
const scheduleFamilyNextReminder = async (dunningSchedule, familyTimezone, transaction, updateData = {}) => {
    try {
        const timezone = familyTimezone || 'Asia/Jerusalem';
        const reminderTime = dunningSchedule.reminder_time || '10:00:00';
        const [hours, minutes] = reminderTime.split(':').map(Number);

        let nextReminderAt;

        switch (dunningSchedule.reminder_frequency) {
            case 'every_2_days':
                nextReminderAt = moment().tz(timezone).add(2, 'days')
                    .hour(hours).minute(minutes).second(0).toDate();
                break;
            case 'weekly':
                nextReminderAt = moment().tz(timezone).add(7, 'days')
                    .hour(hours).minute(minutes).second(0).toDate();
                break;
            case 'daily':
            default:
                nextReminderAt = moment().tz(timezone).add(1, 'day')
                    .hour(hours).minute(minutes).second(0).toDate();
                break;
        }

        await dunningSchedule.update({
            ...updateData,
            next_reminder_at: nextReminderAt
        }, { transaction });

        logToFile(`Next family reminder scheduled for ${nextReminderAt} (${timezone})`);
    } catch (error) {
        logToFile(`Error scheduling next family reminder: ${error.message}`, 'error');
        throw error;
    }
};

/**
 * Cleanup family dunning schedules for resolved payments
 */
const cleanupFamilyResolvedSchedules = async (transaction) => {
    try {
        // Find schedules with resolved/canceled family past due payments
        const resolvedScheduleIds = await FamilyDunningSchedule.findAll({
            attributes: ['id'],
            include: [{
                model: FamilyPastDuePayment,
                as: 'FamilyPastDuePayment',
                where: { 
                    status: { [Op.in]: ['resolved', 'canceled'] }
                },
                attributes: []
            }],
            transaction
        });

        if (resolvedScheduleIds.length > 0) {
            const idsToUpdate = resolvedScheduleIds.map(s => s.id);
            
            await FamilyDunningSchedule.update(
                {
                    is_enabled: false,
                    next_reminder_at: null,
                    updated_at: new Date()
                },
                {
                    where: { id: { [Op.in]: idsToUpdate } },
                    transaction
                }
            );

            logToFile(`Cleaned up ${resolvedScheduleIds.length} resolved family dunning schedules`);
        }

    } catch (error) {
        logToFile(`Error in cleanupFamilyResolvedSchedules: ${error.message}`, 'error');
        // Don't throw - this is cleanup and shouldn't break main processing
    }
};

// Schedule the cron job to run daily at 9:00 AM (slightly after main dunning)
cron.schedule('0 9 * * *', async () => {
    logToFile('Family dunning processor cron job triggered (daily 9:00 AM)');
    await processFamilyDunningSchedules();
}, {
    scheduled: true,
    timezone: 'Asia/Jerusalem'
});

// Backup job every 4 hours to catch missed reminders for families
cron.schedule('0 */4 * * *', async () => {
    logToFile('Family dunning processor backup check triggered (every 4 hours)');
    await processFamilyDunningSchedules();
}, {
    scheduled: true,
    timezone: 'Asia/Jerusalem'
});

module.exports = {
    processFamilyDunningSchedules,
    cleanupFamilyResolvedSchedules
};


