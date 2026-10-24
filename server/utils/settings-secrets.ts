/**
 * Ba bí mật lưu trong bảng `settings` được mã hoá khi lưu (spec
 * settings-secret-storage, design D-SECRETS):
 *
 *   `smtp_pass`                     → nhãn `cdkt-smtp-pass:v1`
 *   `r2_secret_key`                 → nhãn `cdkt-r2-secret:v1`
 *   `backup_drive_service_account`  → nhãn `cdkt-backup-drive-key:v1`
 *
 * Trước đây ba giá trị này nằm nguyên văn trong `settings` — nghĩa là cũng nằm
 * nguyên văn trong MỌI bản dump CSDL (sao lưu trong app, `backup-db.sh`, dump trước
 * deploy, bản đẩy lên Drive). Mật khẩu SMTP, khoá R2 và khoá JSON của service
 * account (có `private_key`) đi theo mọi bản sao lưu đến bất kỳ đâu.
 *
 * Cùng primitive với mọi bí mật đã lưu khác (`secret-envelope.ts`: AES-256-GCM, nhãn
 * gập vào key id + AAD, khoá vật liệu `CHATBOT_ENCRYPTION_SECRET`). Mỗi khoá một nhãn
 * riêng: một envelope chép sang khoá khác (hay sang bảng khác) không bao giờ giải mã
 * ra một bí mật dùng được.
 *
 * Dạng lưu: JSON `{"sealed":"<nhãn>","version":1,"keyId":…,"nonce":…,"authTag":…,"ciphertext":…}`.
 * KHÔNG có `lastFour` (khác các envelope cũ): bốn ký tự cuối của mật khẩu là một
 * mẩu của chính mật khẩu, nằm trong mọi bản dump — và trang quản trị không bao giờ
 * hiện nó (`MASKED_SECRET` cho mọi vai trò).
 *
 * Bốn trạng thái khi đọc (`openSettingsSecret`):
 *  - `empty`      — chưa cấu hình;
 *  - `sealed`     — envelope giải mã được;
 *  - `plaintext`  — giá trị CŨ chưa được chuyển (khôi phục từ bản dump trước khi có
 *                   envelope, hoặc máy chưa có khoá lúc khởi động). Vẫn dùng được —
 *                   lần khởi động kế tiếp sẽ mã hoá nó (`settings-secret-conversion.ts`);
 *  - `unreadable` — envelope không giải mã được (xoay `CHATBOT_ENCRYPTION_SECRET`,
 *                   CSDL chép từ máy khác). Không bao giờ ghi đè; trang cài đặt báo
 *                   "cần nhập lại" (`needsReentry`). Nơi dùng nhận chuỗi rỗng, KHÔNG
 *                   BAO GIỜ nhận chính envelope làm thông tin đăng nhập.
 */
import { createSecretEnvelope, type SecretEnvelopeCodec } from './secret-envelope'
import { logError, logWarn } from './logger'

export const SETTINGS_SECRET_KEYS = ['smtp_pass', 'r2_secret_key', 'backup_drive_service_account'] as const
export type SettingsSecretKey = typeof SETTINGS_SECRET_KEYS[number]

export const SETTINGS_SECRET_LABELS: Readonly<Record<SettingsSecretKey, string>> = Object.freeze({
  smtp_pass: 'cdkt-smtp-pass:v1',
  r2_secret_key: 'cdkt-r2-secret:v1',
  backup_drive_service_account: 'cdkt-backup-drive-key:v1',
})

const KNOWN_LABELS: ReadonlySet<string> = new Set(Object.values(SETTINGS_SECRET_LABELS))

export class SettingsSecretError extends Error {
  constructor(message = 'Stored setting credential is unavailable') {
    super(message)
    this.name = 'SettingsSecretError'
  }
}

const codecs = Object.fromEntries(SETTINGS_SECRET_KEYS.map(key => [key, createSecretEnvelope({
  context: SETTINGS_SECRET_LABELS[key],
  envVar: 'CHATBOT_ENCRYPTION_SECRET',
  ErrorClass: SettingsSecretError,
  emptyPlaintextMessage: `${key} cannot be empty`,
})])) as Record<SettingsSecretKey, SecretEnvelopeCodec>

export function isSettingsSecretKey(key: string): key is SettingsSecretKey {
  return (SETTINGS_SECRET_KEYS as readonly string[]).includes(key)
}

interface StoredSettingsEnvelope {
  sealed: string
  version: number
  keyId: string
  nonce: string
  authTag: string
  ciphertext: string
}

/** Đọc dạng lưu; `null` khi chuỗi không phải một envelope của tệp này. */
function parseEnvelope(raw: string): StoredSettingsEnvelope | null {
  const text = raw.trim()
  if (!text.startsWith('{') || !text.includes('"sealed"')) return null
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  if (typeof value.sealed !== 'string' || !KNOWN_LABELS.has(value.sealed)) return null
  if (typeof value.version !== 'number') return null
  for (const field of ['keyId', 'nonce', 'authTag', 'ciphertext'] as const) {
    if (typeof value[field] !== 'string' || !value[field]) return null
  }
  return value as unknown as StoredSettingsEnvelope
}

/**
 * Chuỗi đã lưu có phải envelope (của BẤT KỲ khoá nào trong ba) không. Lượt chuyển
 * lúc khởi động dựa vào đây để không mã hoá hai lần — kể cả một envelope dán nhầm
 * khoá (nó vẫn là envelope, chỉ là không mở được ở khoá này).
 */
export function isSettingsSecretEnvelope(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && parseEnvelope(raw) !== null
}

/** Có khoá vật liệu dùng được không (để lưu/chuyển). Không ném. */
export function settingsSecretKeyAvailable(secret?: string): boolean {
  return codecs.smtp_pass.validateEncryptionSecret({ secret, production: false })
}

/**
 * Mã hoá một giá trị để lưu. Ném `SettingsSecretError` khi máy chủ không có
 * `CHATBOT_ENCRYPTION_SECRET` hợp lệ — nơi gọi trả lỗi, KHÔNG lưu nguyên văn.
 */
export function sealSettingsSecret(key: SettingsSecretKey, plaintext: string, secret?: string): string {
  if (!plaintext) throw new SettingsSecretError(`${key} cannot be empty`)
  const envelope = codecs[key].encryptSecret(plaintext, secret)
  const stored: StoredSettingsEnvelope = {
    sealed: SETTINGS_SECRET_LABELS[key],
    version: envelope.version,
    keyId: envelope.keyId,
    nonce: envelope.nonce,
    authTag: envelope.authTag,
    ciphertext: envelope.ciphertext,
  }
  return JSON.stringify(stored)
}

export type OpenedSettingsSecret =
  | { state: 'empty', value: '' }
  | { state: 'sealed', value: string }
  | { state: 'plaintext', value: string }
  | { state: 'unreadable', value: '' }

export function openSettingsSecret(key: SettingsSecretKey, raw: string | null | undefined, secret?: string): OpenedSettingsSecret {
  if (raw === null || raw === undefined || raw === '') return { state: 'empty', value: '' }
  const envelope = parseEnvelope(raw)
  if (!envelope) return { state: 'plaintext', value: raw }
  // Envelope của khoá khác: AAD/key id cũng sẽ không khớp, nhưng nói thẳng ra ở đây.
  if (envelope.sealed !== SETTINGS_SECRET_LABELS[key]) return { state: 'unreadable', value: '' }
  try {
    const value = codecs[key].decryptSecret({ ...envelope, lastFour: '' }, secret)
    return { state: 'sealed', value }
  } catch {
    return { state: 'unreadable', value: '' }
  }
}

/** Trang cài đặt: bí mật đã lưu có cần nhập lại không (envelope không mở được). */
export function settingsSecretNeedsReentry(key: SettingsSecretKey, raw: string | null | undefined): boolean {
  return openSettingsSecret(key, raw).state === 'unreadable'
}

const reported = new Set<string>()

/**
 * Giá trị để DÙNG (gửi mail, ký yêu cầu R2, đăng nhập Drive). `unreadable` → chuỗi
 * rỗng + `unreadable: true`, để nơi gọi báo đúng lỗi thay vì đăng nhập bằng rỗng.
 * Ghi log MỘT lần mỗi khoá mỗi tiến trình cho hai trạng thái bất thường.
 */
export function settingsSecretForUse(key: SettingsSecretKey, raw: string | null | undefined): { value: string, unreadable: boolean } {
  const opened = openSettingsSecret(key, raw)
  if (opened.state === 'unreadable' && !reported.has(`${key}:unreadable`)) {
    reported.add(`${key}:unreadable`)
    logError({
      event: 'settings.secret_unreadable',
      key,
      hint: 'Không giải mã được — CHATBOT_ENCRYPTION_SECRET đã đổi hoặc CSDL chép từ máy khác. Nhập lại bí mật này ở trang cài đặt.',
    })
  }
  if (opened.state === 'plaintext' && !reported.has(`${key}:plaintext`)) {
    reported.add(`${key}:plaintext`)
    logWarn({
      event: 'settings.secret_plaintext',
      key,
      hint: 'Giá trị chưa mã hoá (dữ liệu cũ) — lần khởi động kế tiếp sẽ mã hoá.',
    })
  }
  return { value: opened.value, unreadable: opened.state === 'unreadable' }
}
