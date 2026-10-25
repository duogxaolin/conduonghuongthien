/**
 * Tải lên theo từng phần — LÕI dùng chung của ba tệp `chunked-upload-*`.
 *
 * Một video 10 GB qua một đường truyền sẽ đứt. Câu hỏi không phải "có đứt không"
 * mà là "đứt rồi thì mất bao nhiêu": một lượt POST nguyên khối mất **toàn bộ**,
 * còn ở đây mất đúng phần đang bay. Đó là toàn bộ lý do dịch vụ này tồn tại.
 *
 * Bốn quyết định của dịch vụ, mỗi cái trả lời một cách hỏng cụ thể:
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
 * Tệp này là **lá** của nhóm: không import `video-processing` hay
 * `media-asset-cleanup`. Nhờ vậy `video-disk-guard.ts` lấy `formatBytes` từ đây
 * mà không sinh vòng import nào giữa nhóm `video-*` và nhóm `chunked-upload*`.
 *
 * Một số tên ở đây (`NOT_FOUND`, `toView`, `deps`, `admitDisk`, `findOwned`,
 * `syncDirectory`, `UploadDatabase`) được `export` chỉ để ba tệp anh em dùng
 * chung — barrel `chunked-upload.ts` **không** xuất lại chúng. Ngoài nhóm
 * `chunked-upload*`, chỉ `video-disk-guard.ts` import thẳng tệp này, và chỉ lấy
 * `formatBytes` (`tests/service-split-boundaries.test.ts`).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { and, eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'

import { getDb, getPool, type Database } from '../utils/db'
import { mediaUploadSessions } from '../db/schema'
import { resolveMediaConfig, type MediaConfig } from '../utils/media-config'

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
 *
 * Vì thế nó sống ở ĐÚNG MỘT tệp (tệp này) và ba tệp còn lại import nó — tách
 * dịch vụ ra nhiều tệp không được sinh thêm bản sao thứ hai.
 */
export const NOT_FOUND: UploadFailure = {
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
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return cleaned.slice(0, 255) || 'video'
}

/** Hình dạng công khai của một hàng phiên — chỉ những trường giao diện cần. */
export function toView(row: typeof mediaUploadSessions.$inferSelect): UploadSessionView {
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

// ─── Truy cập dữ liệu ────────────────────────────────────────────────────────

export type UploadDeps = {
  db?: Database
  pool?: Pool | null
  config?: MediaConfig
  statfs?: (directory: string) => Promise<{ bavail: number, bsize: number }>
  dispatchProcessing?: (mediaItemId: number) => Promise<unknown>
}

export type UploadDatabase = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

export async function admitDisk(config: MediaConfig, required: number, statfs = fs.statfs): Promise<UploadFailure | null> {
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

export function deps(options: UploadDeps) {
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
export async function findOwned(db: UploadDatabase, uploadId: string, adminUserId: number, lock = false) {
  const query = db
    .select()
    .from(mediaUploadSessions)
    .where(and(eq(mediaUploadSessions.uploadId, uploadId), eq(mediaUploadSessions.adminUserId, adminUserId)))
    .limit(1)
  const rows = await (lock ? query.for('update') : query)
  return rows[0] ?? null
}

/** `fsync` một thư mục để lượt `rename` vừa làm bền qua mất điện. */
export async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

/** Pool dùng cho những nơi cần một kết nối thật (đường dọn chạy ngoài request). */
export function mediaPool(): Pool | null {
  return getPool()
}
