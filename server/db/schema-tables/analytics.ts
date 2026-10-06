import type { Connection } from 'mysql2/promise'

/**
 * Bảng analytics riêng tư: 8 bảng tổng hợp + sự kiện lượt xem trang.
 *
 * Không có `ensureColumn` ở đây — các bảng này được tạo mới hoàn toàn trên
 * deployment đầu tiên có analytics, nên mọi cột nằm trong CREATE TABLE. Nếu
 * sau này cần thêm cột cho bảng đã có dữ liệu, dùng `migrations-additive.ts`.
 */
export async function createAnalyticsTables(db: Connection): Promise<void> {
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
}
