/**
 * Activate a pending factor by proving it works.
 *
 * TOTP and the emailed code require the code; the second-tier password was
 * already proven at enrollment (the caller typed it), so confirming it re-asks
 * for it to catch a typo before it becomes a login requirement.
 */
import { getRequestIP } from 'h3'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { userMfaFactors, users, activityLogs } from '../../../../db/schema'
import { verifyPassword } from '../../../../utils/auth'
import { logInfo, SECURITY_EVENTS } from '../../../../utils/logger'
import { isExpired, verifyOneTimeCode, EMAIL_CODE_MAX_ATTEMPTS } from '../../../../utils/mfa/codes'
import { unsealTotpSecret } from '../../../../utils/mfa/crypto'
import { verifyTotp } from '../../../../utils/mfa/totp'
import { FACTOR_TYPES, FACTOR_LABELS, getFactor, revokeSessions, type FactorType } from '../../../../utils/mfa/factors'
import { setSessionCookie } from '../../../../utils/mfa/session'

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

  const db = getDb()
  // The enrollment window has lapsed: drop the pending row rather than letting a
  // stale secret sit in the database indefinitely.
  if (isExpired(row.pendingExpiresAt)) {
    await db.delete(userMfaFactors).where(eq(userMfaFactors.id, row.id))
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
      await db.delete(userMfaFactors).where(eq(userMfaFactors.id, row.id))
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
      await db.delete(userMfaFactors).where(eq(userMfaFactors.id, row.id))
      throw createError({ statusCode: 400, statusMessage: 'Nhập sai quá nhiều lần. Vui lòng bật lại phương thức này.' })
    }
    if (!(await verifyOneTimeCode(code, row.pendingCodeHash))) {
      await db
        .update(userMfaFactors)
        .set({ pendingCodeAttempts: sql`${userMfaFactors.pendingCodeAttempts} + 1` })
        .where(eq(userMfaFactors.id, row.id))
      throw createError({ statusCode: 400, statusMessage: 'Mã xác thực không đúng. Vui lòng thử lại.' })
    }
  } else {
    if (!row.passwordHash || !(await verifyPassword(code, row.passwordHash))) {
      throw createError({ statusCode: 400, statusMessage: 'Mật khẩu cấp 2 nhập lại không khớp.' })
    }
  }

  await db
    .update(userMfaFactors)
    .set({
      state: 'active',
      pendingExpiresAt: null,
      pendingCodeHash: null,
      pendingCodeExpiresAt: null,
      pendingCodeAttempts: 0,
      lastAcceptedStep: acceptedStep,
      lastUsedAt: new Date(),
    })
    .where(eq(userMfaFactors.id, row.id))

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

  const ip = getRequestIP(event, { xForwardedFor: false }) || 'unknown'
  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'update',
    resource: 'profile_mfa',
    resourceId: admin.id,
    // Factor type only — no secret, no code, no hash.
    meta: { factorType, enabled: true, ip },
  })
  logInfo({ event: SECURITY_EVENTS.mfaFactorEnabled, userId: admin.id, username: admin.username, factorType, ip })

  return {
    ok: true,
    factorType,
    message: `Đã bật ${FACTOR_LABELS[factorType]}. Các phiên đăng nhập khác đã bị thu hồi.`,
  }
})
