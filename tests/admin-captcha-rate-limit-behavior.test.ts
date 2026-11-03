import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `GET /api/admin/auth/captcha` (server/api/admin/auth/captcha.get.ts) — the login
 * captcha.
 *
 * It answers without a session (the login page needs it before anyone is signed in),
 * and every answer puts an entry in an in-process store, so without its own limit it
 * is a memory-growth endpoint open to the internet. Invariants:
 *   - reachable without a session, through the real admin gate;
 *   - ten per minute per client address; the eleventh is a 429 with `Retry-After`
 *     and carries no captcha;
 *   - the limit is per address: one client being stopped does not stop another;
 *   - the window ends a minute after the first hit, however hard the client keeps
 *     knocking in between (neither earlier nor later).
 *
 * Real h3 app with the real `admin-auth` middleware, the real `getClientIp` (the
 * test talks over loopback, a trusted proxy by default, so `X-Forwarded-For` names
 * the client, as nginx does in production), the real `rate-limit-store` on its
 * memory backend with a test clock, and the real `svg-captcha`.
 */

process.env.JWT_SECRET = 'admin-captcha-rate-limit-test-secret-0123456789'
delete process.env.TRUSTED_PROXY_IPS

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => { throw new Error('the captcha endpoint must not need the database') }, getPool: () => null } })
let memory = new Map<string, { count: number, expiresAt: number }>()
let clock = Date.parse('2026-10-25T08:00:00Z')
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({ execute: null, memory, now: () => clock }) } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const captcha = (await import('../server/api/admin/auth/captcha.get')).default

const server = await startHandlerServer([{ method: 'get', path: '/api/admin/auth/captcha', handler: captcha }], [adminAuth])
after(() => server.close())

const fetchCaptcha = (client = '203.0.113.5') =>
  server.request('GET', '/api/admin/auth/captcha', { headers: { 'x-forwarded-for': client } })

beforeEach(() => {
  memory = new Map()
  clock = Date.parse('2026-10-25T08:00:00Z')
})

test('no session needed: an anonymous client gets a fresh captcha each time', async () => {
  const first = await fetchCaptcha()
  const second = await fetchCaptcha()
  assert.equal(first.status, 200)
  assert.match(String(first.body.svg), /^<svg[\s>]/)
  assert.match(String(first.body.captchaId), /^[0-9a-f-]{36}$/)
  assert.notEqual(first.body.captchaId, second.body.captchaId)
})

test('ten per minute per address; the eleventh is a 429 with Retry-After and no captcha', async () => {
  for (let index = 1; index <= 10; index += 1) {
    assert.equal((await fetchCaptcha()).status, 200, `request ${index}`)
  }
  const refused = await fetchCaptcha()
  assert.equal(refused.status, 429)
  const retryAfter = Number(refused.headers.get('retry-after'))
  assert.ok(retryAfter >= 1 && retryAfter <= 60, `Retry-After ${retryAfter}`)
  assert.ok(!('svg' in refused.body) && !('captchaId' in refused.body), 'a refused request still handed out a captcha')
})

test('the limit is per address: one client being stopped does not stop another', async () => {
  for (let index = 1; index <= 10; index += 1) await fetchCaptcha('203.0.113.5')
  assert.equal((await fetchCaptcha('203.0.113.5')).status, 429)
  assert.equal((await fetchCaptcha('198.51.100.7')).status, 200)
})

test('the window ends a minute after the first hit, however hard the client keeps knocking', async () => {
  for (let index = 1; index <= 10; index += 1) await fetchCaptcha()
  clock += 30_000
  for (let index = 1; index <= 5; index += 1) assert.equal((await fetchCaptcha()).status, 429)
  clock += 29_000
  assert.equal((await fetchCaptcha()).status, 429, 'released before the minute was up')
  clock += 1_001
  assert.equal((await fetchCaptcha()).status, 200, 'still refused after the window: the knocking extended it')
})
