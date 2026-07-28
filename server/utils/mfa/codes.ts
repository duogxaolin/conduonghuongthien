/**
 * One-time codes: the six digits mailed for the email factor, and the recovery
 * codes printed once at generation.
 *
 * Both are bcrypt-hashed rather than SHA-256'd. A six-digit code is a 10^6
 * space; under a fast hash a database leak yields every outstanding code
 * instantly. bcrypt at the project's cost makes that leak useless within the
 * code's short lifetime, and the cost per submission is bounded by the attempt
 * limit anyway.
 */
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { hashPassword, verifyPassword } from '../auth'

export const EMAIL_CODE_DIGITS = 6
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000
/** Attempts allowed against one issued code before it is burned. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5

export const RECOVERY_CODE_COUNT = 10
/** Enrollment must be confirmed inside this window or the pending row lapses. */
export const ENROLLMENT_TTL_MS = 15 * 60 * 1000

/** randomInt, not Math.random: this is a credential. */
export function generateEmailCode(): string {
  return String(randomInt(0, 10 ** EMAIL_CODE_DIGITS)).padStart(EMAIL_CODE_DIGITS, '0')
}

export async function hashOneTimeCode(code: string): Promise<string> {
  return hashPassword(code)
}

export async function verifyOneTimeCode(code: string, hash: string): Promise<boolean> {
  return verifyPassword(code, hash)
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Ten characters from a 32-symbol alphabet — 50 bits — grouped as XXXXX-XXXXX
 * so they can be read aloud and retyped. I and O and 0 and 1 are excluded for
 * the same reason.
 */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(10)
  let out = ''
  for (let i = 0; i < 10; i++) {
    out += RECOVERY_ALPHABET[bytes[i]! % RECOVERY_ALPHABET.length]
    if (i === 4) out += '-'
  }
  return out
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => generateRecoveryCode())
}

/** Accepts the code with or without its separator, in either case. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function generateBatchId(): string {
  return randomBytes(12).toString('hex')
}

/** Fixed-length comparison for the non-hashed equality checks in this module. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function isExpired(at: Date | null | undefined, now: number = Date.now()): boolean {
  if (!at) return true
  return at.getTime() <= now
}
