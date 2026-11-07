import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'
import { createStorage, prefixStorage, type Storage } from 'unstorage'

/**
 * `POST /api/admin/cache-clear` (server/api/admin/cache-clear.post.ts) — the "Xoá cache" button.
 * Real h3 app, real `admin-auth`, the real handler and the real `purgePublicPageCache`, over a real
 * in-memory unstorage mounted the way Nitro's `useStorage('cache')` is (a prefix of one root
 * storage), and the audit insert on Drizzle's MySQL statements run on SQLite.
 *
 * Invariants:
 *   - `settings.update` is the gate (a viewer with `settings.read` only is a 403, no session a 401),
 *     and a refusal removes nothing and writes no audit row;
 *   - the body must say `confirm: true` — absent, `{}`, `"true"`, `1`, `false`, an unreadable
 *     body are all 400 and remove nothing;
 *   - only the `nitro/routes` group of the `cache` storage is removed — not the other `cache`
 *     groups, not another namespace;
 *   - one audit row names who did it (`clear_swr_cache`, `clearedKeys` = how many were removed);
 *   - a storage that cannot be listed is an error, not an "OK, cleared 0", and writes no audit row;
 *   - the route answers POST only.
 *
 * Before this file the claims were `body?.confirm !== true`, `requireResourcePermission(admin,
 * 'settings', 'update')`, `getKeys('nitro/routes')` and `clear_swr_cache` matched in the source
 * (`tests/admin-cache-clear.test.ts`); the layout-button blocks there stay (structure).
 */

process.env.JWT_SECRET = 'admin-cache-clear-behavior-test-secret-0123456789'
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

// Nitro's `useStorage(base)` is a prefix of one root storage; `useStorage('cache')` is where route HTML lives.
let root: Storage = createStorage()
let listingBroken = false
const useStorage = (base = '') => {
  const scoped = base ? prefixStorage(root, base) : root
  if (!listingBroken) return scoped
  return new Proxy(scoped, { get: (target, key, receiver) => (key === 'getKeys' ? async () => { throw new Error('injected failure: storage unavailable') } : Reflect.get(target, key, receiver)) })
}
;(globalThis as Record<string, unknown>).useStorage = useStorage

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const handler = (await import('../server/api/admin/cache-clear.post')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'post', path: '/api/admin/cache-clear', handler }], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const OPERATOR: Account = { id: 5, username: 'vanhanh', roleId: 2, roleName: 'Vận hành' }
const VIEWER: Account = { id: 6, username: 'xemthu', roleId: 3, roleName: 'Chỉ xem' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`

const KEYS = {
  routes: ['cache:nitro:routes:_:trangchu.aaa.json', 'cache:nitro:routes:_:newsbaixoa.bbb.json', 'cache:nitro:routes:_:newsbaixoa.ccc.json'],
  otherCacheGroups: ['cache:nitro:functions:_:fn.json', 'cache:favicon:settings'],
  otherNamespace: ['data:nitro:routes:_:x.json', 'config:nitro:routes'],
}
const remaining = async () => (await root.getKeys()).sort()

const clear = (account: Account | null, body?: unknown) =>
  server.request('POST', '/api/admin/cache-clear', { cookie: account ? cookieFor(account) : undefined, body })

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  listingBroken = false
  root = createStorage()
  for (const key of [...KEYS.routes, ...KEYS.otherCacheGroups, ...KEYS.otherNamespace]) await root.setItem(key, `value of ${key}`)
  await harness.db.insert(roles).values([
    { id: 2, name: OPERATOR.roleName, isSystem: false },
    { id: 3, name: VIEWER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: 2, resource: 'settings', canRead: true, canUpdate: true },
    { roleId: 3, resource: 'settings', canRead: true },
  ])
  await harness.db.insert(users).values([OPERATOR, VIEWER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
})

const untouched = async () => assert.deepEqual(await remaining(), [...KEYS.routes, ...KEYS.otherCacheGroups, ...KEYS.otherNamespace].sort(), 'something was removed')

test('without settings.update (a viewer) it is a 403, and without a session a 401: nothing removed, nothing audited', async () => {
  assert.equal((await clear(VIEWER, { confirm: true })).status, 403)
  assert.equal((await clear(null, { confirm: true })).status, 401)
  await untouched()
  assert.equal(harness.rows(activityLogs).length, 0)
})

test('confirm must be exactly true: absent, empty, "true", 1, false and an unreadable body are all 400', async () => {
  for (const body of [undefined, {}, { confirm: 'true' }, { confirm: 1 }, { confirm: false }, { confirm: null }, '{not json']) {
    const response = await clear(OPERATOR, body)
    assert.equal(response.status, 400, JSON.stringify(body))
  }
  await untouched()
  assert.equal(harness.rows(activityLogs).length, 0, 'a refused call writes no audit row')
})

test('confirmed: removes only the nitro/routes group of the cache storage, and says how many', async () => {
  const response = await clear(OPERATOR, { confirm: true })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(response.body.cleared, KEYS.routes.length)
  assert.deepEqual(await remaining(), [...KEYS.otherCacheGroups, ...KEYS.otherNamespace].sort(), 'other cache groups and other namespaces stay')
})

test('one audit row names the operator, the operation and the number of entries removed', async () => {
  await clear(OPERATOR, { confirm: true })
  const rows = harness.rows(activityLogs)
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0]!.userId, rows[0]!.action, rows[0]!.resource], [OPERATOR.id, 'update', 'settings'])
  assert.deepEqual(rows[0]!.meta, { trigger: 'manual', operation: 'clear_swr_cache', clearedKeys: KEYS.routes.length })
  // Nothing cached any more: the next press says 0 and is still audited.
  const again = await clear(OPERATOR, { confirm: true })
  assert.equal(again.body.cleared, 0)
  assert.equal(harness.rows(activityLogs).length, 2)
})

test('a storage that cannot be listed is an error with no audit row, not "cleared 0"', async () => {
  listingBroken = true
  const response = await clear(OPERATOR, { confirm: true })
  assert.equal(response.status, 500)
  assert.equal(harness.rows(activityLogs).length, 0)
  await untouched()
})

test('the route answers POST only: a GET changes nothing', async () => {
  const response = await server.request('GET', '/api/admin/cache-clear', { cookie: cookieFor(OPERATOR) })
  assert.notEqual(response.status, 200)
  await untouched()
})
