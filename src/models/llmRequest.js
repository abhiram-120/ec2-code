const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const LlmRequest = sequelize.define(
  'LlmRequest',
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      allowNull: false
    },

    user_id: {
      type: DataTypes.CHAR(36),
      allowNull: true
    },

    idempotency_key: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    prompt_template_id: {
      type: DataTypes.CHAR(36),
      allowNull: true
    },

    provider: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    model: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    payload: {
      type: DataTypes.TEXT('long'),
      allowNull: true
    },

    status: {
      type: DataTypes.STRING(255),
      allowNull: true
    },

    attempt_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },

    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 100
    },

    schema_definition: {
      type: DataTypes.TEXT('long'),
      allowNull: true
    },

    schema_validation_status: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },

    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },

    locked_at: {
      type: DataTypes.DATE,
      allowNull: true
    },

    worker_id: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    dedup_hit_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Number of duplicate submissions suppressed'
    }
  },
  {
    tableName: 'llm_requests',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['user_id', 'idempotency_key'],
        name: 'idx_requests_user_id_idempotency_key'
      },
      {
        fields: ['prompt_template_id']
      },
      {
        fields: ['status'],
        name: 'idx_requests_status'
      },
      {
        fields: ['created_at'],
        name: 'idx_requests_created_at'
      }
    ]
  }
);

module.exports = LlmRequest;