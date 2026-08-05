import { requireResourcePermission } from '../../../../utils/permissions'
import { getGoogleOAuthSettings, serializeGoogleOAuthSettings } from '../../../../services/google-oauth-settings'

export default defineEventHandler(async (event) => {
  requireResourcePermission(event.context.adminUser, 'settings', 'read')
  // The event is passed through because the redirect URI is derived from the
  // request when PUBLIC_BASE_URL is unset — the page must show the same string
  // the OAuth endpoints will actually send to Google (design.md D4).
  return { ok: true, settings: serializeGoogleOAuthSettings(await getGoogleOAuthSettings(), event) }
})
