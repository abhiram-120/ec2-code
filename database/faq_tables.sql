-- FAQ parent row (one per FAQ item; optional S3 attachment)
CREATE TABLE `new_faqs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `category` VARCHAR(64) DEFAULT NULL,
  `attachment_url` VARCHAR(1024) DEFAULT NULL,
  `attachment_mime_type` VARCHAR(128) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-language question/answer (languages: EN, ES, FR, DE)
CREATE TABLE `new_faq_translations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `faq_id` INT UNSIGNED NOT NULL,
  `language` VARCHAR(5) NOT NULL,
  `question` TEXT NOT NULL,
  `answer` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_new_faq_translations_faq_language` (`faq_id`, `language`),
  KEY `idx_new_faq_translations_faq_id` (`faq_id`),
  CONSTRAINT `fk_new_faq_translations_faq`
    FOREIGN KEY (`faq_id`) REFERENCES `new_faqs` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
