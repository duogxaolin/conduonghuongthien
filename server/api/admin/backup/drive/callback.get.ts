/**
 * Google returns the admin here with an authorization code for the Drive link.
 *
 * Order of operations follows `server/api/auth/google/callback.get.ts` (reader
 * sign-in):
 *   1. Verify `state` and clear the cookie BEFORE anything else — no token
 *      exchange on an unverified state.
 *   2. Exchange the code server-to-server over TLS, authenticated with the
 *      client secret, sending the SAME derived redirect URI the authorization
 *      request carried.
 *   3. Check `aud` on the id_token (the signature is not verified locally —
 *      see design.md D6 — but `aud` must still match to reject a token minted
 *      for a different application).
 *   4. Require a `refresh_token` (without it the link is useless; `prompt=consent`
 *      in the start endpoint is what forces Google to return one).
 *   5. Upsert the refresh token envelope + linked email/sub + audit in ONE
 *      transaction.
 *
 * Unlike the reader callback, there is NO IP ban check and NO account-ban
 * check — this endpoint is admin-only (permission `settings.update`) and runs
 * after admin-auth middleware, so the caller is already an authenticated
 * officer, not a member of the public.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { getUsableDriveOauthConfig } from '../../../../services/backup-drive-oauth-config'
import { GOOGLE_TOKEN_ENDPOINT, resolveDriveRedirectUri } from '../../../../utils/google-oauth/config'
import { stateSigningKey, verifyState } from '../../../../utils/google-oauth/state'
import { decodeIdTokenClaims } from '../../../../utils/google-oauth/id-token'
import { storeDriveLink } from '../../../../services/backup-drive-oauth'
import { logWarn } from '../../../../utils/logger'

const DRIVE_OAUTH_STATE_COOKIE = 'cdkt_drive_oauth_state'
const DRIVE_OAUTH_STATE_COOKIE_PATH = '/api/admin/backup/drive'

const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000

// Isolate the token exchange call from the generic inference so TS doesn't
// instantiate the full $fetch generic chain (TS2589 + fetch overload mismatch).
async function fetchTokenExchange(
  url: string,
  opts: { method: 'POST'; timeout: number; body: string; headers: Record<string, string> },
): Promise<{ id_token?: string; refresh_token?: string }> {
  return ($fetch as (u: string, o: Record<string, unknown>) => Promise<{ id_token?: string; refresh_token?: string }>)(url, opts)
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const query = getQuery(event)

  const cookieValue = getCookie(event, DRIVE_OAUTH_STATE_COOKIE)
  // Cleared before any work: consumed exactly once, success or failure.
  deleteCookie(event, DRIVE_OAUTH_STATE_COOKIE, { path: DRIVE_OAUTH_STATE_COOKIE_PATH })

  const stateResult = verifyState({
    cookieValue,
    presentedState: typeof query.state === 'string' ? query.state : null,
    key: stateSigningKey(),
  })

  if (!stateResult.ok) {
    logWarn({ event: 'drive_oauth.state_rejected', reason: stateResult.reason })
    return sendRedirect(event, '/admin/settings/backup?drive_error=state_failed', 302)
  }

  // User declined the consent screen.
  if (typeof query.error === 'string' && query.error) {
    return sendRedirect(event, '/admin/settings/backup?drive_error=declined', 302)
  }

  const code = typeof query.code === 'string' ? query.code.trim() : ''
  if (!code) {
    logWarn({ event: 'drive_oauth.callback_without_code' })
    return sendRedirect(event, '/admin/settings/backup?drive_error=failed', 302)
  }

  const config = await getUsableDriveOauthConfig()
  if (!config.ok) {
    logWarn({ event: 'drive_oauth.callback_refused', reason: config.reason })
    return sendRedirect(event, `/admin/settings/backup?drive_error=${config.reason}`, 302)
  }

  let refreshToken: string
  let idToken: string
  try {
    const response = await fetchTokenExchange(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      timeout: TOKEN_EXCHANGE_TIMEOUT_MS,
      body: new URLSearchParams({
        code,
        client_id:     config.clientId,
        client_secret:  config.clientSecret,
        redirect_uri:   resolveDriveRedirectUri(event),
        grant_type:     'authorization_code',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    if (!response?.id_token) throw new Error('id_token missing from token response')
    if (!response?.refresh_token) throw new Error('refresh_token missing — re-consent required')
    idToken = response.id_token
    refreshToken = response.refresh_token
  } catch (error) {
    logWarn({
      event: 'drive_oauth.token_exchange_failed',
      error: error instanceof Error ? error.message : String(error),
    })
    return sendRedirect(event, '/admin/settings/backup?drive_error=exchange_failed', 302)
  }

  const claims = decodeIdTokenClaims(idToken)
  if (!claims) {
    logWarn({ event: 'drive_oauth.id_token_invalid' })
    return sendRedirect(event, '/admin/settings/backup?drive_error=failed', 302)
  }

  // `aud` must match our client id — a token genuinely from Google but minted
  // for a different application would otherwise be accepted as an identity.
  if (claims.aud !== config.clientId) {
    logWarn({ event: 'drive_oauth.id_token_aud_rejected' })
    return sendRedirect(event, '/admin/settings/backup?drive_error=aud_mismatch', 302)
  }

  if (!claims.sub || typeof claims.sub !== 'string') {
    logWarn({ event: 'drive_oauth.id_token_no_sub' })
    return sendRedirect(event, '/admin/settings/backup?drive_error=failed', 302)
  }

  try {
    await storeDriveLink(adminUser.id, {
      refreshToken,
      linkedEmail: typeof claims.email === 'string' ? claims.email : '',
      linkedSub:   claims.sub,
    })
  } catch (error) {
    logWarn({
      event: 'drive_oauth.store_failed',
      error: error instanceof Error ? error.message : String(error),
    })
    return sendRedirect(event, '/admin/settings/backup?drive_error=store_failed', 302)
  }

  return sendRedirect(event, '/admin/settings/backup?drive_linked=1', 302)
})
