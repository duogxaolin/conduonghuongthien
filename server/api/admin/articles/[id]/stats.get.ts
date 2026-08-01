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
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { articles, articleViewBoost } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { articleResource } from '../../../../services/articles'
import { getArticleViewStats } from '../../../../services/article-views'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Mã bài viết không hợp lệ.' })
  }

  const db = getDb()
  const [article] = await db
    .select({ id: articles.id, type: articles.type, title: articles.title })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1)
  if (!article) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  requireResourcePermission(event.context.adminUser, articleResource(article.type), 'read')

  const stats = await getArticleViewStats(article.id, { days: Number(getQuery(event).days) })

  // Only `running`. A completed or cancelled job is already reflected in the
  // fabricated total; surfacing it again would read as a second, pending one.
  const [boost] = await db
    .select({
      id:              articleViewBoost.id,
      totalAmount:     articleViewBoost.totalAmount,
      appliedAmount:   articleViewBoost.appliedAmount,
      durationMinutes: articleViewBoost.durationMinutes,
      startedAt:       articleViewBoost.startedAt,
      endsAt:          articleViewBoost.endsAt,
    })
    .from(articleViewBoost)
    .where(and(eq(articleViewBoost.articleId, article.id), eq(articleViewBoost.status, 'running')))
    .orderBy(desc(articleViewBoost.id))
    .limit(1)

  return { ok: true, article: { id: article.id, title: article.title }, stats, boost: boost ?? null }
})
