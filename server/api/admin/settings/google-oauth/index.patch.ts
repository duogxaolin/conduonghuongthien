import { requireResourcePermission } from '../../../../utils/permissions'
import {
  GoogleOAuthSettingsValidationError,
  serializeGoogleOAuthSettings,
  updateGoogleOAuthSettings,
  type GoogleOAuthSettingsUpdate,
} from '../../../../services/google-oauth-settings'

/**
 * Closed field list. `redirectUri` is deliberately absent and unknown keys are
 * refused rather than ignored: the redirect URI is derived server-side (design.md
 * D4), and an endpoint that silently drops a field an officer filled in reports
 * success for a change that did not happen.
 */
const FIELDS = new Set(['clientId', 'clientSecret', 'isEnabled', 'defaultCommentsEnabled'])

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu cấu hình không hợp lệ.' })
  }

  const unknown = Object.keys(body).filter(key => !FIELDS.has(key))
  if (unknown.length) {
    throw createError({ statusCode: 400, statusMessage: `Trường không được phép: ${unknown.join(', ')}` })
  }

  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  try {
    const settings = await updateGoogleOAuthSettings(adminUser.id, body as GoogleOAuthSettingsUpdate, event.context.requestId)
    return { ok: true, settings: serializeGoogleOAuthSettings(settings, event) }
  } catch (error) {
    if (error instanceof GoogleOAuthSettingsValidationError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }
})
