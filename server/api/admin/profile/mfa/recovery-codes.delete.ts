/**
 * Turn recovery codes off. Deletes every stored code for the account; the
 * emailed code becomes the remaining recovery path, and the response says so.
 */

import { getDb } from '../../../../utils/db'
import { activityLogs } from '../../../../db/schema'
import { logInfo } from '../../../../utils/logger'
import { requireCurrentPassword } from '../../../../utils/mfa/reauth'
import { deleteAllRecoveryCodes, usableFactorTypes } from '../../../../utils/mfa/factors'
import { getClientIp } from '../../../../utils/client-ip'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event).catch(() => ({}))
  await requireCurrentPassword(event, admin.id, String(body?.currentPassword || ''))

  const ip = getClientIp(event)
  const db = getDb()

  // The deletion and its audit row commit together. Unlike the sibling
  // enable/confirm endpoints, nothing here writes an HTTP cookie between the two
  // — so there is no side effect a rollback could fail to retract, and no reason
  // to leave the pair split. Recovery codes are the last way back into a locked
  // account: if the audit insert failed after an unwrapped delete, every code
  // would be gone with nothing recording who removed them.
  await db.transaction(async (tx) => {
    await deleteAllRecoveryCodes(admin.id, tx)
    await tx.insert(activityLogs).values({
      userId: admin.id,
      action: 'update',
      resource: 'profile_recovery_codes',
      resourceId: admin.id,
      meta: { generated: 0, cleared: true, ip },
    })
  })

  // Outside the transaction because it reads `user_mfa_factors`, which this
  // transaction never touches — the codes live in `user_recovery_codes`. Pulling
  // it inside would widen the transaction around a read that cannot be affected
  // by it.
  const usable = await usableFactorTypes(admin.id)
  const emailUsable = usable.includes('email_otp')

  logInfo({ event: 'auth.mfa_recovery_codes_cleared', userId: admin.id, username: admin.username, ip })

  return {
    ok: true,
    // Named plainly: turning these off with no email factor is the lockout case.
    lockoutRisk: usable.length > 0 && !emailUsable,
    message: emailUsable
      ? 'Đã xoá toàn bộ mã hồi phục. Mã gửi về email là đường dự phòng còn lại.'
      : 'Đã xoá toàn bộ mã hồi phục. Tài khoản hiện KHÔNG còn đường dự phòng nào — hãy bật mã gửi về email.',
  }
})
