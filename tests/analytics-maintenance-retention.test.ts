import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

const logs: Array<Record<string, unknown>> = []
const keep = (entry: Record<string, unknown>) => { logs.push(entry) }
mock.module('../server/utils/logger', {
  namedExports: { logInfo: keep, logWarn: keep, logError: keep },
})
const { runAnalyticsMaintenance } = await import('../server/services/analytics-maintenance')
beforeEach(() => { logs.length = 0 })

type QueryCall = { sql: string; params: unknown[] }

type FakeConnectionOptions = {
  lockAcquired?: boolean
  aggregationFails?: boolean
  liveDeleteFails?: boolean
  nocInsertFails?: boolean
  rawDeleteFails?: boolean
  /** Daily/run tables whose purge throws. */
  failingTables?: string[]
  liveDeleteRows?: number[]
  dedupDeleteRows?: number[]
  nocDeleteRows?: number[]
  rawDeleteRows?: number[]
}

/** The raw-event purge: one table, the aggregated-day check as a subquery on another table. */
const RAW_PURGE_PREFIX = 'DELETE FROM analytics_page_view_events'

/**
 * MySQL rejects `DELETE alias FROM t JOIN u … LIMIT n` with error 1064: the
 * multi-table DELETE syntax takes no LIMIT. The first raw-event purge was exactly
 * that statement, and the error was swallowed, so raw events were never deleted.
 * Every statement this fake sees goes through the same check, so no test here can
 * pass with that statement again.
 */
function mysqlSyntaxError(sql: string): Error | null {
  if (/^DELETE\s+\w+\s+FROM\b/i.test(sql) && /\bLIMIT\b/i.test(sql)) {
    return Object.assign(new Error(`You have an error in your SQL syntax near 'LIMIT ?'`), { code: 'ER_PARSE_ERROR', errno: 1064 })
  }
  return null
}

function fakePool(options: FakeConnectionOptions = {}) {
  const calls: QueryCall[] = []
  const liveDeleteRows = [...(options.liveDeleteRows || [0])]
  const dedupDeleteRows = [...(options.dedupDeleteRows || [0])]
  const nocDeleteRows = [...(options.nocDeleteRows || [0])]
  const rawDeleteRows = [...(options.rawDeleteRows || [0])]
  let transactionQueries = 0

  const nextAffected = (rows: number[]) => ({ affectedRows: rows.shift() ?? 0 })
  const connection = {
    async beginTransaction() { transactionQueries += 1 },
    async commit() {},
    async rollback() {},
    release() {},
    async query(rawSql: string, params: unknown[] = []) {
      const sql = rawSql.trim()
      calls.push({ sql, params })
      const syntax = mysqlSyntaxError(sql)
      if (syntax) throw syntax
      if (sql.includes('GET_LOCK')) return [[{ acquired: options.lockAcquired === false ? 0 : 1 }]]
      if (sql.includes('RELEASE_LOCK')) return [[]]
      if (sql.startsWith('SELECT path, visitor_token')) {
        if (options.aggregationFails) throw new Error('fixture aggregation failure')
        return [[]]
      }
      if (sql.includes('SELECT MAX(day)')) return [[{ last_day: '2026-07-21' }]]
      if (sql.startsWith('DELETE FROM analytics_live_minute_buckets')) {
        if (options.liveDeleteFails) throw new Error('fixture live purge failure')
        return [nextAffected(liveDeleteRows)]
      }
      if (sql.startsWith('DELETE FROM analytics_live_deduplication')) return [nextAffected(dedupDeleteRows)]
      if (sql.startsWith('DELETE FROM analytics_noc_minute_aggregates')) return [nextAffected(nocDeleteRows)]
      if (sql.startsWith(RAW_PURGE_PREFIX)) {
        if (options.rawDeleteFails) throw Object.assign(new Error('fixture raw purge failure'), { code: 'ER_LOCK_WAIT_TIMEOUT' })
        return [nextAffected(rawDeleteRows)]
      }
      if (sql.startsWith('DELETE FROM analytics_')) {
        const table = /^DELETE FROM (\w+)/.exec(sql)?.[1] ?? ''
        // Only the retention purge (`day < ?`), not aggregation's own `day = ?` rewrite.
        if (options.failingTables?.includes(table) && /WHERE day < \?/.test(sql)) {
          throw Object.assign(new Error(`fixture ${table} purge failure`), { code: 'ER_LOCK_DEADLOCK' })
        }
        return [{ affectedRows: 0 }]
      }
      if (sql.startsWith('INSERT INTO analytics_noc_minute_aggregates')) {
        if (options.nocInsertFails) throw new Error('fixture NOC persistence failure')
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('SELECT COUNT(*)')) return [[{ total_users: 0, active_users: 0 }]]
      return [{ affectedRows: 1 }]
    },
  }
  return {
    calls,
    get transactionQueries() { return transactionQueries },
    async getConnection() { return connection },
    async end() {},
  }
}

test('purges expired live buckets, dedup rows, and NOC rows with UTC boundaries', async () => {
  const pool = fakePool({ liveDeleteRows: [2, 0], dedupDeleteRows: [3, 0], nocDeleteRows: [4, 0] })
  const result = await runAnalyticsMaintenance({
    connection: pool as never,
    now: new Date('2026-07-22T12:34:56.789Z'),
    catchUpDays: 1,
    liveRetentionHours: 24,
    nocRetentionDays: 7,
    maxPurgeBatches: 4,
    liveBatchSize: 10,
  })

  assert.equal(result.purgedLiveBuckets, 2)
  assert.equal(result.purgedDedupRows, 3)
  assert.equal(result.purgedNocRows, 4)
  const liveDelete = pool.calls.find(call => call.sql.startsWith('DELETE FROM analytics_live_minute_buckets'))
  const nocDelete = pool.calls.find(call => call.sql.startsWith('DELETE FROM analytics_noc_minute_aggregates'))
  assert.equal((liveDelete?.params[0] as Date).toISOString(), '2026-07-21T12:34:00.000Z')
  assert.equal((nocDelete?.params[0] as Date).toISOString(), '2026-07-15T12:34:56.789Z')
  assert.equal((liveDelete?.params[0] as Date).getUTCSeconds(), 0)
  assert.equal((liveDelete?.params[0] as Date).getUTCMilliseconds(), 0)
  assert.equal((nocDelete?.params[0] as Date).getUTCDate(), 15)
})

test('keeps raw-event deletion disabled when daily aggregation fails', async () => {
  const pool = fakePool({ aggregationFails: true, liveDeleteRows: [1, 0], dedupDeleteRows: [1, 0], nocDeleteRows: [2, 0] })
  const result = await runAnalyticsMaintenance({
    connection: pool as never,
    now: new Date('2026-07-22T00:00:00.000Z'),
    catchUpDays: 1,
    maxPurgeBatches: 3,
    liveBatchSize: 5,
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.purgedRaw, 0)
  assert.equal(result.purgedAggregates, 0)
  assert.equal(result.purgedLiveBuckets, 0)
  assert.equal(result.purgedDedupRows, 0)
  assert.equal(result.purgedNocRows, 2)
  assert.equal(pool.calls.some(call => call.sql.startsWith(RAW_PURGE_PREFIX)), false)
  assert.equal(pool.calls.some(call => /^DELETE\b[\s\S]*analytics_page_view_events/i.test(call.sql)), false, 'no raw-event delete of any shape')
  assert.equal(pool.calls.some(call => call.sql.startsWith('DELETE FROM analytics_daily_')), false)
  assert.equal(pool.calls.some(call => call.sql.startsWith('DELETE FROM analytics_live_minute_buckets')), false)
  assert.equal(pool.calls.some(call => call.sql.startsWith('DELETE FROM analytics_live_deduplication')), false)
  assert.equal(pool.calls.some(call => call.sql.startsWith('DELETE FROM analytics_noc_minute_aggregates')), true)
  const eventTypes = pool.calls
    .filter(call => call.sql.startsWith('INSERT INTO analytics_noc_minute_aggregates'))
    .map(call => call.params[1])
  assert.deepEqual(eventTypes, ['maintenance_failure', 'retention_cleanup'])
})

test('purges NOC independently when live retention fails', async () => {
  const pool = fakePool({ liveDeleteFails: true, nocDeleteRows: [3, 0] })
  const result = await runAnalyticsMaintenance({
    connection: pool as never,
    now: new Date('2026-07-22T00:00:00.000Z'),
    catchUpDays: 1,
    maxPurgeBatches: 3,
  })

  assert.equal(result.status, 'warning')
  assert.equal(result.purgedLiveBuckets, 0)
  assert.equal(result.purgedNocRows, 3)
  assert.equal(pool.calls.some(call => call.sql.startsWith('DELETE FROM analytics_live_deduplication')), true)
  assert.equal(pool.calls.some(call => call.sql.startsWith('DELETE FROM analytics_noc_minute_aggregates')), true)
})

test('rejects retention values outside the fixed live and NOC bounds', async () => {
  await assert.rejects(
    runAnalyticsMaintenance({ connection: fakePool() as never, liveRetentionHours: 23 }),
    /between 24 and 168/,
  )
  await assert.rejects(
    runAnalyticsMaintenance({ connection: fakePool() as never, nocRetentionDays: 91 }),
    /between 7 and 90/,
  )
})

test('bounds purge loops when every batch is full', async () => {
  const maxPurgeBatches = 2
  const pool = fakePool({
    liveDeleteRows: [5, 5, 5],
    dedupDeleteRows: [5, 5, 5],
    nocDeleteRows: [5, 5, 5],
  })
  const result = await runAnalyticsMaintenance({
    connection: pool as never,
    now: new Date('2026-07-22T00:00:00.000Z'),
    catchUpDays: 1,
    maxPurgeBatches,
    liveBatchSize: 5,
    dedupBatchSize: 5,
    nocBatchSize: 5,
  })

  assert.equal(result.status, 'warning')
  assert.equal(pool.calls.filter(call => call.sql.startsWith('DELETE FROM analytics_live_minute_buckets')).length, maxPurgeBatches)
  assert.equal(pool.calls.filter(call => call.sql.startsWith('DELETE FROM analytics_live_deduplication')).length, maxPurgeBatches)
  assert.equal(pool.calls.filter(call => call.sql.startsWith('DELETE FROM analytics_noc_minute_aggregates')).length, maxPurgeBatches)
  const nocCalls = pool.calls.filter(call => call.sql.startsWith('INSERT INTO analytics_noc_minute_aggregates'))
  assert.equal(nocCalls[0].params[1], 'maintenance_warning')
  assert.equal(nocCalls[1].params[1], 'retention_cleanup')
  assert.equal(nocCalls[1].params[4], 'warning')
})

test('records safe aggregated NOC outcomes without recursively logging NOC failures', async () => {
  const pool = fakePool({ lockAcquired: false })
  const result = await runAnalyticsMaintenance({
    connection: pool as never,
    now: new Date('2026-07-22T00:00:00.000Z'),
  })

  assert.equal(result.status, 'locked')
  const nocCalls = pool.calls.filter(call => call.sql.startsWith('INSERT INTO analytics_noc_minute_aggregates'))
  assert.equal(nocCalls.length, 1)
  assert.match(String(nocCalls[0].params[1]), /maintenance_lock_contention/)
  assert.equal(nocCalls.some(call => String(call.params).includes('storage_unavailable')), false)
})

test('does not recursively emit NOC when NOC persistence fails', async () => {
  const pool = fakePool({ nocInsertFails: true })
  const result = await runAnalyticsMaintenance({
    connection: pool as never,
    now: new Date('2026-07-22T00:00:00.000Z'),
    catchUpDays: 1,
  })

  assert.notEqual(result.status, 'failed')
  assert.equal(pool.calls.filter(call => call.sql.startsWith('INSERT INTO analytics_noc_minute_aggregates')).length, 2)
})

 test('returns successful completion and retention NOC outcomes with safe details', async () => {
  const pool = fakePool({ nocDeleteRows: [1, 0] })
  const result = await runAnalyticsMaintenance({
    connection: pool as never,
    now: new Date('2026-07-22T00:00:00.000Z'),
    catchUpDays: 1,
    liveRetentionHours: 48,
    nocRetentionDays: 30,
  })

  assert.equal(result.status, 'success')
  const nocCalls = pool.calls.filter(call => call.sql.startsWith('INSERT INTO analytics_noc_minute_aggregates'))
  assert.equal(nocCalls.length, 2)
  assert.match(String(nocCalls[0].params[1]), /maintenance_complete/)
  assert.match(String(nocCalls[1].params[1]), /retention_cleanup/)
  assert.match(String(nocCalls[1].params[9]), /liveRetentionHours/)
  assert.doesNotMatch(String(nocCalls[1].params[9]), /visitor|token|payload|sql/i)
})

// ─── Raw-event purge and per-step independence (wave1 D8) ─────────────────────

const DAILY_TABLES = ['analytics_daily_dimensions', 'analytics_daily_pages', 'analytics_daily_traffic', 'analytics_daily_admin_users', 'analytics_maintenance_runs']
const retentionLogs = () => logs.filter(entry => entry.event === 'analytics.retention_step_failed')

test('the fake rejects the multi-table DELETE + LIMIT that MySQL rejects (guard self-check)', () => {
  const old = `DELETE e FROM analytics_page_view_events e INNER JOIN analytics_maintenance_runs m
             ON m.day = e.event_day AND m.status = 'complete' WHERE e.occurred_at < ? LIMIT ?`
  assert.match(String(mysqlSyntaxError(old)?.message), /SQL syntax/)
  assert.equal(mysqlSyntaxError('DELETE FROM analytics_daily_pages WHERE day < ? LIMIT ?'), null)
})

test('raw events are purged by a single-table batched DELETE gated on completed aggregation', async () => {
  const pool = fakePool({ rawDeleteRows: [5, 5, 2] })
  const now = new Date('2026-07-22T12:00:00.000Z')
  const result = await runAnalyticsMaintenance({
    connection: pool as never, now, catchUpDays: 1, rawRetentionDays: 14, rawBatchSize: 5, maxPurgeBatches: 10,
  })

  assert.equal(result.status, 'success')
  assert.equal(result.purgedRaw, 12)
  const raw = pool.calls.filter(call => call.sql.startsWith(RAW_PURGE_PREFIX))
  assert.equal(raw.length, 3, 'loops while each batch is full')
  const statement = raw[0]!.sql.replace(/\s+/g, ' ')
  assert.match(statement, /^DELETE FROM analytics_page_view_events WHERE occurred_at < \? AND event_day IN \(SELECT day FROM analytics_maintenance_runs WHERE status = 'complete'\) LIMIT \?$/)
  assert.equal((raw[0]!.params[0] as Date).toISOString(), '2026-07-08T12:00:00.000Z')
  assert.equal(raw[0]!.params[1], 5)
  assert.deepEqual(retentionLogs(), [])
})

test('a failing raw purge does not stop the daily purges, and its log line names the step and error code', async () => {
  const pool = fakePool({ rawDeleteFails: true, nocDeleteRows: [1, 0] })
  const result = await runAnalyticsMaintenance({
    connection: pool as never, now: new Date('2026-07-22T00:00:00.000Z'), catchUpDays: 1, maxPurgeBatches: 3,
  })

  assert.equal(result.status, 'warning')
  for (const table of DAILY_TABLES) {
    assert.ok(pool.calls.some(call => call.sql.startsWith(`DELETE FROM ${table} `)), `${table} was not purged after the raw purge failed`)
  }
  assert.ok(pool.calls.some(call => call.sql.startsWith('DELETE FROM analytics_live_minute_buckets')))
  assert.equal(result.purgedNocRows, 1)
  assert.deepEqual(retentionLogs().map(({ step, code }) => ({ step, code })), [{ step: 'raw_events', code: 'ER_LOCK_WAIT_TIMEOUT' }])
})

test('each daily table purge runs on its own: one failure is logged, the others still run', async () => {
  const pool = fakePool({ failingTables: ['analytics_daily_pages'] })
  const result = await runAnalyticsMaintenance({
    connection: pool as never, now: new Date('2026-07-22T00:00:00.000Z'), catchUpDays: 1, maxPurgeBatches: 3,
  })

  assert.equal(result.status, 'warning')
  for (const table of DAILY_TABLES) {
    assert.ok(pool.calls.some(call => call.sql.startsWith(`DELETE FROM ${table} `)), `${table} purge never ran`)
  }
  assert.deepEqual(retentionLogs().map(({ step, code }) => ({ step, code })), [{ step: 'analytics_daily_pages', code: 'ER_LOCK_DEADLOCK' }])
})

test('live, dedup and NOC purge failures are logged with their step too', async () => {
  const pool = fakePool({ liveDeleteFails: true })
  await runAnalyticsMaintenance({ connection: pool as never, now: new Date('2026-07-22T00:00:00.000Z'), catchUpDays: 1, maxPurgeBatches: 3 })
  assert.deepEqual(retentionLogs().map(({ step }) => step), ['live_buckets'])
  // An error without a driver code still yields a stable, non-empty code.
  assert.equal(typeof retentionLogs()[0]!.code, 'string')
  assert.notEqual(retentionLogs()[0]!.code, '')
})
