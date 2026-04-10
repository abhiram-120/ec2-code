const { whatsappReminderAddClass } = require('../cronjobs/reminder');

/**
 * Public endpoint (NO auth)
 * POST /api/feedbacknotification
 *
 * Body:
 * - student_id (required)
 * - teacher_name (optional)
 * - class_id (optional)
 */
const sendFeedbackNotification = async (req, res) => {
    try {
        const studentId = Number(req.body?.student_id ?? req.body?.studentId);
        const teacherName = String(req.body?.teacher_name ?? req.body?.teacherName ?? '');
        const classIdRaw = req.body?.class_id ?? req.body?.classId;
        const classId =
            classIdRaw === null || classIdRaw === undefined || classIdRaw === ''
                ? null
                : Number(classIdRaw);

        if (!Number.isFinite(studentId)) {
            return res.status(400).json({
                status: 'error',
                message: 'student_id is required'
            });
        }

        const notifyOptionStudent = {
            'instructor.name': teacherName || '',
            class_id: Number.isFinite(classId) ? String(classId) : null
        };

        const sent = await whatsappReminderAddClass('feedback_received', notifyOptionStudent, studentId);
 
        return res.status(200).json({
            status: sent ? 'success' : 'error',
            sent
        });
    } catch (error) {
        console.error('sendFeedbackNotification error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to send feedback notification',
            details: error.message
        });
    }
};

module.exports = { sendFeedbackNotification };