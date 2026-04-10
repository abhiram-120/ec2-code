const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const LlmAudioAnalysis = sequelize.define(
  'LlmAudioAnalysis',
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },

    job_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      comment: 'FK to llm_requests.id'
    },

    zoom_meeting_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'Zoom meeting ID if from webhook'
    },

    summary: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Detailed transcript summary (250 words)'
    },

    topics: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: 'List of topics covered'
    },

    level: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'CEFR level'
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
      allowNull: true,
      comment: 'Focus summary / lesson objective'
    },

    vocabulary_score: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },

    grammar_score: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },

    fluency_score: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },

    engagement_level: {
      type: DataTypes.ENUM('low', 'medium', 'high'),
      defaultValue: 'medium',
      comment: 'Student engagement level'
    },

    raw_analysis: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: 'Complete raw Gemini analysis JSON'
    },

    vocabulary_words: {
      type: DataTypes.JSON,
      allowNull: true
    },

    grammar_points: {
      type: DataTypes.JSON,
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
    timestamps: false,
    indexes: [
      {
        fields: ['job_id']
      },
      {
        fields: ['zoom_meeting_id']
      },
      {
        fields: ['level']
      },
      {
        fields: ['engagement_level']
      }
    ]
  }
);

module.exports = LlmAudioAnalysis;