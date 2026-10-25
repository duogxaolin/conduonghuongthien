/**
 * The address a per-source counter should be keyed on — not always the address
 * the request came from.
 *
 * An IPv4 address is one host and stays exactly that. An IPv6 subscriber is
 * normally handed a whole /64 (2^64 addresses) and picks interface ids freely —
 * privacy extensions rotate them on their own. A counter keyed on the full IPv6
 * address is therefore one fresh bucket per message for anyone who wants one;
 * the /64 prefix is the unit that actually belongs to one subscriber.
 *
 *   203.0.113.9                      → 203.0.113.9
 *   2001:db8:85a3:8d3:1319:8a2e::1   → 2001:db8:85a3:8d3::/64
 *   ::ffff:203.0.113.9, ::ffff:cb00:7109 → 203.0.113.9   (IPv4 in an IPv6 hat)
 *   ::1                              → ::1                (one host, not a prefix)
 *   anything unparseable             → the trimmed input, unchanged
 *
 * Used for the review-queue cap (`moderation-instant.ts`) and the article-view
 * ceiling (`articles/[slug]/view.post.ts`, key `avip:<bucket>`). It is
 * deliberately NOT wired into `getClientIp` or the general rate-limit keys: those
 * are compared against ban lists and audit rows that store full addresses.
 *
 * Self-contained on purpose (only `node:net`). `client-ip.ts` has a similar
 * `normalizeIp`, but it imports h3 and runtime config, and several test suites
 * mock `client-ip` with only `getClientIp` — importing it from the moderation
 * path would break every one of them at module-link time.
 */
import { isIPv4, isIPv6 } from 'node:net'

/** `[2001:db8::1]:443` / `[2001:db8::1]` / `203.0.113.5:443` / `fe80::1%eth0` → bare address. */
function bareAddress(raw: string): string {
  let text = raw.trim()
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(text)
  if (bracketed) text = bracketed[1]!
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(text)
  if (withPort) text = withPort[1]!
  return text.replace(/%.*$/, '').toLowerCase()
}

/** Eight 16-bit groups of a valid IPv6 address (caller checked `isIPv6`). */
function expandIpv6(address: string): number[] | null {
  let text = address
  // A dotted IPv4 tail (`::ffff:1.2.3.4`, `64:ff9b::1.2.3.4`) is two groups.
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (tail) {
    const octets = tail[2]!.split('.').map(Number)
    text = `${tail[1]}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part === '' ? [] : part.split(':').map(group => Number.parseInt(group, 16)))
  const head = parse(halves[0]!)
  const rest = halves.length === 2 ? parse(halves[1]!) : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...new Array<number>(halves.length === 2 ? missing : 0).fill(0), ...rest]
  return groups.length === 8 && groups.every(group => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null
}

type ParsedAddress =
  | { kind: 'ipv4', address: string }
  | { kind: 'ipv6', groups: number[] }
  | { kind: 'loopback6' }
  | { kind: 'unparsed', text: string }

function parseAddress(raw: string): ParsedAddress {
  const fallback: ParsedAddress = { kind: 'unparsed', text: raw.trim() }
  const address = bareAddress(raw)
  if (isIPv4(address)) return { kind: 'ipv4', address }
  if (!isIPv6(address)) return fallback

  const groups = expandIpv6(address)
  if (!groups) return fallback

  const zeroPrefix = groups.slice(0, 5).every(group => group === 0)
  // ::ffff:a.b.c.d — an IPv4 host reached over a dual-stack socket.
  if (zeroPrefix && groups[5] === 0xffff) {
    return { kind: 'ipv4', address: [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join('.') }
  }
  // ::1 is one host; its prefix would be the "all zeros" prefix shared with `::`.
  if (zeroPrefix && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) return { kind: 'loopback6' }
  return { kind: 'ipv6', groups }
}

export function ipBucket(raw: string): string {
  const parsed = parseAddress(raw)
  if (parsed.kind === 'ipv4') return parsed.address
  if (parsed.kind === 'loopback6') return '::1'
  if (parsed.kind === 'unparsed') return parsed.text
  return `${parsed.groups.slice(0, 4).map(group => group.toString(16)).join(':')}::/64`
}

/**
 * A coarser unit than `ipBucket`: the NETWORK a source sits in — IPv4 /24, IPv6 /48.
 * For a budget that must not multiply with addresses one party controls: a /48 is what
 * one site is routinely delegated (65 536 /64s), and a /24 is the smallest IPv4 block
 * one party usually holds. Too coarse for a per-person limit (a carrier NAT puts many
 * people in one /24) — use it only where sharing the budget is acceptable.
 *
 *   203.0.113.9                  → 203.0.113.0/24
 *   2001:db8:85a3:8d3::1         → 2001:db8:85a3::/48
 *   ::ffff:203.0.113.9           → 203.0.113.0/24
 *   ::1                          → ::1
 *   anything unparseable         → the trimmed input, unchanged
 */
export function ipNetworkBucket(raw: string): string {
  const parsed = parseAddress(raw)
  if (parsed.kind === 'ipv4') return `${parsed.address.split('.').slice(0, 3).join('.')}.0/24`
  if (parsed.kind === 'loopback6') return '::1'
  if (parsed.kind === 'unparsed') return parsed.text
  return `${parsed.groups.slice(0, 3).map(group => group.toString(16)).join(':')}::/48`
}
