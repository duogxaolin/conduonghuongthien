import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * `runRetentionPass({ beforePurge })` (server/services/retention-scheduler.ts) —
 * the hook a manual run uses to put the officer on record before anything is
 * deleted (FINDING-R3-2).
 *
 * The handler suite (`retention-run-now-behavior.test.ts`) fakes this function, so
 * it cannot prove the ordering it relies on. This suite runs the REAL pass — the
 * real named lock (`withNamedLock`), the real `runDataRetention` with its batched
 * DELETEs — against a fake MySQL pool that records every statement, and pins:
 *   - the hook runs with the lock held and before the first DELETE, and is told
 *     the windows the pass is about to apply;
 *   - a throw from the hook stops the pass: no DELETE, no bookkeeping row, the
 *     lock released, the pool closed, the error reaching the caller (a throw
 *     inside runDataRetention would have been turned into a `failed` result);
 *   - a pass turned away at the lock never calls the hook — no attribution row
 *     for a purge that did not start;
 *   - without a hook (scheduler, cron) the pass is what it always was.
 *
 * The policy is the real one, resolved from a `settings` table on SQLite with no
 * retention keys stored: environment unset → code defaults.
 */

for (const name of ['ACTIVITY_LOG_RETENTION_DAYS', 'SUBMISSION_RETENTION_DAYS', 'CHAT_SESSION_RETENTION_DAYS', 'READER_ACCOUNT_RETENTION_DAYS', 'LIVESTREAM_SESSION_RETENTION_DAYS', 'RETENTION_AUTO_ENABLED', 'RETENTION_RUN_HOUR']) {
  delete process.env[name]
}

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { settings, dataRetentionState } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([settings, dataRetentionState])

mock.module('../server/utils/logger', {
  namedExports: { log: () => {}, logInfo: () => {}, logWarn: () => {}, logError: () => {} },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

/** Every statement the pass sends, in order, with the hook's call marked among them. */
const timeline: string[] = []
let lockGranted = 1
let poolsEnded = 0

function fakePool() {
  const connection = {
    release() { timeline.push('release') },
    async query(statement: string) {
      const text = statement.replace(/\s+/g, ' ').trim()
      if (text.startsWith('SELECT GET_LOCK')) { timeline.push('GET_LOCK'); return [[{ acquired: lockGranted }]] }
      if (text.startsWith('SELECT RELEASE_LOCK')) { timeline.push('RELEASE_LOCK'); return [[{ released: 1 }]] }
      const deleted = /^DELETE FROM (\w+)/.exec(text)
      if (deleted) { timeline.push(`DELETE ${deleted[1]}`); return [{ affectedRows: 0 }] }
      if (text.startsWith('SELECT COUNT(*)')) { timeline.push('COUNT'); return [[{ total: 0 }]] }
      if (text.startsWith('INSERT INTO data_retention_state')) { timeline.push('STATE'); return [{ affectedRows: 1 }] }
      throw new Error(`unexpected statement: ${text}`)
    },
  }
  return {
    async getConnection() { return connection },
    async end() { poolsEnded += 1 },
  }
}
mock.module('../server/services/analytics-maintenance', { namedExports: { createAnalyticsPool: fakePool } })

const { runRetentionPass } = await import('../server/services/retention-scheduler')
const { DATA_RETENTION_DEFAULTS } = await import('../server/utils/data-retention-config')

type Start = { trigger: string, scopes: Array<{ scope: string, days: number, maxRows: number }> }

beforeEach(() => {
  harness.reset()
  timeline.length = 0
  lockGranted = 1
  poolsEnded = 0
})

const firstDelete = () => timeline.findIndex(entry => entry.startsWith('DELETE '))

test('the hook runs with the lock held, before the first DELETE, and is told the windows about to apply', async () => {
  const seen: Start[] = []
  const outcome = await runRetentionPass({
    force: true,
    trigger: 'manual',
    beforePurge: async (start) => { timeline.push('HOOK'); seen.push(start) },
  })
  assert.equal(outcome.ran, true)
  const hook = timeline.indexOf('HOOK')
  assert.ok(timeline.indexOf('GET_LOCK') < hook, `the hook ran before the lock was taken: ${timeline.join(' → ')}`)
  assert.ok(firstDelete() > hook, `a DELETE ran before the hook: ${timeline.join(' → ')}`)
  assert.equal(timeline.filter(entry => entry === 'HOOK').length, 1)

  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.trigger, 'manual')
  const days = Object.fromEntries(seen[0]!.scopes.map(scope => [scope.scope, scope.days]))
  assert.deepEqual(days, {
    activity_logs: DATA_RETENTION_DEFAULTS.activityLogDays,
    submissions: DATA_RETENTION_DEFAULTS.submissionDays,
    chat_sessions: DATA_RETENTION_DEFAULTS.chatSessionDays,
    reader_accounts: DATA_RETENTION_DEFAULTS.readerAccountDays,
    livestream_sessions: DATA_RETENTION_DEFAULTS.livestreamSessionDays,
  })
})

test('a throw from the hook stops the pass: nothing deleted, nothing banked, lock released, error to the caller', async () => {
  const refused = new Error('audit insert failed')
  await assert.rejects(
    runRetentionPass({ force: true, trigger: 'manual', beforePurge: async () => { timeline.push('HOOK'); throw refused } }),
    error => error === refused,
  )
  assert.equal(firstDelete(), -1, `rows were deleted without an attribution row: ${timeline.join(' → ')}`)
  assert.ok(!timeline.includes('STATE'), 'the pass banked counts for a purge that never ran')
  assert.ok(timeline.includes('HOOK'))
  assert.ok(timeline.indexOf('RELEASE_LOCK') > timeline.indexOf('HOOK'), 'the lock stays held after the refusal')
  assert.equal(poolsEnded, 1)
})

test('a pass turned away at the lock never calls the hook', async () => {
  lockGranted = 0
  let called = false
  const outcome = await runRetentionPass({ force: true, trigger: 'manual', beforePurge: async () => { called = true } })
  assert.deepEqual(outcome, { ran: false, reason: 'locked' })
  assert.equal(called, false, 'an attribution row would claim a purge that never started')
  assert.equal(firstDelete(), -1)
})

test('without a hook (scheduler, cron) the pass deletes and banks as before', async () => {
  const outcome = await runRetentionPass({ force: true, trigger: 'cron' })
  assert.equal(outcome.ran, true)
  assert.ok(firstDelete() > timeline.indexOf('GET_LOCK'))
  assert.ok(timeline.includes('STATE'))
  assert.equal(timeline.at(-2), 'RELEASE_LOCK')
})
