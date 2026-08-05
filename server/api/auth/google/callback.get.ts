/**
 * Google returns the reader here with an authorization code.
 *
 * The order below is the security of this endpoint:
 *
 *   1. **Verify `state` and clear the cookie before anything else.** No token
 *      exchange happens on an unverified state — otherwise this endpoint would
 *      spend a real authorization code on behalf of whoever crafted the URL.
 *      Clearing on consumption is what makes a replayed callback URL fail: the
 *      code is single-use at Google, but the cookie is what stops a second
 *      attempt from even reaching Google.
 *   2. **Exchange the code server-to-server**, over TLS, authenticated with the
 *      client secret, sending the SAME derived redirect URI the authorization
 *      request carried. Google compares them and refuses a mismatch.
 *   3. **Check the claims, not the signature** (design.md D6). A token obtained
 *      through the portal's own authenticated POST needs no local JWKS
 *      verification, but `aud` must still be checked: a token that genuinely came
 *      from Google but was minted for a different application would otherwise be
 *      accepted as an identity on this portal.
 *   4. **Key the account on `sub`, never on email.** Email is mutable and
 *      reassignable, so keying on it merges two people or splits one.
 *   5. **Re-check the IP ban after the exchange**, because a ban could have been
 *      added while the reader was on the consent screen, and because the ban
 *      exists to stop the account being created in the first place.
 *
 * The `picture` claim is read and discarded — never stored, never rendered
 * (design.md D7). Avatars are drawn locally from initials so that adding comments
 * does not silently start sending every visitor's address to a Google image host
 * on the pages citizens actually read.
 */
import { eq } from 'drizzle-orm'

import { getDb } from '../../../utils/db'
import { readerAccounts } from '../../../db/schema'
import { getUsableOAuthConfig } from '../../../services/google-oauth-settings'
import { GOOGLE_TOKEN_ENDPOINT, resolveRedirectUri } from '../../../utils/google-oauth/config'
import { stateSigningKey, verifyState } from '../../../utils/google-oauth/state'
import { OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_PATH, signInBlockedRedirect } from '../../../utils/google-oauth/flow'
import { decodeIdTokenClaims, validateIdTokenClaims } from '../../../utils/google-oauth/id-token'
import { isIpBanned } from '../../../utils/ip-ban'
import { loadIpBanValues } from '../../../services/ip-bans'
import { setReaderCookie } from '../../../utils/reader-auth'
import { signReaderToken } from '../../../utils/auth'
import { getClientIp } from '../../../utils/client-ip'
import { logWarn } from '../../../utils/logger'

/** Bounded so a hung Google endpoint cannot hold a request open indefinitely. */
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const cookieValue = getCookie(event, OAUTH_STATE_COOKIE)
  // Cleared before any work: a callback is consumed exactly once, whether it
  // succeeds or fails.
  deleteCookie(event, OAUTH_STATE_COOKIE, { path: OAUTH_STATE_COOKIE_PATH })

  const stateResult = verifyState({
    cookieValue,
    presentedState: typeof query.state === 'string' ? query.state : null,
    key: stateSigningKey(),
  })

  if (!stateResult.ok) {
    logWarn({ event: 'reader_auth.state_rejected', reason: stateResult.reason })
    // Home, not the return path: an unverified state means the return path in it
    // is not trustworthy either.
    return sendRedirect(event, signInBlockedRedirect('/', 'failed'), 302)
  }

  const returnPath = stateResult.returnPath

  // Google reports a declined consent screen this way. Not an error worth logging
  // as a failure — the reader simply changed their mind.
  if (typeof query.error === 'string' && query.error) {
    return sendRedirect(event, returnPath, 302)
  }

  const code = typeof query.code === 'string' ? query.code.trim() : ''
  if (!code) {
    logWarn({ event: 'reader_auth.callback_without_code' })
    return sendRedirect(event, signInBlockedRedirect(returnPath, 'failed'), 302)
  }

  const config = await getUsableOAuthConfig()
  if (!config.ok) {
    logWarn({ event: 'reader_auth.callback_refused', reason: config.reason })
    return sendRedirect(event, signInBlockedRedirect(returnPath, config.reason), 302)
  }

  let idToken: string
  try {
    const response = await $fetch<{ id_token?: string }>(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      timeout: TOKEN_EXCHANGE_TIMEOUT_MS,
      body: new URLSearchParams({
        code,
        client_id:     config.clientId,
        client_secret: config.clientSecret,
        // The same function that produced the value in the authorization request.
        // One call site each, so the two cannot drift (design.md D4).
        redirect_uri:  resolveRedirectUri(event),
        grant_type:    'authorization_code',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    if (!response?.id_token) throw new Error('id_token missing from token response')
    idToken = response.id_token
  } catch (error) {
    logWarn({
      event: 'reader_auth.token_exchange_failed',
      error: error instanceof Error ? error.message : String(error),
    })
    return sendRedirect(event, signInBlockedRedirect(returnPath, 'failed'), 302)
  }

  const claims = decodeIdTokenClaims(idToken)
  const verdict = validateIdTokenClaims(claims, config.clientId, Date.now())
  if (!verdict.ok) {
    logWarn({ event: 'reader_auth.id_token_rejected', reason: verdict.reason })
    return sendRedirect(event, signInBlockedRedirect(returnPath, 'failed'), 302)
  }

  const ip = getClientIp(event)
  if (isIpBanned(ip, await loadIpBanValues())) {
    logWarn({ event: 'reader_auth.callback_ip_banned', ip })
    return sendRedirect(event, signInBlockedRedirect(returnPath, 'ip_banned'), 302)
  }

  const db = getDb()
  const userAgent = (getRequestHeader(event, 'user-agent') || '').slice(0, 512) || null
  const now = new Date()

  const [existing] = await db
    .select({
      id:           readerAccounts.id,
      isBanned:     readerAccounts.isBanned,
      tokenVersion: readerAccounts.tokenVersion,
    })
    .from(readerAccounts)
    .where(eq(readerAccounts.googleSub, verdict.claims.sub))
    .limit(1)

  let readerId: number
  let tokenVersion: number

  if (existing) {
    // A banned account is refused here rather than being handed a ticket that
    // requireReader would reject on the next request: the reader has to be told
    // signing in again will not help, or they will keep trying.
    if (existing.isBanned) {
      logWarn({ event: 'reader_auth.callback_account_banned', readerId: existing.id })
      return sendRedirect(event, signInBlockedRedirect(returnPath, 'account_banned'), 302)
    }

    await db
      .update(readerAccounts)
      .set({
        // Refreshed on every sign-in: a reader who changed their Google display
        // name should not keep appearing under the old one on a public page.
        email:         verdict.claims.email ?? null,
        displayName:   verdict.claims.name ?? null,
        lastSeenAt:    now,
        lastIp:        ip,
        lastUserAgent: userAgent,
      })
      .where(eq(readerAccounts.id, existing.id))

    readerId = existing.id
    tokenVersion = existing.tokenVersion
  } else {
    const inserted = await db.insert(readerAccounts).values({
      googleSub:     verdict.claims.sub,
      email:         verdict.claims.email ?? null,
      displayName:   verdict.claims.name ?? null,
      lastSeenAt:    now,
      lastIp:        ip,
      lastUserAgent: userAgent,
    })

    readerId = Number((inserted as unknown as { insertId?: number }).insertId ?? 0)
    tokenVersion = 0

    if (!readerId) {
      logWarn({ event: 'reader_auth.account_insert_failed' })
      return sendRedirect(event, signInBlockedRedirect(returnPath, 'failed'), 302)
    }
  }

  setReaderCookie(event, signReaderToken({ readerId, tokenVersion }))
  return sendRedirect(event, returnPath, 302)
})
