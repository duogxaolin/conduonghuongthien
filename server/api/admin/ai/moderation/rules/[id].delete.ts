import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../../../../../utils/db'
import { aiModerationRules, activityLogs } from '../../../../../db/schema'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { readAffectedRows } from '../../../../../utils/affected-rows'
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
    // Counted: a rule another officer deleted since the read above is a 404 with no second
    // "delete" audit row (FINDING-R7-12, the R6-10 rule).
    const [deleted] = await tx.delete(aiModerationRules).where(eq(aiModerationRules.id, id))
    if (readAffectedRows(deleted) !== 1) {
      throw createError({ statusCode: 404, statusMessage: 'Quy tắc không tồn tại.' })
    }
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: id,
      meta: { type: 'delete_moderation_rule', pattern: existing.pattern },
    })
  })

  invalidateModerationRulesCache()
  return { ok: true }
})
