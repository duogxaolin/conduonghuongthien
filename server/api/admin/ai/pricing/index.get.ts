import { requireResourcePermission } from '../../../../utils/permissions'
import { listModelPricing } from '../../../../services/admin-ai-pricing'

/**
 * List model pricing rows with optional filtering by provider and active status.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const query = getQuery(event)
  const providerFilter = typeof query.provider === 'string' && query.provider.trim() ? query.provider.trim() : null
  const activeOnly = query.activeOnly === 'true' || query.activeOnly === '1'

  const rows = await listModelPricing(providerFilter, activeOnly)

  return {
    ok: true,
    pricing: rows.map(row => ({
      model: row.model,
      provider: row.provider,
      label: row.label,
      isActive: row.isActive,
      promptCostPerMillion: Number(row.promptCostPerMillion),
      completionCostPerMillion: Number(row.completionCostPerMillion),
      updatedAt: row.updatedAt,
    })),
  }
})
