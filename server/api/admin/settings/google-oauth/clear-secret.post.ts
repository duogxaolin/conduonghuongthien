import { requireResourcePermission } from '../../../../utils/permissions'
import { clearGoogleOAuthSecret, serializeGoogleOAuthSettings } from '../../../../services/google-oauth-settings'

/**
 * Removes the stored client secret and forces the master switch off, keeping the
 * client id so the officer does not have to look it up again.
 *
 * POST rather than DELETE on the resource: the row survives, and a DELETE on the
 * settings path would read as "remove the configuration", which is not what this
 * does.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')
  const settings = await clearGoogleOAuthSecret(adminUser.id, event.context.requestId)
  return { ok: true, settings: serializeGoogleOAuthSettings(settings, event) }
})
