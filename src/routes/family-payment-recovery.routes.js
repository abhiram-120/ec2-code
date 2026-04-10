const express = require('express');
const router = express.Router();
const familyFailedPaymentsController = require('../controller/admin/family-failed-payments.controller');

// Public routes for FAMILY payment recovery (no admin auth)
// These should be protected by the opaque short_id itself (unguessable) + backend validation

// Get family recovery page data
router.get('/:id/data', familyFailedPaymentsController.getFamilyRecoveryPageData);

// Update card for family recovery (add card + update recurring)
router.post('/:id/update-card', familyFailedPaymentsController.updateFamilyCardForRecovery);

module.exports = router;


