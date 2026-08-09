/**
 * The one place that knows how a factor is stored, enabled, and verified.
 *
 * Both the profile endpoints and the login challenge go through here, so
 * "enabled" means the same thing on both sides: an `active` row exists. Nothing
 * in this module returns secret material to a caller.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { userMfaFactors, userRecoveryCodes, users } from '../../db/schema'
import { verifyPassword } from '../auth'
import { logError } from '../logger'
import { unsealTotpSecret } from './crypto'
import { verifyTotp } from './totp'
import {
  EMAIL_CODE_MAX_ATTEMPTS,
  isExpired,
  normalizeRecoveryCode,
  verifyOneTimeCode,
} from './codes'

export type FactorType = 'totp' | 'email_otp' | 'second_password'
export const FACTOR_TYPES: FactorType[] = ['totp', 'email_otp', 'second_password']

export const FACTOR_LABELS: Record<FactorType, string> = {
  totp: 'Ứng dụng xác thực (Google Authenticator)',
  email_otp: 'Mã gửi về email',
  second_password: 'Mật khẩu cấp 2',
}

export type FactorRow = typeof userMfaFactors.$inferSelect

export async function listFactors(userId: number): Promise<FactorRow[]> {
  const db = getDb()
  return db.select().from(userMfaFactors).where(eq(userMfaFactors.userId, userId))
}

export async function getFactor(userId: number, factorType: FactorType): Promise<FactorRow | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, userId), eq(userMfaFactors.factorType, factorType)))
    .limit(1)
  return row ?? null
}

/**
 * Which factors can actually be used to satisfy a challenge right now.
 *
 * A TOTP row whose secret will not decrypt is excluded here rather than at
 * verification time: after a JWT_SECRET rotation the account must fall back to
 * its other factors instead of being offered one that cannot possibly work.
 */
export async function usableFactorTypes(userId: number): Promise<FactorType[]> {
  const rows = await listFactors(userId)
  const usable: FactorType[] = []
  for (const row of rows) {
    if (row.state !== 'active') continue
    if (row.factorType === 'totp') {
      const opened = unsealTotpSecret({
        ciphertext: row.secretCiphertext ?? undefined,
        nonce: row.secretNonce ?? undefined,
        authTag: row.secretAuthTag ?? undefined,
        version: row.secretVersion ?? undefined,
        keyId: row.secretKeyId ?? undefined,
      })
      if (!opened.ok) {
        logError({
          event: 'mfa.totp_secret_unreadable',
          userId,
          reason: opened.reason,
          hint: opened.reason === 'key-mismatch'
            ? 'JWT_SECRET đã thay đổi — người dùng cần đăng ký lại ứng dụng xác thực.'
            : 'Bản ghi secret TOTP không giải mã được.',
        })
        continue
      }
    }
    usable.push(row.factorType as FactorType)
  }
  return usable
}

export async function hasAnyActiveFactor(userId: number): Promise<boolean> {
  const rows = await listFactors(userId)
  return rows.some(row => row.state === 'active')
}

export async function countUnusedRecoveryCodes(userId: number): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)))
  return Number(row?.total ?? 0)
}

/**
 * Every action that changes an account's authentication material bumps the
 * session generation. Callers that must keep the acting session alive re-issue
 * its cookie afterwards.
 */
export async function revokeSessions(userId: number): Promise<number> {
  const db = getDb()
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId))
  const [row] = await db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, userId)).limit(1)
  return row?.tokenVersion ?? 0
}

export async function deleteFactor(userId: number, factorType: FactorType): Promise<void> {
  const db = getDb()
  await db
    .delete(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, userId), eq(userMfaFactors.factorType, factorType)))
}

/**
 * `executor` lets a caller run this inside a transaction it already opened, so
 * the deletion and the audit row describing it commit together. Defaults to the
 * pool for callers that own no transaction. Typed structurally rather than
 * importing Drizzle's transaction type, which is not exported in a usable shape
 * here — same approach as `deleteReaderComments` in services/comments.ts.
 */
type RecoveryCodeDeleteExecutor = Pick<ReturnType<typeof getDb>, 'delete'>

export async function deleteAllRecoveryCodes(
  userId: number,
  executor?: RecoveryCodeDeleteExecutor,
): Promise<void> {
  await (executor ?? getDb()).delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId))
}

/** Disabling the last factor must not leave recovery codes behind. */
export async function pruneRecoveryCodesIfNoFactors(userId: number): Promise<void> {
  if (await hasAnyActiveFactor(userId)) return
  await deleteAllRecoveryCodes(userId)
}

export type FactorAttempt =
  | { ok: true; method: FactorType | 'recovery_code' }
  | { ok: false; reason: 'no-factor' | 'unusable' | 'mismatch' | 'expired' | 'attempts' | 'format' }

/** TOTP: verifies and records the accepted step so the code cannot be replayed. */
export async function attemptTotp(userId: number, submitted: string): Promise<FactorAttempt> {
  const row = await getFactor(userId, 'totp')
  if (!row || row.state !== 'active') return { ok: false, reason: 'no-factor' }

  const opened = unsealTotpSecret({
    ciphertext: row.secretCiphertext ?? undefined,
    nonce: row.secretNonce ?? undefined,
    authTag: row.secretAuthTag ?? undefined,
    version: row.secretVersion ?? undefined,
    keyId: row.secretKeyId ?? undefined,
  })
  if (!opened.ok) return { ok: false, reason: 'unusable' }

  const result = verifyTotp(opened.secret, submitted, { lastAcceptedStep: row.lastAcceptedStep })
  if (!result.ok) {
    return { ok: false, reason: result.reason === 'format' ? 'format' : 'mismatch' }
  }

  const db = getDb()
  await db
    .update(userMfaFactors)
    .set({ lastAcceptedStep: result.step, lastUsedAt: new Date() })
    .where(eq(userMfaFactors.id, row.id))
  return { ok: true, method: 'totp' }
}

/**
 * Email OTP: expiry first, then the attempt ceiling, then the hash. Every
 * outcome that ends the code's life clears it, so a burned code cannot be
 * ground down by further guesses.
 */
export async function attemptEmailCode(userId: number, submitted: string): Promise<FactorAttempt> {
  const row = await getFactor(userId, 'email_otp')
  if (!row || row.state !== 'active') return { ok: false, reason: 'no-factor' }
  if (!row.pendingCodeHash) return { ok: false, reason: 'expired' }

  const db = getDb()
  const clearCode = () => db
    .update(userMfaFactors)
    .set({ pendingCodeHash: null, pendingCodeExpiresAt: null, pendingCodeAttempts: 0 })
    .where(eq(userMfaFactors.id, row.id))

  if (isExpired(row.pendingCodeExpiresAt)) {
    await clearCode()
    return { ok: false, reason: 'expired' }
  }
  if ((row.pendingCodeAttempts ?? 0) >= EMAIL_CODE_MAX_ATTEMPTS) {
    await clearCode()
    return { ok: false, reason: 'attempts' }
  }

  const matched = await verifyOneTimeCode(submitted.trim(), row.pendingCodeHash)
  if (!matched) {
    await db
      .update(userMfaFactors)
      .set({ pendingCodeAttempts: sql`${userMfaFactors.pendingCodeAttempts} + 1` })
      .where(eq(userMfaFactors.id, row.id))
    return { ok: false, reason: 'mismatch' }
  }

  await db
    .update(userMfaFactors)
    .set({ pendingCodeHash: null, pendingCodeExpiresAt: null, pendingCodeAttempts: 0, lastUsedAt: new Date() })
    .where(eq(userMfaFactors.id, row.id))
  return { ok: true, method: 'email_otp' }
}

export async function attemptSecondPassword(userId: number, submitted: string): Promise<FactorAttempt> {
  const row = await getFactor(userId, 'second_password')
  if (!row || row.state !== 'active' || !row.passwordHash) return { ok: false, reason: 'no-factor' }
  const matched = await verifyPassword(submitted, row.passwordHash)
  if (!matched) return { ok: false, reason: 'mismatch' }
  const db = getDb()
  await db.update(userMfaFactors).set({ lastUsedAt: new Date() }).where(eq(userMfaFactors.id, row.id))
  return { ok: true, method: 'second_password' }
}

/**
 * Recovery code: bcrypt hashes cannot be looked up, so every unused code in the
 * account's current batch is compared. Bounded by RECOVERY_CODE_COUNT and by the
 * challenge attempt ceiling above it.
 */
export async function attemptRecoveryCode(userId: number, submitted: string): Promise<FactorAttempt> {
  const normalized = normalizeRecoveryCode(submitted)
  if (normalized.length !== 10) return { ok: false, reason: 'format' }

  const db = getDb()
  const rows = await db
    .select()
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)))

  if (rows.length === 0) return { ok: false, reason: 'no-factor' }

  for (const row of rows) {
    if (!(await verifyOneTimeCode(normalized, row.codeHash))) continue
    // Guarded on usedAt so two concurrent submissions cannot both spend it.
    await db
      .update(userRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(userRecoveryCodes.id, row.id), isNull(userRecoveryCodes.usedAt)))
    return { ok: true, method: 'recovery_code' }
  }
  return { ok: false, reason: 'mismatch' }
}
