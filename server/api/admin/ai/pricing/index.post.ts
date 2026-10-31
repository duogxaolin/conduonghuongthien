import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiModelPricing, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { COST_OUT_OF_RANGE_MESSAGE, isStorableCostPerMillion } from '../../../../utils/ai/pricing-cost'

/**
 * Create a new AI model pricing row (spec R7.3).
 * `model` is the primary key, so duplicates are rejected.
 * Writes activity_logs within the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const model = typeof body.model === 'string' ? body.model.trim().slice(0, 64) : ''
  const provider = typeof body.provider === 'string' ? body.provider.trim().slice(0, 32) : ''
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 128) || null : null
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true

  if (!model) {
    throw createError({ statusCode: 400, statusMessage: 'Tên model là bắt buộc.' })
  }
  if (!provider) {
    throw createError({ statusCode: 400, statusMessage: 'Nhà cung cấp là bắt buộc.' })
  }

  const promptCost = typeof body.promptCostPerMillion === 'number' ? body.promptCostPerMillion : NaN
  const completionCost = typeof body.completionCostPerMillion === 'number' ? body.completionCostPerMillion : NaN
  if (!isStorableCostPerMillion(promptCost)) {
    throw createError({ statusCode: 400, statusMessage: `Giá input không hợp lệ. ${COST_OUT_OF_RANGE_MESSAGE}` })
  }
  if (!isStorableCostPerMillion(completionCost)) {
    throw createError({ statusCode: 400, statusMessage: `Giá output không hợp lệ. ${COST_OUT_OF_RANGE_MESSAGE}` })
  }

  const db = getDb()

  // Check uniqueness (model is PK)
  const [existing] = await db.select({ model: aiModelPricing.model })
    .from(aiModelPricing)
    .where(eq(aiModelPricing.model, model))
    .limit(1)
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `Model "${model}" đã tồn tại trong bảng giá.` })
  }

  const insert: typeof aiModelPricing.$inferInsert = {
    model,
    provider,
    label,
    isActive,
    promptCostPerMillion: String(promptCost),
    completionCostPerMillion: String(completionCost),
  }

  await db.transaction(async (tx) => {
    await tx.insert(aiModelPricing).values(insert)
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'create',
      resource: 'ai',
      resourceId: null,
      meta: {
        type: 'pricing_create',
        model,
        provider,
        promptCostPerMillion: promptCost,
        completionCostPerMillion: completionCost,
      },
    })
  })

  return { ok: true }
})
