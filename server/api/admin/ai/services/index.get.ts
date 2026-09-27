import { getDb } from '../../../../utils/db'
import { aiServiceConfigs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { AI_SERVICE_DEFAULT_PROMPTS } from '../../../../utils/ai/prompt-defaults'

/**
 * List all AI service configs (spec R5.3).
 * Returns provider, model, system_prompt, temperature, max_tokens, is_active
 * for each of the 5 services, plus `defaultSystemPrompt` so the admin form can
 * offer a "restore default" affordance per service.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const db = getDb()
  const rows = await db.select().from(aiServiceConfigs)

  const services = rows.map((row) => ({
    ...row,
    defaultSystemPrompt: AI_SERVICE_DEFAULT_PROMPTS[row.serviceKey] ?? '',
  }))

  return { ok: true, services }
})
