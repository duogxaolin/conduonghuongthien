import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runDataRetention } from '../server/services/data-retention'
import {
  DATA_RETENTION_DEFAULTS,
  parseRetentionDays,
  resolveDataRetentionConfig,
} from '../server/utils/data-retention-config'

/**
 * activity_logs and submissions were the two tables analytics maintenance never
 * touched, and both hold personal data: caller IP and User-Agent in the audit
 * log's `meta`, and citizens' names, phones, emails and free text in the
 * submissions. These tests pin the purge that now bounds them.
 */

type QueryCall = { sql: string; params: unknown[] }

function fakePool(rowsPerTable: Record<string, number[]> = {}) {
  const calls: QueryCall[] = []
  const queues: Record<string, number[]> = {
    activity_logs: [...(rowsPerTable.activity_logs ?? [0])],
    submissions: [...(rowsPerTable.submissions ?? [0])],
    rate_limit_counters: [...(rowsPerTable.rate_limit_counters ?? [0])],
  }
  let released = 0
  let ended = 0

  const connection = {
    release() { released += 1 },
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params })
      const table = Object.keys(queues).find(name => sql.includes(`DELETE FROM ${name} `))
      if (!table) throw new Error(`unexpected statement: ${sql}`)
      return [{ affectedRows: queues[table].shift() ?? 0 }]
    },
  }
  return {
    calls,
    get released() { return released },
    get ended() { return ended },
    async getConnection() { return connection },
    async end() { ended += 1 },
  }
}

const NOW = new Date('2026-07-26T03:00:00.000Z')

// ─── Configuration ───────────────────────────────────────────────────────────
test('the audit log has a finite default and submissions do not', () => {
  const config = resolveDataRetentionConfig({})
  assert.equal(config.activityLogDays, DATA_RETENTION_DEFAULTS.activityLogDays)
  assert.ok(config.activityLogDays > 0, 'the audit log would still grow forever')
  // Deliberate: a public authority's records schedule decides how long citizen
  // correspondence is kept. Deleting it on a guess would be worse than keeping it.
  assert.equal(config.submissionDays, 0)
})

test('zero disables a window instead of being rejected as out of range', () => {
  assert.equal(parseRetentionDays('X', '0', 365, 30, 3650), 0)
  assert.equal(parseRetentionDays('X', 0, 365, 30, 3650), 0)
})

test('a nonsensical window is refused rather than silently ignored', () => {
  for (const bad of ['-1', 'abc', '1.5', '7', '99999']) {
    assert.throws(() => parseRetentionDays('X', bad, 365, 30, 3650), /X must be/, `accepted: ${bad}`)
  }
})

test('an unset variable falls back without throwing', () => {
  for (const empty of [undefined, null, '']) {
    assert.equal(parseRetentionDays('X', empty, 365, 30, 3650), 365)
  }
})

// ─── Purge behaviour ─────────────────────────────────────────────────────────
test('rows older than the window are deleted from the cutoff, in batches', async () => {
  const pool = fakePool({ activity_logs: [1000, 1000, 250] })
  const result = await runDataRetention({
    now: NOW, activityLogDays: 365, submissionDays: 0, batchSize: 1000, connection: pool as never,
  })

  assert.equal(result.status, 'success')
  const logs = result.tables.find(t => t.table === 'activity_logs')!
  assert.equal(logs.deleted, 2250)
  assert.equal(logs.bounded, false)

  const deletes = pool.calls.filter(c => c.sql.includes('DELETE FROM activity_logs'))
  assert.equal(deletes.length, 3, 'stopped batching before the short batch, or kept going after it')
  // 2026-07-26 minus 365 days.
  assert.equal((deletes[0].params[0] as Date).toISOString(), '2025-07-26T03:00:00.000Z')
  assert.equal(deletes[0].params[1], 1000)
})

test('a disabled window issues no DELETE at all', async () => {
  const pool = fakePool()
  const result = await runDataRetention({ now: NOW, activityLogDays: 0, submissionDays: 0, connection: pool as never })

  const tableCalls = pool.calls.filter(c => !c.sql.includes('rate_limit_counters'))
  assert.equal(tableCalls.length, 0, 'a disabled retention window still touched the table')
  assert.deepEqual(result.tables.map(t => [t.table, t.retentionDays, t.deleted]), [
    ['activity_logs', 0, 0],
    ['submissions', 0, 0],
  ])
})

test('both tables are purged when both windows are set', async () => {
  const pool = fakePool({ activity_logs: [5], submissions: [3] })
  const result = await runDataRetention({
    now: NOW, activityLogDays: 90, submissionDays: 730, batchSize: 1000, connection: pool as never,
  })
  assert.deepEqual(result.tables.map(t => [t.table, t.deleted]), [['activity_logs', 5], ['submissions', 3]])
  const subDelete = pool.calls.find(c => c.sql.includes('DELETE FROM submissions'))!
  assert.equal((subDelete.params[0] as Date).toISOString(), '2024-07-26T03:00:00.000Z')
})

test('hitting the batch ceiling is reported, not passed off as a clean run', async () => {
  const pool = fakePool({ activity_logs: [10, 10, 10] })
  const result = await runDataRetention({
    now: NOW, activityLogDays: 365, submissionDays: 0, batchSize: 10, maxBatches: 3, connection: pool as never,
  })
  assert.equal(result.status, 'warning')
  assert.equal(result.tables[0].bounded, true)
  assert.match(result.message ?? '', /next run/)
})

test('the purge never deletes rows with no timestamp', async () => {
  const pool = fakePool({ activity_logs: [0] })
  await runDataRetention({ now: NOW, activityLogDays: 365, connection: pool as never })
  assert.match(pool.calls[0].sql, /created_at IS NOT NULL AND created_at < \?/)
})

test('the statement is ordered and limited so one run cannot lock the table', async () => {
  const pool = fakePool({ activity_logs: [0] })
  await runDataRetention({ now: NOW, activityLogDays: 365, connection: pool as never })
  assert.match(pool.calls[0].sql, /ORDER BY id LIMIT \?$/)
})

test('lapsed rate-limit buckets are swept in the same nightly pass', async () => {
  // Otherwise the table keeps one row per source IP for the life of the deploy.
  const pool = fakePool({ activity_logs: [0], rate_limit_counters: [42] })
  const result = await runDataRetention({ now: NOW, activityLogDays: 365, connection: pool as never })

  const sweep = pool.calls.find(c => c.sql.includes('rate_limit_counters'))
  assert.ok(sweep, 'expired lockout counters are never removed')
  assert.match(sweep!.sql, /window_expires_at <= \?/)
  assert.equal((sweep!.params[0] as Date).toISOString(), NOW.toISOString())
  assert.equal(result.purgedRateLimits, 42)
})

test('a database failure is reported rather than thrown at cron', async () => {
  const pool = {
    async getConnection() { throw new Error('connection refused') },
    async end() {},
  }
  const result = await runDataRetention({ now: NOW, activityLogDays: 365, connection: pool as never })
  assert.equal(result.status, 'failed')
  assert.match(result.message ?? '', /connection refused/)
})

test('a caller-supplied pool is released but not closed', async () => {
  const pool = fakePool()
  await runDataRetention({ now: NOW, activityLogDays: 365, connection: pool as never })
  assert.equal(pool.released, 1)
  assert.equal(pool.ended, 0, 'closed a pool it did not create')
})

// ─── The cron entrypoint ─────────────────────────────────────────────────────
test('the nightly script runs retention as well as analytics', () => {
  const script = readFileSync(new URL('../scripts/analytics-maintenance.ts', import.meta.url), 'utf8')
  assert.match(script, /runDataRetention/)
  // A stale aggregate must not stop a retention purge that is a policy obligation.
  assert.match(script, /result\.status === 'failed'\s*\?\s*null/)
  assert.match(script, /retention\?\.status === 'failed'/)
})
