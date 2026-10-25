/**
 * Tải lên theo từng phần — VÒNG ĐỜI PHIÊN: mở, hỏi trạng thái, dọn khi bỏ dở.
 *
 * Ba thao tác này cùng một trục: một hàng `media_upload_sessions` và thư mục tạm
 * `uploads/<uploadId>` của nó sinh ra ở `initUpload`, được đọc ở `uploadStatus`
 * để client biết gửi tiếp phần nào, và bị xoá ở `housekeepUploads` khi lượt tải
 * bị bỏ dở. Nhận phần ở `chunked-upload-receipt.ts`; ghép và tạo mục ở
 * `chunked-upload-completion.ts`; quyết định chung ở `chunked-upload-core.ts`.
 *
 * Lượt dọn ghi một dòng nhật ký cho mỗi phiên bị xoá, trong cùng transaction với
 * lượt xoá (guard `media-portal-audit` + `reader-audit-atomicity` canh tệp này).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { eq, lt } from 'drizzle-orm'

import type { Database } from '../utils/db'
import { activityLogs, mediaUploadSessions } from '../db/schema'
import { logInfo } from '../utils/logger'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { UPLOAD_DISABLED_MESSAGE, type MediaConfig } from '../utils/media-config'
import {
  admitDisk,
  COMPLETION_LEASE_MS,
  declaredChunks,
  deps,
  findOwned,
  formatBytes,
  isValidUploadId,
  missingIndexes,
  NOT_FOUND,
  resolveUploadDir,
  safeDisplayFilename,
  toView,
  type UploadDeps,
  type UploadFailure,
  type UploadSessionView,
} from './chunked-upload-core'

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
