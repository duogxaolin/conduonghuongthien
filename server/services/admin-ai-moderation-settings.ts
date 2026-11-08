/**
 * The moderation configuration in the admin panel (`GET`/`PUT /api/admin/ai/moderation/settings`,
 * `GET /api/admin/ai/moderation/worker-status`) — their queries, moved out of the handlers
 * verbatim. The permission checks, the patch built from the body, the response shaping (the
 * effective prompt, the defaults when there is no row), the worker's in-memory counters and
 * `bumpAnswerCacheVersion()` after the commit stay in the handlers.
 */
import { eq, count } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiServiceConfigs, aiProviders, aiModelPricing, aiModerationQueue, activityLogs } from '../db/schema'

/** The `moderation` configuration row (undefined if none), the active providers (no key material) and the active models. */
export async function readModerationSettingsSources() {
  const db = getDb()

  const [config] = await db
    .select()
    .from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.serviceKey, 'moderation'))
    .limit(1)

  const activeProviders = await db
    .select({
      id: aiProviders.id,
      provider: aiProviders.provider,
      label: aiProviders.label,
      isActive: aiProviders.isActive,
    })
    .from(aiProviders)
    .where(eq(aiProviders.isActive, true))

  const activePricing = await db
    .select()
    .from(aiModelPricing)
    .where(eq(aiModelPricing.isActive, true))

  return { config, activeProviders, activePricing }
}

/**
 * Apply `patch` to the `moderation` configuration row and write the audit row, in one transaction.
 * With no configuration row nothing is updated, and the audit row is still written (resource id 1)
 * — as it behaved in the handler.
 */
export async function updateModerationSettingsWithAudit(adminUser: { id?: number | null }, patch: Partial<typeof aiServiceConfigs.$inferInsert>) {
  const db = getDb()

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: aiServiceConfigs.id })
      .from(aiServiceConfigs)
      .where(eq(aiServiceConfigs.serviceKey, 'moderation'))
      .limit(1)

    if (existing) {
      await tx
        .update(aiServiceConfigs)
        .set(patch)
        .where(eq(aiServiceConfigs.id, existing.id))
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: existing?.id ?? 1,
      meta: {
        type: 'update_moderation_settings',
        changedFields: Object.keys(patch),
      },
    })
  })
}

/** For the worker status card: the number of pending queue rows, and the `moderation` configuration row. */
export async function readModerationWorkerCounts() {
  const db = getDb()

  // Get pending queue count
  const [queueCount] = await db
    .select({ total: count() })
    .from(aiModerationQueue)
    .where(eq(aiModerationQueue.status, 'pending'))

  // Get AI config status
  const [config] = await db
    .select()
    .from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.serviceKey, 'moderation'))
    .limit(1)

  return { queueCount, config }
}
