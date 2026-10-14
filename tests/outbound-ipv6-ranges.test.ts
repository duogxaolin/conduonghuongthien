import assert from 'node:assert/strict'
import test from 'node:test'

import { isPublicIpAddress, resolvePublicProviderAddresses } from '../server/utils/chatbot/outbound.ts'

/**
 * Two IPv6 ranges that reach private space were treated as public:
 *  - `64:ff9b::/96`, the well-known NAT64 prefix: on a network with a NAT64
 *    gateway, `64:ff9b::a9fe:a9fe` IS `169.254.169.254` and `64:ff9b::7f00:1` is
 *    `127.0.0.1` (only the local-use `64:ff9b:1::/48` was blocked);
 *  - `fec0::/10`, deprecated site-local unicast — still routed internally by some
 *    networks, never a public destination.
 */

test('NAT64 well-known prefix and site-local addresses are not public', () => {
  for (const address of [
    '64:ff9b::a9fe:a9fe', // 169.254.169.254
    '64:ff9b::7f00:1', // 127.0.0.1
    '64:ff9b::a00:5', // 10.0.0.5
    '64:ff9b::808:808', // even a public v4 behind NAT64 is refused: the gateway decides, not us
    '64:ff9b::169.254.169.254',
    'fec0::1',
    'fec0:1234::abcd',
    'feff:ffff::1',
    '[fec0::1]',
  ]) assert.equal(isPublicIpAddress(address), false, address)
})

test('neighbouring public ranges are unaffected', () => {
  // `64:ff9b:0:0:1::1` is outside the /96 (fifth group set) and outside 64:ff9b:1::/48.
  for (const address of ['64:ff9a::1', '64:ff9b:0:0:1::1', '2001:4860:4860::8888', '2606:4700:4700::1111']) {
    assert.equal(isPublicIpAddress(address), true, address)
  }
})

test('a provider host resolving into NAT64 is refused before any connection', async () => {
  await assert.rejects(
    resolvePublicProviderAddresses('api.provider.example', async () => [{ address: '64:ff9b::a9fe:a9fe', family: 6 }]),
    (error: unknown) => (error as { code?: string }).code === 'DESTINATION_UNSAFE',
  )
})
