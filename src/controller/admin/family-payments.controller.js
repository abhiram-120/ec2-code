// controller/admin/family-payments.controller.js
const { Op, Sequelize } = require('sequelize');
const { sequelize } = require('../../connection/connection');
const moment = require('moment');
const { FamilyPaymentTransaction, Family, FamilyPaymentLink, FamilyChild } = require('../../models/Family');
const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const RecurringPayment = require('../../models/RecurringPayment');
const Class = require('../../models/classes');
const { processFamilyPaymentRefund, downloadFamilyCreditInvoice, cancelFamilyRecurringPayment, checkRecurringExistsAtPayPlus } = require('../../services/familyPayplus.service');
const { sendNotificationEmail } = require('../../cronjobs/reminder');

/**
 * Get family payment transactions with pagination and filters
 */
const getFamilyPayments = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search,
            status,
            paymentType,
            fromDate,
            toDate,
            familyId,
            minAmount,
            maxAmount,
            currency = 'ILS'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const whereConditions = {};

        // Search filter
        if (search) {
            whereConditions[Op.or] = [
                { transaction_token: { [Op.like]: `%${search}%` } },
                { payplus_transaction_id: { [Op.like]: `%${search}%` } },
                { '$family.parent_name$': { [Op.like]: `%${search}%` } },
                { '$family.parent_email$': { [Op.like]: `%${search}%` } }
            ];
        }

        // Status filter
        if (status && status !== 'all') {
            whereConditions.status = status;
        }

        // Payment type filter
        if (paymentType && paymentType !== 'all') {
            whereConditions.payment_type = paymentType;
        }

        // Date range filter
        if (fromDate) {
            whereConditions.created_at = {
                ...whereConditions.created_at,
                [Op.gte]: moment(fromDate).startOf('day').toDate()
            };
        }
        if (toDate) {
            whereConditions.created_at = {
                ...whereConditions.created_at,
                [Op.lte]: moment(toDate).endOf('day').toDate()
            };
        }

        // Family ID filter
        if (familyId) {
            whereConditions.family_id = parseInt(familyId);
        }

        // Amount range filter
        if (minAmount) {
            whereConditions.amount = {
                ...whereConditions.amount,
                [Op.gte]: parseFloat(minAmount)
            };
        }
        if (maxAmount) {
            whereConditions.amount = {
                ...whereConditions.amount,
                [Op.lte]: parseFloat(maxAmount)
            };
        }

        // Currency filter
        if (currency && currency !== 'all') {
            whereConditions.currency = currency;
        }

        // Get total count
        const { count, rows } = await FamilyPaymentTransaction.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code']
                },
                {
                    model: FamilyPaymentLink,
                    as: 'paymentLink',
                    attributes: ['id', 'link_token', 'description', 'custom_note']
                }
            ],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: offset,
            distinct: true
        });

        // Format response
        const transactions = rows.map(transaction => ({
            id: transaction.id,
            transactionToken: transaction.transaction_token,
            payplusTransactionId: transaction.payplus_transaction_id,
            familyId: transaction.family_id,
            family: transaction.family ? {
                id: transaction.family.id,
                parentName: transaction.family.parent_name,
                parentEmail: transaction.family.parent_email,
                parentPhone: transaction.family.parent_phone,
                parentCountryCode: transaction.family.parent_country_code
            } : null,
            paymentLink: transaction.paymentLink ? {
                id: transaction.paymentLink.id,
                linkToken: transaction.paymentLink.link_token,
                description: transaction.paymentLink.description,
                customNote: transaction.paymentLink.custom_note
            } : null,
            paidChildrenIds: transaction.paid_children_ids,
            studentIds: transaction.student_ids,
            subscriptionIds: transaction.subscription_ids,
            paidChildrenDetails: transaction.paid_children_details,
            amount: parseFloat(transaction.amount),
            currency: transaction.currency,
            paymentType: transaction.payment_type,
            status: transaction.status,
            paymentMethod: transaction.payment_method,
            cardLastDigits: transaction.card_last_digits,
            errorCode: transaction.error_code,
            errorMessage: transaction.error_message,
            processedAt: transaction.processed_at,
            createdAt: transaction.created_at,
            updatedAt: transaction.updated_at
        }));

        return res.status(200).json({
            status: 'success',
            data: {
                transactions,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count / parseInt(limit))
                }
            },
            message: 'Family payment transactions retrieved successfully'
        });

    } catch (error) {
        console.error('Error fetching family payments:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch family payment transactions',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get single family payment transaction by ID or transaction token
 */
const getFamilyPaymentById = async (req, res) => {
    try {
        const { id } = req.params;

        // Try to find by ID first (numeric), if that fails, try transaction token
        let transaction = await FamilyPaymentTransaction.findByPk(id, {
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code', 'parent_address', 'family_notes', 'status']
                },
                {
                    model: FamilyPaymentLink,
                    as: 'paymentLink',
                    attributes: ['id', 'link_token', 'description', 'custom_note', 'total_amount', 'currency', 'payment_type', 'created_at']
                }
            ]
        });

        // If not found by ID, try to find by transaction token
        if (!transaction && isNaN(parseInt(id))) {
            transaction = await FamilyPaymentTransaction.findOne({
                where: { transaction_token: id },
                include: [
                    {
                        model: Family,
                        as: 'family',
                        attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code', 'parent_address', 'family_notes', 'status']
                    },
                    {
                        model: FamilyPaymentLink,
                        as: 'paymentLink',
                        attributes: ['id', 'link_token', 'description', 'custom_note', 'total_amount', 'currency', 'payment_type', 'created_at']
                    }
                ]
            });
        }

        if (!transaction) {
            return res.status(404).json({
                status: 'error',
                message: 'Family payment transaction not found'
            });
        }

        // Parse and enrich paid children details
        let paidChildrenDetails = null;
        console.log('[getFamilyPaymentById] Raw paid_children_details:', {
            type: typeof transaction.paid_children_details,
            value: transaction.paid_children_details,
            paid_children_ids: transaction.paid_children_ids
        });

        if (transaction.paid_children_details) {
            try {
                // Parse JSON if it's a string
                let parsedDetails = transaction.paid_children_details;
                if (typeof parsedDetails === 'string') {
                    parsedDetails = JSON.parse(parsedDetails);
                }

                console.log('[getFamilyPaymentById] Parsed details:', {
                    isArray: Array.isArray(parsedDetails),
                    length: Array.isArray(parsedDetails) ? parsedDetails.length : 'N/A',
                    sample: Array.isArray(parsedDetails) && parsedDetails.length > 0 ? parsedDetails[0] : parsedDetails
                });

                // If it's an array, format the details
                if (Array.isArray(parsedDetails) && parsedDetails.length > 0) {
                    // The data already contains all the information we need
                    paidChildrenDetails = parsedDetails.map((detail) => {
                        // Format the data to match frontend expectations
                        return {
                            childId: detail.childId || detail.child_id || null,
                            childName: detail.childName || 'N/A',
                            relationshipToParent: detail.relationshipToParent || detail.relationship_to_parent || detail.relationship || 'N/A',
                            planDescription: detail.planDescription || (detail.lessonMinutes && detail.lessonsPerMonth 
                                ? `${detail.lessonMinutes}min lessons, ${detail.lessonsPerMonth} lessons/month`
                                : 'N/A'),
                            amount: detail.amount || 0,
                            lessonMinutes: detail.lessonMinutes,
                            lessonsPerMonth: detail.lessonsPerMonth
                        };
                    });

                    console.log('[getFamilyPaymentById] Final paidChildrenDetails:', {
                        count: paidChildrenDetails.length,
                        details: paidChildrenDetails
                    });
                } else if (parsedDetails && typeof parsedDetails === 'object' && !Array.isArray(parsedDetails)) {
                    // Handle single object case
                    paidChildrenDetails = [{
                        childId: parsedDetails.childId || parsedDetails.child_id || null,
                        childName: parsedDetails.childName || 'N/A',
                        relationshipToParent: parsedDetails.relationshipToParent || parsedDetails.relationship_to_parent || parsedDetails.relationship || 'N/A',
                        planDescription: parsedDetails.planDescription || (parsedDetails.lessonMinutes && parsedDetails.lessonsPerMonth 
                            ? `${parsedDetails.lessonMinutes}min lessons, ${parsedDetails.lessonsPerMonth} lessons/month`
                            : 'N/A'),
                        amount: parsedDetails.amount || 0,
                        lessonMinutes: parsedDetails.lessonMinutes,
                        lessonsPerMonth: parsedDetails.lessonsPerMonth
                    }];
                } else {
                    paidChildrenDetails = parsedDetails;
                }
            } catch (parseError) {
                console.error('[getFamilyPaymentById] Error parsing paid_children_details:', {
                    error: parseError.message,
                    stack: parseError.stack,
                    rawData: transaction.paid_children_details
                });
                paidChildrenDetails = null;
            }
        } else {
            console.log('[getFamilyPaymentById] No paid_children_details found, checking paid_children_ids:', transaction.paid_children_ids);
            
            // Fallback: if paid_children_details is null but paid_children_ids exists, try to fetch from FamilyChild
            if (transaction.paid_children_ids && Array.isArray(transaction.paid_children_ids) && transaction.paid_children_ids.length > 0) {
                try {
                    const familyChildren = await FamilyChild.findAll({
                        where: {
                            id: { [Op.in]: transaction.paid_children_ids },
                            family_id: transaction.family_id
                        },
                        attributes: ['id', 'child_name', 'relationship_to_parent']
                    });

                    paidChildrenDetails = familyChildren.map(fc => ({
                        childId: fc.id,
                        childName: fc.child_name || 'N/A',
                        relationshipToParent: fc.relationship_to_parent || 'N/A',
                        planDescription: 'N/A',
                        amount: 0
                    }));

                    console.log('[getFamilyPaymentById] Fallback: Fetched from FamilyChild:', paidChildrenDetails);
                } catch (fallbackError) {
                    console.error('[getFamilyPaymentById] Fallback error:', fallbackError);
                }
            }
        }

        // Confirm with PayPlus whether this payment has an active recurring subscription (before refund modal)
        let hasRecurringAtPayPlus = false;
        if (transaction.payment_type === 'recurring' && transaction.payplus_transaction_id) {
            try {
                const recurringPayment = await RecurringPayment.findOne({
                    where: {
                        transaction_id: transaction.payplus_transaction_id,
                        status: { [Op.in]: ['pending', 'paid', 'active'] }
                    }
                });
                if (recurringPayment) {
                    let recurringPaymentUid = null;
                    if (recurringPayment.webhook_data) {
                        try {
                            const webhookData = typeof recurringPayment.webhook_data === 'string'
                                ? JSON.parse(recurringPayment.webhook_data)
                                : recurringPayment.webhook_data;
                            recurringPaymentUid = webhookData.recurring_payment_uid || webhookData.original_webhook?.recurring_payment_uid;
                        } catch (e) {
                            // ignore parse error
                        }
                    }
                    if (!recurringPaymentUid) {
                        recurringPaymentUid = recurringPayment.payplus_transaction_uid;
                    }
                    if (recurringPaymentUid && recurringPaymentUid !== 'N/A' && recurringPaymentUid !== '') {
                        const check = await checkRecurringExistsAtPayPlus(recurringPaymentUid);
                        hasRecurringAtPayPlus = check.exists === true;
                    }
                }
            } catch (err) {
                console.error('[getFamilyPaymentById] Error checking PayPlus recurring:', err?.message || err);
            }
        }

        const formattedTransaction = {
            id: transaction.id,
            transactionToken: transaction.transaction_token,
            payplusTransactionId: transaction.payplus_transaction_id,
            familyId: transaction.family_id,
            family: transaction.family ? {
                id: transaction.family.id,
                parentName: transaction.family.parent_name,
                parentEmail: transaction.family.parent_email,
                parentPhone: transaction.family.parent_phone,
                parentCountryCode: transaction.family.parent_country_code,
                parentAddress: transaction.family.parent_address,
                familyNotes: transaction.family.family_notes,
                status: transaction.family.status
            } : null,
            paymentLink: transaction.paymentLink ? {
                id: transaction.paymentLink.id,
                linkToken: transaction.paymentLink.link_token,
                description: transaction.paymentLink.description,
                customNote: transaction.paymentLink.custom_note,
                totalAmount: parseFloat(transaction.paymentLink.total_amount),
                currency: transaction.paymentLink.currency,
                paymentType: transaction.paymentLink.payment_type,
                createdAt: transaction.paymentLink.created_at
            } : null,
            paidChildrenIds: transaction.paid_children_ids,
            studentIds: transaction.student_ids,
            subscriptionIds: transaction.subscription_ids,
            paidChildrenDetails: paidChildrenDetails,
            amount: parseFloat(transaction.amount),
            currency: transaction.currency,
            paymentType: transaction.payment_type,
            status: transaction.status,
            paymentMethod: transaction.payment_method,
            cardLastDigits: transaction.card_last_digits,
            payplusResponseData: transaction.payplus_response_data,
            errorCode: transaction.error_code,
            errorMessage: transaction.error_message,
            processedAt: transaction.processed_at,
            createdAt: transaction.created_at,
            updatedAt: transaction.updated_at,
            // Refund-related fields
            refundAmount: transaction.refund_amount ? parseFloat(transaction.refund_amount) : null,
            refundType: transaction.refund_type || null,
            refundReason: transaction.refund_reason || null,
            refundDate: transaction.refund_date || null,
            refundProcessedByName: transaction.refund_processed_by_name || null,
            emailNotificationSent: transaction.email_notification_sent === true || transaction.email_notification_sent === 1 || transaction.email_notification_sent === '1',
            hasRecurringAtPayPlus
        };

        return res.status(200).json({
            status: 'success',
            data: formattedTransaction,
            message: 'Family payment transaction retrieved successfully'
        });

    } catch (error) {
        console.error('Error fetching family payment by ID:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch family payment transaction',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Enhanced refund processing for family payment transactions
 * Handles PayPlus refund, children subscription cancellations, lesson deductions, and email notifications
 */
const refundFamilyPayment = async (req, res) => {
    let dbTransaction;
    
    try {
        dbTransaction = await sequelize.transaction();
        
        const { id } = req.params;
        const {
            type,
            amount,
            reason,
            customReason,
            sendEmailNotification = true,
            cancelRecurringPayment = true,
            childrenActions = []
        } = req.body;

        // Validate input
        if (!type || !['full', 'partial'].includes(type)) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Refund type must be either "full" or "partial"'
            });
        }
        
        if (!reason) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Refund reason is required'
            });
        }
        
        if (type === 'partial' && (!amount || amount <= 0)) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Valid refund amount is required for partial refunds'
            });
        }

        // Find the family payment transaction
        const transaction = await FamilyPaymentTransaction.findByPk(id, {
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name', 'parent_email', 'parent_phone', 'parent_country_code']
                }
            ],
            transaction: dbTransaction
        });

        if (!transaction) {
            await dbTransaction.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Family payment transaction not found'
            });
        }

        if (transaction.status !== 'success') {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Only successful payments can be refunded'
            });
        }

        // Calculate refund amount
        const totalAmount = parseFloat(transaction.amount);
        const refundAmount = type === 'full'
            ? totalAmount
            : parseFloat(amount || 0);

        let invalidAmount = false;

        if (type === 'full') {
            // For full refunds, the amount must match the full payment
            if (isNaN(refundAmount) || Math.abs(refundAmount - totalAmount) > 0.01) {
                invalidAmount = true;
            }
        } else {
            // For partial refunds, must be strictly less than the full amount
            if (isNaN(refundAmount) || refundAmount <= 0 || refundAmount >= totalAmount) {
                invalidAmount = true;
            }
        }

        if (invalidAmount) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Invalid refund amount'
            });
        }

        // Get transaction UID for PayPlus
        const transactionUid = transaction.payplus_transaction_id || transaction.transaction_token;
        if (!transactionUid) {
            await dbTransaction.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Transaction UID not available for refund processing'
            });
        }

        // Process PayPlus refund
        const refundReason = customReason || reason;
        const payplusRefund = await processFamilyPaymentRefund(
            transactionUid,
            refundAmount,
            transaction.currency,
            refundReason
        );

        let refundTransactionUid;

        if (!payplusRefund.success) {
            const rawError = (payplusRefund.error || '').toString();
            const processorDesc = (payplusRefund.payplusResponse?.results?.description || '').toString();
            const combined = `${rawError} ${processorDesc}`.toLowerCase();

            const looksAlreadyRefunded =
                combined.includes('already refunded') ||
                combined.includes('no refundable amount') ||
                combined.includes('amount exceeds') ||
                combined.includes('refund not allowed') ||
                combined.includes('duplicate');

            if (looksAlreadyRefunded) {
                // PayPlus says this transaction cannot be refunded again (likely already refunded).
                // Treat this as "no-op" on the processor side but continue with internal refund
                // so admin can still issue an additional credit without touching PayPlus.
                console.warn('[refundFamilyPayment] PayPlus refund not allowed (likely already refunded). Continuing with internal refund only.', {
                    error: rawError,
                    description: processorDesc
                });
                refundTransactionUid = `local_refund_${Date.now()}`;
            } else {
                await dbTransaction.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Refund processing failed with payment processor',
                    details: payplusRefund.error,
                    payplusResponse: payplusRefund.payplusResponse
                });
            }
        } else {
            refundTransactionUid = payplusRefund.refundTransactionUid;
        }

        // Parse paid children details
        let paidChildrenDetails = [];
        if (transaction.paid_children_details) {
            try {
                let parsed = transaction.paid_children_details;
                if (typeof parsed === 'string') {
                    parsed = JSON.parse(parsed);
                }
                if (Array.isArray(parsed)) {
                    paidChildrenDetails = parsed;
                } else if (parsed && typeof parsed === 'object') {
                    paidChildrenDetails = [parsed];
                }
            } catch (parseError) {
                console.error('Error parsing paid_children_details:', parseError);
            }
        }

        // Cancel family recurring payment if requested
        let familyRecurringCancelled = false;
        if (cancelRecurringPayment && transaction.payment_type === 'recurring') {
            try {
                // Get payplus_transaction_id from family_payment_transactions table
                const payplusTransactionId = transaction.payplus_transaction_id;
                
                if (!payplusTransactionId) {
                    console.log(`[refundFamilyPayment] No payplus_transaction_id found for transaction ${transaction.id}`);
                } else {
                    console.log(`[refundFamilyPayment] Looking for recurring payment with payplus_transaction_uid: ${payplusTransactionId}`);
                    
                    // Find the corresponding recurring payment using payplus_transaction_uid
                    const recurringPayment = await RecurringPayment.findOne({
                        where: {
                            transaction_id: payplusTransactionId,
                            status: { [Op.in]: ['pending', 'paid', 'active'] }
                        },
                        transaction: dbTransaction
                    });

                    if (!recurringPayment) {
                        console.log(`[refundFamilyPayment] No recurring payment found with payplus_transaction_uid: ${payplusTransactionId}`);
                    } else {
                        console.log(`[refundFamilyPayment] Found recurring payment record ID: ${recurringPayment.id}`);
                        
                        // Get recurring_payment_uid from the recurring payment record
                        let recurringPaymentUid = null;
                        
                        // First try to get from webhook_data
                        if (recurringPayment.webhook_data) {
                            try {
                                const webhookData = typeof recurringPayment.webhook_data === 'string' 
                                    ? JSON.parse(recurringPayment.webhook_data) 
                                    : recurringPayment.webhook_data;
                                recurringPaymentUid = webhookData.recurring_payment_uid || webhookData.original_webhook?.recurring_payment_uid;
                            } catch (e) {
                                console.error('Error parsing recurring payment webhook data:', e);
                            }
                        }

                        // If not found in webhook_data, use payplus_transaction_uid as fallback
                        if (!recurringPaymentUid) {
                            recurringPaymentUid = recurringPayment.payplus_transaction_uid;
                        }

                        if (recurringPaymentUid && recurringPaymentUid !== 'N/A' && recurringPaymentUid !== '') {
                            console.log(`[refundFamilyPayment] Cancelling family recurring payment at PayPlus: ${recurringPaymentUid}`);
                            familyRecurringCancelled = await cancelFamilyRecurringPayment(recurringPaymentUid);
                            
                            if (familyRecurringCancelled) {
                                console.log(`[refundFamilyPayment] Successfully cancelled family recurring payment at PayPlus: ${recurringPaymentUid}`);
                                
                                // Update recurring payment status to cancelled
                                await recurringPayment.update({
                                    status: 'cancelled',
                                    is_active: false,
                                    cancelled_at: new Date(),
                                    cancelled_by: req.user?.id || 'admin',
                                    remarks: (recurringPayment.remarks || '') + `\n[${new Date().toISOString()}] REFUND CANCELLATION: Family payment refund - ${refundReason}`
                                }, { transaction: dbTransaction });
                                
                                console.log(`[refundFamilyPayment] Updated recurring payment record ${recurringPayment.id} status to cancelled`);
                            } else {
                                console.warn(`[refundFamilyPayment] Failed to cancel family recurring payment at PayPlus: ${recurringPaymentUid}`);
                            }
                        } else {
                            console.log(`[refundFamilyPayment] No recurring payment UID found in recurring payment record ${recurringPayment.id}`);
                        }
                    }
                }
            } catch (recurringError) {
                console.error(`[refundFamilyPayment] Error cancelling family recurring payment:`, recurringError);
                // Don't fail the refund if recurring payment cancellation fails
            }
        }

        // Process children actions
        // Map paid_children_ids -> student_ids / subscription_ids so we always resolve subscriptions by student_id
        let paidChildrenIdsArray = [];
        let studentIdsArray = [];
        let subscriptionIdsArray = [];

        try {
            if (transaction.paid_children_ids) {
                paidChildrenIdsArray = Array.isArray(transaction.paid_children_ids)
                    ? transaction.paid_children_ids
                    : JSON.parse(transaction.paid_children_ids);
            }
        } catch (e) {
            console.error('[refundFamilyPayment] Error parsing paid_children_ids:', e);
        }

        try {
            if (transaction.student_ids) {
                studentIdsArray = Array.isArray(transaction.student_ids)
                    ? transaction.student_ids
                    : JSON.parse(transaction.student_ids);
            }
        } catch (e) {
            console.error('[refundFamilyPayment] Error parsing student_ids:', e);
        }

        try {
            if (transaction.subscription_ids) {
                subscriptionIdsArray = Array.isArray(transaction.subscription_ids)
                    ? transaction.subscription_ids
                    : JSON.parse(transaction.subscription_ids);
            }
        } catch (e) {
            console.error('[refundFamilyPayment] Error parsing subscription_ids:', e);
        }

        const childrenResults = [];
        for (const childAction of childrenActions) {
            try {
                // Ensure we have studentId/subscriptionId based on student_ids mapping
                let effectiveStudentId = childAction.studentId;
                let effectiveSubscriptionId = childAction.subscriptionId;

                if ((!effectiveStudentId || !effectiveSubscriptionId) && paidChildrenIdsArray.length && studentIdsArray.length) {
                    const idx = paidChildrenIdsArray.findIndex(
                        (id) => Number(id) === Number(childAction.childId)
                    );
                    if (idx !== -1) {
                        if (!effectiveStudentId && studentIdsArray[idx] != null) {
                            effectiveStudentId = Number(studentIdsArray[idx]);
                        }
                        if (!effectiveSubscriptionId && subscriptionIdsArray[idx] != null) {
                            effectiveSubscriptionId = Number(subscriptionIdsArray[idx]);
                        }
                    }
                }

                const enrichedChildAction = {
                    ...childAction,
                    studentId: effectiveStudentId,
                    subscriptionId: effectiveSubscriptionId
                };

                const childResult = await processChildRefundAction(
                    enrichedChildAction,
                    paidChildrenDetails,
                    transaction,
                    refundAmount,
                    type,
                    refundReason,
                    req.user?.id || 'admin',
                    dbTransaction
                );
                childrenResults.push(childResult);
            } catch (childError) {
                console.error(`Error processing child action for child ${childAction.childId}:`, childError);
                childrenResults.push({
                    childId: childAction.childId,
                    childName: childAction.childName,
                    success: false,
                    error: childError.message
                });
            }
        }

        // Send email notification if requested
        let emailSent = false;
        if (sendEmailNotification && transaction.family) {
            emailSent = await sendFamilyRefundEmailNotification(
                transaction,
                refundAmount,
                type,
                refundReason,
                childrenResults
            );
        }

        // Update transaction status
        await transaction.update({
            status: 'refunded',
            refund_amount: refundAmount,
            refund_type: type,
            refund_reason: refundReason,
            refund_date: new Date(),
            refund_processed_by: req.user?.id || null,
            refund_processed_by_name: req.user?.full_name || 'Admin User',
            email_notification_sent: emailSent,
            // error_message: `Refunded: ${refundReason}`,
            updated_at: new Date()
        }, { transaction: dbTransaction });

        await dbTransaction.commit();

        // Prepare comprehensive response
        return res.status(200).json({
            status: 'success',
            message: `${type === 'full' ? 'Full' : 'Partial'} refund processed successfully`,
            data: {
                refundId: transaction.id,
                refundTransactionUid: refundTransactionUid,
                refundType: type,
                refundAmount: refundAmount,
                refundCurrency: transaction.currency,
                originalAmount: parseFloat(transaction.amount),
                familyName: transaction.family?.parent_name,
                familyEmail: transaction.family?.parent_email,
                refundReason: refundReason,
                emailNotificationSent: emailSent,
                familyRecurringPaymentCancelled: familyRecurringCancelled,
                refundDate: new Date(),
                processedBy: req.user?.full_name || 'Admin User',
                childrenResults: childrenResults,
                payplusReference: refundTransactionUid
            }
        });

    } catch (error) {
        if (dbTransaction) {
            await dbTransaction.rollback();
        }
        
        console.error('Error refunding family payment:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to process refund',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Process refund action for a single child
 */
const processChildRefundAction = async (childAction, paidChildrenDetails, transaction, refundAmount, refundType, refundReason, adminId, dbTransaction) => {
    console.log('childAction :',childAction);
    console.log('paidChildrenDetails :',paidChildrenDetails);
    console.log('transaction :',transaction);
    console.log('refundAmount :',refundAmount);
    console.log('refundType :',refundType);
    console.log('refundReason :',refundReason);
    console.log('adminId :',adminId);
    console.log('dbTransaction :',dbTransaction);
    const { childId, childName, studentId, subscriptionId, lessonsToDeduct, deductLessons, subscriptionAction, acknowledgeUsedLessons } = childAction;
    
    const result = {
        childId,
        childName,
        success: true,
        lessonsDeducted: 0,
        subscriptionAction: null,
        recurringPaymentsCancelled: 0,
        errors: []
    };

    try {
        // Find child details
        const childDetail = paidChildrenDetails.find(c => (c.childId || c.child_id) === childId);
        
        if (!studentId) {
            result.errors.push('Student ID not found for child');
            return result;
        }
        console.log('studentId :',studentId);
        console.log('childDetail :',childDetail);

        // Get child's subscription - look for active or inactive subscriptions
        const subscription = await UserSubscriptionDetails.findOne({
            where: {
                user_id: studentId,
                status: { [Op.in]: ['active', 'inactive'] }
            },
            order: [['created_at', 'DESC']], // Get the most recent subscription
            transaction: dbTransaction
        });

        console.log(`[processChildRefundAction] Child ${childId} (${childName}), Student ID: ${studentId}, Subscription found: ${!!subscription}, Status: ${subscription?.status || 'N/A'}, Action: ${subscriptionAction}`);

        const hasManageableSubscription = !!subscription && subscription.status === 'active' && subscription.inactive_after_renew !== 1;
        const hasSubscription = !!subscription; // For cancel operations, we just need a subscription to exist

        // If cancel_immediate is requested but no subscription found, log error
        if (subscriptionAction === 'cancel_immediate' && !hasSubscription) {
            console.error(`[processChildRefundAction] Cannot cancel subscription immediately for child ${childId} (${childName}): No subscription found for student ID ${studentId}`);
            result.errors.push(`No subscription found for child ${childName}. Cannot cancel subscription.`);
            result.success = false;
            return result;
        }

        // Process lesson deduction if requested
        if (deductLessons && lessonsToDeduct > 0 && hasManageableSubscription) {
            try {
                // Validate lesson deduction
                const usedLessons = await Class.count({
                    where: {
                        student_id: studentId,
                        status: 'ended',
                        bonus_class: false,
                        created_at: {
                            [Op.gte]: subscription.lesson_reset_at || subscription.created_at
                        }
                    },
                    transaction: dbTransaction
                });

                const remainingLessons = subscription.left_lessons || 0;
                const wouldCreateDebt = lessonsToDeduct > remainingLessons;

                if (wouldCreateDebt && !acknowledgeUsedLessons) {
                    result.errors.push(`Cannot deduct ${lessonsToDeduct} lessons. Child has only ${remainingLessons} remaining.`);
                    result.success = false;
                    return result;
                }

                // Deduct lessons
                const newLeftLessons = Math.max(0, remainingLessons - lessonsToDeduct);
                await subscription.update({
                    left_lessons: newLeftLessons,
                    updated_at: new Date()
                }, { transaction: dbTransaction });

                result.lessonsDeducted = lessonsToDeduct;
                console.log(`[processChildRefundAction] Deducted ${lessonsToDeduct} lessons from child ${childId} (${childName})`);
            } catch (lessonError) {
                console.error(`Error deducting lessons for child ${childId}:`, lessonError);
                result.errors.push(`Failed to deduct lessons: ${lessonError.message}`);
            }
        }

        // Process subscription action if requested
        // For cancel_immediate, we need any subscription (active or inactive)
        // For cancel_renewal, we need an active manageable subscription
        const canCancelImmediate = hasSubscription && subscriptionAction === 'cancel_immediate';
        const canCancelRenewal = hasManageableSubscription && subscriptionAction === 'cancel_renewal';
        
        if ((canCancelImmediate || canCancelRenewal) && subscriptionAction !== 'continue') {
            try {
                const cancellationReason = `Family payment ${refundType} refund: ${refundReason}`;
                
                if (subscriptionAction === 'cancel_immediate') {
                    // Cancel subscription immediately
                    const updateResult = await subscription.update({
                        status: 'inactive',
                        is_cancel: 1,
                        cancellation_date: new Date(),
                        cancelled_by_user_id: adminId,
                        cancellation_reason: cancellationReason,
                        left_lessons: 0,
                        updated_at: new Date()
                    }, { transaction: dbTransaction });

                    console.log(`[processChildRefundAction] Canceled subscription immediately for child ${childId} (${childName}), Student ID: ${studentId}, Subscription ID: ${subscription.id}, Update result:`, updateResult);

                    // Clear user's subscription info
                    const userUpdateResult = await User.update({
                        subscription_id: null,
                        subscription_type: null
                    }, {
                        where: { id: studentId },
                        transaction: dbTransaction
                    });

                    console.log(`[processChildRefundAction] Cleared subscription info for user ${studentId}, Updated rows: ${userUpdateResult[0]}`);

                    // Keep family_children in sync with admin subscriptions list (status filter)
                    if (childId) {
                        const fcResult = await FamilyChild.update(
                            {
                                status: 'cancelled',
                                payplus_subscription_id: null,
                                next_payment_date: null
                            },
                            {
                                where: { id: childId },
                                transaction: dbTransaction
                            }
                        );
                        console.log(
                            `[processChildRefundAction] FamilyChild ${childId} marked cancelled, rows:`,
                            fcResult[0]
                        );
                    }

                    // Cancel pending classes
                    const classUpdateResult = await Class.update({
                        status: 'canceled',
                        cancelled_at: new Date(),
                        cancellation_reason: cancellationReason
                    }, {
                        where: {
                            student_id: studentId,
                            status: 'pending'
                        },
                        transaction: dbTransaction
                    });

                    console.log(`[processChildRefundAction] Canceled pending classes for student ${studentId}, Updated classes: ${classUpdateResult[0]}`);

                    result.subscriptionAction = 'cancel_immediate';
                } else if (subscriptionAction === 'cancel_renewal') {
                    // Set to cancel after renewal
                    await subscription.update({
                        inactive_after_renew: 1,
                        cancellation_date: new Date(),
                        cancelled_by_user_id: adminId,
                        cancellation_reason: cancellationReason,
                        updated_at: new Date()
                    }, { transaction: dbTransaction });

                    result.subscriptionAction = 'cancel_renewal';
                }

                // Cancel recurring payments if subscription is being cancelled
                if (subscriptionAction === 'cancel_immediate' || subscriptionAction === 'cancel_renewal') {
                    const recurringPayments = await RecurringPayment.findAll({
                        where: {
                            student_id: studentId,
                            status: { [Op.in]: ['pending', 'paid'] }
                        },
                        transaction: dbTransaction
                    });

                    let cancelledCount = 0;
                    for (const recurringPayment of recurringPayments) {
                        try {
                            // Get recurring payment UID
                            let recurringUid = null;
                            if (recurringPayment.webhook_data) {
                                try {
                                    const webhookData = typeof recurringPayment.webhook_data === 'string' 
                                        ? JSON.parse(recurringPayment.webhook_data) 
                                        : recurringPayment.webhook_data;
                                    recurringUid = webhookData.recurring_payment_uid || webhookData.original_webhook?.recurring_payment_uid;
                                } catch (e) {
                                    console.error('Error parsing webhook data:', e);
                                }
                            }

                            if (!recurringUid && recurringPayment.payplus_transaction_uid) {
                                recurringUid = recurringPayment.payplus_transaction_uid;
                            }

                        cancelledCount++;
                        } catch (recurringError) {
                            console.error(`Error cancelling recurring payment ${recurringPayment.id}:`, recurringError);
                        }
                    }

                    result.recurringPaymentsCancelled = cancelledCount;
                }
            } catch (subscriptionError) {
                console.error(`Error processing subscription action for child ${childId}:`, subscriptionError);
                result.errors.push(`Failed to process subscription action: ${subscriptionError.message}`);
            }
        }

        return result;
    } catch (error) {
        console.error(`Error processing child refund action for child ${childId}:`, error);
        result.success = false;
        result.errors.push(error.message);
        return result;
    }
};

/**
 * Get child lesson data for refund processing
 * Similar to getStudentLessonData but for children in family payments
 */
const getChildLessonData = async (req, res) => {
    try {
        const { studentId } = req.params;
        
        console.log(`[getChildLessonData] Fetching lesson data for student ID: ${studentId}`);
        
        // Verify the student exists
        const student = await User.findByPk(studentId, {
            attributes: ['id', 'full_name', 'email']
        });
        
        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }
        
        // Get student's active subscription
        const subscription = await UserSubscriptionDetails.findOne({
            where: { 
                user_id: studentId,
                status: 'active'
            }
        });
        
        if (!subscription) {
            return res.status(200).json({
                status: 'success',
                data: {
                    child_name: student.full_name, // User's full name
                    user_email: student.email, // User's email
                    user_id: student.id, // User ID
                    total_lessons: 0,
                    used_lessons: 0,
                    remaining_lessons: 0,
                    bonus_lessons: 0,
                    last_renewal_lessons: 0,
                    subscription_status: null,
                    inactive_after_renew: null,
                    has_manageable_subscription: false,
                    subscription_id: null,
                    subscription_details: null
                },
                message: 'No active subscription found for student'
            });
        }
        
        // Calculate subscription period start date
        // For reporting we want the period starting one month before the current reset date
        // If lesson_reset_at is not set yet, fall back to created_at
        let subscriptionStartDate;
        if (subscription.lesson_reset_at) {
            subscriptionStartDate = moment(subscription.lesson_reset_at).subtract(1, 'month').toDate();
        } else {
            subscriptionStartDate = subscription.created_at;
        }
        
        // Calculate lessons used since last reset (regular lessons only)
        const usedRegularLessons = await Class.count({
            where: {
                student_id: studentId,
                bonus_class: false,
                is_regular_hide: 0,
                created_at: {
                    [Op.gte]: subscriptionStartDate
                }
            }
        });
        
        // Calculate bonus lessons used since last reset
        const usedBonusLessons = await Class.count({
            where: {
                student_id: studentId,
                is_regular_hide: 0,
                bonus_class: true,
                created_at: {
                    [Op.gte]: subscriptionStartDate
                }
            }
        });
        
        // Get current lesson balances from subscription
        const leftLessons = subscription.left_lessons || 0;
        const bonusLessonsAvailable = subscription.bonus_class || 0;
        const weeklyLessons = subscription.weekly_lesson || 0;
        
        // Calculate total lessons: Use the sum of used + remaining as the actual total
        // This represents the total lessons allocated for the current subscription period
        const totalLessons = usedRegularLessons + leftLessons;
        
        // Determine if subscription is manageable
        const hasManageableSubscription =
            subscription.status === 'active' &&
            subscription.inactive_after_renew !== 1;

        const lessonData = {
            child_name: student.full_name, // User's full name
            user_email: student.email, // User's email
            user_id: student.id, // User ID
            total_lessons: totalLessons,
            used_lessons: usedRegularLessons,
            remaining_lessons: leftLessons,
            bonus_lessons: bonusLessonsAvailable,
            weekly_lessons: weeklyLessons,
            last_renewal_lessons: leftLessons,
            subscription_status: subscription.status,
            inactive_after_renew: subscription.inactive_after_renew,
            has_manageable_subscription: hasManageableSubscription,
            lesson_reset_date: subscription.lesson_reset_at,
            subscription_created: subscription.created_at,
            // Add subscription details
            subscription_id: subscription.id,
            subscription_details: {
                id: subscription.id,
                status: subscription.status,
                weekly_lesson: subscription.weekly_lesson,
                left_lessons: subscription.left_lessons,
                bonus_class: subscription.bonus_class,
                lesson_reset_at: subscription.lesson_reset_at,
                inactive_after_renew: subscription.inactive_after_renew,
                created_at: subscription.created_at,
                updated_at: subscription.updated_at
            }
        };
        
        return res.status(200).json({
            status: 'success',
            data: lessonData,
            message: 'Child lesson data retrieved successfully'
        });
        
    } catch (error) {
        console.error('[getChildLessonData] Error fetching child lesson data:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error while fetching lesson data',
            details: error.message
        });
    }
};

/**
 * Send refund email notification to family
 */
const sendFamilyRefundEmailNotification = async (transaction, refundAmount, refundType, reason, childrenResults) => {
    try {
        if (!transaction.family || !transaction.family.parent_email) {
            return false;
        }

        // Validate and convert amounts to numbers
        const numRefundAmount = typeof refundAmount === 'number' ? refundAmount : parseFloat(refundAmount);
        const numOriginalAmount = typeof transaction.amount === 'number' ? transaction.amount : parseFloat(transaction.amount);

        if (isNaN(numRefundAmount)) {
            console.error('[REFUND EMAIL] Invalid refund amount:', {
                refundAmount,
                type: typeof refundAmount,
                parsed: numRefundAmount
            });
            return false;
        }

        if (isNaN(numOriginalAmount)) {
            console.error('[REFUND EMAIL] Invalid original amount:', {
                originalAmount: transaction.amount,
                type: typeof transaction.amount,
                parsed: numOriginalAmount
            });
            return false;
        }

        const formatCurrency = (amount, currency) => {
            const symbols = { "ILS": "₪", "USD": "$", "EUR": "€", "GBP": "£" };
            const symbol = symbols[currency.toUpperCase()] || currency;
            // Ensure amount is a number
            const numAmount = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
            if (isNaN(numAmount)) {
                console.error('[REFUND EMAIL] formatCurrency received invalid amount:', { amount, type: typeof amount });
                return `${symbol}0.00 ${currency.toUpperCase()}`;
            }
            return `${symbol}${numAmount.toFixed(2)} ${currency.toUpperCase()}`;
        };

        const emailParams = {
            'family.name': transaction.family.parent_name,
            'amount': formatCurrency(numRefundAmount, transaction.currency),
            'currency': transaction.currency.toUpperCase(),
            'refund.type': refundType === 'full' ? 'Full Refund' : 'Partial Refund',
            'refund.reason': reason,
            'original.amount': formatCurrency(numOriginalAmount, transaction.currency),
            'transaction.id': transaction.transaction_token,
            'refund.date': new Date().toLocaleDateString(),
            'children.count': childrenResults ? childrenResults.length : 0,
            'support.email': process.env.SUPPORT_EMAIL || 'support@tulkka.com'
        };

        const recipientDetails = {
            email: transaction.family.parent_email,
            full_name: transaction.family.parent_name,
            language: 'EN' // Default, can be enhanced
        };

        const emailSent = await sendNotificationEmail(
            'family_payment_refund_notification',
            emailParams,
            recipientDetails,
            false
        );

        return emailSent;
    } catch (error) {
        console.error('Error sending family refund email notification:', error);
        return false;
    }
};

/**
 * Download credit invoice for a refunded family payment
 */
const downloadFamilyCreditInvoiceController = async (req, res) => {
    try {
        const { id } = req.params;
        const { type = 'original', format = 'pdf' } = req.query;

        // Find the family payment transaction
        const transaction = await FamilyPaymentTransaction.findByPk(id);

        if (!transaction) {
            return res.status(404).json({
                status: 'error',
                message: 'Family payment transaction not found'
            });
        }

        // Check if payment was refunded
        if (transaction.status !== 'refunded') {
            return res.status(400).json({
                status: 'error',
                message: 'Credit invoice is only available for refunded payments'
            });
        }

        // Get transaction UID
        const transactionUid = transaction.payplus_transaction_id || transaction.transaction_token;
        if (!transactionUid) {
            return res.status(400).json({
                status: 'error',
                message: 'Transaction UID not available for this payment'
            });
        }

        // Use service to download credit invoice
        await downloadFamilyCreditInvoice({
            transaction_uid: transactionUid,
            type,
            format,
            paymentId: id,
            res
        });

    } catch (error) {
        console.error('Error downloading family credit invoice:', error);
        if (!res.headersSent) {
            return res.status(500).json({
                status: 'error',
                message: 'Error downloading credit invoice',
                details: error.message
            });
        }
    }
};

module.exports = {
    getFamilyPayments,
    getFamilyPaymentById,
    refundFamilyPayment,
    downloadFamilyCreditInvoice: downloadFamilyCreditInvoiceController,
    getChildLessonData
};

