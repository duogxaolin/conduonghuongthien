import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { triggerTranslateAllLanguages } from '../../../../../services/article-translations'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id || !Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'ID bài viết không hợp lệ.' })
  }
  const body = await readBody(event).catch(() => ({}))
  const targetStatus = body?.targetStatus === 'published' ? 'published' : 'ai_draft'
  const result = await triggerTranslateAllLanguages(adminUser, id, targetStatus)
  return {
    ok: true,
    queued: result.queued,
    languages: result.languages,
    message: result.queued > 0
      ? `Đã xếp lịch dịch ${result.queued} ngôn ngữ còn thiếu trong nền.`
      : 'Tất cả các ngôn ngữ đã có bản dịch!',
  }
})
