const express = require('express');
const router = express.Router();
const faqController = require('../../controller/admin/faq.controller');
const AuthValidator = require('../../middleware/admin-verify-token');

// Admin FAQ routes
router.get('/faqs', AuthValidator, faqController.listFaqsPublic);
router.patch('/faqs/:id/status', AuthValidator,  faqController.updateFaqStatus);
router.post('/faqs', AuthValidator, faqController.conditionalFaqUpload, faqController.createFaq);
router.patch('/faqs/:id', AuthValidator, faqController.conditionalFaqUpload, faqController.updateFaq);
router.delete('/faqs/:id', AuthValidator, faqController.deleteFaq);

module.exports = router;
