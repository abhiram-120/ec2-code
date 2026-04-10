
--llm_audio_analyses
CREATE TABLE `llm_audio_analyses` (
  `id` bigint NOT NULL,
  `job_id` char(36) NOT NULL COMMENT 'FK to llm_requests.id',
  `zoom_meeting_id` varchar(64) DEFAULT NULL COMMENT 'Zoom meeting ID if from webhook',
  `summary` text NOT NULL COMMENT 'Detailed transcript summary (250 words)',
  `topics` json NOT NULL COMMENT 'List of topics covered',
  `level` varchar(50) NOT NULL COMMENT 'CEFR level (e.g., A2 Elementary)',
  `grammar_feedback` text COMMENT 'Grammar analysis feedback for student',
  `vocabulary_feedback` text COMMENT 'Vocabulary analysis feedback for student',
  `pronunciation_feedback` text COMMENT 'Pronunciation analysis feedback for student',
  `general_comment` text COMMENT 'Focus summary / lesson objective',
  `vocabulary_score` int DEFAULT '0' COMMENT 'Vocabulary score 0-100',
  `grammar_score` int DEFAULT '0' COMMENT 'Grammar score 0-100',
  `fluency_score` int DEFAULT '0' COMMENT 'Fluency/pronunciation score 0-100',
  `engagement_level` enum('low','medium','high') DEFAULT 'medium' COMMENT 'Student engagement level',
  `raw_analysis` json NOT NULL COMMENT 'Complete raw Gemini analysis JSON (full responseSchema)',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `vocabulary_words` json DEFAULT NULL COMMENT 'Array of vocabulary words from lesson',
  `grammar_points` json DEFAULT NULL COMMENT 'Array of grammar points from lesson'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


--Indexes for table `llm_audio_analyses`

ALTER TABLE `llm_audio_analyses`
  ADD PRIMARY KEY (`id`);



--AUTO_INCREMENT for table `llm_audio_analyses`
ALTER TABLE `llm_audio_analyses`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2750;
COMMIT;



--llm_intake_queue
CREATE TABLE `llm_intake_queue` (
  `id` bigint NOT NULL,
  `audio_url` text NOT NULL COMMENT 'URL or path to the audio file',
  `level` varchar(50) DEFAULT 'unknown' COMMENT 'CEFR level hint',
  `language` varchar(50) DEFAULT 'hebrew' COMMENT 'Target language for analysis',
  `zoom_meeting_id` varchar(64) DEFAULT NULL COMMENT 'Zoom meeting ID if applicable',
  `topic` varchar(255) DEFAULT '' COMMENT 'Lesson topic hint',
  `idempotency_key` varchar(512) DEFAULT NULL COMMENT 'Dedup key; reuses existing llm_requests if matched',
  `priority` int DEFAULT '100' COMMENT 'Higher = admitted first',
  `status` varchar(32) DEFAULT 'PENDING' COMMENT 'PENDING | ADMITTING | ADMITTED | FAILED | CANCELLED | DISABLED',
  `request_id` char(36) DEFAULT NULL COMMENT 'FK to llm_requests.id once admitted',
  `attempt_count` int DEFAULT '0' COMMENT 'Number of admission attempts by intake module',
  `max_attempts` int DEFAULT '5' COMMENT 'Max attempts before auto-disable',
  `error` text COMMENT 'Last error message on failure',
  `metadata` json DEFAULT NULL COMMENT 'Arbitrary metadata from submitter',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `admitted_at` datetime DEFAULT NULL COMMENT 'Timestamp when item was admitted into llm_requests'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `llm_intake_queue`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_intake_status_priority` (`status`,`priority` DESC,`created_at`),
  ADD KEY `idx_intake_created_at` (`created_at`);


--AUTO_INCREMENT for dumped tables



--AUTO_INCREMENT for table `llm_intake_queue`

ALTER TABLE `llm_intake_queue`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3095;
COMMIT;



--llm_requests

CREATE TABLE `llm_requests` (
  `id` char(36) NOT NULL,
  `user_id` char(36) DEFAULT NULL,
  `idempotency_key` text,
  `prompt_template_id` char(36) DEFAULT NULL,
  `provider` text,
  `model` text,
  `payload` json DEFAULT NULL,
  `status` varchar(255) DEFAULT NULL,
  `attempt_count` int DEFAULT '0',
  `priority` int DEFAULT '100',
  `schema_definition` json DEFAULT NULL,
  `schema_validation_status` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `locked_at` datetime DEFAULT NULL,
  `worker_id` text,
  `dedup_hit_count` int DEFAULT '0' COMMENT 'Number of duplicate submissions suppressed'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `llm_requests`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `idx_requests_user_id_idempotency_key` (`user_id`,`idempotency_key`(255)),
  ADD KEY `prompt_template_id` (`prompt_template_id`),
  ADD KEY `idx_requests_status` (`status`),
  ADD KEY `idx_requests_created_at` (`created_at`);
COMMIT;


-- llm_responses
ALTER TABLE `llm_responses`
  ADD PRIMARY KEY (`request_id`);
COMMIT;

CREATE TABLE `llm_responses` (
  `request_id` char(36) NOT NULL,
  `raw_response` json DEFAULT NULL,
  `parsed_response` json DEFAULT NULL,
  `completed_at` datetime DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;