/**
 * Activate a pending factor by proving it works.
 *
 * TOTP and the emailed code require the code; the second-tier password was
 * already proven at enrollment (the caller typed it), so confirming it re-asks
 * for it to catch a typo before it becomes a login requirement.
 */

import { verifyPassword } from '../../../../utils/auth'
import { logInfo, SECURITY_EVENTS } from '../../../../utils/logger'
import { isExpired, verifyOneTimeCode, EMAIL_CODE_MAX_ATTEMPTS } from '../../../../utils/mfa/codes'
import { unsealTotpSecret } from '../../../../utils/mfa/crypto'
import { verifyTotp } from '../../../../utils/mfa/totp'
import { FACTOR_TYPES, FACTOR_LABELS, getFactor, revokeSessions, type FactorType } from '../../../../utils/mfa/factors'
import { isCoveredByMfaPolicy, readMfaPolicy } from '../../../../utils/mfa/policy'
import { prepareRecoveryCodes } from '../../../../utils/mfa/recovery-codes'
import { setSessionCookie } from '../../../../utils/mfa/session'
import { getClientIp } from '../../../../utils/client-ip'
import {
  activatePendingFactor,
  auditMfaFactorEnabled,
  countWrongPendingCode,
  discardPendingFactor,
} from '../../../../services/admin-mfa-confirm'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event).catch(() => ({}))
  const factorType = String(body?.factorType || '') as FactorType
  const code = String(body?.code || '').trim()
  if (!FACTOR_TYPES.includes(factorType)) {
    throw createError({ statusCode: 400, statusMessage: 'Phương thức xác thực không hợp lệ.' })
  }

  const row = await getFactor(admin.id, factorType)
  if (!row || row.state !== 'pending') {
    throw createError({ statusCode: 400, statusMessage: 'Không có yêu cầu bật phương thức này đang chờ xác nhận.' })
  }

  // Every write below is guarded by the pending row exactly as read here (the "pending snapshot",
  // services/admin-mfa-confirm.ts): a concurrent re-enrollment makes it match nothing.
  // The enrollment window has lapsed: drop the pending row rather than letting a
  // stale secret sit in the database indefinitely.
  if (isExpired(row.pendingExpiresAt)) {
    await discardPendingFactor(row)
    throw createError({ statusCode: 400, statusMessage: 'Yêu cầu đã hết hiệu lực. Vui lòng bật lại phương thức này.' })
  }

  if (!code) throw createError({ statusCode: 400, statusMessage: 'Vui lòng nhập mã xác nhận.' })

  let acceptedStep: number | null = null

  if (factorType === 'totp') {
    const opened = unsealTotpSecret({
      ciphertext: row.secretCiphertext ?? undefined,
      nonce: row.secretNonce ?? undefined,
      authTag: row.secretAuthTag ?? undefined,
      version: row.secretVersion ?? undefined,
      keyId: row.secretKeyId ?? undefined,
    })
    if (!opened.ok) {
      await discardPendingFactor(row)
      throw createError({ statusCode: 500, statusMessage: 'Không đọc được secret đã lưu. Vui lòng bật lại phương thức này.' })
    }
    const result = verifyTotp(opened.secret, code)
    // A wrong code leaves the factor pending and inactive — never active.
    if (!result.ok) throw createError({ statusCode: 400, statusMessage: 'Mã xác thực không đúng. Vui lòng thử lại.' })
    acceptedStep = result.step
  } else if (factorType === 'email_otp') {
    if (!row.pendingCodeHash || isExpired(row.pendingCodeExpiresAt)) {
      throw createError({ statusCode: 400, statusMessage: 'Mã đã hết hiệu lực. Vui lòng bật lại phương thức này để nhận mã mới.' })
    }
    if ((row.pendingCodeAttempts ?? 0) >= EMAIL_CODE_MAX_ATTEMPTS) {
      await discardPendingFactor(row)
      throw createError({ statusCode: 400, statusMessage: 'Nhập sai quá nhiều lần. Vui lòng bật lại phương thức này.' })
    }
    if (!(await verifyOneTimeCode(code, row.pendingCodeHash))) {
      await countWrongPendingCode(row)
      throw createError({ statusCode: 400, statusMessage: 'Mã xác thực không đúng. Vui lòng thử lại.' })
    }
  } else {
    if (!row.passwordHash || !(await verifyPassword(code, row.passwordHash))) {
      throw createError({ statusCode: 400, statusMessage: 'Mật khẩu cấp 2 nhập lại không khớp.' })
    }
  }

  // Chính sách MFA khác `off` bao tài khoản này (spec admin-mfa-policy, D1): mã dự
  // phòng là bắt buộc — phát ngay trong lượt này, hiện một lần. Băm TRƯỚC khi mở
  // transaction (bcrypt chậm, không giữ khoá trong lúc đó).
  const mfaPolicy = await readMfaPolicy()
  const prepared = isCoveredByMfaPolicy(mfaPolicy.policy, admin) ? await prepareRecoveryCodes(admin.id) : null

  /**
   * Bật yếu tố và chèn lô mã là MỘT đơn vị, dưới khoá hàng `users` của tài khoản
   * (`activatePendingFactor`, services/admin-mfa-confirm.ts — 409 khi ảnh chụp pending
   * đã đổi). Thu hồi phiên + cookie + audit đi SAU (ngoại lệ có tên ở
   * reader-audit-atomicity: cookie nằm giữa hai lượt ghi).
   */
  const recoveryCodes = await activatePendingFactor({ admin, row, factorType, acceptedStep, prepared })

  // Enabling a factor revokes other live sessions, then re-issues this one.
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
  // Factor type only — no secret, no code, no hash. Recovery codes: the count only.
  await auditMfaFactorEnabled(admin.id, { factorType, enabled: true, ip, ...(recoveryCodes ? { recoveryCodesGenerated: recoveryCodes.length } : {}) })
  logInfo({ event: SECURITY_EVENTS.mfaFactorEnabled, userId: admin.id, username: admin.username, factorType, ip })

  return {
    ok: true,
    factorType,
    message: `Đã bật ${FACTOR_LABELS[factorType]}. Các phiên đăng nhập khác đã bị thu hồi.`,
    // Hiện đúng một lần; chỉ lưu dạng bcrypt.
    ...(recoveryCodes ? { recoveryCodes } : {}),
  }
})
