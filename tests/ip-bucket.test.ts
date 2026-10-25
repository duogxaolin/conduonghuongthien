import assert from 'node:assert/strict'
import test from 'node:test'

import { ipBucket, ipNetworkBucket } from '../server/utils/ip-bucket.ts'

/**
 * The review-queue cap (MODERATION_QUEUE_CAP) is keyed on the sender's address.
 * One IPv6 subscriber is normally handed a whole /64 — 2^64 addresses — so a key
 * on the full address is one fresh bucket per message for anyone who rotates the
 * interface id. The bucket is the /64 prefix; IPv4 (and IPv4 wearing an IPv6
 * prefix) stays the single address it is.
 */

const cases: Array<[label: string, input: string, expected: string]> = [
  ['IPv4 unchanged', '203.0.113.9', '203.0.113.9'],
  ['IPv4 trimmed', '  203.0.113.9 ', '203.0.113.9'],
  ['IPv4 loopback', '127.0.0.1', '127.0.0.1'],
  ['IPv4 with port', '203.0.113.9:8443', '203.0.113.9'],
  ['IPv6 full form → /64', '2001:db8:85a3:8d3:1319:8a2e:370:7348', '2001:db8:85a3:8d3::/64'],
  ['IPv6 leading zeros → same /64', '2001:0db8:85a3:08d3:1319:8a2e:0370:7348', '2001:db8:85a3:8d3::/64'],
  ['IPv6 upper case → same /64', '2001:DB8:85A3:8D3::1', '2001:db8:85a3:8d3::/64'],
  ['IPv6 compressed tail', '2001:db8::1', '2001:db8:0:0::/64'],
  ['IPv6 compressed, other interface id', '2001:db8::dead:beef', '2001:db8:0:0::/64'],
  ['IPv6 written out with zeros', '2001:db8:0:0:ffff::1', '2001:db8:0:0::/64'],
  ['IPv6 compressed head', '::2001:db8:1:2', '0:0:0:0::/64'],
  ['IPv6 compression in the prefix', '2001:db8::5:0:0:1', '2001:db8:0:0::/64'],
  ['IPv6 with zone id', 'fe80::1%eth0', 'fe80:0:0:0::/64'],
  ['IPv6 bracketed with port', '[2001:db8:1:2::7]:443', '2001:db8:1:2::/64'],
  ['IPv6 bracketed without port', '[2001:db8:1:2::7]', '2001:db8:1:2::/64'],
  ['IPv6 with embedded IPv4 tail (not mapped)', '2001:db8:1:2::203.0.113.9', '2001:db8:1:2::/64'],
  ['IPv4-mapped dotted', '::ffff:203.0.113.9', '203.0.113.9'],
  ['IPv4-mapped dotted, upper case', '::FFFF:203.0.113.9', '203.0.113.9'],
  ['IPv4-mapped hex', '::ffff:cb00:7109', '203.0.113.9'],
  ['IPv4-mapped written out', '0:0:0:0:0:ffff:cb00:7109', '203.0.113.9'],
  ['IPv6 loopback stays one host', '::1', '::1'],
  ['IPv6 loopback written out', '0:0:0:0:0:0:0:1', '::1'],
  ['unknown → raw', 'unknown', 'unknown'],
  ['empty → raw', '', ''],
  ['garbage → raw', 'not-an-ip', 'not-an-ip'],
  ['bad hex group → raw', '2001:db8::g', '2001:db8::g'],
  ['too many groups → raw', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8:9'],
  ['double compression → raw', '2001::db8::1', '2001::db8::1'],
  ['IPv4 out of range → raw', '203.0.113.300', '203.0.113.300'],
]

for (const [label, input, expected] of cases) {
  test(`ipBucket: ${label}`, () => {
    assert.equal(ipBucket(input), expected)
  })
}

test('ipBucket: every address inside one /64 lands in one bucket, a neighbouring /64 does not', () => {
  const buckets = new Set<string>()
  for (let i = 1; i <= 64; i++) buckets.add(ipBucket(`2001:db8:aa:bb:${i.toString(16)}::${(i * 7).toString(16)}`))
  assert.deepEqual([...buckets], ['2001:db8:aa:bb::/64'])
  assert.notEqual(ipBucket('2001:db8:aa:bc::1'), ipBucket('2001:db8:aa:bb::1'))
})

// ─── ipNetworkBucket: IPv4 /24, IPv6 /48 (CSP report new-key budget) ──────────

const networkCases: Array<[label: string, input: string, expected: string]> = [
  ['IPv4 → /24', '203.0.113.9', '203.0.113.0/24'],
  ['IPv4 with port → /24', '203.0.113.9:8443', '203.0.113.0/24'],
  ['IPv6 → /48', '2001:db8:85a3:8d3:1319:8a2e:370:7348', '2001:db8:85a3::/48'],
  ['IPv6 compressed → /48', '2001:db8::1', '2001:db8:0::/48'],
  ['IPv6 bracketed with port → /48', '[2001:db8:1:2::7]:443', '2001:db8:1::/48'],
  ['IPv4-mapped → the IPv4 /24', '::ffff:203.0.113.9', '203.0.113.0/24'],
  ['IPv6 loopback stays one host', '::1', '::1'],
  ['unknown → raw', 'unknown', 'unknown'],
  ['garbage → raw', 'not-an-ip', 'not-an-ip'],
]

for (const [label, input, expected] of networkCases) {
  test(`ipNetworkBucket: ${label}`, () => {
    assert.equal(ipNetworkBucket(input), expected)
  })
}

test('ipNetworkBucket: 65 536 /64s of one /48 are one network; a neighbouring /48 and a neighbouring /24 are not', () => {
  const networks = new Set<string>()
  for (let i = 0; i < 300; i++) networks.add(ipNetworkBucket(`2001:db8:5:${i.toString(16)}::1`))
  assert.deepEqual([...networks], ['2001:db8:5::/48'])
  assert.notEqual(ipNetworkBucket('2001:db8:6::1'), ipNetworkBucket('2001:db8:5::1'))
  assert.equal(ipNetworkBucket('198.51.100.1'), ipNetworkBucket('198.51.100.254'))
  assert.notEqual(ipNetworkBucket('198.51.101.1'), ipNetworkBucket('198.51.100.1'))
})
