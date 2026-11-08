import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { requireReadableArticle } from '../../../../../services/articles'
import { findArticleTranslation } from '../../../../../services/admin-articles-queries'
import { sanitizeHtml } from '../../../../../utils/sanitize-html'

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

  // "Xem nhanh" (ArticleQuickViewModal) renders `content` with v-html: filter on read as well as on
  // write — a row stored before the write-time filter, or written outside the app, is still there.
  return { ok: true, translation: { ...translation, content: translation.content == null ? null : sanitizeHtml(translation.content) } }
})
