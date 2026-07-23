import assert from 'node:assert/strict'
import test from 'node:test'
import { runAnalyticsMaintenance } from '../server/services/analytics-maintenance'

type QueryCall = { sql: string; params: unknown[] }

type FakeConnectionOptions = {
  lockAcquired?: boolean
  aggregationFails?: boolean
  liveDeleteFails?: boolean
  nocInsertFails?: boolean
  liveDeleteRows?: number[]
  dedupDeleteRows?: number[]
  nocDeleteRows?: number[]
}

function fakePool(options: FakeConnectionOptions = {}) {
  const calls: QueryCall[] = []
  const liveDeleteRows = [...(options.liveDeleteRows || [0])]
  const dedupDeleteRows = [...(options.dedupDeleteRows || [0])]
  const nocDeleteRows = [...(options.nocDeleteRows || [0])]
  let transactionQueries = 0

  const nextAffected = (rows: number[]) => ({ affectedRows: rows.shift() ?? 0 })
  const connection = {
    async beginTransaction() { transactionQueries += 1 },
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params })
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
      if (sql.startsWith('DELETE e FROM analytics_page_view_events')) return [{ affectedRows: 0 }]
      if (sql.startsWith('DELETE FROM analytics_')) return [{ affectedRows: 0 }]
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
  assert.equal(pool.calls.some(call => call.sql.startsWith('DELETE e FROM analytics_page_view_events')), false)
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
