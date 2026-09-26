import { count, desc, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiModerationQueue, readerIpBans } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { finitePositive, MAX_PAGE } from '../../../../utils/query-number'

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

  const db = getDb()
  const whereClause = statusFilter === 'all' ? undefined : eq(aiModerationQueue.status, statusFilter)

  // Đếm tổng trước khi áp LIMIT/OFFSET — tổng là số trang, không phải số hàng
  // trên trang này. Đếm sau khi slice thì totalPages luôn = 1.
  const [totalRow] = await db
    .select({ total: count() })
    .from(aiModerationQueue)
    .where(whereClause ?? undefined)
  const total = Number(totalRow?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  const rows = await db
    .select()
    .from(aiModerationQueue)
    .where(whereClause ?? undefined)
    .orderBy(desc(aiModerationQueue.createdAt))
    .limit(perPage)
    .offset(offset)
  const bans = await db.select({ value: readerIpBans.value }).from(readerIpBans)
  const bannedSet = new Set(bans.map(b => b.value))

  const items = rows.map(r => ({
    ...r,
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
