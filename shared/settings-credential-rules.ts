/**
 * Quy tắc "đổi ĐÍCH thì phải nhập lại MẬT KHẨU" cho các bí mật lưu trong bảng
 * `settings` (SMTP, R2 ảnh, R2 video) — cùng quy tắc với Base URL của nhà cung cấp
 * AI (`server/api/admin/ai/providers/[id].put.ts`).
 *
 * Nằm ở `shared/` vì CHẠY Ở HAI NƠI với cùng một nghĩa:
 *  - máy chủ (`server/utils/settings-credential-guard.ts` re-export) là nơi quyết
 *    định — `settings/index.put.ts`, `settings/media-portal.put.ts`;
 *  - trang quản trị (`email.vue`, `media-storage.vue`, `media-portal.vue`) gọi đúng
 *    hàm này trước khi gửi, để báo lỗi ngay cạnh ô nhập thay vì chờ 400. Giao diện
 *    chỉ là lời nhắc sớm; bỏ qua nó thì máy chủ vẫn từ chối.
 *
 * Tệp này KHÔNG được import gì từ `server/` hay `app/` (chạy được ở cả hai phía,
 * kể cả trong ngữ cảnh typecheck của app).
 *
 * Lỗ hổng mà quy tắc đóng: trang cài đặt che mật khẩu (`********`) và endpoint lưu
 * bỏ qua dấu che — nghĩa là "giữ mật khẩu cũ". Trước đây một người chỉ có
 * `settings.update` gửi `{ smtp_host: 'mail.attacker.example', smtp_pass: '********' }`
 * thì host mới được lưu còn mật khẩu cũ nằm lại; email thông báo kế tiếp (và nút
 * "gửi thử") đăng nhập vào máy của kẻ tấn công bằng đúng mật khẩu thật. Nay: đổi
 * bất kỳ trường nào quyết định bí mật được gửi TỚI ĐÂU mà không gõ lại bí mật đó
 * trong cùng lần lưu → từ chối.
 */

/** Dấu che mà các endpoint GET trả thay cho bí mật đã lưu (`smtp_pass`, `r2_secret_key`). */
export const MASKED_SECRET = '********'

// ─── SMTP ─────────────────────────────────────────────────────────────────────
//
// Bản SMTP dưới đây PHẢI trùng `server/utils/smtp-test-config.ts` (nơi endpoint
// "gửi thử" dùng). `tests/settings-credential-rules.test.ts` chạy cả hai bản trên
// cùng một bảng đầu vào và đỏ nếu chúng lệch nhau.

/**
 * Cổng SMTP được phép: 25 (relay), 465 (TLS ngầm), 587 (submission), 2525 (cổng
 * thay thế phổ biến). Mọi cổng khác bị từ chối cả lúc LƯU lẫn lúc GỬI THỬ — không
 * có trần này thì ô "cổng" biến máy chủ thành công cụ dò cổng nội bộ.
 */
export const SMTP_ALLOWED_PORTS: readonly number[] = Object.freeze([25, 465, 587, 2525])

export const SMTP_PORT_NOT_ALLOWED_MESSAGE = `Cổng SMTP không được phép. Chỉ nhận ${SMTP_ALLOWED_PORTS.join(', ')}.`

export const SMTP_RETYPE_PASSWORD_MESSAGE
  = 'Đổi máy chủ SMTP (host, cổng, tài khoản hoặc chế độ bảo mật) phải nhập lại mật khẩu SMTP trong cùng lần lưu.'

/** Cổng hiệu lực của một giá trị nhập (rỗng → 587, như `getSmtpConfig`); `null` nếu không phải số nguyên. */
export function effectiveSmtpPort(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!text) return 587
  if (!/^\d{1,5}$/.test(text)) return null
  return Number(text)
}

export function isAllowedSmtpPort(port: number | null): boolean {
  return port !== null && SMTP_ALLOWED_PORTS.includes(port)
}

const isTruthy = (value: unknown) => ['true', '1', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())

/** Đích kết nối SMTP hiệu lực — chuẩn hoá giống `getSmtpConfig` để so "có đổi máy chủ không". */
export interface SmtpTarget {
  host: string
  port: number | null
  user: string
  secure: boolean
}

export function smtpTargetOf(values: { smtp_host?: unknown, smtp_port?: unknown, smtp_user?: unknown, smtp_secure?: unknown }): SmtpTarget {
  return {
    // Tên máy không phân biệt hoa/thường: đổi chữ hoa không phải đổi đích.
    host: String(values.smtp_host ?? '').trim().toLowerCase(),
    port: effectiveSmtpPort(values.smtp_port),
    user: String(values.smtp_user ?? '').trim(),
    secure: isTruthy(values.smtp_secure),
  }
}

export function sameSmtpTarget(a: SmtpTarget, b: SmtpTarget): boolean {
  return a.host === b.host && a.port === b.port && a.user === b.user && a.secure === b.secure
}

// ─── R2 ───────────────────────────────────────────────────────────────────────

/**
 * Cloudflare account ID: 32 ký tự hex. Ràng buộc định dạng là thứ GHIM host R2:
 * `createR2Client` (`server/utils/media-r2.ts`) và client video
 * (`server/services/video-r2-sync.ts`) dựng endpoint bằng
 * `https://${accountId}.r2.cloudflarestorage.com`, nên một account id kiểu
 * `evil.example#` biến endpoint thành `https://evil.example#.r2…` — host là
 * `evil.example`, và SDK ký yêu cầu bằng access key gửi tới đó. Chỉ hex thì
 * endpoint luôn là một tên con của `r2.cloudflarestorage.com`.
 */
const CLOUDFLARE_ACCOUNT_ID = /^[0-9a-f]{32}$/i

/**
 * Tên bucket R2: 3–63 ký tự, chữ thường/số/gạch ngang, bắt đầu và kết thúc bằng
 * chữ hoặc số. SDK S3 có thể ghép bucket vào tên máy (virtual-hosted style); giới
 * hạn bộ ký tự giữ nó là một nhãn DNS đơn, không có `.`/`/`/`#`/`@`.
 */
const R2_BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

export function isCloudflareAccountId(value: string): boolean {
  return CLOUDFLARE_ACCOUNT_ID.test(value)
}

export function isR2BucketName(value: string): boolean {
  return R2_BUCKET_NAME.test(value)
}

export const R2_ACCOUNT_ID_INVALID_MESSAGE = 'Account ID của Cloudflare R2 không hợp lệ (phải là 32 ký tự hex).'
export const R2_BUCKET_INVALID_MESSAGE
  = 'Tên bucket R2 không hợp lệ (3–63 ký tự: chữ thường, số, gạch ngang; bắt đầu và kết thúc bằng chữ hoặc số).'
export const R2_RETYPE_SECRET_MESSAGE = 'Đổi Account ID của R2 phải nhập lại Secret Access Key trong cùng lần lưu.'
export const VIDEO_R2_RETYPE_SECRET_MESSAGE
  = 'Đổi Account ID hoặc Bucket của R2 video phải nhập lại R2 Secret Key trong cùng lần lưu.'

// ─── Quyết định cho biểu mẫu `settings` chung (SMTP + R2 ảnh) ────────────────────

type SettingsBody = Record<string, unknown>

const has = (body: SettingsBody, key: string) => Object.prototype.hasOwnProperty.call(body, key)
const text = (value: unknown) => (value === null || value === undefined ? '' : String(value))

/**
 * Thân yêu cầu có mang một bí mật MỚI thật sự không. Vắng, rỗng hay còn dấu che đều
 * là "không": dấu che nghĩa là "giữ bí mật đã lưu", còn ô trống thì endpoint LƯU
 * chuỗi rỗng (xoá bí mật) — không phải nhập lại, nên cũng không mở khoá đổi đích.
 */
function retypesSecret(body: SettingsBody, key: string): boolean {
  if (!has(body, key)) return false
  const value = text(body[key])
  return value !== '' && value !== MASKED_SECRET
}

/**
 * Câu lỗi tiếng Việt nếu lượt lưu `PUT /api/admin/settings` này phải bị từ chối,
 * `null` nếu được phép. `current` là giá trị đang lưu (phía trang: giá trị vừa tải
 * về — bí mật ở dạng dấu che, vẫn khác rỗng đúng khi đã lưu một bí mật). Quyết định
 * trên TOÀN BỘ thân, nên thứ tự khoá trong JSON không đổi được kết quả.
 */
export function credentialRetargetViolation(body: SettingsBody, current: ReadonlyMap<string, string>): string | null {
  const stored = (key: string) => current.get(key) ?? ''

  // ── SMTP ────────────────────────────────────────────────────────────────────
  const smtpKeys = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_secure'] as const
  if (smtpKeys.some(key => has(body, key))) {
    const storedValues = Object.fromEntries(smtpKeys.map(key => [key, stored(key)]))
    const nextValues = Object.fromEntries(smtpKeys.map(key => [key, has(body, key) ? text(body[key]) : stored(key)]))
    const before = smtpTargetOf(storedValues)
    const after = smtpTargetOf(nextValues)

    // Cổng: chỉ kiểm khi đổi — một giá trị lạ lưu từ trước không chặn việc lưu
    // phần còn lại của biểu mẫu (nút "gửi thử" vẫn từ chối nó).
    if (has(body, 'smtp_port') && after.port !== before.port && !isAllowedSmtpPort(effectiveSmtpPort(body.smtp_port))) {
      return SMTP_PORT_NOT_ALLOWED_MESSAGE
    }

    if (!sameSmtpTarget(before, after) && stored('smtp_pass') !== '' && !retypesSecret(body, 'smtp_pass')) {
      return SMTP_RETYPE_PASSWORD_MESSAGE
    }
  }

  // ── R2 (ảnh) ────────────────────────────────────────────────────────────────
  if (has(body, 'r2_account_id')) {
    const next = text(body.r2_account_id).trim()
    if (next !== stored('r2_account_id').trim()) {
      if (next !== '' && !isCloudflareAccountId(next)) return R2_ACCOUNT_ID_INVALID_MESSAGE
      if (stored('r2_secret_key') !== '' && !retypesSecret(body, 'r2_secret_key')) return R2_RETYPE_SECRET_MESSAGE
    }
  }
  if (has(body, 'r2_bucket')) {
    const next = text(body.r2_bucket).trim()
    if (next !== stored('r2_bucket').trim() && next !== '' && !isR2BucketName(next)) return R2_BUCKET_INVALID_MESSAGE
  }

  return null
}

// ─── Quyết định cho biểu mẫu Media Portal (R2 riêng cho video) ─────────────────

/** Giá trị R2 video đang lưu. `secretStored` = đã có một bí mật (kể cả không giải mã được). */
export interface StoredVideoR2 {
  accountId: string
  bucket: string
  secretStored: boolean
}

/**
 * Câu lỗi nếu lượt lưu `PUT /api/admin/settings/media-portal` (`fields`) phải bị từ
 * chối, `null` nếu được phép.
 *
 * Khác biểu mẫu chung ở hai chỗ, đều do endpoint này:
 *  - ô Secret Key không có dấu che: trang để trống = "giữ nguyên", nên chỉ một
 *    giá trị KHÁC RỖNG mới tính là đã nhập lại;
 *  - đổi Bucket cũng phải nhập lại bí mật (yêu cầu của đợt rà soát 2026-10 cho R2
 *    video) — bucket là nơi video được ghi vào, không chỉ một chi tiết hiển thị.
 *    R2 ảnh ở biểu mẫu chung vẫn chỉ ràng buộc định dạng bucket (quy tắc của F1).
 * Định dạng account id / bucket được kiểm mỗi khi giá trị ĐỔI; một giá trị cũ lưu
 * từ trước gửi lại nguyên văn không chặn việc lưu các ô khác.
 */
export function videoR2RetargetViolation(fields: SettingsBody, stored: StoredVideoR2): string | null {
  const retyped = has(fields, 'videoR2SecretKey') && text(fields.videoR2SecretKey).trim() !== ''

  let destinationChanged = false
  if (has(fields, 'videoR2AccountId')) {
    const next = text(fields.videoR2AccountId).trim()
    if (next !== stored.accountId.trim()) {
      if (next !== '' && !isCloudflareAccountId(next)) return R2_ACCOUNT_ID_INVALID_MESSAGE
      destinationChanged = true
    }
  }
  if (has(fields, 'videoR2Bucket')) {
    const next = text(fields.videoR2Bucket).trim()
    if (next !== stored.bucket.trim()) {
      if (next !== '' && !isR2BucketName(next)) return R2_BUCKET_INVALID_MESSAGE
      destinationChanged = true
    }
  }

  if (destinationChanged && stored.secretStored && !retyped) return VIDEO_R2_RETYPE_SECRET_MESSAGE
  return null
}
