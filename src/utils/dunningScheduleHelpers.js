const moment = require('moment-timezone');

/**
 * Spacing between automated dunning reminders.
 *
 * Presets:
 * - daily -> 1 day
 * - every_2_days -> 2 days
 * - weekly -> 7 days
 *
 * Custom:
 * - every_<N>_days -> N days (e.g. every_30_days)
 */
function getNextReminderOffsetDays(dunningSchedule) {
  const f = String(dunningSchedule?.reminder_frequency || '').trim();
  const m = f.match(/^every_(\d{1,3})_days$/);
  if (m && m[1]) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) return Math.min(90, n);
  }
  switch (f) {
    case 'every_2_days':
      return 2;
    case 'weekly':
      return 7;
    case 'daily':
    default:
      return 1;
  }
}

function computeNextReminderAt(dunningSchedule, userTimezone) {
  const timezone = userTimezone || 'Asia/Jerusalem';
  const reminderTime = dunningSchedule.reminder_time || '10:00:00';
  const [hours, minutes] = reminderTime.split(':').map(Number);
  const days = getNextReminderOffsetDays(dunningSchedule);
  return moment()
    .tz(timezone)
    .add(days, 'days')
    .hour(hours)
    .minute(minutes)
    .second(0)
    .toDate();
}

module.exports = {
  getNextReminderOffsetDays,
  computeNextReminderAt,
};
