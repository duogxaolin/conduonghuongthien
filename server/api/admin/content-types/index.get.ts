import { requireResourcePermission } from '../../../utils/permissions'
import { listContentTypesWithUsage } from '../../../services/admin-taxonomy-queries'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'read')

  const { all, catCounts, artCounts } = await listContentTypesWithUsage()

  const catMap: Record<string, number> = {}
  for (const r of catCounts) catMap[r.type] = Number(r.c)
  const artMap: Record<string, number> = {}
  for (const r of artCounts) artMap[r.type] = Number(r.c)

  const items = all.map((ct) => ({
    ...ct,
    categoryCount: catMap[ct.slug] ?? 0,
    articleCount: artMap[ct.slug] ?? 0,
  }))

  return { ok: true, items }
})
