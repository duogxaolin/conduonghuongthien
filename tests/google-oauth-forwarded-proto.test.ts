import assert from 'node:assert/strict'
import test from 'node:test'

import { requestBase, resolveDriveRedirectUri, resolveRedirectUri } from '../server/utils/google-oauth/config.ts'

/**
 * `X-Forwarded-Proto` is a request header: any client can send it. It used to be
 * honoured from ANY peer (only `X-Forwarded-Host` waited for a trusted proxy), so
 * a direct client could flip the OAuth redirect URI — and the base URL of links in
 * notification emails, which reuse `requestBase` — to `http://`. Now both forwarded
 * headers follow the same rule as `getClientIp`: read only when the peer is a
 * declared proxy (loopback by default). An untrusted peer gets the existing
 * default, `https`, so a deployment behind an undeclared proxy is unaffected.
 */

type FakeEvent = { node: { req: { headers: Record<string, string>, socket: { remoteAddress: string, encrypted?: boolean } } }, context: Record<string, unknown> }
const eventFrom = (peer: string, headers: Record<string, string>): FakeEvent => ({
  node: { req: { headers, socket: { remoteAddress: peer } } },
  context: {},
})

test('an untrusted peer cannot downgrade the scheme with X-Forwarded-Proto', () => {
  for (const proto of ['http', 'HTTP', 'http, https']) {
    const event = eventFrom('203.0.113.9', { host: 'portal.gov.vn', 'x-forwarded-proto': proto })
    assert.equal(requestBase(event as never), 'https://portal.gov.vn', proto)
    assert.equal(resolveRedirectUri(event as never), 'https://portal.gov.vn/api/auth/google/callback')
    assert.equal(resolveDriveRedirectUri(event as never), 'https://portal.gov.vn/api/admin/backup/drive/callback')
  }
})

test('a trusted proxy (loopback by default) still declares the scheme', () => {
  assert.equal(requestBase(eventFrom('127.0.0.1', { host: 'localhost:3000', 'x-forwarded-proto': 'http' }) as never), 'http://localhost:3000')
  assert.equal(requestBase(eventFrom('127.0.0.1', { host: 'portal.gov.vn', 'x-forwarded-proto': 'https' }) as never), 'https://portal.gov.vn')
})

test('without any forwarded header the default stays https', () => {
  assert.equal(requestBase(eventFrom('203.0.113.9', { host: 'portal.gov.vn' }) as never), 'https://portal.gov.vn')
})
