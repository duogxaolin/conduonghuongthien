import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `DELETE /api/admin/users/:id/mfa` (server/api/admin/users/[id]/mfa.delete.ts) —
 * break-glass: a SuperAdmin strips another administrator's second factors.
 *
 * It is the one action that can undo another account's authentication hardening,
 * so the invariants are about who, what, and all-or-nothing:
 *   - only a SuperAdmin — `users.update` (or every flag on `users`) is not enough,
 *     and only a strict `isSuperAdmin === true` counts;
 *   - it removes the TARGET's factors and recovery codes and nobody else's, and
 *     ends the target's live sessions (their token stops working);
 *   - the deletes, the session bump and the two audit rows commit together: if the
 *     audit cannot be written, nothing happened.
 *
 * Runs in a real h3 app: the real `admin-auth` middleware in front of the real
 * handler, Drizzle's own SQL on SQLite (`_sqlite-mysql-db.ts`, real transaction,
 * pool writes refused while it is open). A second mount (`/direct/...`) hands the
 * handler an actor object as-is, to try `isSuperAdmin` values the middleware would
 * never produce.
 */

process.env.JWT_SECRET = 'admin-user-mfa-reset-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, userRecoveryCodes, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, userRecoveryCodes, activityLogs])

const warnings: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: (entry: Record<string, unknown>) => { warnings.push(entry) },
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const h3 = await import('h3')
const adminAuth = (await import('../server/middleware/admin-auth')).default
const clearMfa = (await import('../server/api/admin/users/[id]/mfa.delete')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

let directActor: unknown = null
const injectActor = h3.defineEventHandler((event) => {
  if (event.path.startsWith('/direct/')) event.context.adminUser = directActor
})

const server = await startHandlerServer([
  { method: 'delete', path: '/api/admin/users/:id/mfa', handler: clearMfa },
  { method: 'delete', path: '/direct/users/:id/mfa', handler: clearMfa },
  { method: 'get', path: '/api/admin/users', handler: h3.defineEventHandler(event => ({ userId: (event.context.adminUser as { id: number }).id })) },
], [adminAuth, injectActor])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const SUPERADMIN: Account = { id: 1, username: 'admin', roleId: 1, roleName: 'Quản trị hệ thống' }
const USER_MANAGER: Account = { id: 7, username: 'manager', roleId: 3, roleName: 'Quản lý tài khoản' }
const TARGET: Account = { id: 9, username: 'target', roleId: 3, roleName: 'Quản lý tài khoản' }
const BYSTANDER: Account = { id: 10, username: 'bystander', roleId: 3, roleName: 'Quản lý tài khoản' }

const cookieFor = (account: Account, tokenVersion = 0) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion })}`
const clear = (actor: Account, targetId: number | string) =>
  server.request('DELETE', `/api/admin/users/${targetId}/mfa`, { cookie: cookieFor(actor) })

const factorOwners = () => harness.rows(userMfaFactors).map(row => `${row.userId}:${row.factorType}`).sort()
const codeOwners = () => harness.rows(userRecoveryCodes).map(row => row.userId).sort()
const tokenVersions = () => Object.fromEntries(harness.rows(users).map(row => [row.username, row.tokenVersion]))
const snapshot = () => ({ factors: factorOwners(), codes: codeOwners(), tokenVersions: tokenVersions(), audit: harness.rows(activityLogs).length })

beforeEach(async () => {
  harness.reset()
  warnings.length = 0
  directActor = null
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([
    { id: 1, name: SUPERADMIN.roleName, isSystem: true },
    { id: 3, name: USER_MANAGER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values({ roleId: 3, resource: 'users', canCreate: true, canRead: true, canUpdate: true, canDelete: true })
  await harness.db.insert(users).values([SUPERADMIN, USER_MANAGER, TARGET, BYSTANDER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(userMfaFactors).values([
    { userId: TARGET.id, factorType: 'totp', state: 'active', secretCiphertext: 'sealed-target' },
    { userId: TARGET.id, factorType: 'email_otp', state: 'active' },
    { userId: BYSTANDER.id, factorType: 'totp', state: 'active', secretCiphertext: 'sealed-bystander' },
  ])
  await harness.db.insert(userRecoveryCodes).values([
    { userId: TARGET.id, codeHash: 'h1', batchId: 'b-target' },
    { userId: TARGET.id, codeHash: 'h2', batchId: 'b-target' },
    { userId: BYSTANDER.id, codeHash: 'h3', batchId: 'b-bystander' },
  ])
})

test('a non-SuperAdmin holding every flag on users is refused, and nothing changes', async () => {
  const before = snapshot()
  const response = await clear(USER_MANAGER, TARGET.id)
  assert.equal(response.status, 403)
  assert.deepEqual(snapshot(), before)
})

test('only a strict isSuperAdmin === true passes — truthy look-alikes are refused', async () => {
  const before = snapshot()
  for (const isSuperAdmin of ['true', 1, {}, [true], 'yes']) {
    directActor = { id: USER_MANAGER.id, username: USER_MANAGER.username, isSuperAdmin, permissions: [] }
    const response = await server.request('DELETE', `/direct/users/${TARGET.id}/mfa`)
    assert.equal(response.status, 403, `isSuperAdmin: ${JSON.stringify(isSuperAdmin)}`)
  }
  directActor = null
  assert.equal((await server.request('DELETE', `/direct/users/${TARGET.id}/mfa`)).status, 401)
  assert.deepEqual(snapshot(), before)
})

test('a SuperAdmin clears the target\'s factors and codes — and only the target\'s', async () => {
  const response = await clear(SUPERADMIN, TARGET.id)
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.deepEqual(factorOwners(), [`${BYSTANDER.id}:totp`])
  assert.deepEqual(codeOwners(), [BYSTANDER.id])
})

test('the target\'s live sessions end; the SuperAdmin\'s and everyone else\'s do not', async () => {
  const targetSession = cookieFor(TARGET)
  const bystanderSession = cookieFor(BYSTANDER)
  assert.equal((await server.request('GET', '/api/admin/users', { cookie: targetSession })).status, 200, 'precondition')

  await clear(SUPERADMIN, TARGET.id)

  assert.equal((await server.request('GET', '/api/admin/users', { cookie: targetSession })).status, 401, 'the target\'s old token still works')
  assert.equal((await server.request('GET', '/api/admin/users', { cookie: bystanderSession })).status, 200)
  assert.equal((await server.request('GET', '/api/admin/users', { cookie: cookieFor(SUPERADMIN) })).status, 200)
  assert.deepEqual(tokenVersions(), { admin: 0, manager: 0, target: 1, bystander: 0 })
})

test('the override is visible from both accounts\' history: one audit row each', async () => {
  await clear(SUPERADMIN, TARGET.id)
  const rows = harness.rows(activityLogs)
  assert.equal(rows.length, 2)
  const actorRow = rows.find(row => row.userId === SUPERADMIN.id)
  const targetRow = rows.find(row => row.userId === TARGET.id)
  assert.ok(actorRow && targetRow)
  for (const row of [actorRow, targetRow]) {
    assert.equal(row.action, 'delete')
    assert.equal(row.resource, 'user_mfa')
    assert.equal(row.resourceId, TARGET.id)
  }
  assert.equal((actorRow.meta as Record<string, unknown>).targetUsername, TARGET.username)
  assert.equal((targetRow.meta as Record<string, unknown>).clearedBy, SUPERADMIN.username)
  assert.ok(warnings.some(entry => entry.event === 'event.mfaFactorsCleared' && entry.targetUserId === TARGET.id))
})

test('if the audit cannot be written, nothing happened: factors, codes and sessions all survive', async () => {
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  const response = await clear(SUPERADMIN, TARGET.id)
  assert.equal(response.status, 500)
  assert.deepEqual(snapshot(), before)
  assert.equal((await server.request('GET', '/api/admin/users', { cookie: cookieFor(TARGET) })).status, 200)
})

test('an unknown or malformed target writes nothing', async () => {
  const before = snapshot()
  assert.equal((await clear(SUPERADMIN, 999)).status, 404)
  assert.equal((await clear(SUPERADMIN, 'abc')).status, 400)
  assert.equal((await clear(SUPERADMIN, 0)).status, 400)
  assert.deepEqual(snapshot(), before)
})

test('without a session the gate refuses before the handler runs', async () => {
  const before = snapshot()
  assert.equal((await server.request('DELETE', `/api/admin/users/${TARGET.id}/mfa`)).status, 401)
  assert.deepEqual(snapshot(), before)
})
