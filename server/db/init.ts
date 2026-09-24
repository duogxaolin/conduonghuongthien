import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'

/**
 * DDL khởi tạo: dựng CSDL và 46 bảng cho một máy chủ trống, idempotent.
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
      \`trigger\` VARCHAR(16) NOT NULL DEFAULT 'manual',
      \`status\` VARCHAR(16) NOT NULL DEFAULT 'pending',
      \`drive_uploaded\` TINYINT(1) DEFAULT 0,
      \`drive_file_id\` VARCHAR(128) NULL,
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

  // ─── AI Panel (add-ai-panel) ──────────────────────────────────────────────
  // Five new tables: ai_providers, ai_service_configs, ai_usage_logs,
  // ai_model_pricing, ai_budget_settings. Column types and nullability MUST
  // match the Drizzle definitions in server/db/schema.ts exactly.

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
