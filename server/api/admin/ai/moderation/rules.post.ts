import { createError } from 'h3'
import { getDb } from '../../../../utils/db'
import { aiModerationRules, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { invalidateModerationRulesCache } from '../../../../services/moderation-worker'

const VALID_CATEGORIES = new Set(['hostile_forces', 'anti_state', 'defamation', 'spam_fraud', 'profanity', 'custom'])
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low'])
const VALID_ACTIONS = new Set(['auto_hide', 'flag_only', 'block'])
const VALID_RULE_TYPES = new Set(['keyword', 'pattern'])

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const category = String(body.category || 'custom').trim().toLowerCase()
  const pattern = String(body.pattern || '').trim()
  const severity = String(body.severity || 'high').trim().toLowerCase()
  const action = String(body.action || 'auto_hide').trim().toLowerCase()
  const ruleType = String(body.ruleType || 'keyword').trim().toLowerCase()

  if (!pattern || pattern.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Từ khóa hoặc mẫu nhận diện phải từ 2 ký tự trở lên.' })
  }
  if (!VALID_CATEGORIES.has(category)) {
    throw createError({ statusCode: 400, statusMessage: 'Nhóm quy tắc không hợp lệ.' })
  }
  if (!VALID_SEVERITIES.has(severity)) {
    throw createError({ statusCode: 400, statusMessage: 'Mức độ nghiêm trọng không hợp lệ.' })
  }
  if (!VALID_ACTIONS.has(action)) {
    throw createError({ statusCode: 400, statusMessage: 'Hành động không hợp lệ.' })
  }
  if (!VALID_RULE_TYPES.has(ruleType)) {
    throw createError({ statusCode: 400, statusMessage: 'Loại quy tắc không hợp lệ.' })
  }

  const db = getDb()

  const newId = await db.transaction(async (tx) => {
    const [insertRes] = await tx.insert(aiModerationRules).values({
      category,
      pattern,
      severity,
      action,
      ruleType,
      isEnabled: body.isEnabled !== false,
      createdBy: adminUser.id ?? null,
    })

    const id = Number(insertRes?.insertId ?? 0)

    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'create',
      resource: 'ai',
      resourceId: id,
      meta: JSON.stringify({ type: 'create_moderation_rule', category, pattern, action }),
    })

    return id
  })

  invalidateModerationRulesCache()
  return { ok: true, id: newId }
})
