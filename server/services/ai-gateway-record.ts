/**
 * The epilogue of `callAi` — part of the `ai-gateway.ts` family (the split of `callAi`,
 * wave3 follow-up to 4.3): price the answer, write ONE usage row, log the success line,
 * and build the result. Runs only after a path produced an answer.
 *
 * Order (pinned by `tests/ai-gateway-callai-behavior.test.ts`): pricing read → (no price:
 * a warning) → cost → usage row (awaited; `logAiUsage` catches its own errors) → success
 * line. A model with no pricing row costs 0 and the call still succeeds (spec R8.5) — never
 * an estimate from another model's price. Recorded as is, not endorsed: the pricing read
 * comes after the provider was paid, so a database error there rejects `callAi` and the
 * call is never logged; and a failed call never reaches this file at all.
 */
import type { Database } from '../utils/db'
import { calculateAiCost, type AiModelPricingEntry } from '../utils/ai-cost'
import { logAiUsage } from '../utils/ai-usage'
import { logInfo, logWarn } from '../utils/logger'
import { loadPricing } from './ai-gateway-config'
import type { AiCallResult, AiPathAnswer, PreparedAiCall } from './ai-gateway-types'

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
