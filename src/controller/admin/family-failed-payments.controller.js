// controller/admin/family-failed-payments.controller.js
const { Op, Sequelize } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const moment = require('moment-timezone');
const axios = require('axios');

// Models
const FamilyPastDuePayment = require('../../models/FamilyPastDuePayment');
const FamilyDunningSchedule = require('../../models/FamilyDunningSchedule');
const { Family, FamilyPaymentTransaction, FamilyChild } = require('../../models/Family');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const RecurringPayment = require('../../models/RecurringPayment');
const User = require('../../models/users');
const Class = require('../../models/classes');
const { paymentLogger } = require('../../utils/paymentLogger');
const { sendReminderNotification } = require('../../services/dunningNotificationService');
const { whatsappReminderTrailClass } = require('../../cronjobs/reminder');
const {
    addCardToken,
    listCustomerTokens,
    updateFamilyRecurringPayment,
    getRecurringPaymentDetails
} = require('../../services/paymentRecoveryService');
const { cancelFamilyRecurringPayment } = require('../../services/familyPayplus.service');

/**
 * Get family failed payments overview with key metrics
 */
const getFamilyFailedPaymentsOverview = async (req, res) => {
    try {
        const now = new Date();

        const { date_from, date_to } = req.query;

        const rangeFilterCreated = {};
        const rangeFilterResolved = {};
        const rangeFilterCanceled = {};

        if (date_from) {
            const from = new Date(date_from);
            if (!isNaN(from.getTime())) {
                rangeFilterCreated[Op.gte] = from;
                rangeFilterResolved[Op.gte] = from;
                rangeFilterCanceled[Op.gte] = from;
            }
        }
        if (date_to) {
            const to = new Date(date_to);
            if (!isNaN(to.getTime())) {
                to.setHours(23, 59, 59, 999);
                rangeFilterCreated[Op.lte] = to;
                rangeFilterResolved[Op.lte] = to;
                rangeFilterCanceled[Op.lte] = to;
            }
        }

        const pastDueCount = await FamilyPastDuePayment.count({
            where: {
                status: 'past_due',
                grace_period_expires_at: { [Op.gt]: now },
                ...(Object.keys(rangeFilterCreated).length ? { failed_at: rangeFilterCreated } : {})
            }
        });

        const pastDuePayments = await FamilyPastDuePayment.findAll({
            where: {
                status: 'past_due',
                grace_period_expires_at: { [Op.gt]: now },
                ...(Object.keys(rangeFilterCreated).length ? { failed_at: rangeFilterCreated } : {})
            },
            attributes: ['amount', 'currency']
        });

        const amountAtRisk = pastDuePayments.reduce((total, payment) => {
            const paymentAmount = parseFloat(payment.amount) || 0;
            const amountInILS = payment.currency === 'ILS' ? paymentAmount : paymentAmount * 3.7;
            return parseFloat(total) + amountInILS;
        }, 0);

        let createdRange = rangeFilterCreated;
        let resolvedRange = rangeFilterResolved;
        if (!date_from && !date_to) {
            const thirtyDaysAgo = moment().subtract(30, 'days').toDate();
            createdRange = { [Op.gte]: thirtyDaysAgo };
            resolvedRange = { [Op.gte]: thirtyDaysAgo };
        }

        const totalFailed = await FamilyPastDuePayment.count({ where: { created_at: createdRange } });
        const totalResolved = await FamilyPastDuePayment.count({ where: { status: 'resolved', resolved_at: resolvedRange } });
        const recoveryRate = totalFailed > 0 ? ((totalResolved / totalFailed) * 100).toFixed(1) : 0;

        const collectionsUnpaid = await FamilyPastDuePayment.count({
            where: { status: 'canceled', ...(Object.keys(rangeFilterCanceled).length ? { canceled_at: rangeFilterCanceled } : {}) }
        });

        const collectionsPaid = await FamilyPastDuePayment.count({
            where: { status: 'resolved', ...(Object.keys(resolvedRange).length ? { resolved_at: resolvedRange } : {}) }
        });

        const sevenDaysFromNow = moment().add(7, 'days').toDate();
        const expiringSoonCount = await FamilyPastDuePayment.count({
            where: {
                status: 'past_due',
                grace_period_expires_at: { [Op.between]: [now, sevenDaysFromNow] }
            }
        });

        const activeRemindersCount = await FamilyDunningSchedule.count({
            where: { is_enabled: true, is_paused: false },
            include: [{
                model: FamilyPastDuePayment,
                as: 'FamilyPastDuePayment',
                required: true,
                where: { status: 'past_due' }
            }]
        });

        const formattedAmountAtRisk = parseFloat(amountAtRisk).toFixed(2);

        return res.status(200).json({
            status: 'success',
            data: {
                pastDue: { count: pastDueCount },
                amountAtRisk: { amount: formattedAmountAtRisk, currency: 'ILS' },
                recoveryRate: { rate: `${recoveryRate}%`, numerator: totalResolved, denominator: totalFailed },
                collectionsPaid: { count: collectionsPaid },
                collectionsUnpaid: { count: collectionsUnpaid },
                expiringSoon: { count: expiringSoonCount },
                activeReminders: { count: activeRemindersCount }
            },
            message: 'Family failed payments overview retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting family failed payments overview:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get family failed payments list with filtering and pagination
 */
const getFamilyFailedPaymentsList = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            status = 'past_due',
            grace_period_status,
            reminder_status,
            search,
            currency,
            amount_min,
            amount_max,
            amount_range,
            date_from,
            date_to,
            days_remaining
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        const whereConditions = {};
        
        if (status) {
            whereConditions.status = status;
        }

        if (currency) {
            whereConditions.currency = currency;
        }

        // Map amount_range buckets to numeric min/max if provided
        let effectiveMin = amount_min;
        let effectiveMax = amount_max;
        if (amount_range) {
            switch (amount_range) {
                case '0-100':
                    effectiveMin = 0;
                    effectiveMax = 100;
                    break;
                case '100-500':
                    effectiveMin = 100;
                    effectiveMax = 500;
                    break;
                case '500-1000':
                    effectiveMin = 500;
                    effectiveMax = 1000;
                    break;
                case '1000+':
                    effectiveMin = 1000;
                    effectiveMax = null;
                    break;
                default:
                    break;
            }
        }

        if (effectiveMin !== undefined && effectiveMin !== null && !isNaN(effectiveMin)) {
            whereConditions.amount = { [Op.gte]: parseFloat(effectiveMin) };
        }

        if (effectiveMax !== undefined && effectiveMax !== null && !isNaN(effectiveMax)) {
            whereConditions.amount = { 
                ...(whereConditions.amount || {}),
                [Op.lte]: parseFloat(effectiveMax) 
            };
        }

        if (date_from || date_to) {
            whereConditions.failed_at = {};
            if (date_from) {
                const fromDate = new Date(date_from);
                if (!isNaN(fromDate.getTime())) {
                    whereConditions.failed_at[Op.gte] = fromDate;
                }
            }
            if (date_to) {
                const toDate = new Date(date_to);
                if (!isNaN(toDate.getTime())) {
                    toDate.setHours(23, 59, 59, 999);
                    whereConditions.failed_at[Op.lte] = toDate;
                }
            }
        }

        const now = new Date();
        const today = moment();

        // Days remaining bucket filter (takes precedence if provided)
        if (days_remaining && days_remaining !== 'all') {
            let start = null;
            let end = null;

            if (days_remaining === '1-7') {
                start = today.toDate();
                end = moment().add(7, 'days').toDate();
            } else if (days_remaining === '8-15') {
                start = moment().add(8, 'days').toDate();
                end = moment().add(15, 'days').toDate();
            } else if (days_remaining === '16-30') {
                start = moment().add(16, 'days').toDate();
                end = moment().add(30, 'days').toDate();
            } else if (days_remaining === 'expired') {
                whereConditions.grace_period_expires_at = { [Op.lte]: now };
            }

            if (start && end) {
                whereConditions.grace_period_expires_at = {
                    [Op.between]: [start, end]
                };
            }
        } else if (grace_period_status) {
            // Backwards-compatible grace_period_status handling
            if (grace_period_status === 'expiring_soon') {
                const sevenDaysFromNow = moment().add(7, 'days').toDate();
                whereConditions.grace_period_expires_at = {
                    [Op.between]: [now, sevenDaysFromNow]
                };
            } else if (grace_period_status === 'expired') {
                whereConditions.grace_period_expires_at = { [Op.lte]: now };
            } else if (grace_period_status === 'normal') {
                const sevenDaysFromNow = moment().add(7, 'days').toDate();
                whereConditions.grace_period_expires_at = { [Op.gt]: sevenDaysFromNow };
            }
        }

        const familyInclude = {
            model: Family,
            as: 'Family',
            attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code', 'status'],
            required: false
        };

        if (search && search.trim()) {
            const term = `%${search.trim()}%`;
            familyInclude.where = {
                [Op.or]: [
                    { parent_name: { [Op.like]: term } },
                    { parent_email: { [Op.like]: term } },
                    { parent_phone: { [Op.like]: term } }
                ]
            };
            familyInclude.required = true;
        }

        const includeOptions = [familyInclude];

        // Include dunning schedule
        includeOptions.push({
            model: FamilyDunningSchedule,
            as: 'DunningSchedule',
            required: false,
            attributes: ['id', 'is_enabled', 'is_paused', 'next_reminder_at', 'total_reminders_sent', 'last_reminder_sent_at']
        });

        // Filter by reminder status if provided.
        // Important rule: expired payments should be treated as "disabled" for reminders.
        if (reminder_status) {
            const dunningWhere = {};
            if (reminder_status === 'enabled') {
                dunningWhere.is_enabled = true;
                dunningWhere.is_paused = false;
                // Only non-expired can be enabled
                whereConditions.grace_period_expires_at = {
                    ...(whereConditions.grace_period_expires_at || {}),
                    [Op.gt]: now
                };
            } else if (reminder_status === 'paused') {
                dunningWhere.is_paused = true;
                // Only non-expired can be paused
                whereConditions.grace_period_expires_at = {
                    ...(whereConditions.grace_period_expires_at || {}),
                    [Op.gt]: now
                };
            } else if (reminder_status === 'disabled') {
                // For disabled, we want payments without dunning schedules or with disabled schedules
                // This is handled differently - we'll filter after the query
            }
            
            if (Object.keys(dunningWhere).length > 0) {
                const dunningInclude = includeOptions.find(inc => inc.as === 'DunningSchedule');
                if (dunningInclude) {
                    dunningInclude.where = dunningWhere;
                    dunningInclude.required = reminder_status !== 'disabled';
                }
            }
        }

        const { count, rows } = await FamilyPastDuePayment.findAndCountAll({
            where: whereConditions,
            include: includeOptions,
            limit: parseInt(limit),
            offset: offset,
            order: [['failed_at', 'DESC']],
            distinct: true
        });

        // Format the response
        const formattedPaymentsAll = rows.map(payment => {
            const graceExpiry = moment(payment.grace_period_expires_at);
            const isExpired = graceExpiry.isSameOrBefore(moment());
            const daysRemaining = isExpired ? 0 : Math.max(0, Math.ceil(graceExpiry.diff(moment(), 'days', true)));

            let gracePeriodStatus = 'normal';
            if (isExpired) {
                gracePeriodStatus = 'expired';
            } else if (daysRemaining <= 7) {
                gracePeriodStatus = 'expiring_soon';
            }

            return {
                id: payment.id,
                family_id: payment.family_id,
                amount: parseFloat(payment.amount),
                currency: payment.currency,
                failed_at: payment.failed_at,
                due_date: payment.due_date,
                grace_period_days: payment.grace_period_days,
                grace_period_expires_at: payment.grace_period_expires_at,
                status: payment.status,
                attempt_number: payment.attempt_number,
                last_reminder_sent_at: payment.last_reminder_sent_at,
                total_reminders_sent: payment.total_reminders_sent,
                whatsapp_messages_sent: payment.whatsapp_messages_sent,
                payment_link: payment.payment_link,
                resolved_at: payment.resolved_at,
                canceled_at: payment.canceled_at,
                failure_status_code: payment.failure_status_code,
                failure_message_description: payment.failure_message_description,
                children_count: payment.children_count,
                days_remaining: daysRemaining,
                grace_period_status: gracePeriodStatus,
                Family: payment.Family,
                // If payment expired, treat reminders as disabled in UI even if schedule exists.
                DunningSchedule: payment.DunningSchedule ? {
                    id: payment.DunningSchedule.id,
                    is_enabled: isExpired ? false : payment.DunningSchedule.is_enabled,
                    is_paused: payment.DunningSchedule.is_paused,
                    next_reminder_at: payment.DunningSchedule.next_reminder_at,
                    total_reminders_sent: payment.DunningSchedule.total_reminders_sent,
                    last_reminder_sent_at: payment.DunningSchedule.last_reminder_sent_at
                } : null
            };
        });

        // If filtering by "disabled", include:
        // - expired payments OR
        // - payments with no schedule OR schedule not enabled
        const formattedPayments =
            reminder_status === 'disabled'
                ? formattedPaymentsAll.filter((p) => {
                    const expired = p.grace_period_status === 'expired' || p.days_remaining === 0;
                    const scheduleEnabled = p.DunningSchedule?.is_enabled === true;
                    return expired || !scheduleEnabled;
                })
                : formattedPaymentsAll;

        return res.status(200).json({
            status: 'success',
            data: formattedPayments,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / parseInt(limit))
            },
            message: 'Family failed payments list retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting family failed payments list:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get family collections list (canceled after grace period)
 */
const getFamilyCollectionsList = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search,
            status, // 'paid' | 'unpaid' | undefined
            date_from,
            date_to,
            amount_min,
            amount_max,
            amount_range
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        const whereConditions = {};

        // Map high-level status filter to underlying FamilyPastDuePayment.status
        // - paid    -> resolved
        // - unpaid  -> canceled
        // - default -> both resolved + canceled
        if (status === 'paid') {
            whereConditions.status = 'resolved';
        } else if (status === 'unpaid') {
            whereConditions.status = 'canceled';
        } else {
            whereConditions.status = { [Op.in]: ['resolved', 'canceled'] };
        }

        // Amount range filter (shared buckets with past-due list)
        let collectionsEffectiveMin = amount_min;
        let collectionsEffectiveMax = amount_max;

        if (amount_range) {
            switch (amount_range) {
                case '0-100':
                    collectionsEffectiveMin = 0;
                    collectionsEffectiveMax = 100;
                    break;
                case '100-500':
                    collectionsEffectiveMin = 100;
                    collectionsEffectiveMax = 500;
                    break;
                case '500-1000':
                    collectionsEffectiveMin = 500;
                    collectionsEffectiveMax = 1000;
                    break;
                case '1000+':
                    collectionsEffectiveMin = 1000;
                    collectionsEffectiveMax = null;
                    break;
                default:
                    break;
            }
        }

        if (collectionsEffectiveMin !== undefined && collectionsEffectiveMin !== null && !isNaN(collectionsEffectiveMin)) {
            whereConditions.amount = { [Op.gte]: parseFloat(collectionsEffectiveMin) };
        }

        if (collectionsEffectiveMax !== undefined && collectionsEffectiveMax !== null && !isNaN(collectionsEffectiveMax)) {
            whereConditions.amount = {
                ...(whereConditions.amount || {}),
                [Op.lte]: parseFloat(collectionsEffectiveMax)
            };
        }

        // Date filter: use resolved_at for paid (resolved), canceled_at for unpaid (canceled),
        // and failed_at when mixing both.
        if (date_from || date_to) {
            const fromDate = date_from ? new Date(date_from) : null;
            const toDateRaw = date_to ? new Date(date_to) : null;
            const toDate = toDateRaw && !isNaN(toDateRaw.getTime())
                ? new Date(toDateRaw.setHours(23, 59, 59, 999))
                : null;

            const buildRange = () => {
                const range = {};
                if (fromDate && !isNaN(fromDate.getTime())) {
                    range[Op.gte] = fromDate;
                }
                if (toDate) {
                    range[Op.lte] = toDate;
                }
                return range;
            };

            if (status === 'paid') {
                whereConditions.resolved_at = buildRange();
            } else if (status === 'unpaid') {
                whereConditions.canceled_at = buildRange();
            } else {
                whereConditions.failed_at = buildRange();
            }
        }

        const familyInclude = {
            model: Family,
            as: 'Family',
            attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code'],
            required: false
        };

        if (search && search.trim()) {
            const term = `%${search.trim()}%`;
            familyInclude.where = {
                [Op.or]: [
                    { parent_name: { [Op.like]: term } },
                    { parent_email: { [Op.like]: term } },
                    { parent_phone: { [Op.like]: term } }
                ]
            };
            familyInclude.required = true;
        }

        // Include dunning schedule for reminder data
        const includeOptions = [familyInclude];
        includeOptions.push({
            model: FamilyDunningSchedule,
            as: 'DunningSchedule',
            required: false,
            attributes: ['id', 'total_reminders_sent', 'last_reminder_sent_at']
        });

        const { count, rows } = await FamilyPastDuePayment.findAndCountAll({
            where: whereConditions,
            include: includeOptions,
            limit: parseInt(limit),
            offset: offset,
            order: [['canceled_at', 'DESC']],
            distinct: true
        });

        const formattedCollections = rows.map(payment => {
            // Use failed_at to compute "days since failure"
            const failedDate = payment.failed_at ? moment(payment.failed_at) : moment();
            const daysSinceFailure = Math.ceil(moment().diff(failedDate, 'days', true));

            // For paid collections, use resolved_at as the effective "canceled" date for display
            const effectiveDate = payment.status === 'resolved'
                ? payment.resolved_at
                : payment.canceled_at;

            // Get reminder data from dunning schedule or fallback to payment fields
            const reminderData = payment.DunningSchedule ? {
                total_sent: payment.DunningSchedule.total_reminders_sent || payment.total_reminders_sent || 0,
                last_sent: payment.DunningSchedule.last_reminder_sent_at || payment.last_reminder_sent_at || null
            } : {
                total_sent: payment.total_reminders_sent || 0,
                last_sent: payment.last_reminder_sent_at || null
            };

            // Determine subscription status and source
            let subscriptionAction = null;
            let paymentSource = null;
            
            if (payment.status === 'resolved') {
                subscriptionAction = {
                    label: 'Recovered Successfully',
                    color: 'green'
                };
                // Try to determine source from resolved transaction if available
                // This would need to be enhanced if we have transaction data
            } else if (payment.status === 'canceled') {
                subscriptionAction = {
                    label: 'Cancelled by system',
                    color: 'red'
                };
            } else {
                subscriptionAction = {
                    label: 'Still Pending',
                    color: 'gray'
                };
            }

            return {
                id: payment.id,
                family: payment.Family ? {
                    id: payment.Family.id,
                    name: payment.Family.parent_name,
                    email: payment.Family.parent_email,
                    phone: payment.Family.parent_phone
                } : null,
                amount_due: parseFloat(payment.amount).toFixed(2),
                currency: payment.currency,
                days_since_failure: daysSinceFailure,
                payment_status: payment.status === 'resolved' ? 'paid' : 'unpaid',
                grace_expires_at: payment.grace_period_expires_at,
                canceled_at: effectiveDate,
                cancellation_reason: payment.cancellation_reason,
                children_count: payment.children_count,
                reminders: reminderData,
                subscription_action: subscriptionAction,
                payment_source: paymentSource,
                payment_date: payment.failed_at
            };
        });

        return res.status(200).json({
            status: 'success',
            data: formattedCollections,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / parseInt(limit))
            },
            message: 'Family collections list retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting family collections list:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get specific family failed payment details by ID
 */
const getFamilyFailedPaymentDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const payment = await FamilyPastDuePayment.findByPk(id, {
            include: [
                {
                    model: Family,
                    as: 'Family',
                    attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code', 'status']
                },
                {
                    model: FamilyDunningSchedule,
                    as: 'DunningSchedule',
                    required: false
                },
                {
                    model: FamilyPaymentTransaction,
                    as: 'FamilyPaymentTransaction',
                    required: false,
                    attributes: ['id', 'transaction_token', 'amount', 'currency', 'status', 'created_at']
                }
            ]
        });

        if (!payment) {
            return res.status(404).json({
                status: 'error',
                message: 'Family failed payment not found'
            });
        }

        const graceExpiry = moment(payment.grace_period_expires_at);
        const daysRemaining = Math.max(0, Math.ceil(graceExpiry.diff(moment(), 'days', true)));
        const isExpired = daysRemaining === 0 && graceExpiry.isBefore(moment());

        return res.status(200).json({
            status: 'success',
            data: {
                ...payment.toJSON(),
                days_remaining: daysRemaining,
                is_expired: isExpired
            },
            message: 'Family failed payment details retrieved successfully'
        });

    } catch (error) {
        console.error('Error getting family failed payment details:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

// Dunning schedule endpoints
const getFamilyDunningSchedule = async (req, res) => {
    try {
        const { id } = req.params;

        const pastDuePayment = await FamilyPastDuePayment.findByPk(id, {
            include: [
                {
                    model: Family,
                    as: 'Family',
                    attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code', 'status']
                },
                {
                    model: FamilyDunningSchedule,
                    as: 'DunningSchedule'
                }
            ]
        });

        if (!pastDuePayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Family past due payment not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: pastDuePayment.DunningSchedule || null,
            message: 'Family dunning schedule retrieved successfully'
        });
    } catch (error) {
        console.error('Error getting family dunning schedule:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const pauseFamilyDunningReminders = async (req, res) => {
    try {
        const { id } = req.params; // past_due_payment_id
        const { paused_until, paused_reason } = req.body || {};

        const dunningSchedule = await FamilyDunningSchedule.findOne({
            where: { family_past_due_payment_id: id }
        });

        if (!dunningSchedule) {
            return res.status(404).json({
                status: 'error',
                message: 'Family dunning schedule not found'
            });
        }

        let pauseUntilDate = null;
        if (paused_until) {
            const parsed = new Date(paused_until);
            if (!isNaN(parsed.getTime())) {
                pauseUntilDate = parsed;
            }
        }

        await dunningSchedule.update({
            is_paused: true,
            is_enabled: true,
            paused_until: pauseUntilDate,
            paused_reason: paused_reason || 'Paused by admin',
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            data: dunningSchedule,
            message: 'Family dunning reminders paused successfully'
        });
    } catch (error) {
        console.error('Error pausing family dunning reminders:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const resumeFamilyDunningReminders = async (req, res) => {
    try {
        const { id } = req.params; // past_due_payment_id

        const dunningSchedule = await FamilyDunningSchedule.findOne({
            where: { family_past_due_payment_id: id }
        });

        if (!dunningSchedule) {
            return res.status(404).json({
                status: 'error',
                message: 'Family dunning schedule not found'
            });
        }

        await dunningSchedule.update({
            is_paused: false,
            is_enabled: true,
            paused_until: null,
            paused_reason: null,
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            data: dunningSchedule,
            message: 'Family dunning reminders resumed successfully'
        });
    } catch (error) {
        console.error('Error resuming family dunning reminders:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const disableFamilyDunningReminders = async (req, res) => {
    try {
        const { id } = req.params; // past_due_payment_id

        const dunningSchedule = await FamilyDunningSchedule.findOne({
            where: { family_past_due_payment_id: id }
        });

        if (!dunningSchedule) {
            return res.status(404).json({
                status: 'error',
                message: 'Family dunning schedule not found'
            });
        }

        await dunningSchedule.update({
            is_enabled: false,
            is_paused: false,
            next_reminder_at: null,
            paused_until: null,
            paused_reason: null,
            updated_at: new Date()
        });

        return res.status(200).json({
            status: 'success',
            data: dunningSchedule,
            message: 'Family dunning reminders disabled successfully'
        });
    } catch (error) {
        console.error('Error disabling family dunning reminders:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const sendFamilyReminderNow = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params; // past_due_payment_id

        transaction = await sequelize.transaction();

        const pastDuePayment = await FamilyPastDuePayment.findByPk(id, {
            include: [
                {
                    model: Family,
                    as: 'Family'
                },
                {
                    model: FamilyDunningSchedule,
                    as: 'DunningSchedule'
                }
            ],
            transaction
        });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family past due payment not found'
            });
        }

        if (pastDuePayment.status !== 'past_due') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Cannot send reminder for resolved or canceled family payment'
            });
        }

        const family = pastDuePayment.Family;
        const dunningSchedule = pastDuePayment.DunningSchedule;

        if (!family) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Family details not found for this past due payment'
            });
        }

        // Build user-like object expected by dunningNotificationService
        const userLike = {
            id: family.id,
            full_name: family.parent_name,
            email: family.parent_email,
            mobile: family.parent_phone,
            country_code: family.parent_country_code || '+972',
            language: 'EN'
        };

        const graceExpiry = moment(pastDuePayment.grace_period_expires_at);
        const daysRemaining = Math.max(0, Math.ceil(graceExpiry.diff(moment(), 'days', true)));

        const notificationResult = await sendReminderNotification({
            user: userLike,
            past_due_payment: pastDuePayment,
            dunning_schedule: dunningSchedule || { total_reminders_sent: pastDuePayment.total_reminders_sent || 0 },
            payment_link: pastDuePayment.payment_link,
            days_remaining: daysRemaining
        });

        // Update counters
        await pastDuePayment.update({
            last_reminder_sent_at: new Date(),
            total_reminders_sent: (pastDuePayment.total_reminders_sent || 0) + 1
        }, { transaction });

        if (dunningSchedule) {
            await dunningSchedule.update({
                last_reminder_sent_at: new Date(),
                total_reminders_sent: (dunningSchedule.total_reminders_sent || 0) + 1,
                updated_at: new Date()
            }, { transaction });
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                notification: notificationResult,
                total_reminders_sent: pastDuePayment.total_reminders_sent + 1
            },
            message: 'Family reminder sent successfully'
        });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error sending family reminder now:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const markFamilyAsPaidManually = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { payment_method = 'manual', resolution_notes } = req.body || {};

        transaction = await sequelize.transaction();

        const pastDuePayment = await FamilyPastDuePayment.findByPk(id, { transaction });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family past due payment not found'
            });
        }

        await pastDuePayment.update({
            status: 'resolved',
            resolved_at: new Date(),
            resolved_payment_method: payment_method,
            notes: `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Manually marked as paid by admin (${req.user?.full_name || 'admin'}) - Method: ${payment_method}${resolution_notes ? '. Notes: ' + resolution_notes : ''}`
        }, { transaction });

        // Disable dunning schedule if exists
        await FamilyDunningSchedule.update({
            is_enabled: false,
            next_reminder_at: null,
            updated_at: new Date()
        }, {
            where: { family_past_due_payment_id: id },
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: pastDuePayment,
            message: 'Family payment marked as paid successfully'
        });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error marking family payment as paid:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Process child cancellation action for family past due payment cancellation
 * Similar to processChildRefundAction but for cancellation
 */
const processChildCancellationAction = async (
    childAction,
    cancellationReason,
    adminId,
    transaction,
    cancelRecurringAtPayplus = true
) => {
    const result = {
        success: true,
        childId: childAction.childId,
        childName: childAction.childName,
        subscriptionAction: childAction.subscriptionAction,
        errors: []
    };

    try {
        const { childId, childName, studentId, subscriptionId, subscriptionAction } = childAction;

        if (!studentId) {
            console.warn(`[processChildCancellationAction] No studentId for child ${childId} (${childName})`);
            result.errors.push(`No student ID found for child ${childName}`);
            return result;
        }

        // Get child's subscription
        const subscription = await UserSubscriptionDetails.findOne({
            where: {
                user_id: studentId,
                status: { [Op.in]: ['active', 'inactive'] }
            },
            order: [['created_at', 'DESC']],
            transaction: transaction
        });

        console.log(`[processChildCancellationAction] Child ${childId} (${childName}), Student ID: ${studentId}, Subscription found: ${!!subscription}, Status: ${subscription?.status || 'N/A'}, Action: ${subscriptionAction}`);

        const hasManageableSubscription = !!subscription && subscription.status === 'active' && subscription.inactive_after_renew !== 1;
        const hasSubscription = !!subscription;

        // Process subscription action
        if (subscriptionAction === 'continue') {
            // Do nothing - subscription continues as normal
            console.log(`[processChildCancellationAction] Child ${childId} (${childName}) - Subscription continues as normal`);
            result.subscriptionAction = 'continue';
        } else if (subscriptionAction === 'cancel_immediate' && hasSubscription) {
            // Cancel subscription immediately
            try {
                await subscription.update({
                    status: 'inactive',
                    is_cancel: 1,
                    cancellation_date: new Date(),
                    cancelled_by_user_id: adminId,
                    cancellation_reason: cancellationReason,
                    left_lessons: 0,
                    updated_at: new Date()
                }, { transaction });

                console.log(`[processChildCancellationAction] Canceled subscription immediately for child ${childId} (${childName}), Student ID: ${studentId}`);

                // Clear user's subscription info
                await User.update({
                    subscription_id: null,
                    subscription_type: null
                }, {
                    where: { id: studentId },
                    transaction: transaction
                });

                if (childId) {
                    await FamilyChild.update(
                        {
                            status: 'cancelled',
                            payplus_subscription_id: null,
                            next_payment_date: null
                        },
                        { where: { id: childId }, transaction }
                    );
                }

                // Cancel pending classes
                await Class.update({
                    status: 'canceled',
                    cancelled_at: new Date(),
                    cancellation_reason: cancellationReason
                }, {
                    where: {
                        student_id: studentId,
                        status: 'pending'
                    },
                    transaction: transaction
                });

                let cancelledRecurringCount = 0;

                // Cancel recurring payments for this student at PayPlus ONLY when the admin
                // requested to cancel recurring payments at PayPlus.
                if (cancelRecurringAtPayplus) {
                    const recurringPayments = await RecurringPayment.findAll({
                        where: {
                            student_id: studentId,
                            status: { [Op.in]: ['pending', 'paid'] }
                        },
                        transaction: transaction
                    });

                    for (const recurringPayment of recurringPayments) {
                        try {
                            let recurringUid = null;
                            if (recurringPayment.webhook_data) {
                                try {
                                    const webhookData =
                                        typeof recurringPayment.webhook_data === 'string'
                                            ? JSON.parse(recurringPayment.webhook_data)
                                            : recurringPayment.webhook_data;
                                    recurringUid =
                                        webhookData.recurring_payment_uid ||
                                        webhookData.original_webhook?.recurring_payment_uid;
                                } catch (e) {
                                    console.error('Error parsing webhook data:', e);
                                }
                            }

                            if (!recurringUid && recurringPayment.payplus_transaction_uid) {
                                recurringUid = recurringPayment.payplus_transaction_uid;
                            }

                            if (recurringUid) {
                                // Use the same PayPlus API to cancel individual student recurring payment
                                const PAYPLUS_CONFIG = {
                                    apiKey: process.env.PAYPLUS_API_KEY || '',
                                    secretKey: process.env.PAYPLUS_SECRET_KEY || '',
                                    baseUrl: process.env.PAYPLUS_BASE_URL,
                                    terminalUid:
                                        process.env.PAYPLUS_TERMINAL_UID ||
                                        '7aab6b6b-0ab9-42b2-b71c-37307667ced7'
                                };

                                try {
                                    const response = await axios.post(
                                        `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/DeleteRecurring/${recurringUid}`,
                                        {
                                            terminal_uid: PAYPLUS_CONFIG.terminalUid,
                                            _method: 'DELETE'
                                        },
                                        {
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'api-key': PAYPLUS_CONFIG.apiKey,
                                                'secret-key': PAYPLUS_CONFIG.secretKey
                                            },
                                            timeout: 30000
                                        }
                                    );

                                    if (response.status === 200 || response.status === 204) {
                                        await recurringPayment.update(
                                            {
                                                status: 'cancelled',
                                                updated_at: new Date()
                                            },
                                            { transaction }
                                        );
                                        cancelledRecurringCount++;
                                    }
                                } catch (recurringError) {
                                    // If recurring payment doesn't exist or already cancelled, consider it successful
                                    if (
                                        recurringError.response?.status === 404 ||
                                        (typeof recurringError.response?.data === 'string' &&
                                            (recurringError.response.data.includes('not found') ||
                                                recurringError.response.data.includes('already cancelled')))
                                    ) {
                                        await recurringPayment.update(
                                            {
                                                status: 'cancelled',
                                                updated_at: new Date()
                                            },
                                            { transaction }
                                        );
                                        cancelledRecurringCount++;
                                    } else {
                                        console.error(
                                            `Error cancelling recurring payment ${recurringPayment.id}:`,
                                            recurringError
                                        );
                                    }
                                }
                            }
                        } catch (recurringError) {
                            console.error(
                                `Error cancelling recurring payment ${recurringPayment.id}:`,
                                recurringError
                            );
                        }
                    }
                }

                result.recurringPaymentsCancelled = cancelledRecurringCount;
                result.subscriptionAction = 'cancel_immediate';
            } catch (subscriptionError) {
                console.error(`Error processing immediate cancellation for child ${childId}:`, subscriptionError);
                result.errors.push(`Failed to cancel subscription immediately: ${subscriptionError.message}`);
            }
        } else if (subscriptionAction === 'cancel_renewal' && hasManageableSubscription) {
            // Set to cancel after renewal
            try {
                await subscription.update({
                    inactive_after_renew: 1,
                    cancellation_date: new Date(),
                    cancelled_by_user_id: adminId,
                    cancellation_reason: cancellationReason,
                    updated_at: new Date()
                }, { transaction });

                console.log(`[processChildCancellationAction] Set subscription to cancel at renewal for child ${childId} (${childName})`);
                result.subscriptionAction = 'cancel_renewal';
            } catch (subscriptionError) {
                console.error(`Error processing renewal cancellation for child ${childId}:`, subscriptionError);
                result.errors.push(`Failed to set cancel at renewal: ${subscriptionError.message}`);
            }
        } else {
            if (subscriptionAction === 'cancel_immediate' && !hasSubscription) {
                result.errors.push(`No subscription found for child ${childName}. Cannot cancel subscription.`);
            } else if (subscriptionAction === 'cancel_renewal' && !hasManageableSubscription) {
                result.errors.push(`No active manageable subscription found for child ${childName}. Cannot set to cancel at renewal.`);
            }
        }

        return result;
    } catch (error) {
        console.error(`Error processing child cancellation action for child ${childAction.childId}:`, error);
        result.success = false;
        result.errors.push(error.message);
        return result;
    }
};

const cancelFamilyImmediately = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;
        const { 
            reason_category = 'payment_issues', 
            reason_text,
            childrenActions = [],
            cancelRecurringPayment = true
        } = req.body || {};

        transaction = await sequelize.transaction();

        const pastDuePayment = await FamilyPastDuePayment.findByPk(id, { 
            include: [{
                model: Family,
                as: 'Family',
                attributes: ['id', 'parent_name', 'parent_email']
            }],
            transaction 
        });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family past due payment not found'
            });
        }

        const adminId = req.user?.id || null;
        const cancellationReason = `Family past due payment canceled: ${reason_text || 'Canceled immediately by admin'}`;

        // Update past due payment status
        await pastDuePayment.update({
            status: 'canceled',
            canceled_at: new Date(),
            cancellation_reason_category: reason_category,
            cancellation_reason: reason_text || 'Canceled immediately by admin',
            notes: `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Canceled immediately by admin (${req.user?.full_name || 'admin'}) - Category: ${reason_category}${reason_text ? '. Reason: ' + reason_text : ''}`
        }, { transaction });

        // Disable dunning schedule
        await FamilyDunningSchedule.update({
            is_enabled: false,
            next_reminder_at: null,
            updated_at: new Date()
        }, {
            where: { family_past_due_payment_id: id },
            transaction
        });

        // Process children actions if provided
        const childrenResults = [];
        if (Array.isArray(childrenActions) && childrenActions.length > 0) {
            console.log(`[cancelFamilyImmediately] Processing ${childrenActions.length} children actions`);
            
            for (const childAction of childrenActions) {
                if (childAction.subscriptionAction && childAction.subscriptionAction !== 'continue') {
                    const childResult = await processChildCancellationAction(
                        childAction,
                        cancellationReason,
                        adminId,
                        transaction,
                        cancelRecurringPayment
                    );
                    childrenResults.push(childResult);
                }
            }
        }

        // Cancel recurring payment at PayPlus if requested and recurring_payment_uid exists
        if (cancelRecurringPayment && pastDuePayment.recurring_payment_uid) {
            try {
                await cancelFamilyRecurringPayment(pastDuePayment.recurring_payment_uid);
                console.log(`[cancelFamilyImmediately] Cancelled family recurring payment: ${pastDuePayment.recurring_payment_uid}`);
            } catch (recurringError) {
                console.error(`[cancelFamilyImmediately] Error cancelling family recurring payment:`, recurringError);
                // Don't fail the whole operation if recurring payment cancellation fails
            }
        } else if (cancelRecurringPayment && !pastDuePayment.recurring_payment_uid) {
            console.log(`[cancelFamilyImmediately] cancelRecurringPayment was true but no recurring_payment_uid found`);
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                pastDuePayment: pastDuePayment,
                childrenResults: childrenResults
            },
            message: 'Family past due payment canceled successfully' + (childrenResults.length > 0 ? ` with ${childrenResults.length} children subscription(s) processed` : '')
        });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error canceling family payment immediately:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const getFamilyRecoveryLink = async (req, res) => {
    try {
        const { id } = req.params;

        const pastDuePayment = await FamilyPastDuePayment.findByPk(id, {
            include: [{
                model: Family,
                as: 'Family',
                attributes: ['id', 'parent_name', 'parent_email']
            }]
        });

        if (!pastDuePayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Family past due payment not found'
            });
        }

        if (!pastDuePayment.payment_link) {
            return res.status(400).json({
                status: 'error',
                message: 'No recovery link found for this family payment'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: {
                payment_link: pastDuePayment.payment_link,
                family: pastDuePayment.Family ? {
                    id: pastDuePayment.Family.id,
                    name: pastDuePayment.Family.parent_name,
                    email: pastDuePayment.Family.parent_email
                } : null
            },
            message: 'Family recovery link retrieved successfully'
        });
    } catch (error) {
        console.error('Error getting family recovery link:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const sendFamilyWhatsAppRecoveryLink = async (req, res) => {
    let transaction;

    try {
        const { id } = req.params;

        transaction = await sequelize.transaction();

        const pastDuePayment = await FamilyPastDuePayment.findByPk(id, {
            include: [{
                model: Family,
                as: 'Family'
            }],
            transaction
        });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family past due payment not found'
            });
        }

        if (pastDuePayment.status !== 'past_due') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Cannot send WhatsApp for resolved/canceled family payment'
            });
        }

        const family = pastDuePayment.Family;

        if (!family || !family.parent_phone || family.parent_phone.trim() === '') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No parent mobile number available for this family'
            });
        }

        if (!pastDuePayment.payment_link) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No recovery link available. Please ensure a recovery link exists for this family payment.'
            });
        }

        const notificationParams = {
            'student.name': family.parent_name || 'Dear Family',
            'payment.link': pastDuePayment.payment_link,
            'amount': pastDuePayment.amount.toString()
        };

        const whatsappSent = await whatsappReminderTrailClass(
            'payment_recovery',
            notificationParams,
            {
                country_code: family.parent_country_code || '+972',
                mobile: family.parent_phone,
                full_name: family.parent_name,
                language: 'HE'
            }
        );

        if (whatsappSent) {
            await pastDuePayment.update({
                whatsapp_messages_sent: (pastDuePayment.whatsapp_messages_sent || 0) + 1
            }, { transaction });
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                whatsapp_sent: whatsappSent,
                whatsapp_count: (pastDuePayment.whatsapp_messages_sent || 0) + (whatsappSent ? 1 : 0),
                recipient: {
                    name: family.parent_name,
                    mobile: `${family.parent_country_code || '+972'}${family.parent_phone}`
                }
            },
            message: whatsappSent ? 'Family WhatsApp message sent successfully' : 'Failed to send family WhatsApp message'
        });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error sending family WhatsApp recovery link:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const bulkSendFamilyWhatsAppReminders = async (req, res) => {
    let transaction;

    try {
        const { payment_ids } = req.body || {};

        if (!Array.isArray(payment_ids) || payment_ids.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'payment_ids array is required'
            });
        }

        transaction = await sequelize.transaction();

        const payments = await FamilyPastDuePayment.findAll({
            where: {
                id: { [Op.in]: payment_ids },
                status: 'past_due'
            },
            include: [{
                model: Family,
                as: 'Family'
            }],
            transaction
        });

        let successCount = 0;

        for (const payment of payments) {
            try {
                const family = payment.Family;
                if (!family || !family.parent_phone || !payment.payment_link) {
                    continue;
                }

                const notificationParams = {
                    'student.name': family.parent_name || 'Dear Family',
                    'payment.link': payment.payment_link,
                    'amount': payment.amount.toString()
                };

                const whatsappSent = await whatsappReminderTrailClass(
                    'payment_recovery',
                    notificationParams,
                    {
                        country_code: family.parent_country_code || '+972',
                        mobile: family.parent_phone,
                        full_name: family.parent_name,
                        language: 'HE'
                    }
                );

                if (whatsappSent) {
                    await payment.update({
                        whatsapp_messages_sent: (payment.whatsapp_messages_sent || 0) + 1
                    }, { transaction });
                    successCount++;
                }
            } catch (sendError) {
                console.error('Error sending bulk family WhatsApp reminder:', sendError);
                continue;
            }
        }

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                total_requested: payment_ids.length,
                total_processed: payments.length,
                success_count: successCount
            },
            message: 'Bulk family WhatsApp reminders processed'
        });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error in bulkSendFamilyWhatsAppReminders:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const exportFamilyFailedPayments = async (req, res) => {
    try {
        const payments = await FamilyPastDuePayment.findAll({
            include: [{
                model: Family,
                as: 'Family',
                attributes: ['parent_name', 'parent_email', 'parent_phone']
            }],
            order: [['failed_at', 'DESC']]
        });

        let csv = 'ID,Family Name,Family Email,Family Phone,Amount,Currency,Status,Failed At,Grace Expires At,Children Count\n';

        payments.forEach(p => {
            const familyName = p.Family?.parent_name || '';
            const familyEmail = p.Family?.parent_email || '';
            const familyPhone = p.Family?.parent_phone || '';

            csv += [
                p.id,
                `"${familyName.replace(/"/g, '""')}"`,
                `"${familyEmail.replace(/"/g, '""')}"`,
                `"${familyPhone.replace(/"/g, '""')}"`,
                parseFloat(p.amount).toFixed(2),
                p.currency,
                p.status,
                p.failed_at ? moment(p.failed_at).format('YYYY-MM-DD HH:mm:ss') : '',
                p.grace_period_expires_at ? moment(p.grace_period_expires_at).format('YYYY-MM-DD HH:mm:ss') : '',
                p.children_count || 0
            ].join(',') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="family-failed-payments-export.csv"');

        return res.status(200).send(csv);
    } catch (error) {
        console.error('Error exporting family failed payments:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const getFamilyDunningStats = async (req, res) => {
    try {
        const now = new Date();

        const activeSchedules = await FamilyDunningSchedule.count({
            where: { is_enabled: true, is_paused: false }
        });

        const pausedSchedules = await FamilyDunningSchedule.count({
            where: { is_paused: true }
        });

        const upcomingReminders = await FamilyDunningSchedule.count({
            where: {
                is_enabled: true,
                is_paused: false,
                next_reminder_at: { [Op.gt]: now }
            }
        });

        return res.status(200).json({
            status: 'success',
            data: {
                active_schedules: activeSchedules,
                paused_schedules: pausedSchedules,
                upcoming_reminders: upcomingReminders
            },
            message: 'Family dunning stats retrieved successfully'
        });
    } catch (error) {
        console.error('Error getting family dunning stats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const getFamilyRecoveryRates = async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const daysInt = parseInt(days, 10) || 30;

        const sinceDate = moment().subtract(daysInt, 'days').toDate();

        const totalFailed = await FamilyPastDuePayment.count({
            where: {
                created_at: { [Op.gte]: sinceDate }
            }
        });

        const totalResolved = await FamilyPastDuePayment.count({
            where: {
                status: 'resolved',
                resolved_at: { [Op.gte]: sinceDate }
            }
        });

        const rate = totalFailed > 0 ? ((totalResolved / totalFailed) * 100).toFixed(1) : '0.0';

        return res.status(200).json({
            status: 'success',
            data: {
                period_days: daysInt,
                total_failed: totalFailed,
                total_resolved: totalResolved,
                recovery_rate: `${rate}%`
            },
            message: 'Family recovery rates retrieved successfully'
        });
    } catch (error) {
        console.error('Error getting family recovery rates:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

const getFamilyWhatsAppStats = async (req, res) => {
    try {
        const startOfMonth = moment().startOf('month').toDate();
        const endOfMonth = moment().endOf('month').toDate();

        const monthlyStats = await FamilyPastDuePayment.findAll({
            attributes: [
                [sequelize.fn('SUM', sequelize.col('whatsapp_messages_sent')), 'total_whatsapp_sent'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'total_payments']
            ],
            where: {
                created_at: {
                    [Op.gte]: startOfMonth,
                    [Op.lte]: endOfMonth
                },
                whatsapp_messages_sent: {
                    [Op.gt]: 0
                }
            },
            raw: true
        });

        const totalWhatsAppSent = parseInt(monthlyStats[0]?.total_whatsapp_sent || 0);
        const estimatedCost = totalWhatsAppSent * 0.45;

        const dailyBreakdown = await FamilyPastDuePayment.findAll({
            attributes: [
                [sequelize.fn('DATE', sequelize.col('updated_at')), 'date'],
                [sequelize.fn('SUM', sequelize.col('whatsapp_messages_sent')), 'daily_count']
            ],
            where: {
                updated_at: {
                    [Op.gte]: startOfMonth,
                    [Op.lte]: endOfMonth
                },
                whatsapp_messages_sent: {
                    [Op.gt]: 0
                }
            },
            group: [sequelize.fn('DATE', sequelize.col('updated_at'))],
            order: [[sequelize.fn('DATE', sequelize.col('updated_at')), 'DESC']],
            raw: true
        });

        return res.status(200).json({
            status: 'success',
            data: {
                month_to_date: {
                    messages_sent: totalWhatsAppSent,
                    estimated_cost: parseFloat(estimatedCost.toFixed(2)),
                    currency: 'ILS',
                    average_cost_per_message: 0.45
                },
                daily_breakdown: dailyBreakdown.map(day => ({
                    date: day.date,
                    count: parseInt(day.daily_count || 0)
                }))
            },
            message: 'Family WhatsApp statistics retrieved successfully'
        });
    } catch (error) {
        console.error('Error getting family WhatsApp stats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Get FAMILY payment recovery page data (for public card-update page)
 * Resolves by FamilyPastDuePayment.short_id (8-char short link).
 */
const getFamilyRecoveryPageData = async (req, res) => {
    try {
        const { id } = req.params;

        // Only accept 8-char alphanumeric short IDs for family recovery
        if (!/^[A-Za-z0-9]{8}$/.test(id)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid recovery link. The link may be corrupted or expired.'
            });
        }

        const pastDuePayment = await FamilyPastDuePayment.findOne({
            where: { short_id: id },
            include: [
                {
                    model: Family,
                    as: 'Family',
                    attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code', 'status']
                }
            ]
        });

        if (!pastDuePayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Family failed payment not found'
            });
        }

        if (pastDuePayment.status !== 'past_due') {
            return res.status(400).json({
                status: 'error',
                message: 'Payment is not in past_due status'
            });
        }

        const hasRecurring = !!pastDuePayment.recurring_payment_uid;

        return res.status(200).json({
            status: 'success',
            data: {
                payment: {
                    id: pastDuePayment.id,
                    amount: pastDuePayment.amount,
                    currency: pastDuePayment.currency,
                    status: pastDuePayment.status,
                    failed_at: pastDuePayment.failed_at,
                    grace_period_expires_at: pastDuePayment.grace_period_expires_at
                },
                family: pastDuePayment.Family ? {
                    id: pastDuePayment.Family.id,
                    parent_name: pastDuePayment.Family.parent_name,
                    parent_email: pastDuePayment.Family.parent_email
                } : null,
                has_recurring_payment: hasRecurring,
                recurring_payment_uid: pastDuePayment.recurring_payment_uid
            },
            message: 'Family recovery page data retrieved successfully'
        });
    } catch (error) {
        console.error('Error getting family recovery page data:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

/**
 * Update credit card for FAMILY failed payment recovery.
 * Mirrors updateCardForRecovery but uses FamilyPastDuePayment + recurring_payment_uid.
 */
const updateFamilyCardForRecovery = async (req, res) => {
    let transaction;
    try {
        const { id } = req.params;

        // Only accept 8-char short IDs
        if (!/^[A-Za-z0-9]{8}$/.test(id)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid recovery link. The link may be corrupted or expired.'
            });
        }

        const {
            credit_card_number,
            card_date_mmyy,
            cvv,
            card_holder_name,
            card_holder_id
        } = req.body || {};

        if (!credit_card_number || !card_date_mmyy || !cvv || !card_holder_name) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: credit_card_number, card_date_mmyy, cvv, card_holder_name'
            });
        }

        transaction = await sequelize.transaction();

        const pastDuePayment = await FamilyPastDuePayment.findOne({
            where: { short_id: id },
            include: [
                {
                    model: Family,
                    as: 'Family',
                    attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code', 'status']
                },
                {
                    model: FamilyPaymentTransaction,
                    as: 'FamilyPaymentTransaction',
                    attributes: ['id', 'student_ids', 'payplus_response_data']
                }
            ],
            transaction
        });

        if (!pastDuePayment) {
            await transaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family failed payment not found'
            });
        }

        if (pastDuePayment.status !== 'past_due') {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Payment is not in past_due status'
            });
        }

        // Try to resolve a primary student_id from stored student_ids (JSON on transaction or past due)
        let primaryStudentId = null;
        let payplusDetails = null;
        try {
            const rawStudentIds =
                pastDuePayment.FamilyPaymentTransaction?.student_ids ??
                pastDuePayment.student_ids;
            if (rawStudentIds) {
                const parsed = typeof rawStudentIds === 'string'
                    ? JSON.parse(rawStudentIds)
                    : rawStudentIds;
                if (Array.isArray(parsed) && parsed.length > 0) {
                    primaryStudentId = parseInt(parsed[0], 10);
                }
            }
        } catch (e) {
            console.warn('[FAMILY RECOVERY] Failed to parse student_ids for family past due:', e);
        }

        // 1) Prefer recurring UID already stored on past_due (set during failed webhook)
        let recurringUid = pastDuePayment.recurring_payment_uid || null;

        // 2) If not stored, and we have a student_id, fall back to helper like individual flow
        if (!recurringUid && primaryStudentId) {
            payplusDetails = await getPayplusRecurringDetails(primaryStudentId);
            if (payplusDetails && payplusDetails.recurring_uid) {
                recurringUid = payplusDetails.recurring_uid;
            }
        }

        if (!recurringUid) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No recurring payment found for this family. Cannot update card without existing recurring payment.'
            });
        }

        // Ensure we have payplusDetails if we didn't fetch it via helper
        if (!payplusDetails) {
            payplusDetails = {};
        }

        // Ensure recurring exists at PayPlus
        const recurringValidation = await getRecurringPaymentDetails(recurringUid);
        console.log('recurringValidation', recurringValidation);

        if (!recurringValidation.success) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Recurring payment not found at PayPlus. It may have been cancelled or deleted.',
                details: recurringValidation.error || 'can-not-find-recurring-payment'
            });
        }

        // Try to derive terminal_uid from multiple sources (stored data, transaction payload, ViewRecurring)
        let terminalUid =
            // 1) From stored recurring/payment details if we resolved via helper earlier
            (payplusDetails && payplusDetails.terminal_uid) ||
            // 2) From original FamilyPaymentTransaction payload
            pastDuePayment.FamilyPaymentTransaction?.payplus_response_data?.data?.terminal_uid ||
            pastDuePayment.FamilyPaymentTransaction?.payplus_response_data?.terminal_uid ||
            null;

        // 3) Fallback: derive from PayPlus ViewRecurring API response
        if (!terminalUid && recurringValidation.data) {
            const payplusDataRoot = recurringValidation.data;
            const payplusData =
                payplusDataRoot.data ||
                payplusDataRoot.results?.data ||
                payplusDataRoot;

            terminalUid =
                payplusData?.terminal_uid ||
                payplusData?.data?.terminal_uid ||
                payplusData?.original_webhook?.terminal_uid ||
                null;
        }

        // 4) Final fallback to environment terminal UID
        if (!terminalUid && process.env.PAYPLUS_TERMINAL_UID) {
            terminalUid = process.env.PAYPLUS_TERMINAL_UID;
        }

        // Determine basic recurring settings for the family (monthly, unlimited charges)
        const recurringType = 2; // monthly
        const recurringRange = 1; // every 1 month

        // Build description for items (used in update + charge)
        const family = pastDuePayment.Family;
        const description = `Past due family payment - Family ${family?.parent_name || family?.id || pastDuePayment.family_id}`;

        // === STEP 1: Add new card token at PayPlus (same approach as individual flow) ===
        const customerUid =
            payplusDetails.customer_uid
            || pastDuePayment.FamilyPaymentTransaction?.payplus_response_data?.data?.customer_uid
            || pastDuePayment.FamilyPaymentTransaction?.payplus_response_data?.customer_uid
            || recurringValidation.data?.customer_uid
            || null;

        if (!customerUid || !terminalUid) {
            await transaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Missing required PayPlus credentials. Cannot update card without customer_uid and terminal_uid.',
                details: {
                    has_customer_uid: !!customerUid,
                    has_terminal_uid: !!terminalUid
                }
            });
        }

        const cardTokenResult = await addCardToken({
            customer_uid: customerUid,
            terminal_uid: terminalUid,
            credit_card_number,
            card_date_mmyy,
            cvv,
            card_holder_name,
            card_holder_id
        });

        // Handle "card-already-exist" by reusing existing token (from DB, PayPlus response, or token list)
        let cardTokenToUse = cardTokenResult.card_token;
        if (!cardTokenResult.success) {
            const isCardExistsError = (cardTokenResult.error || '').toLowerCase().includes('card-already-exist');
            const fallbackToken =
                payplusDetails.card_token ||
                cardTokenResult.details?.data?.token_uid ||
                cardTokenResult.details?.data?.token;

            if (isCardExistsError) {
                const desiredLast4 = (credit_card_number || '').slice(-4);
                cardTokenToUse = fallbackToken;

                // If still missing, or fallbackToken is clearly the old token,
                // pull from PayPlus token list and try to match the NEW card.
                if (customerUid) {
                    const listResult = await listCustomerTokens(customerUid);
                    if (listResult.success && Array.isArray(listResult.tokens) && listResult.tokens.length > 0) {
                        // Prefer a token whose last 4 digits match the new card
                        let chosen = listResult.tokens.find(t =>
                            (t.last_4_digits || t.lastFour || t.last4) === desiredLast4
                        );

                        // If not found, try to avoid obvious "failed" tokens by name
                        if (!chosen) {
                            chosen = listResult.tokens.find(t =>
                                typeof t.name === 'string' && t.name.toLowerCase() !== 'failed'
                            );
                        }

                        // As a last resort, fall back to the most recent token in the list
                        if (!chosen) {
                            chosen = listResult.tokens[listResult.tokens.length - 1];
                        }

                        if (chosen) {
                            cardTokenToUse = chosen.token_uid || chosen.token || cardTokenToUse;
                        }
                    }
                }

                if (!cardTokenToUse) {
                    await transaction.rollback();
                    return res.status(500).json({
                        status: 'error',
                        message: 'Failed to add card token',
                        details: cardTokenResult.error
                    });
                }
            } else {
                await transaction.rollback();
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to add card token',
                    details: cardTokenResult.error
                });
            }
        }

        // If success but token missing, try to pull from response
        if (!cardTokenToUse) {
            cardTokenToUse =
                cardTokenResult.card_token ||
                cardTokenResult.details?.data?.token_uid ||
                cardTokenResult.details?.data?.token ||
                payplusDetails.card_token;
        }

        // === STEP 2: Update recurring payment with new card token using shared paymentRecoveryService ===
        const updateResult = await updateFamilyRecurringPayment({
            recurring_uid: recurringUid,
            customer_uid: customerUid,
            card_token: cardTokenToUse,
            terminal_uid: terminalUid,
            cashier_uid: recurringValidation.data?.cashier_uid || null,
            currency_code: pastDuePayment.currency || 'ILS',
            instant_first_payment: false,
            valid: true,
            recurring_type: recurringType,
            recurring_range: recurringRange,
            number_of_charges: 0,
            amount: pastDuePayment.amount,
            items: [{
                name: description,
                price: Number(pastDuePayment.amount),
                quantity: 1,
                vat_type: 0
            }]
        });

        if (!updateResult.success) {
            await transaction.rollback();
            console.error('[FAMILY RECOVERY] Failed to update recurring payment card:', updateResult);
            return res.status(400).json({
                status: 'error',
                message: 'Failed to update card for recurring payment',
                details: updateResult.details || updateResult.error || 'unknown_error'
            });
        }

        // Step 3: Add immediate recurring charge — REMOVED (no manual charge; card/recurring update only),
        // aligned with admin failed-payments.controller.js updateCardForRecovery.
        // const chargeItems = [{
        //     name: description,
        //     quantity: 1,
        //     price: Number(pastDuePayment.amount),
        //     currency_code: pastDuePayment.currency || 'ILS',
        //     vat_type: 0
        // }];
        // const chargeResult = await addFamilyRecurringCharge({
        //     recurring_uid: recurringUid,
        //     terminal_uid: terminalUid || process.env.PAYPLUS_TERMINAL_UID,
        //     card_token: cardTokenToUse,
        //     charge_date: moment().add(1, 'day').format('YYYY-MM-DD'),
        //     amount: Number(pastDuePayment.amount),
        //     currency_code: pastDuePayment.currency || 'ILS',
        //     valid: true,
        //     description,
        //     items: chargeItems
        // });

        // Step 4: Mark family past due as resolved (no manual charge; collection continues via recurring flow)
        await pastDuePayment.update({
            status: 'resolved',
            resolved_at: new Date(),
            resolved_transaction_id: recurringUid,
            resolved_payment_method: 'payplus_family_card_update_no_manual_charge',
            updated_at: new Date(),
            notes: `${pastDuePayment.notes || ''}\n[${new Date().toISOString()}] Card updated via family recovery page. Marked resolved without immediate charge (collection will continue via recurring flow).`
        }, { transaction });

        await FamilyDunningSchedule.update({
            is_enabled: false,
            next_reminder_at: null,
            updated_at: new Date()
        }, {
            where: { family_past_due_payment_id: pastDuePayment.id },
            transaction
        });

        paymentLogger.logPaymentVerification({
            student_id: `family_${pastDuePayment.family_id}`,
            student_name: family?.parent_name || 'Family',
            subscription_id: pastDuePayment.family_payment_transaction_id,
            verification_type: 'family_card_updated_for_recovery_no_charge',
            verification_result: true,
            subscription_details: {
                family_past_due_payment_id: pastDuePayment.id,
                new_card_token: cardTokenToUse,
                recurring_uid: recurringUid,
                card_last_digits: (credit_card_number || '').slice(-4),
                manual_charge_disabled: true
            }
        });

        await transaction.commit();

        return res.status(200).json({
            status: 'success',
            data: {
                card_token: cardTokenToUse,
                recurring_payment_uid: recurringUid,
                customer_uid: updateResult.customer_uid || null,
                past_due_status: 'resolved',
                message: 'Card and recurring payment updated successfully. Past due payment has been marked as resolved (no manual charge).'
            },
            message: 'Family card updated and recurring payment updated successfully. Past due resolved without immediate charge.'
        });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error updating family card for recovery:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            details: error.message
        });
    }
};

module.exports = {
    getFamilyFailedPaymentsOverview,
    getFamilyFailedPaymentsList,
    getFamilyCollectionsList,
    getFamilyFailedPaymentDetails,
    getFamilyDunningSchedule,
    pauseFamilyDunningReminders,
    resumeFamilyDunningReminders,
    disableFamilyDunningReminders,
    sendFamilyReminderNow,
    markFamilyAsPaidManually,
    cancelFamilyImmediately,
    getFamilyRecoveryLink,
    sendFamilyWhatsAppRecoveryLink,
    bulkSendFamilyWhatsAppReminders,
    exportFamilyFailedPayments,
    getFamilyDunningStats,
    getFamilyRecoveryRates,
    getFamilyWhatsAppStats,
    getFamilyRecoveryPageData,
    updateFamilyCardForRecovery
};

