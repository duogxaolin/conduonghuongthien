import { setUserActive } from '../../../services/users'
import { parseBulkIds, runBulk } from '../../../utils/bulk'

/**
 * Lock or unlock several accounts in one request. Locking is what "hide" means
 * for a user: the admin-auth middleware re-reads `isActive` on every request, so
 * a locked account loses access at once.
 */
export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  const body = await readBody(event).catch(() => ({}))
  const ids = parseBulkIds(body)

  // Required explicitly rather than defaulted: guessing wrong would either lock
  // accounts the operator meant to unlock, or the reverse.
  if (typeof body?.isActive !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu trạng thái cần đặt (isActive).' })
  }
  const isActive = body.isActive as boolean

  return runBulk(
    ids,
    id => setUserActive(actor, id, isActive),
    isActive ? 'Không thể mở khóa tài khoản này.' : 'Không thể khóa tài khoản này.',
  )
})
