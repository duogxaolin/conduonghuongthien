/**
 * AES-256-GCM envelope for stored TOTP secrets.
 *
 * Deliberately mirrors server/utils/chatbot/crypto.ts — same version/nonce/
 * authTag/keyId shape, same AAD binding — so there is one envelope pattern in
 * this codebase rather than two. The difference is the key source (see ./key.ts)
 * and that a key mismatch is reported *distinctly* from tampering, because the
 * two demand opposite responses: a mismatch after a JWT_SECRET rotation is an
 * operational event to degrade gracefully around, while a failing authTag under
 * the right key means the stored bytes were altered.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { mfaEncryptionKey, mfaKeyId } from './key'

const ALGORITHM = 'aes-256-gcm'
const CURRENT_VERSION = 1
const NONCE_BYTES = 12
const CONTEXT = 'cdkt-mfa-totp-secret:v1'

export interface SealedMfaSecret {
  ciphertext: string
  nonce: string
  authTag: string
  version: number
  keyId: string
}

/** Binds the ciphertext to its version and key id: neither can be swapped. */
function additionalData(version: number, keyId: string): Buffer {
  return Buffer.from(`${CONTEXT}:${version}:${keyId}`, 'utf8')
}

export function sealTotpSecret(secret: string): SealedMfaSecret {
  const key = mfaEncryptionKey()
  const keyId = mfaKeyId(key)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, nonce)
  cipher.setAAD(additionalData(CURRENT_VERSION, keyId))
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    version: CURRENT_VERSION,
    keyId,
  }
}

/** Why an unseal failed. The caller reacts differently to each. */
export type UnsealFailure = 'key-mismatch' | 'tampered' | 'malformed'

export type UnsealResult =
  | { ok: true; secret: string }
  | { ok: false; reason: UnsealFailure }

/**
 * Never throws: this runs inside the login path, where an exception would turn a
 * recoverable "this one factor is unusable" into a failed login.
 */
export function unsealTotpSecret(sealed: Partial<SealedMfaSecret> | null | undefined): UnsealResult {
  if (!sealed?.ciphertext || !sealed.nonce || !sealed.authTag || !sealed.version || !sealed.keyId) {
    return { ok: false, reason: 'malformed' }
  }

  let key: Buffer
  let currentKeyId: string
  try {
    key = mfaEncryptionKey()
    currentKeyId = mfaKeyId(key)
  } catch {
    return { ok: false, reason: 'key-mismatch' }
  }

  // Checked before attempting decryption so a rotation is named as such rather
  // than reported as an authTag failure, which would read as tampering.
  const stored = Buffer.from(sealed.keyId, 'utf8')
  const current = Buffer.from(currentKeyId, 'utf8')
  if (stored.length !== current.length || !timingSafeEqual(stored, current)) {
    return { ok: false, reason: 'key-mismatch' }
  }

  if (sealed.version !== CURRENT_VERSION) return { ok: false, reason: 'malformed' }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.nonce, 'base64'))
    decipher.setAAD(additionalData(sealed.version, sealed.keyId))
    decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ])
    return { ok: true, secret: plain.toString('utf8') }
  } catch {
    return { ok: false, reason: 'tampered' }
  }
}
