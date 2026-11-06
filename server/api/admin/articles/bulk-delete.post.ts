import { deleteArticleById } from '../../../services/articles'
import { parseBulkIds, runBulk } from '../../../utils/bulk'
import { purgeAfterBulk } from '../../../utils/public-page-cache'
import { bumpAnswerCacheVersion } from '../../../services/chatbot-answer-cache'

/**
 * Delete several articles in one request.
 *
 * No permission check here on purpose: an article's delete grant depends on its
 * type, so the only correct place to check is per row, inside
 * deleteArticleById. A check here would either be redundant or — if it named a
 * single resource — wrong for the other four types.
 *
 * The public page cache is purged once, after every row has been written, and only
 * when at least one row actually went (server/utils/public-page-cache.ts).
 */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  return runBulk(ids, id => deleteArticleById(actor, id), 'Không thể xóa bài viết này.')
    .then(outcome => purgeAfterBulk(outcome, 'articles.bulk_delete'))
    .then(async (outcome) => {
      // Câu trả lời chatbot đã cache có thể dẫn link bài vừa xoá: tăng phiên bản để nó không được phát lại.
      if (outcome.succeeded > 0) await bumpAnswerCacheVersion().catch(() => undefined)
      return outcome
    })
})
