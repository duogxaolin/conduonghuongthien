import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `GET /api/admin/activity-logs` (server/api/admin/activity-logs/index.get.ts) — the one page that reads
 * EVERY administrator's trail — and the gate of its sibling `retention.get.ts`. Real h3 app, real
 * `admin-auth`, the real handlers; Drizzle's MySQL statements run on SQLite
 * (tests/_sqlite-mysql-db.ts). The `meta.phase` projection has its own file
 * (`tests/admin-activity-logs-phase-behavior.test.ts`).
 *
 * Invariants:
 *   - GATED: `users.read` (SuperAdmin passes). A role that can write users or read other
 *     resources, but not `users.read`, is a 403; no session is a 401. A refusal writes no row;
 *   - RECORDED: a successful read writes one audit row of its own — `resource: 'activity_logs'`,
 *     `action: 'read'`, `userId` the CALLER (never the account being inspected), the filters in
 *     its meta. A request refused by validation does not;
 *   - the trail survives its author: rows of an account that no longer exists are listed (left
 *     join), with no username;
 *   - paging is bounded and stable when rows share a timestamp; filters are validated (400),
 *     never coerced; a Vietnam calendar day is inclusive at both ends.
 *
 * Before this file these were `requireResourcePermission(admin, 'users', 'read')`,
 * `db.insert(activityLogs).values({`, `resource: 'activity_logs'`, `leftJoin(…)`, `MAX_PAGE_SIZE = 100`
 * and similar patterns matched in the sources (`tests/admin-activity-logs.test.ts`). What stays
 * there: the page template, the menu entry, the retention endpoint's read-only shape (its handler
 * needs MySQL's `NOW()`, which SQLite cannot run).
 */

process.env.JWT_SECRET = 'admin-activity-logs-access-behavior-test-secret-0123456789'
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

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const list = (await import('../server/api/admin/activity-logs/index.get')).default
const retention = (await import('../server/api/admin/activity-logs/retention.get')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/activity-logs', handler: list },
  { method: 'get', path: '/api/admin/activity-logs/retention', handler: retention },
], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string, superAdmin?: boolean }
const AUDITOR: Account = { id: 7, username: 'kiemtoan', roleId: 3, roleName: 'Kiểm toán' }
const USER_ADMIN: Account = { id: 8, username: 'quanlytk', roleId: 4, roleName: 'Quản lý tài khoản (ghi)' }
const OTHER_READER: Account = { id: 9, username: 'xembai', roleId: 5, roleName: 'Xem bài' }
const SUPER: Account = { id: 1, username: 'super', roleId: 1, roleName: 'Quản trị hệ thống', superAdmin: true }
const GONE_USER_ID = 999

const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const get = (path: string, account: Account | null) =>
  server.request('GET', `/api/admin/activity-logs${path}`, { cookie: account ? cookieFor(account) : undefined })
type Item = Record<string, unknown>
const itemsOf = (body: Record<string, unknown>) => body.items as Item[]
const ownRows = () => harness.rows(activityLogs).filter(row => row.resource === 'activity_logs')
const at = (iso: string) => new Date(iso)

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([
    { id: 1, name: SUPER.roleName, isSystem: true },
    { id: 3, name: AUDITOR.roleName, isSystem: false },
    { id: 4, name: USER_ADMIN.roleName, isSystem: false },
    { id: 5, name: OTHER_READER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: 3, resource: 'users', canRead: true },
    { roleId: 4, resource: 'users', canCreate: true, canUpdate: true, canDelete: true },
    { roleId: 5, resource: 'articles', canRead: true },
  ])
  await harness.db.insert(users).values([SUPER, AUDITOR, USER_ADMIN, OTHER_READER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId, isSuperAdmin: account.superAdmin === true,
  })))
  await harness.db.insert(activityLogs).values([
    { userId: USER_ADMIN.id, action: 'update', resource: 'users', resourceId: 12, meta: { ip: '10.0.0.8' }, createdAt: at('2026-10-28T03:00:00Z') },
    { userId: GONE_USER_ID, action: 'login', resource: 'auth', meta: { ip: '10.0.0.99' }, createdAt: at('2026-10-27T03:00:00Z') },
  ])
})

test('without users.read it is a 403 (also for a role that WRITES users, or reads other resources) and without a session a 401: no audit row', async () => {
  for (const account of [USER_ADMIN, OTHER_READER]) assert.equal((await get('', account)).status, 403, account.username)
  assert.equal((await get('', null)).status, 401)
  assert.equal(ownRows().length, 0, 'a refused read writes no audit row')
  assert.equal(harness.statements.filter(sql => /from `activity_logs`/.test(sql)).length, 0, 'the log table is not even queried')
})

test('a reader with users.read, and a SuperAdmin with no grants, get the trail', async () => {
  for (const account of [AUDITOR, SUPER]) {
    const response = await get('?pageSize=100', account)
    assert.equal(response.status, 200, account.username)
    assert.ok(itemsOf(response.body).some(item => item.action === 'update' && item.resource === 'users'))
  }
})

test('a successful read is itself recorded: one row per request, by the CALLER, even when inspecting another account', async () => {
  const response = await get(`?userId=${USER_ADMIN.id}&action=update`, AUDITOR)
  assert.equal(response.status, 200)
  assert.deepEqual(itemsOf(response.body).map(item => item.userId), [USER_ADMIN.id])
  const rows = ownRows()
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0]!.userId, rows[0]!.action, rows[0]!.resource, rows[0]!.resourceId], [AUDITOR.id, 'read', 'activity_logs', USER_ADMIN.id])
  const meta = rows[0]!.meta as { filters: Record<string, unknown>, ip: unknown }
  assert.deepEqual(meta.filters, { userId: USER_ADMIN.id, action: 'update', resource: null, from: null, to: null })
  assert.equal(typeof meta.ip, 'string')

  await get('', AUDITOR)
  assert.equal(ownRows().length, 2, 'every request is recorded, not only the first')
})

test('requests refused by validation write no audit row', async () => {
  for (const query of ['?userId=abc', '?userId=0', '?userId=-3', '?userId=1.5', '?page=0', '?page=abc', '?page=1.5', '?pageSize=0', '?pageSize=101', '?pageSize=abc',
    '?from=garbage', '?to=2026-13-45', '?from=2026-10-29&to=2026-10-28', `?action=${'a'.repeat(33)}`, `?resource=${'r'.repeat(65)}`]) {
    assert.equal((await get(query, AUDITOR)).status, 400, query)
  }
  assert.equal(ownRows().length, 0)
})

test('the trail survives its author: rows of a deleted account are listed, with no username', async () => {
  const { body } = await get('?pageSize=100', AUDITOR)
  const orphan = itemsOf(body).find(item => item.userId === GONE_USER_ID)
  assert.ok(orphan, 'the row of the deleted account must still be listed')
  assert.equal(orphan.username, null)
  assert.equal(itemsOf(body).find(item => item.userId === USER_ADMIN.id)!.username, USER_ADMIN.username)
})

test('paging is deterministic when rows share a timestamp, and total/totalPages describe the filtered set', async () => {
  const same = at('2026-10-29T03:00:00Z')
  await harness.db.insert(activityLogs).values(Array.from({ length: 5 }, (_, index) => ({
    userId: USER_ADMIN.id, action: 'update', resource: 'pages', resourceId: index + 1, meta: {}, createdAt: same,
  })))
  const first = await get('?resource=pages&pageSize=2&page=1', AUDITOR)
  const second = await get('?resource=pages&pageSize=2&page=2', AUDITOR)
  const third = await get('?resource=pages&pageSize=2&page=3', AUDITOR)
  const ids = [first, second, third].flatMap(response => itemsOf(response.body).map(item => Number(item.id)))
  assert.equal(new Set(ids).size, 5, 'no row repeated or skipped across pages')
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'newest id first within the same timestamp')
  assert.deepEqual([first.body.total, first.body.totalPages, third.body.items && itemsOf(third.body).length], [5, 3, 1])
})

test('from/to are Vietnam calendar days, inclusive at both ends', async () => {
  await harness.db.insert(activityLogs).values([
    { userId: AUDITOR.id, action: 'probe', resource: 'edge', meta: {}, createdAt: at('2026-10-28T16:59:00Z') }, // 23:59 on the 28th, Vietnam
    { userId: AUDITOR.id, action: 'probe', resource: 'edge', meta: {}, createdAt: at('2026-10-28T17:01:00Z') }, // 00:01 on the 29th, Vietnam
  ])
  const upTo28 = itemsOf((await get('?resource=edge&to=2026-10-28', AUDITOR)).body)
  const from29 = itemsOf((await get('?resource=edge&from=2026-10-29', AUDITOR)).body)
  assert.deepEqual([upTo28.length, from29.length], [1, 1])
  assert.notEqual(upTo28[0]!.id, from29[0]!.id)
})

test('the retention report is behind the same grant: 403 without users.read, 401 without a session', async () => {
  const before = harness.statements.length
  for (const account of [USER_ADMIN, OTHER_READER]) {
    assert.equal((await server.request('GET', '/api/admin/activity-logs/retention', { cookie: cookieFor(account) })).status, 403, account.username)
  }
  assert.equal((await server.request('GET', '/api/admin/activity-logs/retention')).status, 401)
  assert.equal(harness.statements.slice(before).filter(sql => /activity_logs|data_retention/.test(sql)).length, 0, 'a refused report reads nothing')
})
