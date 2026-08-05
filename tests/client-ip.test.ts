/**
 * The trust decision behind a reverse proxy.
 *
 * Two failures are being pinned here, and they pull in opposite directions:
 * ignoring x-forwarded-for entirely collapses every visitor into one rate-limit
 * bucket once nginx is in front, while honouring it unconditionally lets any
 * client choose its own bucket and forge its own audit trail. The rule that
 * satisfies both is "believe the chain only from a sender we listed", so most of
 * these cases are about where that list is consulted.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_TRUSTED_PROXIES,
  UNKNOWN_IP,
  isTrustedProxy,
  normalizeIp,
  parseTrustedProxies,
  resolveClientIp,
} from '../server/utils/client-ip.ts'

const NGINX = '172.18.0.1'
const VISITOR = '203.0.113.45'

describe('normalizeIp', () => {
  it('unwraps IPv4-mapped IPv6, brackets, ports and zone ids', () => {
    assert.equal(normalizeIp('::ffff:203.0.113.5'), '203.0.113.5')
    assert.equal(normalizeIp('[2001:db8::1]:443'), '2001:db8::1')
    assert.equal(normalizeIp('203.0.113.5:52134'), '203.0.113.5')
    assert.equal(normalizeIp('fe80::1%eth0'), 'fe80::1')
    assert.equal(normalizeIp('  ::1  '), '::1')
  })

  it('treats blank and missing values as absent', () => {
    assert.equal(normalizeIp(''), null)
    assert.equal(normalizeIp('   '), null)
    assert.equal(normalizeIp(null), null)
    assert.equal(normalizeIp(undefined), null)
  })
})

describe('isTrustedProxy', () => {
  it('matches literals regardless of representation', () => {
    assert.ok(isTrustedProxy('::ffff:127.0.0.1', ['127.0.0.1']))
    assert.ok(isTrustedProxy('127.0.0.1', ['::ffff:127.0.0.1']))
  })

  it('matches inside an IPv4 CIDR block and rejects outside it', () => {
    assert.ok(isTrustedProxy('172.18.0.1', ['172.16.0.0/12']))
    assert.ok(isTrustedProxy('172.31.255.254', ['172.16.0.0/12']))
    assert.equal(isTrustedProxy('172.32.0.1', ['172.16.0.0/12']), false)
    // A /12 that accidentally behaved like a /16 would leave most of the docker
    // bridge range untrusted; a /12 behaving like a /8 would trust 172.32+.
    assert.equal(isTrustedProxy(VISITOR, ['172.16.0.0/12']), false)
  })

  it('handles the /32 and /0 edges', () => {
    assert.ok(isTrustedProxy('10.0.0.7', ['10.0.0.7/32']))
    assert.equal(isTrustedProxy('10.0.0.8', ['10.0.0.7/32']), false)
    // /0 shifts by 32, which is a no-op in JS unless handled: without the guard
    // this would match nothing instead of everything.
    assert.ok(isTrustedProxy(VISITOR, ['0.0.0.0/0']))
  })

  it('ignores malformed entries instead of throwing or trusting them', () => {
    for (const bad of ['not-an-ip', '10.0.0.0/33', '10.0.0.0/-1', '10.0.0.0/abc', '999.1.1.1', '']) {
      assert.equal(isTrustedProxy('10.0.0.1', [bad]), false, `entry ${bad} must not match`)
    }
  })

  it('is false for an absent address', () => {
    assert.equal(isTrustedProxy(null, ['127.0.0.1']), false)
  })
})

describe('resolveClientIp — untrusted peer', () => {
  it('uses the peer address and ignores the forwarded chain', () => {
    const result = resolveClientIp({
      peer: VISITOR,
      forwardedFor: '10.0.0.1, 8.8.8.8',
      trustedProxies: ['127.0.0.1'],
    })
    assert.equal(result.ip, VISITOR)
    assert.equal(result.source, 'peer')
  })

  it('flags a forwarded header from a sender that is not our proxy', () => {
    // This is the forgery path: a client reaching the app directly and claiming
    // to be someone else. The claim is dropped, and the attempt is visible.
    const forged = resolveClientIp({ peer: VISITOR, forwardedFor: '1.2.3.4', trustedProxies: ['127.0.0.1'] })
    assert.equal(forged.ip, VISITOR)
    assert.equal(forged.spoofAttempt, true)

    const clean = resolveClientIp({ peer: VISITOR, trustedProxies: ['127.0.0.1'] })
    assert.equal(clean.spoofAttempt, false)
  })

  it('ignores x-real-ip too when the peer is not trusted', () => {
    const result = resolveClientIp({ peer: VISITOR, realIp: '1.2.3.4', trustedProxies: ['127.0.0.1'] })
    assert.equal(result.ip, VISITOR)
    assert.equal(result.spoofAttempt, true)
  })

  it('reports unknown rather than empty when there is no peer at all', () => {
    const result = resolveClientIp({ peer: null, trustedProxies: ['127.0.0.1'] })
    assert.equal(result.ip, UNKNOWN_IP)
    assert.equal(result.source, 'unknown')
  })
})

describe('resolveClientIp — trusted peer', () => {
  it('takes the rightmost untrusted hop', () => {
    const result = resolveClientIp({
      peer: NGINX,
      forwardedFor: `${VISITOR}`,
      trustedProxies: ['127.0.0.1', NGINX],
    })
    assert.equal(result.ip, VISITOR)
    assert.equal(result.source, 'forwarded-for')
    assert.equal(result.spoofAttempt, false)
  })

  it('discards a client-supplied prefix and keeps the hop our proxy appended', () => {
    // The client sent `x-forwarded-for: 9.9.9.9`; nginx appended the real peer.
    // Reading left-to-right would return the forgery.
    const result = resolveClientIp({
      peer: NGINX,
      forwardedFor: `9.9.9.9, ${VISITOR}`,
      trustedProxies: [NGINX],
    })
    assert.equal(result.ip, VISITOR)
  })

  it('walks past our own hops to find the client', () => {
    // Two proxies of ours in the chain, e.g. an edge and a local nginx.
    const result = resolveClientIp({
      peer: '127.0.0.1',
      forwardedFor: `${VISITOR}, ${NGINX}, 127.0.0.1`,
      trustedProxies: ['127.0.0.1', NGINX],
    })
    assert.equal(result.ip, VISITOR)
  })

  it('falls back to x-real-ip when no forwarded chain was sent', () => {
    const result = resolveClientIp({ peer: '127.0.0.1', realIp: VISITOR, trustedProxies: ['127.0.0.1'] })
    assert.equal(result.ip, VISITOR)
    assert.equal(result.source, 'real-ip')
  })

  it('prefers the forwarded chain over x-real-ip', () => {
    const result = resolveClientIp({
      peer: '127.0.0.1',
      forwardedFor: VISITOR,
      realIp: '10.9.9.9',
      trustedProxies: ['127.0.0.1'],
    })
    assert.equal(result.ip, VISITOR)
    assert.equal(result.source, 'forwarded-for')
  })

  it('falls back to the peer when the proxy forwarded nothing', () => {
    // Honest, just not the visitor. Not a spoof attempt: no header was sent.
    const result = resolveClientIp({ peer: '127.0.0.1', trustedProxies: ['127.0.0.1'] })
    assert.equal(result.ip, '127.0.0.1')
    assert.equal(result.source, 'peer')
    assert.equal(result.spoofAttempt, false)
  })

  it('falls back to the peer when every hop in the chain is ours', () => {
    const result = resolveClientIp({
      peer: '127.0.0.1',
      forwardedFor: `${NGINX}, 127.0.0.1`,
      trustedProxies: ['127.0.0.1', NGINX],
    })
    assert.equal(result.ip, '127.0.0.1')
    assert.equal(result.source, 'peer')
  })

  it('skips junk entries in the chain', () => {
    const result = resolveClientIp({
      peer: NGINX,
      forwardedFor: `${VISITOR}, , unknown`,
      trustedProxies: [NGINX],
    })
    // `unknown` is not a trusted proxy, so it is the rightmost untrusted hop.
    // It is a real value nginx can emit, and it is honest about being useless.
    assert.equal(result.ip, 'unknown')
  })

  it('normalizes what it returns, so one host yields one bucket key', () => {
    const result = resolveClientIp({
      peer: '::ffff:127.0.0.1',
      forwardedFor: '::ffff:203.0.113.45',
      trustedProxies: ['127.0.0.1'],
    })
    assert.equal(result.ip, VISITOR)
  })
})

describe('parseTrustedProxies', () => {
  it('defaults to loopback only', () => {
    assert.deepEqual(parseTrustedProxies(''), [...DEFAULT_TRUSTED_PROXIES])
    assert.deepEqual(parseTrustedProxies(null), [...DEFAULT_TRUSTED_PROXIES])
    // Not naming a proxy must not mean "trust the private ranges": on a host
    // running other containers that would let a neighbour forge addresses.
    assert.equal(parseTrustedProxies('').includes('172.16.0.0/12'), false)
  })

  it('splits on commas and whitespace and drops blanks', () => {
    assert.deepEqual(
      parseTrustedProxies(' 172.18.0.1, 10.0.0.0/8 ,, 192.168.1.5 '),
      ['127.0.0.1', '::1', '172.18.0.1', '10.0.0.0/8', '192.168.1.5'],
    )
  })

  it('always keeps loopback, which the container healthcheck uses', () => {
    assert.ok(parseTrustedProxies('172.18.0.1').includes('127.0.0.1'))
    assert.ok(parseTrustedProxies('172.18.0.1').includes('::1'))
  })

  it('does not duplicate loopback when it is named explicitly', () => {
    const parsed = parseTrustedProxies('127.0.0.1, 172.18.0.1')
    assert.equal(parsed.filter(entry => entry === '127.0.0.1').length, 1)
  })
})

describe('call sites', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

  it('no handler reads the peer address directly any more', () => {
    // getRequestIP with xForwardedFor:false is exactly the bug: correct with
    // nothing in front, one shared bucket behind nginx. It belongs in the helper
    // and nowhere else.
    const offenders: string[] = []
    for (const file of [
      'server/utils/chatbot/chat-policy.ts',
      'server/api/submissions.post.ts',
      'server/api/admin/auth/login.post.ts',
      'server/api/admin/auth/logout.post.ts',
      'server/api/admin/auth/mfa/verify.post.ts',
      'server/api/admin/auth/mfa/send-code.post.ts',
      'server/api/public/chatbot/lead.post.ts',
      'server/api/public/analytics/page-view.post.ts',
      'server/services/analytics-ingestion.ts',
      'server/api/admin/activity-logs/index.get.ts',
      'server/api/admin/profile/history.get.ts',
      // Reader sign-in and public comments. Both write the caller's address into a
      // row (reader_accounts.last_ip, article_comments.ip) and both key a rate
      // limit on it, so the shared-bucket-behind-nginx failure applies to them
      // exactly as it did to the chat handler.
      'server/api/auth/google/start.get.ts',
      'server/api/auth/google/callback.get.ts',
      'server/api/public/comments/index.post.ts',
      'server/api/admin/comments/reply.post.ts',
      'server/utils/reader-auth.ts',
    ]) {
      if (/getRequestIP\(/.test(read(file))) offenders.push(file)
    }
    assert.deepEqual(offenders, [])
  })

  it('the OAuth redirect helper uses the peer address only to decide proxy trust', () => {
    // This is the one new file allowed to call getRequestIP. It must ask
    // isTrustedProxy about the peer — never treat the peer as the visitor's
    // address, and never honour a forwarded host without that check, or a forged
    // header would choose the redirect URI sent to Google.
    const source = read('server/utils/google-oauth/config.ts')
    assert.match(source, /isTrustedProxy\(/)
    assert.match(source, /xForwardedFor: false/)
    assert.doesNotMatch(
      source,
      /getClientIp\(/,
      'config.ts must not resolve a client address — it only decides whether the peer is our proxy',
    )
  })

  it('the chat rate-limit key is derived from the resolved client address', () => {
    const source = read('server/utils/chatbot/chat-policy.ts')
    assert.match(source, /getClientIp\(event\)/)
    assert.doesNotMatch(source, /xForwardedFor/)
  })

  it('logout no longer trusts the raw header for its audit row', () => {
    const source = read('server/api/admin/auth/logout.post.ts')
    assert.doesNotMatch(source, /getRequestHeader\(event, 'x-forwarded-for'\)/)
    assert.match(source, /ip: getClientIp\(event\)/)
  })

  it('the app port is published on loopback, not every interface', () => {
    const compose = read('docker-compose.yml')
    // TLS terminated by a proxy is worthless if the plain HTTP port it fronts is
    // also reachable from outside.
    assert.match(compose, /\$\{APP_BIND:-127\.0\.0\.1\}:\$\{PORT:-3000\}:\$\{PORT:-3000\}/)
    assert.doesNotMatch(compose, /^\s+- "\$\{PORT:-3000\}:\$\{PORT:-3000\}"$/m)
  })

  it('the trusted-proxy list reaches the container under both names', () => {
    const compose = read('docker-compose.yml')
    // Nitro reads the NUXT_-prefixed name at runtime; the bare one is for the
    // maintenance scripts that run outside Nitro.
    assert.match(compose, /TRUSTED_PROXY_IPS: \$\{TRUSTED_PROXY_IPS:-\}/)
    assert.match(compose, /NUXT_TRUSTED_PROXY_IPS: \$\{TRUSTED_PROXY_IPS:-\}/)
  })
})
