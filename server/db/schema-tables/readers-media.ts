import type { Connection } from 'mysql2/promise'

/**
 * Người đọc + Media portal + bình luận + thông báo + OAuth/backup.
 *
 * Thứ tự trong file là ràng buộc FK thật:
 *   reader_accounts → media_items (FK category_id → media_categories,
 *     created_by → users) → livestream_sessions (FK saved_media_id → media_items)
 *     → livestream_messages (FK session_id → livestream_sessions,
 *     reader_id → reader_accounts) → media_upload_sessions → media_asset_cleanup
 *     → article_comments (FK article_id → articles [content.ts],
 *     media_item_id → media_items, reader_id → reader_accounts,
 *     admin_user_id → users) → reader_notifications (FK comment_id → article_comments,
 *     reader_id → reader_accounts) → reader_ip_bans → google_oauth_settings →
 *     backups → backup_drive_oauth → backup_drive_oauth_config.
 *
 * `article_comments` là điểm giao thoa: nó reference cả `articles` (content.ts,
 * chạy trước) và `media_items`/`reader_accounts` (tạo ở trên trong file này),
 * nên cả ba cha phải tồn tại trước nó — đúng thứ tự gọi trong init.ts.
 */
export async function createReadersMediaTables(db: Connection): Promise<void> {
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
      \`email_notifications\` TINYINT(1) NOT NULL DEFAULT 1,
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

  // ── Media portal (add-media-portal) ────────────────────────────────────
  // Created here, after `categories`/`users`/`reader_accounts` and before
  // `article_comments`, because the comment table gains an FK pointing at
  // `media_items`. Ordering inside this function is a real constraint: a
  // `CREATE TABLE IF NOT EXISTS` that references a table which does not exist
  // yet fails, and it only fails on an empty server.
  //
  // `status` (editorial: draft|published|archived) and `processing_status`
  // (machine: pending|processing|ready|failed) are two columns on purpose —
  // collapsing them makes "published but the transcode failed" unrepresentable.
  //
  // `resolutions_ready` uses MySQL 8's expression-default form. A JSON column
  // rejects a literal default outright (`ERROR 1101`), so `DEFAULT (JSON_ARRAY())`
  // is the only shape that both works and reads as the empty list.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`media_categories\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`name\` VARCHAR(255) NOT NULL,
      \`slug\` VARCHAR(255) NOT NULL UNIQUE,
      \`description\` TEXT NULL,
      \`display_order\` INT NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS \`media_items\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`slug\` VARCHAR(512) NOT NULL UNIQUE,
      \`short_id\` VARCHAR(16) NOT NULL UNIQUE,
      \`title\` VARCHAR(512) NOT NULL,
      \`description\` TEXT NULL,
      \`source\` VARCHAR(16) NOT NULL DEFAULT 'upload',
      \`youtube_video_id\` VARCHAR(32) NULL,
      \`storage_path\` VARCHAR(1024) NULL,
      \`storage_provider\` VARCHAR(16) NOT NULL DEFAULT 'local',
      \`thumbnail_url\` VARCHAR(1024) NULL,
      \`duration_seconds\` INT NULL,
      \`width\` INT NULL,
      \`height\` INT NULL,
      \`category_id\` INT NULL,
      \`status\` VARCHAR(16) NOT NULL DEFAULT 'draft',
      \`processing_status\` VARCHAR(16) NOT NULL DEFAULT 'pending',
      \`processing_error\` VARCHAR(512) NULL,
      \`resolutions_ready\` JSON NULL DEFAULT (JSON_ARRAY()),
      \`processing_rendition\` VARCHAR(16) NULL,
      \`processing_percent\` INT NULL,
      \`processing_phase\` VARCHAR(16) NULL,
      \`claimed_by\` VARCHAR(64) NULL,
      \`processing_attempts\` INT NOT NULL DEFAULT 0,
      \`processing_next_attempt_at\` TIMESTAMP NULL DEFAULT NULL,
      \`processing_heartbeat_at\` TIMESTAMP NULL DEFAULT NULL,
      \`comments_enabled\` TINYINT(1) NOT NULL DEFAULT 0,
      \`is_featured\` TINYINT(1) NOT NULL DEFAULT 0,
      \`view_count\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
      \`published_at\` TIMESTAMP NULL DEFAULT NULL,
      \`created_by\` INT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY \`media_items_status_published_idx\` (\`status\`, \`published_at\`),
      KEY \`media_items_category_id_idx\` (\`category_id\`),
      KEY \`media_items_processing_status_updated_idx\` (\`processing_status\`, \`updated_at\`),
      CONSTRAINT \`fk_media_items_category\` FOREIGN KEY (\`category_id\`) REFERENCES \`media_categories\` (\`id\`) ON DELETE SET NULL,
      CONSTRAINT \`fk_media_items_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // No unique index on `is_active` on purpose: a unique index would make the
  // single-active invariant depend on catching a duplicate-key error, and MySQL 8
  // has no partial unique index. The mechanism is GET_LOCK('cdkt:livestream:active').
  //
  // `saved_media_id` is SET NULL so a retention pass over sessions never deletes
  // the recording it produced; `started_at`/`ended_at` are DATETIME (no 2038
  // horizon, no driver timezone conversion) and `ended_at` is the retention
  // scope's age column — a session is old when it finished, not when it started.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`livestream_sessions\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`title\` VARCHAR(512) NOT NULL,
      \`description\` TEXT NULL,
      \`source\` VARCHAR(16) NOT NULL DEFAULT 'youtube',
      \`youtube_video_id\` VARCHAR(32) NULL,
      \`storage_path\` VARCHAR(1024) NULL,
      \`thumbnail_url\` VARCHAR(1024) NULL,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 0,
      \`started_at\` DATETIME NULL,
      \`ended_at\` DATETIME NULL,
      \`saved_media_id\` INT NULL,
      \`created_by\` INT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY \`livestream_sessions_is_active_idx\` (\`is_active\`),
      KEY \`livestream_sessions_ended_at_idx\` (\`ended_at\`),
      KEY \`livestream_sessions_saved_media_id_idx\` (\`saved_media_id\`),
      CONSTRAINT \`fk_livestream_sessions_saved_media\` FOREIGN KEY (\`saved_media_id\`) REFERENCES \`media_items\` (\`id\`) ON DELETE SET NULL,
      CONSTRAINT \`fk_livestream_sessions_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Deliberately NOT a retention scope: the FK cascades from `livestream_sessions`,
  // which is the scope, so an independent window would delete messages while their
  // session still exists. `display_name` is a snapshot — a later rename must not
  // rewrite what was displayed to the people watching at the time.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`livestream_messages\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`session_id\` INT NOT NULL,
      \`reader_id\` INT NOT NULL,
      \`display_name\` VARCHAR(100) NOT NULL,
      \`content\` VARCHAR(200) NOT NULL,
      \`is_deleted\` TINYINT(1) NOT NULL DEFAULT 0,
      \`created_at\` DATETIME(3) NOT NULL,
      KEY \`livestream_messages_session_created_idx\` (\`session_id\`, \`created_at\`),
      KEY \`livestream_messages_reader_id_idx\` (\`reader_id\`),
      CONSTRAINT \`fk_livestream_messages_session\` FOREIGN KEY (\`session_id\`) REFERENCES \`livestream_sessions\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_livestream_messages_reader\` FOREIGN KEY (\`reader_id\`) REFERENCES \`reader_accounts\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // The upload row IS the ownership binding (design.md §6): every chunk, status
  // and completion request re-verifies `upload_id` AND `admin_user_id` in the
  // query, so an unknown identifier and another administrator's identifier are
  // indistinguishable from outside.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`media_upload_sessions\` (
      \`upload_id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`admin_user_id\` INT NOT NULL,
      \`filename\` VARCHAR(255) NOT NULL,
      \`declared_size\` BIGINT UNSIGNED NOT NULL,
      \`chunk_size\` INT UNSIGNED NOT NULL,
      \`total_chunks\` INT UNSIGNED NOT NULL,
      \`received_parts\` JSON NULL DEFAULT (JSON_ARRAY()),
      \`status\` VARCHAR(16) NOT NULL DEFAULT 'pending',
      \`completion_claim\` VARCHAR(36) NULL,
      \`completion_heartbeat_at\` TIMESTAMP NULL DEFAULT NULL,
      \`content_type\` VARCHAR(64) NULL,
      \`error_message\` VARCHAR(512) NULL,
      \`media_item_id\` INT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY \`media_upload_sessions_admin_user_idx\` (\`admin_user_id\`),
      KEY \`media_upload_sessions_updated_at_idx\` (\`updated_at\`),
      CONSTRAINT \`fk_media_upload_sessions_admin_user\` FOREIGN KEY (\`admin_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_media_upload_sessions_media_item\` FOREIGN KEY (\`media_item_id\`) REFERENCES \`media_items\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Durable outbox for local files left by a deleted media item.  It deliberately
  // does not reference media_items: that row is already gone when this task is
  // consumed, and adding an FK would delete the evidence before the worker ran.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`media_asset_cleanup\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`asset_root\` VARCHAR(1024) NOT NULL,
      \`storage_provider\` VARCHAR(16) NOT NULL DEFAULT 'local',
      \`attempts\` INT NOT NULL DEFAULT 0,
      \`next_attempt_at\` TIMESTAMP NULL DEFAULT NULL,
      \`last_error\` VARCHAR(512) NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY \`media_asset_cleanup_due_idx\` (\`next_attempt_at\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // design.md D8: every FK cascades except admin_user_id (SET NULL) — deleting
  // a staff account must not remove the portal's public replies.
  //
  // `article_id` is NULL-able because a comment belongs to exactly one item, an
  // article OR a media item. The database cannot state that here (a CHECK is
  // enforced inconsistently by MySQL 8 alongside ON DELETE CASCADE), so the rule
  // is the runtime XOR guard in createComment plus checkParentEligibility
  // requiring the parent to share the child's item. Both are tested.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`article_comments\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`article_id\` INT NULL,
      \`media_item_id\` INT NULL,
      \`reader_id\` INT NULL,
      \`admin_user_id\` INT NULL,
      \`parent_id\` BIGINT UNSIGNED NULL,
      \`body\` TEXT NOT NULL,
      \`ip\` VARCHAR(45) NULL,
      \`user_agent\` VARCHAR(512) NULL,
      \`is_hidden\` TINYINT(1) NOT NULL DEFAULT 0,
      \`flag_reason\` VARCHAR(255) NULL,
      \`created_at\` DATETIME NOT NULL,
      KEY \`article_comments_article_parent_created_idx\` (\`article_id\`, \`parent_id\`, \`created_at\`),
      KEY \`article_comments_media_parent_created_idx\` (\`media_item_id\`, \`parent_id\`, \`created_at\`),
      KEY \`article_comments_reader_id_idx\` (\`reader_id\`),
      CONSTRAINT \`fk_article_comments_article\` FOREIGN KEY (\`article_id\`) REFERENCES \`articles\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_article_comments_media\` FOREIGN KEY (\`media_item_id\`) REFERENCES \`media_items\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_article_comments_reader\` FOREIGN KEY (\`reader_id\`) REFERENCES \`reader_accounts\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_article_comments_admin_user\` FOREIGN KEY (\`admin_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
      CONSTRAINT \`fk_article_comments_parent\` FOREIGN KEY (\`parent_id\`) REFERENCES \`article_comments\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // "Somebody replied to you". Both FKs CASCADE on purpose: a notification is a
  // pointer to a row the reader can go and read, so when the reply (or the
  // reader) is gone there is nothing left to point at and following it would
  // land on an article with no such comment.
  //
  // Deliberately NOT registered as a retention scope — every row hangs off
  // `article_comments`, which already cascades from both `articles` and
  // `reader_accounts`, so this table is bounded before retention looks at it.
  // An independent age window would delete the notification while the reply sat
  // unread on the page. See the comment on readerNotifications in schema.ts.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`reader_notifications\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`reader_id\` INT NOT NULL,
      \`comment_id\` BIGINT UNSIGNED NOT NULL,
      \`type\` VARCHAR(32) NOT NULL DEFAULT 'comment_reply',
      \`is_read\` TINYINT(1) NOT NULL DEFAULT 0,
      \`created_at\` DATETIME NOT NULL,
      UNIQUE KEY \`reader_notifications_reader_comment_uq\` (\`reader_id\`, \`comment_id\`),
      KEY \`reader_notifications_reader_read_created_idx\` (\`reader_id\`, \`is_read\`, \`created_at\`),
      KEY \`reader_notifications_comment_id_idx\` (\`comment_id\`),
      CONSTRAINT \`fk_reader_notifications_reader\` FOREIGN KEY (\`reader_id\`) REFERENCES \`reader_accounts\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_reader_notifications_comment\` FOREIGN KEY (\`comment_id\`) REFERENCES \`article_comments\` (\`id\`) ON DELETE CASCADE
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

  // Sổ ghi các bản backup (SQL dump + file nén). Bảng thứ 43. Không đăng ký
  // retention — backups tự xoay vòng theo N cấu hình tại /admin/settings/backup.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`backups\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`filename\` VARCHAR(255) NOT NULL,
      \`type\` VARCHAR(16) NOT NULL,
      \`bytes\` BIGINT NOT NULL DEFAULT 0,
      \`stamp\` VARCHAR(16) NOT NULL,
      \`trigger\` VARCHAR(32) NOT NULL DEFAULT 'manual',
      \`status\` VARCHAR(16) NOT NULL DEFAULT 'pending',
      \`drive_uploaded\` TINYINT(1) DEFAULT 0,
      \`drive_file_id\` VARCHAR(128) NULL,
      \`offsite_status\` VARCHAR(16) NULL,
      \`error\` TEXT NULL,
      \`created_by\` INT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY \`backups_stamp_idx\` (\`stamp\`),
      KEY \`backups_status_idx\` (\`status\`),
      CONSTRAINT \`fk_backups_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Backup Drive OAuth — single-row table holding the refresh token envelope +
  // linked email/sub for the "login to connect Drive" UX. Bảng thứ 44.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`backup_drive_oauth\` (
      \`id\` INT NOT NULL,
      \`refresh_token_ciphertext\` TEXT NULL,
      \`refresh_token_nonce\` VARCHAR(64) NULL,
      \`refresh_token_auth_tag\` VARCHAR(64) NULL,
      \`refresh_token_version\` INT UNSIGNED NULL,
      \`refresh_token_key_id\` VARCHAR(64) NULL,
      \`linked_email\` VARCHAR(255) NULL,
      \`linked_sub\` VARCHAR(128) NULL,
      \`linked_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_by\` INT NULL,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`fk_backup_drive_oauth_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Backup Drive OAuth config — Client ID + Secret riêng cho Drive (bảng thứ 45).
  // Tách khỏi `google_oauth_settings` của reader: scope/audience/consent khác.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`backup_drive_oauth_config\` (
      \`id\` INT NOT NULL,
      \`client_id\` VARCHAR(255) NULL,
      \`client_secret_ciphertext\` TEXT NULL,
      \`client_secret_nonce\` VARCHAR(64) NULL,
      \`client_secret_auth_tag\` VARCHAR(64) NULL,
      \`client_secret_version\` INT UNSIGNED NULL,
      \`client_secret_key_id\` VARCHAR(64) NULL,
      \`client_secret_last_four\` VARCHAR(8) NULL,
      \`is_enabled\` TINYINT(1) NOT NULL DEFAULT 0,
      \`updated_by\` INT NULL,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`fk_backup_drive_oauth_config_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)
}
