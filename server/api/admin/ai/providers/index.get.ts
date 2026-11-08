import { requireResourcePermission } from '../../../../utils/permissions'
import { listProvidersWithModelStats } from '../../../../services/admin-ai-providers'

/**
 * List all AI providers with masked keys.
 * Also returns `totalModels` and `activeModels` count for 9Router-style cards.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  // The providers, then the model stats per provider.
  const { rows, modelStats } = await listProvidersWithModelStats()

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
