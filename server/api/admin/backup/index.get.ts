import { requireResourcePermission } from '../../../utils/permissions'
import { listBackups } from '../../../services/backup'
import { finitePositive } from '../../../utils/query-number'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const query = getQuery(event)
  const page = finitePositive(query.page, 1, 100_000)
  const pageSize = finitePositive(query.pageSize, 20, 50)
  const type = typeof query.type === 'string' ? query.type : undefined

  const { items, total } = await listBackups(page, pageSize, type)
  return { ok: true, items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
})
