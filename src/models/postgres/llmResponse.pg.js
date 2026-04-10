const { DataTypes } = require('sequelize');
const { getPostgresSequelize } = require('../../connection/postgres-connection');

const sequelize = getPostgresSequelize();

// Postgres-only model for `llm_responses`.
// This is separate from the MySQL model (`src/models/llmResponse.js`) to avoid breaking existing code.
const LlmResponse = sequelize
  ? sequelize.define(
      'LlmResponsePg',
      {
        request_id: {
          type: DataTypes.CHAR(36),
          primaryKey: true,
          allowNull: false
        },
        raw_response: {
          // Reference schema stores raw_response as TEXT (not JSONB).
          type: DataTypes.TEXT,
          allowNull: true
        },
        parsed_response: {
          type: DataTypes.JSONB,
          allowNull: true
        },
        completed_at: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      },
      {
        tableName: 'llm_responses',
        schema: 'raw',
        timestamps: false
      }
    )
  : null;

module.exports = LlmResponse;

