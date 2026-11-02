import { deleteArticleById } from '../../../services/articles'
import { parseBulkIds, runBulk } from '../../../utils/bulk'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

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
  const outcome = await runBulk(ids, id => deleteArticleById(actor, id), 'Không thể xóa bài viết này.')
  if (outcome.succeeded > 0) await purgePublicPageCacheAfterWrite('articles.bulk_delete')
  return outcome
})
