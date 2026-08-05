/**
 * The client's address when the app sits behind a reverse proxy.
 *
 * Sixteen files called `getRequestIP(event, { xForwardedFor: false })`. That is
 * the right call for an app facing the internet directly — `x-forwarded-for` is
 * a request header, so any client can put any value in it, and trusting it hands
 * an attacker the ability to pick their own rate-limit bucket.
 *
 * Behind nginx it is the wrong call, and the failure is severe rather than
 * cosmetic: every request arrives from the same peer address (the docker bridge
 * gateway), so `clientKey()` in chat-policy.ts hashes one value for the entire
 * internet and the 10-requests-per-minute chat limit becomes a global limit.
 * Visitor eleven is refused because of ten strangers. Audit rows in
 * `activity_logs` and `submissions` record the proxy, losing the one field that
 * makes them worth keeping.
 *
 * Turning `xForwardedFor: true` on would trade a correctness bug for a security
 * bug. The resolution is neither: read the forwarded chain ONLY when the peer we
 * are actually talking to is a proxy we listed ourselves, and walk that chain
 * from the right, discarding hops that are also our proxies. The first address
 * that is not ours is the closest one the client could not have forged — every
 * value to its left was appended before our infrastructure saw the request.
 *
 * Default trust is loopback only. A deployment behind nginx has to name its
 * proxy (`TRUSTED_PROXY_IPS`), because guessing that private ranges are
 * trustworthy is wrong on any host that runs untrusted containers.
 */

import { getRequestHeader, getRequestIP, type H3Event } from 'h3'
import { tryRuntimeConfig } from './runtime-config'

export type ClientIpInput = {
  /** The address of the socket peer — not forgeable by the client. */
  peer: string | null | undefined
  /** Raw `x-forwarded-for` value, comma-separated, left-to-right oldest-first. */
  forwardedFor?: string | null
  /** Raw `x-real-ip` value. nginx sets this; it carries a single address. */
  realIp?: string | null
  /** Literal addresses and CIDR blocks that are our own proxies. */
  trustedProxies?: readonly string[]
}

export type ClientIpResult = {
  ip: string
  /** How the value was obtained, for logging and for tests to pin behaviour. */
  source: 'peer' | 'forwarded-for' | 'real-ip' | 'unknown'
  /** True when a forwarded header was present but its sender was not trusted. */
  spoofAttempt: boolean
}

export const UNKNOWN_IP = 'unknown'

/** Loopback only. Anything else is a deployment detail, not a default. */
export const DEFAULT_TRUSTED_PROXIES = Object.freeze(['127.0.0.1', '::1'])

/**
 * Strips the IPv6-mapped-IPv4 prefix and any zone id, and unwraps `[::1]:443`
 * bracket-and-port forms. Without this, the same host reaches us as three
 * different strings and a trust list written by a human never matches.
 */
export function normalizeIp(value: string | null | undefined): string | null {
  let text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null

  // `[2001:db8::1]:443` → `2001:db8::1`
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(text)
  if (bracketed) text = bracketed[1]!

  // `203.0.113.5:443` → `203.0.113.5`. Only for IPv4: a bare IPv6 address has
  // many colons, so a single trailing `:port` is unambiguous here.
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(text)
  if (withPort) text = withPort[1]!

  text = text.replace(/%.*$/, '')          // scope id: fe80::1%eth0
  text = text.toLowerCase()

  // ::ffff:203.0.113.5 is an IPv4 address wearing an IPv6 hat.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (mapped) text = mapped[1]!

  return text || null
}

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

/**
 * Does `ip` match any entry of `list`? Literal match, or IPv4 CIDR containment.
 *
 * IPv6 ranges are deliberately not supported: a half-correct IPv6 mask that
 * silently matches too much would be a worse outcome than requiring the literal
 * address, and every proxy this app runs behind is reachable at a fixed one. An
 * IPv6 literal still matches exactly; only a `/` range is refused.
 *
 * Extracted from `isTrustedProxy` so the same matcher backs the reader IP ban
 * list (`server/utils/ip-ban.ts`) — decision D11. Two independent copies of
 * CIDR arithmetic would drift, and the half that drifted would be the one whose
 * failure is silent: a ban that quietly matches nothing.
 */
export function matchesIpList(ip: string | null | undefined, list: readonly string[]): boolean {
  if (!ip) return false
  const address = normalizeIp(ip)
  if (!address) return false

  for (const entry of list) {
    const candidate = entry.trim().toLowerCase()
    if (!candidate) continue

    if (!candidate.includes('/')) {
      if (normalizeIp(candidate) === address) return true
      continue
    }

    const [network, bitsText] = candidate.split('/')
    const bits = Number(bitsText)
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue

    const networkInt = ipv4ToInt(normalizeIp(network) ?? '')
    const addressInt = ipv4ToInt(address)
    if (networkInt === null || addressInt === null) continue

    // `>>> 0` keeps the mask unsigned; /0 would shift by 32, which is a no-op
    // in JS and would otherwise match nothing.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if ((networkInt & mask) === (addressInt & mask)) return true
  }

  return false
}

/** Is the socket peer one of the proxies we listed ourselves? */
export function isTrustedProxy(ip: string | null, trusted: readonly string[]): boolean {
  return matchesIpList(ip, trusted)
}

/**
 * Pure resolution, so the trust decision is testable without an HTTP server.
 */
export function resolveClientIp(input: ClientIpInput): ClientIpResult {
  const trusted = input.trustedProxies ?? DEFAULT_TRUSTED_PROXIES
  const peer = normalizeIp(input.peer)
  const hasForwardHeader = Boolean(
    (typeof input.forwardedFor === 'string' && input.forwardedFor.trim())
    || (typeof input.realIp === 'string' && input.realIp.trim()),
  )

  if (!isTrustedProxy(peer, trusted)) {
    return {
      ip: peer ?? UNKNOWN_IP,
      source: peer ? 'peer' : 'unknown',
      // A forwarded header from someone who is not our proxy is either a
      // misconfiguration or a forgery attempt. Either way it is ignored, and
      // either way it is worth seeing in the logs.
      spoofAttempt: hasForwardHeader,
    }
  }

  const chain = String(input.forwardedFor ?? '')
    .split(',')
    .map(part => normalizeIp(part))
    .filter((part): part is string => Boolean(part))

  // Right to left: the rightmost entry was added by our own proxy, so it is the
  // most trustworthy. Keep discarding while the hop belongs to us; the first
  // one that does not is the furthest point we can still vouch for.
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const hop = chain[index]!
    if (!isTrustedProxy(hop, trusted)) {
      return { ip: hop, source: 'forwarded-for', spoofAttempt: false }
    }
  }

  const realIp = normalizeIp(input.realIp)
  if (realIp) return { ip: realIp, source: 'real-ip', spoofAttempt: false }

  // Trusted proxy that forwarded nothing: the peer address is all we have, and
  // it is honest — it just is not the visitor.
  return { ip: peer ?? UNKNOWN_IP, source: peer ? 'peer' : 'unknown', spoofAttempt: false }
}

/** `TRUSTED_PROXY_IPS=127.0.0.1,172.17.0.1,10.0.0.0/8` */
export function parseTrustedProxies(raw: string | null | undefined): string[] {
  const entries = String(raw ?? '')
    .split(/[,\s]+/)
    .map(part => part.trim())
    .filter(Boolean)
  // Loopback stays trusted regardless: the app's own healthcheck talks to it
  // over 127.0.0.1, and dropping it would break that for no gain.
  return [...new Set([...DEFAULT_TRUSTED_PROXIES, ...entries])]
}

/** Resolved once per process: the list cannot change without a restart. */
let cachedTrustedProxies: string[] | null = null

export function trustedProxies(): string[] {
  if (cachedTrustedProxies) return cachedTrustedProxies
  const config = tryRuntimeConfig()
  const raw = config?.trustedProxyIps ?? process.env.TRUSTED_PROXY_IPS ?? ''
  cachedTrustedProxies = parseTrustedProxies(String(raw))
  return cachedTrustedProxies
}

/**
 * The call every handler makes. Replaces
 * `getRequestIP(event, { xForwardedFor: false }) || 'unknown'`, which was
 * correct only when nothing sat in front of the app.
 */
export function getClientIp(event: H3Event): string {
  return inspectClientIp(event).ip
}

/** Same resolution, with the provenance kept — for security logging. */
export function inspectClientIp(event: H3Event): ClientIpResult {
  return resolveClientIp({
    peer: getRequestIP(event, { xForwardedFor: false }),
    forwardedFor: getRequestHeader(event, 'x-forwarded-for'),
    realIp: getRequestHeader(event, 'x-real-ip'),
    trustedProxies: trustedProxies(),
  })
}
