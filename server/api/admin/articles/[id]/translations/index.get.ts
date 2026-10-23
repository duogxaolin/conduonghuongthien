import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { listTranslationsForArticle } from '../../../../../services/article-translations'
import { requireReadableArticle } from '../../../../../services/articles'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  const id = Number(getRouterParam(event, 'id'))
  if (!id || !Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'ID bài viết không hợp lệ.' })
  }

  // `news:read` above only opens the route; the article's own type decides.
  await requireReadableArticle(adminUser, id)
  const translations = await listTranslationsForArticle(id)
  return { ok: true, items: translations }
})
