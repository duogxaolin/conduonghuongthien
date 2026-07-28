import { createError } from 'h3'
import { ARTICLE_STATUSES, setArticleStatus, type ArticleStatus } from '../../../services/articles'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

/**
 * Move several articles to one status. `archived` is what "hide" means for an
 * article — the public read path already filters on status, so nothing else has
 * to change for the row to disappear from the site.
 *
 * As with bulk-delete, the permission check lives per row in setArticleStatus
 * because the grant depends on the article's type.
 */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const body = await readBody(event).catch(() => ({}))

  const status = String(body?.status || '')
  if (!(ARTICLE_STATUSES as readonly string[]).includes(status)) {
    throw createError({ statusCode: 400, statusMessage: 'Trạng thái không hợp lệ.' })
  }

  const ids = parseBulkIds(body)
  return runBulk(
    ids,
    id => setArticleStatus(actor, id, status as ArticleStatus),
    'Không thể đổi trạng thái bài viết này.',
  )
})
