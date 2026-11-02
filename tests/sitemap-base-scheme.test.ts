/**
 * Reported: "/sitemap.xml lists https://127.0.0.1:3000/… while the local site runs on http".
 * Investigated (docs/CHANGELOG.md § 70, KNOWN), and pinned here as the designed behaviour —
 * NOT changed:
 *
 *  - The scheme. The sitemap (served fallback, and the copy the admin page generates and saves)
 *    takes its base from `requestBase()` (server/utils/google-oauth/config.ts), which answers
 *    `https` unless a TRUSTED proxy says `X-Forwarded-Proto: http`. That default is deliberate:
 *    the same function builds the Google OAuth redirect URI and e-mail links, and a client must
 *    not be able to downgrade them (tests/google-oauth-forwarded-proto.test.ts). Production
 *    always sits behind the TLS nginx, which sends `https`. A browser talking straight to the
 *    app on http://127.0.0.1:3000 sends no forwarded header, so the default applies — the
 *    user's local container (TRUSTED_PROXY_IPS=172.16.0.0/12, PUBLIC_BASE_URL=https://…).
 *  - The host. It is the request's, not `PUBLIC_BASE_URL` (the route never reads it) and not
 *    checked against `PUBLIC_HOST_ALLOWLIST` the way `publicLinkBase()` checks e-mail links. So
 *    a sitemap generated while browsing the admin through 127.0.0.1 or an IP, and saved, lists
 *    that host for every visitor afterwards. Whether the sitemap should follow the canonical
 *    `PUBLIC_BASE_URL` instead is a product decision (multi-domain was the stated reason for
 *    the request host) — left to the owner.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

process.env.TRUSTED_PROXY_IPS = '127.0.0.1,172.16.0.0/12'
process.env.PUBLIC_BASE_URL = 'https://conduonghuongthien.com.vn'

mock.module('../server/utils/db', { namedExports: { getDb: () => { throw new Error('no database in this test') } } })
mock.module('../server/utils/logger', { namedExports: { logError: () => {}, logWarn: () => {}, logInfo: () => {}, SECURITY_EVENTS: {} } })

const headersSet: Record<string, string> = {}
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.setResponseHeader = (_event: unknown, name: string, value: string) => { headersSet[name] = value }

const sitemap = (await import('../server/routes/sitemap.xml')).default as unknown as (event: unknown) => Promise<string>
const eventFrom = (peer: string, headers: Record<string, string>) => ({ node: { req: { headers, socket: { remoteAddress: peer } } }, context: {} })
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]!)

describe('/sitemap.xml base (pinned as designed — KNOWN, not a code bug)', () => {
  it('a browser straight to the app over http (no forwarded header): https + the request host — the reported case', async () => {
    // Docker publishes 127.0.0.1:3000; the app sees the bridge gateway as its peer.
    const xml = await sitemap(eventFrom('172.18.0.1', { host: '127.0.0.1:3000' }))
    assert.equal(locs(xml)[0], 'https://127.0.0.1:3000/')
    assert.equal(headersSet['Content-Type'], 'application/xml; charset=utf-8')
  })

  it('behind a trusted proxy that declares http, the sitemap is http', async () => {
    const xml = await sitemap(eventFrom('127.0.0.1', { host: '127.0.0.1:3000', 'x-forwarded-proto': 'http' }))
    assert.equal(locs(xml)[0], 'http://127.0.0.1:3000/')
  })

  it('production shape — nginx on loopback, https, the public host: https://<domain>/', async () => {
    const xml = await sitemap(eventFrom('127.0.0.1', { host: 'conduonghuongthien.com.vn', 'x-forwarded-proto': 'https' }))
    assert.equal(locs(xml)[0], 'https://conduonghuongthien.com.vn/')
    assert.equal(locs(xml).length, 9)
  })

  it('an untrusted peer cannot downgrade it; PUBLIC_BASE_URL is not what decides the host', async () => {
    const xml = await sitemap(eventFrom('203.0.113.9', { host: 'other.example', 'x-forwarded-proto': 'http' }))
    assert.equal(locs(xml)[0], 'https://other.example/')
  })
})
