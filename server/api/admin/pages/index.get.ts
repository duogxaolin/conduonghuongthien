import { requireResourcePermission } from '../../../utils/permissions'
import { listPagesWithBlockCounts } from '../../../services/admin-pages-queries'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'read')

  const { all, counts } = await listPagesWithBlockCounts()

  // Block counts per page
  const countMap: Record<number, number> = {}
  for (const c of counts) countMap[c.pageId] = Number(c.count)

  const items = all.map((p) => ({ ...p, blockCount: countMap[p.id] ?? 0 }))
  return { ok: true, items }
})
