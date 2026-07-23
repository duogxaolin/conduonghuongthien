import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const CURRENT_VERSION = 1
const NONCE_BYTES = 12
const TAG_BYTES = 16
const CONTEXT = 'cdkt-chatbot-provider-key:v1'

export interface EncryptedChatbotSecret {
  ciphertext: string
  nonce: string
  authTag: string
  version: number
  keyId: string
  lastFour: string
}

export class ChatbotEncryptionError extends Error {
  constructor(message = 'Chatbot credential is unavailable') {
    super(message)
    this.name = 'ChatbotEncryptionError'
  }
}

function decodeSecret(secret: string): Buffer {
  const trimmed = secret.trim()
  if (!trimmed) throw new ChatbotEncryptionError('CHATBOT_ENCRYPTION_SECRET is required')

  const encoded = trimmed.startsWith('base64:') ? trimmed.slice(7) : trimmed
  const decoded = Buffer.from(encoded, 'base64')
  const canonical = decoded.toString('base64').replace(/=+$/u, '')
  if (decoded.length !== 32 || canonical !== encoded.replace(/=+$/u, '')) {
    throw new ChatbotEncryptionError('CHATBOT_ENCRYPTION_SECRET must be a base64-encoded 32-byte key')
  }
  return decoded
}

export function getChatbotEncryptionKey(secret = process.env.CHATBOT_ENCRYPTION_SECRET): Buffer {
  if (!secret) throw new ChatbotEncryptionError('CHATBOT_ENCRYPTION_SECRET is required')
  return decodeSecret(secret)
}

export function validateChatbotEncryptionSecret(options: { secret?: string, production?: boolean } = {}): boolean {
  try {
    getChatbotEncryptionKey(options.secret)
    return true
  } catch (error) {
    if (options.production ?? process.env.NODE_ENV === 'production') throw error
    return false
  }
}

function keyIdentifier(key: Buffer): string {
  return createHash('sha256').update(CONTEXT).update(key).digest('hex').slice(0, 16)
}

function additionalData(version: number, keyId: string): Buffer {
  return Buffer.from(`${CONTEXT}:${version}:${keyId}`, 'utf8')
}

export function encryptChatbotSecret(plaintext: string, secret?: string): EncryptedChatbotSecret {
  if (!plaintext) throw new ChatbotEncryptionError('Chatbot credential cannot be empty')
  const key = getChatbotEncryptionKey(secret)
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
  if (result.length !== bytes) throw new ChatbotEncryptionError()
  return result
}

export function decryptChatbotSecret(encrypted: EncryptedChatbotSecret, secret?: string): string {
  try {
    if (encrypted.version !== CURRENT_VERSION) throw new ChatbotEncryptionError()
    const key = getChatbotEncryptionKey(secret)
    const expectedKeyId = keyIdentifier(key)
    const suppliedKeyId = Buffer.from(encrypted.keyId, 'utf8')
    const expectedKeyIdBuffer = Buffer.from(expectedKeyId, 'utf8')
    if (suppliedKeyId.length !== expectedKeyIdBuffer.length || !timingSafeEqual(suppliedKeyId, expectedKeyIdBuffer)) {
      throw new ChatbotEncryptionError()
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
    if (error instanceof ChatbotEncryptionError) throw error
    throw new ChatbotEncryptionError()
  }
}
