const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const LlmResponse = sequelize.define(
  'LlmResponse',
  {
    request_id: {
      type: DataTypes.STRING(36),
      primaryKey: true,
    },

    raw_response: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
    },

    parsed_response: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
    },

    completed_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'llm_responses',
    timestamps: false,
  }
);

module.exports = LlmResponse;