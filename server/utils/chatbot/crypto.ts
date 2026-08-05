/**
 * Thin wrapper over server/utils/secret-envelope.ts, bound to this feature's
 * context label. Every export name and signature below is preserved exactly
 * as it was before the AES-256-GCM logic moved into the shared factory, so
 * every existing call site (chatbot/settings.ts, chatbot/startup.ts,
 * services/chatbot-settings.ts) and every stored ciphertext keeps working
 * unchanged. The label `cdkt-chatbot-provider-key:v1` is byte-for-byte the
 * same string the inline implementation used — changing it would silently
 * orphan every chatbot API key already stored in the database (design.md D3,
 * reader-google-login-comments).
 */
import { createSecretEnvelope, type SecretEnvelope } from '../secret-envelope'

const CONTEXT = 'cdkt-chatbot-provider-key:v1'

export type EncryptedChatbotSecret = SecretEnvelope

export class ChatbotEncryptionError extends Error {
  constructor(message = 'Chatbot credential is unavailable') {
    super(message)
    this.name = 'ChatbotEncryptionError'
  }
}

const codec = createSecretEnvelope({
  context: CONTEXT,
  envVar: 'CHATBOT_ENCRYPTION_SECRET',
  ErrorClass: ChatbotEncryptionError,
  emptyPlaintextMessage: 'Chatbot credential cannot be empty',
})

export function getChatbotEncryptionKey(secret = process.env.CHATBOT_ENCRYPTION_SECRET): Buffer {
  return codec.getEncryptionKey(secret)
}

export function validateChatbotEncryptionSecret(options: { secret?: string, production?: boolean } = {}): boolean {
  return codec.validateEncryptionSecret(options)
}

export function encryptChatbotSecret(plaintext: string, secret?: string): EncryptedChatbotSecret {
  return codec.encryptSecret(plaintext, secret)
}

export function decryptChatbotSecret(encrypted: EncryptedChatbotSecret, secret?: string): string {
  return codec.decryptSecret(encrypted, secret)
}
