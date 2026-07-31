/**
 * Turn a factor off. The row and its stored material are deleted rather than
 * flagged, so "disabled" cannot drift from "secret still in the database".
 */

import { getDb } from '../../../../utils/db'
import { activityLogs } from '../../../../db/schema'
import { logInfo, SECURITY_EVENTS } from '../../../../utils/logger'
import { requireCurrentPassword } from '../../../../utils/mfa/reauth'
import {
  FACTOR_TYPES,
  FACTOR_LABELS,
  deleteFactor,
  getFactor,
  hasAnyActiveFactor,
  pruneRecoveryCodesIfNoFactors,
  revokeSessions,
  type FactorType,
} from '../../../../utils/mfa/factors'
import { setSessionCookie } from '../../../../utils/mfa/session'
import { getClientIp } from '../../../../utils/client-ip'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event).catch(() => ({}))
  const factorType = String(body?.factorType || '') as FactorType
  if (!FACTOR_TYPES.includes(factorType)) {
    throw createError({ statusCode: 400, statusMessage: 'Phương thức xác thực không hợp lệ.' })
  }

  // Re-proving the password matters most here: a borrowed session must not be
  // able to strip the factor protecting the account.
  await requireCurrentPassword(event, admin.id, String(body?.currentPassword || ''))

  const row = await getFactor(admin.id, factorType)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Phương thức này chưa được bật.' })

  await deleteFactor(admin.id, factorType)
  // Recovery codes exist to get past a factor; with no factor left they are
  // material with no purpose.
  await pruneRecoveryCodesIfNoFactors(admin.id)
  const stillProtected = await hasAnyActiveFactor(admin.id)

  const tokenVersion = await revokeSessions(admin.id)
  setSessionCookie(event, {
    id: admin.id,
    username: admin.username,
    email: admin.email ?? null,
    roleId: admin.roleId ?? null,
    roleName: admin.roleName ?? null,
    isSystem: admin.isSystem ?? null,
    tokenVersion,
  })

  const ip = getClientIp(event)
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'update',
    resource: 'profile_mfa',
    resourceId: admin.id,
    meta: { factorType, enabled: false, ip },
  })
  logInfo({ event: SECURITY_EVENTS.mfaFactorDisabled, userId: admin.id, username: admin.username, factorType, ip })

  return {
    ok: true,
    factorType,
    message: stillProtected
      ? `Đã tắt ${FACTOR_LABELS[factorType]}. Tài khoản vẫn còn yếu tố xác thực khác.`
      : `Đã tắt ${FACTOR_LABELS[factorType]}. Tài khoản trở lại đăng nhập chỉ bằng mật khẩu.`,
  }
})
