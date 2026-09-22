/**
 * Tải lên theo từng phần, có thể tiếp tục sau khi đứt kết nối.
 *
 * Một video 10 GB qua một đường truyền sẽ đứt. Câu hỏi không phải "có đứt không"
 * mà là "đứt rồi thì mất bao nhiêu": một lượt POST nguyên khối mất **toàn bộ**,
 * còn ở đây mất đúng phần đang bay. Đó là toàn bộ lý do dịch vụ này tồn tại.
 *
 * Bốn quyết định trong tệp này, mỗi cái trả lời một cách hỏng cụ thể:
 *
 *   • **Quyền sở hữu nằm TRONG câu truy vấn** (`WHERE upload_id = ? AND
 *     admin_user_id = ?`), không phải một phép so sau khi đọc hàng. Đọc rồi so
 *     là hai bước để quên một bước — và bước bị quên không có triệu chứng nào
 *     ngoài việc một cán bộ đọc được tệp của cán bộ khác. Hệ quả kèm theo, cũng
 *     là chủ đích: một mã không tồn tại và mã của người khác cho ra **cùng một**
 *     phản hồi, nên endpoint không tiết lộ lượt tải nào đang có.
 *
 *   • **Đường dẫn đĩa chỉ dựng từ mã do máy chủ sinh.** `upload_id` là UUID do
 *     `crypto.randomUUID()` tạo, và hình dạng của nó được kiểm **trước** khi có
 *     bất kỳ lượt chạm đĩa nào. Không có trường nào của request đi vào đường
 *     dẫn — kể cả tên tệp, thứ chỉ được lưu vào cột `filename` để hiển thị.
 *
 *   • **Gửi lại một phần đã nhận là thành công, không đổi trạng thái.** Một lượt
 *     mạng đứt ở chỗ "đã ghi xong nhưng chưa kịp trả lời" là chuyện thường, và
 *     cách duy nhất để client phân biệt nó với "chưa ghi" là gửi lại. Nếu gửi
 *     lại bị coi là lỗi thì mọi lần mạng chập chờn đều kết thúc bằng một lượt
 *     tải phải bắt đầu lại từ đầu.
 *
 *   • **Nội dung được kiểm bằng byte đầu, không bằng đuôi tệp.** `detectVideoMime`
 *     (Batch A) đọc magic byte; một tệp tên `phim.mp4` chứa thứ khác bị từ chối
 *     **trước** khi một hàng `media_items` được tạo. Phép kiểm chạy trên tệp đã
 *     ghép, không trên từng phần: thùng chứa chỉ nhìn thấy được khi các phần
 *     nằm cạnh nhau.
 *
 * Đây là **service**, không phải util: nó ghi hàng kèm dòng `activity_logs` trong
 * cùng một transaction (điều kiện 1), và có từ hai nơi gọi trở lên (điều kiện 3 —
 * endpoint quản trị ở Batch E, và lượt dọn lượt tải bỏ dở).
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'

import { and, eq, lt } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'

import { getDb, getPool, type Database } from '../utils/db'
import { activityLogs, mediaItems, mediaUploadSessions } from '../db/schema'
import { uniqueMediaSlug } from '../utils/unique-media-slug'
import { detectVideoMime, EXT_BY_VIDEO_MIME, UNSUPPORTED_VIDEO_MESSAGE, VIDEO_SNIFF_BYTES } from '../utils/video-mime'
import { logInfo, logWarn } from '../utils/logger'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { resolveMediaConfig, UPLOAD_DISABLED_MESSAGE, type MediaConfig } from '../utils/media-config'
import { processMediaItem } from './video-processing'

// ─── Kiểu và hằng số ─────────────────────────────────────────────────────────

export const UPLOAD_STATUSES = ['pending', 'assembling', 'completed', 'failed'] as const
export const COMPLETION_LEASE_MS = 10 * 60 * 1000
export type UploadStatus = typeof UPLOAD_STATUSES[number]

/** Câu trả lời cho nhánh từ chối, dùng chung cho cả bốn thao tác. */
export type UploadFailure = {
  ok: false
  /** Mã HTTP mà endpoint quản trị (Batch E) trả về — quyết định ở đây, không ở đó. */
  status: 400 | 404 | 409 | 413 | 415 | 503
  code:
    | 'not_found'
    | 'upload_disabled'
    | 'size_limit'
    | 'bad_index'
    | 'bad_chunk_size'
    | 'incomplete'
    | 'unsupported_video'
    | 'assemble_failed'
    | 'state'
  message: string
}

/**
 * Phản hồi cho một mã không tồn tại **và** cho mã của một cán bộ khác.
 *
 * Một hằng số, không phải hai chuỗi giống nhau viết ở hai nhánh: hai chuỗi chỉ
 * giống nhau cho tới lần sửa thứ nhất, và lần sửa đó sẽ là một thông báo có ích
 * cho nhánh này mà không cho nhánh kia — tức là một kênh dò mã lượt tải.
 */
const NOT_FOUND: UploadFailure = {
  ok: false,
  status: 404,
  code: 'not_found',
  message: 'Không tìm thấy lượt tải lên này.',
}

export type UploadSessionView = {
  uploadId: string
  filename: string
  declaredSize: number
  chunkSize: number
  totalChunks: number
  receivedParts: number[]
  status: UploadStatus
  errorMessage: string | null
  mediaItemId: number | null
}

// ─── Hàm thuần — kiểm được không cần MySQL, không cần đĩa ────────────────────

/**
 * Mã lượt tải do máy chủ sinh có đúng hình dạng UUID không.
 *
 * Kiểm **trước mọi lượt chạm đĩa**. `path.join(root, 'uploads', '../../etc')`
 * thoát khỏi thư mục làm việc, nên một chuỗi đi vào đường dẫn mà không qua phép
 * kiểm này là một lỗ hổng ghi tệp tuỳ ý — không phải một lỗi nhỏ. Hàm này là chốt
 * duy nhất, và nó không phụ thuộc việc truy vấn có tìm thấy hàng hay không: hàng
 * chỉ nên tồn tại cho một UUID hợp lệ, nhưng "nên" không phải một cơ chế.
 */
export function isValidUploadId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/**
 * Thư mục tạm của một lượt tải, dựng từ mã do máy chủ sinh.
 *
 * Ném ra với mã không hợp lệ thay vì trả về một đường dẫn đã được "làm sạch":
 * `path.normalize` trên `../../etc` cho ra `../../etc`, và một hàm trả về đường
 * dẫn nằm ngoài thư mục làm việc là một hàm mà nơi gọi phải nhớ kiểm lại. Ném ra
 * thì không có nơi gọi nào quên được.
 *
 * Lượt kiểm thứ hai (`resolved` phải nằm dưới `root`) là thừa về mặt logic khi
 * phép kiểm hình dạng đã đúng — và nó vẫn ở đây vì phép kiểm thứ nhất là một
 * regex có thể bị nới trong một lần sửa sau này, còn lượt kiểm này so trên **kết
 * quả thật** của `path.resolve`.
 */
export function resolveUploadDir(root: string, uploadId: unknown): string {
  if (!isValidUploadId(uploadId)) {
    throw new Error(`upload_id không hợp lệ: ${String(uploadId)}`)
  }
  const uploadsRoot = path.resolve(root, 'uploads')
  const resolved = path.resolve(uploadsRoot, uploadId)
  if (resolved !== path.join(uploadsRoot, uploadId) || !resolved.startsWith(uploadsRoot + path.sep)) {
    throw new Error(`upload_id thoát khỏi thư mục tải lên: ${String(uploadId)}`)
  }
  return resolved
}

/** Đường dẫn một phần đã nhận. Chỉ số là số nguyên đã kiểm, không phải chuỗi client gửi. */
export function resolvePartPath(root: string, uploadId: unknown, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`chỉ số phần không hợp lệ: ${String(index)}`)
  }
  return path.join(resolveUploadDir(root, uploadId), `${index}.part`)
}

/**
 * Số phần của một lượt tải, suy từ dung lượng khai báo.
 *
 * Chỉ số phần là 0-based và **phần cuối mang phần dư**, nên `declaredSize` chia
 * hết cho `chunkSize` vẫn cho ra đúng số phần (không có phần rỗng thứ N+1).
 */
export function declaredChunks(declaredSize: number, chunkSize: number): number {
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) return 0
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) return 0
  return Math.ceil(declaredSize / chunkSize)
}

/**
 * Khoảng độ dài hợp lệ của một phần.
 *
 * Phần **không phải cuối** phải dài đúng `chunkSize`: một phần ngắn ở giữa để lại
 * một lỗ trong tệp ghép, và tệp ghép vẫn "thành công" — FFmpeg đọc được tới chỗ
 * lỗ rồi dừng, hoặc tệ hơn, giải mã ra khung hình sai. Không có gì báo.
 *
 * Phần cuối được nới: `declaredSize` là con số client khai, và một client khai
 * thiếu vài byte ở phần cuối là chuyện bình thường. Nới ở đây chỉ ảnh hưởng độ
 * dài **thật** của tệp ghép, thứ được kiểm bằng magic byte ngay sau đó.
 */
export function partLengthRange(index: number, totalChunks: number, chunkSize: number): { min: number, max: number } {
  const isLast = index === totalChunks - 1
  if (isLast) return { min: 1, max: chunkSize }
  return { min: chunkSize, max: chunkSize }
}

/** Chỉ số phần có phải số nguyên không âm nằm trong khoảng đã khai. */
export function isValidChunkIndex(index: unknown, totalChunks: number): index is number {
  return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < totalChunks
}

/** Đã nhận đủ mọi phần chưa. */
export function isUploadComplete(receivedParts: readonly number[], totalChunks: number): boolean {
  return receivedParts.length >= totalChunks && missingIndexes(receivedParts, totalChunks).length === 0
}

/** Các chỉ số còn thiếu, tăng dần. Thứ tự tăng dần để thông báo đọc được. */
export function missingIndexes(receivedParts: readonly number[], totalChunks: number): number[] {
  const received = new Set(receivedParts.filter(index => Number.isSafeInteger(index) && index >= 0))
  const missing: number[] = []
  for (let index = 0; index < totalChunks; index++) {
    if (!received.has(index)) missing.push(index)
  }
  return missing
}

/**
 * Danh sách phần sau khi nhận thêm một chỉ số, đã sắp xếp và đã khử trùng.
 *
 * Sắp xếp vì JSON của cột `received_parts` là thứ người vận hành đọc khi soi một
 * lượt tải hỏng, và `[7, 0, 3]` đọc ra như một lỗi trong khi nó là kết quả đúng
 * của việc các phần đến không theo thứ tự.
 */
export function withReceivedPart(receivedParts: readonly number[], index: number): number[] {
  return [...new Set([...receivedParts, index])].sort((a, b) => a - b)
}

/**
 * Dung lượng đã nhận, tính từ danh sách chỉ số và độ dài thật của phần cuối.
 *
 * Không `stat` từng phần: một lượt tải 10 GB có hàng nghìn phần, và hàng nghìn
 * lượt `stat` cho mỗi request là biến một thao tác đĩa thành một thao tác đĩa
 * nhân N. Mọi phần không phải cuối đều đã bị buộc dài đúng `chunkSize` lúc ghi,
 * nên chỉ phần cuối cần con số thật.
 */
export function accumulatedBytes(
  receivedParts: readonly number[],
  totalChunks: number,
  chunkSize: number,
  lastPartLength: number | null,
): number {
  let total = 0
  for (const index of receivedParts) {
    if (!isValidChunkIndex(index, totalChunks)) continue
    total += index === totalChunks - 1 ? (lastPartLength ?? 0) : chunkSize
  }
  return total
}

/** Tiêu đề hiển thị suy từ tên tệp — bỏ đuôi, gọn khoảng trắng, có dự phòng. */
export function titleFromFilename(filename: unknown): string {
  const text = typeof filename === 'string' ? filename : ''
  const withoutExtension = text.replace(/\.[^./\\]{1,12}$/, '')
  const cleaned = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 500) || 'Video'
}

/** Tên tệp được lưu để hiển thị. Cắt theo cột `VARCHAR(255)`, không theo byte. */
export function safeDisplayFilename(filename: unknown): string {
  const text = typeof filename === 'string' ? filename : ''
  // Bỏ mọi thành phần đường dẫn: tên tệp client gửi có thể là `C:\...\phim.mp4`
  // hoặc `../../etc/passwd`. Giá trị này chỉ để hiển thị, nhưng một chuỗi mang
  // dấu gạch chéo đi vào một thông báo lỗi rồi vào một giao diện là một đường
  // dẫn trông như đường dẫn thật.
  const base = text.split(/[/\\]/).pop() ?? ''
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return cleaned.slice(0, 255) || 'video'
}

/** Hình dạng công khai của một hàng phiên — chỉ những trường giao diện cần. */
function toView(row: typeof mediaUploadSessions.$inferSelect): UploadSessionView {
  const status = (UPLOAD_STATUSES as readonly string[]).includes(row.status)
    ? row.status as UploadStatus
    : 'pending'
  return {
    uploadId: row.uploadId,
    filename: row.filename,
    declaredSize: Number(row.declaredSize),
    chunkSize: Number(row.chunkSize),
    totalChunks: Number(row.totalChunks),
    receivedParts: Array.isArray(row.receivedParts) ? row.receivedParts : [],
    status,
    errorMessage: row.errorMessage,
    mediaItemId: row.mediaItemId ?? null,
  }
}

// ─── Truy cập dữ liệu ────────────────────────────────────────────────────────

export type UploadDeps = {
  db?: Database
  pool?: Pool | null
  config?: MediaConfig
  statfs?: (directory: string) => Promise<{ bavail: number, bsize: number }>
  dispatchProcessing?: (mediaItemId: number) => Promise<unknown>
}

type UploadDatabase = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

async function admitDisk(config: MediaConfig, required: number, statfs = fs.statfs): Promise<UploadFailure | null> {
  try {
    await fs.mkdir(config.workdir, { recursive: true })
    const stats = await statfs(config.workdir)
    const free = Number(stats.bavail) * Number(stats.bsize)
    if (!Number.isFinite(free) || free < config.diskFloorBytes + required) {
      return { ok: false, status: 503, code: 'size_limit', message: 'Máy chủ không đủ dung lượng trống để nhận video.' }
    }
    return null
  } catch {
    return { ok: false, status: 503, code: 'size_limit', message: 'Không kiểm tra được dung lượng lưu trữ.' }
  }
}

function deps(options: UploadDeps) {
  return {
    db: options.db ?? getDb(),
    config: options.config ?? resolveMediaConfig(),
  }
}

/**
 * Đọc một phiên tải lên **theo quyền sở hữu**, trong câu truy vấn.
 *
 * Trả `null` cho cả hai trường hợp không tìm thấy và không phải chủ sở hữu, và
 * nơi gọi không phân biệt được chúng — đó là chủ đích (xem `NOT_FOUND`).
 */
async function findOwned(db: UploadDatabase, uploadId: string, adminUserId: number, lock = false) {
  const query = db
    .select()
    .from(mediaUploadSessions)
    .where(and(eq(mediaUploadSessions.uploadId, uploadId), eq(mediaUploadSessions.adminUserId, adminUserId)))
    .limit(1)
  const rows = await (lock ? query.for('update') : query)
  return rows[0] ?? null
}

// ─── 6.1 — Khởi tạo ──────────────────────────────────────────────────────────

export type InitUploadInput = {
  adminUserId: number
  filename: unknown
  declaredSize: unknown
}

export type InitUploadResult =
  | { ok: true, uploadId: string, chunkSize: number, totalChunks: number, declaredSize: number }
  | UploadFailure

/**
 * Mở một lượt tải lên mới.
 *
 * Trần dung lượng được kiểm **trước khi ghi bất cứ gì** (yêu cầu "Upload size
 * limit", nhánh khai báo): từ chối sau khi đã tạo hàng nghĩa là một hàng rác cho
 * mỗi lượt thử quá cỡ, và hàng rác đó trông y hệt một lượt tải đang dở.
 *
 * Cổng "máy chủ có nhận video không" được kiểm ở đây — tức ở **máy chủ**, không
 * chỉ ở giao diện. Một công tắc chỉ ẩn nút là một công tắc trang trí.
 */
export async function initUpload(input: InitUploadInput, options: UploadDeps = {}): Promise<InitUploadResult> {
  const { db, config } = deps(options)

  if (!config.uploadEnabled) {
    return { ok: false, status: 503, code: 'upload_disabled', message: UPLOAD_DISABLED_MESSAGE }
  }

  const declaredSize = Number(input.declaredSize)
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
    return {
      ok: false, status: 400, code: 'size_limit',
      message: 'Dung lượng khai báo không hợp lệ. Cần một số nguyên dương (byte).',
    }
  }
  if (declaredSize > config.maxUploadSize) {
    return {
      ok: false, status: 413, code: 'size_limit',
      message: `Tệp vượt giới hạn ${formatBytes(config.maxUploadSize)} của máy chủ này.`,
    }
  }

  const totalChunks = declaredChunks(declaredSize, config.chunkSize)
  if (totalChunks <= 0) {
    return { ok: false, status: 400, code: 'size_limit', message: 'Dung lượng khai báo quá nhỏ để chia phần.' }
  }

  const uploadId = randomUUID()
  const diskFailure = await admitDisk(config, declaredSize * 2, options.statfs as typeof fs.statfs | undefined)
  if (diskFailure) return diskFailure
  const dir = resolveUploadDir(config.workdir, uploadId)
  await fs.mkdir(dir, { recursive: true })

  try {
    await db.insert(mediaUploadSessions).values({
      uploadId,
      adminUserId: input.adminUserId,
      filename: safeDisplayFilename(input.filename),
      declaredSize,
      chunkSize: config.chunkSize,
      totalChunks,
      receivedParts: [],
      status: 'pending',
    })
  } catch (error) {
    // Hàng không ghi được thì thư mục vừa tạo là rác không ai dọn: lượt dọn đọc
    // bảng để biết dọn gì. Xoá ngay, và nuốt lỗi xoá — lỗi thật là lỗi ghi hàng.
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }

  logInfo({ event: 'media.upload_init', uploadId, adminUserId: input.adminUserId, declaredSize, totalChunks })
  return { ok: true, uploadId, chunkSize: config.chunkSize, totalChunks, declaredSize }
}

// ─── 6.1 — Nhận một phần ─────────────────────────────────────────────────────

export type ReceiveChunkInput = {
  adminUserId: number
  uploadId: unknown
  index: unknown
  body: Buffer
}

export type ReceiveChunkResult =
  | { ok: true, receivedParts: number[], totalChunks: number, duplicate: boolean }
  | UploadFailure

/**
 * Nhận một phần và ghi nó xuống đĩa.
 *
 * Thứ tự các bước là một phần của hợp đồng, không phải cách sắp cho dễ đọc:
 * quyền sở hữu → hình dạng mã → trạng thái phiên → chỉ số → độ dài → trần dung
 * lượng → ghi. Mỗi bước đứng trước bước sau vì nó **rẻ hơn**, nên một request
 * sai bị từ chối mà không chạm đĩa và không sửa hàng.
 */
export async function receiveChunk(input: ReceiveChunkInput, options: UploadDeps = {}): Promise<ReceiveChunkResult> {
  const { db, config } = deps(options)

  if (!isValidUploadId(input.uploadId)) return NOT_FOUND

  const uploadId = input.uploadId
  return db.transaction(async tx => {
  const row = await findOwned(tx, uploadId, input.adminUserId, true)
  if (!row) return NOT_FOUND

  const view = toView(row)
  if (view.status !== 'pending') {
    return {
      ok: false, status: 400, code: 'state',
      message: view.status === 'completed'
        ? 'Lượt tải lên này đã hoàn tất.'
        : 'Lượt tải lên này đã hỏng. Hãy bắt đầu lại.',
    }
  }

  if (!isValidChunkIndex(input.index, view.totalChunks)) {
    return {
      ok: false, status: 400, code: 'bad_index',
      message: `Chỉ số phần không hợp lệ. Nhận số nguyên từ 0 đến ${view.totalChunks - 1}.`,
    }
  }
  const index = input.index

  const expected = Math.min(view.chunkSize, view.declaredSize - index * view.chunkSize)
  const range = { min: expected, max: expected }
  if (input.body.length < range.min || input.body.length > range.max) {
    return {
      ok: false, status: 400, code: 'bad_chunk_size',
      message: range.min === range.max
        ? `Phần ${index} phải dài đúng ${formatBytes(range.max)}.`
        : `Phần ${index} phải dài từ 1 đến ${formatBytes(range.max)}.`,
    }
  }

  // Gửi lại một phần đã nhận: thành công, không đổi gì. Đây là nhánh làm cho một
  // lượt thử lại sau khi mạng đứt trở nên an toàn — không có nó thì client không
  // có cách nào phân biệt "đã ghi" với "chưa ghi".
  if (view.receivedParts.includes(index)) {
    await tx.update(mediaUploadSessions).set({ updatedAt: new Date() })
      .where(and(eq(mediaUploadSessions.uploadId, view.uploadId), eq(mediaUploadSessions.adminUserId, input.adminUserId)))
    return { ok: true, receivedParts: view.receivedParts, totalChunks: view.totalChunks, duplicate: true }
  }

  const lastPartLength = await readLastPartLength(config.workdir, view)
  const already = accumulatedBytes(view.receivedParts, view.totalChunks, view.chunkSize, lastPartLength)
  if (already + input.body.length > config.maxUploadSize) {
    // Nhánh "dung lượng tích luỹ vượt trần": dung lượng khai báo hợp lệ nhưng
    // những gì thực sự đến thì không. Lượt tải bị đánh dấu hỏng thay vì chỉ từ
    // chối phần này — client khai một đằng gửi một nẻo thì gửi lại cũng vậy.
    const message = `Dung lượng nhận được vượt giới hạn ${formatBytes(config.maxUploadSize)} của máy chủ này.`
    await tx
      .update(mediaUploadSessions)
      .set({ status: 'failed', errorMessage: message.slice(0, 512) })
      .where(and(eq(mediaUploadSessions.uploadId, view.uploadId), eq(mediaUploadSessions.adminUserId, input.adminUserId)))
    logWarn({ event: 'media.upload_over_limit', uploadId: view.uploadId, received: already + input.body.length })
    return { ok: false, status: 413, code: 'size_limit', message }
  }

  const diskFailure = await admitDisk(config, input.body.length, options.statfs as typeof fs.statfs | undefined)
  if (diskFailure) return diskFailure
  const target = resolvePartPath(config.workdir, view.uploadId, index)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temporary, 'wx')
    try { await handle.writeFile(input.body); await handle.sync() } finally { await handle.close() }
    await fs.rename(temporary, target)
    await syncDirectory(path.dirname(target))
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }

  const receivedParts = withReceivedPart(view.receivedParts, index)
  await tx
    .update(mediaUploadSessions)
    .set({ receivedParts, updatedAt: new Date() })
    .where(and(eq(mediaUploadSessions.uploadId, view.uploadId), eq(mediaUploadSessions.adminUserId, input.adminUserId)))

  return { ok: true, receivedParts, totalChunks: view.totalChunks, duplicate: false }
  })
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

/** Authorize ownership and bound the body using the stored session geometry before reading bytes. */
export async function chunkBodyLimit(input: Omit<ReceiveChunkInput, 'body'>, options: UploadDeps = {}) {
  const { db } = deps(options)
  if (!isValidUploadId(input.uploadId)) return NOT_FOUND
  const row = await findOwned(db, input.uploadId, input.adminUserId)
  if (!row) return NOT_FOUND
  if (row.status !== 'pending') return { ok: false as const, status: 409 as const, code: 'state' as const, message: 'Lượt tải lên không nhận thêm phần.' }
  if (!isValidChunkIndex(input.index, row.totalChunks)) return { ok: false as const, status: 400 as const, code: 'bad_index' as const, message: 'Chỉ số phần không hợp lệ.' }
  return { ok: true as const, bytes: Math.min(row.chunkSize, Number(row.declaredSize) - Number(input.index) * row.chunkSize) }
}

/**
 * Độ dài thật của phần cuối, nếu nó đã có trên đĩa.
 *
 * Một `stat`, và chỉ khi phần cuối đã được nhận. `stat` hỏng (tệp biến mất giữa
 * hai lượt) đọc thành `null` chứ không ném: con số này chỉ dùng để so trần dung
 * lượng, và để một lượt `stat` hỏng chặn cả lượt tải là đánh đổi sai.
 */
async function readLastPartLength(root: string, view: UploadSessionView): Promise<number | null> {
  const lastIndex = view.totalChunks - 1
  if (!view.receivedParts.includes(lastIndex)) return null
  try {
    const stat = await fs.stat(resolvePartPath(root, view.uploadId, lastIndex))
    return stat.size
  } catch {
    return null
  }
}

// ─── 6.1 — Trạng thái ────────────────────────────────────────────────────────

export type UploadStatusResult = { ok: true, session: UploadSessionView, missing: number[] } | UploadFailure

/**
 * Trạng thái một lượt tải, để client biết còn thiếu phần nào mà gửi tiếp.
 *
 * Đây là thao tác làm cho "tiếp tục sau khi đứt" trở thành khả thi: không có nó
 * thì client chỉ có một lựa chọn là bắt đầu lại từ đầu.
 */
export async function uploadStatus(
  input: { adminUserId: number, uploadId: unknown },
  options: UploadDeps = {},
): Promise<UploadStatusResult> {
  const { db } = deps(options)
  if (!isValidUploadId(input.uploadId)) return NOT_FOUND

  const row = await findOwned(db, input.uploadId, input.adminUserId)
  if (!row) return NOT_FOUND

  const session = toView(row)
  return { ok: true, session, missing: missingIndexes(session.receivedParts, session.totalChunks) }
}

// ─── 6.5 — Hoàn tất ──────────────────────────────────────────────────────────

export type CompleteUploadInput = {
  adminUserId: number
  uploadId: unknown
  /**
   * Nếu có, lượt hoàn tất này không tạo hàng `media_items` mới mà **cập nhật** hàng
   * hiện có — thay tệp gốc của video đó, giữ nguyên slug/tiêu đề/bình luận/danh mục.
   * Reset `processingStatus='pending'` + `resolutionsReady=[]` để pipeline chạy lại.
   */
  replaceMediaItemId?: number
}

export type CompleteUploadResult =
  | { ok: true, mediaItemId: number, slug: string, contentType: string }
  | UploadFailure

/**
 * Ghép các phần, kiểm nội dung, và tạo mục media.
 *
 * A short row-lock transaction reserves a renewable assembly claim. Large IO
 * then runs without holding a database connection. The final transaction fences
 * ownership, durably renames the original into a stable UUID root, and commits
 * media, audit and session identity together. Chunks survive IO/DB failures so a
 * retry can recover even after the original rename. Invalid video is terminal;
 * other failures remain retryable. Active overlapping completions receive 409.
 */
export async function completeUpload(input: CompleteUploadInput, options: UploadDeps = {}): Promise<CompleteUploadResult> {
  const { db, config } = deps(options)
  if (!isValidUploadId(input.uploadId)) return NOT_FOUND
  const uploadId = input.uploadId
  const claim = randomUUID()
  const reserved = await db.transaction(async tx => {
    const row = await findOwned(tx, uploadId, input.adminUserId, true)
    if (!row) return NOT_FOUND
    const view = toView(row)
    if (view.status === 'completed') return { ok: true as const, row }
    if (view.status === 'failed') return { ok: false as const, status: 400 as const, code: 'state' as const, message: 'Lượt tải lên đã hỏng.' }
    if (view.status === 'assembling' && row.completionHeartbeatAt && row.completionHeartbeatAt.getTime() > Date.now() - COMPLETION_LEASE_MS) {
      return { ok: false as const, status: 409 as const, code: 'state' as const, message: 'Video đang được ghép. Thử hoàn tất lại sau ít giây.' }
    }
    const missing = missingIndexes(view.receivedParts, view.totalChunks)
    if (missing.length) return { ok: false as const, status: 400 as const, code: 'incomplete' as const, message: `Còn thiếu ${missing.length} phần chưa nhận.` }
    const diskFailure = await admitDisk(config, view.declaredSize, options.statfs as typeof fs.statfs | undefined)
    if (diskFailure) return diskFailure
    await tx.update(mediaUploadSessions).set({ status: 'assembling', completionClaim: claim,
      completionHeartbeatAt: new Date(), updatedAt: new Date(), errorMessage: null,
    }).where(and(eq(mediaUploadSessions.uploadId, uploadId), eq(mediaUploadSessions.adminUserId, input.adminUserId)))
    return { ok: true as const, row }
  })
  if (!reserved.ok) return reserved
  const row = reserved.row
  const view = toView(row)
  if (view.status === 'completed') {
    if (!view.mediaItemId) return NOT_FOUND
    const [existing] = await db.select({ id: mediaItems.id, slug: mediaItems.slug }).from(mediaItems).where(eq(mediaItems.id, view.mediaItemId)).limit(1)
    return existing ? { ok: true, mediaItemId: existing.id, slug: existing.slug, contentType: row.contentType || 'video/mp4' } : NOT_FOUND
  }
  const owned = and(eq(mediaUploadSessions.uploadId, uploadId), eq(mediaUploadSessions.adminUserId, input.adminUserId), eq(mediaUploadSessions.completionClaim, claim))
  const controller = new AbortController()
  const heartbeat = setInterval(() => {
    void db.update(mediaUploadSessions).set({ completionHeartbeatAt: new Date(), updatedAt: new Date() }).where(owned)
      .then(([result]) => { if (!affectedRowsOrZero(result)) controller.abort() }).catch(() => controller.abort())
  }, 30_000)
  heartbeat.unref?.()
  const dir = resolveUploadDir(config.workdir, uploadId)
  const assembledPath = path.join(dir, `assembled-${claim}`)
  try {
    await assembleParts(config.workdir, view, assembledPath, controller.signal)
    const assembled = await fs.open(assembledPath, 'r')
    try {
      if ((await assembled.stat()).size !== view.declaredSize) throw new Error('Dung lượng thực tế không khớp khai báo.')
      await assembled.sync()
    } finally { await assembled.close() }
    const contentType = await sniffAssembledFile(assembledPath)
    if (!contentType) {
      await db.transaction(async tx => {
        const current = await findOwned(tx, uploadId, input.adminUserId, true)
        if (current?.completionClaim !== claim) return
        await tx.update(mediaUploadSessions).set({ status: 'failed', errorMessage: UNSUPPORTED_VIDEO_MESSAGE, completionClaim: null }).where(owned)
        await fs.rm(dir, { recursive: true, force: true })
      })
      return { ok: false, status: 415, code: 'unsupported_video', message: UNSUPPORTED_VIDEO_MESSAGE }
    }
    const title = titleFromFilename(view.filename)
    const extension = EXT_BY_VIDEO_MIME[contentType]
    const storagePath = `media/${uploadId}`
    const mediaDir = path.resolve(config.workdir, storagePath)
    const replaceId = input.replaceMediaItemId && Number.isFinite(input.replaceMediaItemId) && input.replaceMediaItemId > 0
      ? Math.floor(input.replaceMediaItemId) : null
    const created = await db.transaction(async tx => {
      const current = await findOwned(tx, uploadId, input.adminUserId, true)
      if (current?.completionClaim !== claim || current.status !== 'assembling' || controller.signal.aborted) throw new Error('Lượt ghép đã mất quyền sở hữu.')
      // No pending media row becomes visible before the original is durable.
      // A crash before commit leaves chunks intact for retry at this same UUID root.
      await fs.mkdir(mediaDir, { recursive: true })
      await fs.rename(assembledPath, path.join(mediaDir, `original${extension}`))
      await syncDirectory(mediaDir)
      await syncDirectory(path.dirname(mediaDir))
      // ── Nhánh thay tệp: cập nhật hàng cũ, không tạo hàng mới ──────────────
      // Giữ nguyên slug / tiêu đề / bình luận / danh mục / trạng thái xuất bản.
      // Chỉ reset pipeline: tệp gốc mới đã ghi đè, rendition cũ sẽ bị pipeline
      // ghi đè khi công bố. Audit `action: 'update'` với `operation: 'replace'`.
      if (replaceId !== null) {
        const [existing] = await tx.select({ id: mediaItems.id, slug: mediaItems.slug, source: mediaItems.source })
          .from(mediaItems).where(eq(mediaItems.id, replaceId)).limit(1).for('update')
        if (!existing) throw new Error('Mục media cần thay thế không tồn tại.')
        if (existing.source !== 'upload') throw new Error('Chỉ video tự lưu trữ mới có thể thay tệp.')
        // Xoá cây rendition cũ (nếu có) — pipeline sẽ tạo lại trong `generations/<claim>` mới.
        if (existing.slug) {
          const oldTree = path.resolve(config.workdir, `media/${existing.slug}`)
          await fs.rm(oldTree, { recursive: true, force: true }).catch(() => undefined)
        }
        await tx.update(mediaItems).set({
          storagePath, processingStatus: 'pending', processingError: null, processingAttempts: 0,
          processingNextAttemptAt: null, processingHeartbeatAt: null, claimedBy: null,
          resolutionsReady: [], durationSeconds: null, width: null, height: null,
        }).where(eq(mediaItems.id, replaceId))
        await tx.insert(activityLogs).values({ userId: input.adminUserId, action: 'update', resource: 'media_portal',
          resourceId: replaceId, meta: { operation: 'replace', source: 'upload', declaredSize: view.declaredSize, filename: view.filename } })
        await tx.update(mediaUploadSessions).set({ status: 'completed', mediaItemId: replaceId, contentType,
          completionClaim: null, completionHeartbeatAt: null, errorMessage: null, updatedAt: new Date() }).where(owned)
        return { mediaItemId: replaceId, slug: existing.slug }
      }
      // ── Nhánh tạo mới (mặc định) ──────────────────────────────────────────
      const slug = await uniqueMediaSlug(tx, title)
      const [inserted] = await tx.insert(mediaItems).values({ slug, title, source: 'upload', storagePath,
        status: 'draft', processingStatus: 'pending', createdBy: input.adminUserId })
      const mediaItemId = Number(inserted.insertId)
      if (!mediaItemId) throw new Error('media_items insert returned no id')
      await tx.insert(activityLogs).values({ userId: input.adminUserId, action: 'create', resource: 'media_portal',
        resourceId: mediaItemId, meta: { slug, source: 'upload', declaredSize: view.declaredSize } })
      await tx.update(mediaUploadSessions).set({ status: 'completed', mediaItemId, contentType,
        completionClaim: null, completionHeartbeatAt: null, errorMessage: null, updatedAt: new Date() }).where(owned)
      return { mediaItemId, slug }
    })
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    logInfo({ event: 'media.upload_completed', uploadId, ...created, contentType })
    const dispatch = options.dispatchProcessing ?? (mediaItemId => processMediaItem({ mediaItemId }, { db, config, pool: options.pool ?? db.$client }))
    void dispatch(created.mediaItemId).catch(err => logWarn({ event: 'media.transcode_failed', mediaItemId: created.mediaItemId, message: String(err) }))
    return { ok: true, ...created, contentType }
  } catch (error) {
    const message = `Không hoàn tất được video: ${error instanceof Error ? error.message : String(error)}`
    // Retain valid chunks on IO/DB failure, including a crash after source rename.
    await db.update(mediaUploadSessions).set({ status: 'pending', completionClaim: null, completionHeartbeatAt: null,
      errorMessage: message.slice(0, 512), updatedAt: new Date() }).where(owned).catch(() => undefined)
    return { ok: false, status: 503, code: 'assemble_failed', message }
  } finally {
    clearInterval(heartbeat)
    controller.abort()
    await fs.rm(assembledPath, { force: true }).catch(() => undefined)
  }
}

/** Ghép các phần theo đúng thứ tự chỉ số, ghi vào `destination`. */
async function assembleParts(root: string, view: UploadSessionView, destination: string, signal?: AbortSignal): Promise<void> {
  const order = [...view.receivedParts]
    .filter(index => isValidChunkIndex(index, view.totalChunks))
    .sort((a, b) => a - b)

  const output = createWriteStream(destination)
  try {
    for (const index of order) {
      // `{ end: false }` để mỗi phần nối vào cùng một tệp thay vì đóng nó lại.
      await pipeline(createReadStream(resolvePartPath(root, view.uploadId, index)), output, { end: false, signal })
    }
    await new Promise<void>((resolve, reject) => {
      output.end((error?: Error | null) => (error ? reject(error) : resolve()))
    })
  } catch (error) {
    output.destroy()
    throw error
  }
}

/**
 * Đọc **byte đầu** của tệp đã ghép và nhận diện thùng chứa.
 *
 * Không `readFile`: tệp ở đây nặng tới 10 GB, và nạp cả nó vào bộ nhớ để đọc 64
 * byte đầu là giết đúng máy chủ 1–2 GB mà cấu hình này nhắm tới.
 *
 * Trả `null` cho cả "không nhận ra" và "đọc hỏng" — nơi gọi xử lý hai trường hợp
 * giống nhau (từ chối, không tạo hàng), nên phân biệt chúng chỉ thêm một nhánh
 * không ai đi.
 */
async function sniffAssembledFile(filePath: string): Promise<ReturnType<typeof detectVideoMime>> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(VIDEO_SNIFF_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, VIDEO_SNIFF_BYTES, 0)
    return detectVideoMime(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** Đánh dấu một phiên là hỏng kèm lý do. Lượt ghi này tự nuốt lỗi của nó. */
async function failSession(db: Database, uploadId: string, adminUserId: number, message: string): Promise<void> {
  await db
    .update(mediaUploadSessions)
    .set({ status: 'failed', errorMessage: message.slice(0, 512) })
    .where(and(eq(mediaUploadSessions.uploadId, uploadId), eq(mediaUploadSessions.adminUserId, adminUserId)))
    .catch(() => undefined)
}

// ─── 6.6 — Dọn lượt tải bỏ dở ────────────────────────────────────────────────

export type HousekeepResult = { sessions: number, orphans: number }

/**
 * Xoá những lượt tải bỏ dở và thư mục tạm của chúng.
 *
 * Ngưỡng là **thời điểm sửa đổi**, không phải thời điểm tạo: một lượt tải 10 GB
 * qua đường truyền chậm mất vài giờ và mỗi phần nhận được đều đóng dấu lại
 * `updated_at` (cột có `onUpdateNow`), nên nó không bao giờ bị coi là bỏ dở trong
 * lúc đang chạy. Đo từ `created_at` thì một lượt tải đang chạy bình thường sẽ bị
 * xoá giữa chừng khi nó chậm hơn ngưỡng — mất đúng công việc mà tính năng tải
 * lên theo phần sinh ra để bảo vệ.
 *
 * Thư mục mồ côi (không còn hàng nào trỏ tới) cũng được dọn, theo `mtime` của
 * chính nó: một hàng bị xoá theo khoá ngoại `CASCADE` khi tài khoản cán bộ bị xoá
 * sẽ để lại thư mục mà không lượt dọn nào đọc bảng biết tới.
 */
export async function housekeepUploads(
  options: UploadDeps & { now?: Date, limit?: number, adminUserId?: number | null } = {},
): Promise<HousekeepResult> {
  const { db, config } = deps(options)
  const now = options.now ?? new Date()
  const limit = options.limit ?? 200
  const adminUserId = options.adminUserId ?? null
  const cutoff = new Date(now.getTime() - config.sessionInactivityHours * 60 * 60 * 1000)

  const stale = await db
    .select({
      uploadId: mediaUploadSessions.uploadId,
      adminUserId: mediaUploadSessions.adminUserId,
      status: mediaUploadSessions.status,
    })
    .from(mediaUploadSessions)
    .where(lt(mediaUploadSessions.updatedAt, cutoff))
    .limit(limit)

  let sessions = 0
  for (const row of stale) {
    const removed = await db.transaction(async tx => {
    const current = await findOwned(tx, row.uploadId, row.adminUserId, true)
    if (!current || !current.updatedAt || current.updatedAt >= cutoff) return false
    if (current.status === 'assembling' && current.completionHeartbeatAt
      && current.completionHeartbeatAt.getTime() > now.getTime() - COMPLETION_LEASE_MS) return false
    let dir: string
    try {
      dir = resolveUploadDir(config.workdir, row.uploadId)
    } catch {
      // Hàng có mã không đúng hình dạng UUID: không thể có thư mục hợp lệ nào
      // cho nó, nhưng hàng thì vẫn phải đi. Bỏ qua lượt chạm đĩa.
      dir = ''
    }
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    // Xoá hàng sau khi xoá thư mục: thư mục còn lại mà không hàng nào trỏ tới thì
    // lượt dọn sau vẫn vớt được nó (nhánh mồ côi bên dưới); hàng còn lại mà thư
    // mục đã mất thì không có gì để vớt và cũng không có gì để mất.
    const [result] = await tx
      .delete(mediaUploadSessions)
      .where(eq(mediaUploadSessions.uploadId, row.uploadId))
    const deleted = affectedRowsOrZero(result) > 0
    if (deleted) {
      // Audit từng phiên trong cùng transaction — atomic với lượt xoá. Guard
      // `media-portal-audit` đòi `tx.insert(activityLogs)` (không `db.insert`)
      // vì `db.insert` commit độc lập với lượt xoá. Mỗi phiên xoá là một transaction
      // riêng, nên mỗi phiên có một dòng audit riêng; không có "audit tổng" vì
      // không có một transaction nào bao bọc cả đống. Số mồ côi (orphans) chỉ xoá
      // file, không có row DB nên không có cặp để bọc — nó đã có `logInfo` ở dưới.
      try {
        await tx.insert(activityLogs).values({
          userId: adminUserId,
          action: 'housekeep_uploads',
          resource: 'media_portal',
          resourceId: null,
          meta: { cutoffHours: config.sessionInactivityHours },
        })
      } catch {
        // Audit hỏng không rollback lượt xoá — xoá đã thành công, audit là
        // bằng chứng thứ yếu. Nuốt lỗi để một dòng log hỏng không phục hồi hàng
        // đã xoá (rollback transaction sẽ trả lại hàng phiên).
      }
    }
    return deleted
    })
    if (removed) sessions += 1
  }

  const orphans = await removeOrphanUploadDirs(db, config, cutoff, limit)

  if (sessions > 0 || orphans > 0) {
    logInfo({ event: 'media.upload_housekeeping', sessions, orphans, cutoff: cutoff.toISOString() })
  }
  return { sessions, orphans }
}

/**
 * Xoá thư mục tạm không còn hàng phiên nào, cũ hơn ngưỡng.
 *
 * Lượt đọc bảng chỉ lấy mã của **mọi** phiên đang có — với một deployment bình
 * thường đó là vài hàng, nên một `SELECT upload_id` không giới hạn vẫn rẻ hơn
 * nhiều so với việc bỏ sót một thư mục 10 GB.
 */
async function removeOrphanUploadDirs(db: Database, config: MediaConfig, cutoff: Date, limit: number): Promise<number> {
  const uploadsRoot = path.resolve(config.workdir, 'uploads')
  let entries: string[]
  try {
    entries = await fs.readdir(uploadsRoot)
  } catch {
    return 0
  }

  const known = new Set(
    (await db.select({ uploadId: mediaUploadSessions.uploadId }).from(mediaUploadSessions)).map(row => row.uploadId),
  )

  let removed = 0
  for (const entry of entries.slice(0, limit)) {
    if (known.has(entry)) continue
    if (!isValidUploadId(entry)) continue
    const dir = path.join(uploadsRoot, entry)
    try {
      const stat = await fs.stat(dir)
      if (!stat.isDirectory()) continue
      // Thư mục vừa được sửa thì để yên: nó có thể thuộc một lượt tải mà hàng
      // chưa kịp ghi (init tạo thư mục trước, ghi hàng sau), và xoá nó là làm
      // hỏng đúng lượt tải đang mở.
      if (stat.mtimeMs >= cutoff.getTime()) continue
      await fs.rm(dir, { recursive: true, force: true })
      removed += 1
    } catch {
      continue
    }
  }
  return removed
}

/** Định dạng dung lượng cho thông báo. Mét, không nhị phân — cán bộ đọc "10 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

/** Pool dùng cho những nơi cần một kết nối thật (đường dọn chạy ngoài request). */
export function mediaPool(): Pool | null {
  return getPool()
}
