import { deleteContentTypeById } from '../../../services/content-types'
import { parseBulkIds, runBulk } from '../../../utils/bulk'
import { purgeAfterBulk } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  // Purged once after every row, only when a type actually went (public-page-cache.ts).
  return runBulk(ids, id => deleteContentTypeById(actor, id), 'Không thể xóa thể loại này.')
    .then(outcome => purgeAfterBulk(outcome, 'content_types.bulk_delete'))
})
