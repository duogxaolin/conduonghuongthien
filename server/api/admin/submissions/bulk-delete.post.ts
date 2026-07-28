import { deleteSubmissionById } from '../../../services/submissions'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  return runBulk(ids, id => deleteSubmissionById(actor, id), 'Không thể xóa đơn đăng ký này.')
})
