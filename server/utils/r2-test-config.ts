import type { R2Config } from './media-r2'
import { MASKED_SECRET, isCloudflareAccountId, isR2BucketName } from '../../shared/settings-credential-rules'

/**
 * Nút "Kiểm tra kết nối R2" (`POST /api/admin/settings/test-r2`) — quyết định
 * dùng thông số nào và đọc lỗi ra sao. Hàm thuần, cùng khuôn với
 * `smtp-test-config.ts` của nút "gửi email thử".
 *
 * Lỗ hổng cũ: endpoint chỉ đòi `settings.read`, dựng endpoint R2 từ `accountId`
 * trong THÂN yêu cầu (`evil.example#` → host `evil.example`) và trả nguyên văn
 * `err.message` — một người chỉ được XEM cài đặt dùng được máy chủ để dò mạng.
 */

/** Đủ bốn trường để dựng client và gọi `ListObjectsV2` (không cần public URL). */
export interface R2TestCredentials {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

const field = (body: Record<string, unknown> | null | undefined, key: string) => String(body?.[key] ?? '').trim()

/**
 * True khi lượt thử phải chạy trên cấu hình ĐÃ LƯU: ô Secret Key vắng, trống hoặc
 * còn dấu che (`********` — trang `media-storage.vue` nhận nó từ GET khi người xem
 * không phải SuperAdmin). Bí mật đã lưu không bao giờ được ghép với account id /
 * bucket lấy từ thân yêu cầu.
 */
export function r2TestUsesSavedConfig(body: Record<string, unknown> | null | undefined): boolean {
  const secret = field(body, 'secretAccessKey')
  return secret === '' || secret === MASKED_SECRET
}

export type R2TestDecision =
  | { ok: true, credentials: R2TestCredentials, usedSaved: boolean, ignoredUnsavedChanges: boolean }
  | { ok: false, message: string }

/**
 * Chọn thông số cho lượt thử.
 *  - Đường "đã lưu": dùng NGUYÊN BỘ bốn giá trị đã lưu, bỏ qua mọi trường trong
 *    thân. Account id / bucket đã lưu vẫn được kiểm định dạng: một giá trị lái
 *    host lưu từ trước khi có `settings-credential-guard` không được quay số thêm
 *    lần nào (cùng cách nút gửi email thử áp trần cổng cho cấu hình đã lưu).
 *  - Đường "nhập mới": cán bộ gõ Secret Key thì dùng đúng bốn giá trị đã gõ, không
 *    lùi về giá trị đã lưu cho bất kỳ trường nào.
 */
export function resolveR2TestConfig(body: Record<string, unknown> | null | undefined, saved: R2Config | null): R2TestDecision {
  if (r2TestUsesSavedConfig(body)) {
    const credentials: R2TestCredentials = {
      accountId: (saved?.accountId ?? '').trim(),
      accessKeyId: (saved?.accessKeyId ?? '').trim(),
      secretAccessKey: (saved?.secretAccessKey ?? '').trim(),
      bucket: (saved?.bucket ?? '').trim(),
    }
    if (!credentials.accountId || !credentials.accessKeyId || !credentials.secretAccessKey || !credentials.bucket) {
      return { ok: false, message: 'R2 chưa được cấu hình đủ (Account ID, Access Key, Secret Key, Bucket). Hãy lưu cấu hình, hoặc nhập Secret Key để thử thông số mới.' }
    }
    if (!isCloudflareAccountId(credentials.accountId) || !isR2BucketName(credentials.bucket)) {
      return { ok: false, message: 'Cấu hình R2 đã lưu không hợp lệ (Account ID phải là 32 ký tự hex, Bucket theo quy tắc đặt tên R2). Hãy nhập lại và lưu.' }
    }
    const bodyAccount = field(body, 'accountId')
    const bodyBucket = field(body, 'bucket')
    const bodyAccess = field(body, 'accessKeyId')
    const ignoredUnsavedChanges = (bodyAccount !== '' && bodyAccount.toLowerCase() !== credentials.accountId.toLowerCase())
      || (bodyBucket !== '' && bodyBucket !== credentials.bucket)
      || (bodyAccess !== '' && bodyAccess !== credentials.accessKeyId)
    return { ok: true, credentials, usedSaved: true, ignoredUnsavedChanges }
  }

  const credentials: R2TestCredentials = {
    accountId: field(body, 'accountId'),
    accessKeyId: field(body, 'accessKeyId'),
    secretAccessKey: field(body, 'secretAccessKey'),
    bucket: field(body, 'bucket'),
  }
  if (!credentials.accountId || !credentials.accessKeyId || !credentials.bucket) {
    return { ok: false, message: 'Vui lòng nhập đầy đủ Account ID, Access Key, Secret Key và Bucket name.' }
  }
  if (!isCloudflareAccountId(credentials.accountId)) {
    return { ok: false, message: 'Account ID của Cloudflare R2 không hợp lệ (phải là 32 ký tự hex).' }
  }
  if (!isR2BucketName(credentials.bucket)) {
    return { ok: false, message: 'Tên bucket R2 không hợp lệ (3–63 ký tự: chữ thường, số, gạch ngang; bắt đầu và kết thúc bằng chữ hoặc số).' }
  }
  return { ok: true, credentials, usedSaved: false, ignoredUnsavedChanges: false }
}

/**
 * Lớp lỗi trả cho cán bộ — KHÔNG BAO GIỜ nguyên văn `err.message` của SDK (chuỗi
 * đó có thể chứa tên máy, IP, mã yêu cầu, phản hồi thô). Chi tiết chỉ vào log máy
 * chủ. Cố ý gộp "không phân giải được tên", "bị từ chối kết nối", "hết giờ" vào
 * một lớp `network`: tách chúng ra là tín hiệu "cổng mở/đóng" của máy dò.
 */
export type R2FailureClass = 'auth' | 'bucket' | 'network' | 'unknown'

const AUTH_ERROR_NAMES = new Set([
  'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'AccessDenied', 'Unauthorized', 'Forbidden',
  'InvalidToken', 'ExpiredToken', 'InvalidSecurity', 'CredentialsProviderError',
])
const BUCKET_ERROR_NAMES = new Set(['NoSuchBucket', 'InvalidBucketName'])
const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ERR_SOCKET_CONNECTION_TIMEOUT',
])
const NETWORK_ERROR_NAMES = new Set(['TimeoutError', 'AbortError', 'RequestTimeout', 'RequestTimeoutException', 'NetworkingError'])

function prop(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null && key in error ? (error as Record<string, unknown>)[key] : undefined
}

/** Mã HTTP mà SDK v3 gắn vào lỗi dịch vụ (`$metadata.httpStatusCode`). */
export function r2ErrorHttpStatus(error: unknown): number | undefined {
  const status = prop(prop(error, '$metadata'), 'httpStatusCode')
  return typeof status === 'number' ? status : undefined
}

export function classifyR2Error(error: unknown): R2FailureClass {
  const name = String(prop(error, 'name') ?? '')
  const code = String(prop(error, 'code') ?? prop(error, 'Code') ?? '')
  const status = r2ErrorHttpStatus(error)
  if (AUTH_ERROR_NAMES.has(name) || AUTH_ERROR_NAMES.has(code) || status === 401 || status === 403) return 'auth'
  if (BUCKET_ERROR_NAMES.has(name) || BUCKET_ERROR_NAMES.has(code) || status === 404) return 'bucket'
  if (NETWORK_ERROR_CODES.has(code) || NETWORK_ERROR_NAMES.has(name)) return 'network'
  // Lỗi mạng của Node có khi bị SDK bọc lại: mã thật nằm ở `cause`.
  const cause = prop(error, 'cause')
  if (cause && cause !== error && NETWORK_ERROR_CODES.has(String(prop(cause, 'code') ?? ''))) return 'network'
  return 'unknown'
}

export function r2FailureMessage(kind: R2FailureClass): string {
  switch (kind) {
    case 'auth': return 'Cloudflare R2 từ chối thông tin đăng nhập. Kiểm tra lại Access Key, Secret Key và Account ID.'
    case 'bucket': return 'Không tìm thấy Bucket trên tài khoản R2 này. Kiểm tra lại tên Bucket.'
    case 'network': return 'Không kết nối được tới Cloudflare R2 (lỗi mạng hoặc hết thời gian chờ). Thử lại sau.'
    default: return 'Lỗi không xác định khi kết nối R2. Chi tiết đã được ghi vào nhật ký máy chủ.'
  }
}
