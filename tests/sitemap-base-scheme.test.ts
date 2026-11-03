/**
 * Reported: "/sitemap.xml lists https://127.0.0.1:3000/… while the local site runs on http".
 * Investigated (docs/CHANGELOG.md § 70). Pinned here, as the designed behaviour of the
 * PER-REQUEST fallback `/sitemap.xml` serves while nothing is saved (multi-domain, computed for
 * each request, never stored):
 *
 *  - The scheme. The fallback takes its base from `requestBase()`
 *    (server/utils/google-oauth/config.ts), which answers
 *    `https` unless a TRUSTED proxy says `X-Forwarded-Proto: http`. That default is deliberate:
 *    the same function builds the Google OAuth redirect URI and e-mail links, and a client must
 *    not be able to downgrade them (tests/google-oauth-forwarded-proto.test.ts). Production
 *    always sits behind the TLS nginx, which sends `https`. A browser talking straight to the
 *    app on http://127.0.0.1:3000 sends no forwarded header, so the default applies — the
 *    user's local container (TRUSTED_PROXY_IPS=172.16.0.0/12, PUBLIC_BASE_URL=https://…).
 *  - The host. The fallback's is the request's (each domain gets its own; nothing is stored).
 *    The copy the admin page GENERATES is another matter: it is saved and then served to
 *    everyone, so a copy generated through 127.0.0.1 published that host — the reported case.
 *    That copy now takes its base from `publicLinkBase()` (owner's decision):
 *    tests/sitemap-generate-link-base.test.ts.
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

// `/robots.txt` names the sitemap of the domain the crawler asked (multi-domain, computed per
// request, never stored) — `requestBase`, deliberately NOT `publicLinkBase` (that one is for
// the copy the admin page saves: tests/sitemap-generate-link-base.test.ts).
const robots = (await import('../server/routes/robots.txt')).default as unknown as (event: unknown) => string
const sitemapLine = (text: string) => text.split('\n').find(line => line.startsWith('Sitemap:'))

describe('/robots.txt: the Sitemap line follows the request, per domain', () => {
  it('a second domain (not PUBLIC_BASE_URL\'s, no allowlist) gets its own sitemap, not the configured one', () => {
    assert.equal(sitemapLine(robots(eventFrom('203.0.113.9', { host: 'other.example' }))), 'Sitemap: https://other.example/sitemap.xml')
    assert.equal(headersSet['Content-Type'], 'text/plain; charset=utf-8')
  })

  it('production shape: nginx on loopback, https, the public host', () => {
    assert.equal(sitemapLine(robots(eventFrom('127.0.0.1', { host: 'conduonghuongthien.vn', 'x-forwarded-proto': 'https' }))), 'Sitemap: https://conduonghuongthien.vn/sitemap.xml')
  })

  it('keeps the admin and admin API out of the index', () => {
    const text = robots(eventFrom('127.0.0.1', { host: 'conduonghuongthien.vn' }))
    assert.match(text, /^Disallow: \/admin$/m)
    assert.match(text, /^Disallow: \/api\/admin$/m)
  })
})
