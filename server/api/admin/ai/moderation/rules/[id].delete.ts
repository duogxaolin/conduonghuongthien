import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../../../../../utils/db'
import { aiModerationRules, activityLogs } from '../../../../../db/schema'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { invalidateModerationRulesCache } from '../../../../../services/moderation-worker'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'delete')

  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }

  const db = getDb()
  const [existing] = await db.select().from(aiModerationRules).where(eq(aiModerationRules.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Quy tắc không tồn tại.' })
  }

  await db.transaction(async (tx) => {
    await tx.delete(aiModerationRules).where(eq(aiModerationRules.id, id))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: id,
      meta: JSON.stringify({ type: 'delete_moderation_rule', pattern: existing.pattern }),
    })
  })

  invalidateModerationRulesCache()
  return { ok: true }
})
