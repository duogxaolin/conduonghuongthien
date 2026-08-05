/**
 * Shared pieces of the sign-in flow: the state cookie's identity, and how a
 * refusal is communicated back to the reader.
 *
 * Both endpoints (start, callback) need these, and a second copy of the cookie
 * name or the path is a cookie that gets set on one route and looked for on
 * another — a failure that looks exactly like "Google rejected us".
 */

/** Distinct from cdkt_reader: this one lives for one round trip and is deleted on use. */
export const OAUTH_STATE_COOKIE = 'cdkt_oauth_state'

/**
 * Scoped to the OAuth routes. A path-scoped cookie is not attached to the
 * hundreds of ordinary page requests a reader makes, and nothing outside this
 * flow has any use for it.
 */
export const OAUTH_STATE_COOKIE_PATH = '/api/auth/google'

/** Ten minutes: long enough to read a consent screen, short enough that an
 *  abandoned flow cannot be resumed an hour later from a shared computer. */
export const OAUTH_STATE_MAX_AGE = 10 * 60

/**
 * Why a sign-in could not proceed. These strings reach the browser as a query
 * parameter, so they are deliberately coarse — enough for the UI to print a
 * useful sentence, never enough to tell a prober which credential is missing.
 */
export type SignInBlockedReason =
  | 'disabled'
  | 'not_configured'
  | 'secret_unreadable'
  | 'rate_limited'
  | 'ip_banned'
  | 'account_banned'
  | 'failed'

/**
 * Send the reader back where they came from, carrying the reason.
 *
 * Redirecting rather than rendering an error keeps the reader on the page they
 * were reading — the whole point of signing in was to comment there — and means
 * a refusal never produces a dead end they can only leave with the back button.
 *
 * `returnPath` must already have passed isSafeReturnPath; every call site takes
 * it from `safeReturnPathOr` or from a verified state.
 */
export function signInBlockedRedirect(returnPath: string, reason: SignInBlockedReason): string {
  const separator = returnPath.includes('?') ? '&' : '?'
  return `${returnPath}${separator}dangnhap=${encodeURIComponent(reason)}`
}
