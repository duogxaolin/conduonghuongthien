import { createError } from 'h3'
import { setArticleCommentsEnabled } from '../../../services/articles'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

/**
 * Open or close comments on several articles at once.
 *
 * This exists because `comments_enabled` ships off for every existing article
 * (design.md D9) — the alternative default would have opened the whole archive
 * the moment the feature deployed, a moderation load nobody chose. Without a
 * bulk action, "open the ones we want" is a hundred individual clicks, and that
 * kind of permanent friction is what ends with someone changing the column
 * default instead.
 *
 * As with bulk-status and bulk-delete, the permission check lives per row inside
 * the service because the grant depends on the article's type. An officer with
 * `news.update` but not `documents.update` gets a partial result naming the
 * refused rows, never a silent success.
 */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const body = await readBody(event).catch(() => ({}))

  const enabled = (body as { enabled?: unknown } | null)?.enabled
  if (typeof enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Giá trị bật/tắt bình luận không hợp lệ.' })
  }

  const ids = parseBulkIds(body)
  return runBulk(
    ids,
    id => setArticleCommentsEnabled(actor, id, enabled),
    'Không thể đổi trạng thái bình luận của bài viết này.',
  )
})
