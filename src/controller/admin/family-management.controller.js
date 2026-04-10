// controller/admin/family-management.controller.js
const { Family, FamilyChild, FamilyCartItem, FamilyPaymentLink, FamilyPaymentTransaction, FamilyActivityLog } = require('../../models/Family');
const User = require('../../models/users');
const UserSubscriptionDetails = require('../../models/UserSubscriptionDetails');
const Class = require('../../models/classes');
const RegularClass = require('../../models/regularClass');
const { Op, Sequelize, literal } = require('sequelize');
const moment = require('moment-timezone');
const { downloadFamilyInvoiceFromPayPlus } = require('../../services/familyPayplus.service');

/**
 * Get family management dashboard statistics
 */
async function getFamilyDashboardStats(req, res) {
    try {
        const { period = '30days' } = req.query;

        // Calculate date range
        const end = new Date();
        let start;
        switch (period) {
            case '7days':
                start = moment().subtract(7, 'days').toDate();
                break;
            case '30days':
                start = moment().subtract(30, 'days').toDate();
                break;
            case '90days':
                start = moment().subtract(90, 'days').toDate();
                break;
            case '6months':
            default:
                start = moment().subtract(6, 'months').toDate();
                break;
        }

        // Get total families count
        const totalFamilies = await Family.count();

        // Get active families count
        const activeFamilies = await Family.count({
            where: { status: 'active' }
        });

        // Get total children count
        const totalChildren = await FamilyChild.count();

        // Get active children with subscriptions
        const activeChildren = await FamilyChild.count({
            where: { status: 'active' }
        });

        // Calculate monthly revenue from active children subscriptions
        const monthlyRevenue = await FamilyChild.sum('monthly_amount', {
            where: { 
                status: 'active',
                monthly_amount: { [Op.ne]: null }
            }
        }) || 0;

        // Get total transactions count in period
        const totalTransactions = await FamilyPaymentTransaction.count({
            where: {
                created_at: { [Op.between]: [start, end] }
            }
        });

        // Get active subscriptions from UserSubscriptionDetails linked to family children
        const activeSubscriptions = await UserSubscriptionDetails.count({
            where: {
                status: 'active'
            },
            include: [{
                model: User,
                as: 'SubscriptionUser',
                required: true,
                where: {
                    guardian: { [Op.ne]: null }
                }
            }]
        });

        // Get enrolled classes count
        const enrolledClasses = await Class.count({
            where: {
                status: { [Op.in]: ['pending', 'scheduled', 'completed'] },
                meeting_start: { [Op.gte]: start }
            },
            include: [{
                model: User,
                as: 'Student',
                required: true,
                where: {
                    guardian: { [Op.ne]: null }
                }
            }]
        });

        // Get pending payments (families with pending status)
        const pendingPayments = await Family.count({
            where: { status: 'pending' }
        });

        // Get recent activity
        const recentActivity = await FamilyActivityLog.findAll({
            limit: 10,
            order: [['created_at', 'DESC']],
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name']
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'full_name', 'role_name']
                }
            ]
        });

        // Format activity data
        const formattedActivity = recentActivity.map(activity => ({
            id: activity.id,
            type: activity.action_type,
            title: getActivityTitle(activity.action_type),
            description: activity.action_description,
            timestamp: activity.created_at,
            status: 'success',
            performedBy: activity.user ? activity.user.full_name : 'System',
            familyName: activity.family ? activity.family.parent_name : null
        }));

        const stats = {
            totalFamilies,
            activeFamilies,
            totalChildren,
            monthlyRevenue: parseFloat(monthlyRevenue.toFixed(2)),
            totalTransactions,
            activeSubscriptions,
            enrolledClasses,
            pendingPayments,
            recentActivity: formattedActivity
        };

        return res.status(200).json({
            status: 'success',
            message: 'Family dashboard stats fetched successfully',
            data: stats
        });

    } catch (err) {
        console.error('Error fetching family dashboard stats:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch family dashboard stats',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get all families with filtering, pagination, and search
 */
async function getAllFamilies(req, res) {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = 'all',
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Build where conditions
        const whereConditions = {};

        // Search condition
        if (search) {
            whereConditions[Op.or] = [
                { parent_name: { [Op.like]: `%${search}%` } },
                { parent_email: { [Op.like]: `%${search}%` } },
                { parent_phone: { [Op.like]: `%${search}%` } }
            ];
        }

        // Status filter
        if (status && status !== 'all') {
            whereConditions.status = status;
        }

        // Get families with children count and total amount
        const { count, rows: families } = await Family.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: FamilyChild,
                    as: 'children',
                    attributes: []
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'full_name', 'email']
                }
            ],
            attributes: {
                include: [
                    [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('children.id'))), 'totalChildrenCount'],
                    [Sequelize.fn('SUM', Sequelize.col('children.monthly_amount')), 'totalAmount']
                ]
            },
            group: ['Family.id', 'creator.id'],
            limit: parseInt(limit),
            offset: offset,
            order: [[sortBy, sortOrder]],
            subQuery: false
        });

        // Format response
        const formattedFamilies = families.map(family => ({
            id: family.id,
            parent_name: family.parent_name,
            parent_email: family.parent_email,
            parent_phone: family.parent_phone,
            parent_country_code: family.parent_country_code,
            parent_address: family.parent_address,
            family_notes: family.family_notes,
            status: family.status,
            totalChildrenCount: family.dataValues.totalChildrenCount || 0,
            totalAmount: parseFloat(family.dataValues.totalAmount || 0).toFixed(2),
            salesPerson: family.creator ? family.creator.full_name : null,
            created_at: family.created_at,
            updated_at: family.updated_at
        }));

        return res.status(200).json({
            status: 'success',
            message: 'Families fetched successfully',
            data: {
                families: formattedFamilies,
                pagination: {
                    total: count.length,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count.length / parseInt(limit))
                }
            }
        });

    } catch (err) {
        console.error('Error fetching families:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch families',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get family details by ID
 */
async function getFamilyDetails(req, res) {
    try {
        const { id } = req.params;

        const family = await Family.findByPk(id, {
            include: [
                {
                    model: FamilyChild,
                    as: 'children'
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'full_name', 'email']
                },
                {
                    model: FamilyPaymentTransaction,
                    as: 'paymentTransactions',
                    limit: 5,
                    order: [['created_at', 'DESC']]
                }
            ]
        });

        if (!family) {
            return res.status(404).json({
                status: 'error',
                message: 'Family not found'
            });
        }

        // Get payment history (similar to sales side)
        const paymentHistory = await FamilyPaymentTransaction.findAll({
            where: { family_id: id },
            order: [['created_at', 'DESC']],
            limit: 50
        });

        return res.status(200).json({
            status: 'success',
            message: 'Family details fetched successfully',
            data: { 
                family,
                paymentHistory
            }
        });

    } catch (err) {
        console.error('Error fetching family details:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch family details',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get all family transactions with filtering
 */
async function getFamilyTransactions(req, res) {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = 'all',
            paymentType = 'all',
            startDate,
            endDate,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Build where conditions
        const whereConditions = {};

        // Search condition
        if (search) {
            whereConditions[Op.or] = [
                { transaction_token: { [Op.like]: `%${search}%` } },
                { payplus_transaction_id: { [Op.like]: `%${search}%` } }
            ];
        }

        // Status filter
        if (status && status !== 'all') {
            whereConditions.status = status;
        }

        // Payment type filter
        if (paymentType && paymentType !== 'all') {
            whereConditions.payment_type = paymentType;
        }

        // Date range filter
        if (startDate && endDate) {
            whereConditions.created_at = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        // Get transactions
        const { count, rows: transactions } = await FamilyPaymentTransaction.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name', 'parent_email']
                },
                {
                    model: FamilyPaymentLink,
                    as: 'paymentLink',
                    include: [{
                        model: User,
                        as: 'salesUser',
                        attributes: ['id', 'full_name', 'email']
                    }]
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [[sortBy, sortOrder]]
        });

        // Format transactions
        const formattedTransactions = transactions.map(txn => ({
            id: txn.id,
            transaction_token: txn.transaction_token,
            payplus_transaction_id: txn.payplus_transaction_id,
            family_id: txn.family_id,
            family_name: txn.family ? txn.family.parent_name : null,
            family_email: txn.family ? txn.family.parent_email : null,
            amount: parseFloat(txn.amount),
            currency: txn.currency,
            payment_type: txn.payment_type,
            status: txn.status,
            payment_method: txn.payment_method,
            card_last_digits: txn.card_last_digits,
            salesPerson: txn.paymentLink?.salesUser?.full_name || null,
            processed_at: txn.processed_at,
            created_at: txn.created_at,
            paid_children_count: Array.isArray(txn.paid_children_ids) ? txn.paid_children_ids.length : 0
        }));

        // Calculate summary statistics
        const totalAmount = transactions.reduce((sum, txn) => sum + parseFloat(txn.amount), 0);
        const completedTransactions = transactions.filter(txn => txn.status === 'success').length;
        const pendingAmount = transactions
            .filter(txn => txn.status === 'pending')
            .reduce((sum, txn) => sum + parseFloat(txn.amount), 0);

        return res.status(200).json({
            status: 'success',
            message: 'Family transactions fetched successfully',
            data: {
                transactions: formattedTransactions,
                summary: {
                    totalAmount: parseFloat(totalAmount.toFixed(2)),
                    completedTransactions,
                    pendingAmount: parseFloat(pendingAmount.toFixed(2))
                },
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (err) {
        console.error('Error fetching family transactions:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch family transactions',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get family activity history/log
 */
async function getFamilyHistory(req, res) {
    try {
        const {
            page = 1,
            limit = 15,
            search = '',
            actionType = 'all',
            familyId,
            startDate,
            endDate,
            sortOrder = 'DESC'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Build where conditions
        const whereConditions = {};

        // Search condition
        if (search) {
            whereConditions.action_description = { [Op.like]: `%${search}%` };
        }

        // Action type filter
        if (actionType && actionType !== 'all') {
            whereConditions.action_type = actionType;
        }

        // Family filter
        if (familyId) {
            whereConditions.family_id = familyId;
        }

        // Date range filter
        if (startDate && endDate) {
            whereConditions.created_at = {
                [Op.between]: [new Date(startDate), new Date(endDate)]
            };
        }

        // Get activity logs
        const { count, rows: activities } = await FamilyActivityLog.findAndCountAll({
            where: whereConditions,
            include: [
                {
                    model: Family,
                    as: 'family',
                    attributes: ['id', 'parent_name'],
                    required: false
                },
                {
                    model: FamilyChild,
                    as: 'child',
                    attributes: ['id', 'child_name'],
                    required: false
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'full_name', 'role_name']
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [['created_at', sortOrder]]
        });

        // Collect IDs from metadata so we can enrich it with human-readable names
        const childIdSet = new Set();
        const familyIdSet = new Set();
        const studentIdSet = new Set();

        for (const activity of activities) {
            let meta = activity.metadata;
            if (!meta) continue;

            if (typeof meta === 'string') {
                try {
                    meta = JSON.parse(meta);
                } catch (e) {
                    // leave as-is if not valid JSON
                    continue;
                }
            }

            if (!meta || typeof meta !== 'object') continue;

            const childIds = meta.child_ids || meta.childIds || meta.children_ids || meta.childrenIds;
            if (Array.isArray(childIds)) {
                childIds.forEach(id => {
                    const num = parseInt(id, 10);
                    if (!isNaN(num)) childIdSet.add(num);
                });
            }

            const metadataFamilyIds = meta.family_ids || meta.familyIds || (meta.family_id ? [meta.family_id] : []);
            if (Array.isArray(metadataFamilyIds)) {
                metadataFamilyIds.forEach(id => {
                    const num = parseInt(id, 10);
                    if (!isNaN(num)) familyIdSet.add(num);
                });
            }

            const studentIds = meta.student_ids || meta.studentIds;
            if (Array.isArray(studentIds)) {
                studentIds.forEach(id => {
                    const num = parseInt(id, 10);
                    if (!isNaN(num)) studentIdSet.add(num);
                });
            }
        }

        // Also include direct family/child/student refs from the activity itself
        activities.forEach(a => {
            if (a.family_id) familyIdSet.add(a.family_id);
            if (a.child_id) childIdSet.add(a.child_id);
        });

        // Load maps for names (only when needed)
        const [childrenForMap, familiesForMap, studentsForMap] = await Promise.all([
            childIdSet.size
                ? FamilyChild.findAll({
                    where: { id: { [Op.in]: Array.from(childIdSet) } },
                    attributes: ['id', 'child_name']
                })
                : Promise.resolve([]),
            familyIdSet.size
                ? Family.findAll({
                    where: { id: { [Op.in]: Array.from(familyIdSet) } },
                    attributes: ['id', 'parent_name']
                })
                : Promise.resolve([]),
            studentIdSet.size
                ? User.findAll({
                    where: { id: { [Op.in]: Array.from(studentIdSet) } },
                    attributes: ['id', 'full_name']
                })
                : Promise.resolve([])
        ]);

        const childNameMap = new Map(childrenForMap.map(c => [c.id, c.child_name]));
        const familyNameMap = new Map(familiesForMap.map(f => [f.id, f.parent_name]));
        const studentNameMap = new Map(studentsForMap.map(s => [s.id, s.full_name]));

        const formatIdListWithNames = (ids, nameMap) => {
            if (!Array.isArray(ids)) return ids;
            return ids.map(id => {
                const num = parseInt(id, 10);
                const name = !isNaN(num) ? nameMap.get(num) : null;
                return name ? `${num} - ${name}` : String(id);
            });
        };

        const formatSingleIdWithName = (id, nameMap) => {
            if (!id) return id;
            const num = parseInt(id, 10);
            if (isNaN(num)) return id;
            const name = nameMap.get(num);
            return name ? `${num} - ${name}` : id;
        };

        // Format activities and enrich metadata with names where possible
        const formattedActivities = activities.map(activity => {
            let metadata = activity.metadata;

            // Legacy: some child_added rows may have null metadata but JSON in new_values
            if (
                (metadata == null || metadata === undefined) &&
                activity.action_type === 'child_added' &&
                activity.new_values
            ) {
                metadata = {};
            }

            if (metadata) {
                let parsed = metadata;
                if (typeof parsed === 'string') {
                    try {
                        parsed = JSON.parse(parsed);
                    } catch {
                        parsed = { Details: metadata };
                    }
                }

                if (parsed && typeof parsed === 'object') {
                    const enriched = { ...parsed };

                    // child_added: older rows only stored child data in new_values; admin UI reads metadata
                    if (activity.action_type === 'child_added' && activity.new_values) {
                        let nv = activity.new_values;
                        if (typeof nv === 'string') {
                            try {
                                nv = JSON.parse(nv);
                            } catch {
                                nv = null;
                            }
                        }
                        if (nv && typeof nv === 'object') {
                            if (enriched.child_name == null && nv.child_name != null) {
                                enriched.child_name = nv.child_name;
                            }
                            if (enriched.child_age == null && nv.child_age != null) {
                                enriched.child_age = nv.child_age;
                            }
                            if (
                                enriched.relationship_to_parent == null &&
                                nv.relationship_to_parent != null
                            ) {
                                enriched.relationship_to_parent = nv.relationship_to_parent;
                            }
                            if (enriched.child_email == null && nv.child_email) {
                                enriched.child_email = nv.child_email;
                            }
                        }
                    }

                    // Normalize single child id in metadata (common for child_removed)
                    if (enriched.child_id || enriched.childId) {
                        const rawChildId = enriched.child_id || enriched.childId;
                        enriched.child_id = formatSingleIdWithName(rawChildId, childNameMap);
                        delete enriched.childId;
                    }

                    if (enriched.child_ids || enriched.childIds || enriched.children_ids || enriched.childrenIds) {
                        const rawChildIds = enriched.child_ids || enriched.childIds || enriched.children_ids || enriched.childrenIds;
                        enriched.child_ids = formatIdListWithNames(rawChildIds, childNameMap);
                        delete enriched.childIds;
                        delete enriched.children_ids;
                        delete enriched.childrenIds;
                    }

                    if (enriched.family_ids || enriched.familyIds) {
                        const rawFamilyIds = enriched.family_ids || enriched.familyIds;
                        enriched.family_ids = formatIdListWithNames(rawFamilyIds, familyNameMap);
                        delete enriched.familyIds;
                    }

                    if (enriched.family_id) {
                        enriched.family_id = formatSingleIdWithName(enriched.family_id, familyNameMap);
                    }

                    if (enriched.student_ids || enriched.studentIds) {
                        const rawStudentIds = enriched.student_ids || enriched.studentIds;
                        enriched.student_ids = formatIdListWithNames(rawStudentIds, studentNameMap);
                        delete enriched.studentIds;
                    }

                    // Payment link generated: children_details is often an array of objects.
                    // Convert to readable strings so UI doesn't show "[object Object]".
                    if (Array.isArray(enriched.children_details)) {
                        enriched.children_details = enriched.children_details.map((c) => {
                            if (!c) return '—';
                            if (typeof c !== 'object') return String(c);
                            const id =
                                c.child_id ?? c.childId ?? c.id ?? null;
                            const name =
                                c.child_name ?? c.childName ?? c.name ?? null;
                            if (id != null && name) return `${id} - ${name}`;
                            if (id != null) return String(id);
                            if (name) return String(name);
                            try {
                                return JSON.stringify(c);
                            } catch {
                                return String(c);
                            }
                        });
                    }

                    if (
                        typeof enriched.relationship_to_parent === 'string' &&
                        enriched.relationship_to_parent.trim()
                    ) {
                        enriched.relationship_to_parent = enriched.relationship_to_parent
                            .replace(/_/g, ' ')
                            .replace(/\b\w/g, (ch) => ch.toUpperCase());
                    }

                    metadata = enriched;
                }
            }

            return {
                id: activity.id,
                family_id: activity.family_id,
                family_name: activity.family ? activity.family.parent_name : (activity.family_id ? familyNameMap.get(activity.family_id) || null : null),
                child_id: activity.child_id,
                child_name: activity.child ? activity.child.child_name : (activity.child_id ? childNameMap.get(activity.child_id) || null : null),
                action_type: activity.action_type,
                title: getActivityTitle(activity.action_type),
                description: activity.action_description,
                performed_by: activity.user ? activity.user.full_name : 'System',
                performed_by_role: activity.user ? activity.user.role_name : null,
                metadata,
                created_at: activity.created_at
            };
        });

        // Calculate period statistics based on ALL matching activities (not just the current page)
        const baseStatsWhere = { ...whereConditions };
        // Remove any explicit created_at filter so KPIs always reflect true today/week/month ranges
        if (baseStatsWhere.created_at) {
            delete baseStatsWhere.created_at;
        }

        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();
        const weekStart = moment().subtract(7, 'days').startOf('day').toDate();
        const monthStart = moment().subtract(30, 'days').startOf('day').toDate();

        const [todayCount, weekCount, monthCount] = await Promise.all([
            FamilyActivityLog.count({
                where: {
                    ...baseStatsWhere,
                    created_at: { [Op.between]: [todayStart, todayEnd] }
                }
            }),
            FamilyActivityLog.count({
                where: {
                    ...baseStatsWhere,
                    created_at: { [Op.gte]: weekStart }
                }
            }),
            FamilyActivityLog.count({
                where: {
                    ...baseStatsWhere,
                    created_at: { [Op.gte]: monthStart }
                }
            })
        ]);

        return res.status(200).json({
            status: 'success',
            message: 'Family history fetched successfully',
            data: {
                activities: formattedActivities,
                statistics: {
                    today: todayCount,
                    thisWeek: weekCount,
                    thisMonth: monthCount
                },
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (err) {
        console.error('Error fetching family history:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch family history',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get child subscriptions across all families
 */
async function getChildSubscriptions(req, res) {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = 'all',
            subscriptionType = 'all',
            sortBy = 'created_at',
            sortOrder = 'DESC',
            childId
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Build where conditions for children
        const whereConditions = {};

        // Optional direct child filter (used by admin detail view)
        if (childId) {
            const parsedChildId = parseInt(childId, 10);
            if (!isNaN(parsedChildId)) {
                whereConditions.id = parsedChildId;
            }
        }

        // Search condition - match on child OR family fields
        if (search) {
            const term = `%${search}%`;
            whereConditions[Op.or] = [
                { child_name: { [Op.like]: term } },
                { child_email: { [Op.like]: term } },
                // Use joined family alias to allow searching by family name/email/phone
                { '$family.parent_name$': { [Op.like]: term } },
                { '$family.parent_email$': { [Op.like]: term } },
                { '$family.parent_phone$': { [Op.like]: term } }
            ];
        }

        // Status filter (DB ENUM uses British spelling "cancelled")
        if (status && status !== 'all') {
            const s = String(status).toLowerCase();
            whereConditions.status = s === 'canceled' ? 'cancelled' : status;
        }

        // Subscription type filter
        if (subscriptionType && subscriptionType !== 'all') {
            whereConditions.subscription_type = subscriptionType;
        }

        const listInclude = [
            {
                model: Family,
                as: 'family',
                attributes: ['id', 'parent_name', 'parent_email', 'status']
            }
        ];

        // When searching by family fields, counts must use the same join
        const summaryInclude =
            search && String(search).trim() !== ''
                ? [{ model: Family, as: 'family', attributes: [], required: false }]
                : [];

        // Get children with subscriptions
        const { count, rows: children } = await FamilyChild.findAndCountAll({
            where: whereConditions,
            include: listInclude,
            limit: parseInt(limit),
            offset: offset,
            order: [[sortBy, sortOrder]],
            distinct: true,
            col: 'id'
        });

        // Format subscriptions
        const formattedSubscriptions = children.map(child => ({
            id: child.id,
            child_name: child.child_name,
            child_age: child.child_age,
            child_email: child.child_email,
            family_id: child.family_id,
            family_name: child.family ? child.family.parent_name : null,
            family_email: child.family ? child.family.parent_email : null,
            subscription_type: child.subscription_type,
            monthly_amount: parseFloat(child.monthly_amount || 0),
            custom_amount: parseFloat(child.custom_amount || 0),
            status: child.status,
            payplus_subscription_id: child.payplus_subscription_id,
            subscription_start_date: child.subscription_start_date,
            next_payment_date: child.next_payment_date,
            last_payment_date: child.last_payment_date,
            auto_renew: !!child.payplus_subscription_id,
            created_at: child.created_at
        }));

        // Summary stats for the full filtered set (not just the current page)
        const expiringEnd = moment().add(30, 'days').endOf('day').toDate();
        const expiringStart = moment().startOf('day').toDate();

        const [activeCount, expiringSoon, totalRevenueRaw] = await Promise.all([
            FamilyChild.count({
                where: { ...whereConditions, status: 'active' },
                include: summaryInclude,
                distinct: true,
                col: 'id'
            }),
            FamilyChild.count({
                where: {
                    ...whereConditions,
                    status: 'active',
                    next_payment_date: {
                        [Op.between]: [expiringStart, expiringEnd]
                    }
                },
                include: summaryInclude,
                distinct: true,
                col: 'id'
            }),
            FamilyChild.sum('monthly_amount', {
                where: { ...whereConditions, status: 'active' },
                include: summaryInclude
            })
        ]);

        const totalRevenue = parseFloat((totalRevenueRaw || 0).toFixed(2));

        return res.status(200).json({
            status: 'success',
            message: 'Child subscriptions fetched successfully',
            data: {
                subscriptions: formattedSubscriptions,
                summary: {
                    total: count,
                    active: activeCount,
                    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
                    expiringSoon
                },
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count / parseInt(limit))
                }
            }
        });

    } catch (err) {
        console.error('Error fetching child subscriptions:', err);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch child subscriptions',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

/**
 * Get child classes/enrollments
 */
async function getChildClasses(req, res) {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      startDate = '',
      endDate = '',
      sortBy = 'meeting_start',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause
    const whereClause = {};
    
    if (status) {
      whereClause.status = status;
    }

    if (startDate && endDate) {
      whereClause.meeting_start = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    // FIXED: Explicitly specify only database columns to avoid methods/virtuals
    const classAttributes = [
      'id',
      'student_id',
      'teacher_id',
      'meeting_start',
      'meeting_end',
      'status',
      'is_trial',
      'is_present',
      'bonus_class',
      'class_type',
      'created_at',
      'updated_at'
    ];

    // Search in related models (student and teacher)
    const includeClause = [
      {
        model: User,
        as: 'Student',
        attributes: ['id', 'full_name', 'email'],
        required: false
      },
      {
        model: User,
        as: 'Teacher',
        attributes: ['id', 'full_name', 'email'],
        required: false
      }
    ];

    if (search) {
      const term = `%${search}%`;
      whereClause[Op.or] = [
        { '$Student.full_name$': { [Op.like]: term } },
        { '$Student.email$': { [Op.like]: term } },
        { '$Teacher.full_name$': { [Op.like]: term } },
        { '$Teacher.email$': { [Op.like]: term } }
      ];
    }

    // Get classes with pagination
    const { count, rows: classes } = await Class.findAndCountAll({
      attributes: classAttributes,
      where: whereClause,
      include: includeClause,
      limit: parseInt(limit),
      offset: offset,
      order: [[sortBy, sortOrder]],
      distinct: true
    });

    // Format response
    const formattedClasses = classes.map(cls => {
      const classData = cls.toJSON();

      const status = (classData.status || '').toString().toLowerCase();
      const isEnded = status === 'ended' || status === 'completed';
      const isStarted = status === 'started';

      // Each row represents a single class session.
      const totalSessions = 1;
      const completedSessions = isEnded ? 1 : 0;

      // Progress is per-session: started=50%, ended=100%, otherwise 0%.
      const progress = isEnded ? 100 : isStarted ? 50 : 0;

      // Only ended sessions can have meaningful attendance.
      const isPresent = isEnded ? classData.is_present === true || classData.is_present === 1 : false;
      const attendance = isEnded ? (isPresent ? 100 : 0) : 0;
      
      return {
        id: classData.id,
        student_id: classData.student_id,
        student_name: classData.Student?.full_name || null,
        student_email: classData.Student?.email || null,
        teacher_id: classData.teacher_id,
        teacher_name: classData.Teacher?.full_name || null,
        teacher_subject: null,
        meeting_start: classData.meeting_start,
        meeting_end: classData.meeting_end,
        status: classData.status,
        is_trial: classData.is_trial || false,
        is_present: isPresent,
        bonus_class: classData.bonus_class || false,
        class_type: classData.class_type || 'regular',
        totalSessions,
        completedSessions,
        progress,
        attendance,
        created_at: classData.created_at
      };
    });

    // Calculate summary statistics using the SAME filters (search/status/date) as the list,
    // otherwise KPIs can exceed 100% (e.g., ended count > total for filtered views).
    const baseCountOptions = {
      where: { ...whereClause },
      include: includeClause,
      distinct: true
    };

    const totalClasses = await Class.count(baseCountOptions);

    // Pending is the in-progress bucket for this screen
    const pendingClasses = await Class.count({
      ...baseCountOptions,
      where: { ...whereClause, status: 'pending' }
    });

    // Ended bucket: DB uses `ended` (some older flows may store `completed`)
    const endedClasses = await Class.count({
      ...baseCountOptions,
      where: { ...whereClause, status: { [Op.in]: ['ended', 'completed'] } }
    });

    // Calculate average progress (bounded 0..100)
    const rawAverageProgress =
      totalClasses > 0 ? (endedClasses / totalClasses) * 100 : 0;
    const averageProgress = Math.max(0, Math.min(100, rawAverageProgress));

    const summary = {
      total: totalClasses,
      active: pendingClasses,
      completed: endedClasses,
      averageProgress: Math.round(averageProgress * 10) / 10
    };

    return res.status(200).json({
      status: 'success',
      message: 'Child classes fetched successfully',
      data: {
        classes: formattedClasses,
        summary,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Error fetching child classes:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch child classes',
      error: error.message
    });
  }
}
/**
 * Helper function to get activity title from action type
 */
function getActivityTitle(actionType) {
    const titles = {
        'family_created': 'Family Created',
        'child_added': 'Child Added',
        'child_removed': 'Child Removed',
        'child_status_changed': 'Child Status Changed',
        'child_subscription_updated': 'Subscription Updated',
        'payment_generated': 'Payment Link Generated',
        'payment_completed': 'Payment Completed',
        'subscription_modified': 'Subscription Modified',
        'cart_updated': 'Cart Updated',
        'cart_subscription_configured': 'Subscription Configured'
    };
    return titles[actionType] || actionType;
}

/**
 * Download invoice for a family payment transaction
 * Uses the same service as sales side
 */
async function downloadFamilyInvoice(req, res) {
    try {
        const { id } = req.params;
        const { type = 'original', format = 'pdf' } = req.query;

        // Find the family payment transaction
        const familyPayment = await FamilyPaymentTransaction.findByPk(id);

        if (!familyPayment) {
            return res.status(404).json({
                status: 'error',
                message: 'Family payment transaction not found'
            });
        }

        // Priority: payplus_transaction_id > transaction_token
        // Also try to extract from payplus_response_data if needed
        let transaction_uid = familyPayment.payplus_transaction_id || familyPayment.transaction_token;

        // If still not found, try to extract from payplus_response_data
        if ((!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') && familyPayment.payplus_response_data) {
            try {
                const responseData = typeof familyPayment.payplus_response_data === 'string' 
                    ? JSON.parse(familyPayment.payplus_response_data) 
                    : familyPayment.payplus_response_data;
                
                // Handle double-encoded JSON strings
                const parsedData = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
                
                if (parsedData.transaction_uid) {
                    transaction_uid = parsedData.transaction_uid;
                }
            } catch (parseError) {
                console.error(`[downloadFamilyInvoice] Error parsing payplus_response_data:`, parseError);
            }
        }

        if (!transaction_uid || transaction_uid === 'undefined' || transaction_uid === '') {
            return res.status(400).json({
                status: 'error',
                message: 'Transaction UID not available for this family payment',
                details: {
                    payment_id: id,
                    payplus_transaction_id: familyPayment.payplus_transaction_id,
                    transaction_token: familyPayment.transaction_token
                }
            });
        }

        // Delegate PayPlus API calls + streaming to the dedicated service
        await downloadFamilyInvoiceFromPayPlus({
            transaction_uid,
            type,
            format,
            paymentId: id,
            res,
            payplusResponseData: familyPayment.payplus_response_data
        });
    } catch (error) {
        console.error(`[downloadFamilyInvoice] Unexpected error downloading family invoice for payment ${req.params.id}:`, error);

        if (!res.headersSent) {
            return res.status(500).json({
                status: 'error',
                message: 'Error downloading family invoice',
                details: error.message
            });
        }
    }
}

module.exports = {
    getFamilyDashboardStats,
    getAllFamilies,
    getFamilyDetails,
    getFamilyTransactions,
    getFamilyHistory,
    getChildSubscriptions,
    getChildClasses,
    downloadFamilyInvoice
};