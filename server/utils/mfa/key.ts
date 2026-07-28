/**
 * Encryption key for stored TOTP secrets.
 *
 * The key is DERIVED from JWT_SECRET via HKDF-SHA256 under a dedicated `info`
 * label rather than being its own deployment secret. The reasoning, recorded in
 * openspec/changes/2026-07-28-admin-self-service-security/design.md:
 *
 *   • Reusing CHATBOT_ENCRYPTION_SECRET would couple two unrelated rotation
 *     domains — rotating the chatbot provider key, a routine act, would break
 *     every administrator's authenticator app.
 *   • Adding a fourth mandatory secret would take every existing deployment
 *     down on upgrade, since require-secrets.ts refuses to boot without one.
 *
 * The cost, accepted deliberately: rotating JWT_SECRET invalidates every stored
 * TOTP secret. Each row therefore carries the key id it was sealed under, so a
 * rotation is *detected* (factor reported unusable, operator error logged)
 * rather than surfacing as a decryption failure inside the login path.
 */
import { createHash, hkdfSync } from 'node:crypto'

/** Domain separation: this label must never be reused for another purpose. */
const INFO = 'cdkt-mfa-totp:v1'
const KEY_BYTES = 32

/**
 * HKDF needs a salt. A fixed, non-secret salt is correct here: the input keying
 * material (JWT_SECRET) is already high-entropy, and a per-row random salt
 * would have to be stored alongside the ciphertext for no gain.
 */
const SALT = Buffer.from('cdkt-mfa-hkdf-salt:v1', 'utf8')

/**
 * The signing secret, read the same way server/utils/auth.ts reads it — including
 * the development fallback, so a dev machine without a .env can still enroll.
 * Production absence is impossible (require-secrets.ts blocks boot) but is
 * treated as fatal here regardless of NODE_ENV shape.
 */
function inputKeyMaterial(): string {
  const secret = (process.env.JWT_SECRET || '').trim()
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not configured (required to encrypt MFA secrets).')
  }
  return 'cdkt_dev_only_insecure_jwt_secret_do_not_use_in_prod'
}

/**
 * Derive the 32-byte MFA key. Deterministic for a given JWT_SECRET, and
 * unrelated to the raw secret used for token signing.
 */
export function mfaEncryptionKey(): Buffer {
  const ikm = inputKeyMaterial()
  return Buffer.from(hkdfSync('sha256', Buffer.from(ikm, 'utf8'), SALT, Buffer.from(INFO, 'utf8'), KEY_BYTES))
}

/**
 * Short, non-secret fingerprint of the derived key, stored per row. Hashing the
 * label together with the key means the id reveals nothing about the key while
 * still changing whenever JWT_SECRET does.
 */
export function mfaKeyId(key: Buffer = mfaEncryptionKey()): string {
  return createHash('sha256').update(INFO).update(key).digest('hex').slice(0, 16)
}
