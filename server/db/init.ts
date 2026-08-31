import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'

/**
 * DDL khởi tạo: dựng CSDL và 41 bảng cho một máy chủ trống, idempotent.
 *
 * Phần **hội tụ lược đồ đã có dữ liệu** (thêm cột còn thiếu, index, khoá ngoại,
 * điền giá trị rồi đặt `NOT NULL`) nằm ở `migrations-additive.ts` — hai việc đó
 * chạy trên hai loại CSDL khác nhau, xem đầu tệp đó để biết vì sao không gộp.
 *
 * Re-export nguyên vẹn để bốn suite test đang import từ tệp này không phải đổi
 * đường dẫn; `initDb()` bên dưới gọi `applyAdditiveMigrations` như trước.
 */
export * from './migrations-additive'
import { applyAdditiveMigrations, ensureColumn, ensureForeignKeyIfMissing, ensureIndex } from './migrations-additive'

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

  await applyAdditiveMigrations(db, database)

  await db.end()
  console.log('✅ All MySQL tables exist and ready!')
}

// Chuẩn hoá dấu gạch: trên Windows argv[1] là `...\server\db\init.ts`, nên một
// phép so sánh với dấu gạch xuôi duy nhất khiến script thoát 0 mà KHÔNG HỀ chạy
// initDb() — im lặng, đúng kiểu hỏng mà không lỗi nào báo. Đã gặp thật lúc chạy
// e2e trên checkout Windows: db:init "xong" và db:seed sau đó chết vì thiếu CSDL.
const invokedScript = (process.argv[1] || '').replaceAll('\\', '/')
if (invokedScript.endsWith('server/db/init.ts')) {
  initDb().catch(err => {
    console.error('❌ Init DB failed:', err)
    process.exit(1)
  })
}
