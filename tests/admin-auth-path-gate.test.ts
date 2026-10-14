import assert from 'node:assert/strict'
import { request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { after, before, mock } from 'node:test'

/**
 * `server/middleware/admin-auth.ts` decides "is this an admin API request" BEFORE
 * the router decides which handler runs. If the two read different spellings of
 * the path, a request can reach an admin handler without a session.
 *
 * That was the bug: the middleware compared `getRequestURL().pathname` (raw,
 * `%61dmin` intact) while h3 decodes the path before routing, so
 * `/api/%61dmin/users` was routed to the users handler with no token check. The
 * unit test in `admin-auth-middleware.test.ts` fakes the URL accessor and could
 * not see it.
 *
 * This file runs the REAL middleware inside a REAL h3 app + router on an
 * ephemeral port, with the real h3 helpers installed as the auto-import globals
 * Nitro would provide, and sends literal request lines over `node:http` (no
 * `fetch`/`URL`, which would normalise `..`, `%2e%2e` and `//` before they leave
 * the client and so test nothing). Every route handler is a sentinel that
 * counts invocations; the assertion that matters is "the sentinel never ran".
 */

process.env.JWT_SECRET = 'admin-auth-path-gate-test-secret-0123456789'

mock.module('../server/utils/logger', {
  namedExports: {
    logWarn: () => {},
    logInfo: () => {},
    logError: () => {},
    SECURITY_EVENTS: { mfaChallengeFailed: 'auth.mfa_challenge_failed', sessionRevoked: 'auth.session_revoked' },
  },
})

const { users, permissions } = await import('../server/db/schema')

let dbLookups = 0
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
          dbLookups += 1
          if (table === users) return query(() => [{ id: 7, username: 'editor', email: 'e@example.vn', isActive: true, roleId: 3, roleName: 'Biên tập viên', isSystem: false, tokenVersion: 0 }])
          if (table === permissions) return query(() => [{ resource: 'users', canRead: true }])
          return query(() => [])
        },
      }),
    }),
  },
})

const h3 = await import('h3')
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = h3.defineEventHandler
globals.getRequestURL = h3.getRequestURL
globals.getCookie = h3.getCookie
globals.createError = h3.createError

const middleware = (await import('../server/middleware/admin-auth')).default
const { signToken } = await import('../server/utils/auth')

/** Which sentinel ran, keyed by the route pattern that matched. */
const hits = new Map<string, number>()
const sentinel = (name: string) => h3.defineEventHandler(() => {
  hits.set(name, (hits.get(name) ?? 0) + 1)
  return { reached: name }
})

let server: Server
let port = 0

before(async () => {
  // Same wiring Nitro uses (`nitropack/dist/runtime/internal/app.mjs`): global
  // middleware mounted with `app.use(base, handler)`, then the router.
  const app = h3.createApp()
  app.use('/', middleware)
  const router = h3.createRouter()
  router.use('/api/admin/users', sentinel('admin-users'))
  router.use('/api/admin/users/**', sentinel('admin-users-any'))
  router.use('/api/admin/auth/login', sentinel('admin-login'))
  router.use('/api/admin/auth/me', sentinel('admin-me'))
  // A wildcard under the exempt endpoints' own directory: the route that would
  // absorb `/api/admin/auth/login#/../users` if the middleware cut at `#`.
  router.use('/api/admin/auth/**', sentinel('admin-auth-any'))
  router.use('/api/admin/**', sentinel('admin-any'))
  router.use('/api/public/articles', sentinel('public-articles'))
  // Catch-all so "sentinel count 0" can never be explained by a plain 404.
  router.use('/**', sentinel('catch-all'))
  app.use('/', router.handler)
  server = (await import('node:http')).createServer(h3.toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

/** Send the request line exactly as written — no client-side normalisation. */
function send(rawPath: string, cookie?: string, method = 'GET'): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: rawPath, headers: cookie ? { cookie } : {} }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

function totalHits(): number {
  let total = 0
  for (const value of hits.values()) total += value
  return total
}

const SPELLINGS_THAT_NEED_A_SESSION = [
  '/api/%61dmin/users',
  '/api/admin/%75sers',
  '/api/%61%64%6d%69%6e/%75%73%65%72%73',
  '/api/admin/users?x=1',
  '/api/admin/users#frag',
  '/api/admin/users/%2e%2e/users',
  '/api/admin/users/%2E%2E/users',
  '/api/admin/auth/login/../../users',
  '/api/admin/auth/login%2f..%2f..%2fusers',
  '//api/admin/users',
  '/api/admin/users%zz',
  '/api/admin/auth/login%zz',
  '/api/admin/auth/login/',
  '/api/admin/auth/loginx',
  '/api/admin/auth/me',
  '/api/admin/auth/%6de',
  '/api/admin/auth/logout',
]

for (const spelling of SPELLINGS_THAT_NEED_A_SESSION) {
  test(`no session: ${spelling} is refused and no handler runs`, async () => {
    hits.clear()
    dbLookups = 0
    const { status } = await send(spelling)
    assert.ok(status === 401 || status === 400, `expected 401/400, got ${status}`)
    assert.equal(totalHits(), 0, `a route handler ran for ${spelling}: ${JSON.stringify([...hits])}`)
    assert.equal(dbLookups, 0, 'nothing is loaded before the token check')
  })
}

test('the exempt login endpoint is reached without a session, plain or percent-encoded', async () => {
  for (const spelling of ['/api/admin/auth/login', '/api/admin/auth/log%69n', '/api/admin/auth/login?next=1']) {
    hits.clear()
    const { status, body } = await send(spelling)
    assert.equal(status, 200, spelling)
    assert.equal(hits.get('admin-login'), 1, `${spelling} must reach the login handler: ${body}`)
  }
})

test('non-admin paths are untouched: no gate, no token or database work', async () => {
  hits.clear()
  dbLookups = 0
  const { status } = await send('/api/public/articles')
  assert.equal(status, 200)
  assert.equal(hits.get('public-articles'), 1)
  const page = await send('/admin/login')
  assert.equal(page.status, 200)
  assert.equal(hits.get('catch-all'), 1, 'admin PAGES are guarded client-side; only /api/admin/ is gated here')
  assert.equal(dbLookups, 0)
})

test('a router that is case-insensitive would be a bypass — /API/admin/users never reaches an admin handler without a session', async () => {
  hits.clear()
  const { status } = await send('/API/admin/users')
  for (const name of ['admin-users', 'admin-users-any', 'admin-any']) {
    assert.equal(hits.get(name) ?? 0, 0, `/API/admin/users was routed to ${name} (status ${status}) without passing the gate`)
  }
})

test('a valid session passes the gate on every spelling the router accepts', async () => {
  const cookie = `cdkt_admin=${signToken({ userId: 7, username: 'editor', roleId: 3, roleName: 'Biên tập viên', tokenVersion: 0 })}`
  for (const spelling of ['/api/admin/users', '/api/%61dmin/users', '/api/admin/%75sers']) {
    hits.clear()
    const { status } = await send(spelling, cookie)
    assert.equal(status, 200, spelling)
    assert.equal(hits.get('admin-users'), 1, `${spelling} must reach the users handler once authenticated`)
  }
})

// ─── `#` in the path ───────────────────────────────────────────────────────────
//
// h3's router cuts the path at `?` only. The middleware used to cut at `?` AND
// `#`, so `/api/admin/auth/login#/../users` was classified as the exempt login
// endpoint while the router matched `/api/admin/auth/**` (or `/api/admin/**`) on
// the full path — a handler ran with no session. Browsers never send a fragment;
// raw clients do. Every method, because the exemption never looked at the method.

const HASH_SPELLINGS = [
  '/api/admin/auth/login#/../users',
  '/api/admin/auth/login#',
  '/api/admin/auth/login#x',
  '/api/admin/auth/captcha#/../../users',
  '/api/admin/auth/mfa/verify#/x',
  '/api/admin/auth/login%23/../users',
  '/api/admin/auth/login%23',
  '/api/admin/auth/log%69n%23x',
  '/api/admin/auth/login#?next=1',
]
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

for (const spelling of HASH_SPELLINGS) {
  test(`no session: ${spelling} is never exempt, for any method`, async () => {
    for (const method of METHODS) {
      hits.clear()
      dbLookups = 0
      const { status } = await send(spelling, undefined, method)
      assert.ok(status === 401 || status === 400, `${method} ${spelling}: expected 401/400, got ${status}`)
      assert.equal(totalHits(), 0, `${method} ${spelling}: a route handler ran: ${JSON.stringify([...hits])}`)
      assert.equal(dbLookups, 0)
    }
  })
}

test('a `#` or `%23` in the query string does not cost the login endpoint its exemption', async () => {
  for (const spelling of ['/api/admin/auth/login?next=%23x', '/api/admin/auth/login?next=a#b']) {
    hits.clear()
    const { status } = await send(spelling, undefined, 'POST')
    assert.equal(status, 200, spelling)
    assert.equal(hits.get('admin-login'), 1, spelling)
  }
})

test('the exempt endpoints still work for every method on their plain spelling', async () => {
  for (const method of METHODS) {
    hits.clear()
    const { status } = await send('/api/admin/auth/login', undefined, method)
    assert.equal(status, 200, method)
    assert.equal(hits.get('admin-login'), 1, method)
  }
})
