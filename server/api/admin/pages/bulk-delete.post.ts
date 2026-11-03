import { deletePageById } from '../../../services/pages'
import { parseBulkIds, runBulk } from '../../../utils/bulk'
import { purgeAfterBulk } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  // Purged once after every row, only when a page actually went (public-page-cache.ts).
  return runBulk(ids, id => deletePageById(actor, id), 'Không thể xóa trang này.')
    .then(outcome => purgeAfterBulk(outcome, 'pages.bulk_delete'))
})
