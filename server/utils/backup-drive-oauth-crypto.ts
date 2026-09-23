/**
 * Envelope for the Google Drive OAuth refresh token, bound to its own context
 * label `cdkt-backup-drive-oauth:v1`.
 *
 * Same primitive as every stored secret in this codebase (AES-256-GCM, context
 * label folded into key id + GCM additional data) — see `secret-envelope.ts`.
 * The context label is what keeps this feature's envelope from being decrypted
 * as a Google OAuth client secret (`cdkt-google-oauth-secret:v1`) or a chatbot
 * provider key (`cdkt-chatbot-provider-key:v1`) — a copy-pasted ciphertext
 * between tables fails authentication, never yields a usable secret.
 *
 * Key material is `CHATBOT_ENCRYPTION_SECRET` — same env var as the other
 * at-rest secrets. CLAUDE.md documents that this var now protects multiple
 * features under separate labels.
 */
import { createSecretEnvelope, type SecretEnvelope } from './secret-envelope'

const CONTEXT = 'cdkt-backup-drive-oauth:v1'

export type EncryptedRefreshToken = SecretEnvelope

export class BackupDriveOAuthEncryptionError extends Error {
  constructor(message = 'Google Drive refresh token is unavailable') {
    super(message)
    this.name = 'BackupDriveOAuthEncryptionError'
  }
}

const codec = createSecretEnvelope({
  context: CONTEXT,
  envVar: 'CHATBOT_ENCRYPTION_SECRET',
  ErrorClass: BackupDriveOAuthEncryptionError,
  emptyPlaintextMessage: 'Refresh token cannot be empty',
})

export function getRefreshTokenEncryptionKey(secret = process.env.CHATBOT_ENCRYPTION_SECRET): Buffer {
  return codec.getEncryptionKey(secret)
}

export function validateRefreshTokenEncryptionSecret(options: { secret?: string, production?: boolean } = {}): boolean {
  return codec.validateEncryptionSecret(options)
}

export function encryptRefreshToken(plaintext: string, secret?: string): EncryptedRefreshToken {
  return codec.encryptSecret(plaintext, secret)
}

export function decryptRefreshToken(encrypted: EncryptedRefreshToken, secret?: string): string {
  return codec.decryptSecret(encrypted, secret)
}
