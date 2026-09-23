import { createError, defineEventHandler } from 'h3'
import { asc } from 'drizzle-orm'
import { checkPermission } from '../../../utils/auth'
import { resolveMediaConfigWithDb } from '../../../services/media-config-service'
import { getDb } from '../../../utils/db'
import { mediaCategories } from '../../../db/schema'

/** Only capabilities and category labels needed by media forms; never storage configuration. */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  if (!actor || !(['read', 'create'] as const).some(action => checkPermission(actor.permissions ?? [], 'media_portal', action, actor.isSuperAdmin === true))) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }
  const db = getDb()
  const { config } = await resolveMediaConfigWithDb(db)
  const options = await db.select({ id: mediaCategories.id, name: mediaCategories.name })
    .from(mediaCategories).orderBy(asc(mediaCategories.displayOrder), asc(mediaCategories.name), asc(mediaCategories.id))
  return { ok: true, uploadEnabled: config.uploadEnabled, maxUploadSize: config.maxUploadSize, categories: options }
})
