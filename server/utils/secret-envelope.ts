/**
 * AES-256-GCM envelope factory, bound to a context label.
 *
 * This generalizes what was previously written once, inline, in
 * server/utils/chatbot/crypto.ts. Every stored secret in this codebase (chatbot
 * provider API key, Google OAuth client secret, …) uses the same primitive:
 * AES-256-GCM, a context label folded into both the key identifier and the GCM
 * additional data, a `timingSafeEqual` key-id comparison, and a `lastFour` for
 * masking in the UI.
 *
 * The context label is what keeps two features from being confusable at rest:
 * it feeds the key identifier AND the authenticated additional data, so an
 * envelope written under one label fails authentication (not just a key-id
 * mismatch) when decrypted under another — a copy-pasted ciphertext between
 * tables can never yield a usable secret (design.md D3, reader-google-login-comments).
 *
 * Each call site supplies its own Error subclass so `instanceof` checks at the
 * call site keep working exactly as before — this factory never throws a bare
 * `Error` or a shared error type that would blur which feature failed.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const CURRENT_VERSION = 1
const NONCE_BYTES = 12
const TAG_BYTES = 16

export interface SecretEnvelope {
  ciphertext: string
  nonce: string
  authTag: string
  version: number
  keyId: string
  lastFour: string
}

export interface SecretEnvelopeCodec {
  getEncryptionKey(secret?: string): Buffer
  validateEncryptionSecret(options?: { secret?: string, production?: boolean }): boolean
  encryptSecret(plaintext: string, secret?: string): SecretEnvelope
  decryptSecret(encrypted: SecretEnvelope, secret?: string): string
}

export interface SecretEnvelopeOptions {
  /** Domain-separation label folded into both the key id and the GCM AAD. Never reuse across features. */
  context: string
  /** Environment variable read by default when no secret is passed explicitly (e.g. `CHATBOT_ENCRYPTION_SECRET`). */
  envVar: string
  /** Thrown for every failure, so callers get one `instanceof`-matchable error type per feature. */
  ErrorClass: new (message?: string) => Error
  /** Message for an empty-plaintext encrypt call. Defaults to a generic message. */
  emptyPlaintextMessage?: string
}

export function createSecretEnvelope(options: SecretEnvelopeOptions): SecretEnvelopeCodec {
  const { context, envVar, ErrorClass } = options
  const emptyPlaintextMessage = options.emptyPlaintextMessage ?? 'Secret value cannot be empty'

  function fail(message?: string): Error {
    return new ErrorClass(message)
  }

  function decodeSecret(secret: string): Buffer {
    const trimmed = secret.trim()
    if (!trimmed) throw fail(`${envVar} is required`)

    const encoded = trimmed.startsWith('base64:') ? trimmed.slice(7) : trimmed
    const decoded = Buffer.from(encoded, 'base64')
    const canonical = decoded.toString('base64').replace(/=+$/u, '')
    if (decoded.length !== 32 || canonical !== encoded.replace(/=+$/u, '')) {
      throw fail(`${envVar} must be a base64-encoded 32-byte key`)
    }
    return decoded
  }

  function getEncryptionKey(secret = process.env[envVar]): Buffer {
    if (!secret) throw fail(`${envVar} is required`)
    return decodeSecret(secret)
  }

  function validateEncryptionSecret(opts: { secret?: string, production?: boolean } = {}): boolean {
    try {
      getEncryptionKey(opts.secret)
      return true
    } catch (error) {
      if (opts.production ?? process.env.NODE_ENV === 'production') throw error
      return false
    }
  }

  function keyIdentifier(key: Buffer): string {
    return createHash('sha256').update(context).update(key).digest('hex').slice(0, 16)
  }

  function additionalData(version: number, keyId: string): Buffer {
    return Buffer.from(`${context}:${version}:${keyId}`, 'utf8')
  }

  function encryptSecret(plaintext: string, secret?: string): SecretEnvelope {
    if (!plaintext) throw fail(emptyPlaintextMessage)
    const key = getEncryptionKey(secret)
    const nonce = randomBytes(NONCE_BYTES)
    const keyId = keyIdentifier(key)
    const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES })
    cipher.setAAD(additionalData(CURRENT_VERSION, keyId))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

    return {
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      version: CURRENT_VERSION,
      keyId,
      lastFour: plaintext.slice(-4),
    }
  }

  function decodeExact(value: string, bytes: number): Buffer {
    const result = Buffer.from(value, 'base64')
    if (result.length !== bytes) throw fail()
    return result
  }

  function decryptSecret(encrypted: SecretEnvelope, secret?: string): string {
    try {
      if (encrypted.version !== CURRENT_VERSION) throw fail()
      const key = getEncryptionKey(secret)
      const expectedKeyId = keyIdentifier(key)
      const suppliedKeyId = Buffer.from(encrypted.keyId, 'utf8')
      const expectedKeyIdBuffer = Buffer.from(expectedKeyId, 'utf8')
      if (suppliedKeyId.length !== expectedKeyIdBuffer.length || !timingSafeEqual(suppliedKeyId, expectedKeyIdBuffer)) {
        throw fail()
      }
      const nonce = decodeExact(encrypted.nonce, NONCE_BYTES)
      const tag = decodeExact(encrypted.authTag, TAG_BYTES)
      const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES })
      decipher.setAAD(additionalData(encrypted.version, encrypted.keyId))
      decipher.setAuthTag(tag)
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    } catch (error) {
      if (error instanceof ErrorClass) throw error
      throw fail()
    }
  }

  return { getEncryptionKey, validateEncryptionSecret, encryptSecret, decryptSecret }
}
