import { createError } from 'h3'
import { requireResourcePermission } from '../../../utils/permissions'
import { bulkTriggerTranslation } from '../../../services/article-translations'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'update')

  const body = await readBody(event).catch(() => ({}))
  const rawIds = Array.isArray(body?.articleIds) ? body.articleIds : Array.isArray(body?.ids) ? body.ids : []
  const langCode = String(body?.langCode || '').trim().toLowerCase()

  if (!rawIds.length || !langCode) {
    throw createError({ statusCode: 400, statusMessage: 'Cần danh sách bài viết (ids) và mã ngôn ngữ (langCode).' })
  }

  const articleIds = rawIds.filter((id: unknown) => typeof id === 'number' && id > 0)
  if (articleIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Chưa chọn bài viết hợp lệ nào.' })
  }

  const targetStatus = body?.targetStatus === 'published' ? 'published' : 'ai_draft'
  const result = await bulkTriggerTranslation(adminUser, articleIds, langCode, targetStatus)
  return { ok: true, count: result.count }
})
