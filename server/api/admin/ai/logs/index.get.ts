import { and, eq, gte, lt, desc, count } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiUsageLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { finitePositive, MAX_PAGE } from '../../../../utils/query-number'
import { DAY_MS, vietnamDayEndExclusive, vietnamDayStart } from '../../../../utils/vn-day-range'

const NINETY_DAYS_MS = 90 * DAY_MS
const DEFAULT_PER_PAGE = 20
const MAX_PER_PAGE = 50

// startDate/endDate come from AiLogsTab's `<input type="date">`. The old code parsed
// the start as UTC midnight (`new Date('2026-10-14')`) and ended the range with
// `setHours(23, 59, 59, 999)` in the PROCESS time zone, so with TZ=Asia/Ho_Chi_Minh a
// one-day filter covered 07:00→23:59 VN (17 hours). Both bounds now come from the
// shared Vietnam-calendar-day helper (`server/utils/vn-day-range.ts`), independent of TZ.

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
  // Dates are Vietnam calendar days, inclusive: [start 00:00 +07, day after end 00:00 +07).
  // A value that is not a real YYYY-MM-DD is ignored, as an unparsable one always was.
  const start = vietnamDayStart(query.startDate)
  if (start) conditions.push(gte(aiUsageLogs.createdAt, start))
  const end = vietnamDayEndExclusive(query.endDate)
  if (end) conditions.push(lt(aiUsageLogs.createdAt, end))
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
