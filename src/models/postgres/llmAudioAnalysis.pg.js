const { DataTypes } = require('sequelize');
const { getPostgresSequelize } = require('../../connection/postgres-connection');

const sequelize = getPostgresSequelize();

// Postgres-only model for `llm_audio_analyses`.
// Used when reading LLM analysis data from Postgres.
const LlmAudioAnalysis = sequelize
  ? sequelize.define(
      'LlmAudioAnalysisPg',
      {
        id: {
          type: DataTypes.BIGINT,
          primaryKey: true,
          allowNull: false
        },

        job_id: {
          type: DataTypes.CHAR(36),
          allowNull: false
        },

        zoom_meeting_id: {
          type: DataTypes.STRING(64),
          allowNull: true
        },

        summary: {
          type: DataTypes.TEXT,
          allowNull: false
        },

        topics: {
          type: DataTypes.JSONB,
          allowNull: false
        },

        level: {
          type: DataTypes.STRING(50),
          allowNull: false
        },

        grammar_feedback: {
          type: DataTypes.TEXT,
          allowNull: true
        },

        vocabulary_feedback: {
          type: DataTypes.TEXT,
          allowNull: true
        },

        pronunciation_feedback: {
          type: DataTypes.TEXT,
          allowNull: true
        },

        general_comment: {
          type: DataTypes.TEXT,
          allowNull: true
        },

        vocabulary_score: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0
        },

        grammar_score: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0
        },

        fluency_score: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0
        },

        engagement_level: {
          type: DataTypes.ENUM('low', 'medium', 'high'),
          allowNull: true,
          defaultValue: 'medium'
        },

        raw_analysis: {
          type: DataTypes.JSONB,
          allowNull: false
        },

        vocabulary_words: {
          type: DataTypes.JSONB,
          allowNull: true
        },

        grammar_points: {
          type: DataTypes.JSONB,
          allowNull: true
        },

        created_at: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },

        updated_at: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      },
      {
        tableName: 'llm_audio_analyses',
        schema: 'raw',
        timestamps: false,
        indexes: [
          { fields: ['job_id'] },
          { fields: ['zoom_meeting_id'] },
          { fields: ['level'] },
          { fields: ['engagement_level'] }
        ]
      }
    )
  : null;

module.exports = LlmAudioAnalysis;

