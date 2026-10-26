import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `POST /api/admin/auth/logout` (server/api/admin/auth/logout.post.ts).
 *
 * The invariant is that the TOKEN dies, not just the cookie. Clearing the cookie
 * alone leaves a copied token usable for the rest of its 8-hour life; the handler
 * bumps `users.token_version`, and the admin gate compares that on every request.
 *
 * So this suite runs both halves for real, in one h3 app over a socket:
 * `server/middleware/admin-auth.ts` in front, the logout handler behind it, and a
 * probe route standing in for "any other admin endpoint". The database is the
 * real Drizzle SQL on SQLite (`_sqlite-mysql-db.ts`), so the `WHERE id = ?` on the
 * bump is what decides whose sessions end.
 *
 * Not pinned: audit-and-bump atomicity. logout writes a cookie between its writes
 * and is a named exemption in `tests/reader-audit-atomicity.test.ts`.
 */

process.env.JWT_SECRET = 'admin-logout-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const schema = await import('../server/db/schema')
const { roles, permissions, users, settings, userMfaFactors, activityLogs } = schema
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs])

const logged: Array<{ level: string, entry: Record<string, unknown> }> = []
mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: (entry: Record<string, unknown>) => { logged.push({ level: 'info', entry }) },
    logWarn: (entry: Record<string, unknown>) => { logged.push({ level: 'warn', entry }) },
    logError: (entry: Record<string, unknown>) => { logged.push({ level: 'error', entry }) },
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const h3 = await import('h3')
const middleware = (await import('../server/middleware/admin-auth')).default
const logout = (await import('../server/api/admin/auth/logout.post')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'post', path: '/api/admin/auth/logout', handler: logout },
  { method: 'get', path: '/api/admin/users', handler: h3.defineEventHandler(event => ({ userId: (event.context.adminUser as { id: number }).id })) },
], [middleware])
after(() => server.close())

type Account = { id: number, username: string, tokenVersion: number }
const ALICE: Account = { id: 1, username: 'alice', tokenVersion: 0 }
const BOB: Account = { id: 2, username: 'bob', tokenVersion: 0 }
const cookieFor = (account: Account, tokenVersion = account.tokenVersion) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: 2, roleName: 'Biên tập viên', tokenVersion })}`

const tokenVersionOf = (id: number) => harness.rows(users).find(row => row.id === id)?.tokenVersion
const probe = (cookie: string) => server.request('GET', '/api/admin/users', { cookie })

beforeEach(async () => {
  harness.reset()
  logged.length = 0
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values({ id: 2, name: 'Biên tập viên', isSystem: false })
  await harness.db.insert(permissions).values({ roleId: 2, resource: 'news', canRead: true })
  await harness.db.insert(users).values([
    { id: ALICE.id, username: ALICE.username, email: 'alice@example.vn', passwordHash: 'x', roleId: 2 },
    { id: BOB.id, username: BOB.username, email: 'bob@example.vn', passwordHash: 'x', roleId: 2 },
  ])
})

test('after logout the token that was used opens nothing — the token is dead, not just the cookie', async () => {
  const cookie = cookieFor(ALICE)
  assert.equal((await probe(cookie)).status, 200, 'precondition: the session works')

  const response = await server.request('POST', '/api/admin/auth/logout', { cookie })
  assert.equal(response.status, 200)
  const cleared = response.cookies.get('cdkt_admin')
  assert.ok(cleared, 'logout must clear the session cookie')
  assert.equal(cleared.value, '')

  // A client that kept a copy of the token (a stolen cookie) replays it.
  const replay = await probe(cookie)
  assert.equal(replay.status, 401, 'the old token still opens admin routes after logout')
  assert.equal(tokenVersionOf(ALICE.id), 1)
})

test('logout ends every session of that account, not only the one that asked', async () => {
  const laptop = cookieFor(ALICE)
  const phone = cookieFor(ALICE)
  await server.request('POST', '/api/admin/auth/logout', { cookie: laptop })
  assert.equal((await probe(phone)).status, 401, 'a second device kept its session')
})

test('only the caller\'s sessions end: another account keeps working', async () => {
  const bob = cookieFor(BOB)
  await server.request('POST', '/api/admin/auth/logout', { cookie: cookieFor(ALICE) })
  assert.equal(tokenVersionOf(BOB.id), 0)
  const response = await probe(bob)
  assert.equal(response.status, 200, 'logging Alice out signed Bob out too')
  assert.equal(response.body.userId, BOB.id)
})

test('a session issued after the logout works (the generation moved, it did not lock the account)', async () => {
  await server.request('POST', '/api/admin/auth/logout', { cookie: cookieFor(ALICE) })
  assert.equal((await probe(cookieFor(ALICE, 1))).status, 200)
})

test('the logout is audited against the caller, with the resolved client IP', async () => {
  await server.request('POST', '/api/admin/auth/logout', { cookie: cookieFor(ALICE) })
  const rows = harness.rows(activityLogs)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.userId, ALICE.id)
  assert.equal(rows[0]!.action, 'logout')
  assert.equal(rows[0]!.resource, 'auth')
  assert.deepEqual(rows[0]!.meta, { ip: '127.0.0.1' })
})

test('without a valid session nothing is written: no token bump, no audit row', async () => {
  harness.statements.length = 0
  assert.equal((await server.request('POST', '/api/admin/auth/logout')).status, 401)
  assert.equal((await server.request('POST', '/api/admin/auth/logout', { cookie: 'cdkt_admin=not-a-token' })).status, 401)
  assert.ok(!harness.statements.some(sql => /^(update|insert|delete)/.test(sql)), harness.statements.join('\n'))
  assert.deepEqual([tokenVersionOf(ALICE.id), tokenVersionOf(BOB.id)], [0, 0])
})

test('a failed audit write does not undo the logout: the token is still dead and the gap is logged', async () => {
  const cookie = cookieFor(ALICE)
  harness.failNext(/^insert into `activity_logs`/)
  const response = await server.request('POST', '/api/admin/auth/logout', { cookie })
  assert.equal(response.status, 200)
  assert.equal(response.cookies.get('cdkt_admin')?.value, '')
  assert.equal((await probe(cookie)).status, 401)
  assert.ok(logged.some(({ level, entry }) => level === 'warn' && entry.event === 'auth.logout_audit_failed' && entry.userId === ALICE.id))
})

test('when the bump fails the cookie is still cleared and the failure is logged as an error, never silent', async () => {
  harness.failNext(/^update `users` set `token_version`/)
  const response = await server.request('POST', '/api/admin/auth/logout', { cookie: cookieFor(ALICE) })
  assert.equal(response.status, 200)
  assert.equal(response.cookies.get('cdkt_admin')?.value, '')
  assert.ok(
    logged.some(({ level, entry }) => level === 'error' && entry.event === 'auth.logout_token_invalidation_failed' && entry.userId === ALICE.id),
    'a token that survived logout must leave an error-level trace',
  )
})
