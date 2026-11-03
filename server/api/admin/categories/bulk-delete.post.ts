import { deleteCategoryById } from '../../../services/categories'
import { parseBulkIds, runBulk } from '../../../utils/bulk'
import { purgeAfterBulk } from '../../../utils/public-page-cache'

/**
 * Delete several categories in one request.
 *
 * Partial success is the norm rather than the exception here: a lot will
 * routinely contain one category that still holds articles, and the useful
 * behaviour is to remove the rest and name the one that was refused.
 *
 * The public page cache is purged once, after every row, and only when a category
 * actually went (server/utils/public-page-cache.ts).
 */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  return runBulk(ids, id => deleteCategoryById(actor, id), 'Không thể xóa danh mục này.')
    .then(outcome => purgeAfterBulk(outcome, 'categories.bulk_delete'))
})
