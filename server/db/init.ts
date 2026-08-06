import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'

export type ChatbotColumnMigration = {
  table: string
  column: string
  nullableDefinition: string
  finalDefinition: string
  backfillExpression?: string
  columnTypes: readonly string[]
  nullable: boolean
  defaultValue: string | null
  extra?: string
}

const settingsColumns: ChatbotColumnMigration[] = [
  { table: 'chatbot_settings', column: 'id', nullableDefinition: 'INT NOT NULL AUTO_INCREMENT UNIQUE FIRST', finalDefinition: 'INT NOT NULL DEFAULT 1', columnTypes: ['int'], nullable: false, defaultValue: '1' },
  { table: 'chatbot_settings', column: 'enabled', nullableDefinition: 'TINYINT(1) NULL', finalDefinition: 'TINYINT(1) NOT NULL DEFAULT 0', backfillExpression: '0', columnTypes: ['tinyint(1)'], nullable: false, defaultValue: '0' },
  { table: 'chatbot_settings', column: 'provider_policy', nullableDefinition: 'VARCHAR(64) NULL', finalDefinition: "VARCHAR(64) NOT NULL DEFAULT 'openai-compatible'", backfillExpression: "'openai-compatible'", columnTypes: ['varchar(64)'], nullable: false, defaultValue: 'openai-compatible' },
  { table: 'chatbot_settings', column: 'base_url', nullableDefinition: 'VARCHAR(1024) NULL', finalDefinition: 'VARCHAR(1024) NULL', columnTypes: ['varchar(1024)'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'model', nullableDefinition: 'VARCHAR(128) NULL', finalDefinition: 'VARCHAR(128) NULL', columnTypes: ['varchar(128)'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'system_prompt', nullableDefinition: 'TEXT NULL', finalDefinition: 'TEXT NULL', columnTypes: ['text'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'allowed_hosts', nullableDefinition: 'JSON NULL', finalDefinition: 'JSON NULL', columnTypes: ['json', 'longtext'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'request_timeout_ms', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 10000', backfillExpression: '10000', columnTypes: ['int unsigned'], nullable: false, defaultValue: '10000' },
  { table: 'chatbot_settings', column: 'max_response_bytes', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 262144', backfillExpression: '262144', columnTypes: ['int unsigned'], nullable: false, defaultValue: '262144' },
  { table: 'chatbot_settings', column: 'max_input_chars', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 2000', backfillExpression: '2000', columnTypes: ['int unsigned'], nullable: false, defaultValue: '2000' },
  { table: 'chatbot_settings', column: 'max_history_messages', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 8', backfillExpression: '8', columnTypes: ['int unsigned'], nullable: false, defaultValue: '8' },
  { table: 'chatbot_settings', column: 'retrieval_top_k', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 3', backfillExpression: '3', columnTypes: ['int unsigned'], nullable: false, defaultValue: '3' },
  { table: 'chatbot_settings', column: 'reference_char_budget', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 6000', backfillExpression: '6000', columnTypes: ['int unsigned'], nullable: false, defaultValue: '6000' },
  { table: 'chatbot_settings', column: 'rate_limit_requests', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 10', backfillExpression: '10', columnTypes: ['int unsigned'], nullable: false, defaultValue: '10' },
  { table: 'chatbot_settings', column: 'rate_limit_window_seconds', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 60', backfillExpression: '60', columnTypes: ['int unsigned'], nullable: false, defaultValue: '60' },
  { table: 'chatbot_settings', column: 'api_key_ciphertext', nullableDefinition: 'TEXT NULL', finalDefinition: 'TEXT NULL', columnTypes: ['text'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'api_key_nonce', nullableDefinition: 'VARCHAR(64) NULL', finalDefinition: 'VARCHAR(64) NULL', columnTypes: ['varchar(64)'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'api_key_auth_tag', nullableDefinition: 'VARCHAR(64) NULL', finalDefinition: 'VARCHAR(64) NULL', columnTypes: ['varchar(64)'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'api_key_version', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NULL', columnTypes: ['int unsigned'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'api_key_key_id', nullableDefinition: 'VARCHAR(64) NULL', finalDefinition: 'VARCHAR(64) NULL', columnTypes: ['varchar(64)'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'api_key_last_four', nullableDefinition: 'VARCHAR(4) NULL', finalDefinition: 'VARCHAR(4) NULL', columnTypes: ['varchar(4)'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'updated_by', nullableDefinition: 'INT NULL', finalDefinition: 'INT NULL', columnTypes: ['int'], nullable: true, defaultValue: null },
  { table: 'chatbot_settings', column: 'created_at', nullableDefinition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP', finalDefinition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP', columnTypes: ['timestamp'], nullable: true, defaultValue: 'current_timestamp' },
  { table: 'chatbot_settings', column: 'updated_at', nullableDefinition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', finalDefinition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', columnTypes: ['timestamp'], nullable: true, defaultValue: 'current_timestamp', extra: 'on update current_timestamp' },
]

const knowledgeColumns: ChatbotColumnMigration[] = [
  { table: 'chatbot_knowledge', column: 'id', nullableDefinition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST', finalDefinition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', columnTypes: ['bigint unsigned'], nullable: false, defaultValue: null, extra: 'auto_increment' },
  { table: 'chatbot_knowledge', column: 'canonical_question', nullableDefinition: 'VARCHAR(1000) NULL', finalDefinition: 'VARCHAR(1000) NOT NULL', backfillExpression: "CONCAT('Legacy question ', `id`)", columnTypes: ['varchar(1000)'], nullable: false, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'normalized_question', nullableDefinition: 'VARCHAR(191) NULL', finalDefinition: 'VARCHAR(191) NOT NULL', backfillExpression: "LOWER(CONCAT('legacy question ', `id`))", columnTypes: ['varchar(191)'], nullable: false, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'approved_answer', nullableDefinition: 'LONGTEXT NULL', finalDefinition: 'LONGTEXT NOT NULL', backfillExpression: "''", columnTypes: ['longtext'], nullable: false, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'topic', nullableDefinition: 'VARCHAR(128) NULL', finalDefinition: 'VARCHAR(128) NOT NULL', backfillExpression: "'general'", columnTypes: ['varchar(128)'], nullable: false, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'source_label', nullableDefinition: 'VARCHAR(255) NULL', finalDefinition: 'VARCHAR(255) NULL', columnTypes: ['varchar(255)'], nullable: true, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'source_url', nullableDefinition: 'VARCHAR(1024) NULL', finalDefinition: 'VARCHAR(1024) NULL', columnTypes: ['varchar(1024)'], nullable: true, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'source_reference', nullableDefinition: 'VARCHAR(512) NULL', finalDefinition: 'VARCHAR(512) NULL', columnTypes: ['varchar(512)'], nullable: true, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'internal_notes', nullableDefinition: 'TEXT NULL', finalDefinition: 'TEXT NULL', columnTypes: ['text'], nullable: true, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'status', nullableDefinition: "ENUM('draft','published','archived') NULL", finalDefinition: "ENUM('draft','published','archived') NOT NULL DEFAULT 'draft'", backfillExpression: "'draft'", columnTypes: ["enum('draft','published','archived')"], nullable: false, defaultValue: 'draft' },
  { table: 'chatbot_knowledge', column: 'priority', nullableDefinition: 'INT NULL', finalDefinition: 'INT NOT NULL DEFAULT 0', backfillExpression: '0', columnTypes: ['int'], nullable: false, defaultValue: '0' },
  { table: 'chatbot_knowledge', column: 'is_quick_question', nullableDefinition: 'TINYINT(1) NULL', finalDefinition: 'TINYINT(1) NOT NULL DEFAULT 0', backfillExpression: '0', columnTypes: ['tinyint(1)'], nullable: false, defaultValue: '0' },
  { table: 'chatbot_knowledge', column: 'author_id', nullableDefinition: 'INT NULL', finalDefinition: 'INT NULL', columnTypes: ['int'], nullable: true, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'reviewer_id', nullableDefinition: 'INT NULL', finalDefinition: 'INT NULL', columnTypes: ['int'], nullable: true, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'reviewed_at', nullableDefinition: 'DATETIME NULL', finalDefinition: 'DATETIME NULL', columnTypes: ['datetime'], nullable: true, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'published_at', nullableDefinition: 'DATETIME NULL', finalDefinition: 'DATETIME NULL', columnTypes: ['datetime'], nullable: true, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'archived_at', nullableDefinition: 'DATETIME NULL', finalDefinition: 'DATETIME NULL', columnTypes: ['datetime'], nullable: true, defaultValue: null },
  { table: 'chatbot_knowledge', column: 'created_at', nullableDefinition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP', finalDefinition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP', columnTypes: ['timestamp'], nullable: true, defaultValue: 'current_timestamp' },
  { table: 'chatbot_knowledge', column: 'updated_at', nullableDefinition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', finalDefinition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', columnTypes: ['timestamp'], nullable: true, defaultValue: 'current_timestamp', extra: 'on update current_timestamp' },
]

const termColumns: ChatbotColumnMigration[] = [
  { table: 'chatbot_knowledge_terms', column: 'id', nullableDefinition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST', finalDefinition: 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', columnTypes: ['bigint unsigned'], nullable: false, defaultValue: null, extra: 'auto_increment' },
  { table: 'chatbot_knowledge_terms', column: 'knowledge_id', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL', backfillExpression: '`id`', columnTypes: ['bigint unsigned'], nullable: false, defaultValue: null },
  { table: 'chatbot_knowledge_terms', column: 'kind', nullableDefinition: "ENUM('alias','keyword') NULL", finalDefinition: "ENUM('alias','keyword') NOT NULL", backfillExpression: "'alias'", columnTypes: ["enum('alias','keyword')"], nullable: false, defaultValue: null },
  { table: 'chatbot_knowledge_terms', column: 'value', nullableDefinition: 'VARCHAR(1000) NULL', finalDefinition: 'VARCHAR(1000) NOT NULL', backfillExpression: "CONCAT('Legacy term ', `id`)", columnTypes: ['varchar(1000)'], nullable: false, defaultValue: null },
  { table: 'chatbot_knowledge_terms', column: 'normalized_value', nullableDefinition: 'VARCHAR(191) NULL', finalDefinition: 'VARCHAR(191) NOT NULL', backfillExpression: "LOWER(CONCAT('legacy term ', `id`))", columnTypes: ['varchar(191)'], nullable: false, defaultValue: null },
  { table: 'chatbot_knowledge_terms', column: 'created_at', nullableDefinition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP', finalDefinition: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP', columnTypes: ['timestamp'], nullable: true, defaultValue: 'current_timestamp' },
]

export const chatbotColumnMigrations = [...settingsColumns, ...knowledgeColumns, ...termColumns]

export const chatbotConvergentIndexMigrations = [
  { table: 'chatbot_settings', name: 'PRIMARY', unique: true, columns: ['id'], definition: 'PRIMARY KEY (`id`)' },
  { table: 'chatbot_knowledge', name: 'PRIMARY', unique: true, columns: ['id'], definition: 'PRIMARY KEY (`id`)' },
  { table: 'chatbot_knowledge', name: 'chatbot_knowledge_status_priority_id_idx', unique: false, columns: ['status', 'priority', 'id'], definition: 'INDEX `chatbot_knowledge_status_priority_id_idx` (`status`, `priority`, `id`)' },
  { table: 'chatbot_knowledge', name: 'chatbot_knowledge_topic_status_priority_id_idx', unique: false, columns: ['topic', 'status', 'priority', 'id'], definition: 'INDEX `chatbot_knowledge_topic_status_priority_id_idx` (`topic`, `status`, `priority`, `id`)' },
  { table: 'chatbot_knowledge', name: 'chatbot_knowledge_normalized_question_idx', unique: false, columns: ['normalized_question'], definition: 'INDEX `chatbot_knowledge_normalized_question_idx` (`normalized_question`)' },
  { table: 'chatbot_knowledge', name: 'chatbot_knowledge_updated_id_idx', unique: false, columns: ['updated_at', 'id'], definition: 'INDEX `chatbot_knowledge_updated_id_idx` (`updated_at`, `id`)' },
  { table: 'chatbot_knowledge_terms', name: 'PRIMARY', unique: true, columns: ['id'], definition: 'PRIMARY KEY (`id`)' },
  { table: 'chatbot_knowledge_terms', name: 'chatbot_terms_knowledge_kind_normalized_idx', unique: true, columns: ['knowledge_id', 'kind', 'normalized_value'], definition: 'UNIQUE INDEX `chatbot_terms_knowledge_kind_normalized_idx` (`knowledge_id`, `kind`, `normalized_value`)' },
  { table: 'chatbot_knowledge_terms', name: 'chatbot_terms_kind_normalized_knowledge_idx', unique: false, columns: ['kind', 'normalized_value', 'knowledge_id'], definition: 'INDEX `chatbot_terms_kind_normalized_knowledge_idx` (`kind`, `normalized_value`, `knowledge_id`)' },
] as const

export const chatbotForeignKeyMigrations = [
  { table: 'chatbot_settings', name: 'fk_chatbot_settings_user', columns: ['updated_by'], referencedTable: 'users', referencedColumns: ['id'], deleteRule: 'SET NULL', definition: 'FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL' },
  { table: 'chatbot_knowledge', name: 'fk_chatbot_knowledge_author', columns: ['author_id'], referencedTable: 'users', referencedColumns: ['id'], deleteRule: 'SET NULL', definition: 'FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL' },
  { table: 'chatbot_knowledge', name: 'fk_chatbot_knowledge_reviewer', columns: ['reviewer_id'], referencedTable: 'users', referencedColumns: ['id'], deleteRule: 'SET NULL', definition: 'FOREIGN KEY (`reviewer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL' },
  { table: 'chatbot_knowledge_terms', name: 'fk_chatbot_terms_knowledge', columns: ['knowledge_id'], referencedTable: 'chatbot_knowledge', referencedColumns: ['id'], deleteRule: 'CASCADE', definition: 'FOREIGN KEY (`knowledge_id`) REFERENCES `chatbot_knowledge` (`id`) ON DELETE CASCADE' },
] as const

export type RequiredColumnMigration = {
  table: string
  column: string
  nullableDefinition: string
  finalDefinition: string
  backfillExpression: string
}

export const requiredAnalyticsColumnMigrations: RequiredColumnMigration[] = [
  { table: 'analytics_page_view_events', column: 'occurred_at', nullableDefinition: 'DATETIME NULL', finalDefinition: 'DATETIME NOT NULL', backfillExpression: 'COALESCE(`created_at`, UTC_TIMESTAMP())' },
  { table: 'analytics_page_view_events', column: 'event_day', nullableDefinition: 'DATE NULL', finalDefinition: 'DATE NOT NULL', backfillExpression: 'DATE(`occurred_at`)' },
  { table: 'analytics_page_view_events', column: 'path', nullableDefinition: 'VARCHAR(512) NULL', finalDefinition: 'VARCHAR(512) NOT NULL', backfillExpression: "'/other'" },
  { table: 'analytics_page_view_events', column: 'visitor_token', nullableDefinition: 'VARCHAR(64) NULL', finalDefinition: 'VARCHAR(64) NOT NULL', backfillExpression: "SHA2(CONCAT('legacy-analytics-event:', `id`), 256)" },
  { table: 'analytics_page_view_events', column: 'source_category', nullableDefinition: 'VARCHAR(32) NULL', finalDefinition: "VARCHAR(32) NOT NULL DEFAULT 'direct'", backfillExpression: "'direct'" },
  { table: 'analytics_page_view_events', column: 'device_class', nullableDefinition: 'VARCHAR(16) NULL', finalDefinition: "VARCHAR(16) NOT NULL DEFAULT 'unknown'", backfillExpression: "'unknown'" },
  { table: 'analytics_daily_traffic', column: 'page_views', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_daily_traffic', column: 'daily_unique_visitors', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_daily_pages', column: 'day', nullableDefinition: 'DATE NULL', finalDefinition: 'DATE NOT NULL', backfillExpression: "COALESCE(DATE(`updated_at`), '1970-01-01')" },
  { table: 'analytics_daily_pages', column: 'path', nullableDefinition: 'VARCHAR(512) NULL', finalDefinition: 'VARCHAR(512) NOT NULL', backfillExpression: "CONCAT('/other/legacy-', `id`)" },
  { table: 'analytics_daily_pages', column: 'page_views', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_daily_pages', column: 'daily_unique_visitors', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_daily_dimensions', column: 'day', nullableDefinition: 'DATE NULL', finalDefinition: 'DATE NOT NULL', backfillExpression: "COALESCE(DATE(`updated_at`), '1970-01-01')" },
  { table: 'analytics_daily_dimensions', column: 'dimension', nullableDefinition: 'VARCHAR(32) NULL', finalDefinition: 'VARCHAR(32) NOT NULL', backfillExpression: "'source_category'" },
  { table: 'analytics_daily_dimensions', column: 'value', nullableDefinition: 'VARCHAR(128) NULL', finalDefinition: 'VARCHAR(128) NOT NULL', backfillExpression: "CONCAT('other-legacy-', `id`)" },
  { table: 'analytics_daily_dimensions', column: 'page_views', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_daily_dimensions', column: 'daily_unique_visitors', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_daily_admin_users', column: 'total_users', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_daily_admin_users', column: 'active_users', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_maintenance_runs', column: 'status', nullableDefinition: 'VARCHAR(16) NULL', finalDefinition: 'VARCHAR(16) NOT NULL', backfillExpression: "'failed'" },
  { table: 'analytics_maintenance_runs', column: 'started_at', nullableDefinition: 'DATETIME NULL', finalDefinition: 'DATETIME NOT NULL', backfillExpression: 'COALESCE(`updated_at`, UTC_TIMESTAMP())' },
  { table: 'analytics_maintenance_runs', column: 'event_count', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
]

export const realtimeAnalyticsRequiredColumnMigrations: RequiredColumnMigration[] = [
  { table: 'analytics_live_minute_buckets', column: 'bucket_start', nullableDefinition: 'DATETIME NULL', finalDefinition: 'DATETIME NOT NULL', backfillExpression: 'COALESCE(`updated_at`, UTC_TIMESTAMP())' },
  { table: 'analytics_live_minute_buckets', column: 'scope_type', nullableDefinition: "ENUM('total','path','source_category','device_class','country_code','region_code') NULL", finalDefinition: "ENUM('total','path','source_category','device_class','country_code','region_code') NOT NULL", backfillExpression: "'total'" },
  { table: 'analytics_live_minute_buckets', column: 'scope_value', nullableDefinition: 'VARCHAR(512) NULL', finalDefinition: 'VARCHAR(512) NOT NULL', backfillExpression: "''" },
  { table: 'analytics_live_minute_buckets', column: 'scope_value_hash', nullableDefinition: 'VARCHAR(64) NULL', finalDefinition: 'VARCHAR(64) NOT NULL', backfillExpression: "SHA2(CONCAT(`scope_type`, '\\n', `scope_value`), 256)" },
  { table: 'analytics_live_minute_buckets', column: 'page_views', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_live_minute_buckets', column: 'approximate_unique_visitors', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_live_deduplication', column: 'bucket_start', nullableDefinition: 'DATETIME NULL', finalDefinition: 'DATETIME NOT NULL', backfillExpression: 'COALESCE(`created_at`, UTC_TIMESTAMP())' },
  { table: 'analytics_live_deduplication', column: 'scope_type', nullableDefinition: "ENUM('total','path','source_category','device_class','country_code','region_code') NULL", finalDefinition: "ENUM('total','path','source_category','device_class','country_code','region_code') NOT NULL", backfillExpression: "'total'" },
  { table: 'analytics_live_deduplication', column: 'scope_value_hash', nullableDefinition: 'VARCHAR(64) NULL', finalDefinition: 'VARCHAR(64) NOT NULL', backfillExpression: "SHA2(CONCAT('legacy-live-scope:', `id`), 256)" },
  { table: 'analytics_live_deduplication', column: 'visitor_token', nullableDefinition: 'VARCHAR(64) NULL', finalDefinition: 'VARCHAR(64) NOT NULL', backfillExpression: "SHA2(CONCAT('legacy-live-visitor:', `id`), 256)" },
  { table: 'analytics_noc_minute_aggregates', column: 'bucket_start', nullableDefinition: 'DATETIME NULL', finalDefinition: 'DATETIME NOT NULL', backfillExpression: 'COALESCE(`updated_at`, UTC_TIMESTAMP())' },
  { table: 'analytics_noc_minute_aggregates', column: 'event_type', nullableDefinition: 'VARCHAR(48) NULL', finalDefinition: 'VARCHAR(48) NOT NULL', backfillExpression: "'maintenance_warning'" },
  { table: 'analytics_noc_minute_aggregates', column: 'severity', nullableDefinition: 'VARCHAR(16) NULL', finalDefinition: 'VARCHAR(16) NOT NULL', backfillExpression: "'warning'" },
  { table: 'analytics_noc_minute_aggregates', column: 'component', nullableDefinition: 'VARCHAR(32) NULL', finalDefinition: 'VARCHAR(32) NOT NULL', backfillExpression: "'maintenance'" },
  { table: 'analytics_noc_minute_aggregates', column: 'status', nullableDefinition: 'VARCHAR(16) NULL', finalDefinition: 'VARCHAR(16) NOT NULL', backfillExpression: "'warning'" },
  { table: 'analytics_noc_minute_aggregates', column: 'error_code', nullableDefinition: 'VARCHAR(64) NULL', finalDefinition: "VARCHAR(64) NOT NULL DEFAULT 'none'", backfillExpression: "'unknown'" },
  { table: 'analytics_noc_minute_aggregates', column: 'event_count', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_noc_minute_aggregates', column: 'duration_count', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_noc_minute_aggregates', column: 'duration_total_ms', nullableDefinition: 'BIGINT UNSIGNED NULL', finalDefinition: 'BIGINT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'analytics_noc_minute_aggregates', column: 'duration_max_ms', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 0', backfillExpression: '0' },
]

export const realtimeAnalyticsOptionalColumns = [
  ['analytics_live_minute_buckets', 'id', 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST'],
  ['analytics_live_minute_buckets', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ['analytics_live_deduplication', 'id', 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST'],
  ['analytics_live_deduplication', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
  ['analytics_noc_minute_aggregates', 'id', 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST'],
  ['analytics_noc_minute_aggregates', 'details_json', 'VARCHAR(1024) NULL'],
  ['analytics_noc_minute_aggregates', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
] as const

export const realtimeAnalyticsIndexMigrations = [
  ['analytics_live_minute_buckets', 'analytics_live_bucket_scope_value_idx', 'UNIQUE INDEX `analytics_live_bucket_scope_value_idx` (`bucket_start`, `scope_type`, `scope_value_hash`)'],
  ['analytics_live_minute_buckets', 'analytics_live_bucket_scope_views_idx', 'INDEX `analytics_live_bucket_scope_views_idx` (`bucket_start`, `scope_type`, `page_views`)'],
  ['analytics_live_deduplication', 'analytics_live_dedup_bucket_scope_visitor_idx', 'UNIQUE INDEX `analytics_live_dedup_bucket_scope_visitor_idx` (`bucket_start`, `scope_type`, `scope_value_hash`, `visitor_token`)'],
  ['analytics_live_deduplication', 'analytics_live_dedup_bucket_idx', 'INDEX `analytics_live_dedup_bucket_idx` (`bucket_start`)'],
  ['analytics_noc_minute_aggregates', 'analytics_noc_bucket_identity_idx', 'UNIQUE INDEX `analytics_noc_bucket_identity_idx` (`bucket_start`, `event_type`, `severity`, `component`, `status`, `error_code`)'],
  ['analytics_noc_minute_aggregates', 'analytics_noc_bucket_severity_idx', 'INDEX `analytics_noc_bucket_severity_idx` (`bucket_start`, `severity`)'],
] as const

export const chatbotRequiredColumnMigrations: RequiredColumnMigration[] = [
  { table: 'chatbot_settings', column: 'enabled', nullableDefinition: 'TINYINT(1) NULL', finalDefinition: 'TINYINT(1) NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'chatbot_settings', column: 'provider_policy', nullableDefinition: 'VARCHAR(64) NULL', finalDefinition: "VARCHAR(64) NOT NULL DEFAULT 'openai-compatible'", backfillExpression: "'openai-compatible'" },
  { table: 'chatbot_settings', column: 'request_timeout_ms', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 10000', backfillExpression: '10000' },
  { table: 'chatbot_settings', column: 'max_response_bytes', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 262144', backfillExpression: '262144' },
  { table: 'chatbot_settings', column: 'max_input_chars', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 2000', backfillExpression: '2000' },
  { table: 'chatbot_settings', column: 'max_history_messages', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 8', backfillExpression: '8' },
  { table: 'chatbot_settings', column: 'retrieval_top_k', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 3', backfillExpression: '3' },
  { table: 'chatbot_settings', column: 'reference_char_budget', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 6000', backfillExpression: '6000' },
  { table: 'chatbot_settings', column: 'rate_limit_requests', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 10', backfillExpression: '10' },
  { table: 'chatbot_settings', column: 'rate_limit_window_seconds', nullableDefinition: 'INT UNSIGNED NULL', finalDefinition: 'INT UNSIGNED NOT NULL DEFAULT 60', backfillExpression: '60' },
  { table: 'chatbot_knowledge', column: 'canonical_question', nullableDefinition: 'VARCHAR(1000) NULL', finalDefinition: 'VARCHAR(1000) NOT NULL', backfillExpression: "CONCAT('Legacy question ', `id`)" },
  { table: 'chatbot_knowledge', column: 'normalized_question', nullableDefinition: 'VARCHAR(191) NULL', finalDefinition: 'VARCHAR(191) NOT NULL', backfillExpression: "LOWER(CONCAT('legacy question ', `id`))" },
  { table: 'chatbot_knowledge', column: 'approved_answer', nullableDefinition: 'LONGTEXT NULL', finalDefinition: 'LONGTEXT NOT NULL', backfillExpression: "''" },
  { table: 'chatbot_knowledge', column: 'topic', nullableDefinition: 'VARCHAR(128) NULL', finalDefinition: "VARCHAR(128) NOT NULL DEFAULT 'general'", backfillExpression: "'general'" },
  { table: 'chatbot_knowledge', column: 'status', nullableDefinition: 'ENUM(\'draft\',\'published\',\'archived\') NULL', finalDefinition: "ENUM('draft','published','archived') NOT NULL DEFAULT 'draft'", backfillExpression: "'draft'" },
  { table: 'chatbot_knowledge', column: 'priority', nullableDefinition: 'INT NULL', finalDefinition: 'INT NOT NULL DEFAULT 0', backfillExpression: '0' },
  { table: 'chatbot_knowledge', column: 'is_quick_question', nullableDefinition: 'TINYINT(1) NULL', finalDefinition: 'TINYINT(1) NOT NULL DEFAULT 0', backfillExpression: '0' },
]

export const chatbotOptionalColumns = [
  ['chatbot_settings', 'base_url', 'VARCHAR(1024) NULL'],
  ['chatbot_settings', 'model', 'VARCHAR(128) NULL'],
  ['chatbot_settings', 'system_prompt', 'TEXT NULL'],
  ['chatbot_settings', 'allowed_hosts', 'JSON NULL'],
  ['chatbot_settings', 'api_key_ciphertext', 'TEXT NULL'],
  ['chatbot_settings', 'api_key_nonce', 'VARCHAR(64) NULL'],
  ['chatbot_settings', 'api_key_auth_tag', 'VARCHAR(64) NULL'],
  ['chatbot_settings', 'api_key_version', 'INT UNSIGNED NULL'],
  ['chatbot_settings', 'api_key_key_id', 'VARCHAR(64) NULL'],
  ['chatbot_settings', 'api_key_last_four', 'VARCHAR(4) NULL'],
  ['chatbot_settings', 'updated_by', 'INT NULL'],
  ['chatbot_settings', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
  ['chatbot_settings', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ['chatbot_knowledge', 'source_label', 'VARCHAR(255) NULL'],
  ['chatbot_knowledge', 'source_url', 'VARCHAR(1024) NULL'],
  ['chatbot_knowledge', 'source_reference', 'VARCHAR(512) NULL'],
  ['chatbot_knowledge', 'internal_notes', 'TEXT NULL'],
  ['chatbot_knowledge', 'author_id', 'INT NULL'],
  ['chatbot_knowledge', 'reviewer_id', 'INT NULL'],
  ['chatbot_knowledge', 'reviewed_at', 'DATETIME NULL'],
  ['chatbot_knowledge', 'published_at', 'DATETIME NULL'],
  ['chatbot_knowledge', 'archived_at', 'DATETIME NULL'],
  ['chatbot_knowledge', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
  ['chatbot_knowledge', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
] as const

export const chatbotIndexMigrations = [
  ['chatbot_knowledge', 'chatbot_knowledge_status_priority_id_idx', 'INDEX `chatbot_knowledge_status_priority_id_idx` (`status`, `priority`, `id`)'],
  ['chatbot_knowledge', 'chatbot_knowledge_topic_status_priority_id_idx', 'INDEX `chatbot_knowledge_topic_status_priority_id_idx` (`topic`, `status`, `priority`, `id`)'],
  ['chatbot_knowledge', 'chatbot_knowledge_normalized_question_idx', 'INDEX `chatbot_knowledge_normalized_question_idx` (`normalized_question`)'],
  ['chatbot_knowledge', 'chatbot_knowledge_updated_id_idx', 'INDEX `chatbot_knowledge_updated_id_idx` (`updated_at`, `id`)'],
  ['chatbot_knowledge_terms', 'chatbot_terms_knowledge_kind_normalized_idx', 'UNIQUE INDEX `chatbot_terms_knowledge_kind_normalized_idx` (`knowledge_id`, `kind`, `normalized_value`)'],
  ['chatbot_knowledge_terms', 'chatbot_terms_kind_normalized_knowledge_idx', 'INDEX `chatbot_terms_kind_normalized_knowledge_idx` (`kind`, `normalized_value`, `knowledge_id`)'],
] as const

export async function ensureRequiredColumn(db: Connection, database: string, migration: RequiredColumnMigration) {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [database, migration.table, migration.column],
  )
  if (rows.length === 0) {
    await db.query(`ALTER TABLE \`${migration.table}\` ADD COLUMN \`${migration.column}\` ${migration.nullableDefinition}`)
  }
  await db.query(`UPDATE \`${migration.table}\` SET \`${migration.column}\` = ${migration.backfillExpression} WHERE \`${migration.column}\` IS NULL`)
  if (rows.length === 0 || rows[0]?.IS_NULLABLE === 'YES') {
    await db.query(`ALTER TABLE \`${migration.table}\` MODIFY COLUMN \`${migration.column}\` ${migration.finalDefinition}`)
  }
}

type ColumnMetadata = RowDataPacket & {
  COLUMN_TYPE: string
  IS_NULLABLE: 'YES' | 'NO'
  COLUMN_DEFAULT: string | number | null
  EXTRA: string
}

function normalizeSqlValue(value: unknown) {
  if (value === null || value === undefined) return null
  return String(value).trim().toLowerCase().replace(/\(\)$/, '')
}

function chatbotColumnMatches(row: ColumnMetadata, migration: ChatbotColumnMigration) {
  const columnType = row.COLUMN_TYPE.toLowerCase().replace(/\s+/g, ' ')
  return migration.columnTypes.includes(columnType)
    && (row.IS_NULLABLE === 'YES') === migration.nullable
    && normalizeSqlValue(row.COLUMN_DEFAULT) === normalizeSqlValue(migration.defaultValue)
    && row.EXTRA.toLowerCase().includes(migration.extra || '')
}

async function chatbotColumnMetadata(db: Connection, database: string, table: string, column: string) {
  const [rows] = await db.execute<ColumnMetadata[]>(
    `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [database, table, column],
  )
  return rows[0]
}

async function ensureChatbotColumn(db: Connection, database: string, migration: ChatbotColumnMigration) {
  let metadata = await chatbotColumnMetadata(db, database, migration.table, migration.column)
  if (!metadata) {
    await db.query(`ALTER TABLE \`${migration.table}\` ADD COLUMN \`${migration.column}\` ${migration.nullableDefinition}`)
    metadata = await chatbotColumnMetadata(db, database, migration.table, migration.column)
  }
  if (migration.backfillExpression) {
    await db.query(`UPDATE \`${migration.table}\` SET \`${migration.column}\` = ${migration.backfillExpression} WHERE \`${migration.column}\` IS NULL`)
  }
  if (!metadata || !chatbotColumnMatches(metadata, migration)) {
    await db.query(`ALTER TABLE \`${migration.table}\` MODIFY COLUMN \`${migration.column}\` ${migration.finalDefinition}`)
  }
}

async function ensureChatbotIndex(db: Connection, database: string, migration: typeof chatbotConvergentIndexMigrations[number]) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX`,
    [database, migration.table, migration.name],
  )
  const matches = rows.length === migration.columns.length
    && rows.every((row, index) => row.COLUMN_NAME === migration.columns[index])
    && rows.every(row => Number(row.NON_UNIQUE) === (migration.unique ? 0 : 1))
  if (matches) return
  if (rows.length > 0) {
    const dropDefinition = migration.name === 'PRIMARY' ? 'DROP PRIMARY KEY' : `DROP INDEX \`${migration.name}\``
    await db.query(`ALTER TABLE \`${migration.table}\` ${dropDefinition}, ADD ${migration.definition}`)
    return
  }
  await db.query(`ALTER TABLE \`${migration.table}\` ADD ${migration.definition}`)
}

async function ensureChatbotForeignKey(db: Connection, database: string, migration: typeof chatbotForeignKeyMigrations[number]) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.CONSTRAINT_SCHEMA = ? AND k.TABLE_NAME = ? AND k.COLUMN_NAME = ?
     ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [database, migration.table, migration.columns[0]],
  )
  const namedRows = rows.filter(row => row.CONSTRAINT_NAME === migration.name)
  const matches = namedRows.length === migration.columns.length && namedRows.every((row, index) =>
    row.COLUMN_NAME === migration.columns[index]
    && row.REFERENCED_TABLE_NAME === migration.referencedTable
    && row.REFERENCED_COLUMN_NAME === migration.referencedColumns[index]
    && row.DELETE_RULE === migration.deleteRule,
  )
  if (matches) return
  for (const name of [...new Set(rows.map(row => String(row.CONSTRAINT_NAME)))]) {
    await db.query(`ALTER TABLE \`${migration.table}\` DROP FOREIGN KEY \`${name}\``)
  }
  await db.query(`ALTER TABLE \`${migration.table}\` ADD CONSTRAINT \`${migration.name}\` ${migration.definition}`)
}

async function releaseChatbotForeignKeysBlockingColumnChanges(db: Connection, database: string) {
  const changedColumns = new Set<string>()
  for (const migration of chatbotColumnMigrations) {
    const metadata = await chatbotColumnMetadata(db, database, migration.table, migration.column)
    if (metadata && !chatbotColumnMatches(metadata, migration)) changedColumns.add(`${migration.table}.${migration.column}`)
  }
  if (changedColumns.size === 0) return
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [database],
  )
  const constraints = new Map<string, { table: string, name: string }>()
  for (const row of rows) {
    if (changedColumns.has(`${row.TABLE_NAME}.${row.COLUMN_NAME}`) || changedColumns.has(`${row.REFERENCED_TABLE_NAME}.${row.REFERENCED_COLUMN_NAME}`)) {
      constraints.set(`${row.TABLE_NAME}.${row.CONSTRAINT_NAME}`, { table: row.TABLE_NAME, name: row.CONSTRAINT_NAME })
    }
  }
  for (const { table, name } of constraints.values()) await db.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``)
}

async function convergeChatbotSchema(db: Connection, database: string) {
  await releaseChatbotForeignKeysBlockingColumnChanges(db, database)
  for (const migration of chatbotColumnMigrations) await ensureChatbotColumn(db, database, migration)

  // Answer-mode & lead-capture columns — idempotent add for pre-existing databases.
  const modeColumnExisted = await hasColumn(db, database, 'chatbot_settings', 'mode')
  await ensureColumn(db, database, 'users', 'token_version', 'INT NOT NULL DEFAULT 0')
  await ensureColumn(db, database, 'chatbot_settings', 'mode', "VARCHAR(16) NOT NULL DEFAULT 'knowledge'")
  if (!modeColumnExisted) {
    // Upgrade path: a deployment that already had a working provider keeps using
    // it. Fresh installs have no provider configured, so they stay 'knowledge'.
    await db.query(`
      UPDATE \`chatbot_settings\`
      SET \`mode\` = 'ai'
      WHERE \`enabled\` = 1
        AND \`base_url\` IS NOT NULL AND \`base_url\` <> ''
        AND \`model\` IS NOT NULL AND \`model\` <> ''
    `)
  }
  await ensureColumn(db, database, 'chatbot_settings', 'out_of_scope_behavior', "VARCHAR(24) NOT NULL DEFAULT 'knowledge_only'")
  await ensureColumn(db, database, 'chatbot_settings', 'knowledge_greeting', 'VARCHAR(500) NULL')
  await ensureColumn(db, database, 'chatbot_settings', 'fallback_message', 'VARCHAR(1000) NULL')
  await ensureColumn(db, database, 'chatbot_settings', 'lead_capture_enabled', "TINYINT(1) NOT NULL DEFAULT 1")
  await ensureColumn(db, database, 'chatbot_settings', 'lead_capture_email', 'VARCHAR(255) NULL')
  // Default ON: an existing deployment gains greeting replies without an admin
  // visiting the settings page, which is the point of the feature.
  await ensureColumn(db, database, 'chatbot_settings', 'small_talk_enabled', 'TINYINT(1) NOT NULL DEFAULT 1')

  await db.query('UPDATE `chatbot_settings` s LEFT JOIN `users` u ON u.`id` = s.`updated_by` SET s.`updated_by` = NULL WHERE s.`updated_by` IS NOT NULL AND u.`id` IS NULL')
  await db.query('UPDATE `chatbot_knowledge` k LEFT JOIN `users` u ON u.`id` = k.`author_id` SET k.`author_id` = NULL WHERE k.`author_id` IS NOT NULL AND u.`id` IS NULL')
  await db.query('UPDATE `chatbot_knowledge` k LEFT JOIN `users` u ON u.`id` = k.`reviewer_id` SET k.`reviewer_id` = NULL WHERE k.`reviewer_id` IS NOT NULL AND u.`id` IS NULL')
  await db.query(`
    INSERT IGNORE INTO \`chatbot_knowledge\`
      (\`id\`, \`canonical_question\`, \`normalized_question\`, \`approved_answer\`, \`topic\`, \`status\`, \`priority\`, \`is_quick_question\`)
    SELECT DISTINCT t.\`knowledge_id\`, CONCAT('Legacy question ', t.\`knowledge_id\`),
      LOWER(CONCAT('legacy question ', t.\`knowledge_id\`)), '', 'general', 'draft', 0, 0
    FROM \`chatbot_knowledge_terms\` t
    LEFT JOIN \`chatbot_knowledge\` k ON k.\`id\` = t.\`knowledge_id\`
    WHERE k.\`id\` IS NULL
  `)

  for (const migration of chatbotConvergentIndexMigrations) await ensureChatbotIndex(db, database, migration)
  for (const migration of chatbotForeignKeyMigrations) await ensureChatbotForeignKey(db, database, migration)
}

async function hasColumn(db: Connection, database: string, table: string, column: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [database, table, column],
  )
  return rows.length > 0
}

async function ensureColumn(db: Connection, database: string, table: string, column: string, definition: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [database, table, column],
  )
  if (rows.length === 0) await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
}

async function ensureIndex(db: Connection, database: string, table: string, indexName: string, definition: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [database, table, indexName],
  )
  if (rows.length === 0) {
    await db.query(`ALTER TABLE \`${table}\` ADD ${definition}`)
  }
}

/**
 * Adds a foreign key only when no constraint of that name exists yet.
 *
 * Distinct from ensureChatbotForeignKey above, which *reconciles* a constraint —
 * it drops every FK on the column and rebuilds it whenever the delete rule or the
 * referenced column has changed. That is right for the chatbot tables, whose FKs
 * were reshaped after they had shipped. It is wrong here: this constraint is new,
 * has never had another shape, and a drop-and-rebuild on a table holding live
 * transcripts is a real risk taken for no benefit.
 */
async function ensureForeignKeyIfMissing(db: Connection, database: string, table: string, name: string, definition: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = ? LIMIT 1',
    [database, table, name, 'FOREIGN KEY'],
  )
  if (rows.length === 0) {
    await db.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` ${definition}`)
  }
}

export async function initDb() {
  console.log('🔄 Checking & Creating MySQL tables...')

  const host     = process.env.DB_HOST     || '127.0.0.1'
  const port     = Number(process.env.DB_PORT || 3306)
  const user     = process.env.DB_USER     || 'root'
  const password = process.env.DB_PASSWORD || ''
  const database = process.env.DB_NAME     || 'cdkt_admin'

  // Step 1: Connect without database to ensure database exists
  const connection = await mysql.createConnection({ host, port, user, password })
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)
  await connection.end()

  // Step 2: Connect to target database and create tables
  const db = await mysql.createConnection({ host, port, user, password, database })

  // Roles table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`roles\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`name\` VARCHAR(64) NOT NULL UNIQUE,
      \`description\` VARCHAR(255),
      \`is_system\` TINYINT(1) DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Permissions table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`permissions\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`role_id\` INT NOT NULL,
      \`resource\` VARCHAR(64) NOT NULL,
      \`can_create\` TINYINT(1) DEFAULT 0,
      \`can_read\` TINYINT(1) DEFAULT 0,
      \`can_update\` TINYINT(1) DEFAULT 0,
      \`can_delete\` TINYINT(1) DEFAULT 0,
      \`can_publish\` TINYINT(1) DEFAULT 0,
      \`can_archive\` TINYINT(1) DEFAULT 0,
      \`can_test\` TINYINT(1) DEFAULT 0,
      UNIQUE KEY \`role_resource_idx\` (\`role_id\`, \`resource\`),
      CONSTRAINT \`fk_permissions_role\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Users table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`users\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`username\` VARCHAR(64) NOT NULL UNIQUE,
      \`email\` VARCHAR(128) UNIQUE,
      \`password_hash\` VARCHAR(255) NOT NULL,
      \`role_id\` INT,
      \`is_active\` TINYINT(1) DEFAULT 1,
      \`token_version\` INT NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`last_login_at\` TIMESTAMP NULL,
      CONSTRAINT \`fk_users_role\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Media table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`media\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`filename\` VARCHAR(255) NOT NULL,
      \`original_name\` VARCHAR(255) NOT NULL,
      \`mime_type\` VARCHAR(64) NOT NULL,
      \`size_bytes\` INT NOT NULL,
      \`provider\` VARCHAR(16) NOT NULL DEFAULT 'local',
      \`url\` VARCHAR(1024) NOT NULL,
      \`storage_path\` VARCHAR(1024) NOT NULL,
      \`width\` INT NULL,
      \`height\` INT NULL,
      \`uploaded_by\` INT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY \`mime_type_idx\` (\`mime_type\`),
      CONSTRAINT \`fk_media_user\` FOREIGN KEY (\`uploaded_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Content Types table (Thể Loại) — top-level taxonomy tier
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`content_types\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`name\` VARCHAR(255) NOT NULL,
      \`slug\` VARCHAR(64) NOT NULL UNIQUE,
      \`icon\` VARCHAR(64) NULL,
      \`description\` TEXT NULL,
      \`display_order\` INT NOT NULL DEFAULT 0,
      \`is_system\` TINYINT(1) NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Seed the 5 system content types idempotently (keyed on unique slug).
  // is_system=1 → editable name/icon/order but NOT deletable (fixed public pages depend on them).
  const systemTypes: Array<[string, string, string, number]> = [
    ['Bản tin & Tin tức', 'news', 'fa-solid fa-newspaper', 1],
    ['Tấm gương tiêu biểu', 'role_model', 'fa-solid fa-award', 2],
    ['Mô hình tái hòa nhập', 'reintegration', 'fa-solid fa-people-roof', 3],
    ['Văn bản pháp luật', 'document', 'fa-solid fa-file-lines', 4],
    ['Giải đáp pháp luật', 'faq', 'fa-solid fa-circle-question', 5],
  ]
  for (const [name, slug, icon, displayOrder] of systemTypes) {
    await db.query(
      `INSERT INTO \`content_types\` (\`name\`, \`slug\`, \`icon\`, \`display_order\`, \`is_system\`)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE \`slug\` = \`slug\``,
      [name, slug, icon, displayOrder],
    )
  }

  // Categories table (create before articles FK reference)
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`categories\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`name\` VARCHAR(255) NOT NULL,
      \`slug\` VARCHAR(255) NOT NULL UNIQUE,
      \`parent_id\` INT NULL,
      \`type\` VARCHAR(32) NOT NULL,
      \`description\` TEXT NULL,
      \`display_order\` INT NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT \`fk_categories_parent\` FOREIGN KEY (\`parent_id\`) REFERENCES \`categories\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Articles table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`articles\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`type\` VARCHAR(32) NOT NULL,
      \`title\` VARCHAR(512) NOT NULL,
      \`slug\` VARCHAR(512) NOT NULL UNIQUE,
      \`excerpt\` TEXT NULL,
      \`content\` LONGTEXT NULL,
      \`thumbnail_id\` INT NULL,
      \`thumbnail_url\` VARCHAR(1024) NULL,
      \`status\` VARCHAR(16) NOT NULL DEFAULT 'draft',
      \`author_id\` INT NULL,
      \`published_at\` TIMESTAMP NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY \`type_idx\` (\`type\`),
      KEY \`status_idx\` (\`status\`),
      CONSTRAINT \`fk_articles_thumbnail\` FOREIGN KEY (\`thumbnail_id\`) REFERENCES \`media\` (\`id\`) ON DELETE SET NULL,
      CONSTRAINT \`fk_articles_author\` FOREIGN KEY (\`author_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Add category columns (MySQL 8.0 doesn't support IF NOT EXISTS — use helper)
  await ensureColumn(db, database, 'articles', 'category', 'VARCHAR(128) NULL AFTER `type`')
  await ensureIndex(db, database, 'articles', 'category_idx', 'INDEX `category_idx` (`category`)')
  await ensureColumn(db, database, 'articles', 'category_id', 'INT NULL AFTER `category`')
  await ensureIndex(db, database, 'articles', 'category_id_idx', 'INDEX `category_id_idx` (`category_id`)')

  // Add FK constraint for category_id
  await db.query(`
    ALTER TABLE \`articles\`
    ADD CONSTRAINT \`fk_articles_category\` FOREIGN KEY (\`category_id\`) REFERENCES \`categories\` (\`id\`) ON DELETE SET NULL;
  `).catch(() => {/* ignore if already exists */})

  // Seed default categories idempotently (keyed on unique slug). News slugs match
  // the legacy hardcoded slugs. ON DUPLICATE KEY UPDATE keeps re-runs duplicate-free
  // and preserves any admin edits to name/order.
  const defaultCategories: Array<[string, string, string, number]> = [
    ['Tin nổi bật', 'tin-noi-bat', 'news', 1],
    ['Tin hoạt động', 'tin-hoat-dong', 'news', 2],
    ['Tin địa phương', 'tin-dia-phuong', 'news', 3],
    ['Tấm gương tiêu biểu', 'tam-guong-tieu-bieu', 'role_model', 1],
    ['Mô hình tái hòa nhập', 'mo-hinh-tai-hoa-nhap', 'reintegration', 1],
    ['Văn bản pháp luật', 'van-ban-phap-luat', 'document', 1],
    ['Hỏi đáp pháp luật', 'hoi-dap-phap-luat', 'faq', 1],
  ]
  for (const [name, slug, type, displayOrder] of defaultCategories) {
    await db.query(
      `INSERT INTO \`categories\` (\`name\`, \`slug\`, \`type\`, \`parent_id\`, \`display_order\`)
       VALUES (?, ?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE \`slug\` = \`slug\``,
      [name, slug, type, displayOrder],
    )
  }

  // Per-article view counter. Real and fabricated views are separated twice:
  // by column, and by a `source_category` value ('boost') that the public
  // allowlist does not contain — so SUM(real_views) stays honest even if one of
  // the two separations is broken by a future coding error.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`article_view_daily\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`day\` DATE NOT NULL,
      \`article_id\` INT NOT NULL,
      \`source_category\` VARCHAR(32) NOT NULL DEFAULT 'direct',
      \`real_views\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`fabricated_views\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`article_view_daily_day_article_source_idx\` (\`day\`, \`article_id\`, \`source_category\`),
      KEY \`article_view_daily_article_idx\` (\`article_id\`),
      CONSTRAINT \`fk_article_view_daily_article\` FOREIGN KEY (\`article_id\`) REFERENCES \`articles\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Gradual inflation jobs. Instant mode writes nothing here — it is complete on
  // authorisation and the activity log already records who did it.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`article_view_boost\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`article_id\` INT NOT NULL,
      \`total_amount\` INT UNSIGNED NOT NULL,
      \`applied_amount\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`duration_minutes\` INT UNSIGNED NOT NULL,
      \`started_at\` DATETIME NOT NULL,
      \`ends_at\` DATETIME NOT NULL,
      \`status\` VARCHAR(16) NOT NULL DEFAULT 'running',
      \`created_by\` INT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY \`article_view_boost_status_ends_idx\` (\`status\`, \`ends_at\`),
      KEY \`article_view_boost_article_idx\` (\`article_id\`),
      CONSTRAINT \`fk_article_view_boost_article\` FOREIGN KEY (\`article_id\`) REFERENCES \`articles\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_article_view_boost_user\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Home Sections table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`home_sections\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`type\` VARCHAR(32) NOT NULL UNIQUE,
      \`display_order\` INT NOT NULL DEFAULT 0,
      \`config\` JSON NULL,
      \`is_visible\` TINYINT(1) DEFAULT 1,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`updated_by\` INT NULL,
      CONSTRAINT \`fk_sections_user\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Page Contents table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`page_contents\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`slug\` VARCHAR(64) NOT NULL,
      \`section_key\` VARCHAR(64) NOT NULL,
      \`content\` JSON NOT NULL,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`updated_by\` INT NULL,
      UNIQUE KEY \`slug_section_idx\` (\`slug\`, \`section_key\`),
      CONSTRAINT \`fk_pages_user\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Pages table (generic page container for the block builder)
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`pages\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`slug\` VARCHAR(64) NOT NULL UNIQUE,
      \`title\` VARCHAR(255) NOT NULL,
      \`is_system\` TINYINT(1) DEFAULT 0,
      \`seo_title\` VARCHAR(255) NULL,
      \`seo_description\` TEXT NULL,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`updated_by\` INT NULL,
      CONSTRAINT \`fk_pages_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Page Blocks table (ordered content blocks belonging to a page)
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`page_blocks\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`page_id\` INT NOT NULL,
      \`block_type\` VARCHAR(48) NOT NULL,
      \`display_order\` INT NOT NULL DEFAULT 0,
      \`data\` JSON NULL,
      \`is_visible\` TINYINT(1) DEFAULT 1,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`updated_by\` INT NULL,
      KEY \`page_blocks_page_order_idx\` (\`page_id\`, \`display_order\`),
      CONSTRAINT \`fk_page_blocks_page\` FOREIGN KEY (\`page_id\`) REFERENCES \`pages\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_page_blocks_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Draft (unpublished working copy) columns on pages — additive, idempotent.
  await ensureColumn(db, database, 'pages', 'draft_blocks', 'JSON NULL')
  await ensureColumn(db, database, 'pages', 'draft_updated_at', 'TIMESTAMP NULL')
  await ensureColumn(db, database, 'pages', 'draft_updated_by', 'INT NULL')
  // Published node tree (nested-grid model) — additive; NULL falls back to page_blocks.
  await ensureColumn(db, database, 'pages', 'published_blocks', 'JSON NULL')

  // Page Versions table (restore/backup snapshots: origin | auto | manual)
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`page_versions\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`page_id\` INT NOT NULL,
      \`kind\` ENUM('origin','auto','manual') NOT NULL DEFAULT 'auto',
      \`label\` VARCHAR(128) NULL,
      \`blocks\` JSON NOT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`created_by\` INT NULL,
      KEY \`page_versions_page_kind_idx\` (\`page_id\`, \`kind\`, \`id\`),
      CONSTRAINT \`fk_page_versions_page\` FOREIGN KEY (\`page_id\`) REFERENCES \`pages\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_page_versions_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Settings table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`settings\` (
      \`key\` VARCHAR(128) PRIMARY KEY,
      \`value\` TEXT NULL,
      \`type\` VARCHAR(16) DEFAULT 'string',
      \`group\` VARCHAR(32) DEFAULT 'general'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Activity Logs table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`rate_limit_counters\` (
      \`bucket_key\` VARCHAR(191) NOT NULL PRIMARY KEY,
      \`hit_count\` INT NOT NULL DEFAULT 0,
      \`window_expires_at\` DATETIME(3) NOT NULL,
      KEY \`rate_limit_expiry_idx\` (\`window_expires_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Activity log
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`activity_logs\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`user_id\` INT NULL,
      \`action\` VARCHAR(32) NOT NULL,
      \`resource\` VARCHAR(64) NULL,
      \`resource_id\` INT NULL,
      \`meta\` JSON NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY \`user_idx\` (\`user_id\`),
      KEY \`activity_created_idx\` (\`created_at\`),
      CONSTRAINT \`fk_logs_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Data retention bookkeeping. `purged_total` survives the rows it counted, so
  // a purge that worked is still visible after the evidence is deleted.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`data_retention_state\` (
      \`scope\` VARCHAR(32) NOT NULL PRIMARY KEY,
      \`purged_total\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`last_run_at\` DATETIME NULL,
      \`last_deleted\` INT NOT NULL DEFAULT 0,
      \`last_trigger\` VARCHAR(16) NULL,
      \`last_status\` VARCHAR(16) NULL,
      \`last_message\` VARCHAR(512) NULL,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Multi-factor authentication — one row per (user, factor type). A factor is
  // enabled by the existence of an 'active' row, so disabling deletes the row
  // and its material rather than flagging it.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`user_mfa_factors\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`user_id\` INT NOT NULL,
      \`factor_type\` ENUM('totp','email_otp','second_password') NOT NULL,
      \`state\` ENUM('pending','active') NOT NULL DEFAULT 'pending',
      \`secret_ciphertext\` TEXT NULL,
      \`secret_nonce\` VARCHAR(64) NULL,
      \`secret_auth_tag\` VARCHAR(64) NULL,
      \`secret_version\` INT NULL,
      \`secret_key_id\` VARCHAR(32) NULL,
      \`password_hash\` VARCHAR(255) NULL,
      \`pending_code_hash\` VARCHAR(255) NULL,
      \`pending_code_expires_at\` DATETIME(3) NULL,
      \`pending_code_attempts\` INT NOT NULL DEFAULT 0,
      \`pending_expires_at\` DATETIME(3) NULL,
      \`last_accepted_step\` BIGINT NULL,
      \`last_used_at\` TIMESTAMP NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`user_factor_idx\` (\`user_id\`, \`factor_type\`),
      CONSTRAINT \`fk_mfa_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Recovery codes — one row per code so single-use consumption is a per-code
  // fact. A regeneration writes a new batch_id, retiring the previous set.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`user_recovery_codes\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`user_id\` INT NOT NULL,
      \`code_hash\` VARCHAR(255) NOT NULL,
      \`batch_id\` VARCHAR(32) NOT NULL,
      \`used_at\` TIMESTAMP NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY \`recovery_user_batch_idx\` (\`user_id\`, \`batch_id\`),
      CONSTRAINT \`fk_recovery_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Submissions table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`submissions\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`full_name\` VARCHAR(255) NOT NULL,
      \`phone\` VARCHAR(30) NOT NULL,
      \`email\` VARCHAR(255) NULL,
      \`address\` TEXT NULL,
      \`message\` TEXT NULL,
      \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY \`submissions_created_idx\` (\`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Contact-form builder additive columns — free-form answers + originating form title.
  await ensureColumn(db, database, 'submissions', 'answers', 'JSON NULL')
  await ensureColumn(db, database, 'submissions', 'form_title', 'VARCHAR(255) NULL')

  // Retention purges filter on created_at. Deployments created before the
  // retention policy existed have the tables but not these indexes.
  await ensureIndex(db, database, 'activity_logs', 'activity_created_idx', 'INDEX `activity_created_idx` (`created_at`)')
  await ensureIndex(db, database, 'submissions', 'submissions_created_idx', 'INDEX `submissions_created_idx` (`created_at`)')

  // Governed chatbot settings and knowledge bank
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`chatbot_settings\` (
      \`id\` INT PRIMARY KEY DEFAULT 1,
      \`enabled\` TINYINT(1) NOT NULL DEFAULT 0,
      \`provider_policy\` VARCHAR(64) NOT NULL DEFAULT 'openai-compatible',
      \`base_url\` VARCHAR(1024) NULL,
      \`model\` VARCHAR(128) NULL,
      \`system_prompt\` TEXT NULL,
      \`allowed_hosts\` JSON NULL,
      \`mode\` VARCHAR(16) NOT NULL DEFAULT 'knowledge',
      \`out_of_scope_behavior\` VARCHAR(24) NOT NULL DEFAULT 'knowledge_only',
      \`knowledge_greeting\` VARCHAR(500) NULL,
      \`fallback_message\` VARCHAR(1000) NULL,
      \`lead_capture_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
      \`lead_capture_email\` VARCHAR(255) NULL,
      \`small_talk_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
      \`request_timeout_ms\` INT UNSIGNED NOT NULL DEFAULT 10000,
      \`max_response_bytes\` INT UNSIGNED NOT NULL DEFAULT 262144,
      \`max_input_chars\` INT UNSIGNED NOT NULL DEFAULT 2000,
      \`max_history_messages\` INT UNSIGNED NOT NULL DEFAULT 8,
      \`retrieval_top_k\` INT UNSIGNED NOT NULL DEFAULT 3,
      \`reference_char_budget\` INT UNSIGNED NOT NULL DEFAULT 6000,
      \`rate_limit_requests\` INT UNSIGNED NOT NULL DEFAULT 10,
      \`rate_limit_window_seconds\` INT UNSIGNED NOT NULL DEFAULT 60,
      \`api_key_ciphertext\` TEXT NULL,
      \`api_key_nonce\` VARCHAR(64) NULL,
      \`api_key_auth_tag\` VARCHAR(64) NULL,
      \`api_key_version\` INT UNSIGNED NULL,
      \`api_key_key_id\` VARCHAR(64) NULL,
      \`api_key_last_four\` VARCHAR(4) NULL,
      \`updated_by\` INT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`fk_chatbot_settings_user\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`chatbot_knowledge\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`canonical_question\` VARCHAR(1000) NOT NULL,
      \`normalized_question\` VARCHAR(191) NOT NULL,
      \`approved_answer\` LONGTEXT NOT NULL,
      \`topic\` VARCHAR(128) NOT NULL,
      \`source_label\` VARCHAR(255) NULL,
      \`source_url\` VARCHAR(1024) NULL,
      \`source_reference\` VARCHAR(512) NULL,
      \`internal_notes\` TEXT NULL,
      \`status\` ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
      \`priority\` INT NOT NULL DEFAULT 0,
      \`is_quick_question\` TINYINT(1) NOT NULL DEFAULT 0,
      \`author_id\` INT NULL,
      \`reviewer_id\` INT NULL,
      \`reviewed_at\` DATETIME NULL,
      \`published_at\` DATETIME NULL,
      \`archived_at\` DATETIME NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY \`chatbot_knowledge_status_priority_id_idx\` (\`status\`, \`priority\`, \`id\`),
      KEY \`chatbot_knowledge_topic_status_priority_id_idx\` (\`topic\`, \`status\`, \`priority\`, \`id\`),
      KEY \`chatbot_knowledge_normalized_question_idx\` (\`normalized_question\`),
      KEY \`chatbot_knowledge_updated_id_idx\` (\`updated_at\`, \`id\`),
      CONSTRAINT \`fk_chatbot_knowledge_author\` FOREIGN KEY (\`author_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
      CONSTRAINT \`fk_chatbot_knowledge_reviewer\` FOREIGN KEY (\`reviewer_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`chatbot_knowledge_terms\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`knowledge_id\` BIGINT UNSIGNED NOT NULL,
      \`kind\` ENUM('alias','keyword') NOT NULL,
      \`value\` VARCHAR(1000) NOT NULL,
      \`normalized_value\` VARCHAR(191) NOT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY \`chatbot_terms_knowledge_kind_normalized_idx\` (\`knowledge_id\`, \`kind\`, \`normalized_value\`),
      KEY \`chatbot_terms_kind_normalized_knowledge_idx\` (\`kind\`, \`normalized_value\`, \`knowledge_id\`),
      CONSTRAINT \`fk_chatbot_terms_knowledge\` FOREIGN KEY (\`knowledge_id\`) REFERENCES \`chatbot_knowledge\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`chatbot_small_talk\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`category\` VARCHAR(32) NOT NULL,
      \`question\` VARCHAR(500) NOT NULL,
      \`normalized_question\` VARCHAR(191) NOT NULL,
      \`answer\` TEXT NOT NULL,
      \`patterns\` JSON NULL,
      \`is_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
      \`is_system\` TINYINT(1) NOT NULL DEFAULT 0,
      \`display_order\` INT NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`chatbot_small_talk_normalized_question_idx\` (\`normalized_question\`),
      KEY \`chatbot_small_talk_enabled_category_id_idx\` (\`is_enabled\`, \`category\`, \`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Visitor chat sessions and transcripts. The session id is a client-generated
  // UUID admitted only after its HMAC verifies, so a forged header cannot inject
  // rows under someone else's id.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`chat_sessions\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`ip\` VARCHAR(45) NULL,
      \`user_agent\` VARCHAR(512) NULL,
      \`detected_phone\` VARCHAR(20) NULL,
      \`detected_name\` VARCHAR(128) NULL,
      \`message_count\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`started_at\` DATETIME NOT NULL,
      \`last_message_at\` DATETIME NOT NULL,
      KEY \`chat_sessions_last_message_idx\` (\`last_message_at\`),
      KEY \`chat_sessions_started_idx\` (\`started_at\`),
      KEY \`chat_sessions_detected_phone_idx\` (\`detected_phone\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`chat_messages\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`session_id\` VARCHAR(36) NOT NULL,
      \`role\` ENUM('user','assistant') NOT NULL,
      \`content\` TEXT NOT NULL,
      \`kind\` VARCHAR(32) NULL,
      \`created_at\` DATETIME NOT NULL,
      KEY \`chat_messages_session_created_idx\` (\`session_id\`, \`created_at\`),
      CONSTRAINT \`fk_chat_messages_session\` FOREIGN KEY (\`session_id\`) REFERENCES \`chat_sessions\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Detected-name arrived after the first deployments of the two tables above.
  await ensureColumn(db, database, 'chat_sessions', 'detected_name', 'VARCHAR(128) NULL')

  // Privacy-preserving analytics raw events and durable daily aggregates
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`analytics_live_minute_buckets\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`bucket_start\` DATETIME NOT NULL,
      \`scope_type\` ENUM('total','path','source_category','device_class','country_code','region_code') NOT NULL,
      \`scope_value\` VARCHAR(512) NOT NULL,
      \`scope_value_hash\` VARCHAR(64) NOT NULL,
      \`page_views\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`approximate_unique_visitors\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`analytics_live_bucket_scope_value_idx\` (\`bucket_start\`, \`scope_type\`, \`scope_value_hash\`),
      KEY \`analytics_live_bucket_scope_views_idx\` (\`bucket_start\`, \`scope_type\`, \`page_views\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`analytics_live_deduplication\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`bucket_start\` DATETIME NOT NULL,
      \`scope_type\` ENUM('total','path','source_category','device_class','country_code','region_code') NOT NULL,
      \`scope_value_hash\` VARCHAR(64) NOT NULL,
      \`visitor_token\` VARCHAR(64) NOT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY \`analytics_live_dedup_bucket_scope_visitor_idx\` (\`bucket_start\`, \`scope_type\`, \`scope_value_hash\`, \`visitor_token\`),
      KEY \`analytics_live_dedup_bucket_idx\` (\`bucket_start\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`analytics_noc_minute_aggregates\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`bucket_start\` DATETIME NOT NULL,
      \`event_type\` VARCHAR(48) NOT NULL,
      \`severity\` VARCHAR(16) NOT NULL,
      \`component\` VARCHAR(32) NOT NULL,
      \`status\` VARCHAR(16) NOT NULL,
      \`error_code\` VARCHAR(64) NOT NULL DEFAULT 'none',
      \`event_count\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`duration_count\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`duration_total_ms\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`duration_max_ms\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`details_json\` VARCHAR(1024) NULL,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`analytics_noc_bucket_identity_idx\` (\`bucket_start\`, \`event_type\`, \`severity\`, \`component\`, \`status\`, \`error_code\`),
      KEY \`analytics_noc_bucket_severity_idx\` (\`bucket_start\`, \`severity\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`analytics_page_view_events\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`occurred_at\` DATETIME NOT NULL,
      \`event_day\` DATE NOT NULL,
      \`path\` VARCHAR(512) NOT NULL,
      \`visitor_token\` VARCHAR(64) NOT NULL,
      \`source_category\` VARCHAR(32) NOT NULL DEFAULT 'direct',
      \`device_class\` VARCHAR(16) NOT NULL DEFAULT 'unknown',
      \`country_code\` VARCHAR(2) NULL,
      \`region_code\` VARCHAR(16) NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY \`analytics_events_day_path_idx\` (\`event_day\`, \`path\`),
      KEY \`analytics_events_day_visitor_idx\` (\`event_day\`, \`visitor_token\`),
      KEY \`analytics_events_occurred_at_idx\` (\`occurred_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`analytics_daily_traffic\` (
      \`day\` DATE PRIMARY KEY,
      \`page_views\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`daily_unique_visitors\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`analytics_daily_pages\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`day\` DATE NOT NULL,
      \`path\` VARCHAR(512) NOT NULL,
      \`page_views\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`daily_unique_visitors\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`analytics_daily_pages_day_path_idx\` (\`day\`, \`path\`),
      KEY \`analytics_daily_pages_day_views_idx\` (\`day\`, \`page_views\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`analytics_daily_dimensions\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`day\` DATE NOT NULL,
      \`dimension\` VARCHAR(32) NOT NULL,
      \`value\` VARCHAR(128) NOT NULL,
      \`page_views\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`daily_unique_visitors\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`analytics_dimensions_day_dimension_value_idx\` (\`day\`, \`dimension\`, \`value\`),
      KEY \`analytics_dimensions_day_dimension_views_idx\` (\`day\`, \`dimension\`, \`page_views\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`analytics_daily_admin_users\` (
      \`day\` DATE PRIMARY KEY,
      \`total_users\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`active_users\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`analytics_maintenance_runs\` (
      \`day\` DATE PRIMARY KEY,
      \`status\` VARCHAR(16) NOT NULL,
      \`started_at\` DATETIME NOT NULL,
      \`completed_at\` DATETIME NULL,
      \`event_count\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`error_summary\` VARCHAR(512) NULL,
      \`worker_token\` VARCHAR(64) NULL,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY \`analytics_maintenance_status_day_idx\` (\`status\`, \`day\`),
      KEY \`analytics_maintenance_completed_at_idx\` (\`completed_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // ── Reader accounts (Google sign-in) & public comments ──────────────────
  // reader-google-login-comments design.md D1/D7/D16: keyed on google_sub (not
  // email), no avatar column, last_seen_at drives both the "recently active"
  // index and the retention scope.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`reader_accounts\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`google_sub\` VARCHAR(255) NOT NULL UNIQUE,
      \`email\` VARCHAR(255) NULL,
      \`display_name\` VARCHAR(255) NULL,
      \`custom_display_name\` VARCHAR(255) NULL,
      \`is_banned\` TINYINT(1) NOT NULL DEFAULT 0,
      \`ban_reason\` TEXT NULL,
      \`banned_at\` DATETIME NULL,
      \`banned_by\` INT NULL,
      \`token_version\` INT NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`last_seen_at\` DATETIME NOT NULL,
      \`last_ip\` VARCHAR(45) NULL,
      \`last_user_agent\` VARCHAR(512) NULL,
      KEY \`reader_accounts_last_seen_at_idx\` (\`last_seen_at\`),
      KEY \`reader_accounts_is_banned_idx\` (\`is_banned\`),
      CONSTRAINT \`fk_reader_accounts_banned_by\` FOREIGN KEY (\`banned_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // design.md D8: every FK cascades except admin_user_id (SET NULL) — deleting
  // a staff account must not remove the portal's public replies.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`article_comments\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`article_id\` INT NOT NULL,
      \`reader_id\` INT NULL,
      \`admin_user_id\` INT NULL,
      \`parent_id\` BIGINT UNSIGNED NULL,
      \`body\` TEXT NOT NULL,
      \`ip\` VARCHAR(45) NULL,
      \`user_agent\` VARCHAR(512) NULL,
      \`created_at\` DATETIME NOT NULL,
      KEY \`article_comments_article_parent_created_idx\` (\`article_id\`, \`parent_id\`, \`created_at\`),
      KEY \`article_comments_reader_id_idx\` (\`reader_id\`),
      CONSTRAINT \`fk_article_comments_article\` FOREIGN KEY (\`article_id\`) REFERENCES \`articles\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_article_comments_reader\` FOREIGN KEY (\`reader_id\`) REFERENCES \`reader_accounts\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_article_comments_admin_user\` FOREIGN KEY (\`admin_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
      CONSTRAINT \`fk_article_comments_parent\` FOREIGN KEY (\`parent_id\`) REFERENCES \`article_comments\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // design.md D11: value is validated (single IPv4/IPv6 address or IPv4 CIDR)
  // by server/utils/ip-ban.ts before a row is ever written.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`reader_ip_bans\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`value\` VARCHAR(64) NOT NULL UNIQUE,
      \`reason\` TEXT NULL,
      \`created_by\` INT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT \`fk_reader_ip_bans_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // design.md D3: envelope columns mirror chatbot_settings.api_key* exactly,
  // bound to a distinct context label (cdkt-google-oauth-secret:v1) so a
  // copy-pasted ciphertext from one table fails authentication as the other.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`google_oauth_settings\` (
      \`id\` INT PRIMARY KEY DEFAULT 1,
      \`client_id\` VARCHAR(255) NULL,
      \`client_secret_ciphertext\` TEXT NULL,
      \`client_secret_nonce\` VARCHAR(64) NULL,
      \`client_secret_auth_tag\` VARCHAR(64) NULL,
      \`client_secret_version\` INT UNSIGNED NULL,
      \`client_secret_key_id\` VARCHAR(64) NULL,
      \`client_secret_last_four\` VARCHAR(4) NULL,
      \`is_enabled\` TINYINT(1) NOT NULL DEFAULT 0,
      \`default_comments_enabled\` TINYINT(1) NOT NULL DEFAULT 0,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`updated_by\` INT NULL,
      CONSTRAINT \`fk_google_oauth_settings_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // design.md D9: existing articles start with comments closed (default 0).
  await ensureColumn(db, database, 'articles', 'comments_enabled', 'TINYINT(1) NOT NULL DEFAULT 0')

  // ── Reader profile page ───────────────────────────────────────────────────
  // The reader's own chosen name. Deliberately a separate column from
  // `display_name`, which the OAuth callback keeps refreshing from Google on
  // every sign-in: writing the chosen name into that column would have the next
  // sign-in quietly erase it. Read only through effectiveDisplayName().
  await ensureColumn(db, database, 'reader_accounts', 'custom_display_name', 'VARCHAR(255) NULL AFTER `display_name`')

  // Which reader a conversation belongs to, once they claim it.
  //
  // Added here rather than in the CREATE TABLE above because `chat_sessions` is
  // created long before `reader_accounts` exists — the FK has nothing to point at
  // at that point in this function. SET NULL, not CASCADE: chat_sessions is its
  // own retention scope (90 days) while reader_accounts keeps 365, and cascading
  // would make deleting a reader destroy transcripts the confirmation dialog does
  // not count.
  await ensureColumn(db, database, 'chat_sessions', 'reader_id', 'INT NULL')
  await ensureIndex(db, database, 'chat_sessions', 'chat_sessions_reader_id_idx', 'INDEX `chat_sessions_reader_id_idx` (`reader_id`)')
  await ensureForeignKeyIfMissing(
    db, database, 'chat_sessions', 'fk_chat_sessions_reader',
    'FOREIGN KEY (`reader_id`) REFERENCES `reader_accounts` (`id`) ON DELETE SET NULL',
  )

  // Existing installations converge without table recreation or row loss.
  await ensureColumn(db, database, 'permissions', 'can_publish', 'TINYINT(1) DEFAULT 0')
  await ensureColumn(db, database, 'permissions', 'can_archive', 'TINYINT(1) DEFAULT 0')
  await ensureColumn(db, database, 'permissions', 'can_test', 'TINYINT(1) DEFAULT 0')
  await convergeChatbotSchema(db, database)

  // Required columns use nullable add → deterministic backfill → NOT NULL enforcement.
  // Timestamp helpers are installed first where a required-column backfill derives UTC time from them.
  for (const [table, column, definition] of realtimeAnalyticsOptionalColumns.filter(([, column]) => column === 'id' || column === 'updated_at' || column === 'created_at')) {
    await ensureColumn(db, database, table, column, definition)
  }
  for (const migration of realtimeAnalyticsRequiredColumnMigrations) {
    await ensureRequiredColumn(db, database, migration)
  }
  for (const [table, column, definition] of realtimeAnalyticsOptionalColumns.filter(([, column]) => column !== 'id' && column !== 'updated_at' && column !== 'created_at')) {
    await ensureColumn(db, database, table, column, definition)
  }
  for (const [table, indexName, definition] of realtimeAnalyticsIndexMigrations) {
    await ensureIndex(db, database, table, indexName, definition)
  }

  await ensureColumn(db, database, 'analytics_page_view_events', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
  await ensureColumn(db, database, 'analytics_daily_traffic', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
  await ensureColumn(db, database, 'analytics_daily_pages', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
  await ensureColumn(db, database, 'analytics_daily_dimensions', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
  await ensureColumn(db, database, 'analytics_daily_admin_users', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
  await ensureColumn(db, database, 'analytics_maintenance_runs', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
  for (const migration of requiredAnalyticsColumnMigrations) {
    await ensureRequiredColumn(db, database, migration)
  }

  await ensureColumn(db, database, 'analytics_page_view_events', 'country_code', 'VARCHAR(2) NULL')
  await ensureColumn(db, database, 'analytics_page_view_events', 'region_code', 'VARCHAR(16) NULL')
  await ensureColumn(db, database, 'analytics_maintenance_runs', 'completed_at', 'DATETIME NULL')
  await ensureColumn(db, database, 'analytics_maintenance_runs', 'error_summary', 'VARCHAR(512) NULL')
  await ensureColumn(db, database, 'analytics_maintenance_runs', 'worker_token', 'VARCHAR(64) NULL')

  await ensureIndex(db, database, 'analytics_page_view_events', 'analytics_events_day_path_idx', 'INDEX `analytics_events_day_path_idx` (`event_day`, `path`)')
  await ensureIndex(db, database, 'analytics_page_view_events', 'analytics_events_day_visitor_idx', 'INDEX `analytics_events_day_visitor_idx` (`event_day`, `visitor_token`)')
  await ensureIndex(db, database, 'analytics_page_view_events', 'analytics_events_occurred_at_idx', 'INDEX `analytics_events_occurred_at_idx` (`occurred_at`)')
  await ensureIndex(db, database, 'analytics_daily_pages', 'analytics_daily_pages_day_path_idx', 'UNIQUE INDEX `analytics_daily_pages_day_path_idx` (`day`, `path`)')
  await ensureIndex(db, database, 'analytics_daily_pages', 'analytics_daily_pages_day_views_idx', 'INDEX `analytics_daily_pages_day_views_idx` (`day`, `page_views`)')
  await ensureIndex(db, database, 'analytics_daily_dimensions', 'analytics_dimensions_day_dimension_value_idx', 'UNIQUE INDEX `analytics_dimensions_day_dimension_value_idx` (`day`, `dimension`, `value`)')
  await ensureIndex(db, database, 'analytics_daily_dimensions', 'analytics_dimensions_day_dimension_views_idx', 'INDEX `analytics_dimensions_day_dimension_views_idx` (`day`, `dimension`, `page_views`)')
  await ensureIndex(db, database, 'analytics_maintenance_runs', 'analytics_maintenance_status_day_idx', 'INDEX `analytics_maintenance_status_day_idx` (`status`, `day`)')
  await ensureIndex(db, database, 'analytics_maintenance_runs', 'analytics_maintenance_completed_at_idx', 'INDEX `analytics_maintenance_completed_at_idx` (`completed_at`)')

  await db.end()
  console.log('✅ All MySQL tables exist and ready!')
}

if (process.argv[1] && process.argv[1].endsWith('/server/db/init.ts')) {
  initDb().catch(err => {
    console.error('❌ Init DB failed:', err)
    process.exit(1)
  })
}
