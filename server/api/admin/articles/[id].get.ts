import { requireResourcePermission } from '../../../utils/permissions'
import { articleActionScope, articleResource } from '../../../services/articles'
import { findAdminArticle } from '../../../services/admin-articles-queries'
import { withPlainTextFields } from '../../../utils/decode-html-entities'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid article ID' })

  // Scoped to readable types: an id of another type is the same 404 as a
  // missing id, not a 403 that confirms it exists.
  const article = await findAdminArticle(id, articleActionScope(adminUser, 'read'))

  if (!article) {
    throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })
  }

  requireResourcePermission(adminUser, articleResource(article.type), 'read')

  // The editor shows (and saves back) readable text, not the old CMS's `Ng&agrave;y`.
  return { ok: true, article: withPlainTextFields(article) }
})
