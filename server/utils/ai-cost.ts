/**
 * Pure AI cost calculation function (spec R8, design.md D6).
 *
 * No DB calls, no side effects — takes pricing as a parameter so it's testable
 * in isolation. The gateway service loads pricing from `ai_model_pricing`
 * before calling this function.
 *
 * Formula:
 *   costUsd = (promptTokens * promptCostPerMillion + completionTokens * completionCostPerMillion) / 1_000_000
 *   costVnd = costUsd * USD_TO_VND_RATE
 *
 * If pricing is null or the model is not found, returns zero cost (spec R8.5).
 * The AI call is NOT blocked — a missing pricing entry means we can't calculate
 * cost, not that the service is unavailable.
 */

/** Pricing data for a single model, as loaded from the `ai_model_pricing` table. */
export interface AiModelPricingEntry {
  model: string
  promptCostPerMillion: string | number
  completionCostPerMillion: string | number
}

export interface AiCostResult {
  costUsd: number
  costVnd: number
}

/**
 * USD → VND exchange rate, read from env at call time (not module load) so that
 * a config change takes effect on the next AI call without a restart.
 * Default 25500 is a conservative mid-2024 rate.
 */
function usdToVndRate(): number {
  const raw = process.env.USD_TO_VND_RATE
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25500
}

/**
 * Calculate the USD and VND cost of an AI API call.
 *
 * Pure: no DB, no I/O, no side effects. The caller passes pricing data loaded
 * from the database, so this function is unit-testable without any DB mock.
 */
export function calculateAiCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  pricing: AiModelPricingEntry | null,
): AiCostResult {
  if (!pricing) return { costUsd: 0, costVnd: 0 }

  const promptRate = Number(pricing.promptCostPerMillion)
  const completionRate = Number(pricing.completionCostPerMillion)

  if (!Number.isFinite(promptRate) || !Number.isFinite(completionRate)) {
    return { costUsd: 0, costVnd: 0 }
  }

  // Guard against negative token counts from malformed responses.
  const safePromptTokens = Math.max(0, Math.floor(promptTokens))
  const safeCompletionTokens = Math.max(0, Math.floor(completionTokens))

  const costUsd =
    (safePromptTokens * promptRate + safeCompletionTokens * completionRate) / 1_000_000

  return {
    costUsd,
    costVnd: costUsd * usdToVndRate(),
  }
}
