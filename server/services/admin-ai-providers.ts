/**
 * AI providers in the admin panel (`server/api/admin/ai/providers/**`) — their queries, moved out
 * of the handlers verbatim. Everything that decides stays in the handlers and runs before these
 * are called: the permission checks, the base-URL policy (`checkProviderBaseUrl` — the SSRF / key
 * leak surface), the "a new destination needs the key re-entered" rule, the key encryption, every
 * `createError`, the outbound probe (`safeProviderRequest`) and `bumpAnswerCacheVersion()` after
 * the commit. Each write and its audit row commit in one transaction, here.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiProviders, aiServiceConfigs, aiModelPricing, activityLogs } from '../db/schema'

type Actor = { id?: number | null }

/** Every provider (key shown by its last four characters only) and the model counts per provider. */
export async function listProvidersWithModelStats() {
  const db = getDb()
  const rows = await db.select({
    id: aiProviders.id,
    provider: aiProviders.provider,
    label: aiProviders.label,
    baseUrl: aiProviders.baseUrl,
    isActive: aiProviders.isActive,
    apiKeyLastFour: aiProviders.apiKeyLastFour,
    updatedAt: aiProviders.updatedAt,
  }).from(aiProviders)

  // Fetch model stats per provider
  const modelStats = await db.select({
    provider: aiModelPricing.provider,
    total: sql<number>`count(*)`,
    active: sql<number>`sum(case when ${aiModelPricing.isActive} = 1 then 1 else 0 end)`,
  }).from(aiModelPricing).groupBy(aiModelPricing.provider)

  return { rows, modelStats }
}

/** The provider row with this id (key envelope included — never returned to the browser); undefined if absent. */
export async function findProviderById(id: number) {
  const db = getDb()
  const [existing] = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1)
  return existing
}

/** The id of the provider with this name, for the uniqueness check; undefined if none. */
export async function findProviderIdByName(provider: string) {
  const db = getDb()
  const [existing] = await db.select({ id: aiProviders.id })
    .from(aiProviders)
    .where(eq(aiProviders.provider, provider))
    .limit(1)
  return existing
}

/** Insert the provider and its audit row together; the new id. */
export async function createProviderWithAudit(adminUser: Actor, insert: typeof aiProviders.$inferInsert, hasApiKey: boolean) {
  const db = getDb()
  const { provider } = insert
  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(aiProviders).values(insert)
    const newId = created?.insertId
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'create',
      resource: 'ai',
      resourceId: newId ?? null,
      meta: { provider, hasApiKey },
    })
    return newId
  })
  return result
}

/** Apply `patch` to provider `id` and write its audit row together. */
export async function updateProviderWithAudit(
  adminUser: Actor,
  id: number,
  existing: { provider: string },
  patch: Partial<typeof aiProviders.$inferInsert>,
  apiKeyChanged: boolean,
) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.update(aiProviders).set(patch).where(eq(aiProviders.id, id))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: id,
      meta: {
        provider: existing.provider,
        changedFields: Object.keys(patch),
        apiKeyChanged,
      },
    })
  })
}

/** At most one service config that names this provider (a provider in use is not deleted). */
export async function findServicesUsingProvider(provider: string) {
  const db = getDb()
  const linked = await db.select({ serviceKey: aiServiceConfigs.serviceKey })
    .from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.provider, provider))
    .limit(1)
  return linked
}

/** Delete provider `id` and write its audit row together (its price rows are left — pinned as it behaves). */
export async function deleteProviderWithAudit(adminUser: Actor, id: number, existing: { provider: string }) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.delete(aiProviders).where(eq(aiProviders.id, id))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: id,
      meta: { provider: existing.provider },
    })
  })
}

/** The provider rows among `ids` (an id sent twice, or one that does not exist, finds nothing more). */
export async function findProvidersByIds(ids: number[]) {
  const db = getDb()
  const providersToDelete = await db.select().from(aiProviders)
    .where(inArray(aiProviders.id, ids))
  return providersToDelete
}

/** Every service config that names one of these providers. */
export async function findServicesUsingProviders(providerNames: string[]) {
  const db = getDb()
  const linkedServices = await db.select({
    serviceKey: aiServiceConfigs.serviceKey,
    serviceName: aiServiceConfigs.serviceName,
    provider: aiServiceConfigs.provider,
  }).from(aiServiceConfigs)
    .where(inArray(aiServiceConfigs.provider, providerNames))
  return linkedServices
}

/** Delete the providers found, their price rows, and write one audit row — one transaction. */
export async function bulkDeleteProvidersWithAudit(adminUser: Actor, providerIds: number[], providerNames: string[]) {
  const db = getDb()
  await db.transaction(async (tx) => {
    // 1. Delete associated models in ai_model_pricing
    await tx.delete(aiModelPricing).where(inArray(aiModelPricing.provider, providerNames))

    // 2. Delete the providers
    await tx.delete(aiProviders).where(inArray(aiProviders.id, providerIds))

    // 3. Write audit log
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: null,
      meta: {
        type: 'provider_bulk_delete',
        count: providerIds.length,
        providers: providerNames,
      },
    })
  })
}
