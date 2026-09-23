import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiProviders, aiServiceConfigs, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

/**
 * Delete an AI provider.
 * Rejects deletion if any active service config references this provider.
 * Writes activity_logs within the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }

  const db = getDb()
  const [existing] = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Provider không tồn tại.' })
  }

  // Check if any service config uses this provider
  const linked = await db.select({ serviceKey: aiServiceConfigs.serviceKey })
    .from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.provider, existing.provider))
    .limit(1)
  if (linked.length > 0 && linked[0]) {
    throw createError({ statusCode: 409, statusMessage: `Không thể xoá: nhà cung cấp "${existing.provider}" đang được dùng bởi dịch vụ "${linked[0].serviceKey}". Gán dịch vụ sang nhà cung cấp khác trước khi xoá.` })
  }

  await db.transaction(async (tx) => {
    await tx.delete(aiProviders).where(eq(aiProviders.id, id))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: id,
      meta: JSON.stringify({ provider: existing.provider }),
    })
  })

  return { ok: true }
})
