import { requireResourcePermission } from '../../../../utils/permissions'
import { deletePricingWithAudit, findPricingByModel } from '../../../../services/admin-ai-pricing'

/**
 * Delete an AI model pricing row by model name (PK).
 * Writes activity_logs within the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  // Decoded: `org/flash` arrives as `org%2Fflash` (see `[model].put.ts`).
  const modelParam = getRouterParam(event, 'model', { decode: true })
  if (!modelParam || typeof modelParam !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Model không hợp lệ.' })
  }

  const existing = await findPricingByModel(modelParam)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Model pricing không tồn tại.' })
  }

  // The delete and its audit row in one transaction (in the service).
  await deletePricingWithAudit(adminUser, modelParam, existing)

  return { ok: true }
})
