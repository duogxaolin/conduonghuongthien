import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../../utils/permissions'
import { getTranslationProgress } from '../../../../../../services/article-translations'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  const id = Number(getRouterParam(event, 'id'))
  const lang = getRouterParam(event, 'lang')
  if (!id || !Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'ID bài viết không hợp lệ.' })
  }
  if (!lang) {
    throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })
  }

  const progress = await getTranslationProgress(id, lang)
  if (!progress) {
    throw createError({ statusCode: 404, statusMessage: 'Bản dịch không tồn tại.' })
  }

  return { ok: true, ...progress }
})
