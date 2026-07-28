import { deletePageById } from '../../../services/pages'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  return runBulk(ids, id => deletePageById(actor, id), 'Không thể xóa trang này.')
})
