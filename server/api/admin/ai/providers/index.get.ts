import { getDb } from '../../../../utils/db'
import { aiProviders, aiModelPricing } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { sql } from 'drizzle-orm'

/**
 * List all AI providers with masked keys.
 * Also returns `totalModels` and `activeModels` count for 9Router-style cards.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const db = getDb()
  const rows = await db.select({
    id: aiProviders.id,
    provider: aiProviders.provider,
    label: aiProviders.label,
    baseUrl: aiProviders.baseUrl,
    isActive: aiProviders.isActive,
    apiKeyLastFour: aiProviders.apiKeyLastFour,
    updatedAt: aiProviders.updatedAt,
  }).from(aiProviders)

  // Fetch model stats per provider
  const modelStats = await db.select({
    provider: aiModelPricing.provider,
    total: sql<number>`count(*)`,
    active: sql<number>`sum(case when ${aiModelPricing.isActive} = 1 then 1 else 0 end)`,
  }).from(aiModelPricing).groupBy(aiModelPricing.provider)

  const statsMap = new Map<string, { total: number; active: number }>()
  for (const s of modelStats) {
    statsMap.set(s.provider, { total: Number(s.total) || 0, active: Number(s.active) || 0 })
  }

  const providersWithStats = rows.map(p => ({
    ...p,
    totalModels: statsMap.get(p.provider)?.total ?? 0,
    activeModels: statsMap.get(p.provider)?.active ?? 0,
  }))

  return { ok: true, providers: providersWithStats }
})
