/**
 * The sitemap the admin page generates — `POST /api/admin/settings/sitemap/generate` and the
 * `generated` copy of `GET /api/admin/settings/sitemap` — is SAVED (`index.put.ts`) and then served
 * verbatim to every visitor and crawler (`server/routes/sitemap.xml.ts`). Its base URL came from
 * `requestBase(event)`: an officer working through http://127.0.0.1:3000 or the server's IP, who
 * then pressed "Lưu", published that host to everyone (the user saw https://127.0.0.1:3000 —
 * docs/CHANGELOG.md § 70). Both now take it from `publicLinkBase(event)`
 * (server/utils/public-link-base.ts, the rule e-mail links already follow): the request's host
 * only when it is in `PUBLIC_HOST_ALLOWLIST` or is the host of `PUBLIC_BASE_URL`, otherwise
 * `PUBLIC_BASE_URL`; both empty → the old behaviour, with one `security.link_host_unchecked` log.
 *
 * Not changed, by design (multi-domain, computed per request, never stored): `/robots.txt` and
 * the per-request fallback of `/sitemap.xml` (tests/sitemap-base-scheme.test.ts), and
 * `requestBase()`'s https default.
 *
 * The REAL two handlers and the real `publicLinkBase`/`requestBase`; `generateSitemap` records the
 * base it is given (what it builds from a base is tested in
 * tests/settings-navigation-sitemap-read-behavior.test.ts).
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

process.env.TRUSTED_PROXY_IPS = '127.0.0.1'
delete process.env.PUBLIC_BASE_URL
delete process.env.PUBLIC_HOST_ALLOWLIST

const bases: string[] = []
mock.module('../server/utils/sitemap-builder', { namedExports: { generateSitemap: async (base: string) => { bases.push(base); return `<urlset base="${base}"/>` } } })
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })
const noRows = { select: () => ({ from: () => ({ where: async () => [] }) }) }
mock.module('../server/utils/db', { namedExports: { getDb: () => noRows } })

const logged: string[] = []
mock.method(console, 'error', (line: unknown) => { logged.push(String(line)) })

const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler

type Handler = (event: unknown) => Promise<{ xml?: string, generated?: string }>
const generate = (await import('../server/api/admin/settings/sitemap/generate.post')).default as unknown as Handler
const read = (await import('../server/api/admin/settings/sitemap/index.get')).default as unknown as Handler

const eventFrom = (peer: string, headers: Record<string, string>) => ({
  node: { req: { headers, socket: { remoteAddress: peer } } },
  context: { adminUser: { id: 1, isSuperAdmin: true } },
})
/** The base each of the two endpoints builds on, for one request. */
async function basesFor(peer: string, headers: Record<string, string>) {
  bases.length = 0
  const fromGenerate = await generate(eventFrom(peer, headers))
  const fromRead = await read(eventFrom(peer, headers))
  assert.equal(fromGenerate.xml, `<urlset base="${bases[0]}"/>`)
  assert.equal(fromRead.generated, `<urlset base="${bases[1]}"/>`)
  return [...bases]
}
function configure(publicBaseUrl: string, allowlist: string) {
  process.env.PUBLIC_BASE_URL = publicBaseUrl
  process.env.PUBLIC_HOST_ALLOWLIST = allowlist
}
const events = (name: string) => logged.filter(line => line.includes(`"${name}"`))

// Docker publishes the app on 127.0.0.1:3000; a browser there sends no forwarded header and the
// app sees the bridge gateway as its peer (untrusted here).
const LOCAL = ['172.18.0.1', { host: '127.0.0.1:3000' }] as const

describe('the saved sitemap\'s base follows publicLinkBase', () => {
  // First: the "unchecked" warning is logged once per process.
  it('nothing configured (both empty): the request\'s base as before, and security.link_host_unchecked is logged', async () => {
    configure('', '')
    assert.deepEqual(await basesFor(...LOCAL), ['https://127.0.0.1:3000', 'https://127.0.0.1:3000'])
    assert.equal(events('security.link_host_unchecked').length, 1)
  })

  it('a host neither allowlisted nor PUBLIC_BASE_URL\'s (127.0.0.1, an IP): PUBLIC_BASE_URL — the reported case', async () => {
    configure('https://conduonghuongthien.com.vn', '')
    assert.deepEqual(await basesFor(...LOCAL), ['https://conduonghuongthien.com.vn', 'https://conduonghuongthien.com.vn'])
    assert.deepEqual(await basesFor('203.0.113.5', { host: '203.0.113.5' }), ['https://conduonghuongthien.com.vn', 'https://conduonghuongthien.com.vn'])
    assert.ok(events('security.link_host_rejected').some(line => line.includes('127.0.0.1:3000')))
    // An http PUBLIC_BASE_URL (a local .env) is taken as written.
    configure('http://127.0.0.1:3000', '')
    assert.deepEqual(await basesFor('172.18.0.1', { host: 'localhost:3000' }), ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'])
  })

  it('PUBLIC_BASE_URL\'s own host, and an allowlisted second domain, keep the request\'s base', async () => {
    configure('https://conduonghuongthien.com.vn', 'second.gov.vn')
    // Production shape: nginx on loopback, the public host forwarded, https.
    const viaProxy = { host: '127.0.0.1:3000', 'x-forwarded-host': 'conduonghuongthien.com.vn', 'x-forwarded-proto': 'https' }
    assert.deepEqual(await basesFor('127.0.0.1', viaProxy), ['https://conduonghuongthien.com.vn', 'https://conduonghuongthien.com.vn'])
    assert.deepEqual(await basesFor('127.0.0.1', { ...viaProxy, 'x-forwarded-host': 'second.gov.vn' }), ['https://second.gov.vn', 'https://second.gov.vn'])
    assert.deepEqual(await basesFor('127.0.0.1', { ...viaProxy, 'x-forwarded-host': 'evil.example' }), ['https://conduonghuongthien.com.vn', 'https://conduonghuongthien.com.vn'])
  })

  it('allowlist only: a listed host is kept, another falls back to the first entry', async () => {
    configure('', 'a.gov.vn,b.gov.vn')
    assert.deepEqual(await basesFor('172.18.0.1', { host: 'b.gov.vn' }), ['https://b.gov.vn', 'https://b.gov.vn'])
    assert.deepEqual(await basesFor(...LOCAL), ['https://a.gov.vn', 'https://a.gov.vn'])
  })
})
