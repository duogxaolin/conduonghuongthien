/**
 * AI usage in the admin panel (`GET /api/admin/ai/usage` — the dashboard, `GET /api/admin/ai/logs`
 * — the call log) — their queries, moved out of the handlers verbatim. The permission checks, the
 * query parsing, the Vietnam month/day bounds (`vn-day-range.ts`, computed in the handlers) and the
 * response shaping stay in the handlers. Read-only.
 */
import { sql, sum, count, gte, lt, and, eq, desc } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiUsageLogs, aiBudgetSettings } from '../db/schema'

/**
 * The Vietnam calendar day of a usage row. `created_at` is a TIMESTAMP, which MySQL
 * renders in the SESSION time zone — UTC on the deployed database (the convention
 * `vn-day-range.ts` documents); a bare `DATE(created_at)` put every call made between
 * 00:00 and 07:00 Vietnam time on the previous day. Both offsets are fixed numbers
 * (no time-zone tables needed); Vietnam has no daylight saving time.
 */
const vietnamDay = sql`DATE(CONVERT_TZ(${aiUsageLogs.createdAt}, '+00:00', '+07:00'))`

/**
 * The dashboard's numbers: the month's totals since `monthStart`, the month by service, the days
 * since `windowStart`, the month's successful calls, and the budget row.
 */
export async function readAiUsageSummary(monthStart: Date, windowStart: Date) {
  const db = getDb()

  // Overall summary for current month
  const [summary] = await db
    .select({
      totalCostVnd: sum(aiUsageLogs.costVnd),
      totalPromptTokens: sum(aiUsageLogs.promptTokens),
      totalCompletionTokens: sum(aiUsageLogs.completionTokens),
      totalRequests: count(aiUsageLogs.id),
    })
    .from(aiUsageLogs)
    .where(gte(aiUsageLogs.createdAt, monthStart))

  // By service breakdown
  const byService = await db
    .select({
      serviceKey: aiUsageLogs.serviceKey,
      costVnd: sum(aiUsageLogs.costVnd),
      promptTokens: sum(aiUsageLogs.promptTokens),
      completionTokens: sum(aiUsageLogs.completionTokens),
      requests: count(aiUsageLogs.id),
    })
    .from(aiUsageLogs)
    .where(gte(aiUsageLogs.createdAt, monthStart))
    .groupBy(aiUsageLogs.serviceKey)

  // Daily breakdown for last 30 days
  const dailyRows = await db
    .select({
      day: sql<string>`${vietnamDay}`.as('day'),
      costVnd: sum(aiUsageLogs.costVnd),
      requests: count(aiUsageLogs.id),
    })
    .from(aiUsageLogs)
    .where(gte(aiUsageLogs.createdAt, windowStart))
    .groupBy(vietnamDay)
    .orderBy(desc(vietnamDay))

  // Success rate
  const [successRow] = await db
    .select({ ok: count(aiUsageLogs.id) })
    .from(aiUsageLogs)
    .where(and(gte(aiUsageLogs.createdAt, monthStart), eq(aiUsageLogs.success, true)))

  // Budget settings
  const [budget] = await db.select().from(aiBudgetSettings).where(eq(aiBudgetSettings.id, 1)).limit(1)

  return { summary, byService, dailyRows, successRow, budget }
}

/** The call-log filters, already parsed: `null` (or absent) is "no filter". */
export interface AiUsageLogFilters {
  /** The floor every page has (spec R13.5: older than 90 days is excluded). */
  since: Date
  serviceKey: string | null
  provider: string | null
  /** Vietnam calendar days, inclusive: [start 00:00 +07, day after end 00:00 +07). */
  start: Date | null
  end: Date | null
  success: boolean | null
}

/** One page of the call log, newest first, and the count of every matching row. */
export async function readAiUsageLogsPage(filters: AiUsageLogFilters, perPage: number, offset: number) {
  const conditions = [gte(aiUsageLogs.createdAt, filters.since)]

  if (filters.serviceKey) conditions.push(eq(aiUsageLogs.serviceKey, filters.serviceKey))
  if (filters.provider) conditions.push(eq(aiUsageLogs.provider, filters.provider))
  if (filters.start) conditions.push(gte(aiUsageLogs.createdAt, filters.start))
  if (filters.end) conditions.push(lt(aiUsageLogs.createdAt, filters.end))
  if (filters.success === true) conditions.push(eq(aiUsageLogs.success, true))
  if (filters.success === false) conditions.push(eq(aiUsageLogs.success, false))

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
  return { rows, countRow }
}
