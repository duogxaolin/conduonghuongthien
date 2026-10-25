/**
 * Một lượt xử lý video: hợp đồng vào/ra, danh tính và sổ lượt đang chạy, lịch
 * thử lại, cách đánh dấu hỏng, và chỗ tìm tệp gốc.
 *
 * Tách từ `video-processing.ts` (wave2 5.4). Các giai đoạn của lượt chạy nằm ở
 * `video-transcode-pipeline.ts`; tệp này giữ những gì đi kèm MỘT lượt mà không
 * phải là một giai đoạn.
 *
 * **Tệp này là chỗ duy nhất giữ sổ lượt đang chạy:** `bootToken` và
 * `activeClaims`. Đường ống ghi vào sổ qua `trackProcessingClaim` /
 * `forgetProcessingClaim`; reaper, `chunked-upload` và `media-portal` hủy qua
 * `abortProcessingClaim` / `stopMediaProcessingJobs`. Sổ không bao giờ được xuất
 * ra ngoài — hai bản sổ là hai tiến trình không thấy nhau.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Pool } from 'mysql2/promise'
import { and, eq } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { mediaItems } from '../db/schema'
import { resolveMediaConfig, type MediaConfig } from '../utils/media-config'
import { detectVideoMime, VIDEO_SNIFF_BYTES } from '../utils/video-mime'
import { defaultProcessRunner, type ProcessFailureCode, type ProcessRunner } from './video-process-runner'
import type { StatfsFn } from './video-disk-guard'

/** Cột `processing_error` là VARCHAR(512) — MySQL ở chế độ strict **từ chối** giá trị dài hơn. */
export const PROCESSING_ERROR_LIMIT = 512

// ─── Hợp đồng của một lượt ───────────────────────────────────────────────────

export type ProcessingDeps = {
  db?: Database
  pool?: Pool | null
  config?: MediaConfig
  /** Chạy tiến trình ngoài. Có tham số để test ghim được thứ tự nhả-kết-nối-trước-khi-spawn. */
  run?: ProcessRunner
  statfs?: StatfsFn
  /**
   * Chu kỳ nhịp tim. Mặc định lấy từ `config.processingHeartbeatSeconds`.
   *
   * Là tham số vì nhịp thật là **năm phút**, và một test không thể chờ năm phút
   * để khẳng định nhịp tim lấy một kết nối rồi trả lại ngay. Cùng lối với `now`
   * của `housekeepUploads`.
   */
  heartbeatMs?: number
  /**
   * Chu kỳ phép kiểm đĩa. Mặc định một phút.
   *
   * Cùng lý do như `heartbeatMs`: một phút là đúng cho production và không kiểm
   * được trong một test — mà nhánh "đĩa vơi dần **trong lúc** chuyển mã" là nhánh
   * duy nhất phân biệt một phép kiểm chạy nền với một phép kiểm chạy một lần ở
   * đầu công việc.
   */
  diskCheckIntervalMs?: number
}

/**
 * `renditions` (tuỳ chọn): danh sách tên bản cán bộ chọn ở nút "Chuyển mã" (vd
 * `['360p','720p']`). Vắng = pipeline tự chọn theo chiều cao nguồn qua
 * `selectRenditions(probe.height)`.
 *
 * Giá trị đã được endpoint kiểm tra: chỉ tên trong `RENDITIONS` mới tới đây, và
 * đã loại trùng. Service **vẫn kiểm lại** — defense-in-depth: một lời gọi trực
 * tiếp (test, script) không đi qua endpoint, nên tin giá trị này là sai.
 */
export type ProcessInput = {
  mediaItemId: number
  renditions?: string[]
}

export type ProcessResult =
  | { ok: true, slug: string, renditions: string[] }
  | { ok: false, code: ProcessFailureCode, message: string }

export function deps(options: ProcessingDeps) {
  return {
    db: options.db ?? getDb(),
    config: options.config ?? resolveMediaConfig(),
    run: options.run ?? defaultProcessRunner,
  }
}

// ─── Danh tính và sổ lượt đang chạy ──────────────────────────────────────────

/** Boot and attempt tokens prevent PID reuse and duplicate job ownership. */
const bootToken = randomUUID().slice(0, 8)
const activeClaims = new Map<string, AbortController>()

export function processingClaim(_hostname: string = os.hostname(), _pid: number = process.pid): string {
  return `${bootToken}:${randomUUID()}`
}

/** Ghi một lượt vừa nhận việc vào sổ — chỉ đường ống gọi, ngay sau khi nhận việc. */
export function trackProcessingClaim(claim: string, controller: AbortController): void {
  activeClaims.set(claim, controller)
}

/** Xoá một lượt khỏi sổ — chỉ đường ống gọi, ở khối `finally` của lượt đó. */
export function forgetProcessingClaim(claim: string): void {
  activeClaims.delete(claim)
}

export function abortProcessingClaim(claim: string | null | undefined): void {
  if (claim) activeClaims.get(claim)?.abort()
}

export function stopMediaProcessingJobs(): void {
  for (const controller of activeClaims.values()) controller.abort()
}

export function retryAt(attempts: number, now = new Date()): Date {
  return new Date(now.getTime() + Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1)) * 1000)
}

/** Stable asset root survives generations; new uploads may use a UUID instead of the slug. */
export function mediaAssetRoot(item: { storagePath?: string | null, slug: string }): string {
  const stored = item.storagePath || `media/${item.slug}`
  const root = stored.split('/generations/')[0]!
  if (!/^media\/[a-zA-Z0-9_-]+$/.test(root)) throw new Error('Invalid media asset root')
  return root
}

/**
 * Whether this exact attempt is running in this server. This diagnostic helper
 * never extends a database lease; only the worker heartbeat does that.
 */
export function isProcessAlive(claim: string | null | undefined, _hostname: string = os.hostname()): boolean {
  return typeof claim === 'string' && activeClaims.has(claim)
}

// ─── Kết thúc một lượt hỏng ──────────────────────────────────────────────────

/**
 * Đánh dấu hỏng kèm lý do — và **giữ nguyên** `resolutions_ready`.
 *
 * Mục hỏng thì không phát được (`isPlayable` đọc `processing_status`), nên mảng
 * này không còn là thứ mở cửa cho trình phát. Nó được giữ vì một lý do khác: nó
 * là **bằng chứng về việc đã làm được tới đâu**, và là thứ duy nhất cho biết lượt
 * chạy lại có thể bỏ qua những bản đã cắt xong. Xoá nó đi thì một lượt hỏng ở bản
 * thứ ba trông y hệt một lượt hỏng ở giây đầu tiên, và cả hai đều dẫn tới cùng
 * một hành động: chạy lại từ đầu.
 */
export async function markProcessingFailed(db: Database, mediaItemId: number, claim: string, reason: string,
  attempts: number, maximum: number, permanent: boolean): Promise<void> {
  await db
    .update(mediaItems)
    .set({
      processingStatus: permanent || attempts >= maximum ? 'failed' : 'pending',
      processingNextAttemptAt: permanent || attempts >= maximum ? null : retryAt(attempts),
      processingError: reason.slice(0, PROCESSING_ERROR_LIMIT),
      claimedBy: null,
      processingRendition: null,
      processingPercent: null,
      processingPhase: null,
    })
    .where(and(eq(mediaItems.id, mediaItemId), eq(mediaItems.claimedBy, claim)))
    .catch(() => undefined)
}

// ─── Tệp gốc ─────────────────────────────────────────────────────────────────

/** Tệp gốc do `completeUpload` chuyển vào: `original.<đuôi suy từ nội dung>`. */
export async function locateOriginal(published: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fs.readdir(published)
  } catch {
    return null
  }
  const found = entries.find(entry => entry.startsWith('original.'))
  return found ? path.join(published, found) : null
}

/** Đọc 64 byte đầu. Không `readFile`: tệp ở đây nặng tới 10 GB. */
export async function sniffFile(filePath: string): Promise<ReturnType<typeof detectVideoMime>> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(VIDEO_SNIFF_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, VIDEO_SNIFF_BYTES, 0)
    return detectVideoMime(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close().catch(() => undefined)
  }
}
