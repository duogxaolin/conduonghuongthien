import type { Connection } from 'mysql2/promise'
import { ensureColumn, ensureIndex } from '../migrations-additive'

/**
 * Bảng nội dung: articles (+cột/category_id), article_view_*,
 * home_sections, page_contents, pages, page_blocks, page_versions.
 *
 * `articles` nhận `category`/`category_id` qua `ensureColumn` chứ không nằm
 * trong CREATE TABLE: bảng đã có dữ liệu của cơ quan trên mọi deployment đang
 * chạy, nên `CREATE TABLE IF NOT EXISTS` không bao giờ chạm tới它 — cùng lý do
 * `pages` nhận `draft_blocks`/`published_blocks` bằng ALTER.
 *
 * `article_translations` cũng ở đây (dù nằm cuối init.ts giữa các bảng AI):
 * FK của nó chỉ dẫn tới `articles` (ở file này, tạo trước) và `users` (core.ts),
 * nên đặt trong content.ts đúng domain và giữ an toàn FK.
 */
export async function createContentTables(db: Connection, database: string): Promise<void> {
  // Articles table. The three `view_total*` columns (all plain, app-maintained —
  // never a generated column, see schema.ts) and their index are born here on a
  // fresh database; an existing one gets them — and the boot-time reconcile with
  // `article_view_daily` — from `convergeArticleViewTotals` in
  // migrations-additive.ts (wave2 design D6).
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
      \`view_total_real\` BIGINT NOT NULL DEFAULT 0,
      \`view_total_fabricated\` BIGINT NOT NULL DEFAULT 0,
      \`view_total\` BIGINT NOT NULL DEFAULT 0,
      KEY \`type_idx\` (\`type\`),
      KEY \`status_idx\` (\`status\`),
      KEY \`articles_status_type_pub_idx\` (\`status\`, \`type\`, \`published_at\`, \`created_at\`),
      KEY \`articles_status_type_views_idx\` (\`status\`, \`type\`, \`view_total\`, \`published_at\`, \`created_at\`),
      CONSTRAINT \`fk_articles_thumbnail\` FOREIGN KEY (\`thumbnail_id\`) REFERENCES \`media\` (\`id\`) ON DELETE SET NULL,
      CONSTRAINT \`fk_articles_author\` FOREIGN KEY (\`author_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  // Add category columns (MySQL 8.0 doesn't support IF NOT EXISTS — use helper)
  await ensureColumn(db, database, 'articles', 'category', 'VARCHAR(128) NULL AFTER `type`')
  await ensureIndex(db, database, 'articles', 'category_idx', 'INDEX `category_idx` (`category`)')
  await ensureColumn(db, database, 'articles', 'category_id', 'INT NULL AFTER `category`')
  await ensureIndex(db, database, 'articles', 'category_id_idx', 'INDEX `category_id_idx` (`category_id`)')
  // Cannot sit in the CREATE TABLE body above: `category_id` is added after it.
  // Existing databases get both composite list indexes from migrations-additive.ts.
  await ensureIndex(db, database, 'articles', 'articles_status_category_pub_idx', 'INDEX `articles_status_category_pub_idx` (`status`, `category_id`, `published_at`, `created_at`)')

  // Add FK constraint for category_id
  await db.query(`
    ALTER TABLE \`articles\`
    ADD CONSTRAINT \`fk_articles_category\` FOREIGN KEY (\`category_id\`) REFERENCES \`categories\` (\`id\`) ON DELETE SET NULL;
  `).catch(() => {/* ignore if already exists */})

  // Danh mục bài viết mặc định: chèn MỘT lần cho mỗi CSDL bởi `seed.ts`
  // (`server/db/seed-groups.ts`, wave2 D7) — không chèn ở đây. Tệp này chỉ còn DDL:
  // chèn ở mỗi lần `init.ts` chạy là đưa lại danh mục cán bộ đã xoá sau mỗi deploy.

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

  // Article translations — tách từ cuối init.ts về đúng domain (content). FK
  // dẫn tới `articles` (tạo ở trên trong file này) và `users` (core.ts), nên an
  // toàn FK khi content.ts chạy sau core.ts.
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`article_translations\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`article_id\` INT NOT NULL,
      \`lang_code\` VARCHAR(10) NOT NULL,
      \`title\` VARCHAR(512) NULL,
      \`excerpt\` TEXT NULL,
      \`content\` LONGTEXT NULL,
      \`status\` VARCHAR(16) NOT NULL DEFAULT 'translating',
      \`translated_by\` VARCHAR(32) NOT NULL DEFAULT 'ai',
      \`translator_id\` INT NULL,
      \`progress\` INT NOT NULL DEFAULT 0,
      \`total_chunks\` INT NOT NULL DEFAULT 0,
      \`current_chunk\` INT NOT NULL DEFAULT 0,
      \`error_message\` VARCHAR(512) NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`completed_at\` TIMESTAMP NULL,
      UNIQUE KEY \`uk_article_lang\` (\`article_id\`, \`lang_code\`),
      KEY \`article_translations_lang_status_idx\` (\`lang_code\`, \`status\`),
      CONSTRAINT \`fk_article_translations_article\` FOREIGN KEY (\`article_id\`) REFERENCES \`articles\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_article_translations_translator\` FOREIGN KEY (\`translator_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)
}
