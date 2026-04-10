const RiskRules = require('../../models/riskRules');
const RiskRulesAudit = require('../../models/RiskRulesAudit');
const User = require('../../models/users');

const normalizeConditions = (conditions) => {
    let parsedConditions = conditions;

    try {
        while (typeof parsedConditions === 'string') {
            parsedConditions = JSON.parse(parsedConditions);
        }
    } catch (error) {
        console.log('❌ Failed to normalize risk rule conditions:', error);
        parsedConditions = conditions;
    }

    return parsedConditions;
};

const setRiskRules = async (req, res) => {
    try {
        const { event_type, display_name, default_points, description, default_valid_days, conditions, is_auto, is_active, impact_level } = req.body;
        if (!event_type || !display_name || !default_points || !default_valid_days || !description || !conditions) {
            return res.status(400).json({ success: false, error: 'Please provide all required fields.' });
        }
        const userId = req.userId || null;
        const newRule = await RiskRules.create({
            event_type,
            display_name,
            default_points,
            description,
            conditions,
            impact_level,
            default_valid_days,
            is_auto: is_auto ?? true,
            is_active: true
        });
        console.log('New Rule Created', newRule);

        // 🧩 Audit log
        await RiskRulesAudit.create({
            risk_rule_id: newRule.id,
            action: 'CREATE',
            changed_by: userId,
            previous_data: null,
            new_data: newRule.toJSON()
        });

        console.log('✅ New Risk Rule Created:', newRule.display_name);

        return res.status(201).json({ success: true, details: 'New Risk Rule Created', data: newRule });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        });
    }
};

const getRiskRules = async (req, res) => {
    try {
        // Fetch all risk rules, ordered by creation date (newest first)
        const riskRules = await RiskRules.findAll({
            order: [['created_at', 'DESC']]
        });

        const normalizedRules = riskRules.map((rule) => {
            const ruleJson = rule.toJSON();
            return {
                ...ruleJson,
                conditions: normalizeConditions(ruleJson.conditions)
            };
        });

        // Return response
        return res.status(200).json({
            success: true,
            data: normalizedRules,
            total: normalizedRules.length
        });
    } catch (error) {
        console.error('❌ Error fetching risk rules:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        });
    }
};

const updateRiskRules = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            event_type,
            display_name,
            default_points,
            description,
            default_valid_days,
            conditions,
            is_auto,
            is_active,
            impact_level
        } = req.body;
        const userId = req.userId || null;
        if (!id) {
            return res.status(400).json({ success: false, error: 'Rule ID is required.' });
        }
        const existingRule = await RiskRules.findByPk(id);
        if (!existingRule) {
            return res.status(404).json({ success: false, error: 'Rule not found.' });
        }

        const updates = {
            event_type,
            display_name,
            default_points,
            description,
            default_valid_days,
            conditions: normalizeConditions(conditions),
            impact_level,
            is_auto,
            is_active
        };

        const previousData = existingRule.toJSON();
        await existingRule.update(updates);

        // ✅ Assign updated instance
        const updatedRule = existingRule;

        // 🧩 Audit log
        await RiskRulesAudit.create({
            risk_rule_id: updatedRule.id,
            action: 'UPDATE',
            changed_by: userId,
            previous_data: previousData,
            new_data: updatedRule.toJSON()
        });

        console.log('✏️ Risk Rule Updated:', updatedRule.display_name);

        return res.status(200).json({
            success: true,
            message: 'Risk rule updated successfully.',
            data: updatedRule
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        });
    }
};

const deleteRule = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId || null;
        console.log('deleterule', id, userId);
        if (!id) {
            return res.status(400).json({ success: false, error: 'Rule ID is required.' });
        }
        const existingRule = await RiskRules.findByPk(id);
        if (!existingRule) {
            return res.status(404).json({ success: false, error: 'Rule not found.' });
        }

        const previousData = existingRule.toJSON();

        // 🧩 Audit log
        await RiskRulesAudit.create({
            risk_rule_id: id,
            action: 'DELETE',
            changed_by: userId,
            previous_data: previousData,
            new_data: null
        });

        await existingRule.destroy();

        console.log('🗑️ Risk Rule Deleted:', previousData.display_name);

        return res.status(200).json({
            success: true,
            message: 'Risk rule deleted successfully.'
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        });
    }
};

const duplicateRule = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId || null;

        if (!id) {
            return res.status(400).json({ success: false, error: 'Rule ID is required.' });
        }

        const existingRule = await RiskRules.findByPk(id);
        if (!existingRule) {
            return res.status(404).json({ success: false, error: 'Rule not found.' });
        }

        const sourceRule = existingRule.toJSON();
        const normalizedConditions = normalizeConditions(sourceRule.conditions);
        const duplicatedRule = await RiskRules.create({
            event_type: sourceRule.event_type,
            display_name: `${sourceRule.display_name} (Copy)`,
            default_points: sourceRule.default_points,
            description: sourceRule.description,
            conditions: normalizedConditions,
            impact_level: sourceRule.impact_level,
            default_valid_days: sourceRule.default_valid_days,
            is_auto: sourceRule.is_auto,
            is_active: sourceRule.is_active
        });

        await RiskRulesAudit.create({
            risk_rule_id: duplicatedRule.id,
            action: 'CREATE',
            changed_by: userId,
            previous_data: sourceRule,
            new_data: duplicatedRule.toJSON()
        });

        return res.status(201).json({
            success: true,
            message: 'Risk rule duplicated successfully.',
            data: duplicatedRule
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        });
    }
};

module.exports = {
    setRiskRules,
    getRiskRules,
    updateRiskRules,
    deleteRule,
    duplicateRule
};
