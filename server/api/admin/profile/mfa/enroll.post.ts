/**
 * Begin enrolling a factor. The factor is written in `pending` state, which the
 * login challenge ignores, and becomes active only once ./confirm.post.ts proves
 * the caller can actually satisfy it. Enrolling a factor nobody can satisfy is
 * how an administrator locks themselves out.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { userMfaFactors } from '../../../../db/schema'
import { hashPassword, verifyPassword } from '../../../../utils/auth'
import { passwordRejectionMessage } from '../../../../utils/password-policy'
import { isConfigured } from '../../../../utils/mailer'
import { requireCurrentPassword } from '../../../../utils/mfa/reauth'
import { ENROLLMENT_TTL_MS } from '../../../../utils/mfa/codes'
import { issueEmailCode } from '../../../../utils/mfa/email-code'
import { sealTotpSecret } from '../../../../utils/mfa/crypto'
import { generateTotpSecret, otpauthUri } from '../../../../utils/mfa/totp'
import { FACTOR_TYPES, getFactor, type FactorType } from '../../../../utils/mfa/factors'

const ISSUER = 'CDKT Admin'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event).catch(() => ({}))
  const factorType = String(body?.factorType || '') as FactorType
  if (!FACTOR_TYPES.includes(factorType)) {
    throw createError({ statusCode: 400, statusMessage: 'Phương thức xác thực không hợp lệ.' })
  }

  const account = await requireCurrentPassword(event, admin.id, String(body?.currentPassword || ''))

  const existing = await getFactor(admin.id, factorType)
  if (existing?.state === 'active') {
    throw createError({ statusCode: 409, statusMessage: 'Phương thức này đã được bật.' })
  }

  const db = getDb()
  const pendingExpiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS)

  // ── Authenticator app ──────────────────────────────────────────────────────
  if (factorType === 'totp') {
    const secret = generateTotpSecret()
    const sealed = sealTotpSecret(secret)
    const values = {
      userId: admin.id,
      factorType,
      state: 'pending' as const,
      secretCiphertext: sealed.ciphertext,
      secretNonce: sealed.nonce,
      secretAuthTag: sealed.authTag,
      secretVersion: sealed.version,
      secretKeyId: sealed.keyId,
      pendingExpiresAt,
      // A re-enrollment starts a fresh replay window.
      lastAcceptedStep: null,
    }
    if (existing) await db.update(userMfaFactors).set(values).where(eq(userMfaFactors.id, existing.id))
    else await db.insert(userMfaFactors).values(values)

    // The only time the secret is ever returned.
    return {
      ok: true,
      factorType,
      secret,
      otpauthUri: otpauthUri({ secret, account: account.username, issuer: ISSUER }),
      expiresAt: pendingExpiresAt,
    }
  }

  // ── Emailed code ───────────────────────────────────────────────────────────
  if (factorType === 'email_otp') {
    // Checked here, never at login: refusing a login because SMTP broke would
    // lock out an administrator who did everything right.
    if (!(await isConfigured())) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Chưa cấu hình SMTP nên không thể bật phương thức mã gửi về email. Vui lòng cấu hình SMTP tại Cài đặt trước.',
      })
    }
    if (!admin.email) {
      throw createError({ statusCode: 400, statusMessage: 'Tài khoản chưa có email nên không thể nhận mã xác thực.' })
    }

    const values = { userId: admin.id, factorType, state: 'pending' as const, pendingExpiresAt }
    let factorId = existing?.id
    if (existing) await db.update(userMfaFactors).set(values).where(eq(userMfaFactors.id, existing.id))
    else {
      await db.insert(userMfaFactors).values(values)
      factorId = (await getFactor(admin.id, factorType))!.id
    }

    const issued = await issueEmailCode({
      factorId: factorId!,
      // The stored address, never one from the request body.
      email: admin.email,
      username: account.username,
      purpose: 'enroll',
    })
    if (!issued.ok) {
      // Nothing half-enabled is left behind.
      await db.delete(userMfaFactors).where(eq(userMfaFactors.id, factorId!))
      throw createError({ statusCode: 503, statusMessage: 'Không gửi được mã tới email của tài khoản. Vui lòng kiểm tra cấu hình SMTP.' })
    }
    return { ok: true, factorType, sentTo: maskEmail(admin.email), expiresAt: pendingExpiresAt }
  }

  // ── Second-tier password ───────────────────────────────────────────────────
  const secondPassword = String(body?.secondPassword || '')
  const problem = passwordRejectionMessage(secondPassword, { username: account.username })
  if (problem) throw createError({ statusCode: 400, statusMessage: problem })
  // A second factor equal to the first is not a second factor.
  if (await verifyPassword(secondPassword, account.passwordHash)) {
    throw createError({ statusCode: 400, statusMessage: 'Mật khẩu cấp 2 phải khác mật khẩu đăng nhập.' })
  }

  const values = {
    userId: admin.id,
    factorType,
    state: 'pending' as const,
    passwordHash: await hashPassword(secondPassword),
    pendingExpiresAt,
  }
  if (existing) await db.update(userMfaFactors).set(values).where(eq(userMfaFactors.id, existing.id))
  else await db.insert(userMfaFactors).values(values)

  return { ok: true, factorType, expiresAt: pendingExpiresAt }
})

/** a***@domain.vn — enough to confirm the right inbox without printing it. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain || !local) return '***'
  return `${local.slice(0, 1)}***@${domain}`
}
