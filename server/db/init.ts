import mysql from 'mysql2/promise'

async function initDb() {
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
    CREATE TABLE IF NOT EXISTS \`activity_logs\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`user_id\` INT NULL,
      \`action\` VARCHAR(32) NOT NULL,
      \`resource\` VARCHAR(64) NULL,
      \`resource_id\` INT NULL,
      \`meta\` JSON NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY \`user_idx\` (\`user_id\`),
      CONSTRAINT \`fk_logs_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
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
      \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await db.end()
  console.log('✅ All MySQL tables exist and ready!')
}

initDb().catch(err => {
  console.error('❌ Init DB failed:', err)
  process.exit(1)
})
