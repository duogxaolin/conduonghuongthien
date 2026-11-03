import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `GET /api/admin/auth/me` and a completed login (`completeLogin`, the answer of
 * `POST /api/admin/auth/login` and `/mfa/verify`) hand the browser the SAME user object.
 *
 * Why it is pinned (wave3 7.1 batch C, D-FETCH): `app/composables/useAdminAuth.ts` keeps
 * one `AdminUser` in state whichever of the two filled it, and its type is DERIVED from
 * `completeLogin` (app/types/admin-auth-api.ts). `me.get.ts` cannot give a type of its
 * own: it builds the user from `event.context.adminUser`, which h3 types as `any`
 * (`H3EventContext extends Record<string, any>`), and Nitro's `Serialize` omits `any`-typed
 * keys — `Payload<typeof me>['user']` is left with the two MFA fields only. The derivation
 * from `completeLogin` holds only while `me` sends the same
 * object — this suite is what keeps that true: a field added to one and not the other
 * fails here.
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite.
 */

process.env.JWT_SECRET = 'admin-auth-me-shape-behavior-test-secret-0123456789abcdef'
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
const h3 = await import('h3')
const adminAuth = (await import('../server/middleware/admin-auth')).default
const me = (await import('../server/api/admin/auth/me.get')).default
const { completeLogin, loadSessionUser } = await import('../server/utils/mfa/session')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

/** A login that has passed every check, completed for the account named in the query. */
const completeFor = h3.defineEventHandler(async (event) => {
  const account = await loadSessionUser(String(h3.getQuery(event).username))
  assert.ok(account, 'the fixture account exists')
  return completeLogin(event, account, { ip: '203.0.113.9' })
})

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/auth/me', handler: me },
  { method: 'post', path: '/test/complete-login', handler: completeFor },
], [adminAuth])
after(() => server.close())

const EDITOR = { id: 7, username: 'bientap', roleId: 3, roleName: 'Biên tập' }
const SUPERADMIN = { id: 1, username: 'admin', roleId: 1, roleName: 'SuperAdmin' }
const cookieFor = (account: typeof EDITOR) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([
    { id: 1, name: SUPERADMIN.roleName, isSystem: true },
    { id: 3, name: EDITOR.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: 3, resource: 'articles', canCreate: true, canRead: true, canUpdate: true, canPublish: true },
    { roleId: 3, resource: 'chatbot', canRead: true },
  ])
  await harness.db.insert(users).values([
    { id: SUPERADMIN.id, username: SUPERADMIN.username, email: null, passwordHash: 'x', roleId: 1 },
    { id: EDITOR.id, username: EDITOR.username, email: 'bientap@example.vn', passwordHash: 'x', roleId: 3 },
  ])
})

async function bothAnswers(account: typeof EDITOR) {
  const fromMe = await server.request('GET', '/api/admin/auth/me', { cookie: cookieFor(account) })
  const fromLogin = await server.request('POST', `/test/complete-login?username=${account.username}`)
  assert.equal(fromMe.status, 200, JSON.stringify(fromMe.body))
  assert.equal(fromLogin.status, 200, JSON.stringify(fromLogin.body))
  return { me: fromMe.body.user as Record<string, unknown>, login: fromLogin.body.user as Record<string, unknown> }
}

test('an editor: auth/me and a completed login send the same user, field for field', async () => {
  const { me: fromMe, login } = await bothAnswers(EDITOR)
  assert.deepEqual(fromMe, login)
  assert.deepEqual(Object.keys(login).sort(), ['email', 'id', 'isSuperAdmin', 'mfaEnforceAfter', 'mfaEnrollmentRequired', 'permissions', 'roleName', 'username'])
  assert.equal(login.roleName, EDITOR.roleName)
  assert.equal((login.permissions as unknown[]).length, 2)
})

test('a SuperAdmin with no email, under an MFA policy in its grace period: still the same object', async () => {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  await harness.db.insert(settings).values([
    { key: 'mfa_policy', value: 'all', group: 'security' },
    { key: 'mfa_enforce_after', value: start.toISOString(), group: 'security' },
  ])
  policy.clearMfaPolicyCache()
  const { me: fromMe, login } = await bothAnswers(SUPERADMIN)
  assert.deepEqual(fromMe, login)
  assert.equal(login.email, null)
  assert.equal(login.isSuperAdmin, true)
  assert.equal(login.mfaEnforceAfter, start.toISOString())
})
