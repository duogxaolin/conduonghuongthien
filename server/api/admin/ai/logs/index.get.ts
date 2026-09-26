import { and, eq, gte, lte, desc, count } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiUsageLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { finitePositive, MAX_PAGE } from '../../../../utils/query-number'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const DEFAULT_PER_PAGE = 20
const MAX_PER_PAGE = 50

/**
 * Paginated detailed AI usage logs (spec R6.4, R13).
 * Filters: service_key, provider, date range, success status.
 * Ordered by created_at DESC. Logs older than 90 days excluded (spec R13.5).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const query = getQuery(event)
  const page = finitePositive(query.page, 1, MAX_PAGE)
  const perPage = finitePositive(query.perPage, DEFAULT_PER_PAGE, MAX_PER_PAGE)
  const offset = (page - 1) * perPage

  // Excluded older than 90 days by default (spec R13.5)
  const ninetyDaysAgo = new Date(Date.now() - NINETY_DAYS_MS)

  const conditions = [gte(aiUsageLogs.createdAt, ninetyDaysAgo)]

  if (typeof query.serviceKey === 'string' && query.serviceKey.trim()) {
    conditions.push(eq(aiUsageLogs.serviceKey, query.serviceKey.trim()))
  }
  if (typeof query.provider === 'string' && query.provider.trim()) {
    conditions.push(eq(aiUsageLogs.provider, query.provider.trim()))
  }
  if (typeof query.startDate === 'string') {
    const start = new Date(query.startDate)
    if (!isNaN(start.getTime())) conditions.push(gte(aiUsageLogs.createdAt, start))
  }
  if (typeof query.endDate === 'string') {
    const end = new Date(query.endDate)
    if (!isNaN(end.getTime())) {
      // Include the entire end day
      end.setHours(23, 59, 59, 999)
      conditions.push(lte(aiUsageLogs.createdAt, end))
    }
  }
  if (query.success === 'true') conditions.push(eq(aiUsageLogs.success, true))
  if (query.success === 'false') conditions.push(eq(aiUsageLogs.success, false))

  const where = conditions.length > 1 ? and(...conditions) : conditions[0]!

  const db = getDb()

  const rows = await db
    .select()
    .from(aiUsageLogs)
    .where(where)
    .orderBy(desc(aiUsageLogs.createdAt))
    .limit(perPage)
    .offset(offset)
  // Count total matching rows for pagination
  const [countRow] = await db
    .select({ total: count(aiUsageLogs.id) })
    .from(aiUsageLogs)
    .where(where)
  const total = countRow?.total ?? 0
  return {
    ok: true,
    logs: rows.map(row => ({
      ...row,
      costUsd: Number(row.costUsd),
      costVnd: Number(row.costVnd),
      createdAt: row.createdAt,
    })),
    pagination: {
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage),
    },
  }
})
