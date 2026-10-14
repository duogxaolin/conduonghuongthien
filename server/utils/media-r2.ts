import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

import {
  R2_ACCOUNT_ID_INVALID_MESSAGE,
  R2_BUCKET_INVALID_MESSAGE,
  isCloudflareAccountId,
  isR2BucketName,
} from '../../shared/settings-credential-rules'
import { logWarn } from './logger'

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicUrl: string
}

// ─── Kiểm cấu hình R2 LÚC DÙNG ────────────────────────────────────────────────
//
// Endpoint R2 được dựng bằng `https://${accountId}.r2.cloudflarestorage.com` và SDK
// ký mọi yêu cầu bằng access key gửi tới đó. Trang cài đặt đã chặn account id /
// bucket dị dạng lúc LƯU (`shared/settings-credential-rules.ts`), nhưng giá trị lưu
// TRƯỚC bản vá đó (hoặc ghi thẳng vào CSDL, hoặc đi theo một bản khôi phục) vẫn
// được dùng nguyên văn: account id `evil.example#` cho endpoint
// `https://evil.example#.r2…` — host `evil.example`, nhận chữ ký và access key.
// Nay mọi client R2 (ảnh ở đây, video ở `services/video-r2-sync.ts`) đi qua
// `openR2`: account id phải là 32 hex, bucket là một nhãn DNS hợp lệ — không thì
// ném `R2ConfigInvalidError` (có phân loại, 400) và log `r2.config_invalid`,
// KHÔNG dựng endpoint nào. Khoảng trắng đầu/cuối được bỏ (trang lưu kiểm bản đã
// trim nhưng lưu nguyên chuỗi); khoảng trắng ở giữa thì không hợp lệ.

export type R2ConfigScope = 'media' | 'video'
export type R2ConfigField = 'account_id' | 'bucket'

const SETTINGS_PAGE: Record<R2ConfigScope, string> = {
  media: '/admin/settings/media-storage',
  video: '/admin/settings/media-portal',
}

/** Cấu hình R2 đã lưu không dùng được — không có yêu cầu mạng nào được gửi. */
export class R2ConfigInvalidError extends Error {
  readonly code = 'R2_CONFIG_INVALID'
  /** h3 dùng `statusCode`/`statusMessage` khi lỗi lọt tới một handler. */
  readonly statusCode = 400
  readonly statusMessage: string
  readonly field: R2ConfigField
  readonly scope: R2ConfigScope

  constructor(field: R2ConfigField, scope: R2ConfigScope) {
    const detail = field === 'account_id' ? R2_ACCOUNT_ID_INVALID_MESSAGE : R2_BUCKET_INVALID_MESSAGE
    const message = `Cấu hình R2 đã lưu không dùng được — ${detail} Hãy lưu lại ở ${SETTINGS_PAGE[scope]}.`
    super(message)
    this.name = 'R2ConfigInvalidError'
    this.statusMessage = message
    this.field = field
    this.scope = scope
  }
}

export function isR2ConfigInvalidError(err: unknown): err is R2ConfigInvalidError {
  return err instanceof R2ConfigInvalidError
}

/** Trường đầu tiên không dùng được (sau khi bỏ khoảng trắng đầu/cuối), hoặc `null`. */
export function r2ConfigProblem(config: Pick<R2Config, 'accountId' | 'bucket'>): R2ConfigField | null {
  if (!isCloudflareAccountId(String(config.accountId ?? '').trim())) return 'account_id'
  if (!isR2BucketName(String(config.bucket ?? '').trim())) return 'bucket'
  return null
}

// Một cấu hình hỏng gặp ở MỌI yêu cầu (mỗi segment HLS công khai là một lần) —
// log mỗi cặp phạm vi/trường tối đa một lần mỗi 10 phút, đủ để thấy, không ngập log.
const CONFIG_LOG_INTERVAL_MS = 10 * 60 * 1000
const lastConfigLogAt = new Map<string, number>()

function reportInvalidConfig(field: R2ConfigField, scope: R2ConfigScope): void {
  const key = `${scope}:${field}`
  const now = Date.now()
  const last = lastConfigLogAt.get(key)
  if (last !== undefined && now - last < CONFIG_LOG_INTERVAL_MS) return
  lastConfigLogAt.set(key, now)
  // Không ghi giá trị: nó là văn bản tuỳ ý trong CSDL, chỉ cần biết trường nào hỏng.
  logWarn({ event: 'r2.config_invalid', scope, field })
}

/**
 * Account id + bucket đã trim, sau khi kiểm. Ném `R2ConfigInvalidError` (và log
 * `r2.config_invalid`, có giới hạn tần suất) nếu không dùng được.
 */
export function assertUsableR2Config(
  config: Pick<R2Config, 'accountId' | 'bucket'>,
  scope: R2ConfigScope = 'media',
): { accountId: string, bucket: string } {
  const field = r2ConfigProblem(config)
  if (field) {
    reportInvalidConfig(field, scope)
    throw new R2ConfigInvalidError(field, scope)
  }
  return { accountId: config.accountId.trim(), bucket: config.bucket.trim() }
}

/** Client + tên bucket đã kiểm — mọi lệnh R2 dùng CẶP này, không dùng `config.bucket` thô. */
export interface R2Session {
  client: S3Client
  bucket: string
}

export function openR2(config: R2Config, scope: R2ConfigScope = 'media'): R2Session {
  const { accountId, bucket } = assertUsableR2Config(config, scope)
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  return { client, bucket }
}

export function createR2Client(config: R2Config, scope: R2ConfigScope = 'media'): S3Client {
  return openR2(config, scope).client
}

/**
 * Khoá R2 mà `uploadR2File` sẽ ghi cho `filename` tại thời điểm `now`. Tách ra để
 * lượt đồng bộ local→R2 kiểm được "khoá này đã thuộc hàng `media` KHÁC chưa" TRƯỚC
 * khi PUT ghi đè — hai hàng cùng tên tệp trong cùng tháng dùng chung một khoá.
 * Nơi gọi truyền CÙNG `now` cho cả hai lời gọi để ranh giới tháng không tách đôi.
 */
export function r2ObjectKeyFor(filename: string, now: Date = new Date()): string {
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${filename}`
}

export async function uploadR2File(
  fileBuffer: Buffer,
  filename: string,
  contentType: string,
  config: R2Config,
  now: Date = new Date(),
): Promise<{ url: string; storagePath: string }> {
  const { client, bucket } = openR2(config)
  const key = r2ObjectKeyFor(filename, now)

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  }))

  let cleanPublicUrl = config.publicUrl.trim().replace(/\/$/, '')
  // Cán bộ dán `cdn1.delify.vn` thiếu scheme → lưu thành `cdn1.delify.vn/2026/09/...`
  // rồi `new URL(url, origin).href` ở grid biến thành `http://localhost:3000/cdn1...`
  // (ca anh đang gặp ở /admin/media). Tự thêm https:// để không bao giờ lưu URL thiếu scheme.
  if (cleanPublicUrl && !/^https?:\/\//i.test(cleanPublicUrl)) cleanPublicUrl = `https://${cleanPublicUrl}`
  const url = `${cleanPublicUrl}/${key}`
  return { url, storagePath: key }
}

/**
 * Xoá một object. Lỗi R2 (mạng, quyền…) → `false` như trước. Riêng cấu hình đã
 * lưu không dùng được (`R2ConfigInvalidError`) thì NÉM: không có yêu cầu nào được
 * gửi nên object chắc chắn còn đó — nơi gọi (vd. `deleteMediaById`) phải dừng thay
 * vì xoá hàng CSDL như thể tệp đã đi.
 */
export async function deleteR2File(key: string, config: R2Config): Promise<boolean> {
  const { client, bucket } = openR2(config)
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }))
    return true
  } catch {
    return false
  }
}

/**
 * Kiểm tra object R2 có tồn tại không — dùng `HeadObjectCommand`. Trả `true/false`
 * thay vì throw. Bắt 404 (NoSuchKey / NotFound) → false, các lỗi khác → false +
 * log (không throw để caller không phải wrap try/catch).
 *
 * Self-heal và sync `to-r2` gọi trước khi xoá file local: nếu R2 không có object
 * mà vẫn xoá local → mất ảnh vĩnh viễn. Hàm này là chốt chặn đó.
 *
 * Ngoại lệ: cấu hình đã lưu không dùng được → NÉM `R2ConfigInvalidError`, không
 * trả `false`. "Không kiểm được" khác "không tồn tại": trả `false` thì quét
 * thumbnail báo mọi ảnh R2 là hỏng (và lượt "sửa" thay hết bằng ảnh mặc định),
 * self-heal coi mọi object là mất.
 */
export async function headR2Object(key: string, config: R2Config): Promise<boolean> {
  const { client, bucket } = openR2(config)
  try {
    await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    }))
    return true
  } catch (err: unknown) {
    // 404 / NoSuchKey → object không tồn tại → false (không log, flow bình thường).
    // Lỗi khác (network, auth, 5xx) → false + log để admin biết R2 có vấn đề.
    const msg = err instanceof Error ? err.message : String(err)
    const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
    if (httpStatus === 404 || msg.includes('NoSuchKey') || msg.includes('NotFound')) {
      return false
    }
    console.warn('[media-r2] headR2Object error:', msg)
    return false
  }
}

/**
 * Tải một object R2 về Buffer. Dùng cho sync R2 → local: đọc bytes file R2
 * (storagePath trong `media` khi provider='r2' chính là R2 key) rồi ghi vào
 * `public/uploads/YYYY/MM/filename` qua `uploadLocalFile`.
 *
 * `limits` (tuỳ chọn — đồng bộ không đặt, giữ nguyên hành vi cũ):
 *  - `maxBytes`: `ContentLength` khai vượt trần → từ chối trước khi đọc; thân
 *    không khai (hoặc khai sai) bị đếm TRONG LÚC đọc và cắt ở trần;
 *  - `timeoutMs`: hạn tổng cho cả yêu cầu lẫn lúc đọc thân.
 * Vượt trần / quá hạn → `R2ReadLimitError`.
 */
export interface R2ReadLimits {
  maxBytes?: number
  timeoutMs?: number
}

export class R2ReadLimitError extends Error {
  readonly reason: 'too_large' | 'timeout'
  constructor(reason: 'too_large' | 'timeout', key: string) {
    super(reason === 'too_large' ? `R2 object "${key}" vượt dung lượng cho phép.` : `Đọc R2 object "${key}" quá thời gian cho phép.`)
    this.name = 'R2ReadLimitError'
    this.reason = reason
  }
}

type BodyStream = AsyncIterable<Buffer | Uint8Array | string> & { destroy?: (error?: Error) => void }

export async function getR2Object(key: string, config: R2Config, limits: R2ReadLimits = {}): Promise<Buffer> {
  const { client, bucket } = openR2(config)
  const maxBytes = limits.maxBytes
  const controller = limits.timeoutMs !== undefined ? new AbortController() : null
  let body: BodyStream | null = null
  let timedOut = false
  const timer = controller
    ? setTimeout(() => {
        timedOut = true
        controller.abort()
        body?.destroy?.(new R2ReadLimitError('timeout', key))
      }, limits.timeoutMs)
    : null
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      controller ? { abortSignal: controller.signal } : undefined,
    )
    if (!response.Body) throw new Error(`R2 object "${key}" không có body.`)
    // @aws-sdk/client-s3 trả stream Node Readable — gom thành Buffer.
    body = response.Body as unknown as BodyStream
    if (maxBytes !== undefined && Number(response.ContentLength ?? 0) > maxBytes) {
      body.destroy?.()
      throw new R2ReadLimitError('too_large', key)
    }
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of body) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += piece.length
      if (maxBytes !== undefined && total > maxBytes) {
        body.destroy?.()
        throw new R2ReadLimitError('too_large', key)
      }
      chunks.push(piece)
    }
    if (timedOut) throw new R2ReadLimitError('timeout', key)
    return Buffer.concat(chunks)
  } catch (err: unknown) {
    if (timedOut && !(err instanceof R2ReadLimitError)) throw new R2ReadLimitError('timeout', key)
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Tổng số object + tổng bytes trong bucket R2. Phân trang ListObjectsV2 (mỗi
 * trang 1000 key) để chống bucket lớn — R2 trả tối đa 1000/trang.
 */
export async function getR2BucketSize(config: R2Config): Promise<{ count: number; totalBytes: number }> {
  const { client, bucket } = openR2(config)
  let count = 0
  let totalBytes = 0
  let continuationToken: string | undefined
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }))
    for (const obj of res.Contents ?? []) {
      count++
      totalBytes += Number(obj.Size ?? 0)
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)
  return { count, totalBytes }
}
