import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiModelPricing, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

/**
 * Update AI model pricing, label, and/or active status.
 * Requires `ai.update` permission.
 * Writes activity_logs in the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const modelParam = getRouterParam(event, 'model')
  if (!modelParam || typeof modelParam !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Model không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const db = getDb()

  const [existing] = await db.select().from(aiModelPricing).where(eq(aiModelPricing.model, modelParam)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Model không tồn tại.' })
  }

  const patch: Partial<typeof aiModelPricing.$inferInsert> = {}

  if (typeof body.label === 'string') {
    patch.label = body.label.trim().slice(0, 128) || null
  }
  if (typeof body.isActive === 'boolean') {
    patch.isActive = body.isActive
  }
  if (typeof body.promptCostPerMillion === 'number' && Number.isFinite(body.promptCostPerMillion) && body.promptCostPerMillion >= 0) {
    patch.promptCostPerMillion = String(body.promptCostPerMillion)
  }
  if (typeof body.completionCostPerMillion === 'number' && Number.isFinite(body.completionCostPerMillion) && body.completionCostPerMillion >= 0) {
    patch.completionCostPerMillion = String(body.completionCostPerMillion)
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, message: 'Không có thay đổi.' }
  }

  await db.transaction(async (tx) => {
    await tx.update(aiModelPricing).set(patch).where(eq(aiModelPricing.model, modelParam))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: null,
      meta: JSON.stringify({
        type: 'pricing_update',
        model: modelParam,
        changedFields: Object.keys(patch),
      }),
    })
  })

  return { ok: true }
})
