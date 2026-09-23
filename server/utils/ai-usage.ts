/**
 * AI usage logger (spec R6, design.md D7, R10.5).
 *
 * Non-blocking: `await logAiUsage(...)` inside try/catch; log failures MUST NOT
 * propagate to break AI responses. If the log insert fails, the AI response to
 * the user is unaffected — the cost record is lost, not the answer.
 *
 * Same pattern as `touchReader` / `session-db.ts` persistence (design.md D7):
 * the logger catches its own errors and logs `ai_usage.log_failed` on failure.
 */
import { aiUsageLogs, type NewAiUsageLog } from '../db/schema'
import type { Database } from './db'
import { logWarn } from './logger'

/** Fields for a usage log entry. All numeric fields are already computed. */
export interface AiUsageLogEntry {
  serviceKey: string
  provider: string
  model: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  costVnd: number
  executionMs: number
  userId: number | null
  success: boolean
  errorMessage?: string | null
}

/**
 * Insert a usage log row. Awaited but catches its own errors — a failed log
 * must never break the AI response that triggered it (spec R6.2, R10.5).
 */
export async function logAiUsage(db: Database, entry: AiUsageLogEntry): Promise<void> {
  try {
    const row: NewAiUsageLog = {
      serviceKey: entry.serviceKey,
      provider: entry.provider,
      model: entry.model,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      totalTokens: entry.totalTokens,
      costUsd: entry.costUsd.toFixed(6),
      costVnd: entry.costVnd.toFixed(2),
      executionMs: entry.executionMs,
      userId: entry.userId,
      success: entry.success,
      errorMessage: entry.errorMessage ?? null,
    }
    await db.insert(aiUsageLogs).values(row)
  } catch (error) {
    // A failed log means a cost record is lost, not that the user's answer fails.
    // The error is logged for observability but NOT re-thrown.
    logWarn({
      event: 'ai_usage.log_failed',
      serviceKey: entry.serviceKey,
      provider: entry.provider,
      success: entry.success,
      error,
    })
  }
}
