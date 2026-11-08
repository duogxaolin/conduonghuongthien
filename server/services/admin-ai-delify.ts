/**
 * Delify Router in the AI panel (`GET /api/admin/ai/delify/status`, `POST /api/admin/ai/delify/sync`)
 * — their queries, moved out of the handlers verbatim. The permission checks, the key decryption,
 * every call to the router (`fetchDelifyUsage`, outbound.ts — never a bare fetch), every
 * `createError`, the log line and the response shaping stay in the handlers.
 */
import { eq, sum, count } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiProviders, aiModelPricing, aiUsageLogs, activityLogs } from '../db/schema'
import { isStorableCostPerMillion } from '../utils/ai/pricing-cost'

/** The `delify` provider row; undefined when it has not been created. */
export async function findDelifyProvider() {
  const db = getDb()
  const [delifyProvider] = await db.select().from(aiProviders)
    .where(eq(aiProviders.provider, 'delify'))
    .limit(1)
  return delifyProvider
}

/** What this app has spent through the gateway: the sums of `ai_usage_logs` (one row per answered call). */
export async function sumLocalAiUsage() {
  const db = getDb()
  const [localUsage] = await db
    .select({
      totalCostUsd: sum(aiUsageLogs.costUsd),
      totalCostVnd: sum(aiUsageLogs.costVnd),
      totalRequests: count(aiUsageLogs.id),
    })
    .from(aiUsageLogs)
  return localUsage
}

/** `ai_model_pricing.model` is VARCHAR(64). */
const MODEL_NAME_MAX = 64

/**
 * What the router sends is data from outside, checked like an officer's entry before
 * it is written (slice R5): a name longer than the column used to be cut to 64
 * characters — i.e. into ANOTHER model's name, whose price was then overwritten; a
 * price outside DECIMAL(8,4) failed the whole sync on MySQL (strict) and a negative one
 * made negative costs; an item of another shape threw inside the transaction (500,
 * nothing synced).
 */
function storableModel(m: unknown): { name: string, input: number, output: number } | null {
  if (!m || typeof m !== 'object') return null
  const { name, input, output } = m as { name?: unknown, input?: unknown, output?: unknown }
  if (typeof name !== 'string' || !name || name.length > MODEL_NAME_MAX) return null
  if (typeof input !== 'number' || typeof output !== 'number') return null
  if (!isStorableCostPerMillion(input) || !isStorableCostPerMillion(output)) return null
  return { name, input, output }
}

/**
 * Upsert the router's `availableModels` into `ai_model_pricing` and write the audit row, in one
 * transaction. Every item is parsed by `storableModel` before use; `upserted + skipped` is the
 * router's model count.
 */
export async function syncDelifyPricingWithAudit(adminUser: { id?: number | null }, delifyProvider: { id: number }, models: unknown[]) {
  const db = getDb()

  let upserted = 0
  /** Models not written (`upserted + skipped` = the router's model count). */
  let skipped = 0

  await db.transaction(async (tx) => {
    // 3.1. Upsert each model into ai_model_pricing
    for (const candidate of models) {
      const m = storableModel(candidate)
      if (!m) {
        skipped++
        continue
      }
      const modelName = m.name

      const [existing] = await tx.select().from(aiModelPricing)
        .where(eq(aiModelPricing.model, modelName))
        .limit(1)

      if (existing) {
        await tx.update(aiModelPricing).set({
          provider: 'delify',
          label: modelName,
          promptCostPerMillion: String(m.input),
          completionCostPerMillion: String(m.output),
        }).where(eq(aiModelPricing.model, modelName))
      } else {
        await tx.insert(aiModelPricing).values({
          model: modelName,
          provider: 'delify',
          label: modelName,
          isActive: true,
          promptCostPerMillion: String(m.input),
          completionCostPerMillion: String(m.output),
        }).onDuplicateKeyUpdate({ set: { model: modelName } })
      }
      upserted++
    }

    // 3.2. Write audit log inside the same transaction
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: delifyProvider.id,
      meta: {
        action: 'delify-pricing-sync',
        upserted,
        skipped,
        totalFromApi: models.length,
      },
    })
  })

  return { upserted, skipped }
}
