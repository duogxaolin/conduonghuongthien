import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `PUT /api/admin/settings/retention` (server/api/admin/settings/retention.put.ts)
 * — save the policy that decides what the purge deletes, and how soon.
 *
 * The invariants:
 *   - it takes `settings.update`; `settings.read` (+ create/delete) writes nothing;
 *   - every field is validated before anything is written: one bad value in a body
 *     of good ones leaves the stored policy exactly as it was;
 *   - only the retention keys are written, in the `retention` group — a body that
 *     also carries other settings names (`site_name`, a raw `retention_*` key)
 *     cannot reach them;
 *   - a saved value is the one the purge will use (source `database`), updated in
 *     place on a second save;
 *   - the change is audited with the values before and after, against the actor.
 *
 * FINDING-R3-1 (pinned, not fixed): the save and its audit line are two separate
 * writes on the pool, so a failed audit leaves a changed deletion policy with no
 * record of who changed it.
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL (including the
 * `ON DUPLICATE KEY UPDATE` upsert) on SQLite (`_sqlite-mysql-db.ts`).
 */

process.env.JWT_SECRET = 'retention-policy-save-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT
for (const name of ['ACTIVITY_LOG_RETENTION_DAYS', 'SUBMISSION_RETENTION_DAYS', 'CHAT_SESSION_RETENTION_DAYS', 'READER_ACCOUNT_RETENTION_DAYS', 'LIVESTREAM_SESSION_RETENTION_DAYS', 'RETENTION_AUTO_ENABLED', 'RETENTION_RUN_HOUR']) {
  delete process.env[name]
}

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

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const savePolicy = (await import('../server/api/admin/settings/retention.put')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')
const { DATA_RETENTION_DEFAULTS } = await import('../server/utils/data-retention-config')

const server = await startHandlerServer([{ method: 'put', path: '/api/admin/settings/retention', handler: savePolicy }], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const EDITOR: Account = { id: 4, username: 'vanhanh', roleId: 3, roleName: 'Vận hành' }
const READER: Account = { id: 5, username: 'xemcauhinh', roleId: 4, roleName: 'Xem cấu hình' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const save = (body: unknown, account = EDITOR) =>
  server.request('PUT', '/api/admin/settings/retention', { cookie: cookieFor(account), body })

const stored = () => Object.fromEntries(harness.rows(settings).map(row => [row.key, row.value]))
const groups = () => Object.fromEntries(harness.rows(settings).map(row => [row.key, row.group]))
const snapshot = () => ({ settings: stored(), audit: harness.rows(activityLogs).length })

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([
    { id: EDITOR.roleId, name: EDITOR.roleName, isSystem: false },
    { id: READER.roleId, name: READER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: EDITOR.roleId, resource: 'settings', canRead: true, canUpdate: true },
    { roleId: READER.roleId, resource: 'settings', canRead: true, canCreate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([EDITOR, READER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(settings).values([
    { key: 'site_name', value: 'Con Đường Hướng Thiện', group: 'general' },
    { key: 'retention_activity_log_days', value: '365', type: 'string', group: 'retention' },
  ])
})

test('without settings.update nothing is written: no session → 401, read/create/delete → 403', async () => {
  const before = snapshot()
  assert.equal((await server.request('PUT', '/api/admin/settings/retention', { body: { activityLogDays: 30 } })).status, 401)
  assert.equal((await save({ activityLogDays: 30 }, READER)).status, 403)
  assert.deepEqual(snapshot(), before)
})

test('one bad value in a body of good ones → 400 and the stored policy is exactly as it was', async () => {
  const before = snapshot()
  const good = { autoEnabled: false, runHour: 2, submissionDays: 730, chatSessionMaxRows: 50_000 }
  for (const bad of [
    { activityLogDays: 10 },          // under the 30-day floor
    { activityLogDays: 4000 },        // over the ten-year ceiling
    { readerAccountDays: -1 },
    { livestreamSessionDays: 1.5 },
    { runHour: 24 },
    { autoEnabled: 'yes' },           // a string is not a switch
    { submissionMaxRows: 999 },       // a cap below the capacity floor
    { activityLogMaxRows: 'lots' },
  ]) {
    const response = await save({ ...good, ...bad })
    assert.equal(response.status, 400, JSON.stringify(bad))
    assert.deepEqual(snapshot(), before, JSON.stringify(bad))
  }
  assert.equal((await save([{ activityLogDays: 30 }])).status, 400)
  assert.equal((await save({})).status, 400)
  assert.equal((await save({ unrelated: 1 })).status, 400)
  assert.deepEqual(snapshot(), before)
})

test('a valid policy is saved in the retention group, updated in place, and read back from the database', async () => {
  const response = await save({ autoEnabled: false, runHour: 2, activityLogDays: 90, submissionDays: 0, chatSessionMaxRows: 50_000 })
  assert.equal(response.status, 200)
  assert.deepEqual(stored(), {
    site_name: 'Con Đường Hướng Thiện',
    retention_auto_enabled: '0',
    retention_run_hour: '2',
    retention_activity_log_days: '90',
    retention_submission_days: '0',
    retention_chat_session_max_rows: '50000',
  })
  assert.equal(harness.rows(settings).length, 6, 'the existing key is updated, not duplicated')
  for (const [key, group] of Object.entries(groups())) {
    if (key.startsWith('retention_')) assert.equal(group, 'retention', key)
  }

  const saved = response.body.policy as { autoEnabled: boolean, runHour: number, scopes: Array<Record<string, unknown>> }
  assert.equal(saved.autoEnabled, false)
  assert.equal(saved.runHour, 2)
  const scope = (name: string) => saved.scopes.find(entry => entry.scope === name)!
  assert.deepEqual([scope('activity_logs').days, scope('activity_logs').daysSource], [90, 'database'])
  assert.deepEqual([scope('submissions').days, scope('submissions').daysSource], [0, 'database'])
  assert.deepEqual([scope('chat_sessions').maxRows, scope('chat_sessions').maxRowsSource], [50_000, 'database'])
  assert.deepEqual([scope('reader_accounts').days, scope('reader_accounts').daysSource], [DATA_RETENTION_DEFAULTS.readerAccountDays, 'default'])
})

test('only retention keys are written: other settings names in the body are inert', async () => {
  const response = await save({ activityLogDays: 400, site_name: 'Bị chiếm', retention_activity_log_days: '30', jwtSecret: 'x' })
  assert.equal(response.status, 200)
  assert.equal(stored().site_name, 'Con Đường Hướng Thiện')
  assert.equal(stored().retention_activity_log_days, '400')
  assert.equal(stored().jwtSecret, undefined)
  const scopes = (response.body.policy as { scopes: Array<{ scope: string, days: number }> }).scopes
  assert.equal(scopes.find(scope => scope.scope === 'activity_logs')!.days, 400)
})

test('the change is audited against the actor with the values before and after', async () => {
  assert.equal((await save({ activityLogDays: 30, runHour: 5 })).status, 200)
  const audit = harness.rows(activityLogs)
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.userId, EDITOR.id)
  assert.equal(audit[0]!.action, 'update')
  assert.equal(audit[0]!.resource, 'data_retention')
  const meta = audit[0]!.meta as { keysUpdated: string[], before: { runHour: number, scopes: Array<{ scope: string, days: number }> }, after: { runHour: number, scopes: Array<{ scope: string, days: number }> } }
  assert.deepEqual(meta.keysUpdated.sort(), ['retention_activity_log_days', 'retention_run_hour'])
  assert.equal(meta.before.scopes.find(scope => scope.scope === 'activity_logs')!.days, 365)
  assert.equal(meta.after.scopes.find(scope => scope.scope === 'activity_logs')!.days, 30)
  assert.equal(meta.before.runHour, 3)
  assert.equal(meta.after.runHour, 5)
})

/**
 * FINDING-R3-1 — severity medium, NOT fixed (pinned as it behaves today).
 *
 * `saveRetentionPolicy` writes each key on the pool, and the handler then writes
 * the audit line on the pool — no transaction (CLAUDE.md: a write and its
 * `activity_logs` row commit together). When the audit insert fails, the request
 * is a 500 but the shortened window is already stored and the next purge uses it:
 * a change to what gets deleted, with no record of who made it. The audit-atomicity
 * guard does not see it (it only asks files that write directly — noted in
 * `tests/reader-audit-atomicity.test.ts`). The fix is not a one-liner:
 * `saveRetentionPolicy` must take the transaction handle, and the handler's
 * "after" snapshot reads through `getDb()`, which on MySQL would not see the
 * uncommitted values. When it is fixed this test turns red: flip the two
 * assertions marked below (policy unchanged, still no audit).
 */
test('FINDING-R3-1 (medium, pinned): an audit failure still leaves the changed policy in force', async () => {
  harness.failNext(/^insert into `activity_logs`/)
  const response = await save({ activityLogDays: 30 })
  assert.equal(response.status, 500)
  assert.equal(stored().retention_activity_log_days, '30') // fixed: '365'
  assert.equal(harness.rows(activityLogs).length, 0)
})
