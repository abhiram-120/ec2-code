const express = require('express');
const router = express.Router();
const familyPaymentsController = require('../../controller/admin/family-payments.controller');
const familyPaymentController = require('../../controller/sales/family-payment.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureFamilyPaymentsAccess = checkPermission('family-payments', 'read');

// Get family payments list with pagination and filters
router.get('/', AuthValidator, ensureFamilyPaymentsAccess, familyPaymentsController.getFamilyPayments);

// Download invoice for a family payment transaction (admin route)
router.get('/invoice/:id', AuthValidator, ensureFamilyPaymentsAccess, familyPaymentController.downloadFamilyInvoice);

// Refund a family payment transaction (must come before /:id route)
router.post('/:id/refund', AuthValidator, ensureFamilyPaymentsAccess, familyPaymentsController.refundFamilyPayment);

// Download credit invoice for refunded family payment (must come before /:id route)
router.get('/:id/credit-invoice', AuthValidator, ensureFamilyPaymentsAccess, familyPaymentsController.downloadFamilyCreditInvoice);

// Get child lesson data for refund processing
router.get('/child/:studentId/lesson-data', AuthValidator, ensureFamilyPaymentsAccess, familyPaymentsController.getChildLessonData);

// Get single family payment transaction by ID
router.get('/:id', AuthValidator, ensureFamilyPaymentsAccess, familyPaymentsController.getFamilyPaymentById);

module.exports = router;

