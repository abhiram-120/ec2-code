const express = require('express');
const router = express.Router();
const actionLogsController = require('../../controller/admin/action-logs.controller');
const AuthValidator = require('../../middleware/admin-verify-token');

router.get('/list', AuthValidator, actionLogsController.getActionLogs);
router.delete('/:id', AuthValidator, actionLogsController.deleteActionLog);

module.exports = router;
