import { and, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiModelPricing } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

/**
 * List model pricing rows with optional filtering by provider and active status.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const query = getQuery(event)
  const providerFilter = typeof query.provider === 'string' && query.provider.trim() ? query.provider.trim() : null
  const activeOnly = query.activeOnly === 'true' || query.activeOnly === '1'

  const db = getDb()
  const conditions = []
  if (providerFilter) conditions.push(eq(aiModelPricing.provider, providerFilter))
  if (activeOnly) conditions.push(eq(aiModelPricing.isActive, true))

  const rows = conditions.length > 0
    ? await db.select().from(aiModelPricing).where(and(...conditions))
    : await db.select().from(aiModelPricing)

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
