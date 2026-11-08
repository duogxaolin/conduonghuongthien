import { createError } from 'h3'
import type { aiModerationRules } from '../../../../../db/schema'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { invalidateModerationRulesCache } from '../../../../../services/moderation-worker'
import { checkModerationPattern } from '../../../../../services/moderation-regex'
import { findModerationRuleById, updateModerationRuleWithAudit } from '../../../../../services/admin-ai-moderation-rules'

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

  const existing = await findModerationRuleById(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Quy tắc không tồn tại.' })
  }

  const patch: Partial<typeof aiModerationRules.$inferInsert> = {}
  if (typeof body.isEnabled === 'boolean') patch.isEnabled = body.isEnabled
  if (typeof body.pattern === 'string' && body.pattern.trim()) patch.pattern = body.pattern.trim()
  if (typeof body.severity === 'string' && body.severity.trim()) patch.severity = body.severity.trim()
  if (typeof body.action === 'string' && body.action.trim()) patch.action = body.action.trim()
  if (typeof body.category === 'string' && body.category.trim()) patch.category = body.category.trim()

  if (patch.pattern !== undefined) {
    // `ruleType` không sửa được qua đây, nên mẫu mới được kiểm theo loại của luật
    // đang lưu — cùng phép kiểm lúc tạo (độ dài, regex hợp lệ, hình dạng lùi vô hạn).
    const patternCheck = checkModerationPattern(patch.pattern, existing.ruleType)
    if (!patternCheck.ok) {
      throw createError({ statusCode: 400, statusMessage: patternCheck.reason })
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, message: 'Không có thay đổi.' }
  }

  // The update and its audit row in one transaction (in the service).
  await updateModerationRuleWithAudit(adminUser, id, patch)

  invalidateModerationRulesCache()
  return { ok: true }
})
