import { deleteArticleById } from '../../../services/articles'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

/**
 * Delete several articles in one request.
 *
 * No permission check here on purpose: an article's delete grant depends on its
 * type, so the only correct place to check is per row, inside
 * deleteArticleById. A check here would either be redundant or — if it named a
 * single resource — wrong for the other four types.
 */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  return runBulk(ids, id => deleteArticleById(actor, id), 'Không thể xóa bài viết này.')
})
