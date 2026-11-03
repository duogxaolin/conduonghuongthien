import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise'
import { initDb } from '../server/db/init'
import { runAnalyticsMaintenance } from '../server/services/analytics-maintenance'

/**
 * Analytics retention on real MySQL 8 (wave1 D8, spec `analytics-retention`).
 *
 * The raw-event purge used to be `DELETE e FROM … INNER JOIN … LIMIT ?`. MySQL
 * rejects LIMIT on a multi-table DELETE (error 1064), the error was swallowed, and
 * one shared `try` then skipped every daily-table purge too — so nothing was ever
 * purged and the fake-pool unit test, which matched the SQL text, stayed green.
 * Only a real server proves the statements are valid, so this suite runs the whole
 * maintenance pass against a disposable database built by the real `initDb()`.
 */

const enabled = process.env.ANALYTICS_MAINTENANCE_INTEGRATION === '1'
const host = process.env.ANALYTICS_MAINTENANCE_HOST || '127.0.0.1'
const port = Number(process.env.ANALYTICS_MAINTENANCE_PORT || 3306)
const user = process.env.ANALYTICS_MAINTENANCE_USER || 'root'
const password = process.env.ANALYTICS_MAINTENANCE_PASSWORD || 'rootpassword'
const database = `cdkt_analytics_maint_${Date.now()}_${process.pid}`

function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_analytics_maint_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
}

let pool: Pool | null = null
let created = false

after(async () => {
  await pool?.end()
  if (!created) return
  assertDisposableDatabase(database)
  const server = await mysql.createConnection({ host, port, user, password })
  try {
    await server.query(`DROP DATABASE IF EXISTS \`${database}\``)
  } finally {
    await server.end()
  }
})

async function initialize() {
  assertDisposableDatabase(database)
  const previous = {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME,
  }
  Object.assign(process.env, { DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME: database })
  created = true
  try {
    await initDb()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** UTC wall-clock literals, so the fixture does not depend on the runner's TZ. */
async function insertEvents(db: Pool, day: string, occurredAt: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    await db.query(
      'INSERT INTO analytics_page_view_events (occurred_at, event_day, path, visitor_token) VALUES (?, ?, ?, ?)',
      [occurredAt, day, `/tin-tuc/${day}-${i}`, `visitor-${day}-${i}`],
    )
  }
}

async function insertRun(db: Pool, day: string, status: 'complete' | 'failed') {
  await db.query(
    `INSERT INTO analytics_maintenance_runs (day, status, started_at, completed_at, event_count)
     VALUES (?, ?, ?, ?, 0)`,
    [day, status, `${day} 23:00:00`, status === 'complete' ? `${day} 23:01:00` : null],
  )
}

async function eventCountsByDay(db: Pool): Promise<Record<string, number>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT DATE_FORMAT(event_day, '%Y-%m-%d') AS day, COUNT(*) AS n FROM analytics_page_view_events GROUP BY event_day ORDER BY event_day",
  )
  return Object.fromEntries(rows.map(row => [String(row.day), Number(row.n)]))
}

async function days(db: Pool, table: string): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day FROM \`${table}\` ORDER BY day`,
  )
  return rows.map(row => String(row.day))
}

test('maintenance on MySQL 8 purges old aggregated raw events and expired daily rows, and keeps the rest', { skip: !enabled, timeout: 180_000 }, async () => {
  await initialize()
  pool = mysql.createPool({ host, port, user, password, database, connectionLimit: 2, timezone: '+00:00' })
  const db = pool

  // now = 2026-07-22 12:00 UTC. Raw retention 14 days → events before 2026-07-08 12:00
  // are old. Aggregate retention 30 days → daily rows before 2026-06-22 are expired.
  const now = new Date('2026-07-22T12:00:00.000Z')

  // Old + aggregated (complete run) → purged. Six rows with a batch size of 2, so
  // the batched LIMIT loop runs several times.
  await insertEvents(db, '2026-07-01', '2026-07-01 08:00:00', 5)
  await insertRun(db, '2026-07-01', 'complete')
  // Also old + aggregated, on a day whose run row is itself past aggregate
  // retention: the raw purge must run before the run rows are purged.
  await insertEvents(db, '2026-06-01', '2026-06-01 08:00:00', 1)
  await insertRun(db, '2026-06-01', 'complete')
  // Old but NOT aggregated → kept: a failed run, and no run at all.
  await insertEvents(db, '2026-07-02', '2026-07-02 08:00:00', 3)
  await insertRun(db, '2026-07-02', 'failed')
  await insertEvents(db, '2026-07-03', '2026-07-03 08:00:00', 2)
  // Recent → kept, aggregated or not. 2026-07-21 is "yesterday": this pass aggregates it.
  await insertEvents(db, '2026-07-15', '2026-07-15 10:00:00', 1)
  await insertRun(db, '2026-07-15', 'complete')
  await insertEvents(db, '2026-07-21', '2026-07-21 09:00:00', 2)

  // Daily aggregate rows: one expired day, one inside retention, in every table.
  for (const day of ['2026-06-01', '2026-06-30']) {
    await db.query('INSERT INTO analytics_daily_traffic (day, page_views, daily_unique_visitors) VALUES (?, 1, 1)', [day])
    await db.query('INSERT INTO analytics_daily_pages (day, path, page_views, daily_unique_visitors) VALUES (?, ?, 1, 1), (?, ?, 1, 1)', [day, '/a', day, '/b'])
    await db.query("INSERT INTO analytics_daily_dimensions (day, dimension, value, page_views, daily_unique_visitors) VALUES (?, 'device_class', 'mobile', 1, 1)", [day])
    await db.query('INSERT INTO analytics_daily_admin_users (day, total_users, active_users) VALUES (?, 1, 1)', [day])
  }

  const options = {
    connection: db, now, catchUpDays: 1, rawRetentionDays: 14, aggregateRetentionDays: 30,
    rawBatchSize: 2, aggregateBatchSize: 1, maxPurgeBatches: 50, liveRetentionHours: 24, nocRetentionDays: 7,
  }
  const result = await runAnalyticsMaintenance(options)

  assert.equal(result.status, 'success', `maintenance reported ${result.status} — a retention step failed on MySQL`)
  assert.deepEqual(result.processedDays, ['2026-07-21'])
  assert.equal(result.purgedRaw, 6, 'old events of aggregated days are deleted')
  assert.deepEqual(await eventCountsByDay(db), {
    '2026-07-02': 3, // failed run: kept
    '2026-07-03': 2, // no run: kept
    '2026-07-15': 1, // recent
    '2026-07-21': 2, // recent (aggregated by this pass)
  })

  for (const table of ['analytics_daily_traffic', 'analytics_daily_pages', 'analytics_daily_dimensions', 'analytics_daily_admin_users']) {
    const remaining = await days(db, table)
    assert.ok(!remaining.includes('2026-06-01'), `${table} still holds a row past aggregate retention`)
    assert.ok(remaining.includes('2026-06-30'), `${table} lost a row inside aggregate retention`)
    assert.ok(remaining.includes('2026-07-21'), `${table} has no row for the day this pass aggregated`)
  }
  assert.deepEqual(await days(db, 'analytics_maintenance_runs'), ['2026-07-01', '2026-07-02', '2026-07-15', '2026-07-21'])

  // A second pass finds nothing left to purge and still reports success.
  const again = await runAnalyticsMaintenance(options)
  assert.equal(again.status, 'success')
  assert.equal(again.purgedRaw, 0)
  assert.equal(again.purgedAggregates, 0)
})
