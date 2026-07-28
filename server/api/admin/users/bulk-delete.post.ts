import { deleteUserById } from '../../../services/users'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

/**
 * Delete several accounts in one request.
 *
 * The two guards that keep a deployment from locking itself out — no deleting
 * your own account, no deleting the system SuperAdmin — live in the service and
 * therefore apply to every row, not just the first.
 */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))
  return runBulk(ids, id => deleteUserById(actor, id), 'Không thể xóa người dùng này.')
})
