// controller/mobile/payment.controller.js
// One-time PayPlus link for student mobile "Guided Trial Lesson" (89 ILS)

const axios = require('axios');
const moment = require('moment');
const User = require('../../models/users');
const PaymentLinks = require('../../models/payment_links');
const SubscriptionPlan = require('../../models/subscription_plan');
const SubscriptionDuration = require('../../models/subscription_duration');
const LessonLength = require('../../models/lesson_length');
const LessonsPerMonth = require('../../models/lessons_per_month');
const { paymentLogger } = require('../../utils/paymentLogger');

const ALLOWED_LESSON_MINUTES = [25, 40, 55];
const ALLOWED_LESSONS_PER_MONTH = [4, 8, 12, 16, 20];

/** Same as sales `generate-link-management.tsx` custom plan branch (basePrice / lesson scaling). */
const SALES_CUSTOM_PLAN_BASE_PRICE = 99;

function calculateSalesCustomPlanAmount(lessonMinutes, lessonsPerMonth, durationMonths) {
    const months =
        durationMonths != null && !Number.isNaN(Number(durationMonths)) && Number(durationMonths) > 0
            ? Number(durationMonths)
            : 1;
    const pricePerLesson = (SALES_CUSTOM_PLAN_BASE_PRICE / 4) * (Number(lessonMinutes) / 25);
    return parseFloat((pricePerLesson * Number(lessonsPerMonth) * months).toFixed(2));
}

/**
 * Same order as sales `calculatePlanPrice`: use subscription_plans.price when a monthly plan row exists
 * and price is valid; otherwise use the custom formula (generate-link-management custom branch).
 */
function resolveMobileSubscriptionAmount(plan, lessonMinutes, lessonsPerMonth) {
    const fallback = calculateSalesCustomPlanAmount(lessonMinutes, lessonsPerMonth, 1);
    if (!plan) {
        return { finalAmount: fallback, priceSource: 'calculated', effectivePlan: null };
    }
    const db = parseFloat(plan.price);
    if (!Number.isNaN(db) && db > 0) {
        return { finalAmount: db, priceSource: 'database', effectivePlan: plan };
    }
    return { finalAmount: fallback, priceSource: 'calculated', effectivePlan: plan };
}

const getPayPlusRecurringType = (durationType) => {
    if (!durationType || typeof durationType !== 'string') return 2;
    switch (durationType.toLowerCase()) {
        case 'daily':
            return 0;
        case 'weekly':
            return 1;
        case 'monthly':
        case 'quarterly':
        case 'yearly':
        default:
            return 2;
    }
};

const getPayPlusRecurringRange = (durationType, customMonths) => {
    const months = parseInt(customMonths, 10);
    if (!Number.isNaN(months) && months > 0) return months;
    if (!durationType || typeof durationType !== 'string') return 1;
    switch (durationType.toLowerCase()) {
        case 'daily':
        case 'weekly':
        case 'monthly':
            return 1;
        case 'quarterly':
            return 3;
        case 'yearly':
            return 12;
        default:
            return 1;
    }
};

/**
 * Same matching logic as sales payment generator: monthly billing (duration.months === 1).
 */
async function findMonthlyPlanBySelection(lessonMinutes, lessonsPerMonth) {
    const plans = await SubscriptionPlan.findAll({
        where: { status: 'active' },
        attributes: ['id', 'name', 'price', 'duration_id', 'lesson_length_id', 'lessons_per_month_id'],
        include: [
            {
                model: SubscriptionDuration,
                as: 'Duration',
                required: true,
                where: { status: 'active' }
            },
            {
                model: LessonLength,
                as: 'LessonLength',
                required: true,
                where: { status: 'active', minutes: lessonMinutes }
            },
            {
                model: LessonsPerMonth,
                as: 'LessonsPerMonth',
                required: true,
                where: { status: 'active', lessons: lessonsPerMonth }
            }
        ]
    });
    return plans.find((p) => p.Duration && Number(p.Duration.months) === 1) || null;
}

const generatePaymentShortId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i += 1) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

async function createUniquePaymentShortId() {
    for (let i = 0; i < 8; i += 1) {
        const sid = generatePaymentShortId();
        const existing = await PaymentLinks.findOne({ where: { short_id: sid } });
        if (!existing) return sid;
    }
    throw new Error('Could not generate unique payment short id');
}

const GUIDED_TRIAL_AMOUNT_ILS = 89;
/** PayPlus `pt` — same as sales "existing user" flows */
const PAYMENT_TYPE_EXISTING_USER = 'existing_user';
/** Short key `gto` — one-time guided trial: record payment only (see payment-success.controller) */
const GUIDED_TRIAL_ONE_TIME_FLAG = true;

const PAYPLUS_CONFIG = {
    apiKey: process.env.PAYPLUS_API_KEY || '',
    secretKey: process.env.PAYPLUS_SECRET_KEY || '',
    baseUrl: process.env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
    paymentPageUid: process.env.PAYPLUS_PAYMENT_PAGE_UID || '',
    terminalUid: process.env.PAYPLUS_TERMINAL_UID || ''
};

/**
 * POST /mobile/payment/trial-payment
 * Body: { userId: number } — creates a one-time 89 ILS PayPlus payment page link (no JWT).
 * Webhook: /api/sales/payment-callback/payplus-webhook (same as sales payments)
 */
const createGuidedTrialPaymentLink = async (req, res) => {
    try {
        const rawId = req.body.userId ?? req.body.user_id;
        const userId = parseInt(rawId, 10);
        if (rawId === undefined || rawId === null || rawId === '' || Number.isNaN(userId) || userId <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid userId is required in the request body',
                error_code: 'USER_ID_REQUIRED'
            });
        }

        // 1) Must exist in DB
        const user = await User.findByPk(userId, {
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'status']
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User does not exist in the database',
                error_code: 'USER_NOT_FOUND'
            });
        }

        // 2) Only active users may generate a payment link
        if (user.status !== 'active') {
            return res.status(403).json({
                status: 'error',
                message: 'User account is not active',
                error_code: 'USER_INACTIVE'
            });
        }

        if (!user.email || !String(user.email).trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'A valid email is required on your account to pay',
                error_code: 'EMAIL_REQUIRED'
            });
        }

        // 3) User exists and is eligible — create PayPlus link
        const finalAmount = GUIDED_TRIAL_AMOUNT_ILS;
        const currency = 'ILS';
        const planDescription = 'Guided Trial Lesson (one-time)';

        const additionalData = {
            pid: 1,
            sid: userId,
            tid: userId,
            uid: userId,
            lpm: 4,
            dt: 'monthly',
            lm: 25,
            m: 1,
            ir: false,
            spid: null,
            pt: PAYMENT_TYPE_EXISTING_USER,
            gto: GUIDED_TRIAL_ONE_TIME_FLAG
        };

        const jsonData = JSON.stringify(additionalData);
        const base64 = Buffer.from(jsonData).toString('base64');
        const encodedData = encodeURIComponent(base64);

        const customerData = {
            customer_name: user.full_name || 'Student',
            email: String(user.email).trim(),
            phone: user.mobile || ''
        };

        const payPlusRequest = {
            payment_page_uid: PAYPLUS_CONFIG.paymentPageUid,
            amount: finalAmount,
            currency_code: currency,
            sendEmailApproval: true,
            sendEmailFailure: true,
            send_failure_callback: true,
            successful_invoice: true,
            initial_invoice: true,
            send_customer_success_email: true,
            create_token: true,
            save_card_token: true,
            token_for_terminal_uid: PAYPLUS_CONFIG.terminalUid,
            refURL_success: `${process.env.FRONTEND_URL}/payment/payplus/success?channel=mobile&flow=trial`,
            refURL_failure: `${process.env.FRONTEND_URL}/payment/payplus/failed?channel=mobile&flow=trial`,
            refURL_callback: `${process.env.API_BASE_URL}/api/sales/payment-callback/payplus-webhook`,
            expiry_datetime: 999,
            customer: customerData,
            items: [
                {
                    name: planDescription,
                    quantity: 1,
                    price: finalAmount,
                    vat_type: 0
                }
            ],
            more_info: 'existing_user_guided_trial',
            more_info_1: String(userId),
            more_info_2: '25',
            more_info_3: '4',
            more_info_4: '1',
            more_info_5: encodedData,
            charge_method: 1,
            payments: 1
        };

        paymentLogger.logPaymentLinkGeneration({
            success: false,
            student_id: userId,
            student_email: user.email,
            student_name: user.full_name,
            amount: finalAmount,
            currency,
            request_details: {
                payment_type: PAYMENT_TYPE_EXISTING_USER,
                source: 'mobile_guided_trial'
            },
            generated_by: userId
        });

        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/PaymentPages/generateLink`,
            payPlusRequest,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT, 10) || 30000
            }
        );

        if (response.data.results.status !== 'success') {
            const msg = response.data.results.description || 'PayPlus API error';
            paymentLogger.logPaymentLinkGeneration({
                success: false,
                student_id: userId,
                student_email: user.email,
                student_name: user.full_name,
                amount: finalAmount,
                currency,
                error_details: { error_type: 'payplus_api_error', error_message: msg },
                generated_by: userId
            });
            return res.status(502).json({
                status: 'error',
                message: 'Failed to generate payment link',
                details: msg
            });
        }

        const paymentUrl = response.data.data.payment_page_link;
        const pageRequestUid = response.data.data.page_request_uid;

        const expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const shortId = await createUniquePaymentShortId();

        const paymentDataPayload = {
            payment_link: paymentUrl,
            sum: String(finalAmount),
            pdesc: 'Guided Trial Lesson (one-time)',
            student_name: user.full_name || 'Student',
            student_email: String(user.email).trim(),
            currency: 'ILS',
            duration_type: 'one_time',
            lesson_minutes: '25',
            lessons_per_month: '4',
            months: '1',
            custom_months: '1',
            is_recurring: false,
            mobile: user.mobile || '',
            country_code: user.country_code || '',
            expires_at: expirationDate.toISOString(),
            plan_id: 'mobile_guided_trial',
            salesperson_email: '',
            salesperson_role: ''
        };

        await PaymentLinks.create({
            short_id: shortId,
            payment_data: paymentDataPayload,
            expires_at: expirationDate,
            created_at: new Date(),
            status: 'active'
        });

        const frontendBase = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
        const checkoutUrl = frontendBase
            ? `${frontendBase}/payment/payplus/${shortId}`
            : null;

        paymentLogger.logPaymentLinkGeneration({
            success: true,
            student_id: userId,
            student_email: user.email,
            student_name: user.full_name,
            amount: finalAmount,
            currency,
            payment_url: paymentUrl,
            page_request_uid: pageRequestUid,
            request_details: {
                payment_type: PAYMENT_TYPE_EXISTING_USER,
                source: 'mobile_guided_trial',
                short_id: shortId
            },
            generated_by: userId
        });

        return res.status(200).json({
            status: 'success',
            message: 'Payment link created',
            data: {
                short_id: shortId,
                checkout_url: checkoutUrl,
                payment_link: paymentUrl,
                page_request_uid: pageRequestUid,
                amount: finalAmount,
                currency,
                qr_code_image: response.data.data.qr_code_image
            }
        });
    } catch (error) {
        console.error('createGuidedTrialPaymentLink:', error.response?.data || error.message);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create payment link',
            details: error.response?.data?.results?.description || error.message
        });
    }
};

/**
 * GET /mobile/payment/subscription-plans
 * Monthly subscription options + prices from subscription_plans (same catalog as /sales/payment generator).
 */
const getMobileSubscriptionPlans = async (req, res) => {
    try {
        const plans = await SubscriptionPlan.findAll({
            where: { status: 'active' },
            attributes: ['id', 'name', 'price'],
            include: [
                {
                    model: SubscriptionDuration,
                    as: 'Duration',
                    required: true,
                    where: { status: 'active' }
                },
                {
                    model: LessonLength,
                    as: 'LessonLength',
                    required: true,
                    where: { status: 'active' }
                },
                {
                    model: LessonsPerMonth,
                    as: 'LessonsPerMonth',
                    required: true,
                    where: { status: 'active' }
                }
            ]
        });

        const monthly = plans.filter((p) => p.Duration && Number(p.Duration.months) === 1);

        const byKey = new Map();
        for (const p of monthly) {
            const lm = Number(p.LessonLength.minutes);
            const lpm = Number(p.LessonsPerMonth.lessons);
            if (!ALLOWED_LESSON_MINUTES.includes(lm) || !ALLOWED_LESSONS_PER_MONTH.includes(lpm)) {
                continue;
            }
            const key = `${lm}-${lpm}`;
            const { finalAmount, priceSource } = resolveMobileSubscriptionAmount(p, lm, lpm);
            byKey.set(key, {
                plan_id: p.id,
                plan_name: p.name,
                lesson_minutes: lm,
                lessons_per_month: lpm,
                price: finalAmount,
                price_source: priceSource,
                currency: 'ILS',
                duration_type: (p.Duration.name || 'monthly').toLowerCase()
            });
        }

        const items = [];
        for (const lm of ALLOWED_LESSON_MINUTES) {
            for (const lpm of ALLOWED_LESSONS_PER_MONTH) {
                const key = `${lm}-${lpm}`;
                if (byKey.has(key)) {
                    items.push(byKey.get(key));
                } else {
                    items.push({
                        plan_id: null,
                        plan_name: null,
                        lesson_minutes: lm,
                        lessons_per_month: lpm,
                        price: calculateSalesCustomPlanAmount(lm, lpm, 1),
                        price_source: 'calculated',
                        currency: 'ILS',
                        duration_type: 'monthly'
                    });
                }
            }
        }

        items.sort(
            (a, b) =>
                a.lesson_minutes - b.lesson_minutes || a.lessons_per_month - b.lessons_per_month
        );

        return res.status(200).json({
            status: 'success',
            data: {
                plans: items,
                allowed_lesson_minutes: ALLOWED_LESSON_MINUTES,
                allowed_lessons_per_month: ALLOWED_LESSONS_PER_MONTH
            }
        });
    } catch (error) {
        console.error('getMobileSubscriptionPlans:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to load subscription plans',
            details: error.message
        });
    }
};

/**
 * POST /mobile/payment/subscription-checkout
 * Body: { userId, lesson_minutes, lessons_per_month, is_recurring?, recur_start_date? }
 * — PayPlus link + short checkout URL (same flags as sales `generatePaymentLink`).
 */
const createMobileSubscriptionCheckout = async (req, res) => {
    try {
        const rawId = req.body.userId ?? req.body.user_id;
        const userId = parseInt(rawId, 10);
        const lessonMinutes = parseInt(req.body.lesson_minutes ?? req.body.lessonMinutes, 10);
        const lessonsPerMonth = parseInt(
            req.body.lessons_per_month ?? req.body.lessonsPerMonth,
            10
        );

        const hasExplicitRecurring =
            req.body.is_recurring !== undefined &&
            req.body.is_recurring !== null &&
            req.body.is_recurring !== '';
        const isRecurring = hasExplicitRecurring
            ? req.body.is_recurring === true || req.body.is_recurring === 'true'
            : true;

        let recurStartDate = req.body.recur_start_date;
        if (
            typeof recurStartDate === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(recurStartDate.trim())
        ) {
            recurStartDate = recurStartDate.trim();
        } else {
            recurStartDate = moment().format('YYYY-MM-DD');
        }

        if (rawId === undefined || rawId === null || rawId === '' || Number.isNaN(userId) || userId <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid userId is required',
                error_code: 'USER_ID_REQUIRED'
            });
        }

        if (
            Number.isNaN(lessonMinutes) ||
            !ALLOWED_LESSON_MINUTES.includes(lessonMinutes) ||
            Number.isNaN(lessonsPerMonth) ||
            !ALLOWED_LESSONS_PER_MONTH.includes(lessonsPerMonth)
        ) {
            return res.status(400).json({
                status: 'error',
                message: `lesson_minutes must be one of ${ALLOWED_LESSON_MINUTES.join(', ')} and lessons_per_month one of ${ALLOWED_LESSONS_PER_MONTH.join(', ')}`,
                error_code: 'INVALID_PLAN_SELECTION'
            });
        }

        const user = await User.findByPk(userId, {
            attributes: ['id', 'full_name', 'email', 'mobile', 'country_code', 'status']
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User does not exist in the database',
                error_code: 'USER_NOT_FOUND'
            });
        }

        if (user.status !== 'active') {
            return res.status(403).json({
                status: 'error',
                message: 'User account is not active',
                error_code: 'USER_INACTIVE'
            });
        }

        if (!user.email || !String(user.email).trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'A valid email is required on your account to pay',
                error_code: 'EMAIL_REQUIRED'
            });
        }

        const plan = await findMonthlyPlanBySelection(lessonMinutes, lessonsPerMonth);
        const { finalAmount, priceSource, effectivePlan } = resolveMobileSubscriptionAmount(
            plan,
            lessonMinutes,
            lessonsPerMonth
        );

        if (!finalAmount || Number.isNaN(finalAmount) || finalAmount <= 0) {
            return res.status(500).json({
                status: 'error',
                message: 'Invalid subscription amount',
                error_code: 'INVALID_PLAN_PRICE'
            });
        }

        const currency = 'ILS';
        const durationType = effectivePlan
            ? (effectivePlan.Duration.name || 'monthly').toLowerCase()
            : 'monthly';
        const months = 1;
        const planDescription = effectivePlan
            ? effectivePlan.name ||
              `Subscription ${lessonMinutes}min / ${lessonsPerMonth} lessons`
            : `${durationType} Plan - ${lessonMinutes}min lessons - ${lessonsPerMonth} lessons/month`;

        const pidForPayload = effectivePlan?.id || 1;

        const additionalData = {
            pid: pidForPayload,
            sid: userId,
            tid: userId,
            uid: userId,
            lpm: lessonsPerMonth,
            dt: durationType,
            lm: lessonMinutes,
            m: months,
            ir: isRecurring,
            rsd: isRecurring ? recurStartDate : '',
            spid: null,
            pt: PAYMENT_TYPE_EXISTING_USER
        };

        const jsonData = JSON.stringify(additionalData);
        const base64 = Buffer.from(jsonData).toString('base64');
        const encodedData = encodeURIComponent(base64);

        const customerData = {
            customer_name: user.full_name || 'Student',
            email: String(user.email).trim(),
            phone: user.mobile || ''
        };

        const recurringType = getPayPlusRecurringType(durationType);
        const recurringRange = getPayPlusRecurringRange(durationType, months);
        let jumpPaymentValue = 30;
        if (months && parseInt(String(months), 10) > 0) {
            jumpPaymentValue = parseInt(String(months), 10) * 30;
        } else if (durationType === 'monthly') {
            jumpPaymentValue = 30;
        } else if (durationType === 'quarterly') {
            jumpPaymentValue = 90;
        } else if (durationType === 'yearly') {
            jumpPaymentValue = 365;
        }

        const payPlusRequest = {
            payment_page_uid: PAYPLUS_CONFIG.paymentPageUid,
            amount: finalAmount,
            currency_code: currency,
            sendEmailApproval: true,
            sendEmailFailure: true,
            send_failure_callback: true,
            successful_invoice: true,
            initial_invoice: true,
            send_customer_success_email: true,
            create_token: true,
            save_card_token: true,
            token_for_terminal_uid: PAYPLUS_CONFIG.terminalUid,
            refURL_success: `${process.env.FRONTEND_URL}/payment/payplus/success?channel=mobile&flow=subscription`,
            refURL_failure: `${process.env.FRONTEND_URL}/payment/payplus/failed?channel=mobile&flow=subscription`,
            refURL_callback: `${process.env.API_BASE_URL}/api/sales/payment-callback/payplus-webhook`,
            expiry_datetime: 999,
            customer: customerData,
            items: [
                {
                    name: planDescription,
                    quantity: 1,
                    price: finalAmount,
                    vat_type: 0
                }
            ],
            more_info: effectivePlan ? String(effectivePlan.id) : 'custom',
            more_info_1: String(userId),
            more_info_2: String(lessonMinutes),
            more_info_3: String(lessonsPerMonth),
            more_info_4: String(months),
            more_info_5: encodedData
        };

        if (isRecurring) {
            payPlusRequest.charge_method = 3;
            payPlusRequest.payments = 1;
            payPlusRequest.recurring_settings = {
                instant_first_payment: true,
                recurring_type: recurringType,
                recurring_range: recurringRange,
                number_of_charges: 0,
                start_date_on_payment_date: true,
                jump_payments: jumpPaymentValue,
                successful_invoice: true,
                customer_failure_email: true,
                send_customer_success_email: true
            };
        } else {
            payPlusRequest.charge_method = 1;
            payPlusRequest.payments = 1;
        }

        const response = await axios.post(
            `${PAYPLUS_CONFIG.baseUrl}/PaymentPages/generateLink`,
            payPlusRequest,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': PAYPLUS_CONFIG.apiKey,
                    'secret-key': PAYPLUS_CONFIG.secretKey
                },
                timeout: parseInt(process.env.PAYPLUS_TIMEOUT, 10) || 30000
            }
        );

        if (response.data.results.status !== 'success') {
            const msg = response.data.results.description || 'PayPlus API error';
            return res.status(502).json({
                status: 'error',
                message: 'Failed to generate payment link',
                details: msg
            });
        }

        const paymentUrl = response.data.data.payment_page_link;
        const pageRequestUid = response.data.data.page_request_uid;

        const expirationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const shortId = await createUniquePaymentShortId();

        const paymentDataPayload = {
            payment_link: paymentUrl,
            sum: String(finalAmount),
            pdesc: planDescription,
            student_name: user.full_name || 'Student',
            student_email: String(user.email).trim(),
            currency: 'ILS',
            duration_type: durationType,
            lesson_minutes: String(lessonMinutes),
            lessons_per_month: String(lessonsPerMonth),
            months: String(months),
            custom_months: String(months),
            is_recurring: isRecurring,
            recur_start_date: isRecurring ? recurStartDate : '',
            mobile: user.mobile || '',
            country_code: user.country_code || '',
            expires_at: expirationDate.toISOString(),
            plan_id: effectivePlan ? String(effectivePlan.id) : 'custom',
            salesperson_email: '',
            salesperson_role: ''
        };

        await PaymentLinks.create({
            short_id: shortId,
            payment_data: paymentDataPayload,
            expires_at: expirationDate,
            created_at: new Date(),
            status: 'active'
        });

        const frontendBase = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
        const checkoutUrl = frontendBase
            ? `${frontendBase}/payment/payplus/${shortId}`
            : null;

        return res.status(200).json({
            status: 'success',
            message: 'Subscription payment link created',
            data: {
                short_id: shortId,
                checkout_url: checkoutUrl,
                payment_link: paymentUrl,
                page_request_uid: pageRequestUid,
                amount: finalAmount,
                currency,
                plan_id: effectivePlan ? effectivePlan.id : null,
                plan_name: effectivePlan ? effectivePlan.name : null,
                price_source: priceSource,
                lesson_minutes: lessonMinutes,
                lessons_per_month: lessonsPerMonth,
                is_recurring: isRecurring,
                recur_start_date: isRecurring ? recurStartDate : null,
                qr_code_image: response.data.data.qr_code_image
            }
        });
    } catch (error) {
        console.error('createMobileSubscriptionCheckout:', error.response?.data || error.message);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to create subscription checkout',
            details: error.response?.data?.results?.description || error.message
        });
    }
};

module.exports = {
    createGuidedTrialPaymentLink,
    getMobileSubscriptionPlans,
    createMobileSubscriptionCheckout
};
