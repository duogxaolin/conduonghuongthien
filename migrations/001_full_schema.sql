-- MySQL dump 10.13  Distrib 8.0.46, for Linux (aarch64)
--
-- Host: localhost    Database: cdkt_admin
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `activity_logs`
--

DROP TABLE IF EXISTS `activity_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `action` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `resource` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resource_id` int DEFAULT NULL,
  `meta` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_idx` (`user_id`),
  CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=104 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `analytics_daily_admin_users`
--

DROP TABLE IF EXISTS `analytics_daily_admin_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `analytics_daily_admin_users` (
  `day` date NOT NULL,
  `total_users` int unsigned NOT NULL DEFAULT '0',
  `active_users` int unsigned NOT NULL DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `analytics_daily_dimensions`
--

DROP TABLE IF EXISTS `analytics_daily_dimensions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `analytics_daily_dimensions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `day` date NOT NULL,
  `dimension` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `page_views` bigint unsigned NOT NULL DEFAULT '0',
  `daily_unique_visitors` bigint unsigned NOT NULL DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `analytics_dimensions_day_dimension_value_idx` (`day`,`dimension`,`value`),
  KEY `analytics_dimensions_day_dimension_views_idx` (`day`,`dimension`,`page_views`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `analytics_daily_pages`
--

DROP TABLE IF EXISTS `analytics_daily_pages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `analytics_daily_pages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `day` date NOT NULL,
  `path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `page_views` bigint unsigned NOT NULL DEFAULT '0',
  `daily_unique_visitors` bigint unsigned NOT NULL DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `analytics_daily_pages_day_path_idx` (`day`,`path`),
  KEY `analytics_daily_pages_day_views_idx` (`day`,`page_views`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `analytics_daily_traffic`
--

DROP TABLE IF EXISTS `analytics_daily_traffic`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `analytics_daily_traffic` (
  `day` date NOT NULL,
  `page_views` bigint unsigned NOT NULL DEFAULT '0',
  `daily_unique_visitors` bigint unsigned NOT NULL DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `analytics_live_deduplication`
--

DROP TABLE IF EXISTS `analytics_live_deduplication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `analytics_live_deduplication` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `bucket_start` datetime NOT NULL,
  `scope_type` enum('total','path','source_category','device_class','country_code','region_code') COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_value_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `visitor_token` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `analytics_live_dedup_bucket_scope_visitor_idx` (`bucket_start`,`scope_type`,`scope_value_hash`,`visitor_token`),
  KEY `analytics_live_dedup_bucket_idx` (`bucket_start`)
) ENGINE=InnoDB AUTO_INCREMENT=931 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `analytics_live_minute_buckets`
--

DROP TABLE IF EXISTS `analytics_live_minute_buckets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `analytics_live_minute_buckets` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `bucket_start` datetime NOT NULL,
  `scope_type` enum('total','path','source_category','device_class','country_code','region_code') COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_value` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_value_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `page_views` bigint unsigned NOT NULL DEFAULT '0',
  `approximate_unique_visitors` bigint unsigned NOT NULL DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `analytics_live_bucket_scope_value_idx` (`bucket_start`,`scope_type`,`scope_value_hash`),
  KEY `analytics_live_bucket_scope_views_idx` (`bucket_start`,`scope_type`,`page_views`)
) ENGINE=InnoDB AUTO_INCREMENT=931 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `analytics_maintenance_runs`
--

DROP TABLE IF EXISTS `analytics_maintenance_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `analytics_maintenance_runs` (
  `day` date NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `started_at` datetime NOT NULL,
  `completed_at` datetime DEFAULT NULL,
  `event_count` bigint unsigned NOT NULL DEFAULT '0',
  `error_summary` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `worker_token` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`day`),
  KEY `analytics_maintenance_status_day_idx` (`status`,`day`),
  KEY `analytics_maintenance_completed_at_idx` (`completed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `analytics_noc_minute_aggregates`
--

DROP TABLE IF EXISTS `analytics_noc_minute_aggregates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `analytics_noc_minute_aggregates` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `bucket_start` datetime NOT NULL,
  `event_type` varchar(48) COLLATE utf8mb4_unicode_ci NOT NULL,
  `severity` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `component` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `error_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none',
  `event_count` bigint unsigned NOT NULL DEFAULT '0',
  `duration_count` bigint unsigned NOT NULL DEFAULT '0',
  `duration_total_ms` bigint unsigned NOT NULL DEFAULT '0',
  `duration_max_ms` int unsigned NOT NULL DEFAULT '0',
  `details_json` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `analytics_noc_bucket_identity_idx` (`bucket_start`,`event_type`,`severity`,`component`,`status`,`error_code`),
  KEY `analytics_noc_bucket_severity_idx` (`bucket_start`,`severity`)
) ENGINE=InnoDB AUTO_INCREMENT=8126 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `analytics_page_view_events`
--

DROP TABLE IF EXISTS `analytics_page_view_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `analytics_page_view_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `occurred_at` datetime NOT NULL,
  `event_day` date NOT NULL,
  `path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `visitor_token` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_category` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'direct',
  `device_class` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unknown',
  `country_code` varchar(2) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `region_code` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `analytics_events_day_path_idx` (`event_day`,`path`),
  KEY `analytics_events_day_visitor_idx` (`event_day`,`visitor_token`),
  KEY `analytics_events_occurred_at_idx` (`occurred_at`)
) ENGINE=InnoDB AUTO_INCREMENT=235 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `articles`
--

DROP TABLE IF EXISTS `articles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `articles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category_id` int DEFAULT NULL,
  `title` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `excerpt` text COLLATE utf8mb4_unicode_ci,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `thumbnail_id` int DEFAULT NULL,
  `thumbnail_url` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `author_id` int DEFAULT NULL,
  `published_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `type_idx` (`type`),
  KEY `status_idx` (`status`),
  KEY `fk_articles_thumbnail` (`thumbnail_id`),
  KEY `fk_articles_author` (`author_id`),
  KEY `idx_articles_category_id` (`category_id`),
  CONSTRAINT `fk_articles_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_articles_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_articles_thumbnail` FOREIGN KEY (`thumbnail_id`) REFERENCES `media` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `categories`
--

DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_id` int DEFAULT NULL,
  `type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `display_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `fk_categories_parent` (`parent_id`),
  CONSTRAINT `fk_categories_parent` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=799 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chatbot_knowledge`
--

DROP TABLE IF EXISTS `chatbot_knowledge`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chatbot_knowledge` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `canonical_question` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `normalized_question` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `approved_answer` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `topic` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_label` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_url` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_reference` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `internal_notes` text COLLATE utf8mb4_unicode_ci,
  `status` enum('draft','published','archived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `priority` int NOT NULL DEFAULT '0',
  `is_quick_question` tinyint(1) NOT NULL DEFAULT '0',
  `author_id` int DEFAULT NULL,
  `reviewer_id` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  `archived_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `chatbot_knowledge_status_priority_id_idx` (`status`,`priority`,`id`),
  KEY `chatbot_knowledge_topic_status_priority_id_idx` (`topic`,`status`,`priority`,`id`),
  KEY `chatbot_knowledge_normalized_question_idx` (`normalized_question`),
  KEY `chatbot_knowledge_updated_id_idx` (`updated_at`,`id`),
  KEY `fk_chatbot_knowledge_author` (`author_id`),
  KEY `fk_chatbot_knowledge_reviewer` (`reviewer_id`),
  CONSTRAINT `fk_chatbot_knowledge_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chatbot_knowledge_reviewer` FOREIGN KEY (`reviewer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chatbot_knowledge_terms`
--

DROP TABLE IF EXISTS `chatbot_knowledge_terms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chatbot_knowledge_terms` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `knowledge_id` bigint unsigned NOT NULL,
  `kind` enum('alias','keyword') COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `normalized_value` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `chatbot_terms_knowledge_kind_normalized_idx` (`knowledge_id`,`kind`,`normalized_value`),
  KEY `chatbot_terms_kind_normalized_knowledge_idx` (`kind`,`normalized_value`,`knowledge_id`),
  CONSTRAINT `fk_chatbot_terms_knowledge` FOREIGN KEY (`knowledge_id`) REFERENCES `chatbot_knowledge` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chatbot_settings`
--

DROP TABLE IF EXISTS `chatbot_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chatbot_settings` (
  `id` int NOT NULL DEFAULT '1',
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `provider_policy` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'openai-compatible',
  `base_url` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `model` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `system_prompt` text COLLATE utf8mb4_unicode_ci,
  `allowed_hosts` json DEFAULT NULL,
  `request_timeout_ms` int unsigned NOT NULL DEFAULT '10000',
  `max_response_bytes` int unsigned NOT NULL DEFAULT '262144',
  `max_input_chars` int unsigned NOT NULL DEFAULT '2000',
  `max_history_messages` int unsigned NOT NULL DEFAULT '8',
  `retrieval_top_k` int unsigned NOT NULL DEFAULT '3',
  `reference_char_budget` int unsigned NOT NULL DEFAULT '6000',
  `rate_limit_requests` int unsigned NOT NULL DEFAULT '10',
  `rate_limit_window_seconds` int unsigned NOT NULL DEFAULT '60',
  `api_key_ciphertext` text COLLATE utf8mb4_unicode_ci,
  `api_key_nonce` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `api_key_auth_tag` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `api_key_version` int unsigned DEFAULT NULL,
  `api_key_key_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `api_key_last_four` varchar(4) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_chatbot_settings_user` (`updated_by`),
  CONSTRAINT `fk_chatbot_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `content_types`
--

DROP TABLE IF EXISTS `content_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `content_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `icon` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `display_order` int NOT NULL DEFAULT '0',
  `is_system` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=512 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `home_sections`
--

DROP TABLE IF EXISTS `home_sections`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `home_sections` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_order` int NOT NULL DEFAULT '0',
  `config` json DEFAULT NULL,
  `is_visible` tinyint(1) DEFAULT '1',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `type` (`type`),
  KEY `fk_sections_user` (`updated_by`),
  CONSTRAINT `fk_sections_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1404 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `media`
--

DROP TABLE IF EXISTS `media`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `media` (
  `id` int NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `size_bytes` int NOT NULL,
  `provider` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'local',
  `url` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storage_path` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL,
  `width` int DEFAULT NULL,
  `height` int DEFAULT NULL,
  `uploaded_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `mime_type_idx` (`mime_type`),
  KEY `fk_media_user` (`uploaded_by`),
  CONSTRAINT `fk_media_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `page_blocks`
--

DROP TABLE IF EXISTS `page_blocks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `page_blocks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `page_id` int NOT NULL,
  `block_type` varchar(48) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_order` int NOT NULL DEFAULT '0',
  `data` json DEFAULT NULL,
  `is_visible` tinyint(1) DEFAULT '1',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `page_blocks_page_order_idx` (`page_id`,`display_order`),
  KEY `fk_page_blocks_updated_by` (`updated_by`),
  CONSTRAINT `fk_page_blocks_page` FOREIGN KEY (`page_id`) REFERENCES `pages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_page_blocks_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `page_contents`
--

DROP TABLE IF EXISTS `page_contents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `page_contents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `section_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` json NOT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug_section_idx` (`slug`,`section_key`),
  KEY `fk_pages_user` (`updated_by`),
  CONSTRAINT `fk_pages_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `page_versions`
--

DROP TABLE IF EXISTS `page_versions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `page_versions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `page_id` int NOT NULL,
  `kind` enum('origin','auto','manual') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'auto',
  `label` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `blocks` json NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `page_versions_page_kind_idx` (`page_id`,`kind`,`id`),
  KEY `fk_page_versions_created_by` (`created_by`),
  CONSTRAINT `fk_page_versions_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_page_versions_page` FOREIGN KEY (`page_id`) REFERENCES `pages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pages`
--

DROP TABLE IF EXISTS `pages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_system` tinyint(1) DEFAULT '0',
  `seo_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `seo_description` text COLLATE utf8mb4_unicode_ci,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `draft_blocks` json DEFAULT NULL,
  `draft_updated_at` timestamp NULL DEFAULT NULL,
  `draft_updated_by` int DEFAULT NULL,
  `published_blocks` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `fk_pages_updated_by` (`updated_by`),
  CONSTRAINT `fk_pages_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=150 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `permissions`
--

DROP TABLE IF EXISTS `permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `role_id` int NOT NULL,
  `resource` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `can_create` tinyint(1) DEFAULT '0',
  `can_read` tinyint(1) DEFAULT '0',
  `can_update` tinyint(1) DEFAULT '0',
  `can_delete` tinyint(1) DEFAULT '0',
  `can_publish` tinyint(1) DEFAULT '0',
  `can_archive` tinyint(1) DEFAULT '0',
  `can_test` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_resource_idx` (`role_id`,`resource`),
  CONSTRAINT `fk_permissions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9104 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `roles`
--

DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_system` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=660 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `settings`
--

DROP TABLE IF EXISTS `settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `settings` (
  `key` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text COLLATE utf8mb4_unicode_ci,
  `type` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT 'string',
  `group` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'general',
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `submissions`
--

DROP TABLE IF EXISTS `submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `submissions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `full_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `message` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `answers` json DEFAULT NULL,
  `form_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_id` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  KEY `fk_users_role` (`role_id`),
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=175 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping routines for database 'cdkt_admin'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-25  5:49:31
