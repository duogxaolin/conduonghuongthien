import { desc, asc } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiModerationRules } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const db = getDb()
  const rules = await db
    .select()
    .from(aiModerationRules)
    .orderBy(asc(aiModerationRules.category), desc(aiModerationRules.id))

  return {
    ok: true,
    count: rules.length,
    rules,
  }
})
