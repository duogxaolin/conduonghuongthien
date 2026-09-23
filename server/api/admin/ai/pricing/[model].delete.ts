import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiModelPricing, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

/**
 * Delete an AI model pricing row by model name (PK).
 * Writes activity_logs within the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const modelParam = getRouterParam(event, 'model')
  if (!modelParam || typeof modelParam !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Model không hợp lệ.' })
  }

  const db = getDb()

  const [existing] = await db.select().from(aiModelPricing).where(eq(aiModelPricing.model, modelParam)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Model pricing không tồn tại.' })
  }

  await db.transaction(async (tx) => {
    await tx.delete(aiModelPricing).where(eq(aiModelPricing.model, modelParam))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: null,
      meta: JSON.stringify({
        type: 'pricing_delete',
        model: modelParam,
        provider: existing.provider,
      }),
    })
  })

  return { ok: true }
})
