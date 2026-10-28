import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'
import { drizzle } from 'drizzle-orm/mysql-proxy'

/**
 * The two retention status pages — `GET /api/admin/settings/retention`
 * (every scope) and `GET /api/admin/activity-logs/retention` (the audit log) —
 * and the one thing they must never get wrong: they report "overdue" rows
 * against the SAME column the purge in `server/services/data-retention.ts`
 * deletes on, with the SAME window. If the page aged chat sessions by
 * `started_at` while the purge measured `last_message_at`, it would report rows
 * as overdue that the next run correctly keeps, and a working purge would read
 * as a broken one (the handler's own comment).
 *
 * So this suite runs BOTH sides for real and compares what they send to MySQL:
 *   - the handlers, in a real h3 app behind the real `admin-auth` middleware;
 *     settings, roles and `data_retention_state` are read with Drizzle's SQL on
 *     SQLite (`_sqlite-mysql-db.ts`); the per-table aggregate — `NOW() - INTERVAL
 *     n DAY`, which SQLite cannot run and the harness refuses to approximate — is
 *     recorded as compiled MySQL and answered with canned counts;
 *   - `runDataRetention` with a recording connection, as `data-retention.test.ts`
 *     drives it.
 *
 * Also pinned: the window and row cap are the stored policy's (a scope at 0 days
 * asks no age question at all), the arithmetic of the page (row-cap excess,
 * lifetime = live + banked purged rows), the activity-log page's two alarms
 * (`purgeDisabled`, `purgeOverdue`), and the permissions: `settings.read` for the
 * policy page, `users.read` for the audit-log page.
 */

process.env.JWT_SECRET = 'retention-status-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT
for (const name of ['ACTIVITY_LOG_RETENTION_DAYS', 'SUBMISSION_RETENTION_DAYS', 'CHAT_SESSION_RETENTION_DAYS', 'READER_ACCOUNT_RETENTION_DAYS', 'LIVESTREAM_SESSION_RETENTION_DAYS', 'RETENTION_AUTO_ENABLED', 'RETENTION_RUN_HOUR']) {
  delete process.env[name]
}

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, dataRetentionState } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, dataRetentionState])

// ─── The per-table aggregate: recorded as compiled MySQL, answered from canned counts ──
type Canned = { total: number, oldest: string | null, newest?: string | null, overdue: number }
let canned: Record<string, Canned> = {}
const aggregates: string[] = []
const aggregateDb = drizzle(async (sql) => {
  aggregates.push(sql)
  const table = /\bfrom `([a-z_]+)`/.exec(sql)?.[1] ?? ''
  const row = canned[table] ?? { total: 0, oldest: null, newest: null, overdue: 0 }
  // `sql\`0\`` when the age window is off: MySQL answers the literal, not a count.
  const overdue = sql.includes('SUM(CASE') ? row.overdue : 0
  const values = sql.includes('MAX(') ? [row.total, row.oldest, row.newest ?? null, overdue] : [row.total, row.oldest, overdue]
  return { rows: [values] }
})
/** `getDb()`: the aggregate selects (they ask for `total`) go to the recorder, everything else to SQLite. */
const routedDb = new Proxy(harness.db, {
  get(target, property) {
    if (property === 'select') {
      return (fields?: Record<string, unknown>) => (fields && 'total' in fields ? aggregateDb.select(fields as never) : target.select(fields as never))
    }
    return Reflect.get(target, property)
  },
})

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => routedDb, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const policyStatus = (await import('../server/api/admin/settings/retention.get')).default
const auditLogStatus = (await import('../server/api/admin/activity-logs/retention.get')).default
const { runDataRetention } = await import('../server/services/data-retention')
const { RETENTION_SCOPES, RETENTION_DEFAULTS } = await import('../server/services/retention-policy')
const { signToken } = await import('../server/utils/auth')
const mfaPolicy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/settings/retention', handler: policyStatus },
  { method: 'get', path: '/api/admin/activity-logs/retention', handler: auditLogStatus },
], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const SETTINGS_READER: Account = { id: 4, username: 'xemcauhinh', roleId: 3, roleName: 'Xem cấu hình' }
const USERS_READER: Account = { id: 5, username: 'xemnhatky', roleId: 4, roleName: 'Xem nhật ký' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const get = (path: string, account: Account) => server.request('GET', path, { cookie: cookieFor(account) })

const DAYS: Record<string, string> = {
  retention_activity_log_days: '365',
  retention_submission_days: '730',
  retention_chat_session_days: '90',
  retention_reader_account_days: '400',
  retention_livestream_session_days: '180',
}

beforeEach(async () => {
  harness.reset()
  mfaPolicy.clearMfaPolicyCache()
  mfaPolicy.clearMfaFactorCache()
  aggregates.length = 0
  canned = {}
  await harness.db.insert(roles).values([
    { id: SETTINGS_READER.roleId, name: SETTINGS_READER.roleName, isSystem: false },
    { id: USERS_READER.roleId, name: USERS_READER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: SETTINGS_READER.roleId, resource: 'settings', canRead: true },
    { roleId: USERS_READER.roleId, resource: 'users', canRead: true },
  ])
  await harness.db.insert(users).values([SETTINGS_READER, USERS_READER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(settings).values(Object.entries(DAYS).map(([key, value]) => ({ key, value, group: 'retention' })))
})

/** `{ table → column }` that each aggregate ages rows against, and its window in days. */
function pageAgeQuestions(): Map<string, { min: string, overdue: string | null, days: number | null }> {
  const out = new Map<string, { min: string, overdue: string | null, days: number | null }>()
  for (const sql of aggregates) {
    const table = /\bfrom `([a-z_]+)`/.exec(sql)![1]!
    // One table per statement, so Drizzle writes bare column names.
    const min = /MIN\(`([a-z_]+)`\)/.exec(sql)
    assert.ok(min, sql)
    const overdue = /SUM\(CASE WHEN `([a-z_]+)` < \(NOW\(\) - INTERVAL (\d+) DAY\)/.exec(sql)
    out.set(table, { min: min[1]!, overdue: overdue?.[1] ?? null, days: overdue ? Number(overdue[2]) : null })
  }
  return out
}

/** `{ table → column }` that `runDataRetention` deletes on when every window is on. */
async function purgeAgeColumns(): Promise<Map<string, string>> {
  const deletes = new Map<string, string>()
  const connection = {
    release() {},
    async query(sql: string) {
      const match = /^DELETE FROM ([a-z_]+) WHERE ([a-z_]+) IS NOT NULL AND \2 < \?/.exec(sql)
      if (match) deletes.set(match[1]!, match[2]!)
      if (sql.startsWith('DELETE FROM') || sql.startsWith('INSERT INTO data_retention_state')) return [{ affectedRows: 0 }]
      if (sql.includes('COUNT(*) AS total')) return [[{ total: 0 }]]
      throw new Error(`unexpected statement: ${sql}`)
    },
  }
  const result = await runDataRetention({
    now: new Date('2026-10-27T03:00:00.000Z'),
    activityLogDays: 365, submissionDays: 730, chatSessionDays: 90, readerAccountDays: 400, livestreamSessionDays: 180,
    connection: { async getConnection() { return connection }, async end() {} } as never,
  })
  assert.notEqual(result.status, 'failed', result.message ?? '')
  return deletes
}

test('every scope is reported overdue against the column the purge deletes on, with the stored window', async () => {
  const response = await get('/api/admin/settings/retention', SETTINGS_READER)
  assert.equal(response.status, 200)

  const page = pageAgeQuestions()
  const purge = await purgeAgeColumns()
  assert.deepEqual([...page.keys()].sort(), [...RETENTION_SCOPES].sort(), 'one aggregate per scope')
  assert.deepEqual([...purge.keys()].sort(), [...RETENTION_SCOPES].sort(), 'one age DELETE per scope')
  for (const scope of RETENTION_SCOPES) {
    const asked = page.get(scope)!
    assert.equal(asked.overdue, purge.get(scope), `${scope}: the page and the purge age rows by the same column`)
    assert.equal(asked.min, purge.get(scope), `${scope}: "oldest row" is measured on that column too`)
  }
  assert.equal(page.get('activity_logs')!.days, 365)
  assert.equal(page.get('submissions')!.days, 730)
  assert.equal(page.get('chat_sessions')!.days, 90)
  assert.equal(page.get('reader_accounts')!.days, 400)
  assert.equal(page.get('livestream_sessions')!.days, 180)
})

test('a scope kept indefinitely (0 days) asks no age question and reports nothing overdue', async () => {
  harness.sqlite.prepare('UPDATE settings SET value = \'0\' WHERE key = \'retention_submission_days\'').run()
  canned = { submissions: { total: 12, oldest: '2019-01-01 00:00:00', overdue: 12 } }
  const response = await get('/api/admin/settings/retention', SETTINGS_READER)
  assert.equal(response.status, 200)
  assert.equal(pageAgeQuestions().get('submissions')!.overdue, null)
  const submissions = (response.body.scopes as Array<Record<string, unknown>>).find(scope => scope.scope === 'submissions')!
  assert.equal(submissions.days, 0)
  assert.equal(submissions.overdue, 0)
})

test('the page adds up: row-cap excess, lifetime = live + banked purged rows, last run from the state table', async () => {
  harness.sqlite.prepare('INSERT INTO settings (key, value) VALUES (\'retention_activity_log_max_rows\', \'1000\')').run()
  await harness.db.insert(dataRetentionState).values({
    scope: 'activity_logs', purgedTotal: 5000, lastRunAt: new Date('2026-10-26T20:00:00.000Z'), lastDeleted: 40, lastTrigger: 'scheduler', lastStatus: 'success', lastMessage: null,
  })
  canned = {
    activity_logs: { total: 1500, oldest: '2025-01-02 03:04:05', overdue: 7 },
    chat_sessions: { total: 20, oldest: null, overdue: 0 },
  }
  const response = await get('/api/admin/settings/retention', SETTINGS_READER)
  assert.equal(response.status, 200)
  const scopes = response.body.scopes as Array<Record<string, unknown>>
  const logs = scopes.find(scope => scope.scope === 'activity_logs')!
  assert.deepEqual(
    [logs.total, logs.oldest, logs.overdue, logs.maxRows, logs.overRowCap, logs.purgedTotal, logs.lifetimeTotal, logs.lastDeleted, logs.lastTrigger, logs.lastStatus],
    [1500, '2025-01-02 03:04:05', 7, 1000, 500, 5000, 6500, 40, 'scheduler', 'success'],
  )
  assert.equal(new Date(String(logs.lastRunAt)).toISOString(), '2026-10-26T20:00:00.000Z')
  const chats = scopes.find(scope => scope.scope === 'chat_sessions')!
  assert.deepEqual([chats.total, chats.overRowCap, chats.purgedTotal, chats.lifetimeTotal, chats.lastRunAt], [20, 0, 0, 20, null])
  assert.equal(response.body.autoEnabled, RETENTION_DEFAULTS.autoEnabled)
  assert.equal(response.body.autoEnabledSource, 'default')
  assert.equal(logs.daysSource, 'database')
})

test('the audit-log page ages by the purge\'s column, and raises its two alarms', async () => {
  canned = { activity_logs: { total: 900, oldest: '2024-05-01 00:00:00', newest: '2026-10-27 01:00:00', overdue: 33 } }
  const overdue = await get('/api/admin/activity-logs/retention', USERS_READER)
  assert.equal(overdue.status, 200)
  const purge = await purgeAgeColumns()
  const asked = pageAgeQuestions().get('activity_logs')!
  assert.equal(asked.overdue, purge.get('activity_logs'))
  assert.equal(asked.days, 365)
  assert.deepEqual(
    [overdue.body.total, overdue.body.overdue, overdue.body.newest, overdue.body.retentionDays, overdue.body.purgeOverdue, overdue.body.purgeDisabled],
    [900, 33, '2026-10-27 01:00:00', 365, true, false],
  )

  // Both conditions off: nothing will ever be deleted, said plainly.
  harness.sqlite.prepare('UPDATE settings SET value = \'0\' WHERE key = \'retention_activity_log_days\'').run()
  aggregates.length = 0
  const disabled = await get('/api/admin/activity-logs/retention', USERS_READER)
  assert.equal(pageAgeQuestions().get('activity_logs')!.overdue, null)
  assert.deepEqual([disabled.body.overdue, disabled.body.purgeOverdue, disabled.body.purgeDisabled], [0, false, true])
})

test('permissions: settings.read for the policy page, users.read for the audit-log page — not each other\'s', async () => {
  assert.equal((await get('/api/admin/settings/retention', USERS_READER)).status, 403)
  assert.equal((await get('/api/admin/activity-logs/retention', SETTINGS_READER)).status, 403)
  assert.equal((await server.request('GET', '/api/admin/settings/retention')).status, 401)
  assert.equal(aggregates.length, 0, 'a refused caller never reaches the table scans')
})
