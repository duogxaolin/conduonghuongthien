/**
 * Break-glass: clear another administrator's second factors.
 *
 * SuperAdmin only — deliberately not `users.update`, because this is the one
 * action that can undo another account's authentication hardening, and an editor
 * who can edit users should not be able to strip a colleague's MFA.
 *
 * It exists because voluntary enrollment plus optional recovery codes makes
 * lockout possible, and an unreachable admin account on a public-facing portal is
 * worse than the residual risk of a loud, logged override.
 */

import { logWarn, SECURITY_EVENTS } from '../../../../utils/logger'
import { getClientIp } from '../../../../utils/client-ip'
import { clearUserMfaFactors, findMfaResetTarget } from '../../../../services/admin-user-mfa-reset'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  if (admin.isSuperAdmin !== true) {
    throw createError({ statusCode: 403, statusMessage: 'Chỉ quản trị viên cấp cao được xoá xác thực hai bước của tài khoản khác.' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })

  const target = await findMfaResetTarget(id)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Người dùng không tồn tại' })

  const ip = getClientIp(event)

  // Four writes, one commit: factors, recovery codes, the target's sessions, and an audit row
  // on each side (one transaction, in the service).
  await clearUserMfaFactors(admin, id, target, ip)

  logWarn({
    event: SECURITY_EVENTS.mfaFactorsCleared,
    userId: admin.id,
    username: admin.username,
    targetUserId: id,
    targetUsername: target.username,
    ip,
  })

  return {
    ok: true,
    message: `Đã xoá toàn bộ xác thực hai bước của tài khoản "${target.username}" và thu hồi các phiên đăng nhập.`,
  }
})
