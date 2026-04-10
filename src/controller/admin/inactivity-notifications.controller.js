const { Op } = require('sequelize');
const Users = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const Class = require('../../models/classes');
const InAppNotificationService = require('../../services/inapp-notification-service');
const InAppNotificationTemplates = require('../../helper/inAppNotificationTemplates');
const sendEmail = require('../../utils/sendEmail');
const { sendAisensyWhatsappMessage } = require('../../utils/notification/whatsappNotification');

const inAppService = new InAppNotificationService();

function parseIntSafe(v, fallback) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

// GET /api/adminInactivityNotifications/users?days=3&limit=50&page=1
const listInactiveUsers = async (req, res) => {
  try {
    const days = Math.max(1, parseIntSafe(req.query.days, 3));
    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, parseIntSafe(req.query.limit, 50)));
    const offset = (page - 1) * limit;

    const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

    const { count, rows } = await Users.findAndCountAll({
      where: {
        role_name: 'user',
        // Only include users whose last_active_at exists and is older than cutoff.
        // (NULL means we don't have activity data yet; exclude to avoid "all users" showing.)
        last_active_at: { [Op.lte]: cutoff },
      },
      attributes: ['id', 'full_name', 'email', 'mobile', 'status', 'last_login_at', 'last_active_at', 'created_at'],
      order: [['last_active_at', 'ASC'], ['id', 'DESC']],
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      status: 'success',
      message: 'Inactive users fetched',
      data: {
        days,
        items: rows,
        pagination: {
          page,
          limit,
          total: count,
          total_pages: Math.max(1, Math.ceil(count / limit)),
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error listing inactive users:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to fetch inactive users',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
};

// POST /api/adminInactivityNotifications/send
// body: { userIds: number[], templateName?: string, force?: boolean }
const sendInactivityNotification = async (req, res) => {
  try {
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
    if (userIds.length === 0) {
      return res.status(400).json({
        success: false,
        status: 'error',
        message: 'userIds must be a non-empty array',
        timestamp: new Date().toISOString(),
      });
    }

    const templateName = String(req.body?.templateName || 'inactivity_login_reminder');
    const force = !!req.body?.force;
    const channelsRaw = req.body?.channels;
    const channels = Array.isArray(channelsRaw) ? channelsRaw.map(String) : ['inapp'];

    const users = await Users.findAll({
      where: { id: { [Op.in]: userIds }, role_name: 'user' },
    });

    const sent = [];
    const failed = [];

    for (const user of users) {
      try {
        const options = { user: { name: user.full_name || 'there' } };
        const userLang = (user.language || 'EN').toUpperCase();

        const perChannel = { inapp: false, email: false, whatsapp: false };

        if (channels.includes('inapp')) {
          perChannel.inapp = await inAppService.sendInAppNotification(templateName, options, user.id, user, { force: true });
        }

        if (channels.includes('email') && user.email) {
          const emailTpl = InAppNotificationTemplates.getNotification(templateName, userLang, 'email', options) ||
            InAppNotificationTemplates.getNotification(templateName, 'EN', 'email', options);
          if (emailTpl?.title && emailTpl?.content) {
            await sendEmail(user.email, emailTpl.title, emailTpl.content);
            perChannel.email = true;
          }
        }

        if (channels.includes('whatsapp')) {
          // Uses AiSensy template name + template params array.
          const userDetails = {
            country_code: user.country_code || '',
            mobile: (user.mobile || '').toString().trim(),
            full_name: user.full_name || '',
            language: user.language || 'EN',
          };
          const waOk = await sendAisensyWhatsappMessage(userDetails, [user.full_name || ''], templateName);
          perChannel.whatsapp = !!waOk;
          if (!waOk) {
            perChannel.whatsapp_error = 'whatsapp_failed';
          }
        }

        sent.push({ id: user.id, channels: perChannel });
      } catch (e) {
        failed.push({ id: user.id, reason: e?.message || 'error' });
      }
    }

    return res.status(200).json({
      success: true,
      status: 'success',
      message: 'Inactivity notifications processed',
      data: {
        requested: userIds.length,
        found: users.length,
        sent,
        failed,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error sending inactivity notifications:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to send inactivity notifications',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
};

// GET /api/adminInactivityNotifications/booking-users?days=10&limit=50&page=1
// Finds users with active subscription and remaining lessons, but no bookings in last N days.
const listBookingReminderUsers = async (req, res) => {
  try {
    const days = Math.max(1, parseIntSafe(req.query.days, 10));
    const page = Math.max(1, parseIntSafe(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, parseIntSafe(req.query.limit, 50)));
    const offset = (page - 1) * limit;

    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Pull active subscriptions (monthly-like) with a lesson_reset_at anchor.
    const subs = await UserSubscriptionDetails.findAll({
      where: {
        status: 'active',
        is_cancel: 0,
        user_id: { [Op.ne]: null },
      },
      order: [['updated_at', 'DESC']],
      limit: 2000, // safety for now; can be paginated later
    });

    const items = [];

    for (const sub of subs) {
      const userId = Number(sub.user_id);
      if (!Number.isFinite(userId)) continue;

      const user = await Users.findByPk(userId, { attributes: ['id', 'full_name', 'email', 'mobile', 'status'] });
      if (!user || user.status !== 'active') continue;

      const cycleStart = sub.lesson_reset_at ? new Date(sub.lesson_reset_at) : (sub.created_at ? new Date(sub.created_at) : null);
      const cycleEnd = new Date();
      if (!cycleStart) continue;

      // Count booked/used classes in this cycle; canceled does not consume.
      const bookedCount = await Class.count({
        where: {
          student_id: userId,
          meeting_start: { [Op.between]: [cycleStart, cycleEnd] },
          status: { [Op.ne]: 'canceled' },
          is_regular_hide: 0,
        },
      });

      const entitlement = Number(sub.weekly_lesson || 0) + Number(sub.weekly_comp_class || 0) + Number(sub.bonus_class || 0);
      const remainingToBook = Math.max(0, entitlement - bookedCount);
      if (remainingToBook <= 0) continue;

      const lastBooked = await Class.max('created_at', {
        where: { student_id: userId, status: { [Op.ne]: 'canceled' }, is_regular_hide: 0 },
      });

      const lastBookedAt = lastBooked ? new Date(lastBooked) : null;
      const noBookingForDays = !lastBookedAt ? (sub.created_at ? new Date(sub.created_at) <= cutoffDate : true) : lastBookedAt <= cutoffDate;
      if (!noBookingForDays) continue;

      items.push({
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        mobile: user.mobile,
        remaining_lessons: remainingToBook,
        days_without_booking: days,
        last_booked_at: lastBookedAt ? lastBookedAt.toISOString() : null,
        subscription_id: sub.id,
      });
    }

    const total = items.length;
    const pageItems = items.slice(offset, offset + limit);

    return res.status(200).json({
      success: true,
      status: 'success',
      message: 'Booking reminder users fetched',
      data: {
        days,
        items: pageItems,
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error listing booking reminder users:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to fetch booking reminder users',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
};

// POST /api/adminInactivityNotifications/booking-send
// body: { userIds: number[], channels?: ["inapp"|"email"|"whatsapp"], days?: number }
const sendBookingReminder = async (req, res) => {
  try {
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
    if (userIds.length === 0) {
      return res.status(400).json({ success: false, status: 'error', message: 'userIds must be a non-empty array', timestamp: new Date().toISOString() });
    }

    const channelsRaw = req.body?.channels;
    const channels = Array.isArray(channelsRaw) ? channelsRaw.map(String) : ['inapp'];
    const templateName = 'remaining_lessons_booking_reminder';

    const users = await Users.findAll({ where: { id: { [Op.in]: userIds }, role_name: 'user' } });
    const sent = [];
    const failed = [];

    for (const user of users) {
      try {
        const sub = await UserSubscriptionDetails.findOne({
          where: { user_id: user.id, status: 'active', is_cancel: 0 },
          order: [['updated_at', 'DESC']],
        });
        if (!sub) {
          failed.push({ id: user.id, reason: 'no_active_subscription' });
          continue;
        }

        const cycleStart = sub.lesson_reset_at ? new Date(sub.lesson_reset_at) : (sub.created_at ? new Date(sub.created_at) : null);
        const cycleEnd = new Date();
        if (!cycleStart) {
          failed.push({ id: user.id, reason: 'no_cycle_start' });
          continue;
        }

        const bookedCount = await Class.count({
          where: {
            student_id: user.id,
            meeting_start: { [Op.between]: [cycleStart, cycleEnd] },
            status: { [Op.ne]: 'canceled' },
            is_regular_hide: 0,
          },
        });
        const entitlement = Number(sub.weekly_lesson || 0) + Number(sub.weekly_comp_class || 0) + Number(sub.bonus_class || 0);
        const remaining = Math.max(0, entitlement - bookedCount);
        if (remaining <= 0) {
          failed.push({ id: user.id, reason: 'no_remaining_lessons' });
          continue;
        }

        const options = { user: { name: user.full_name || 'there' }, subscription: { remaining: String(remaining) } };
        const userLang = (user.language || 'EN').toUpperCase();

        const perChannel = { inapp: false, email: false, whatsapp: false };

        if (channels.includes('inapp')) {
          perChannel.inapp = await inAppService.sendInAppNotification(templateName, options, user.id, user, { force: true });
        }

        if (channels.includes('email') && user.email) {
          const emailTpl = InAppNotificationTemplates.getNotification(templateName, userLang, 'email', options) ||
            InAppNotificationTemplates.getNotification(templateName, 'EN', 'email', options);
          if (emailTpl?.title && emailTpl?.content) {
            await sendEmail(user.email, emailTpl.title, emailTpl.content);
            perChannel.email = true;
          }
        }

        if (channels.includes('whatsapp')) {
          const userDetails = {
            country_code: user.country_code || '',
            mobile: (user.mobile || '').toString().trim(),
            full_name: user.full_name || '',
            language: user.language || 'EN',
          };
          const waOk = await sendAisensyWhatsappMessage(userDetails, [String(remaining)], templateName);
          perChannel.whatsapp = !!waOk;
          if (!waOk) perChannel.whatsapp_error = 'whatsapp_failed';
        }

        sent.push({ id: user.id, remaining_lessons: remaining, channels: perChannel });
      } catch (e) {
        failed.push({ id: user.id, reason: e?.message || 'error' });
      }
    }

    return res.status(200).json({
      success: true,
      status: 'success',
      message: 'Booking reminders processed',
      data: { requested: userIds.length, found: users.length, sent, failed },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error sending booking reminders:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to send booking reminders',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
};

module.exports = {
  listInactiveUsers,
  sendInactivityNotification,
  listBookingReminderUsers,
  sendBookingReminder,
};

