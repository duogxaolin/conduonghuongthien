/**
 * Where to send the reader back to after Google returns them.
 *
 * This value originates in a query string, travels through the signed OAuth
 * state, and ends up in a `Location:` header. Every one of those hops is a place
 * an attacker would like to put an absolute URL, because a login flow that
 * redirects off-site after authenticating is a credible phishing page hosted on
 * our own domain. So the rule is not "sanitize" but "accept a narrow shape":
 * a site-relative path and nothing else.
 */

/** Long enough for any real path on this portal, short enough to bound the cookie. */
const MAX_RETURN_PATH_LENGTH = 512

/**
 * True only for a string that is unambiguously a path on this site.
 *
 * Rejected, and why each one matters:
 *  - `//evil.com` — a protocol-relative URL. Browsers treat it as absolute, so
 *    a single leading-slash check is not enough.
 *  - `https://evil.com`, `javascript:alert(1)` — any scheme at all.
 *  - `/x@y.com` — `@` makes the leading part a userinfo field once a scheme is
 *    inferred or prepended anywhere downstream.
 *  - `/\evil` — a backslash is normalized to `/` by some browsers, which turns
 *    this back into the protocol-relative case.
 *  - control characters (including CR/LF) — header injection.
 */
export function isSafeReturnPath(candidate: unknown): boolean {
  if (typeof candidate !== 'string') return false
  if (candidate.length === 0 || candidate.length > MAX_RETURN_PATH_LENGTH) return false

  // Exactly one leading slash.
  if (candidate[0] !== '/') return false
  if (candidate[1] === '/') return false

  if (candidate.includes('\\')) return false
  if (candidate.includes('@')) return false
  if (candidate.includes(':')) return false

  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return false
    // A raw space in a path would be re-encoded or truncated inconsistently
    // between the cookie, the header and the browser; refuse rather than guess.
    if (code === 0x20) return false
  }

  return true
}

/** The safe path, or the fallback. Never throws, never returns attacker input. */
export function safeReturnPathOr(candidate: unknown, fallback = '/'): string {
  return isSafeReturnPath(candidate) ? (candidate as string) : fallback
}
