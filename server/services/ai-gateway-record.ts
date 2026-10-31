/**
 * The epilogue of `callAi` — part of the `ai-gateway.ts` family (the split of `callAi`,
 * wave3 follow-up to 4.3): the ONE usage row of a call that went past the refusals, and
 * the result. Every path ends here, answered (`recordAiCall`) or failed (`recordAiFailure`);
 * a refusal before the path (config, budget, key, stored URL policy) never gets here and
 * writes no row.
 *
 * Order (pinned by `tests/ai-gateway-callai-behavior.test.ts`): pricing read → (no price:
 * a warning) → cost → usage row (awaited; `logAiUsage` catches its own errors) → success
 * line. A model with no pricing row costs 0 and the call still succeeds (spec R8.5) — never
 * an estimate from another model's price. Recorded as is, not endorsed: the pricing read
 * comes after the provider was paid, so a database error there rejects `callAi` and the
 * call is never logged (FINDING-G2 — an answered call, not a failed one).
 */
import type { Database } from '../utils/db'
import { calculateAiCost, type AiModelPricingEntry } from '../utils/ai-cost'
import { logAiUsage } from '../utils/ai-usage'
import { logInfo, logWarn } from '../utils/logger'
import { loadPricing } from './ai-gateway-config'
import type { AiCallResult, AiPathAnswer, AiPathFailure, PreparedAiCall } from './ai-gateway-types'

/**
 * A call whose path failed (`provider_error` / `parse_error`: an error status, nothing
 * readable, a dropped connection, a host refused at send time): ONE row, however many
 * requests the path made (a tool loop's failed step 2 is still one call) — `success: false`,
 * the classified code as `error_message` (never the provider's text, which may echo the
 * key), 0 tokens and 0 cost (decided 2026-10-31). Sums of tokens and cost are unchanged by
 * it; request counts and the success rate count it as the failed request it is. KNOWN: a
 * tool loop whose step 1 was answered (and billed) and whose step 2 failed records 0 — the
 * step-1 tokens are not kept. A caller that tries again (`article-translation-worker.ts`:
 * three attempts per title and per chunk) makes new calls: one row each.
 */
export async function recordAiFailure(db: Database, serviceKey: string, call: PreparedAiCall, failure: AiPathFailure,
  executionMs: number, userId: number | null): Promise<AiCallResult> {
  await logAiUsage(db, {
    serviceKey,
    provider: call.provider,
    model: call.model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    costVnd: 0,
    executionMs,
    userId,
    success: false,
    errorMessage: failure.error,
  })
  return { ok: false, error: failure.error }
}

export async function recordAiCall(db: Database, serviceKey: string, call: PreparedAiCall, answer: AiPathAnswer,
  executionMs: number, userId: number | null): Promise<AiCallResult> {
  const { provider, model } = call
  const { answerText, promptTokens, completionTokens, totalTokens } = answer

  // 8. Calculate cost (spec R10.1 step 9).
  const pricingRow = await loadPricing(db, model)
  if (!pricingRow) {
    logWarn({
      event: 'ai_usage.no_pricing',
      model,
      serviceKey,
    })
  }

  const pricingEntry: AiModelPricingEntry | null = pricingRow
    ? {
        model: pricingRow.model,
        promptCostPerMillion: pricingRow.promptCostPerMillion,
        completionCostPerMillion: pricingRow.completionCostPerMillion,
      }
    : null

  const { costUsd, costVnd } = calculateAiCost(model, promptTokens, completionTokens, pricingEntry)

  // 9. Log usage (awaited, errors caught — spec R10.5). Only answers get here, so the row
  // always says success.
  await logAiUsage(db, {
    serviceKey,
    provider,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    costVnd,
    executionMs,
    userId,
    success: true,
    errorMessage: null,
  })

  logInfo({
    event: 'ai_gateway.call_succeeded',
    serviceKey,
    provider,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costVnd,
    executionMs,
  })

  const executed = answer.toolCallsExecuted ?? []
  return {
    ok: true,
    text: answerText,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    costVnd,
    toolCallsExecuted: executed.length > 0 ? executed : undefined,
  }
}
