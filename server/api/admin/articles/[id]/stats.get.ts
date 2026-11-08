/**
 * View statistics for one article, plus any inflation job still running against
 * it.
 *
 * Permission comes from the article's own `type` (D11): an editor who may read
 * `news` but not `documents` sees news figures and nothing else, which falls out
 * of `articleResource()` for free. Using the `analytics` resource instead would
 * hand a documents-only editor sight of every article in the portal.
 */
import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { requireResourcePermission } from '../../../../utils/permissions'
import { articleActionScope, articleResource } from '../../../../services/articles'
import { getArticleViewStats } from '../../../../services/article-views'
import { findArticleForStats, findRunningBoostForStats } from '../../../../services/admin-article-boost'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Mã bài viết không hợp lệ.' })
  }

  const actor = event.context.adminUser
  // Scoped lookup: an id of a type the caller may not read is the same 404 as a
  // missing one (no existence oracle via 403-vs-404).
  const article = await findArticleForStats(id, articleActionScope(actor, 'read'))
  if (!article) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  requireResourcePermission(actor, articleResource(article.type), 'read')

  const stats = await getArticleViewStats(article.id, { days: Number(getQuery(event).days) })

  // Only `running` — a completed or cancelled job is already in the fabricated total.
  const boost = await findRunningBoostForStats(article.id)

  return { ok: true, article: { id: article.id, title: article.title }, stats, boost: boost ?? null }
})
