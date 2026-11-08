import { requireResourcePermission } from '../../../utils/permissions'
import { listAdminCategories } from '../../../services/admin-taxonomy-queries'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'read')

  const query = getQuery(event)
  const typeFilter = String(query.type || '').trim()

  const all = await listAdminCategories(typeFilter)

  // Build map for parent name lookup
  const idToName: Record<number, string> = {}
  for (const cat of all) {
    idToName[cat.id] = cat.name
  }

  const result = all.map((cat) => ({
    ...cat,
    parentName: cat.parentId ? (idToName[cat.parentId] ?? null) : null,
  }))

  return { ok: true, items: result }
})
