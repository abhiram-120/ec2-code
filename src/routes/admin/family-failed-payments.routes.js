const express = require('express');
const router = express.Router();
const familyFailedPaymentsController = require('../../controller/admin/family-failed-payments.controller');
const AuthValidator = require('../../middleware/admin-verify-token');
const { checkPermission } = require('../../middleware/check-permission');
const ensureFamilyFailedPaymentsAccess = checkPermission('family-payments', 'read');
const ensureFamilyFailedPaymentsUpdate = checkPermission('family-payments', 'update');

// Get family failed payments overview/dashboard
router.get('/overview', AuthValidator, ensureFamilyFailedPaymentsAccess, familyFailedPaymentsController.getFamilyFailedPaymentsOverview);

// Get family failed payments list with filtering and pagination
router.get('/list', AuthValidator, ensureFamilyFailedPaymentsAccess, familyFailedPaymentsController.getFamilyFailedPaymentsList);

// Get family collections list (canceled after grace period)
router.get('/collections', AuthValidator, ensureFamilyFailedPaymentsAccess, familyFailedPaymentsController.getFamilyCollectionsList);

// Get specific family failed payment details by ID
router.get('/:id', AuthValidator, ensureFamilyFailedPaymentsAccess, familyFailedPaymentsController.getFamilyFailedPaymentDetails);

// Family dunning schedule management
router.get('/:id/dunning', AuthValidator, ensureFamilyFailedPaymentsAccess, familyFailedPaymentsController.getFamilyDunningSchedule);
router.put('/:id/dunning/pause', AuthValidator, ensureFamilyFailedPaymentsUpdate, familyFailedPaymentsController.pauseFamilyDunningReminders);
router.put('/:id/dunning/resume', AuthValidator, ensureFamilyFailedPaymentsUpdate, familyFailedPaymentsController.resumeFamilyDunningReminders);
router.put('/:id/dunning/disable', AuthValidator, ensureFamilyFailedPaymentsUpdate, familyFailedPaymentsController.disableFamilyDunningReminders);
router.post('/:id/dunning/send-now', AuthValidator, ensureFamilyFailedPaymentsUpdate, familyFailedPaymentsController.sendFamilyReminderNow);

// Manual payment resolution
router.post('/:id/mark-paid', AuthValidator, ensureFamilyFailedPaymentsUpdate, familyFailedPaymentsController.markFamilyAsPaidManually);
router.post('/:id/cancel-immediately', AuthValidator, ensureFamilyFailedPaymentsUpdate, familyFailedPaymentsController.cancelFamilyImmediately);

// Copy payment recovery link
router.get('/:id/recovery-link', AuthValidator, ensureFamilyFailedPaymentsAccess, familyFailedPaymentsController.getFamilyRecoveryLink);

// Send WhatsApp message with recovery link (single)
router.post('/:id/send-whatsapp', AuthValidator, ensureFamilyFailedPaymentsUpdate, familyFailedPaymentsController.sendFamilyWhatsAppRecoveryLink);

// Bulk send WhatsApp reminders to multiple payments
router.post('/bulk-send-whatsapp', AuthValidator, ensureFamilyFailedPaymentsUpdate, familyFailedPaymentsController.bulkSendFamilyWhatsAppReminders);

// Export family failed payments data
router.get('/export/csv', AuthValidator, ensureFamilyFailedPaymentsAccess, familyFailedPaymentsController.exportFamilyFailedPayments);

// Statistics and metrics
router.get('/stats/dunning', AuthValidator, ensureFamilyFailedPaymentsAccess, familyFailedPaymentsController.getFamilyDunningStats);
router.get('/stats/recovery-rates', AuthValidator, ensureFamilyFailedPaymentsAccess, familyFailedPaymentsController.getFamilyRecoveryRates);
router.get('/stats/whatsapp', AuthValidator, ensureFamilyFailedPaymentsAccess, familyFailedPaymentsController.getFamilyWhatsAppStats);

module.exports = router;

