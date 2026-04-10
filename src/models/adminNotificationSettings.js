const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const SETTING_KEY_OVERDUE = 'overdue_payment_reminder';

const AdminNotificationSettings = sequelize.define(
  'AdminNotificationSettings',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    setting_key: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    overdue_reminder_days: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 30,
    },
    updated_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'admin_notification_settings',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: false,
  }
);

AdminNotificationSettings.SETTING_KEY_OVERDUE = SETTING_KEY_OVERDUE;

module.exports = AdminNotificationSettings;
