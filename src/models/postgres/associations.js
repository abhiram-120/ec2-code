const LlmRequestPg = require('./llmRequest.pg');
const LlmAudioAnalysisPg = require('./llmAudioAnalysis.pg');

function setupPostgresAssociations() {
  if (!LlmRequestPg || !LlmAudioAnalysisPg) return;

  // Avoid re-defining associations (can happen with hot reload / tests).
  if (!LlmAudioAnalysisPg.associations?.request) {
    LlmAudioAnalysisPg.belongsTo(LlmRequestPg, {
      foreignKey: 'job_id', // llm_audio_analyses.job_id -> llm_requests.id (request_id)
      targetKey: 'id',
      as: 'request'
    });
  }

  if (!LlmRequestPg.associations?.audioAnalysis) {
    LlmRequestPg.hasOne(LlmAudioAnalysisPg, {
      foreignKey: 'job_id',
      sourceKey: 'id',
      as: 'audioAnalysis'
    });
  }
}

module.exports = setupPostgresAssociations;

