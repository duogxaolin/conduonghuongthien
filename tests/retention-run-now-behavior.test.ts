import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `POST /api/admin/settings/retention-run` (server/api/admin/settings/retention-run.post.ts)
 * — run the retention purge now. It deletes rows, so:
 *   - it takes `settings.update`; without it the purge is never started;
 *   - it needs an explicit `{ confirm: true }` — a missing body, `"true"`, `1`
 *     or a stray `{}` start nothing;
 *   - it always asks for a FORCED, `manual` pass and nothing more: the operator
 *     cannot pass a window, so the configured policy still decides what goes;
 *   - a pass that could not take the lock (another run is going) is a 409 — not a
 *     success with zero deletions — and is not audited as a purge;
 *   - a manual run is ALWAYS attributed: the row naming the officer is written
 *     under the lock before anything is deleted, and if it cannot be written the
 *     pass does not start (FINDING-R3-2, fixed — the only row used to be written
 *     after the purge had committed, so its failure lost the actor);
 *   - what each table lost is a second row after the pass; if that one fails the
 *     purge is still reported as done (`auditFailed: true`), not as a 500.
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite. The
 * purge itself (`runRetentionPass`: a MySQL named lock and raw `DELETE … LIMIT`
 * on its own pool) is the faked boundary — modelled as the real one behaves:
 * `beforePurge` runs only when the lock was taken, before any row goes, and a
 * throw from it stops the pass. That ordering is pinned on the real function in
 * `retention-pass-attribution-behavior.test.ts`; the deletion itself has its own
 * suites (`data-retention.test.ts`, `retention-policy.test.ts`).
 */

process.env.JWT_SECRET = 'retention-run-now-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs])

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

type PassStart = { trigger: string, scopes: Array<{ scope: string, days: number, maxRows: number }> }
type PassOptions = { force?: boolean, trigger?: string, beforePurge?: (start: PassStart) => Promise<void>, [key: string]: unknown }
const purge = {
  calls: [] as PassOptions[],
  outcome: null as unknown,
  /** How many passes actually deleted — distinct from `calls`, which counts attempts. */
  deleted: 0,
  /** activity_logs rows that existed when the pass started deleting. */
  auditRowsAtPurge: -1,
  /** Break the result row (the next audit insert after the pass has run). */
  failResultAudit: false,
}
const TABLES = [
  { table: 'activity_logs', deleted: 120, deletedByAge: 100, deletedByRowCap: 20, bounded: false },
  { table: 'submissions', deleted: 0, deletedByAge: 0, deletedByRowCap: 0, bounded: false },
]
const SCOPES = [{ scope: 'activity_logs', days: 365, maxRows: 0 }, { scope: 'submissions', days: 730, maxRows: 0 }]
mock.module('../server/services/retention-scheduler', {
  namedExports: {
    runRetentionPass: async (options: PassOptions) => {
      purge.calls.push(options)
      const outcome = purge.outcome as { ran: boolean }
      if (!outcome.ran) return outcome
      // Lock held: the hook runs before the first DELETE; a throw propagates and nothing is deleted.
      await options.beforePurge?.({ trigger: options.trigger ?? 'scheduler', scopes: SCOPES })
      purge.auditRowsAtPurge = harness.rows(activityLogs).length
      purge.deleted += 1
      if (purge.failResultAudit) harness.failNext(/^insert into `activity_logs`/)
      return outcome
    },
  },
})

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const runNow = (await import('../server/api/admin/settings/retention-run.post')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'post', path: '/api/admin/settings/retention-run', handler: runNow }], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const OPERATOR: Account = { id: 4, username: 'vanhanh', roleId: 3, roleName: 'Vận hành' }
const READER: Account = { id: 5, username: 'xemcauhinh', roleId: 4, roleName: 'Xem cấu hình' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const run = (body: unknown, account = OPERATOR) =>
  server.request('POST', '/api/admin/settings/retention-run', { cookie: cookieFor(account), body })

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  purge.calls.length = 0
  purge.deleted = 0
  purge.auditRowsAtPurge = -1
  purge.failResultAudit = false
  purge.outcome = { ran: true, result: { status: 'ok', tables: TABLES, message: null } }
  await harness.db.insert(roles).values([
    { id: OPERATOR.roleId, name: OPERATOR.roleName, isSystem: false },
    { id: READER.roleId, name: READER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: OPERATOR.roleId, resource: 'settings', canRead: true, canUpdate: true },
    { roleId: READER.roleId, resource: 'settings', canRead: true, canCreate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([OPERATOR, READER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
})

test('without settings.update the purge is never started: no session → 401, read/create/delete → 403', async () => {
  assert.equal((await server.request('POST', '/api/admin/settings/retention-run', { body: { confirm: true } })).status, 401)
  assert.equal((await run({ confirm: true }, READER)).status, 403)
  assert.deepEqual(purge.calls, [])
  assert.equal(purge.deleted, 0)
  assert.equal(harness.rows(activityLogs).length, 0)
})

test('without an explicit confirm: true nothing starts', async () => {
  for (const body of [undefined, {}, { confirm: 'true' }, { confirm: 1 }, { confirm: false }, [true], 'confirm']) {
    const response = await server.request('POST', '/api/admin/settings/retention-run', { cookie: cookieFor(OPERATOR), body })
    assert.equal(response.status, 400, JSON.stringify(body))
  }
  assert.deepEqual(purge.calls, [])
  assert.equal(harness.rows(activityLogs).length, 0)
})

test('confirmed: exactly one forced manual pass, with no window the caller could widen', async () => {
  const response = await run({ confirm: true, activityLogDays: 1, force: false, trigger: 'cron', maxRows: 1 })
  assert.equal(response.status, 200)
  assert.equal(purge.calls.length, 1)
  const [options] = purge.calls
  assert.deepEqual(Object.keys(options!).sort(), ['beforePurge', 'force', 'trigger'], 'only the switch, the trigger and the attribution hook — no window')
  assert.equal(options!.force, true)
  assert.equal(options!.trigger, 'manual')
  assert.equal(typeof options!.beforePurge, 'function')
  assert.equal(response.body.status, 'ok')
  assert.deepEqual(response.body.tables, TABLES)
  assert.equal(response.body.auditFailed, false)
})

test('a pass that ran is attributed before anything is deleted, then audited with what each table lost', async () => {
  assert.equal((await run({ confirm: true })).status, 200)
  assert.equal(purge.auditRowsAtPurge, 1, 'the row naming the officer existed before the first DELETE')
  const audit = harness.rows(activityLogs)
  assert.equal(audit.length, 2)
  for (const row of audit) {
    assert.equal(row.userId, OPERATOR.id)
    assert.equal(row.action, 'delete')
    assert.equal(row.resource, 'data_retention')
  }
  assert.ok(Number(audit[0]!.id) < Number(audit[1]!.id))
  assert.deepEqual(audit[0]!.meta, { trigger: 'manual', phase: 'started', scopes: SCOPES })
  assert.deepEqual(audit[1]!.meta, {
    trigger: 'manual',
    phase: 'finished',
    status: 'ok',
    tables: [
      { table: 'activity_logs', deleted: 120, byAge: 100, byRowCap: 20 },
      { table: 'submissions', deleted: 0, byAge: 0, byRowCap: 0 },
    ],
  })
})

test('another run holds the lock → 409, not a success with zero deletions, and no purge audit', async () => {
  purge.outcome = { ran: false, reason: 'locked' }
  const response = await run({ confirm: true })
  assert.equal(response.status, 409)
  assert.equal(response.body.ok, undefined)
  assert.equal(purge.calls.length, 1)
  assert.equal(purge.deleted, 0)
  assert.equal(harness.rows(activityLogs).length, 0, 'a run turned away at the lock leaves no row claiming a purge')
})

/**
 * FINDING-R3-2 — severity low, FIXED. It was pinned here as it behaved: the
 * purge ran and committed on its own pool, then the handler wrote its only audit
 * row; if that insert failed the officer saw a 500 for a purge that had deleted
 * rows and nothing recorded who started it. The attribution row is now written
 * under the lock before the first DELETE, fail-closed: no row, no purge. Make the
 * start row best-effort again (swallow its error) and this test is red.
 */
test('FINDING-R3-2 (low, fixed): if the attribution row cannot be written, nothing is deleted', async () => {
  harness.failNext(/^insert into `activity_logs`/)
  const response = await run({ confirm: true })
  assert.equal(response.status, 500)
  assert.match(String(response.body.statusMessage ?? response.body.message), /chưa có bản ghi nào bị xoá/)
  assert.equal(purge.calls.length, 1, 'the pass was attempted')
  assert.equal(purge.deleted, 0, 'and stopped before deleting anything')
  assert.equal(harness.rows(activityLogs).length, 0)
})

test('the result row failing after the purge ran: 200 with auditFailed, and the run is still on record', async () => {
  purge.failResultAudit = true
  const response = await run({ confirm: true })
  assert.equal(response.status, 200, 'rows were deleted — a 500 would read as "nothing happened"')
  assert.equal(response.body.auditFailed, true)
  assert.deepEqual(response.body.tables, TABLES)
  assert.equal(purge.deleted, 1)
  const audit = harness.rows(activityLogs)
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.userId, OPERATOR.id)
  assert.equal((audit[0]!.meta as { phase: string }).phase, 'started')
})
