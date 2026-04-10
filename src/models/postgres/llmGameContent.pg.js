const { DataTypes } = require('sequelize');
const { getPostgresSequelize } = require('../../connection/postgres-connection');

const sequelize = getPostgresSequelize();

// Postgres-only model for `raw.llm_game_content`.
// This table stores AI-generated game payload (flashcards, fill-in-the-blanks, etc.)
// produced by the LLM worker pipeline (non-fatal).
const LlmGameContent = sequelize
  ? sequelize.define(
      'LlmGameContentPg',
      {
        id: {
          type: DataTypes.BIGINT,
          primaryKey: true,
          allowNull: false
        },

        source_id: {
          type: DataTypes.BIGINT,
          allowNull: true
        },

        idempotency_key: {
          type: DataTypes.TEXT,
          allowNull: true
        },

        payload: {
          type: DataTypes.JSONB,
          allowNull: true
        },

        _etl_loaded_at: {
          type: DataTypes.DATE,
          allowNull: true
        },

        analysis_id: {
          type: DataTypes.BIGINT,
          allowNull: true
        },

        job_id: {
          type: DataTypes.CHAR(36),
          allowNull: true
        },

        student_id: {
          type: DataTypes.INTEGER,
          allowNull: true
        },

        zoom_meeting_id: {
          type: DataTypes.TEXT,
          allowNull: true
        },

        flashcards: {
          type: DataTypes.JSONB,
          allowNull: true
        },

        fill_in_the_blanks: {
          type: DataTypes.JSONB,
          allowNull: true
        },

        spelling_bee: {
          type: DataTypes.JSONB,
          allowNull: true
        },

        grammar_challenge: {
          type: DataTypes.JSONB,
          allowNull: true
        },

        sentence_builder: {
          type: DataTypes.JSONB,
          allowNull: true
        },

        advanced_cloze: {
          type: DataTypes.JSONB,
          allowNull: true
        },

        created_at: {
          type: DataTypes.DATE,
          allowNull: true
        }
      },
      {
        tableName: 'llm_game_content',
        schema: 'raw',
        timestamps: false,
        indexes: [
          { fields: ['job_id'], unique: true },
          { fields: ['student_id'] },
          { fields: ['zoom_meeting_id'] },
          { fields: ['analysis_id'] }
        ]
      }
    )
  : null;

module.exports = LlmGameContent;

