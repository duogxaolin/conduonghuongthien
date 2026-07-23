import assert from 'node:assert/strict'
import test from 'node:test'
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'
import {
  chatbotColumnMigrations,
  chatbotForeignKeyMigrations,
  chatbotConvergentIndexMigrations,
  initDb,
} from '../server/db/init'

const enabled = process.env.CHATBOT_DDL_INTEGRATION === '1'
const host = process.env.CHATBOT_DDL_HOST || '127.0.0.1'
const port = Number(process.env.CHATBOT_DDL_PORT || 3306)
const user = process.env.CHATBOT_DDL_USER || 'root'
const password = process.env.CHATBOT_DDL_PASSWORD || 'rootpassword'
const runId = `${Date.now()}_${process.pid}`
export const freshDatabase = `cdkt_chatbot_ddl_${runId}_fresh`
export const partialDatabase = `cdkt_chatbot_ddl_${runId}_partial`

function assertDisposableDatabase(database: string) {
  assert.match(database, /^cdkt_chatbot_ddl_\d+_\d+_(fresh|partial)$/)
  assert.notEqual(database, 'cdkt_admin')
  assert.notEqual(database, process.env.DB_NAME)
}

async function connection(database?: string) {
  return mysql.createConnection({ host, port, user, password, database })
}

async function initialize(database: string) {
  assertDisposableDatabase(database)
  const previous = {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME,
  }
  Object.assign(process.env, {
    DB_HOST: host,
    DB_PORT: String(port),
    DB_USER: user,
    DB_PASSWORD: password,
    DB_NAME: database,
  })
  try {
    await initDb()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function normalize(value: unknown) {
  if (value === null || value === undefined) return null
  return String(value).trim().toLowerCase().replace(/\(\)$/, '')
}

async function assertChatbotShape(db: Connection, database: string) {
  for (const migration of chatbotColumnMigrations) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [database, migration.table, migration.column],
    )
    assert.equal(rows.length, 1, `${migration.table}.${migration.column} must exist`)
    const row = rows[0]!
    assert.ok(migration.columnTypes.includes(String(row.COLUMN_TYPE).toLowerCase()), `${migration.table}.${migration.column} type must converge`)
    assert.equal(row.IS_NULLABLE, migration.nullable ? 'YES' : 'NO', `${migration.table}.${migration.column} nullability must converge`)
    assert.equal(normalize(row.COLUMN_DEFAULT), normalize(migration.defaultValue), `${migration.table}.${migration.column} default must converge`)
    if (migration.extra) assert.match(String(row.EXTRA).toLowerCase(), new RegExp(migration.extra), `${migration.table}.${migration.column} extra must converge`)
  }

  for (const migration of chatbotConvergentIndexMigrations) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX`,
      [database, migration.table, migration.name],
    )
    assert.deepEqual(rows.map(row => row.COLUMN_NAME), [...migration.columns], `${migration.table}.${migration.name} columns must converge`)
    assert.ok(rows.every(row => Number(row.NON_UNIQUE) === (migration.unique ? 0 : 1)), `${migration.table}.${migration.name} uniqueness must converge`)
  }

  for (const migration of chatbotForeignKeyMigrations) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.TABLE_NAME = k.TABLE_NAME
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
       WHERE k.CONSTRAINT_SCHEMA = ? AND k.TABLE_NAME = ? AND k.CONSTRAINT_NAME = ?
       ORDER BY k.ORDINAL_POSITION`,
      [database, migration.table, migration.name],
    )
    assert.deepEqual(rows.map(row => row.COLUMN_NAME), [...migration.columns], `${migration.table}.${migration.name} local columns must converge`)
    assert.deepEqual(rows.map(row => row.REFERENCED_COLUMN_NAME), [...migration.referencedColumns], `${migration.table}.${migration.name} referenced columns must converge`)
    assert.ok(rows.every(row => row.REFERENCED_TABLE_NAME === migration.referencedTable), `${migration.table}.${migration.name} referenced table must converge`)
    assert.ok(rows.every(row => row.DELETE_RULE === migration.deleteRule), `${migration.table}.${migration.name} delete rule must converge`)
  }
}

async function createPartialFixture() {
  assertDisposableDatabase(partialDatabase)
  const server = await connection()
  try {
    await server.query(`CREATE DATABASE \`${partialDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  } finally {
    await server.end()
  }

  const db = await connection(partialDatabase)
  try {
    await db.query(`CREATE TABLE roles (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL UNIQUE,
      description VARCHAR(255), is_system TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`)
    await db.query(`CREATE TABLE users (
      id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE,
      email VARCHAR(128) UNIQUE, password_hash VARCHAR(255) NOT NULL,
      role_id INT, is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, last_login_at TIMESTAMP NULL
    ) ENGINE=InnoDB`)
    await db.query("INSERT INTO users (id, username, password_hash) VALUES (7, 'ddl-marker-user', 'marker-hash')")

    await db.query(`CREATE TABLE chatbot_settings (
      id INT NOT NULL, enabled INT NULL, model VARCHAR(16) NULL,
      updated_by BIGINT NULL, legacy_marker VARCHAR(64) NULL,
      UNIQUE KEY legacy_settings_id (id)
    ) ENGINE=InnoDB`)
    await db.query("INSERT INTO chatbot_settings (id, enabled, model, updated_by, legacy_marker) VALUES (1, NULL, 'marker-model', 7, 'keep-settings')")

    await db.query(`CREATE TABLE chatbot_knowledge (
      id BIGINT SIGNED NOT NULL AUTO_INCREMENT,
      canonical_question TEXT NULL, status VARCHAR(32) NULL,
      author_id BIGINT NULL, legacy_marker VARCHAR(64) NULL,
      PRIMARY KEY (id), KEY chatbot_knowledge_status_priority_id_idx (status)
    ) ENGINE=InnoDB`)
    await db.query("INSERT INTO chatbot_knowledge (id, canonical_question, status, author_id, legacy_marker) VALUES (42, 'marker-question', NULL, 7, 'keep-knowledge')")

    await db.query(`CREATE TABLE chatbot_knowledge_terms (
      id BIGINT SIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      knowledge_id BIGINT SIGNED NULL, value TEXT NULL,
      legacy_marker VARCHAR(64) NULL,
      KEY chatbot_terms_kind_normalized_knowledge_idx (knowledge_id)
    ) ENGINE=InnoDB`)
    await db.query("INSERT INTO chatbot_knowledge_terms (id, knowledge_id, value, legacy_marker) VALUES (9, 42, 'marker-term', 'keep-term')")
  } finally {
    await db.end()
  }
}

test('chatbot DDL definitions cover all three persisted chatbot tables without duplicate artifacts', () => {
  const columnKeys = chatbotColumnMigrations.map(item => `${item.table}.${item.column}`)
  assert.equal(new Set(columnKeys).size, columnKeys.length)
  assert.deepEqual(new Set(chatbotColumnMigrations.map(item => item.table)), new Set(['chatbot_settings', 'chatbot_knowledge', 'chatbot_knowledge_terms']))
  const indexKeys = chatbotConvergentIndexMigrations.map(item => `${item.table}.${item.name}`)
  assert.equal(new Set(indexKeys).size, indexKeys.length)
  const foreignKeyKeys = chatbotForeignKeyMigrations.map(item => `${item.table}.${item.name}`)
  assert.equal(new Set(foreignKeyKeys).size, foreignKeyKeys.length)
})

test('chatbot DDL converges fresh and partial MySQL fixtures twice without row loss', { skip: !enabled, timeout: 120_000 }, async () => {
  assertDisposableDatabase(freshDatabase)
  assertDisposableDatabase(partialDatabase)

  await initialize(freshDatabase)
  await initialize(freshDatabase)
  const fresh = await connection(freshDatabase)
  try {
    await assertChatbotShape(fresh, freshDatabase)
  } finally {
    await fresh.end()
  }

  await createPartialFixture()
  await initialize(partialDatabase)
  await initialize(partialDatabase)

  const partial = await connection(partialDatabase)
  try {
    await assertChatbotShape(partial, partialDatabase)
    const [settings] = await partial.query<RowDataPacket[]>('SELECT id, model, updated_by, legacy_marker FROM chatbot_settings')
    assert.deepEqual(settings.map(row => [row.id, row.model, row.updated_by, row.legacy_marker]), [[1, 'marker-model', 7, 'keep-settings']])
    const [knowledge] = await partial.query<RowDataPacket[]>('SELECT id, canonical_question, author_id, legacy_marker FROM chatbot_knowledge WHERE id = 42')
    assert.deepEqual(knowledge.map(row => [Number(row.id), row.canonical_question, row.author_id, row.legacy_marker]), [[42, 'marker-question', 7, 'keep-knowledge']])
    const [terms] = await partial.query<RowDataPacket[]>('SELECT id, knowledge_id, value, legacy_marker FROM chatbot_knowledge_terms')
    assert.deepEqual(terms.map(row => [Number(row.id), Number(row.knowledge_id), row.value, row.legacy_marker]), [[9, 42, 'marker-term', 'keep-term']])
  } finally {
    await partial.end()
  }

  console.log(`CHATBOT_DDL_FIXTURES=${freshDatabase},${partialDatabase}`)
})
