const { Op } = require('sequelize');
const ActionLog = require('../../models/actionLog');
const User = require('../../models/users');
const ACTION_LOG_ALLOWED_ROLES = ['sales_role', 'sales_appointment_setter', 'admin'];


function deepParseActionLog(value) {
    if (value === null || value === undefined) return value;

    // Step 1: Try parsing if it's a string
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return deepParseActionLog(parsed); // recurse after parsing
        } catch (e) {
            return value; // not JSON → return as is
        }
    }

    // Step 2: If array → parse each item
    if (Array.isArray(value)) {
        return value.map((item) => deepParseActionLog(item));
    }

    // Step 3: If object → parse each key
    if (typeof value === "object") {
        const result = {};
        for (const key in value) {
            result[key] = deepParseActionLog(value[key]);
        }
        return result;
    }

    // Step 4: primitive (number, boolean, etc.)
    return value;
}

const getActionLogs = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            actor_id,
            action_type,
            target_entity,
            target_id,
            search,
            date_from,
            date_to
        } = req.query;

        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
        const offset = (pageNum - 1) * pageSize;

        const where = {};

        if (actor_id) {
            where.actor_id = actor_id;
        }

        if (action_type) {
            where.action_type = { [Op.like]: `%${action_type}%` };
        }

        if (target_entity) {
            where.target_entity = { [Op.like]: `%${target_entity}%` };
        }

        if (target_id) {
            where.target_id = target_id;
        }

        if (date_from || date_to) {
            where.created_at = {};

            if (date_from) {
                where.created_at[Op.gte] = new Date(`${date_from}T00:00:00.000Z`);
            }

            if (date_to) {
                where.created_at[Op.lte] = new Date(`${date_to}T23:59:59.999Z`);
            }
        }

        if (search) {
            where[Op.or] = [
                { action_type: { [Op.like]: `%${search}%` } },
                { target_entity: { [Op.like]: `%${search}%` } }
            ];
        }

        const { count, rows } = await ActionLog.findAndCountAll({
            where,
            order: [['created_at', 'DESC']],
            offset,
            limit: pageSize
        });

        const actorIds = [...new Set(rows.map((row) => row.actor_id).filter(Boolean))];
        const targetIds = [...new Set(rows.map((row) => row.target_id).filter(Boolean))];
        const userIds = [...new Set([...actorIds, ...targetIds])];

        const users = userIds.length > 0
            ? await User.findAll({
                where: { id: { [Op.in]: userIds } },
                attributes: ['id', 'full_name', 'email', 'mobile', 'avatar'],
                raw: true
            })
            : [];

        const usersMap = new Map(users.map((user) => [user.id, user]));

        const actorOptions = await User.findAll({
            where: {
                role_name: {
                    [Op.in]: ACTION_LOG_ALLOWED_ROLES
                }
            },
            attributes: ['id', 'full_name', 'email', 'avatar'],
            order: [['full_name', 'ASC']],
            raw: true
        });

        const actionLogs = rows.map((row) => {
            const plainRow = row.get({ plain: true });

            return {
                ...plainRow,
                actor: usersMap.get(plainRow.actor_id) || null,
                target: usersMap.get(plainRow.target_id) || null,
                old_value: deepParseActionLog(plainRow.old_value),
                new_value: deepParseActionLog(plainRow.new_value)
            };
        });

        return res.status(200).json({
            status: 'success',
            message: 'Action logs fetched successfully',
            data: {
                action_logs: actionLogs,
                actor_options: actorOptions,
                pagination: {
                    total: count,
                    current_page: pageNum,
                    total_pages: Math.ceil(count / pageSize),
                    per_page: pageSize
                }
            }
        });
    } catch (error) {
        console.error('Error fetching action logs:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch action logs',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const deleteActionLog = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: 'error',
                message: 'Action log ID is required'
            });
        }

        const actionLog = await ActionLog.findByPk(id);

        if (!actionLog) {
            return res.status(404).json({
                status: 'error',
                message: 'Action log not found'
            });
        }

        await actionLog.destroy();

        return res.status(200).json({
            status: 'success',
            message: 'Action log deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting action log:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to delete action log',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    getActionLogs,
    deleteActionLog
};
