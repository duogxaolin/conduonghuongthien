import { requireResourcePermission } from '../../../../utils/permissions'
import { listModerationRules } from '../../../../services/admin-ai-moderation-rules'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const rules = await listModerationRules()

  return {
    ok: true,
    count: rules.length,
    rules,
  }
})
