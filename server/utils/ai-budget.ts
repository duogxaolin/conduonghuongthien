/**
 * AI budget guard (spec R9, design.md D5).
 *
 * Before each AI call, the gateway checks the current month's total spend
 * against the budget cap. At `warning_threshold_pct` of budget, a warning log
 * is emitted (once per day). At 100%, non-critical AI services are blocked;
 * the chatbot always falls back to knowledge-only mode (handled in its own code).
 *
 * Budget 0 = unlimited (spec R9.4). The budget is a monthly cap applied to ALL
 * AI services combined, not per-service.
 */
import { sum, gte, eq } from 'drizzle-orm'
import type { Database } from '../utils/db'
import { aiUsageLogs, aiBudgetSettings, aiProviders, type AiBudgetSettings } from '../db/schema'
import { decryptAiSecret } from './ai/crypto'
import { logWarn } from './logger'

/** Services blocked at 100% budget. Chatbot falls back to knowledge-only in its
 *  own call path (it's never blocked — it just doesn't call the AI provider).
 *  Static record — no runtime insertion needed. */
const BLOCKED_AT_FULL_BUDGET: Record<string, true> = {
  translation_article: true,
  translation_ui: true,
  editorial_assistant: true,
  moderation: true,
}

export interface BudgetCheckResult {
  allowed: boolean
  reason?: string
  errorMessage?: string
  /** Current month spend in VND (for informational purposes). */
  monthlySpendVnd: number
  /** Budget cap in VND (0 = unlimited). */
  budgetVnd: number
  /** Percentage of budget used (0-100, or Infinity if budget is 0/unlimited). */
  usagePercent: number
  /** Remaining budget in VND. */
  remainingVnd?: number
}

/** Start of the current month in the server's timezone (UTC+7). */
function monthStart(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/** Module-level timestamp for the last 80% warning — emitted once per day. */
let lastWarningDate: string | null = null

function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

async function loadBudget(db: Database): Promise<AiBudgetSettings | null> {
  const [row] = await db.select().from(aiBudgetSettings).where(eq(aiBudgetSettings.id, 1)).limit(1)
  return row ?? null
}

interface CachedDelifyQuota {
  budgetUsd: number | null
  active: boolean
  fetchedAt: number
}

let cachedDelifyQuota: CachedDelifyQuota | null = null
const DELIFY_QUOTA_CACHE_TTL_MS = 60_000

export async function loadDelifyQuota(db: Database): Promise<CachedDelifyQuota | null> {
  if (cachedDelifyQuota && Date.now() - cachedDelifyQuota.fetchedAt < DELIFY_QUOTA_CACHE_TTL_MS) {
    return cachedDelifyQuota
  }

  try {
    const [delifyRow] = await db.select().from(aiProviders)
      .where(eq(aiProviders.provider, 'delify'))
      .limit(1)

    if (!delifyRow || !delifyRow.apiKeyCiphertext || !delifyRow.apiKeyNonce || !delifyRow.apiKeyAuthTag || !delifyRow.apiKeyVersion || !delifyRow.apiKeyKeyId) {
      return cachedDelifyQuota
    }

    const secret = decryptAiSecret({
      ciphertext: delifyRow.apiKeyCiphertext,
      nonce: delifyRow.apiKeyNonce,
      authTag: delifyRow.apiKeyAuthTag,
      version: delifyRow.apiKeyVersion,
      keyId: delifyRow.apiKeyKeyId,
      lastFour: delifyRow.apiKeyLastFour ?? '',
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    try {
      const resp = await fetch(`https://router.delify.vn/api/usage/key?key=${encodeURIComponent(secret)}`, {
        signal: controller.signal,
      })
      if (resp.ok) {
        const data = await resp.json() as { budgetUsd?: number | null; active?: boolean }
        cachedDelifyQuota = {
          budgetUsd: typeof data.budgetUsd === 'number' ? data.budgetUsd : null,
          active: typeof data.active === 'boolean' ? data.active : true,
          fetchedAt: Date.now(),
        }
        return cachedDelifyQuota
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Return last known cache on error or timeout
  }

  return cachedDelifyQuota
}

async function loadTotalSpend(db: Database): Promise<number> {
  const [result] = await db
    .select({ total: sum(aiUsageLogs.costVnd) })
    .from(aiUsageLogs)
  const raw = result?.total
  if (raw == null) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}
async function loadMonthlySpend(db: Database): Promise<number> {
  const [result] = await db
    .select({ total: sum(aiUsageLogs.costVnd) })
    .from(aiUsageLogs)
    .where(gte(aiUsageLogs.createdAt, monthStart()))
  const raw = result?.total
  if (raw == null) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Check whether an AI call for `serviceKey` should proceed.
 *
 * Returns `{ allowed: true }` if:
 *   - Budget is 0 (unlimited), OR
 *   - Current spend is below the budget cap, OR
 *   - The service is `chatbot` (never blocked — falls back to knowledge-only).
 *
 * Returns `{ allowed: false, reason: 'budget_exceeded' }` if:
 *   - Spend ≥ 100% of budget AND the service is a non-critical service.
 *
 * The 80% warning is emitted once per day via `logWarn`.
 */
export async function checkBudget(db: Database, serviceKey: string): Promise<BudgetCheckResult> {
  const budget = await loadBudget(db)

  let budgetVnd = Number(budget?.monthlyBudgetVnd) || 0
  let isProviderBudget = false

  // If monthly budget in settings is 0 (unlimited/unset), check allocated quota from active provider (Delify)
  if (budgetVnd <= 0) {
    const providerQuota = await loadDelifyQuota(db)
    if (providerQuota) {
      if (providerQuota.active === false) {
        return {
          allowed: false,
          reason: 'budget_exceeded',
          errorMessage: 'Hệ thống hết ngân sách cho AI. (API key đã bị tạm khóa hoặc hết hạn)',
          monthlySpendVnd: 0,
          budgetVnd: 0,
          usagePercent: 100,
          remainingVnd: 0,
        }
      }
      if (providerQuota.budgetUsd != null && providerQuota.budgetUsd > 0) {
        budgetVnd = providerQuota.budgetUsd * 25500
        isProviderBudget = true
      }
    }
  }

  // Budget 0 = unlimited (spec R9.4).
  if (budgetVnd <= 0) {
    return { allowed: true, monthlySpendVnd: 0, budgetVnd: 0, usagePercent: 0, remainingVnd: Infinity }
  }

  const monthlySpendVnd = await loadMonthlySpend(db)
  const currentSpendVnd = isProviderBudget ? await loadTotalSpend(db) : monthlySpendVnd
  const usagePercent = (currentSpendVnd / budgetVnd) * 100
  const remainingVnd = Math.max(0, budgetVnd - currentSpendVnd)

  // 80% warning — once per day (spec R9.3).
  const warningThreshold = budget?.warningThresholdPct || 80
  if (usagePercent >= warningThreshold) {
    const today = todayKey()
    if (lastWarningDate !== today) {
      lastWarningDate = today
      logWarn({
        event: 'ai_budget.warning',
        monthlySpendVnd: currentSpendVnd,
        budgetVnd,
        usagePercent: Math.round(usagePercent * 100) / 100,
        thresholdPct: warningThreshold,
      })
    }
  }

  // Check if quota is exhausted (>= 100% or remaining <= 0)
  // User requirement: "ai tự check xem quota còn tiền không, nếu k thì báo hệ thống hết ngân sách cho AI. cái này áp dụng cho toàn bộ service nhé, từ đầu đoạn call AI cũng đc"
  if (usagePercent >= 100 || remainingVnd <= 0) {
    return {
      allowed: false,
      reason: 'budget_exceeded',
      errorMessage: 'Hệ thống hết ngân sách cho AI. Vui lòng nạp thêm ngân sách để tiếp tục sử dụng.',
      monthlySpendVnd: currentSpendVnd,
      budgetVnd,
      usagePercent,
      remainingVnd: 0,
    }
  }

  return {
    allowed: true,
    monthlySpendVnd: currentSpendVnd,
    budgetVnd,
    usagePercent,
    remainingVnd,
  }
}
