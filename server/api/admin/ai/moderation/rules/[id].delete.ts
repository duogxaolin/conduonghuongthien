import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { invalidateModerationRulesCache } from '../../../../../services/moderation-worker'
import { deleteModerationRuleWithAudit, findModerationRuleById } from '../../../../../services/admin-ai-moderation-rules'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'delete')

  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }

  const existing = await findModerationRuleById(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Quy tắc không tồn tại.' })
  }

  // The delete (counted: a rule deleted since the read above is a 404, rolled back) and its audit
  // row in one transaction (in the service).
  await deleteModerationRuleWithAudit(adminUser, id, existing)

  invalidateModerationRulesCache()
  return { ok: true }
})
