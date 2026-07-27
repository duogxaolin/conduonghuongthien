import { getDb } from '../../../utils/db'
import { media, settings, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { deleteLocalFile } from '../../../utils/media-local'
import { deleteR2File, type R2Config } from '../../../utils/media-r2'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'media', 'delete', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid media ID' })

  const db = getDb()
  const [mediaItem] = await db.select().from(media).where(eq(media.id, id)).limit(1)

  if (!mediaItem) {
    throw createError({ statusCode: 404, statusMessage: 'Media file không tồn tại.' })
  }

  if (mediaItem.provider === 'r2') {
    const dbSettings = await db.select().from(settings)
    const settingsMap = new Map(dbSettings.map(s => [s.key, s.value]))
    const r2Config: R2Config = {
      accountId:       settingsMap.get('r2_account_id') || '',
      accessKeyId:     settingsMap.get('r2_access_key') || '',
      secretAccessKey: settingsMap.get('r2_secret_key') || '',
      bucket:          settingsMap.get('r2_bucket') || '',
      publicUrl:       settingsMap.get('r2_public_url') || '',
    }
    await deleteR2File(mediaItem.storagePath, r2Config)
  } else {
    await deleteLocalFile(mediaItem.storagePath)
  }

  await db.delete(media).where(eq(media.id, id))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'delete',
    resource: 'media',
    resourceId: id,
    meta: { filename: mediaItem.filename },
  })

  return { ok: true }
})
