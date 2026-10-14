import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { parseHostAllowlist, publicLinkBase, selectLinkBase } from '../server/utils/public-link-base.ts'

/**
 * Gốc liên kết trong email thông báo. Host của request do client chọn; một email
 * thật từ cổng chứa liên kết tới host giả là công cụ lừa đảo. Host chỉ được dùng
 * khi nằm trong PUBLIC_HOST_ALLOWLIST hoặc là host của PUBLIC_BASE_URL.
 */

const PORTAL = 'https://portal.gov.vn'

test('selection table', () => {
  const cases: Array<{ name: string, requestBase: string, publicBaseUrl: string, allowlist: string[], base: string, source: string, rejected?: boolean, warn?: boolean }> = [
    { name: 'nothing configured: today\'s behaviour, flagged', requestBase: 'https://any.example', publicBaseUrl: '', allowlist: [], base: 'https://any.example', source: 'request-unchecked', warn: true },
    { name: 'request on PUBLIC_BASE_URL host', requestBase: PORTAL, publicBaseUrl: PORTAL, allowlist: [], base: PORTAL, source: 'request' },
    { name: 'forged host with only PUBLIC_BASE_URL set', requestBase: 'https://evil.example', publicBaseUrl: PORTAL, allowlist: [], base: PORTAL, source: 'public-base-url', rejected: true },
    { name: 'second declared domain keeps its own links (multi-domain)', requestBase: 'https://second.vn', publicBaseUrl: PORTAL, allowlist: ['second.vn'], base: 'https://second.vn', source: 'request' },
    { name: 'forged host with allowlist + base', requestBase: 'https://evil.example', publicBaseUrl: PORTAL, allowlist: ['second.vn'], base: PORTAL, source: 'public-base-url', rejected: true },
    { name: 'allowlist only: listed host kept', requestBase: 'https://b.vn', publicBaseUrl: '', allowlist: ['a.vn', 'b.vn'], base: 'https://b.vn', source: 'request' },
    { name: 'allowlist only: forged host falls back to the first entry', requestBase: 'https://evil.example', publicBaseUrl: '', allowlist: ['a.vn', 'b.vn'], base: 'https://a.vn', source: 'allowlist-default', rejected: true },
    { name: 'case and trailing dot do not matter', requestBase: 'https://PORTAL.Gov.VN.', publicBaseUrl: PORTAL, allowlist: [], base: PORTAL, source: 'request' },
    { name: 'a port is part of the host', requestBase: 'http://localhost:3000', publicBaseUrl: '', allowlist: ['localhost:3000'], base: 'http://localhost:3000', source: 'request' },
    { name: 'another port is another host', requestBase: 'http://localhost:4000', publicBaseUrl: '', allowlist: ['localhost:3000'], base: 'https://localhost:3000', source: 'allowlist-default', rejected: true },
    { name: 'userinfo trick does not pass as the portal', requestBase: 'https://portal.gov.vn@evil.example', publicBaseUrl: PORTAL, allowlist: [], base: PORTAL, source: 'public-base-url', rejected: true },
    { name: 'path/query smuggled in Host is dropped', requestBase: 'https://portal.gov.vn/evil?x=1', publicBaseUrl: PORTAL, allowlist: [], base: PORTAL, source: 'request' },
    { name: 'garbage host falls back', requestBase: 'https://exa mple', publicBaseUrl: PORTAL, allowlist: [], base: PORTAL, source: 'public-base-url', rejected: true },
    { name: 'PUBLIC_BASE_URL with a path or trailing slash still yields an origin', requestBase: 'https://evil.example', publicBaseUrl: 'https://portal.gov.vn/', allowlist: [], base: PORTAL, source: 'public-base-url', rejected: true },
  ]
  for (const c of cases) {
    const decision = selectLinkBase(c)
    assert.equal(decision.base, c.base, c.name)
    assert.equal(decision.source, c.source, c.name)
    assert.equal(decision.warn, c.warn === true, c.name)
    assert.equal(Boolean(decision.rejectedHost), c.rejected === true, c.name)
  }
})

test('allowlist parsing accepts hosts, host:port and full URLs', () => {
  assert.deepEqual(parseHostAllowlist(' a.vn , https://B.vn/ ,, localhost:3000, c.vn. ,a.vn'), ['a.vn', 'b.vn', 'localhost:3000', 'c.vn'])
  assert.deepEqual(parseHostAllowlist(''), [])
})

// ─── Through a request ───────────────────────────────────────────────────────

type FakeEvent = { node: { req: { headers: Record<string, string>, socket: { remoteAddress: string } } }, context: Record<string, unknown> }
const eventFrom = (peer: string, headers: Record<string, string>): FakeEvent => ({
  node: { req: { headers, socket: { remoteAddress: peer } } },
  context: {},
})
const globals = globalThis as Record<string, unknown>

test('the runtime env var is honoured even when the build-time runtimeConfig value is empty', () => {
  // The image is built without PUBLIC_HOST_ALLOWLIST, so runtimeConfig holds ''.
  globals.useRuntimeConfig = () => ({ publicHostAllowlist: '', publicBaseUrl: PORTAL })
  process.env.PUBLIC_HOST_ALLOWLIST = 'second.vn'
  const warnings = mock.method(console, 'error', () => {})
  try {
    // Host header from a direct client (untrusted peer): X-Forwarded-Host is ignored.
    assert.equal(publicLinkBase(eventFrom('203.0.113.9', { host: 'second.vn', 'x-forwarded-proto': 'https' }) as never), 'https://second.vn')
    assert.equal(publicLinkBase(eventFrom('203.0.113.9', { host: 'second.vn', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }) as never), 'https://second.vn')
    // A forged Host is replaced by PUBLIC_BASE_URL, and logged.
    assert.equal(publicLinkBase(eventFrom('203.0.113.9', { host: 'evil.example', 'x-forwarded-proto': 'https' }) as never), PORTAL)
    // Behind our own proxy (loopback is trusted by default) X-Forwarded-Host is read —
    // and still has to be declared.
    assert.equal(publicLinkBase(eventFrom('127.0.0.1', { host: '127.0.0.1:3000', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }) as never), PORTAL)
    assert.equal(publicLinkBase(eventFrom('127.0.0.1', { host: '127.0.0.1:3000', 'x-forwarded-host': 'portal.gov.vn', 'x-forwarded-proto': 'https' }) as never), PORTAL)
    const logged = warnings.mock.calls.map(call => String(call.arguments[0]))
    assert.equal(logged.filter(line => line.includes('security.link_host_rejected')).length, 2)
    assert.ok(logged.every(line => !line.includes('security.link_host_unchecked')))
  } finally {
    warnings.mock.restore()
    delete process.env.PUBLIC_HOST_ALLOWLIST
    delete globals.useRuntimeConfig
  }
})

test('with nothing configured the request host is kept and a single security warning is logged', () => {
  globals.useRuntimeConfig = () => ({ publicHostAllowlist: '', publicBaseUrl: '' })
  delete process.env.PUBLIC_HOST_ALLOWLIST
  const warnings = mock.method(console, 'error', () => {})
  try {
    assert.equal(publicLinkBase(eventFrom('203.0.113.9', { host: 'one.example', 'x-forwarded-proto': 'https' }) as never), 'https://one.example')
    assert.equal(publicLinkBase(eventFrom('203.0.113.9', { host: 'two.example', 'x-forwarded-proto': 'https' }) as never), 'https://two.example')
    const unchecked = warnings.mock.calls.map(call => String(call.arguments[0])).filter(line => line.includes('security.link_host_unchecked'))
    assert.equal(unchecked.length, 1, 'warned once per process, not per email')
  } finally {
    warnings.mock.restore()
    delete globals.useRuntimeConfig
  }
})
