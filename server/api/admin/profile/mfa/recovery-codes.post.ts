/**
 * Turn recovery codes on (or regenerate them). Returned exactly once, in this
 * response, and stored only as bcrypt hashes.
 *
 * A regeneration deletes the previous batch outright rather than relying on the
 * batch id alone, so a leaked older sheet cannot be redeemed.
 */
import { getRequestIP } from 'h3'
import { getDb } from '../../../../utils/db'
import { userRecoveryCodes, activityLogs } from '../../../../db/schema'
import { logInfo } from '../../../../utils/logger'
import { requireCurrentPassword } from '../../../../utils/mfa/reauth'
import {
  RECOVERY_CODE_COUNT,
  generateBatchId,
  generateRecoveryCodes,
  hashOneTimeCode,
  normalizeRecoveryCode,
} from '../../../../utils/mfa/codes'
import {
  deleteAllRecoveryCodes,
  hasAnyActiveFactor,
  revokeSessions,
} from '../../../../utils/mfa/factors'
import { setSessionCookie } from '../../../../utils/mfa/session'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event).catch(() => ({}))
  await requireCurrentPassword(event, admin.id, String(body?.currentPassword || ''))

  // Codes exist to get past a second factor. Issuing them to an account with no
  // factor would create a second way in without adding any protection.
  if (!(await hasAnyActiveFactor(admin.id))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Hãy bật ít nhất một phương thức xác thực hai bước trước khi tạo mã hồi phục.',
    })
  }

  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT)
  const batchId = generateBatchId()

  const db = getDb()
  await deleteAllRecoveryCodes(admin.id)
  await db.insert(userRecoveryCodes).values(
    await Promise.all(codes.map(async code => ({
      userId: admin.id,
      // Hashed over the normalized form so the separator is irrelevant at redemption.
      codeHash: await hashOneTimeCode(normalizeRecoveryCode(code)),
      batchId,
    }))),
  )

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

  const ip = getRequestIP(event, { xForwardedFor: false }) || 'unknown'
  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'update',
    resource: 'profile_recovery_codes',
    resourceId: admin.id,
    // Count only — the codes themselves never touch the log.
    meta: { generated: codes.length, ip },
  })
  logInfo({ event: 'auth.mfa_recovery_codes_generated', userId: admin.id, username: admin.username, count: codes.length, ip })

  return {
    ok: true,
    // The only time these are readable. The client shows them once.
    codes,
    message: 'Hãy lưu các mã này ở nơi an toàn. Mỗi mã dùng được một lần và sẽ không hiển thị lại.',
  }
})
