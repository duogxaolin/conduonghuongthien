/**
 * The AI service configurations in the admin panel (`GET /api/admin/ai/services`,
 * `PUT /api/admin/ai/services/:id`) — their queries, moved out of the handlers verbatim. The
 * permission checks, the input parsing and clamping, every 400/404 decided before the write, the
 * "no change" answer and `bumpAnswerCacheVersion()` after the commit stay in the handlers.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiServiceConfigs, activityLogs, chatbotSettings } from '../db/schema'

type Actor = { id?: number | null }

/** Every service config row. */
export async function listServiceConfigs() {
  const db = getDb()
  const rows = await db.select().from(aiServiceConfigs)
  return rows
}

/** The service config row with this id; undefined if absent. */
export async function findServiceConfigById(id: number) {
  const db = getDb()
  const [existing] = await db.select().from(aiServiceConfigs).where(eq(aiServiceConfigs.id, id)).limit(1)
  return existing
}

/**
 * Apply `patch` to service config `id` — mirrored into `chatbot_settings` when it is the chatbot's
 * — and write its audit row, all in one transaction.
 */
export async function updateServiceConfigWithAudit(
  adminUser: Actor,
  id: number,
  existing: { serviceKey: string },
  patch: Partial<typeof aiServiceConfigs.$inferInsert>,
) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.update(aiServiceConfigs).set(patch).where(eq(aiServiceConfigs.id, id))

    // 2-way sync: if chatbot service is edited, mirror into chatbot_settings
    if (existing.serviceKey === 'chatbot') {
      const chatbotPatch: Partial<typeof chatbotSettings.$inferInsert> = {}
      if (patch.systemPrompt !== undefined) chatbotPatch.systemPrompt = patch.systemPrompt
      if (patch.model !== undefined) chatbotPatch.model = patch.model
      if (patch.isActive !== undefined) chatbotPatch.mode = patch.isActive ? 'ai' : 'knowledge'
      if (patch.provider !== undefined) {
        chatbotPatch.providerPolicy = patch.provider === 'anthropic' ? 'anthropic' : 'openai-compatible'
      }
      if (Object.keys(chatbotPatch).length > 0) {
        chatbotPatch.updatedBy = adminUser.id ?? null
        await tx.update(chatbotSettings).set(chatbotPatch).where(eq(chatbotSettings.id, 1))
      }
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: id,
      meta: {
        service: existing.serviceKey,
        changedFields: Object.keys(patch),
      },
    })
  })
}
