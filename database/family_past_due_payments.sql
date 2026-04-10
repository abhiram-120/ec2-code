CREATE TABLE IF NOT EXISTS `family_past_due_payments` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,

  `family_id` INT(11) NOT NULL COMMENT 'Reference to the family that has the past due payment',
  `family_payment_transaction_id` INT(11) NULL DEFAULT NULL COMMENT 'Reference to the failed family payment transaction',

  `recurring_payment_uid` VARCHAR(255) NULL DEFAULT NULL COMMENT 'PayPlus recurring payment UID for this family',
  `amount` DECIMAL(10,2) NOT NULL COMMENT 'Total amount that failed for all children in the family',
  `currency` VARCHAR(10) NOT NULL DEFAULT 'ILS' COMMENT 'Currency code for the failed payment',

  `failed_at` DATETIME NOT NULL COMMENT 'Timestamp when the payment failed',
  `due_date` DATE NOT NULL COMMENT 'Date when the payment was due',

  `grace_period_days` INT(11) NOT NULL DEFAULT 30 COMMENT 'Number of days in the grace period',
  `grace_period_expires_at` DATETIME NOT NULL COMMENT 'Timestamp when the grace period expires',

  `status` ENUM('past_due','resolved','canceled') NOT NULL DEFAULT 'past_due' COMMENT 'Current status of the past due payment',
  `attempt_number` INT(11) NOT NULL DEFAULT 1 COMMENT 'Number of failed payment attempts',

  `last_reminder_sent_at` DATETIME NULL DEFAULT NULL COMMENT 'Timestamp when the last reminder was sent',
  `total_reminders_sent` INT(11) NOT NULL DEFAULT 0 COMMENT 'Total reminders sent',
  `whatsapp_messages_sent` INT(11) NOT NULL DEFAULT 0 COMMENT 'WhatsApp messages sent',

  `short_id` VARCHAR(16) NULL DEFAULT NULL COMMENT 'Short identifier for recovery URLs',
  `payment_link` TEXT NULL DEFAULT NULL COMMENT 'Recovery payment link URL',
  `payplus_page_request_uid` VARCHAR(255) NULL DEFAULT NULL COMMENT 'PayPlus page request UID',

  `resolved_at` DATETIME NULL DEFAULT NULL COMMENT 'Resolved timestamp',
  `resolved_transaction_id` VARCHAR(255) NULL DEFAULT NULL COMMENT 'Successful transaction ID',
  `resolved_payment_method` VARCHAR(50) NULL DEFAULT NULL COMMENT 'free_gift, bit, bank_transfer, cash, other',

  `canceled_at` DATETIME NULL DEFAULT NULL COMMENT 'Canceled timestamp',
  `cancellation_reason_category` VARCHAR(100) NULL DEFAULT NULL,
  `cancellation_reason` TEXT NULL DEFAULT NULL,

  `failure_status_code` VARCHAR(50) NULL DEFAULT NULL COMMENT 'PayPlus failure code',
  `failure_message_description` TEXT NULL DEFAULT NULL COMMENT 'PayPlus failure message',

  `children_count` INT(11) NOT NULL DEFAULT 0 COMMENT 'Number of children affected',
  `student_ids` TEXT NULL DEFAULT NULL COMMENT 'JSON array of student IDs',
  `subscription_ids` TEXT NULL DEFAULT NULL COMMENT 'JSON array of subscription IDs',

  `notes` TEXT NULL DEFAULT NULL COMMENT 'Additional notes',

  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_family_past_due_short_id` (`short_id`),

  KEY `idx_family_id` (`family_id`),
  KEY `idx_family_payment_transaction_id` (`family_payment_transaction_id`),
  KEY `idx_status` (`status`),
  KEY `idx_failed_at` (`failed_at`),
  KEY `idx_grace_period_expires_at` (`grace_period_expires_at`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Past due payment records for family payments';

CREATE TABLE IF NOT EXISTS `family_dunning_schedules` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,

  `family_past_due_payment_id` INT(11) NOT NULL COMMENT 'Reference to family past due payment',
  `family_id` INT(11) NOT NULL COMMENT 'Reference to the family',

  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `is_paused` TINYINT(1) NOT NULL DEFAULT 0,
  `paused_until` DATETIME NULL DEFAULT NULL,
  `paused_by_user_id` INT(11) NULL DEFAULT NULL,
  `paused_reason` VARCHAR(255) NULL DEFAULT NULL,

  `reminder_frequency` ENUM('daily','every_2_days','weekly') NOT NULL DEFAULT 'daily',
  `reminder_time` TIME NOT NULL DEFAULT '10:00:00',
  `timezone` VARCHAR(50) NOT NULL DEFAULT 'Asia/Jerusalem',

  `next_reminder_at` DATETIME NULL DEFAULT NULL,
  `last_reminder_sent_at` DATETIME NULL DEFAULT NULL,
  `total_reminders_sent` INT(11) NOT NULL DEFAULT 0,
  `max_reminders` INT(11) NULL DEFAULT NULL,

  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),

  KEY `idx_family_past_due_payment_id` (`family_past_due_payment_id`),
  KEY `idx_family_id` (`family_id`),
  KEY `idx_is_enabled` (`is_enabled`),
  KEY `idx_next_reminder_at` (`next_reminder_at`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Dunning schedules for family past due payments';
