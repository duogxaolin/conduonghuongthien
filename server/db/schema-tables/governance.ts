import type { Connection } from 'mysql2/promise'
import { ensureColumn, ensureIndex, ensureForeignKeyIfMissing } from '../migrations-additive'

/**
 * Bảng quản trị & xử lý đơn: settings, rate_limit_counters, activity_logs,
 * data_retention_state, user_mfa_factors, user_recovery_codes, submissions,
 * submission_events.
 *
 * `submissions` nhận các cột vòng đời (status, status_changed_by, ...) qua
 * `ensureColumn` chứ không trong CREATE TABLE: bảng đã có dữ liệu hồ sơ công
 * dân trên mọi deployment, nên `CREATE TABLE IF NOT EXISTS` không chạm tới nó —
 * comment đầy đủ trong init.ts gốc. `submission_events` đi kèm (CASCADE theo
 * hồ sơ).
 */
export async function createGovernanceTables(db: Connection, database: string): Promise<void> {
  // Settings table
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`settings\` (
      \`key\` VARCHAR(128) PRIMARY KEY,
      \`value\` MEDIUMTEXT NULL,
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

  // Vòng đời xử lý đơn. Đi bằng `ensureColumn` chứ không nằm trong câu CREATE
  // TABLE bên trên: bảng này đã có dữ liệu của cơ quan trên đó ở mọi deployment
  // đang chạy, nên `CREATE TABLE IF NOT EXISTS` không bao giờ chạm tới nó — cùng
  // lý do `answers` và `form_title` ở ngay trên cũng là ALTER.
  await ensureColumn(db, database, 'submissions', 'status', "VARCHAR(24) NOT NULL DEFAULT 'new'")
  await ensureColumn(db, database, 'submissions', 'status_changed_by', 'INT NULL')
  await ensureColumn(db, database, 'submissions', 'status_changed_at', 'DATETIME NULL')
  await ensureColumn(db, database, 'submissions', 'first_viewed_by', 'INT NULL')
  await ensureColumn(db, database, 'submissions', 'first_viewed_at', 'DATETIME NULL')
  await ensureColumn(db, database, 'submissions', 'notified_at', 'DATETIME NULL')
  await ensureIndex(db, database, 'submissions', 'submissions_status_created_idx', 'INDEX `submissions_status_created_idx` (`status`, `created_at`)')
  await ensureForeignKeyIfMissing(db, database, 'submissions', 'fk_submissions_status_by', 'FOREIGN KEY (`status_changed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL')
  await ensureForeignKeyIfMissing(db, database, 'submissions', 'fk_submissions_viewed_by', 'FOREIGN KEY (`first_viewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL')

  // Nhật ký xử lý đơn. FK sang `submissions` là CASCADE (nhật ký đi theo hồ sơ),
  // FK sang `users` là SET NULL — xoá một tài khoản cán bộ không được làm biến mất
  // dấu vết việc họ đã xử lý hồ sơ của một công dân.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`submission_events\` (
      \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`submission_id\` BIGINT UNSIGNED NOT NULL,
      \`actor_id\` INT NULL,
      \`actor_name\` VARCHAR(64) NULL,
      \`event_type\` VARCHAR(16) NOT NULL,
      \`from_status\` VARCHAR(24) NULL,
      \`to_status\` VARCHAR(24) NULL,
      \`channel\` VARCHAR(16) NULL,
      \`note\` TEXT NULL,
      \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY \`submission_events_submission_idx\` (\`submission_id\`, \`created_at\`),
      CONSTRAINT \`fk_submission_events_submission\` FOREIGN KEY (\`submission_id\`) REFERENCES \`submissions\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_submission_events_actor\` FOREIGN KEY (\`actor_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Retention purges filter on created_at. Deployments created before the
  // retention policy existed have the tables but not these indexes.
  await ensureIndex(db, database, 'activity_logs', 'activity_created_idx', 'INDEX `activity_created_idx` (`created_at`)')
  await ensureIndex(db, database, 'submissions', 'submissions_created_idx', 'INDEX `submissions_created_idx` (`created_at`)')
}
