import { deleteMediaById, loadR2Config } from '../../../services/media'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

/**
 * Delete several media files in one request.
 *
 * The R2 credentials are read once and handed to every row: reading the
 * `settings` table per file would turn a lot of fifty into fifty extra queries.
 */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  const r2Config = await loadR2Config()
  return runBulk(ids, id => deleteMediaById(actor, id, r2Config), 'Không thể xóa file này.')
})
