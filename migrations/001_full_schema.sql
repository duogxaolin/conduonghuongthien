-- ============================================================
-- CDKT Full Schema Migration
-- Generated from server/db/init.ts + server/db/seed.ts
-- Target: MySQL 8.0+ / MariaDB 10.5+
-- Database: cdkt_admin (utf8mb4_unicode_ci)
-- ============================================================

CREATE DATABASE IF NOT EXISTS `cdkt_admin` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `cdkt_admin`;

-- ------------------------------------------------------------
-- 1. Core: roles, permissions, users
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `roles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(64) NOT NULL UNIQUE,
  `description` VARCHAR(255),
  `is_system` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `permissions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `role_id` INT NOT NULL,
  `resource` VARCHAR(64) NOT NULL,
  `can_create` TINYINT(1) DEFAULT 0,
  `can_read` TINYINT(1) DEFAULT 0,
  `can_update` TINYINT(1) DEFAULT 0,
  `can_delete` TINYINT(1) DEFAULT 0,
  `can_publish` TINYINT(1) DEFAULT 0,
  `can_archive` TINYINT(1) DEFAULT 0,
  `can_test` TINYINT(1) DEFAULT 0,
  UNIQUE KEY `role_resource_idx` (`role_id`, `resource`),
  CONSTRAINT `fk_permissions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(64) NOT NULL UNIQUE,
  `email` VARCHAR(128) UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role_id` INT,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `last_login_at` TIMESTAMP NULL,
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 2. Media
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `media` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `filename` VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(64) NOT NULL,
  `size_bytes` INT NOT NULL,
  `provider` VARCHAR(16) NOT NULL DEFAULT 'local',
  `url` VARCHAR(1024) NOT NULL,
  `storage_path` VARCHAR(1024) NOT NULL,
  `width` INT NULL,
  `height` INT NULL,
  `uploaded_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `mime_type_idx` (`mime_type`),
  CONSTRAINT `fk_media_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 3. Content types, categories, articles
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `content_types` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(64) NOT NULL UNIQUE,
  `icon` VARCHAR(64) NULL,
  `description` TEXT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `is_system` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(255) NOT NULL UNIQUE,
  `parent_id` INT NULL,
  `type` VARCHAR(32) NOT NULL,
  `description` TEXT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_categories_parent` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `articles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `type` VARCHAR(32) NOT NULL,
  `category` VARCHAR(128) NULL,
  `category_id` INT NULL,
  `title` VARCHAR(512) NOT NULL,
  `slug` VARCHAR(512) NOT NULL UNIQUE,
  `excerpt` TEXT NULL,
  `content` LONGTEXT NULL,
  `thumbnail_id` INT NULL,
  `thumbnail_url` VARCHAR(1024) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
  `author_id` INT NULL,
  `published_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `type_idx` (`type`),
  KEY `status_idx` (`status`),
  KEY `category_idx` (`category`),
  KEY `category_id_idx` (`category_id`),
  CONSTRAINT `fk_articles_thumbnail` FOREIGN KEY (`thumbnail_id`) REFERENCES `media` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_articles_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_articles_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 4. Home sections & Page builder
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `home_sections` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `type` VARCHAR(32) NOT NULL UNIQUE,
  `display_order` INT NOT NULL DEFAULT 0,
  `config` JSON NULL,
  `is_visible` TINYINT(1) DEFAULT 1,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` INT NULL,
  CONSTRAINT `fk_sections_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `page_contents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `slug` VARCHAR(64) NOT NULL,
  `section_key` VARCHAR(64) NOT NULL,
  `content` JSON NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` INT NULL,
  UNIQUE KEY `slug_section_idx` (`slug`, `section_key`),
  CONSTRAINT `fk_pages_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pages` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `slug` VARCHAR(64) NOT NULL UNIQUE,
  `title` VARCHAR(255) NOT NULL,
  `is_system` TINYINT(1) DEFAULT 0,
  `seo_title` VARCHAR(255) NULL,
  `seo_description` TEXT NULL,
  `draft_blocks` JSON NULL,
  `draft_updated_at` TIMESTAMP NULL,
  `draft_updated_by` INT NULL,
  `published_blocks` JSON NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` INT NULL,
  CONSTRAINT `fk_pages_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `page_blocks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `page_id` INT NOT NULL,
  `block_type` VARCHAR(48) NOT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `data` JSON NULL,
  `is_visible` TINYINT(1) DEFAULT 1,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` INT NULL,
  KEY `page_blocks_page_order_idx` (`page_id`, `display_order`),
  CONSTRAINT `fk_page_blocks_page` FOREIGN KEY (`page_id`) REFERENCES `pages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_page_blocks_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `page_versions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `page_id` INT NOT NULL,
  `kind` ENUM('origin','auto','manual') NOT NULL DEFAULT 'auto',
  `label` VARCHAR(128) NULL,
  `blocks` JSON NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT NULL,
  KEY `page_versions_page_kind_idx` (`page_id`, `kind`, `id`),
  CONSTRAINT `fk_page_versions_page` FOREIGN KEY (`page_id`) REFERENCES `pages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_page_versions_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 5. Settings, Activity Logs, Submissions
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `settings` (
  `key` VARCHAR(128) PRIMARY KEY,
  `value` TEXT NULL,
  `type` VARCHAR(16) DEFAULT 'string',
  `group` VARCHAR(32) DEFAULT 'general'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NULL,
  `action` VARCHAR(32) NOT NULL,
  `resource` VARCHAR(64) NULL,
  `resource_id` INT NULL,
  `meta` JSON NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `user_idx` (`user_id`),
  CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `submissions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(30) NOT NULL,
  `email` VARCHAR(255) NULL,
  `address` TEXT NULL,
  `message` TEXT NULL,
  `answers` JSON NULL,
  `form_title` VARCHAR(255) NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 6. Chatbot (settings, knowledge bank, terms)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `chatbot_settings` (
  `id` INT NOT NULL DEFAULT 1 PRIMARY KEY,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_policy` VARCHAR(64) NOT NULL DEFAULT 'openai-compatible',
  `base_url` VARCHAR(1024) NULL,
  `model` VARCHAR(128) NULL,
  `system_prompt` TEXT NULL,
  `allowed_hosts` JSON NULL,
  `request_timeout_ms` INT UNSIGNED NOT NULL DEFAULT 10000,
  `max_response_bytes` INT UNSIGNED NOT NULL DEFAULT 262144,
  `max_input_chars` INT UNSIGNED NOT NULL DEFAULT 2000,
  `max_history_messages` INT UNSIGNED NOT NULL DEFAULT 8,
  `retrieval_top_k` INT UNSIGNED NOT NULL DEFAULT 3,
  `reference_char_budget` INT UNSIGNED NOT NULL DEFAULT 6000,
  `rate_limit_requests` INT UNSIGNED NOT NULL DEFAULT 10,
  `rate_limit_window_seconds` INT UNSIGNED NOT NULL DEFAULT 60,
  `api_key_ciphertext` TEXT NULL,
  `api_key_nonce` VARCHAR(64) NULL,
  `api_key_auth_tag` VARCHAR(64) NULL,
  `api_key_version` INT UNSIGNED NULL,
  `api_key_key_id` VARCHAR(64) NULL,
  `api_key_last_four` VARCHAR(4) NULL,
  `updated_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_chatbot_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chatbot_knowledge` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `canonical_question` VARCHAR(1000) NOT NULL,
  `normalized_question` VARCHAR(191) NOT NULL,
  `approved_answer` LONGTEXT NOT NULL,
  `topic` VARCHAR(128) NOT NULL,
  `source_label` VARCHAR(255) NULL,
  `source_url` VARCHAR(1024) NULL,
  `source_reference` VARCHAR(512) NULL,
  `internal_notes` TEXT NULL,
  `status` ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  `priority` INT NOT NULL DEFAULT 0,
  `is_quick_question` TINYINT(1) NOT NULL DEFAULT 0,
  `author_id` INT NULL,
  `reviewer_id` INT NULL,
  `reviewed_at` DATETIME NULL,
  `published_at` DATETIME NULL,
  `archived_at` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `chatbot_knowledge_status_priority_id_idx` (`status`, `priority`, `id`),
  KEY `chatbot_knowledge_topic_status_priority_id_idx` (`topic`, `status`, `priority`, `id`),
  KEY `chatbot_knowledge_normalized_question_idx` (`normalized_question`),
  KEY `chatbot_knowledge_updated_id_idx` (`updated_at`, `id`),
  CONSTRAINT `fk_chatbot_knowledge_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chatbot_knowledge_reviewer` FOREIGN KEY (`reviewer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chatbot_knowledge_terms` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `knowledge_id` BIGINT UNSIGNED NOT NULL,
  `kind` ENUM('alias','keyword') NOT NULL,
  `value` VARCHAR(1000) NOT NULL,
  `normalized_value` VARCHAR(191) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `chatbot_terms_knowledge_kind_normalized_idx` (`knowledge_id`, `kind`, `normalized_value`),
  KEY `chatbot_terms_kind_normalized_knowledge_idx` (`kind`, `normalized_value`, `knowledge_id`),
  CONSTRAINT `fk_chatbot_terms_knowledge` FOREIGN KEY (`knowledge_id`) REFERENCES `chatbot_knowledge` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 7. Analytics (realtime + daily aggregates)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `analytics_live_minute_buckets` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `bucket_start` DATETIME NOT NULL,
  `scope_type` ENUM('total','path','source_category','device_class','country_code','region_code') NOT NULL,
  `scope_value` VARCHAR(512) NOT NULL,
  `scope_value_hash` VARCHAR(64) NOT NULL,
  `page_views` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `approximate_unique_visitors` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `analytics_live_bucket_scope_value_idx` (`bucket_start`, `scope_type`, `scope_value_hash`),
  KEY `analytics_live_bucket_scope_views_idx` (`bucket_start`, `scope_type`, `page_views`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `analytics_live_deduplication` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `bucket_start` DATETIME NOT NULL,
  `scope_type` ENUM('total','path','source_category','device_class','country_code','region_code') NOT NULL,
  `scope_value_hash` VARCHAR(64) NOT NULL,
  `visitor_token` VARCHAR(64) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `analytics_live_dedup_bucket_scope_visitor_idx` (`bucket_start`, `scope_type`, `scope_value_hash`, `visitor_token`),
  KEY `analytics_live_dedup_bucket_idx` (`bucket_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `analytics_noc_minute_aggregates` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `bucket_start` DATETIME NOT NULL,
  `event_type` VARCHAR(48) NOT NULL,
  `severity` VARCHAR(16) NOT NULL,
  `component` VARCHAR(32) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `error_code` VARCHAR(64) NOT NULL DEFAULT 'none',
  `event_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `duration_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `duration_total_ms` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `duration_max_ms` INT UNSIGNED NOT NULL DEFAULT 0,
  `details_json` VARCHAR(1024) NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `analytics_noc_bucket_identity_idx` (`bucket_start`, `event_type`, `severity`, `component`, `status`, `error_code`),
  KEY `analytics_noc_bucket_severity_idx` (`bucket_start`, `severity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `analytics_page_view_events` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `occurred_at` DATETIME NOT NULL,
  `event_day` DATE NOT NULL,
  `path` VARCHAR(512) NOT NULL,
  `visitor_token` VARCHAR(64) NOT NULL,
  `source_category` VARCHAR(32) NOT NULL DEFAULT 'direct',
  `device_class` VARCHAR(16) NOT NULL DEFAULT 'unknown',
  `country_code` VARCHAR(2) NULL,
  `region_code` VARCHAR(16) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `analytics_events_day_path_idx` (`event_day`, `path`),
  KEY `analytics_events_day_visitor_idx` (`event_day`, `visitor_token`),
  KEY `analytics_events_occurred_at_idx` (`occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `analytics_daily_traffic` (
  `day` DATE PRIMARY KEY,
  `page_views` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `daily_unique_visitors` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `analytics_daily_pages` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `day` DATE NOT NULL,
  `path` VARCHAR(512) NOT NULL,
  `page_views` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `daily_unique_visitors` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `analytics_daily_pages_day_path_idx` (`day`, `path`),
  KEY `analytics_daily_pages_day_views_idx` (`day`, `page_views`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `analytics_daily_dimensions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `day` DATE NOT NULL,
  `dimension` VARCHAR(32) NOT NULL,
  `value` VARCHAR(128) NOT NULL,
  `page_views` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `daily_unique_visitors` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `analytics_dimensions_day_dimension_value_idx` (`day`, `dimension`, `value`),
  KEY `analytics_dimensions_day_dimension_views_idx` (`day`, `dimension`, `page_views`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `analytics_daily_admin_users` (
  `day` DATE PRIMARY KEY,
  `total_users` INT UNSIGNED NOT NULL DEFAULT 0,
  `active_users` INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `analytics_maintenance_runs` (
  `day` DATE PRIMARY KEY,
  `status` VARCHAR(16) NOT NULL,
  `started_at` DATETIME NOT NULL,
  `completed_at` DATETIME NULL,
  `event_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `error_summary` VARCHAR(512) NULL,
  `worker_token` VARCHAR(64) NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `analytics_maintenance_status_day_idx` (`status`, `day`),
  KEY `analytics_maintenance_completed_at_idx` (`completed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
