import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { listTranslationsForArticle } from '../../../../../services/article-translations'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  const id = Number(getRouterParam(event, 'id'))
  if (!id || !Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'ID bài viết không hợp lệ.' })
  }

  const translations = await listTranslationsForArticle(id)
  return { ok: true, items: translations }
})
