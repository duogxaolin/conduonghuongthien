import { isIP } from 'node:net'

/**
 * Is this resolved address one an outbound provider call may connect to — a public
 * unicast address, not loopback, private, link-local, CGNAT, documentation, multicast
 * or reserved space (IPv4, IPv6, IPv4-mapped, NAT64)?
 *
 * Moved verbatim out of `outbound.ts` (import it from here — a re-export there made Nitro's
 * auto-import scan warn "Duplicated imports") so that file could take the
 * DNS-in-deadline fix without growing past its line cap. Pure: no I/O, no state.
 */
export function isPublicIpAddress(input: string): boolean {
  const unwrapped = input.startsWith('[') && input.endsWith(']') ? input.slice(1, -1) : input
  const zoneIndex = unwrapped.indexOf('%')
  const address = zoneIndex === -1 ? unwrapped : unwrapped.slice(0, zoneIndex)
  const family = isIP(address)

  if (family === 4) return isPublicIpv4(address)
  if (family !== 6) return false

  const value = parseIpv6(address)
  if (value === null) return false

  const mappedPrefix = value >> 32n
  if (mappedPrefix === 0xffffn) {
    return isPublicIpv4(bigIntToIpv4(value & 0xffffffffn))
  }

  const blocked: Array<[bigint, number]> = [
    [0n, 128],
    [1n, 128],
    [0n, 96],
    // NAT64 well-known prefix (RFC 6052): behind a NAT64 gateway
    // `64:ff9b::a9fe:a9fe` IS 169.254.169.254. Refused whole — whether the
    // embedded IPv4 is reachable is the gateway's decision, not ours.
    [ipv6('64:ff9b::'), 96],
    [ipv6('64:ff9b:1::'), 48],
    [ipv6('100::'), 64],
    [ipv6('2001::'), 23],
    [ipv6('2001:db8::'), 32],
    [ipv6('2002::'), 16],
    [ipv6('fc00::'), 7],
    [ipv6('fe80::'), 10],
    // Site-local (RFC 3879, deprecated) — still routed internally on some networks.
    [ipv6('fec0::'), 10],
    [ipv6('ff00::'), 8],
  ]

  return !blocked.some(([network, prefix]) => inCidr(value, network, prefix, 128))
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const value = parts.reduce((result, part) => (result << 8n) | BigInt(part), 0n)
  const blocked: Array<[string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ]
  return !blocked.some(([network, prefix]) => inCidr(value, ipv4ToBigInt(network), prefix, 32))
}

function ipv4ToBigInt(address: string): bigint {
  return address.split('.').reduce((result, part) => (result << 8n) | BigInt(part), 0n)
}

function bigIntToIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map(shift => Number((value >> shift) & 0xffn)).join('.')
}

function ipv6(address: string): bigint {
  const parsed = parseIpv6(address)
  if (parsed === null) throw new Error('Invalid internal IPv6 constant')
  return parsed
}

function parseIpv6(address: string): bigint | null {
  let source = address.toLowerCase()
  if (source.includes('.')) {
    const lastColon = source.lastIndexOf(':')
    if (lastColon < 0) return null
    const ipv4 = source.slice(lastColon + 1)
    if (isIP(ipv4) !== 4) return null
    const value = ipv4ToBigInt(ipv4)
    source = `${source.slice(0, lastColon)}:${((value >> 16n) & 0xffffn).toString(16)}:${(value & 0xffffn).toString(16)}`
  }

  const halves = source.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n)
}

function inCidr(value: bigint, network: bigint, prefix: number, width: number): boolean {
  if (prefix === 0) return true
  const shift = BigInt(width - prefix)
  return (value >> shift) === (network >> shift)
}
