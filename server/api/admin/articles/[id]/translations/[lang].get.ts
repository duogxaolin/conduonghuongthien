import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { requireReadableArticle } from '../../../../../services/articles'
import { findArticleTranslation } from '../../../../../services/admin-articles-queries'

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

  // `news:read` above only opens the route; the article's own type decides.
  await requireReadableArticle(adminUser, id)

  const translation = await findArticleTranslation(id, lang)

  if (!translation) {
    throw createError({ statusCode: 404, statusMessage: 'Bản dịch không tồn tại.' })
  }

  return { ok: true, translation }
})
