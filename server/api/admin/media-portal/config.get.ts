import { createError, defineEventHandler } from 'h3'
import { checkPermission } from '../../../utils/auth'
import { listMediaCategoryOptions, resolveAdminMediaConfig } from '../../../services/admin-media-config'

/** Only capabilities and category labels needed by media forms; never storage configuration. */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  if (!actor || !(['read', 'create'] as const).some(action => checkPermission(actor.permissions ?? [], 'media_portal', action, actor.isSuperAdmin === true))) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }
  const { config } = await resolveAdminMediaConfig()
  const options = await listMediaCategoryOptions()
  return { ok: true, uploadEnabled: config.uploadEnabled, maxUploadSize: config.maxUploadSize, categories: options }
})
