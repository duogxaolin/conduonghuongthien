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

  await deleteAllRecoveryCodes(admin.id)

  const usable = await usableFactorTypes(admin.id)
  const emailUsable = usable.includes('email_otp')

  const ip = getClientIp(event)
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'update',
    resource: 'profile_recovery_codes',
    resourceId: admin.id,
    meta: { generated: 0, cleared: true, ip },
  })
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
