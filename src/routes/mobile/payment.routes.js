const express = require('express');
const router = express.Router();
const mobilePaymentController = require('../../controller/mobile/payment.controller');

// Public: userId is sent in body (page URL includes /trial-payment/[userId])
router.post('/trial-payment', mobilePaymentController.createGuidedTrialPaymentLink);

router.get('/subscription-plans', mobilePaymentController.getMobileSubscriptionPlans);
router.post('/subscription-checkout', mobilePaymentController.createMobileSubscriptionCheckout);

module.exports = router;
