import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `PUT /api/admin/ai/budget` (server/api/admin/ai/budget/index.put.ts) — the
 * monthly AI spending cap and its warning threshold. `checkBudget` refuses AI
 * calls past this cap, so the number is money.
 *
 * The invariants:
 *   - it takes `ai.update`; `ai.read` (+ create/delete) changes nothing;
 *   - only a finite, non-negative number is a budget, and the threshold is clamped
 *     to 1–100 % and floored — a string, a negative, or a missing value is ignored,
 *     never coerced (`"500"` is not 500 VND, `-1` is not "unlimited");
 *   - a body with nothing usable changes nothing and audits nothing;
 *   - the first save creates the single settings row; later saves update it;
 *   - the update and its audit line commit together — if the audit fails, the cap
 *     is what it was.
 *
 *   - the audit `meta` is an object in the JSON column, not a JSON string inside
 *     it (FINDING-R3-3, fixed: 16 handlers under `server/api/admin/ai/**` and one
 *     comment handler `JSON.stringify`-ed it before Drizzle encoded it again, so
 *     `JSON_EXTRACT(meta, '$.type')` found nothing on those rows).
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite
 * (`_sqlite-mysql-db.ts`, real transaction).
 */

process.env.JWT_SECRET = 'ai-budget-update-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs, aiBudgetSettings } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs, aiBudgetSettings])

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
const updateBudget = (await import('../server/api/admin/ai/budget/index.put')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'put', path: '/api/admin/ai/budget', handler: updateBudget }], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const FINANCE: Account = { id: 4, username: 'taichinh', roleId: 3, roleName: 'Quản lý chi phí AI' }
const VIEWER: Account = { id: 5, username: 'xemai', roleId: 4, roleName: 'Xem AI' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const put = (body: unknown, account = FINANCE) => server.request('PUT', '/api/admin/ai/budget', { cookie: cookieFor(account), body })

const budget = () => harness.rows(aiBudgetSettings).map(row => ({ id: row.id, monthlyBudgetVnd: row.monthlyBudgetVnd, warningThresholdPct: row.warningThresholdPct, updatedBy: row.updatedBy }))
const snapshot = () => ({ budget: budget(), audit: harness.rows(activityLogs).length })

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([
    { id: FINANCE.roleId, name: FINANCE.roleName, isSystem: false },
    { id: VIEWER.roleId, name: VIEWER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: FINANCE.roleId, resource: 'ai', canRead: true, canUpdate: true },
    { roleId: VIEWER.roleId, resource: 'ai', canRead: true, canCreate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([FINANCE, VIEWER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(aiBudgetSettings).values({ id: 1, monthlyBudgetVnd: 2_000_000, warningThresholdPct: 80 })
})

test('without ai.update the cap is untouched: no session → 401, read/create/delete → 403', async () => {
  const before = snapshot()
  assert.equal((await server.request('PUT', '/api/admin/ai/budget', { body: { monthlyBudgetVnd: 0 } })).status, 401)
  assert.equal((await put({ monthlyBudgetVnd: 99_000_000, warningThresholdPct: 100 }, VIEWER)).status, 403)
  assert.deepEqual(snapshot(), before)
})

test('a valid change updates the single row and is audited against the actor', async () => {
  const response = await put({ monthlyBudgetVnd: 5_000_000, warningThresholdPct: 75 })
  assert.equal(response.status, 200)
  assert.deepEqual(budget(), [{ id: 1, monthlyBudgetVnd: 5_000_000, warningThresholdPct: 75, updatedBy: FINANCE.id }])
  const audit = harness.rows(activityLogs)
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.userId, FINANCE.id)
  assert.equal(audit[0]!.action, 'update')
  assert.equal(audit[0]!.resource, 'ai')
  assert.equal(audit[0]!.resourceId, 1)
})

test('only a finite non-negative number is a budget: strings, negatives and junk are ignored, never coerced', async () => {
  const before = snapshot()
  for (const body of [{ monthlyBudgetVnd: '500' }, { monthlyBudgetVnd: -1 }, { monthlyBudgetVnd: null }, { warningThresholdPct: '50' }, { monthlyBudgetVnd: true }, {}, { unrelated: 1 }]) {
    const response = await put(body)
    assert.equal(response.status, 200, JSON.stringify(body))
    assert.equal(response.body.message, 'Không có thay đổi.', JSON.stringify(body))
  }
  assert.deepEqual(snapshot(), before)

  // A junk budget next to a valid threshold: the threshold alone is applied.
  assert.equal((await put({ monthlyBudgetVnd: -5, warningThresholdPct: 60 })).status, 200)
  assert.deepEqual(budget()[0], { id: 1, monthlyBudgetVnd: 2_000_000, warningThresholdPct: 60, updatedBy: FINANCE.id })
})

test('the threshold is clamped to 1–100 % and floored; 0 VND is a real budget', async () => {
  for (const [sent, kept] of [[150, 100], [0, 1], [-20, 1], [55.9, 55]] as const) {
    assert.equal((await put({ warningThresholdPct: sent })).status, 200)
    assert.equal(budget()[0]!.warningThresholdPct, kept, String(sent))
  }
  assert.equal((await put({ monthlyBudgetVnd: 0 })).status, 200)
  assert.equal(budget()[0]!.monthlyBudgetVnd, 0)
})

test('the first save creates the settings row with the defaults, then applies the change', async () => {
  harness.sqlite.prepare('DELETE FROM ai_budget_settings').run()
  assert.equal((await put({ monthlyBudgetVnd: 1_000_000 })).status, 200)
  assert.deepEqual(budget(), [{ id: 1, monthlyBudgetVnd: 1_000_000, warningThresholdPct: 80, updatedBy: FINANCE.id }])
})

test('the update and its audit line commit together: audit fails → 500, the cap is what it was', async () => {
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await put({ monthlyBudgetVnd: 99_000_000 })).status, 500)
  assert.deepEqual(snapshot(), before)
})

/**
 * FINDING-R3-3 — severity low, FIXED. It was pinned here as it behaved: the meta
 * was `JSON.stringify`-ed before Drizzle encoded the JSON column again, so the
 * stored value was a JSON string, not an object — in 17 files. They now pass the
 * object, like every other audit writer; `tests/activity-log-meta-shape.test.ts`
 * scans `server/**` so a new `meta: JSON.stringify(` into `activityLogs` is red.
 * Stringify it again and this test is red.
 */
test('FINDING-R3-3 (low, fixed): the audit meta is an object in the JSON column, not a JSON string', async () => {
  assert.equal((await put({ warningThresholdPct: 90 })).status, 200)
  const meta = harness.rows(activityLogs)[0]!.meta
  assert.equal(typeof meta, 'object')
  assert.deepEqual(meta, { type: 'budget_update', changedFields: ['warningThresholdPct', 'updatedBy'] })
  // The column holds ONE JSON encoding of the object (`{"type":…}`), not an encoded
  // string (`"{\"type\":…}"`) — so `JSON_EXTRACT(meta, '$.type')` finds it.
  const raw = (harness.sqlite.prepare('SELECT meta FROM activity_logs').get() as { meta: string }).meta
  assert.equal(JSON.parse(raw).type, 'budget_update')
})
