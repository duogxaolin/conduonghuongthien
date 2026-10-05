import type { Connection } from 'mysql2/promise'

/**
 * Bảng nền tảng: roles, permissions, users, media (ảnh legacy), content_types,
 * categories. Mọi FK khác đều dẫn về đây, nên khối này chạy đầu tiên.
 *
 * Tách ra từ `init.ts` theo domain — thứ tự FK là ràng buộc thật, không phải sắp
 * lại cho gọn: `permissions` reference `roles`, `users` reference `roles`,
 * `media` reference `users`, `categories` tự reference. Đọc commentary đầy đủ
 * về vì sao DDL chia hai nơi (CREATE TABLE ở đây, ensureColumn/FK ở
 * `migrations-additive.ts`) trong `init.ts`.
 */
export async function createCoreTables(db: Connection, database: string): Promise<void> {
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

  // earmark unused param to keep the signature uniform across all schema-tables files
  void database
}
