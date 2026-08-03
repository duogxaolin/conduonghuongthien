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
 * activity_logs, submissions, and chat_sessions are the tables that hold
 * personal data: caller IP and User-Agent in the audit log, citizens' names,
 * phones, emails and free text in the submissions, and conversation content
 * with IPs (and sometimes phone numbers) in the chat sessions.
 * These tests pin the purge that now bounds them.
 */

type QueryCall = { sql: string; params: unknown[] }

/**
 * `rowsPerTable` queues affectedRows per DELETE; `counts` answers the row-cap
 * pass's COUNT(*). Anything the engine issues that is not one of the statements
 * modelled here throws, so a new write path cannot slip in unnoticed.
 */
function fakePool(rowsPerTable: Record<string, number[]> = {}, counts: Record<string, number> = {}) {
  const calls: QueryCall[] = []
  const queues: Record<string, number[]> = {
    activity_logs: [...(rowsPerTable.activity_logs ?? [0])],
    submissions: [...(rowsPerTable.submissions ?? [0])],
    chat_sessions: [...(rowsPerTable.chat_sessions ?? [0])],
    rate_limit_counters: [...(rowsPerTable.rate_limit_counters ?? [0])],
  }
  let released = 0
  let ended = 0

  const connection = {
    release() { released += 1 },
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params })
      const counted = Object.keys(queues).find(name => sql.includes(`COUNT(*) AS total FROM ${name}`))
      if (counted) return [[{ total: counts[counted] ?? 0 }]]
      if (sql.includes('INSERT INTO data_retention_state')) return [{ affectedRows: 1 }]
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
  const result = await runDataRetention({ now: NOW, activityLogDays: 0, submissionDays: 0, chatSessionDays: 0, connection: pool as never })

  const tableCalls = pool.calls.filter(c => !c.sql.includes('rate_limit_counters'))
  assert.equal(tableCalls.length, 0, 'a disabled retention window still touched the table')
  assert.deepEqual(result.tables.map(t => [t.table, t.retentionDays, t.deleted]), [
    ['activity_logs', 0, 0],
    ['submissions', 0, 0],
    ['chat_sessions', 0, 0],
  ])
})

test('both tables are purged when both windows are set', async () => {
  const pool = fakePool({ activity_logs: [5], submissions: [3] })
  const result = await runDataRetention({
    now: NOW, activityLogDays: 90, submissionDays: 730, batchSize: 1000, connection: pool as never,
  })
  assert.deepEqual(result.tables.map(t => [t.table, t.deleted]), [
    ['activity_logs', 5],
    ['submissions', 3],
    ['chat_sessions', 0],
  ])
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

// ─── The row cap ─────────────────────────────────────────────────────────────
test('the row cap trims down to the cap, oldest first, and only the excess', async () => {
  // 12,500 rows against a cap of 10,000 — exactly 2,500 must go, no more.
  const pool = fakePool({ activity_logs: [1000, 1000, 500] }, { activity_logs: 12_500 })
  const result = await runDataRetention({
    now: NOW, activityLogDays: 0, submissionDays: 0,
    activityLogMaxRows: 10_000, batchSize: 1000, connection: pool as never,
  })

  const logs = result.tables.find(t => t.table === 'activity_logs')!
  assert.equal(logs.deletedByRowCap, 2500)
  assert.equal(logs.deletedByAge, 0, 'the age pass ran with days = 0')
  assert.equal(logs.bounded, false)

  const deletes = pool.calls.filter(c => c.sql.includes('DELETE FROM activity_logs'))
  // Oldest first, and no cutoff clause: the cap is about size, not age.
  assert.match(deletes[0].sql, /^DELETE FROM activity_logs ORDER BY id LIMIT \?$/)
  // The last batch is clamped to what is left, so a run cannot overshoot the cap
  // even when the queue would have returned a full batch.
  assert.deepEqual(deletes.map(c => c.params[0]), [1000, 1000, 500])
})

test('a table inside its cap is counted but never deleted from', async () => {
  const pool = fakePool({ activity_logs: [999] }, { activity_logs: 4_000 })
  const result = await runDataRetention({
    now: NOW, activityLogDays: 0, submissionDays: 0,
    activityLogMaxRows: 10_000, connection: pool as never,
  })
  assert.equal(result.tables[0].deleted, 0)
  assert.equal(pool.calls.filter(c => c.sql.startsWith('DELETE FROM activity_logs')).length, 0)
})

test('a cap of 0 disables the condition without counting the table', async () => {
  const pool = fakePool({}, { activity_logs: 9_000_000 })
  await runDataRetention({
    now: NOW, activityLogDays: 0, submissionDays: 0,
    activityLogMaxRows: 0, submissionMaxRows: 0, connection: pool as never,
  })
  assert.equal(pool.calls.filter(c => c.sql.includes('COUNT(*)')).length, 0)
})

test('the two conditions add up and are reported separately', async () => {
  // Age clears 40; the cap then finds 10,050 rows left against a cap of 10,000.
  const pool = fakePool({ activity_logs: [40, 50] }, { activity_logs: 10_050 })
  const result = await runDataRetention({
    now: NOW, activityLogDays: 365, submissionDays: 0,
    activityLogMaxRows: 10_000, batchSize: 1000, connection: pool as never,
  })
  const logs = result.tables[0]
  assert.equal(logs.deletedByAge, 40)
  assert.equal(logs.deletedByRowCap, 50)
  assert.equal(logs.deleted, 90, 'the reported total must be the sum of both conditions')
})

test('the cap is skipped when the age pass is still catching up', async () => {
  // The age pass hit its batch ceiling, so the table is mid-shrink. Counting rows
  // now would measure a table that is still being drained and delete past the cap.
  const pool = fakePool({ activity_logs: [10, 10, 10] }, { activity_logs: 10_000_000 })
  const result = await runDataRetention({
    now: NOW, activityLogDays: 365, submissionDays: 0, activityLogMaxRows: 1_000,
    batchSize: 10, maxBatches: 3, connection: pool as never,
  })
  assert.equal(result.tables[0].bounded, true)
  assert.equal(result.tables[0].deletedByRowCap, 0)
  assert.equal(pool.calls.filter(c => c.sql.includes('COUNT(*)')).length, 0)
})

test('a cap larger than the batch ceiling reports bounded instead of finishing quietly', async () => {
  const pool = fakePool({ activity_logs: [10, 10] }, { activity_logs: 1_000_000 })
  const result = await runDataRetention({
    now: NOW, activityLogDays: 0, submissionDays: 0, activityLogMaxRows: 1_000,
    batchSize: 10, maxBatches: 2, connection: pool as never,
  })
  assert.equal(result.tables[0].bounded, true)
  assert.equal(result.status, 'warning')
})

// ─── Banked counters ─────────────────────────────────────────────────────────
test('the deleted count is banked before the rows are gone, and accumulates', async () => {
  const pool = fakePool({ activity_logs: [7], submissions: [3] })
  await runDataRetention({
    now: NOW, activityLogDays: 365, submissionDays: 730,
    trigger: 'scheduler', connection: pool as never,
  })

  const banked = pool.calls.filter(c => c.sql.includes('INSERT INTO data_retention_state'))
  assert.equal(banked.length, 3, 'one row per purged table')
  // Incremented, not replaced: the lifetime figure is this counter plus the live
  // count, so overwriting it would erase every earlier run.
  assert.match(banked[0].sql, /purged_total = purged_total \+ VALUES\(purged_total\)/)
  assert.deepEqual(banked.map(c => [c.params[0], c.params[1]]), [
    ['activity_logs', 7],
    ['submissions', 3],
    ['chat_sessions', 0],
  ])
  assert.equal(banked[0].params[4], 'scheduler')
  assert.equal(banked[0].params[5], 'success')
})

test('a bounded run banks what it did delete and says it is unfinished', async () => {
  const pool = fakePool({ activity_logs: [10, 10] })
  await runDataRetention({
    now: NOW, activityLogDays: 365, submissionDays: 0,
    batchSize: 10, maxBatches: 2, trigger: 'cron', connection: pool as never,
  })
  const banked = pool.calls.filter(c => c.sql.includes('INSERT INTO data_retention_state'))
  assert.equal(banked[0].params[1], 20, 'the rows are gone; the count has to survive them')
  assert.equal(banked[0].params[5], 'warning')
  assert.equal(banked[0].params[4], 'cron')
})

test('without a trigger the run writes nothing, so bookkeeping is never hidden', async () => {
  const pool = fakePool({ activity_logs: [5] })
  await runDataRetention({ now: NOW, activityLogDays: 365, connection: pool as never })
  assert.equal(pool.calls.filter(c => c.sql.includes('data_retention_state')).length, 0)
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
  // Goes through the scheduler so the cron path obeys the same stored policy and
  // the same lock as the in-process runner — two entrypoints, one set of rules.
  assert.match(script, /runRetentionPass/)
  // Cron's schedule is its crontab line, so `runHour` is irrelevant to it. The
  // on/off switch is not: an operator who turns auto-cleanup off must stop
  // deletions everywhere, or the switch is a lie.
  assert.match(script, /ignoreSchedule: true/)
  assert.match(script, /trigger: 'cron'/)
  assert.doesNotMatch(script, /force: true/)
  // A stale aggregate must not stop a retention purge that is a policy obligation.
  assert.match(script, /result\.status === 'failed'\s*\?\s*null/)
  assert.match(script, /retention\.result\.status === 'failed'/)
  // An open pool keeps the event loop alive, so the cron job would print its
  // result and then hang instead of exiting.
  assert.match(script, /closeDb\(\)/)
})

// ─── chat_sessions scope ──────────────────────────────────────────────────────
test('chat sessions older than the window are deleted, non-zero days coverage', async () => {
  const pool = fakePool({ chat_sessions: [100, 50] })
  const result = await runDataRetention({
    now: NOW, activityLogDays: 0, submissionDays: 0, chatSessionDays: 90,
    batchSize: 100, connection: pool as never,
  })

  assert.equal(result.status, 'success')
  const sessions = result.tables.find(t => t.table === 'chat_sessions')!
  assert.equal(sessions.deleted, 150)
  assert.equal(sessions.bounded, false)

  const deletes = pool.calls.filter(c => c.sql.includes('DELETE FROM chat_sessions'))
  assert.equal(deletes.length, 2)
  // 2026-07-26 minus 90 days.
  assert.equal((deletes[0].params[0] as Date).toISOString(), '2026-04-27T03:00:00.000Z')
})

test('chat sessions purge uses last_message_at, not created_at', async () => {
  // If the service used created_at, it would throw ER_BAD_FIELD_ERROR at runtime
  // because chat_sessions has started_at/last_message_at, not created_at.
  const pool = fakePool({ chat_sessions: [0] })
  await runDataRetention({ now: NOW, activityLogDays: 0, submissionDays: 0, chatSessionDays: 90, connection: pool as never })
  const del = pool.calls.find(c => c.sql.includes('DELETE FROM chat_sessions'))!
  assert.match(del.sql, /last_message_at IS NOT NULL AND last_message_at < \?/)
  // Not created_at — that column does not exist on this table.
  assert.doesNotMatch(del.sql, /created_at/)
})

test('chat sessions age purge orders by last_message_at, not id (id is UUID, lexicographic noise)', async () => {
  const pool = fakePool({ chat_sessions: [0] })
  await runDataRetention({ now: NOW, activityLogDays: 0, submissionDays: 0, chatSessionDays: 90, connection: pool as never })
  const del = pool.calls.find(c => c.sql.includes('DELETE FROM chat_sessions'))!
  assert.match(del.sql, /ORDER BY last_message_at LIMIT \?$/)
  assert.doesNotMatch(del.sql, /ORDER BY id/)
})

test('chat sessions row cap also orders by last_message_at', async () => {
  const pool = fakePool({ chat_sessions: [100] }, { chat_sessions: 1_100 })
  await runDataRetention({
    now: NOW, activityLogDays: 0, submissionDays: 0, chatSessionDays: 0,
    chatSessionMaxRows: 1_000, batchSize: 1000, connection: pool as never,
  })
  const capDelete = pool.calls.find(c => c.sql.includes('DELETE FROM chat_sessions'))!
  assert.match(capDelete.sql, /^DELETE FROM chat_sessions ORDER BY last_message_at LIMIT \?$/)
})
