import { deleteContentTypeById } from '../../../services/content-types'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  return runBulk(ids, id => deleteContentTypeById(actor, id), 'Không thể xóa thể loại này.')
})
