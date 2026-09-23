/**
 * Thin wrapper over secret-envelope.ts, bound to the AI Panel's context label.
 *
 * Mirrors `server/utils/chatbot/crypto.ts` and `server/utils/google-oauth/crypto.ts`:
 * each feature gets its own label, and the label prevents ciphertext copied
 * between tables from decrypting under the wrong feature — see design.md D2.
 *
 * The label `cdkt-ai-provider-key:v1` is distinct from `cdkt-chatbot-provider-key:v1`
 * and `cdkt-google-oauth-secret:v1`. All AI provider keys (Google, OpenAI, Anthropic,
 * DeepSeek) use the same label: the label separates features, not providers.
 */
import { createSecretEnvelope, type SecretEnvelope } from '../secret-envelope'

const CONTEXT = 'cdkt-ai-provider-key:v1'

export type EncryptedAiSecret = SecretEnvelope

export class AiEncryptionError extends Error {
  constructor(message = 'AI provider credential is unavailable') {
    super(message)
    this.name = 'AiEncryptionError'
  }
}

const codec = createSecretEnvelope({
  context: CONTEXT,
  envVar: 'CHATBOT_ENCRYPTION_SECRET',
  ErrorClass: AiEncryptionError,
  emptyPlaintextMessage: 'AI provider credential cannot be empty',
})

/** Reuse the same encryption key as chatbot/Google OAuth — same env var, different label. */
export function getAiEncryptionKey(secret = process.env.CHATBOT_ENCRYPTION_SECRET): Buffer {
  return codec.getEncryptionKey(secret)
}

export function validateAiEncryptionSecret(options: { secret?: string, production?: boolean } = {}): boolean {
  return codec.validateEncryptionSecret(options)
}

export function encryptAiSecret(plaintext: string, secret?: string): EncryptedAiSecret {
  return codec.encryptSecret(plaintext, secret)
}

export function decryptAiSecret(encrypted: EncryptedAiSecret, secret?: string): string {
  return codec.decryptSecret(encrypted, secret)
}
