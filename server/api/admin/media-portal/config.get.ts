import { createError, defineEventHandler } from 'h3'
import { asc } from 'drizzle-orm'
import { checkPermission } from '../../../utils/auth'
import { resolveMediaConfig } from '../../../utils/media-config'
import { getDb } from '../../../utils/db'
import { categories } from '../../../db/schema'

/** Only capabilities and category labels needed by media forms; never storage configuration. */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  if (!actor || !(['read', 'create'] as const).some(action => checkPermission(actor.permissions ?? [], 'media_portal', action, actor.isSuperAdmin === true))) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }
  const config = resolveMediaConfig()
  const options = await getDb().select({ id: categories.id, name: categories.name })
    .from(categories).orderBy(asc(categories.displayOrder), asc(categories.name), asc(categories.id))
  return { ok: true, uploadEnabled: config.uploadEnabled, maxUploadSize: config.maxUploadSize, categories: options }
})
