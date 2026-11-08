import { requireResourcePermission } from '../../../../utils/permissions'
import { finitePositive, MAX_PAGE } from '../../../../utils/query-number'
import { readQueueAiVerdict } from '../../../../../shared/moderation-ai-verdict'
import { readModerationQueuePage } from '../../../../services/admin-ai-moderation-queue'

const DEFAULT_PER_PAGE = 20
const MAX_PER_PAGE = 100

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const query = getQuery(event)
  const statusFilter = typeof query.status === 'string' && query.status.trim() ? query.status.trim() : 'pending'
  // Số trong query phải qua finitePositive — `?page=abc` cho ra NaN rồi JSON
  // `page: null` (endpoint trả hàng nhưng khai không ở trang nào), `?page=1e999`
  // lọt. Quy ước data-layer.md.
  const page = finitePositive(query.page, 1, MAX_PAGE)
  const perPage = finitePositive(query.perPage, DEFAULT_PER_PAGE, MAX_PER_PAGE)
  const offset = (page - 1) * perPage

  // The total (counted before LIMIT/OFFSET), the page, then the banned addresses.
  const { totalRow, rows, bans } = await readModerationQueuePage(statusFilter, perPage, offset)
  const total = Number(totalRow?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const bannedSet = new Set(bans.map(b => b.value))

  const items = rows.map(r => ({
    ...r,
    // Read through the one validator: NULL (rows before the column, rows the AI filed itself) and
    // anything malformed are `null` — the page shows nothing; a resolved row keeps what it had.
    aiVerdict: readQueueAiVerdict(r.aiVerdict),
    isIpBanned: Boolean(r.authorIp && bannedSet.has(r.authorIp)),
  }))

  return {
    ok: true,
    count: items.length,
    items,
    page,
    perPage,
    total,
    totalPages,
  }
})
