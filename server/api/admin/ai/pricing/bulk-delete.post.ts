import { inArray } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiModelPricing, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

/**
 * Bulk delete AI model pricing rows.
 * Accepts `{ models: string[] }`.
 * Writes activity_logs in the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object' || !Array.isArray(body.models)) {
    throw createError({ statusCode: 400, statusMessage: 'Danh sách models không hợp lệ.' })
  }

  const requested: string[] = [...new Set<string>(body.models
    .filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0)
    .map((m: string) => m.trim().slice(0, 64)))]

  if (requested.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng chọn ít nhất 1 model để xoá.' })
  }

  const db = getDb()

  // The count and the audit line are what was deleted, not what was asked: the rows
  // found are locked until the delete commits, and a name never in the list (or sent
  // twice) is not reported as deleted.
  const deleted = await db.transaction(async (tx) => {
    const found = await tx.select({ model: aiModelPricing.model }).from(aiModelPricing)
      .where(inArray(aiModelPricing.model, requested))
      .for('update')
    const models = found.map(row => row.model)
    if (models.length === 0) return models
    await tx.delete(aiModelPricing).where(inArray(aiModelPricing.model, models))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: null,
      meta: {
        type: 'pricing_bulk_delete',
        count: models.length,
        models,
      },
    })
    return models
  })

  return { ok: true, deleted: deleted.length }
})
