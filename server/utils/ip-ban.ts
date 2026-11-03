/**
 * Reader IP ban list — validation of what an officer types, and the match itself.
 *
 * Pure logic on purpose: the decision "is this visitor banned" has to be
 * testable without a database or an HTTP server, and the decision "is this a
 * value we can honour" has to be answerable at the moment of entry rather than
 * discovered later as a ban that quietly matches nothing.
 *
 * The matcher is `matchesIpList` from client-ip.ts — the same code that decides
 * proxy trust (decision D11). A second copy of CIDR arithmetic would drift, and
 * a drifted ban list fails silently.
 */

import { matchesIpList, normalizeIp, ipv4ToInt } from './client-ip'

export type BanValidation =
  | { ok: true, value: string }
  | { ok: false, error: string }

/** Maximum stored length — guards the column and rejects obvious junk early. */
const MAX_BAN_LENGTH = 64

/**
 * The widest range a ban may cover, per address family. A ban is for one abuser or
 * one network: `/8` is already 16 777 216 IPv4 addresses, and `0.0.0.0/0` bans every
 * visitor of the portal — sign-in and comments closed to all by one typo. IPv6 ranges
 * are refused at any width (below), but a range wider than `/32` (the allocation of
 * a whole provider) is named as too wide first, so the limit stays here if ranges
 * are ever matched.
 *
 * Enforced at save time only: a row stored before this limit still matches as
 * stored (`matchesIpList` is also the proxy-trust matcher and is not changed).
 */
const MIN_BAN_PREFIX = { ipv4: 8, ipv6: 32 } as const
const MAX_BAN_PREFIX = { ipv4: 32, ipv6: 128 } as const

function looksLikeIpv6(text: string): boolean {
  // Any address carrying a colon is IPv6 here: normalizeIp has already unwrapped
  // `[::1]:443` bracket forms and stripped an IPv4 `:port`, so a surviving colon
  // is part of the address itself.
  return text.includes(':')
}

/** The prefix as a whole number within the family's bounds; `null` for anything else (`-1`, `+8`, `7.5`, `８`). */
function parsePrefix(bitsText: string, family: 'ipv4' | 'ipv6'): number | null {
  if (!/^\d{1,3}$/.test(bitsText)) return null
  const bits = Number(bitsText)
  return bits <= MAX_BAN_PREFIX[family] ? bits : null
}

/** The refusal for a range wider than the family's limit, or `null` when the width is acceptable. */
function rangeTooWide(bits: number, family: 'ipv4' | 'ipv6'): string | null {
  if (bits >= MIN_BAN_PREFIX[family]) return null
  if (family === 'ipv6') {
    return `Dải /${bits} quá rộng. Chỉ nhận dải IPv6 từ /${MIN_BAN_PREFIX.ipv6} trở lên — và hiện chưa hỗ trợ dải IPv6, hãy nhập địa chỉ đầy đủ.`
  }
  const addresses = (2 ** (32 - bits)).toLocaleString('vi-VN')
  return `Dải /${bits} quá rộng (${addresses} địa chỉ). Chỉ nhận dải IPv4 từ /${MIN_BAN_PREFIX.ipv4} đến /${MAX_BAN_PREFIX.ipv4}.`
}

/**
 * Accepts a bare IPv4, an IPv4 CIDR block (`/8`–`/32`), or a bare IPv6 literal.
 * The one check every writer of `reader_ip_bans` goes through (the ban form via
 * `services/ip-bans.ts`, the AI moderation queue's "ban IP").
 *
 * An IPv6 *range* is refused with a message that names the limitation out loud.
 * Silently storing `2001:db8::/32` would produce a ban row that looks active in
 * the admin table and matches nobody — the officer would conclude the ban system
 * does not work, which is a worse outcome than being told to enter the full
 * address.
 */
export function validateBanValue(raw: string): BanValidation {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { ok: false, error: 'Hãy nhập địa chỉ IP cần chặn.' }
  if (text.length > MAX_BAN_LENGTH) {
    return { ok: false, error: `Địa chỉ IP quá dài (tối đa ${MAX_BAN_LENGTH} ký tự).` }
  }

  const slashIndex = text.indexOf('/')

  if (slashIndex === -1) {
    const address = normalizeIp(text)
    if (!address) return { ok: false, error: 'Địa chỉ IP không hợp lệ.' }

    if (looksLikeIpv6(address)) {
      // A literal IPv6 address is matched exactly by matchesIpList, so it is
      // safe to store. Only ranges are unsupported.
      if (!/^[0-9a-f:]+$/.test(address) || !address.includes(':')) {
        return { ok: false, error: 'Địa chỉ IPv6 không hợp lệ.' }
      }
      return { ok: true, value: address }
    }

    if (ipv4ToInt(address) === null) {
      return { ok: false, error: 'Địa chỉ IP không hợp lệ.' }
    }
    return { ok: true, value: address }
  }

  const networkText = text.slice(0, slashIndex).trim()
  const bitsText = text.slice(slashIndex + 1).trim()

  const network = normalizeIp(networkText)
  if (!network) return { ok: false, error: 'Địa chỉ IP không hợp lệ.' }

  if (looksLikeIpv6(network)) {
    const bits = parsePrefix(bitsText, 'ipv6')
    const tooWide = bits === null ? null : rangeTooWide(bits, 'ipv6')
    return { ok: false, error: tooWide ?? 'Chưa hỗ trợ dải IPv6, hãy nhập địa chỉ đầy đủ.' }
  }

  if (ipv4ToInt(network) === null) {
    return { ok: false, error: 'Địa chỉ IP không hợp lệ.' }
  }

  const bits = parsePrefix(bitsText, 'ipv4')
  if (bits === null) {
    return { ok: false, error: `Độ dài dải (prefix) phải là số từ ${MIN_BAN_PREFIX.ipv4} đến ${MAX_BAN_PREFIX.ipv4}.` }
  }
  const tooWide = rangeTooWide(bits, 'ipv4')
  if (tooWide) return { ok: false, error: tooWide }

  return { ok: true, value: `${network}/${bits}` }
}

/**
 * Is this visitor covered by any ban entry? Empty list, empty or unparseable
 * address → false: a ban list has to fail open on a value it cannot read,
 * because failing closed there would lock out every visitor whose address the
 * app could not resolve.
 */
export function isIpBanned(ip: string | null | undefined, bans: readonly string[]): boolean {
  if (!bans || bans.length === 0) return false
  return matchesIpList(ip, bans)
}
