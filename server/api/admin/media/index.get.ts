import { finitePositive, MAX_PAGE } from '../../../utils/query-number'
import { requireResourcePermission } from '../../../utils/permissions'
import { listAdminMediaPage } from '../../../services/admin-media-library'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'read')

  const query = getQuery(event)
  const page = finitePositive(query.page, 1, MAX_PAGE)
  // finitePositive before the floor of 10 (FINDING-R7-8: `abc` was NaN — no LIMIT, every row; `12.5` a 500).
  const perPage = Math.max(10, finitePositive(query.perPage || 30, 30, 100))
  const offset = (page - 1) * perPage
  const search = String(query.search || '').trim()
  const mimeFilter = String(query.type || '').trim() // image | video

  // The file-name search as typed (FINDING-R7-7) and the newest-first order with its id
  // tie-break (FINDING-R7-9) are in the service query.
  const { items, total } = await listAdminMediaPage({ search, mimeFilter, perPage, offset })

  return {
    ok: true,
    items,
    pagination: {
      page,
      perPage,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / perPage)
    }
  }
})
