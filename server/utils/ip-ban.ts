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

function looksLikeIpv6(text: string): boolean {
  // Any address carrying a colon is IPv6 here: normalizeIp has already unwrapped
  // `[::1]:443` bracket forms and stripped an IPv4 `:port`, so a surviving colon
  // is part of the address itself.
  return text.includes(':')
}

/**
 * Accepts a bare IPv4, an IPv4 CIDR block (`/0`–`/32`), or a bare IPv6 literal.
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
    return { ok: false, error: 'Chưa hỗ trợ dải IPv6, hãy nhập địa chỉ đầy đủ.' }
  }

  if (ipv4ToInt(network) === null) {
    return { ok: false, error: 'Địa chỉ IP không hợp lệ.' }
  }

  if (!/^\d{1,2}$/.test(bitsText)) {
    return { ok: false, error: 'Độ dài dải (prefix) phải là số từ 0 đến 32.' }
  }
  const bits = Number(bitsText)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
    return { ok: false, error: 'Độ dài dải (prefix) phải là số từ 0 đến 32.' }
  }

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
