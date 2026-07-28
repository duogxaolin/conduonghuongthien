import { deleteCategoryById } from '../../../services/categories'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

/**
 * Delete several categories in one request.
 *
 * Partial success is the norm rather than the exception here: a lot will
 * routinely contain one category that still holds articles, and the useful
 * behaviour is to remove the rest and name the one that was refused.
 */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  return runBulk(ids, id => deleteCategoryById(actor, id), 'Không thể xóa danh mục này.')
})
