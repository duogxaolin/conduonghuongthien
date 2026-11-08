import type { aiModelPricing } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { COST_OUT_OF_RANGE_MESSAGE, isStorableCostPerMillion } from '../../../../utils/ai/pricing-cost'
import { findPricingByModel, updatePricingWithAudit } from '../../../../services/admin-ai-pricing'

/**
 * Update AI model pricing, label, and/or active status.
 * Requires `ai.update` permission.
 * Writes activity_logs in the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  // Decoded: the admin page sends `encodeURIComponent(model)`, and h3 leaves an
  // encoded `/` (`%2F`) for the handler to decode — `org/flash` arrives as `org%2Fflash`.
  const modelParam = getRouterParam(event, 'model', { decode: true })
  if (!modelParam || typeof modelParam !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Model không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const patch: Partial<typeof aiModelPricing.$inferInsert> = {}

  if (typeof body.label === 'string') {
    patch.label = body.label.trim().slice(0, 128) || null
  } else if (body.label === null) {
    // The edit form sends `null` for an emptied label box.
    patch.label = null
  }
  if (typeof body.isActive === 'boolean') {
    patch.isActive = body.isActive
  }
  for (const field of ['promptCostPerMillion', 'completionCostPerMillion'] as const) {
    const value: unknown = body[field]
    // Not a number, or negative: ignored, never coerced. A price the column cannot
    // hold is refused here rather than by MySQL (a 500).
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
    if (!isStorableCostPerMillion(value)) {
      throw createError({ statusCode: 400, statusMessage: COST_OUT_OF_RANGE_MESSAGE })
    }
    patch[field] = String(value)
  }

  const existing = await findPricingByModel(modelParam)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Model không tồn tại.' })
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, message: 'Không có thay đổi.' }
  }

  // The update and its audit row in one transaction (in the service).
  await updatePricingWithAudit(adminUser, modelParam, patch)

  return { ok: true }
})
