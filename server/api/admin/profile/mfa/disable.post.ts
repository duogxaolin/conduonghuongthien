/**
 * Turn a factor off. The row and its stored material are deleted rather than
 * flagged, so "disabled" cannot drift from "secret still in the database".
 *
 * The factor, the recovery codes it leaves without purpose, the session generation
 * and the audit row commit in ONE transaction; the cookie and the security log
 * follow the commit. They used to be four pool writes with the cookie set before
 * the audit row: a failed audit (`activity_logs` has a FK and a JSON column) left
 * the factor gone with no row saying who removed it, and the `mfa.factor_disabled`
 * log line — written after the audit — was lost with it. No HTTP side effect sits
 * between the writes any more, so nothing a rollback cannot retract.
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
import { lockAccountForMfaChange } from '../../../../utils/mfa/recovery-codes'
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

  const ip = getClientIp(event)
  const db = getDb()
  // Every read and write on `tx`: a `getDb()` read here runs on another pool
  // connection and, on MySQL, would not see the uncommitted delete.
  const { stillProtected, tokenVersion } = await db.transaction(async (tx) => {
    // Serialises with enabling a factor / regenerating codes (`confirm.post.ts`) and
    // with a second disable, so "is any factor left" is decided on settled rows.
    await lockAccountForMfaChange(tx, admin.id)
    if ((await deleteFactor(admin.id, factorType, tx)) === 0) {
      throw createError({ statusCode: 404, statusMessage: 'Phương thức này chưa được bật.' })
    }
    // Recovery codes exist to get past a factor; with no factor left they are
    // material with no purpose.
    await pruneRecoveryCodesIfNoFactors(admin.id, tx)
    const remaining = await hasAnyActiveFactor(admin.id, tx)
    const version = await revokeSessions(admin.id, tx)
    await tx.insert(activityLogs).values({
      userId: admin.id,
      action: 'update',
      resource: 'profile_mfa',
      resourceId: admin.id,
      meta: { factorType, enabled: false, ip },
    })
    return { stillProtected: remaining, tokenVersion: version }
  })
  logInfo({ event: SECURITY_EVENTS.mfaFactorDisabled, userId: admin.id, username: admin.username, factorType, ip })

  // Every other session ended with the bump above; this one carries on.
  setSessionCookie(event, {
    id: admin.id,
    username: admin.username,
    email: admin.email ?? null,
    roleId: admin.roleId ?? null,
    roleName: admin.roleName ?? null,
    isSystem: admin.isSystem ?? null,
    tokenVersion,
  })

  return {
    ok: true,
    factorType,
    message: stillProtected
      ? `Đã tắt ${FACTOR_LABELS[factorType]}. Tài khoản vẫn còn yếu tố xác thực khác.`
      : `Đã tắt ${FACTOR_LABELS[factorType]}. Tài khoản trở lại đăng nhập chỉ bằng mật khẩu.`,
  }
})
