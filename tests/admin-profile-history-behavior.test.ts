import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `GET /api/admin/profile/history` (server/api/admin/profile/history.get.ts) —
 * login and action history from `activity_logs`.
 *
 * It is an audit trail, not a surveillance tool, so the invariants are about whose
 * rows come back and who may look:
 *   - any signed-in administrator reads their OWN history with no RBAC grant, and
 *     only their own rows — the `user_id = ?` condition is the boundary;
 *   - reading another account's history takes a strict SuperAdmin; every flag on
 *     `users` is not enough (the code and its header say SuperAdmin — the ranking
 *     doc's "users.read" hint is stale);
 *   - a cross-account read is itself audited, and a refused one leaves no trace of
 *     the target's rows;
 *   - of the free-form `meta`, only ip / userAgent / mfaMethod reach the response;
 *   - malformed paging and ranges are refused, never silently replaced.
 *
 * Real h3 app with the real `admin-auth` middleware in front; Drizzle's SQL on
 * SQLite (`_sqlite-mysql-db.ts`), so the WHERE, ORDER BY and LIMIT/OFFSET the
 * handler builds are what select the rows. Fixture times are explicit UTC.
 *
 * Not pinned: what a date-only `from`/`to` means. The handler parses both with
 * `new Date(raw)` (a UTC instant), unlike the VN-calendar-day rule other admin
 * date filters follow; no client sends these parameters today. Reported to the
 * caller rather than frozen here.
 */

process.env.JWT_SECRET = 'admin-profile-history-behavior-test-secret-0123456789'
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
const history = (await import('../server/api/admin/profile/history.get')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'get', path: '/api/admin/profile/history', handler: history }], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const SUPERADMIN: Account = { id: 1, username: 'admin', roleId: 1, roleName: 'Quản trị hệ thống' }
const MANAGER: Account = { id: 7, username: 'manager', roleId: 3, roleName: 'Quản lý tài khoản' }
const NOBODY: Account = { id: 8, username: 'nobody', roleId: 4, roleName: 'Không quyền' }

const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const read = (account: Account, query = '') => server.request('GET', `/api/admin/profile/history${query}`, { cookie: cookieFor(account) })
type Item = { id: number, action: string, resource: string, ip: string | null, userAgent: string | null, mfaMethod: string | null, createdAt: string }
const itemsOf = (body: Record<string, unknown>) => body.items as Item[]

const audits = () => harness.rows(activityLogs).filter(row => row.resource === 'user_history')

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([
    { id: 1, name: SUPERADMIN.roleName, isSystem: true },
    { id: 3, name: MANAGER.roleName, isSystem: false },
    { id: 4, name: NOBODY.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values({ roleId: 3, resource: 'users', canCreate: true, canRead: true, canUpdate: true, canDelete: true })
  await harness.db.insert(users).values([SUPERADMIN, MANAGER, NOBODY].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  // Ids are assigned in insertion order; times are explicit UTC.
  await harness.db.insert(activityLogs).values([
    { userId: NOBODY.id, action: 'login', resource: 'auth', meta: { ip: '10.0.0.8', userAgent: 'UA-nobody', mfaMethod: 'totp' }, createdAt: new Date('2026-10-20T01:00:00Z') },
    { userId: NOBODY.id, action: 'update', resource: 'profile_password', meta: { ip: '10.0.0.8', secretReplaced: true, password: 'should-never-surface', targetUsername: 'x' }, createdAt: new Date('2026-10-21T01:00:00Z') },
    { userId: NOBODY.id, action: 'logout', resource: 'auth', meta: 'not-an-object', createdAt: new Date('2026-10-22T01:00:00Z') },
    { userId: MANAGER.id, action: 'login', resource: 'auth', meta: { ip: '10.0.0.7' }, createdAt: new Date('2026-10-20T02:00:00Z') },
    { userId: MANAGER.id, action: 'delete', resource: 'news', meta: { ip: '10.0.0.7' }, createdAt: new Date('2026-10-23T02:00:00Z') },
    { userId: SUPERADMIN.id, action: 'login', resource: 'auth', meta: { ip: '10.0.0.1' }, createdAt: new Date('2026-10-24T03:00:00Z') },
  ])
})

test('an account with no grant at all reads its own history — and only its own rows', async () => {
  const response = await read(NOBODY)
  assert.equal(response.status, 200)
  assert.equal(response.body.userId, NOBODY.id)
  assert.equal(response.body.total, 3)
  assert.deepEqual(itemsOf(response.body).map(item => item.action), ['logout', 'update', 'login'], 'newest first, own rows only')
  assert.equal(audits().length, 0, 'reading your own history is not a cross-account read')
})

test('naming your own id is still your own history, for anyone', async () => {
  const response = await read(NOBODY, `?userId=${NOBODY.id}`)
  assert.equal(response.status, 200)
  assert.equal(response.body.total, 3)
  assert.equal(response.body.targetUsername, null)
  assert.equal(audits().length, 0)
})

test('another account\'s history needs a SuperAdmin — every flag on users is not enough', async () => {
  for (const account of [MANAGER, NOBODY]) {
    const target = account === MANAGER ? NOBODY : MANAGER
    const response = await read(account, `?userId=${target.id}`)
    assert.equal(response.status, 403, `${account.username} read ${target.username}'s history`)
    assert.equal(response.body.items, undefined)
  }
  assert.equal(audits().length, 0)
})

test('a SuperAdmin reads another account\'s rows, and that read is itself audited', async () => {
  const response = await read(SUPERADMIN, `?userId=${MANAGER.id}`)
  assert.equal(response.status, 200)
  assert.equal(response.body.userId, MANAGER.id)
  assert.equal(response.body.targetUsername, MANAGER.username)
  assert.deepEqual(itemsOf(response.body).map(item => item.ip), ['10.0.0.7', '10.0.0.7'])

  const rows = audits()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.userId, SUPERADMIN.id)
  assert.equal(rows[0]!.action, 'read')
  assert.equal(rows[0]!.resourceId, MANAGER.id)
  assert.equal((rows[0]!.meta as Record<string, unknown>).targetUsername, MANAGER.username)
})

test('a SuperAdmin naming an account that does not exist gets a 404 and leaves no audit row', async () => {
  assert.equal((await read(SUPERADMIN, '?userId=999')).status, 404)
  assert.equal(audits().length, 0)
})

test('only ip, userAgent and mfaMethod leave meta — nothing else in it reaches the response', async () => {
  const response = await read(NOBODY)
  const items = itemsOf(response.body)
  const serialized = JSON.stringify(items)
  for (const leaked of ['should-never-surface', 'secretReplaced', 'targetUsername', 'not-an-object']) {
    assert.ok(!serialized.includes(leaked), `${leaked} reached the response items`)
  }
  for (const item of items) assert.deepEqual(Object.keys(item).sort(), ['action', 'createdAt', 'id', 'ip', 'mfaMethod', 'resource', 'resourceId', 'userAgent'])
  const login = items.find(item => item.action === 'login')!
  assert.deepEqual([login.ip, login.userAgent, login.mfaMethod], ['10.0.0.8', 'UA-nobody', 'totp'])
})

test('from/to bound the rows by instant; a bad date or an inverted range is refused, not replaced', async () => {
  const bounded = await read(NOBODY, `?from=${encodeURIComponent('2026-10-20T12:00:00Z')}&to=${encodeURIComponent('2026-10-21T12:00:00Z')}`)
  assert.equal(bounded.status, 200)
  assert.deepEqual(itemsOf(bounded.body).map(item => item.action), ['update'])
  assert.equal(bounded.body.total, 1)

  assert.equal((await read(NOBODY, '?from=yesterday')).status, 400)
  assert.equal((await read(NOBODY, '?to=2026-13-45')).status, 400)
  assert.equal((await read(NOBODY, `?from=${encodeURIComponent('2026-10-22T00:00:00Z')}&to=${encodeURIComponent('2026-10-21T00:00:00Z')}`)).status, 400)
})

test('paging is bounded and stable; malformed paging or ids are refused', async () => {
  const first = await read(NOBODY, '?pageSize=2&page=1')
  const second = await read(NOBODY, '?pageSize=2&page=2')
  assert.equal(first.body.totalPages, 2)
  const ids = [...itemsOf(first.body), ...itemsOf(second.body)].map(item => item.id)
  assert.equal(new Set(ids).size, 3, 'pages overlapped or skipped a row')

  for (const query of ['?pageSize=101', '?pageSize=0', '?page=0', '?page=1.5', '?userId=0', '?userId=-1', '?userId=1.5', '?userId=abc']) {
    assert.equal((await read(SUPERADMIN, query)).status, 400, query)
  }
  assert.equal(audits().length, 0)
})

test('without a session the gate refuses before the handler runs', async () => {
  assert.equal((await server.request('GET', '/api/admin/profile/history')).status, 401)
})
