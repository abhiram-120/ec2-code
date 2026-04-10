const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const LlmIntakeQueue = sequelize.define(
  'LlmIntakeQueue',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    audio_url: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    level: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'unknown',
    },

    language: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'hebrew',
    },

    zoom_meeting_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },

    topic: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    idempotency_key: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },

    priority: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 100,
    },

    status: {
      type: DataTypes.STRING(32),
      allowNull: true,
      defaultValue: 'PENDING',
    },

    request_id: {
      type: DataTypes.STRING(36),
      allowNull: true,
    },

    attempt_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
    },

    max_attempts: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 5,
    },

    error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

    admitted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'llm_intake_queue',
    timestamps: false,
    indexes: [
      { fields: ['status', 'priority'], name: 'idx_intake_status_priority' },
      { fields: ['created_at'], name: 'idx_intake_created_at' },
    ],
  }
);

module.exports = LlmIntakeQueue;