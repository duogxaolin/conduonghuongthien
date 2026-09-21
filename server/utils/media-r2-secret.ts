/**
 * Envelope cho R2 secret key **riêng cho video** (Media Portal), gắn với nhãn
 * context riêng để một envelope lưu ở đây không giải mã được thành chatbot
 * provider key hay Google OAuth client secret và ngược lại — cùng cơ chế
 * `secret-envelope.ts` (design.md D3, reader-google-login-comments).
 *
 * Khoá vật liệu cố ý dùng chung `CHATBOT_ENCRYPTION_SECRET` — xem design.md D3
 * cho lý do từ chối bí mật production thứ tư. Biến tên này che giấu vai trò của
 * nó từ khi có cả ba tính năng (chatbot + Google OAuth + R2 video); CLAUDE.md
 * mô tả nó là khoá at-rest chung của cổng.
 *
 * Nhãn `cdkt-video-r2-secret:v1` là bí mật thứ tư, mỗi bí mật một nhãn riêng —
 * cố ý không thêm bí mật thứ năm và không thêm tên gọi khác cho cùng khoá: hai
 * tên cho một khoá là cách một deployment đặt sai cái.
 */
import { createSecretEnvelope, type SecretEnvelope } from './secret-envelope'

const CONTEXT = 'cdkt-video-r2-secret:v1'

export type EncryptedVideoR2Secret = SecretEnvelope

export class VideoR2EncryptionError extends Error {
  constructor(message = 'R2 credential for video is unavailable') {
    super(message)
    this.name = 'VideoR2EncryptionError'
  }
}

const codec = createSecretEnvelope({
  context: CONTEXT,
  envVar: 'CHATBOT_ENCRYPTION_SECRET',
  ErrorClass: VideoR2EncryptionError,
  emptyPlaintextMessage: 'R2 secret key for video cannot be empty',
})

export function getVideoR2EncryptionKey(secret = process.env.CHATBOT_ENCRYPTION_SECRET): Buffer {
  return codec.getEncryptionKey(secret)
}

export function validateVideoR2EncryptionSecret(options: { secret?: string, production?: boolean } = {}): boolean {
  return codec.validateEncryptionSecret(options)
}

export function encryptVideoR2Secret(plaintext: string, secret?: string): EncryptedVideoR2Secret {
  return codec.encryptSecret(plaintext, secret)
}

export function decryptVideoR2Secret(encrypted: EncryptedVideoR2Secret, secret?: string): string {
  return codec.decryptSecret(encrypted, secret)
}
