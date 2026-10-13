import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * `server/middleware/admin-auth.ts` is the single gate in front of every
 * `/api/admin/**` route (282 of them). Until now it was only checked by reading its
 * source. These tests run it, with real signed tokens and a fake database, through
 * every branch that decides "in" or "out".
 */

process.env.JWT_SECRET = 'admin-auth-middleware-test-secret-0123456789'

const warnings: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    logWarn: (entry: Record<string, unknown>) => { warnings.push(entry) },
    logInfo: () => {},
    logError: () => {},
    SECURITY_EVENTS: { mfaChallengeFailed: 'mfa.challenge_failed', sessionRevoked: 'session.revoked' },
  },
})

const { users, permissions } = await import('../server/db/schema')

type UserRow = { id: number, username: string, email: string, isActive: boolean | null, roleId: number | null, roleName: string, isSystem: boolean | null, tokenVersion: number | null } | null
let currentUser: UserRow = null
let currentPermissions: Array<Record<string, unknown>> = []
let permissionLookups = 0

/** `where()` is both chainable (`.limit(1)`) and awaitable, like a drizzle query. */
function query(rows: () => unknown[]) {
  const chain = {
    leftJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows()),
    then: (resolve: (value: unknown[]) => unknown) => resolve(rows()),
  }
  return chain
}

mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => {
          if (table === users) return query(() => (currentUser ? [currentUser] : []))
          if (table === permissions) { permissionLookups += 1; return query(() => currentPermissions) }
          return query(() => [])
        },
      }),
    }),
  },
})

type Stub = (event: Event) => unknown
type Event = { url: string, cookies: Record<string, string>, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getRequestURL = (event: Event) => new URL(event.url, 'http://localhost')
globals.getCookie = (event: Event, name: string) => event.cookies[name]
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const { signMfaChallenge, signToken } = await import('../server/utils/auth')
const handler = (await import('../server/middleware/admin-auth')).default as unknown as Stub

const ADMIN: NonNullable<UserRow> = { id: 7, username: 'editor', email: 'e@example.vn', isActive: true, roleId: 3, roleName: 'Biên tập viên', isSystem: false, tokenVersion: 0 }
const sessionToken = (overrides: Record<string, unknown> = {}) => signToken({ userId: 7, username: 'editor', roleId: 3, roleName: 'Biên tập viên', tokenVersion: 0, ...overrides })

const eventFor = (url: string, token?: string): Event => ({ url, cookies: token ? { cdkt_admin: token } : {}, context: {} })

async function statusOf(event: Event): Promise<number | null> {
  try { await handler(event); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

function reset() {
  currentUser = { ...ADMIN }
  currentPermissions = [{ resource: 'news', canRead: true }]
  permissionLookups = 0
  warnings.length = 0
}

test('routes outside /api/admin are not this middleware\'s business', async () => {
  reset()
  assert.equal(await statusOf(eventFor('/api/public/articles')), null)
  assert.equal(await statusOf(eventFor('/admin/login')), null, 'the admin PAGES are guarded client-side; only /api/admin/ is')
  assert.equal(permissionLookups, 0)
})

test('only the login-flow endpoints are open without a session', async () => {
  reset()
  for (const open of ['/api/admin/auth/login', '/api/admin/auth/captcha', '/api/admin/auth/mfa/verify', '/api/admin/auth/mfa/send-code']) {
    assert.equal(await statusOf(eventFor(open)), null, open)
  }
  // Look-alikes and siblings are NOT exempt.
  for (const closed of ['/api/admin/auth/login/', '/api/admin/auth/loginx', '/api/admin/auth/me', '/api/admin/auth/logout', '/api/admin/auth/mfa/other', '/api/admin/users', '/api/admin/']) {
    assert.equal(await statusOf(eventFor(closed)), 401, closed)
  }
})

test('no cookie, a garbage cookie and a token signed with another secret are all refused', async () => {
  reset()
  assert.equal(await statusOf(eventFor('/api/admin/users')), 401)
  assert.equal(await statusOf(eventFor('/api/admin/users', 'not-a-jwt')), 401)
  const jwt = (await import('jsonwebtoken')).default
  const forged = jwt.sign({ userId: 7, username: 'editor', roleId: 3, roleName: 'x', tokenVersion: 0 }, 'some-other-secret', { expiresIn: '1h' })
  assert.equal(await statusOf(eventFor('/api/admin/users', forged)), 401)
  const expired = jwt.sign({ userId: 7, username: 'editor', roleId: 3, roleName: 'x', tokenVersion: 0 }, process.env.JWT_SECRET!, { expiresIn: -10 })
  assert.equal(await statusOf(eventFor('/api/admin/users', expired)), 401)
  assert.equal(permissionLookups, 0, 'nothing is loaded for a request that fails the token check')
})

test('an MFA challenge ticket is not a session, even though its signature is valid', async () => {
  reset()
  const ticket = signMfaChallenge({ userId: 7, username: 'editor', tokenVersion: 0 })
  assert.equal(await statusOf(eventFor('/api/admin/users', ticket)), 401)
  assert.ok(
    warnings.some(entry => entry.reason === 'challenge_token_used_as_session' && entry.userId === 7),
    'using a challenge ticket as a session must leave a security trail',
  )
  assert.equal(permissionLookups, 0)
})

test('a reader token cannot open the admin API', async () => {
  reset()
  const jwt = (await import('jsonwebtoken')).default
  const reader = jwt.sign({ userId: 7, username: 'editor', roleId: 3, roleName: 'x', tokenVersion: 0, stage: 'reader' }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  assert.equal(await statusOf(eventFor('/api/admin/users', reader)), 401)
})

test('a deleted or deactivated user is refused even with a valid token', async () => {
  reset()
  const token = sessionToken()
  currentUser = null
  assert.equal(await statusOf(eventFor('/api/admin/users', token)), 401, 'user no longer exists')
  currentUser = { ...ADMIN, isActive: false }
  assert.equal(await statusOf(eventFor('/api/admin/users', token)), 401, 'user deactivated')
  currentUser = { ...ADMIN, isActive: null }
  assert.equal(await statusOf(eventFor('/api/admin/users', token)), 401, 'a null flag is not "active"')
})

test('a session minted before the last logout or password change is revoked', async () => {
  reset()
  currentUser = { ...ADMIN, tokenVersion: 2 }
  assert.equal(await statusOf(eventFor('/api/admin/users', sessionToken({ tokenVersion: 1 }))), 401)
  assert.ok(warnings.some(entry => entry.event === 'session.revoked' && entry.userId === 7))
  // The other direction too: a token claiming a NEWER generation than the account has.
  currentUser = { ...ADMIN, tokenVersion: 0 }
  assert.equal(await statusOf(eventFor('/api/admin/users', sessionToken({ tokenVersion: 5 }))), 401)
})

test('a token from before the version claim existed reads as generation 0', async () => {
  reset()
  const jwt = (await import('jsonwebtoken')).default
  const legacy = jwt.sign({ userId: 7, username: 'editor', roleId: 3, roleName: 'x' }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  currentUser = { ...ADMIN, tokenVersion: 0 }
  assert.equal(await statusOf(eventFor('/api/admin/users', legacy)), null, 'live sessions survive the deploy that added the claim')
  currentUser = { ...ADMIN, tokenVersion: 1 }
  assert.equal(await statusOf(eventFor('/api/admin/users', legacy)), 401, '…but not a later revocation')
})

test('a valid session attaches the user with their role permissions', async () => {
  reset()
  currentPermissions = [{ resource: 'news', canRead: true }, { resource: 'media', canRead: true, canUpdate: true }]
  const event = eventFor('/api/admin/articles', sessionToken())
  assert.equal(await statusOf(event), null)
  const adminUser = event.context.adminUser as Record<string, unknown>
  assert.equal(adminUser.id, 7)
  assert.equal(adminUser.username, 'editor')
  assert.deepEqual((adminUser.permissions as Array<{ resource: string }>).map(permission => permission.resource), ['news', 'media'])
  assert.equal(adminUser.isSuperAdmin, false)
  assert.equal(permissionLookups, 1)
})

test('super-admin comes from the role being a system role, not from anything in the token', async () => {
  reset()
  currentUser = { ...ADMIN, isSystem: true }
  const event = eventFor('/api/admin/users', sessionToken({ roleName: 'Biên tập viên' }))
  await handler(event)
  assert.equal((event.context.adminUser as { isSuperAdmin: boolean }).isSuperAdmin, true)

  // A token that CLAIMS a system role name gains nothing if the database says otherwise.
  currentUser = { ...ADMIN, isSystem: false }
  const claimed = eventFor('/api/admin/users', sessionToken({ roleName: 'SuperAdmin', roleId: 1 }))
  await handler(claimed)
  assert.equal((claimed.context.adminUser as { isSuperAdmin: boolean }).isSuperAdmin, false)
  assert.equal((claimed.context.adminUser as { roleName: string }).roleName, 'Biên tập viên', 'identity comes from the database row')
})

test('isSystem null or undefined is never super-admin', async () => {
  reset()
  currentUser = { ...ADMIN, isSystem: null }
  const event = eventFor('/api/admin/users', sessionToken())
  await handler(event)
  assert.equal((event.context.adminUser as { isSuperAdmin: boolean }).isSuperAdmin, false)
})
