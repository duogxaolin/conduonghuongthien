import type { Connection } from 'mysql2/promise'

/**
 * AI Panel + i18n + social links.
 *
 *   ai_providers, ai_service_configs, ai_usage_logs, ai_model_pricing,
 *   ai_budget_settings, ai_moderation_rules, ai_moderation_queue,
 *   languages, lang_translations, social_links.
 *
 * `ai_service_configs`/`ai_usage_logs`/`ai_budget_settings`/`ai_moderation_rules`/
 * `ai_moderation_queue` reference `users` (core.ts, chạy trước) — không có FK
 * chéo trong file này. Column types và nullability PHẢI khớp Drizzle trong
 * `server/db/schema.ts` (cổng drift giữ).
 */
export async function createAiI18nTables(db: Connection): Promise<void> {
  // ─── AI Panel (add-ai-panel) ──────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`ai_providers\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`provider\` VARCHAR(32) NOT NULL UNIQUE,
      \`label\` VARCHAR(128) NOT NULL,
      \`base_url\` VARCHAR(1024) NULL,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 0,
      \`api_key_ciphertext\` TEXT NULL,
      \`api_key_nonce\` VARCHAR(64) NULL,
      \`api_key_version\` INT UNSIGNED NULL,
      \`api_key_auth_tag\` VARCHAR(64) NULL,
      \`api_key_key_id\` VARCHAR(64) NULL,
      \`api_key_last_four\` VARCHAR(4) NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`ai_service_configs\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`service_key\` VARCHAR(64) NOT NULL UNIQUE,
      \`service_name\` VARCHAR(128) NOT NULL,
      \`provider\` VARCHAR(32) NOT NULL,
      \`model\` VARCHAR(64) NULL,
      \`system_prompt\` TEXT NULL,
      \`temperature\` DECIMAL(3,2) NOT NULL DEFAULT 0.30,
      \`max_tokens\` INT NOT NULL DEFAULT 4096,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 0,
      \`updated_by\` INT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`fk_ai_service_configs_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`ai_usage_logs\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`service_key\` VARCHAR(64) NOT NULL,
      \`provider\` VARCHAR(32) NOT NULL,
      \`model\` VARCHAR(64) NULL,
      \`prompt_tokens\` INT NOT NULL DEFAULT 0,
      \`completion_tokens\` INT NOT NULL DEFAULT 0,
      \`total_tokens\` INT NOT NULL DEFAULT 0,
      \`cost_usd\` DECIMAL(10,6) NOT NULL DEFAULT 0,
      \`cost_vnd\` DECIMAL(12,2) NOT NULL DEFAULT 0,
      \`execution_ms\` INT NOT NULL DEFAULT 0,
      \`user_id\` INT NULL,
      \`success\` TINYINT(1) NOT NULL DEFAULT 1,
      \`error_message\` TEXT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX \`ai_usage_logs_created_idx\` (\`created_at\`),
      INDEX \`ai_usage_logs_service_created_idx\` (\`service_key\`, \`created_at\`),
      CONSTRAINT \`fk_ai_usage_logs_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`ai_model_pricing\` (
      \`model\` VARCHAR(64) NOT NULL,
      \`provider\` VARCHAR(32) NOT NULL,
      \`label\` VARCHAR(128) NULL,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`prompt_cost_per_million\` DECIMAL(8,4) NOT NULL DEFAULT 0,
      \`completion_cost_per_million\` DECIMAL(8,4) NOT NULL DEFAULT 0,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`model\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`ai_budget_settings\` (
      \`id\` INT NOT NULL,
      \`monthly_budget_vnd\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`warning_threshold_pct\` INT NOT NULL DEFAULT 80,
      \`updated_by\` INT NULL,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`fk_ai_budget_settings_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`ai_moderation_rules\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`category\` VARCHAR(64) NOT NULL,
      \`rule_type\` VARCHAR(32) NOT NULL DEFAULT 'keyword',
      \`pattern\` TEXT NOT NULL,
      \`action\` VARCHAR(32) NOT NULL DEFAULT 'auto_hide',
      \`severity\` VARCHAR(16) NOT NULL DEFAULT 'high',
      \`is_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_by\` INT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`fk_ai_mod_rules_user\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`ai_moderation_queue\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`target_type\` VARCHAR(32) NOT NULL,
      \`target_id\` BIGINT UNSIGNED NULL,
      \`author_name\` VARCHAR(255) NULL,
      \`author_ip\` VARCHAR(45) NULL,
      \`context_title\` VARCHAR(512) NULL,
      \`context_url\` VARCHAR(512) NULL,
      \`session_id\` VARCHAR(64) NULL,
      \`content_snippet\` TEXT NOT NULL,
      \`flagged_reason\` TEXT NOT NULL,
      \`matched_rules\` JSON NULL,
      \`severity\` VARCHAR(16) NOT NULL DEFAULT 'high',
      \`status\` VARCHAR(32) NOT NULL DEFAULT 'pending',
      \`reviewed_by\` INT NULL,
      \`reviewed_at\` DATETIME NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY \`ai_moderation_queue_status_created_idx\` (\`status\`, \`created_at\`),
      KEY \`ai_moderation_queue_target_idx\` (\`target_type\`, \`target_id\`),
      CONSTRAINT \`fk_ai_mod_queue_reviewer\` FOREIGN KEY (\`reviewed_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`languages\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`code\` VARCHAR(10) NOT NULL UNIQUE,
      \`name\` VARCHAR(100) NOT NULL,
      \`native_name\` VARCHAR(100) NOT NULL,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`is_default\` TINYINT(1) NOT NULL DEFAULT 0,
      \`display_order\` INT NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`lang_translations\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`lang_code\` VARCHAR(10) NOT NULL,
      \`group\` VARCHAR(50) NOT NULL DEFAULT 'general',
      \`key\` VARCHAR(200) NOT NULL,
      \`value\` TEXT NULL,
      \`is_ai_translated\` TINYINT(1) NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`uk_lang_group_key\` (\`lang_code\`, \`group\`, \`key\`),
      KEY \`idx_lang_code\` (\`lang_code\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`social_links\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`platform\` VARCHAR(64) NOT NULL,
      \`label\` VARCHAR(128) NOT NULL,
      \`url\` VARCHAR(1024) NOT NULL,
      \`icon\` VARCHAR(255) NOT NULL DEFAULT 'fa-brands fa-link',
      \`icon_type\` VARCHAR(16) NOT NULL DEFAULT 'fontawesome',
      \`color\` VARCHAR(16) NOT NULL DEFAULT '#1877f2',
      \`sort_order\` INT NOT NULL DEFAULT 0,
      \`is_visible\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY \`social_links_sort_idx\` (\`sort_order\`, \`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)
}
