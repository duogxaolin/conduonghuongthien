import { sql, sum, count, gte, and, eq, desc } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { aiUsageLogs, aiBudgetSettings } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'

/**
 * Usage summary — current month cost, total tokens, request count by service,
 * daily breakdown for 30 days (spec R6.3).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const db = getDb()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

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
      day: sql`DATE(${aiUsageLogs.createdAt})`.as('day'),
      costVnd: sum(aiUsageLogs.costVnd),
      requests: count(aiUsageLogs.id),
    })
    .from(aiUsageLogs)
    .where(gte(aiUsageLogs.createdAt, thirtyDaysAgo))
    .groupBy(sql`DATE(${aiUsageLogs.createdAt})`)
    .orderBy(desc(sql`DATE(${aiUsageLogs.createdAt})`))

  // Success rate
  const [successRow] = await db
    .select({ ok: count(aiUsageLogs.id) })
    .from(aiUsageLogs)
    .where(and(gte(aiUsageLogs.createdAt, monthStart), eq(aiUsageLogs.success, true)))

  const totalRequests = Number(summary?.totalRequests ?? 0)
  const successCount = Number(successRow?.ok ?? 0)

  // Budget settings
  const [budget] = await db.select().from(aiBudgetSettings).where(eq(aiBudgetSettings.id, 1)).limit(1)

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
