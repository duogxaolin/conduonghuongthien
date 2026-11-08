import { requireResourcePermission } from '../../../utils/permissions'
import { DAY_MS, vietnamDayStartOf, vietnamMonthStart } from '../../../utils/vn-day-range'
import { readAiUsageSummary } from '../../../services/admin-ai-usage'

/**
 * Usage summary — current month cost, total tokens, request count by service,
 * daily breakdown for 30 days (spec R6.3). "Month" and "day" are Vietnam calendar
 * ones, whatever the process TZ (the day of a row: `vietnamDay` in the service).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const now = new Date()
  const monthStart = vietnamMonthStart(now)
  // The 30 Vietnam days ending today, whole days.
  const windowStart = new Date(vietnamDayStartOf(now).getTime() - 29 * DAY_MS)

  // The month's totals, by service, by day, the successful calls and the budget row (in the service).
  const { summary, byService, dailyRows, successRow, budget } = await readAiUsageSummary(monthStart, windowStart)

  const totalRequests = Number(summary?.totalRequests ?? 0)
  const successCount = Number(successRow?.ok ?? 0)

  const monthlyCostVnd = Number(summary?.totalCostVnd ?? 0)
  const budgetVnd = Number(budget?.monthlyBudgetVnd ?? 0)
  const usagePercent = budgetVnd > 0 ? (monthlyCostVnd / budgetVnd) * 100 : 0

  return {
    ok: true,
    usage: {
      monthlyCostVnd,
      totalPromptTokens: Number(summary?.totalPromptTokens ?? 0),
      totalCompletionTokens: Number(summary?.totalCompletionTokens ?? 0),
      totalRequests,
      successRate: totalRequests > 0 ? (successCount / totalRequests) * 100 : 100,
    },
    byService: byService.map(row => ({
      serviceKey: row.serviceKey,
      costVnd: Number(row.costVnd ?? 0),
      promptTokens: Number(row.promptTokens ?? 0),
      completionTokens: Number(row.completionTokens ?? 0),
      requests: Number(row.requests ?? 0),
    })),
    daily: dailyRows.map(row => ({
      day: row.day,
      costVnd: Number(row.costVnd ?? 0),
      requests: Number(row.requests ?? 0),
    })),
    budget: {
      monthlyBudgetVnd: budgetVnd,
      warningThresholdPct: budget?.warningThresholdPct ?? 80,
      usagePercent,
    },
  }
})
