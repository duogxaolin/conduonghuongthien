import { createError } from 'h3'
import type { aiServiceConfigs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { bumpAnswerCacheVersion } from '../../../../services/chatbot-answer-cache'
import { updateModerationSettingsWithAudit } from '../../../../services/admin-ai-moderation-settings'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const patch: Partial<typeof aiServiceConfigs.$inferInsert> = {}

  if (typeof body.enabled === 'boolean') {
    patch.isActive = body.enabled
  } else if (body.mode === 'keyword_only') {
    patch.isActive = false
  } else if (body.mode === 'ai') {
    patch.isActive = true
  }

  if (typeof body.provider === 'string' && body.provider.trim()) {
    patch.provider = body.provider.trim().slice(0, 32)
  }

  if (typeof body.model === 'string' && body.model.trim()) {
    patch.model = body.model.trim().slice(0, 64)
  }

  if (typeof body.systemPrompt === 'string') {
    patch.systemPrompt = body.systemPrompt.trim()
  }

  patch.updatedBy = adminUser.id ?? null

  // The configuration row and its audit row in one transaction (in the service).
  await updateModerationSettingsWithAudit(adminUser, patch)

    await bumpAnswerCacheVersion().catch(() => undefined)
  return { ok: true }
})
