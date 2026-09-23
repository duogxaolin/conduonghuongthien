import { getDb } from '../../../../utils/db'
import { aiServiceConfigs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

/**
 * List all AI service configs (spec R5.3).
 * Returns provider, model, system_prompt, temperature, max_tokens, is_active
 * for each of the 5 services.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const db = getDb()
  const rows = await db.select().from(aiServiceConfigs)

  return { ok: true, services: rows }
})
