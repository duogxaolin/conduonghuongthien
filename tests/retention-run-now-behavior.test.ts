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
 *   - a pass that ran is audited against the actor with what each table lost.
 *
 * FINDING-R3-2 (pinned, not fixed): the purge has committed before the audit line
 * is written, on another connection; if that insert fails the caller sees a 500
 * for a purge that did happen, and the actor is recorded nowhere.
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite. The
 * purge itself (`runRetentionPass`: a MySQL named lock and raw `DELETE … LIMIT`
 * on its own pool) is the faked boundary — its behaviour has its own suites
 * (`data-retention.test.ts`, `retention-policy.test.ts`).
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

type PassOptions = { force?: boolean, trigger?: string, [key: string]: unknown }
const purge = {
  calls: [] as PassOptions[],
  outcome: null as unknown,
}
const TABLES = [
  { table: 'activity_logs', deleted: 120, deletedByAge: 100, deletedByRowCap: 20, bounded: false },
  { table: 'submissions', deleted: 0, deletedByAge: 0, deletedByRowCap: 0, bounded: false },
]
mock.module('../server/services/retention-scheduler', {
  namedExports: {
    runRetentionPass: async (options: PassOptions) => {
      purge.calls.push(options)
      return purge.outcome
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
  assert.deepEqual(purge.calls, [{ force: true, trigger: 'manual' }])
  assert.equal(response.body.status, 'ok')
  assert.deepEqual(response.body.tables, TABLES)
})

test('a pass that ran is audited against the actor with what each table lost', async () => {
  assert.equal((await run({ confirm: true })).status, 200)
  const audit = harness.rows(activityLogs)
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.userId, OPERATOR.id)
  assert.equal(audit[0]!.action, 'delete')
  assert.equal(audit[0]!.resource, 'data_retention')
  assert.deepEqual(audit[0]!.meta, {
    trigger: 'manual',
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
  assert.equal(harness.rows(activityLogs).length, 0)
})

/**
 * FINDING-R3-2 — severity low, NOT fixed (pinned as it behaves today).
 *
 * The purge runs on its own pool and has committed before this handler writes the
 * audit line; the two cannot share a transaction as written. If the insert fails,
 * the officer sees a 500 for a purge that did delete rows, and no row says who
 * started it (`data_retention_state` still banks the counts and `lastTrigger:
 * 'manual'`, so the deletion itself is not invisible — hence low). A fix would
 * write an "about to purge" audit line first, or pass the actor into the pass.
 */
test('FINDING-R3-2 (low, pinned): when the audit insert fails, the purge has already happened and the actor is lost', async () => {
  harness.failNext(/^insert into `activity_logs`/)
  const response = await run({ confirm: true })
  assert.equal(response.status, 500)
  assert.equal(purge.calls.length, 1) // the purge ran
  assert.equal(harness.rows(activityLogs).length, 0)
})
