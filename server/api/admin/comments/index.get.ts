/**
 * Moderation comment list, optionally filtered to one article.
 *
 * `comments.read`, and one audit row per call carrying the filter — these rows
 * carry citizens' names, email addresses and IP addresses (design.md D14).
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { auditCommentRead, listCommentsForAdmin, COMMENT_MAX_PER_PAGE } from '../../../services/comments'

function finitePositive(raw: unknown, fallback: number, max: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(1, Math.floor(value)), max)
}

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'comments', 'read')

  const query = getQuery(event)

  let articleId: number | null = null
  if (query.articleId !== undefined && query.articleId !== '') {
    const value = Number(query.articleId)
    if (!Number.isFinite(value) || value <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Mã bài viết không hợp lệ.' })
    }
    articleId = Math.floor(value)
  }

  const page = finitePositive(query.page, 1, 100_000)
  const perPage = finitePositive(query.perPage, 25, COMMENT_MAX_PER_PAGE)

  const result = await listCommentsForAdmin({ articleId, page, perPage })

  await auditCommentRead({
    actorId: actor.id,
    meta:    { operation: 'list', articleId, page, perPage, returned: result.comments.length },
  })

  return { ok: true, ...result }
})
