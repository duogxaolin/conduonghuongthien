import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { mock } from 'node:test'
import * as h3 from 'h3'

/**
 * When the admin, MFA, reader and OAuth-state cookies carry `Secure` (spec
 * session-cookies, design D5).
 *
 * Four call sites each wrote their own test: `x-forwarded-proto === 'https'` from
 * ANY peer, or `getRequestURL().protocol` — which h3 also derives from that same
 * header. Two failures followed from it:
 *  - production behind a proxy that does not send the header (or sends it under a
 *    different name) issued the session cookie WITHOUT `Secure`, silently;
 *  - any client could claim `https` itself, because the header was honoured
 *    whoever sent it.
 *
 * Now one rule, `isSecureRequest` (server/utils/request-secure.ts): the forwarded
 * protocol counts only from a configured trusted proxy (client-ip.ts rules), and
 * production defaults to `Secure` unless that proxy explicitly says `http`.
 *
 * The REAL cookie writers run here against h3 events: `setSessionCookie`,
 * `setChallengeCookie`, `setReaderCookie`, and the two OAuth `start` handlers.
 */

process.env.JWT_SECRET = 'test-only-jwt-secret-for-cookie-secure-flag'
delete process.env.TRUSTED_PROXY_IPS // default trust: loopback only

mock.module('../server/utils/db', { namedExports: { getDb: () => ({}) } })
mock.module('../server/services/google-oauth-settings', {
  namedExports: { getUsableOAuthConfig: async () => ({ ok: true, clientId: 'reader-client-id' }) },
})
mock.module('../server/services/backup-drive-oauth-config', {
  namedExports: { getUsableDriveOauthConfig: async () => ({ ok: true, clientId: 'drive-client-id' }) },
})
mock.module('../server/services/ip-bans', { namedExports: { loadIpBanValues: async () => [] } })
mock.module('../server/utils/rate-limit-store', { namedExports: { recordRateLimitHit: async () => ({ blocked: false, retryAfterSeconds: 0 }) } })
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({}) } })
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {}, requireSuperAdmin: () => {} } })

// Nitro auto-imports, bound to the real h3 implementations.
const globals = globalThis as unknown as Record<string, unknown>
for (const name of ['getRequestHeader', 'getRequestURL', 'getQuery', 'setCookie', 'deleteCookie', 'getCookie', 'createError'] as const) {
  globals[name] = h3[name]
}
globals.defineEventHandler = (handler: unknown) => handler
globals.sendRedirect = (_event: unknown, location: string) => location

const { setSessionCookie, setChallengeCookie } = await import('../server/utils/mfa/session.ts')
const { setReaderCookie } = await import('../server/utils/reader-auth.ts')
const readerStart = (await import('../server/api/auth/google/start.get.ts')).default as unknown as (event: h3.H3Event) => Promise<unknown>
const driveStart = (await import('../server/api/admin/backup/drive/start.get.ts')).default as unknown as (event: h3.H3Event) => Promise<unknown>

type Scenario = {
  env: 'production' | 'development'
  peer: string
  proto?: string
  encrypted?: boolean
}

function eventFor(s: Scenario): h3.H3Event {
  const headers: Record<string, string> = { host: 'portal.example.vn' }
  if (s.proto !== undefined) headers['x-forwarded-proto'] = s.proto
  const responseHeaders = new Map<string, string | string[]>()
  const req = { method: 'GET', url: '/api/x', headers, socket: { remoteAddress: s.peer }, connection: { encrypted: s.encrypted === true } }
  const res = {
    statusCode: 200,
    getHeader: (name: string) => responseHeaders.get(name.toLowerCase()),
    setHeader: (name: string, value: string | string[]) => { responseHeaders.set(name.toLowerCase(), value) },
    removeHeader: (name: string) => { responseHeaders.delete(name.toLowerCase()) },
    appendHeader: (name: string, value: string) => {
      const key = name.toLowerCase()
      const current = responseHeaders.get(key)
      responseHeaders.set(key, current === undefined ? [value] : [...(Array.isArray(current) ? current : [current]), value])
    },
  }
  const event = h3.createEvent(req as never, res as never)
  event.context.adminUser = { id: 1, isSuperAdmin: true }
  return event
}

function setCookieLines(event: h3.H3Event): string[] {
  const value = event.node.res.getHeader('set-cookie')
  return value === undefined ? [] : (Array.isArray(value) ? value.map(String) : [String(value)])
}

const SESSION_USER = { id: 1, username: 'officer', email: null, roleId: 1, roleName: 'SuperAdmin', isSystem: true, tokenVersion: 0 }

/** Each writer, run once on a fresh event, returning the cookie line it set. */
const WRITERS: Record<string, (event: h3.H3Event) => Promise<void> | void> = {
  'cdkt_admin (setSessionCookie)': (event) => { setSessionCookie(event, SESSION_USER) },
  'cdkt_mfa (setChallengeCookie)': (event) => { setChallengeCookie(event, SESSION_USER) },
  'cdkt_reader (setReaderCookie)': (event) => { setReaderCookie(event, 'ticket') },
  'OAuth state (auth/google/start)': async (event) => { await readerStart(event) },
  'Drive OAuth state (backup/drive/start)': async (event) => { await driveStart(event) },
}

async function secureFlags(s: Scenario): Promise<Record<string, boolean>> {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = s.env
  try {
    const out: Record<string, boolean> = {}
    for (const [name, write] of Object.entries(WRITERS)) {
      const event = eventFor(s)
      await write(event)
      const lines = setCookieLines(event)
      assert.equal(lines.length, 1, `${name}: expected exactly one Set-Cookie, got ${JSON.stringify(lines)}`)
      out[name] = /;\s*Secure(;|$)/i.test(lines[0]!)
    }
    return out
  } finally {
    process.env.NODE_ENV = previous
  }
}

const allSecure = (flags: Record<string, boolean>, expected: boolean, label: string) => {
  for (const [name, secure] of Object.entries(flags)) assert.equal(secure, expected, `${label}: ${name} Secure=${secure}`)
}

test('production behind the trusted loopback proxy, no x-forwarded-proto → Secure', async () => {
  allSecure(await secureFlags({ env: 'production', peer: '127.0.0.1' }), true, 'prod, no header')
})

test('development, plain HTTP from an untrusted peer claiming https → NOT Secure', async () => {
  allSecure(await secureFlags({ env: 'development', peer: '203.0.113.7', proto: 'https' }), false, 'dev, forged https')
})

test('production, the trusted proxy says http → NOT Secure', async () => {
  allSecure(await secureFlags({ env: 'production', peer: '127.0.0.1', proto: 'http' }), false, 'prod, trusted http')
})

test('production, an UNTRUSTED peer saying http cannot downgrade the cookie', async () => {
  allSecure(await secureFlags({ env: 'production', peer: '203.0.113.7', proto: 'http' }), true, 'prod, untrusted http')
})

test('development: Secure exactly when the URL is https or the trusted proxy says https', async () => {
  allSecure(await secureFlags({ env: 'development', peer: '127.0.0.1' }), false, 'dev, plain http')
  allSecure(await secureFlags({ env: 'development', peer: '127.0.0.1', proto: 'https' }), true, 'dev, trusted https')
  allSecure(await secureFlags({ env: 'development', peer: '203.0.113.7', encrypted: true }), true, 'dev, TLS socket')
})

test('isSecureRequest reads the client-facing (leftmost) hop of a forwarded list, case-insensitively', async () => {
  const { isSecureRequest } = await import('../server/utils/request-secure.ts')
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    assert.equal(isSecureRequest(eventFor({ env: 'production', peer: '127.0.0.1', proto: 'http, https' })), false)
    assert.equal(isSecureRequest(eventFor({ env: 'production', peer: '127.0.0.1', proto: 'HTTP' })), false)
    assert.equal(isSecureRequest(eventFor({ env: 'production', peer: '127.0.0.1', proto: 'https, http' })), true)
  } finally {
    process.env.NODE_ENV = previous
  }
})

test('the four call sites decide through isSecureRequest and never read x-forwarded-proto themselves', () => {
  for (const path of [
    'server/utils/mfa/session.ts',
    'server/utils/reader-auth.ts',
    'server/api/auth/google/start.get.ts',
    'server/api/admin/backup/drive/start.get.ts',
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.match(source, /secure:\s*isSecureRequest\(event\)/, `${path} must use isSecureRequest`)
    assert.doesNotMatch(source, /x-forwarded-proto/i, `${path} reads the forwarded header itself`)
  }
})
