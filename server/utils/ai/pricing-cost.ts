/**
 * The largest price `ai_model_pricing.prompt_cost_per_million` /
 * `completion_cost_per_million` can hold: both are DECIMAL(8,4), USD per million
 * tokens. Under MySQL's strict sql_mode a larger value is refused by the database
 * (ERROR 1264, "Out of range value") — a 500 for the officer instead of a message —
 * so the admin handlers check it first.
 */
export const MAX_COST_PER_MILLION = 9999.9999

/** A finite, non-negative price within {@link MAX_COST_PER_MILLION}. */
export function isStorableCostPerMillion(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_COST_PER_MILLION
}

export const COST_OUT_OF_RANGE_MESSAGE = `Giá mỗi triệu token phải từ 0 đến ${MAX_COST_PER_MILLION} USD.`
