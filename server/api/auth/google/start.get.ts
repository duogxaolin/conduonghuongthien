/**
 * Starts the Google sign-in flow.
 *
 * Everything that could stop the flow is checked here, before the reader leaves
 * the portal: a refusal that only becomes visible on Google's error page is a
 * refusal the officer running this portal cannot diagnose and the reader cannot
 * act on. So a disabled switch, missing credentials, an unreadable secret, an
 * exhausted rate limit and a banned address all produce a redirect back to the
 * portal carrying a reason, never a bounce off accounts.google.com.
 *
 * The IP ban is enforced HERE as well as at comment time (design.md D11).
 * Enforcing only at write time means a banned person signs in under a fresh
 * Google account and carries on; the account ban would be doing nothing.
 */
import { getUsableOAuthConfig } from '../../../services/google-oauth-settings'
import { GOOGLE_AUTH_ENDPOINT, GOOGLE_SCOPE, resolveRedirectUri } from '../../../utils/google-oauth/config'
import { issueState, stateSigningKey } from '../../../utils/google-oauth/state'
import { safeReturnPathOr } from '../../../utils/google-oauth/return-path'
import { OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_PATH, OAUTH_STATE_MAX_AGE, signInBlockedRedirect } from '../../../utils/google-oauth/flow'
import { isIpBanned } from '../../../utils/ip-ban'
import { loadIpBanValues } from '../../../services/ip-bans'
import { getClientIp } from '../../../utils/client-ip'
import { recordRateLimitHit, type RateLimitRule } from '../../../utils/rate-limit-store'
import { logWarn } from '../../../utils/logger'
import { rateLimitDeps } from '../../../utils/rate-limit-deps'

/** Per address. Ten starts in ten minutes is far above any human retry pattern
 *  and far below what a script needs to be useful. */
const SIGN_IN_RULE: RateLimitRule = { limit: 10, windowSeconds: 600 }

export default defineEventHandler(async (event) => {
  const returnPath = safeReturnPathOr(getQuery(event).return_to, '/')

  const config = await getUsableOAuthConfig()
  if (!config.ok) {
    logWarn({ event: 'reader_auth.start_refused', reason: config.reason })
    return sendRedirect(event, signInBlockedRedirect(returnPath, config.reason), 302)
  }

  const ip = getClientIp(event)
  const deps = rateLimitDeps()

  const state = await recordRateLimitHit(`reader:signin:${ip}`, SIGN_IN_RULE, deps)
  if (state.blocked) {
    logWarn({ event: 'reader_auth.start_rate_limited', ip })
    return sendRedirect(event, signInBlockedRedirect(returnPath, 'rate_limited'), 302)
  }

  if (isIpBanned(ip, await loadIpBanValues())) {
    logWarn({ event: 'reader_auth.start_ip_banned', ip })
    return sendRedirect(event, signInBlockedRedirect(returnPath, 'ip_banned'), 302)
  }

  const signedState = issueState(returnPath, stateSigningKey())

  setCookie(event, OAUTH_STATE_COOKIE, signedState, {
    httpOnly: true,
    secure:   getRequestURL(event).protocol === 'https:' || getRequestHeader(event, 'x-forwarded-proto') === 'https',
    // 'lax', for the same reason the reader cookie is: the callback is a
    // cross-site navigation from Google and 'strict' would withhold this cookie
    // on exactly the hop that needs it.
    sameSite: 'lax',
    maxAge:   OAUTH_STATE_MAX_AGE,
    // Scoped to the OAuth routes: no other handler has any use for it, and a
    // path-scoped cookie is not attached to the hundreds of ordinary requests a
    // reader makes while browsing.
    path:     OAUTH_STATE_COOKIE_PATH,
  })

  const authorizeUrl = new URL(GOOGLE_AUTH_ENDPOINT)
  authorizeUrl.searchParams.set('client_id', config.clientId)
  // Same derived value the token exchange will send. Google compares the two and
  // refuses the exchange if they differ, so they must come from one function.
  authorizeUrl.searchParams.set('redirect_uri', resolveRedirectUri(event))
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', GOOGLE_SCOPE)
  authorizeUrl.searchParams.set('state', signedState)

  return sendRedirect(event, authorizeUrl.toString(), 302)
})
