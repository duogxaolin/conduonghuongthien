import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiServiceConfigs, activityLogs, chatbotSettings } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

/** Maximum allowed values for temperature and max_tokens. */
const MAX_TEMPERATURE = 2
const MAX_TOKENS_LIMIT = 32_768

function clampTemp(raw: unknown): string | null {
  if (typeof raw === 'number') {
    const clamped = Math.max(0, Math.min(raw, MAX_TEMPERATURE))
    return clamped.toFixed(2)
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    const clamped = Math.max(0, Math.min(parsed, MAX_TEMPERATURE))
    return clamped.toFixed(2)
  }
  return null
}

/**
 * Update a service config (spec R5.4).
 * Accepts changes to system_prompt, model, provider, temperature, max_tokens, is_active.
 * Changes to service_key and service_name are REJECTED.
 * Every update writes activity_logs within the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  // Reject service_key / service_name changes (spec R5.4)
  if (body.serviceKey !== undefined || body.serviceName !== undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể thay đổi service_key hoặc service_name.' })
  }

  const db = getDb()
  const [existing] = await db.select().from(aiServiceConfigs).where(eq(aiServiceConfigs.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Service config không tồn tại.' })
  }

  const patch: Partial<typeof aiServiceConfigs.$inferInsert> = {}

  if (typeof body.provider === 'string' && body.provider.trim()) {
    patch.provider = body.provider.trim().slice(0, 32)
  }
  if (typeof body.systemPrompt === 'string') {
    patch.systemPrompt = body.systemPrompt || null
  }
  if (typeof body.model === 'string') {
    patch.model = body.model.trim().slice(0, 64) || null
  }
  const temp = clampTemp(body.temperature)
  if (temp !== null) patch.temperature = temp
  if (typeof body.maxTokens === 'number' && Number.isFinite(body.maxTokens)) {
    patch.maxTokens = Math.max(1, Math.min(Math.floor(body.maxTokens), MAX_TOKENS_LIMIT))
  }
  if (typeof body.isActive === 'boolean') {
    patch.isActive = body.isActive
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, message: 'Không có thay đổi.' }
  }

  patch.updatedBy = adminUser.id ?? null

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
      meta: JSON.stringify({
        service: existing.serviceKey,
        changedFields: Object.keys(patch),
      }),
    })
  })

  return { ok: true }
})
