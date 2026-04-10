const express = require('express');
const router = express.Router();
const trialClassController = require('../../controller/automation/trial-class.controller');

const STATIC_NAME = 'tulkka-2026';
const STATIC_PASSWORD = 'TUA2608APS';

const staticAuth = (req, res, next) => {
    const { name, password } = req.headers;

    if (name === STATIC_NAME && password === STATIC_PASSWORD) {
        return next();
    }

    return res.status(401).json({
        status: 'error',
        message: 'Unauthorized: invalid credentials'
    });
};

// GET upcoming trial classes joined with classes table
router.get('/upcoming', staticAuth, trialClassController.getUpcomingTrialClasses);

// PATCH call result for a trial class registration (id passed in body)
router.patch('/call-result', staticAuth, trialClassController.updateCallResult);

module.exports = router;
