import type { Connection } from 'mysql2/promise'
import { ensureColumn } from '../migrations-additive'

/**
 * Bảng chatbot: chatbot_settings, chatbot_knowledge, chatbot_knowledge_terms,
 * chatbot_small_talk, chat_sessions, chat_messages.
 *
 * `chat_sessions` nhận `detected_name` qua `ensureColumn`: cột đến sau lần triển
 * khai đầu tiên của hai bảng phiên/tin nhắn, nên đi đường ALTER cho DB đã có dữ
 * liệu phiên thật.
 */
export async function createChatbotTables(db: Connection, database: string): Promise<void> {
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
      \`normalized_value\` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
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
      \`is_flagged\` TINYINT(1) NOT NULL DEFAULT 0,
      \`flag_reason\` VARCHAR(255) NULL,
      \`created_at\` DATETIME NOT NULL,
      KEY \`chat_messages_session_created_idx\` (\`session_id\`, \`created_at\`),
      CONSTRAINT \`fk_chat_messages_session\` FOREIGN KEY (\`session_id\`) REFERENCES \`chat_sessions\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Detected-name arrived after the first deployments of the two tables above.
  await ensureColumn(db, database, 'chat_sessions', 'detected_name', 'VARCHAR(128) NULL')
}
