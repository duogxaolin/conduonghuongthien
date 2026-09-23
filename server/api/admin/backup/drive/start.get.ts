/**
 * Starts the admin Google Drive OAuth link flow.
 *
 * Pattern follows `server/api/auth/google/start.get.ts` (reader sign-in) but:
 *   - admin-only (`settings.update` permission);
 *   - **OAuth Client ID/Secret riêng cho Drive** (`backup_drive_oauth_config`),
 *     không dùng chung `google_oauth_settings` của reader — scope/audience/consent
 *     khác, gộp OAuth Client buộc consent screen reader khai scope `drive.file`;
 *   - separate state cookie (`cdkt_drive_oauth_state`, path `/api/admin/backup/drive`)
 *     so it cannot collide with the reader flow;
 *   - Drive.file scope instead of `openid email profile`;
 *   - `access_type=offline` + `prompt=consent` to force a fresh refresh token
 *     (without `prompt=consent` Google returns no refresh token on a repeat
 *     consent for an already-authorized app).
 *
 * Like the reader start, every refusal is checked HERE so a failure never
 * bounces off accounts.google.com — the officer sees a reason on the backup
 * page, not a Google error.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { getUsableDriveOauthConfig } from '../../../../services/backup-drive-oauth-config'
import {
  DRIVE_CALLBACK_PATH,
  DRIVE_SCOPE,
  GOOGLE_AUTH_ENDPOINT,
  resolveDriveRedirectUri,
} from '../../../../utils/google-oauth/config'
import { issueState, stateSigningKey } from '../../../../utils/google-oauth/state'

const DRIVE_OAUTH_STATE_COOKIE = 'cdkt_drive_oauth_state'
const DRIVE_OAUTH_STATE_COOKIE_PATH = '/api/admin/backup/drive'
const DRIVE_OAUTH_STATE_MAX_AGE = 10 * 60

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const config = await getUsableDriveOauthConfig()
  if (!config.ok) {
    return sendRedirect(event, `/admin/settings/backup?drive_error=${config.reason}`, 302)
  }

  const signedState = issueState('/admin/settings/backup', stateSigningKey())

  setCookie(event, DRIVE_OAUTH_STATE_COOKIE, signedState, {
    httpOnly: true,
    secure:   getRequestURL(event).protocol === 'https:' || getRequestHeader(event, 'x-forwarded-proto') === 'https',
    // 'lax' for the same reason the reader cookie is: the callback is a
    // cross-site navigation from Google and 'strict' would withhold this cookie
    // on exactly the hop that needs it.
    sameSite: 'lax',
    maxAge:   DRIVE_OAUTH_STATE_MAX_AGE,
    // Scoped to the Drive OAuth routes: no other handler has any use for it.
    path:     DRIVE_OAUTH_STATE_COOKIE_PATH,
  })

  const authorizeUrl = new URL(GOOGLE_AUTH_ENDPOINT)
  authorizeUrl.searchParams.set('client_id', config.clientId)
  authorizeUrl.searchParams.set('redirect_uri', resolveDriveRedirectUri(event))
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', DRIVE_SCOPE)
  authorizeUrl.searchParams.set('state', signedState)
  // access_type=offline → refresh token; prompt=consent → force a fresh consent
  // so Google returns a NEW refresh token even if the app was authorized before.
  authorizeUrl.searchParams.set('access_type', 'offline')
  authorizeUrl.searchParams.set('prompt', 'consent')

  return sendRedirect(event, authorizeUrl.toString(), 302)
})
