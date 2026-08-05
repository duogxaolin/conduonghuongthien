/**
 * Envelope for the Google OAuth client secret, bound to its own context label
 * so a stored envelope from this feature can never be decrypted as a chatbot
 * provider key or vice versa (design.md D3, reader-google-login-comments).
 *
 * Key material is deliberately the existing CHATBOT_ENCRYPTION_SECRET — see
 * design.md D3 for why a fourth mandatory production secret was rejected. The
 * env var name understates its role once this lands; CLAUDE.md should describe
 * it as the portal's at-rest secret key covering both features.
 */
import { createSecretEnvelope, type SecretEnvelope } from '../secret-envelope'

const CONTEXT = 'cdkt-google-oauth-secret:v1'

export type EncryptedGoogleOAuthSecret = SecretEnvelope

export class GoogleOAuthEncryptionError extends Error {
  constructor(message = 'Google OAuth credential is unavailable') {
    super(message)
    this.name = 'GoogleOAuthEncryptionError'
  }
}

const codec = createSecretEnvelope({
  context: CONTEXT,
  envVar: 'CHATBOT_ENCRYPTION_SECRET',
  ErrorClass: GoogleOAuthEncryptionError,
  emptyPlaintextMessage: 'Google OAuth client secret cannot be empty',
})

export function getGoogleOAuthEncryptionKey(secret = process.env.CHATBOT_ENCRYPTION_SECRET): Buffer {
  return codec.getEncryptionKey(secret)
}

export function validateGoogleOAuthEncryptionSecret(options: { secret?: string, production?: boolean } = {}): boolean {
  return codec.validateEncryptionSecret(options)
}

export function encryptGoogleOAuthSecret(plaintext: string, secret?: string): EncryptedGoogleOAuthSecret {
  return codec.encryptSecret(plaintext, secret)
}

export function decryptGoogleOAuthSecret(encrypted: EncryptedGoogleOAuthSecret, secret?: string): string {
  return codec.decryptSecret(encrypted, secret)
}
