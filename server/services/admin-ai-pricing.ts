/**
 * The AI model price list in the admin panel (`server/api/admin/ai/pricing/**`) — its queries,
 * moved out of the handlers verbatim. The permission checks, the input parsing, the price range
 * check (`isStorableCostPerMillion`), every 400/404/409 decided before a write and the response
 * shaping stay in the handlers. Each write and its audit row commit in one transaction, here.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiModelPricing, activityLogs } from '../db/schema'

type Actor = { id?: number | null }

/** Every price row, or only those of `providerFilter` and/or only the active ones. */
export async function listModelPricing(providerFilter: string | null, activeOnly: boolean) {
  const db = getDb()
  const conditions = []
  if (providerFilter) conditions.push(eq(aiModelPricing.provider, providerFilter))
  if (activeOnly) conditions.push(eq(aiModelPricing.isActive, true))

  const rows = conditions.length > 0
    ? await db.select().from(aiModelPricing).where(and(...conditions))
    : await db.select().from(aiModelPricing)
  return rows
}

/** The price row of `model` (the primary key); undefined if absent. Also the test call's price. */
export async function findPricingByModel(model: string) {
  const db = getDb()
  const [existing] = await db.select().from(aiModelPricing).where(eq(aiModelPricing.model, model)).limit(1)
  return existing
}

/** `{ model }` when a price row of `model` exists, for the uniqueness check; undefined if none. */
export async function findPricingModelName(model: string) {
  const db = getDb()
  const [existing] = await db.select({ model: aiModelPricing.model })
    .from(aiModelPricing)
    .where(eq(aiModelPricing.model, model))
    .limit(1)
  return existing
}

/** Insert the price row and its audit row together (the audit carries the prices as numbers). */
export async function createPricingWithAudit(
  adminUser: Actor,
  insert: typeof aiModelPricing.$inferInsert,
  promptCost: number,
  completionCost: number,
) {
  const db = getDb()
  const { model, provider } = insert
  await db.transaction(async (tx) => {
    await tx.insert(aiModelPricing).values(insert)
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'create',
      resource: 'ai',
      resourceId: null,
      meta: {
        type: 'pricing_create',
        model,
        provider,
        promptCostPerMillion: promptCost,
        completionCostPerMillion: completionCost,
      },
    })
  })
}

/** Apply `patch` to the price row of `model` and write its audit row together. */
export async function updatePricingWithAudit(adminUser: Actor, model: string, patch: Partial<typeof aiModelPricing.$inferInsert>) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.update(aiModelPricing).set(patch).where(eq(aiModelPricing.model, model))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: null,
      meta: {
        type: 'pricing_update',
        model,
        changedFields: Object.keys(patch),
      },
    })
  })
}

/** Delete the price row of `model` and write its audit row together. */
export async function deletePricingWithAudit(adminUser: Actor, model: string, existing: { provider: string }) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.delete(aiModelPricing).where(eq(aiModelPricing.model, model))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: null,
      meta: {
        type: 'pricing_delete',
        model,
        provider: existing.provider,
      },
    })
  })
}

/** Delete the price rows among `requested` and write one audit row — one transaction; the names deleted. */
export async function bulkDeletePricingWithAudit(adminUser: Actor, requested: string[]) {
  const db = getDb()

  // The count and the audit line are what was deleted, not what was asked: the rows
  // found are locked until the delete commits, and a name never in the list (or sent
  // twice) is not reported as deleted.
  const deleted = await db.transaction(async (tx) => {
    const found = await tx.select({ model: aiModelPricing.model }).from(aiModelPricing)
      .where(inArray(aiModelPricing.model, requested))
      .for('update')
    const models = found.map(row => row.model)
    if (models.length === 0) return models
    await tx.delete(aiModelPricing).where(inArray(aiModelPricing.model, models))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: null,
      meta: {
        type: 'pricing_bulk_delete',
        count: models.length,
        models,
      },
    })
    return models
  })
  return deleted
}
