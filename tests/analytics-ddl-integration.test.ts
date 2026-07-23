import assert from 'node:assert/strict'
import test from 'node:test'
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'
import { initDb, realtimeAnalyticsIndexMigrations, realtimeAnalyticsOptionalColumns, realtimeAnalyticsRequiredColumnMigrations } from '../server/db/init'

const enabled = process.env.ANALYTICS_DDL_INTEGRATION === '1'
const host = process.env.ANALYTICS_DDL_HOST || '127.0.0.1'
const port = Number(process.env.ANALYTICS_DDL_PORT || 3306)
const user = process.env.ANALYTICS_DDL_USER || 'root'
const password = process.env.ANALYTICS_DDL_PASSWORD || 'rootpassword'
const runId = `${Date.now()}_${process.pid}`
const freshDatabase = `cdkt_analytics_ddl_${runId}_fresh`
const partialDatabase = `cdkt_analytics_ddl_${runId}_partial`

function assertDisposableDatabase(database: string) {
  assert.match(database, /^cdkt_analytics_ddl_\d+_\d+_(fresh|partial)$/)
  assert.notEqual(database, 'cdkt_admin')
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

async function assertRealtimeShape(db: Connection, database: string) {
  const requiredColumns = [
    ...realtimeAnalyticsRequiredColumnMigrations.map(({ table, column }) => [table, column] as const),
    ...realtimeAnalyticsOptionalColumns.map(([table, column]) => [table, column] as const),
  ]
  for (const [table, column] of requiredColumns) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [database, table, column],
    )
    assert.equal(rows.length, 1, `${table}.${column} must exist`)
    if (realtimeAnalyticsRequiredColumnMigrations.some(item => item.table === table && item.column === column)) {
      assert.equal(rows[0]!.IS_NULLABLE, 'NO', `${table}.${column} must converge to NOT NULL`)
    }
  }
  for (const [table, indexName] of realtimeAnalyticsIndexMigrations) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX`,
      [database, table, indexName],
    )
    assert.ok(rows.length > 0, `${table}.${indexName} must exist`)
    assert.equal(rows[0]!.COLUMN_NAME, 'bucket_start', `${table}.${indexName} must be time-first`)
  }
}

test('realtime analytics DDL converges fresh and partially populated MySQL fixtures idempotently', { skip: !enabled, timeout: 120_000 }, async () => {
  assertDisposableDatabase(freshDatabase)
  assertDisposableDatabase(partialDatabase)

  await initialize(freshDatabase)
  await initialize(freshDatabase)
  const fresh = await connection(freshDatabase)
  try {
    await assertRealtimeShape(fresh, freshDatabase)
  } finally {
    await fresh.end()
  }

  const server = await connection()
  try {
    await server.query(`CREATE DATABASE \`${partialDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  } finally {
    await server.end()
  }

  const partial = await connection(partialDatabase)
  try {
    await partial.query('CREATE TABLE analytics_live_minute_buckets (legacy_marker VARCHAR(32) NULL) ENGINE=InnoDB')
    await partial.query("INSERT INTO analytics_live_minute_buckets (legacy_marker) VALUES ('keep-live')")
    await partial.query('CREATE TABLE analytics_live_deduplication (legacy_marker VARCHAR(32) NULL) ENGINE=InnoDB')
    await partial.query("INSERT INTO analytics_live_deduplication (legacy_marker) VALUES ('keep-dedup')")
    await partial.query('CREATE TABLE analytics_noc_minute_aggregates (legacy_marker VARCHAR(32) NULL) ENGINE=InnoDB')
    await partial.query("INSERT INTO analytics_noc_minute_aggregates (legacy_marker) VALUES ('keep-noc')")
  } finally {
    await partial.end()
  }

  await initialize(partialDatabase)
  await initialize(partialDatabase)
  const converged = await connection(partialDatabase)
  try {
    await assertRealtimeShape(converged, partialDatabase)
    for (const [table, marker] of [
      ['analytics_live_minute_buckets', 'keep-live'],
      ['analytics_live_deduplication', 'keep-dedup'],
      ['analytics_noc_minute_aggregates', 'keep-noc'],
    ] as const) {
      const [rows] = await converged.query<RowDataPacket[]>(`SELECT legacy_marker FROM \`${table}\``)
      assert.deepEqual(rows.map(row => row.legacy_marker), [marker], `${table} must preserve its existing row`)
    }
  } finally {
    await converged.end()
  }
})
