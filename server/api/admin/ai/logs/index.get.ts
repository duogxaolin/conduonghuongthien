import { requireResourcePermission } from '../../../../utils/permissions'
import { finitePositive, MAX_PAGE } from '../../../../utils/query-number'
import { DAY_MS, vietnamDayEndExclusive, vietnamDayStart } from '../../../../utils/vn-day-range'
import { readAiUsageLogsPage } from '../../../../services/admin-ai-usage'

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

  const serviceKey = typeof query.serviceKey === 'string' && query.serviceKey.trim() ? query.serviceKey.trim() : null
  const provider = typeof query.provider === 'string' && query.provider.trim() ? query.provider.trim() : null
  // Dates are Vietnam calendar days, inclusive: [start 00:00 +07, day after end 00:00 +07).
  // A value that is not a real YYYY-MM-DD is ignored, as an unparsable one always was.
  const start = vietnamDayStart(query.startDate)
  const end = vietnamDayEndExclusive(query.endDate)
  const success = query.success === 'true' ? true : query.success === 'false' ? false : null

  // The page and the count of every matching row, under one WHERE (in the service).
  const { rows, countRow } = await readAiUsageLogsPage(
    { since: ninetyDaysAgo, serviceKey, provider, start, end, success },
    perPage,
    offset,
  )
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
