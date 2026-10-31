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
import { fetchDelifyUsage } from './ai/delify-usage'
import { logWarn } from './logger'
import { vietnamMonthStart } from './vn-day-range'

/** Services blocked at 100% budget. Chatbot falls back to knowledge-only in its
 *  own call path (it's never blocked — it just doesn't call the AI provider).
 *  Static record — no runtime insertion needed.
 *
 *  NOT read by `checkBudget`, which refuses EVERY service at 100% ("áp dụng cho toàn
 *  bộ service", see the comment there); the chatbot then falls back because
 *  `chat-policy.ts` treats `budget_exceeded` as "no provider". Kept as documentation
 *  because tests/ai-budget.test.ts pins its contents — those tests read this source
 *  text, so they prove the record exists, not how budgets are enforced. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- documentation table, see above
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

/** 00:00 on the 1st of the current Vietnam calendar month, whatever the process TZ (`vietnamMonthStart`). */
function monthStart(): Date {
  return vietnamMonthStart(new Date())
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
/**
 * How long ANY outcome of a lookup is kept — a quota, and equally a failure (refused
 * base URL, no key, timeout, error answer). `checkBudget` runs before every AI call,
 * public chatbot turns included; caching only successes made an outage cost every
 * call the 2.5 s deadline and a log line. 60 s: the same freshness as a good answer,
 * and how long a configured quota or a recovered API takes to be seen. During a
 * failure the last known quota (or none) stands, as before.
 */
const DELIFY_QUOTA_CACHE_TTL_MS = 60_000
let lastQuotaLookupAt: number | null = null
/** The lookup in flight: concurrent budget checks share it instead of each asking. */
let quotaLookup: Promise<CachedDelifyQuota | null> | null = null

export async function loadDelifyQuota(db: Database): Promise<CachedDelifyQuota | null> {
  const now = Date.now()
  // A clock that went backwards counts as expired.
  if (lastQuotaLookupAt !== null && now >= lastQuotaLookupAt && now - lastQuotaLookupAt < DELIFY_QUOTA_CACHE_TTL_MS) {
    return cachedDelifyQuota
  }
  quotaLookup ??= lookupDelifyQuota(db).finally(() => {
    lastQuotaLookupAt = Date.now()
    quotaLookup = null
  })
  return quotaLookup
}

async function lookupDelifyQuota(db: Database): Promise<CachedDelifyQuota | null> {
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

    // Through outbound.ts, to the delify row's own host (a refused base URL is never
    // resolved); a short deadline — this check runs before every AI call.
    const resp = await fetchDelifyUsage({ baseUrl: delifyRow.baseUrl, secret, path: '/api/usage/key', timeoutMs: 2500, maxResponseBytes: 64 * 1024 })
    if (resp.data && typeof resp.data === 'object') {
      const data = resp.data as { budgetUsd?: number | null; active?: boolean }
      cachedDelifyQuota = {
        budgetUsd: typeof data.budgetUsd === 'number' ? data.budgetUsd : null,
        active: typeof data.active === 'boolean' ? data.active : true,
        fetchedAt: Date.now(),
      }
      return cachedDelifyQuota
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
export async function checkBudget(db: Database, _serviceKey: string): Promise<BudgetCheckResult> {
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
