/**
 * Tải lên theo từng phần — HOÀN TẤT CÓ RÀO: giữ chỗ, ghép, kiểm byte đầu, tạo
 * (hoặc thay tệp) mục media cùng dòng nhật ký trong một transaction.
 *
 * Rào là cột `completion_claim` (mã giữ chỗ do lượt này sinh) cộng lease
 * `completion_heartbeat_at` (`COMPLETION_LEASE_MS`, nhịp tim 30 s). Mọi lượt ghi
 * sau khi giữ chỗ mang `completion_claim = <mã của mình>` trong WHERE; lượt nào
 * mất quyền (lease hết hạn, lượt khác giữ chỗ lại) thì không tạo mục và không
 * ghi đè hàng của người giữ chỗ mới. Nhịp tim không cập nhật được hàng nào
 * (`affectedRowsOrZero` = 0) thì huỷ lượt ghép đang chạy.
 *
 * Tệp này import cửa vào `video-processing` (đẩy xử lý sau commit, dừng lượt
 * chuyển mã của tệp bị thay). Vòng `video-processing → chunked-upload` có từ
 * trước đã được cắt (`video-disk-guard.ts` nay lấy `formatBytes` từ
 * `chunked-upload-core.ts`), nhưng vẫn chỉ dùng các tên đó BÊN TRONG thân hàm,
 * không ở mức module — nếu một vòng như vậy quay lại thì nó vẫn vô hại.
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'

import { and, eq } from 'drizzle-orm'

import { activityLogs, mediaItems, mediaUploadSessions } from '../db/schema'
import { uniqueMediaSlug } from '../utils/unique-media-slug'
import { uniqueShortMediaId } from '../utils/short-media-id'
import { detectVideoMime, EXT_BY_VIDEO_MIME, UNSUPPORTED_VIDEO_MESSAGE, VIDEO_SNIFF_BYTES } from '../utils/video-mime'
import { logInfo, logWarn } from '../utils/logger'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { abortProcessingClaim, processMediaItem } from './video-processing'
import { enqueueReplacedAssetCleanup } from './media-asset-cleanup'
import {
  admitDisk,
  COMPLETION_LEASE_MS,
  deps,
  findOwned,
  isValidChunkIndex,
  isValidUploadId,
  missingIndexes,
  NOT_FOUND,
  resolvePartPath,
  resolveUploadDir,
  syncDirectory,
  titleFromFilename,
  toView,
  type UploadDeps,
  type UploadFailure,
  type UploadSessionView,
} from './chunked-upload-core'

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
  | { ok: true, mediaItemId: number, slug: string, shortId: string, contentType: string }
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
    const [existing] = await db.select({ id: mediaItems.id, slug: mediaItems.slug, shortId: mediaItems.shortId }).from(mediaItems).where(eq(mediaItems.id, view.mediaItemId)).limit(1)
    return existing ? { ok: true, mediaItemId: existing.id, slug: existing.slug, shortId: existing.shortId, contentType: row.contentType || 'video/mp4' } : NOT_FOUND
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
    const { replacedClaim, ...created } = await db.transaction(async tx => {
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
        const [existing] = await tx.select({ id: mediaItems.id, slug: mediaItems.slug, shortId: mediaItems.shortId, source: mediaItems.source,
          storagePath: mediaItems.storagePath, storageProvider: mediaItems.storageProvider, claimedBy: mediaItems.claimedBy })
          .from(mediaItems).where(eq(mediaItems.id, replaceId)).limit(1).for('update')
        if (!existing) throw new Error('Mục media cần thay thế không tồn tại.')
        if (existing.source !== 'upload') throw new Error('Chỉ video tự lưu trữ mới có thể thay tệp.')
        // Cây tài sản CŨ (gốc `media/<uploadId cũ>` theo `storagePath`, cả bản local
        // lẫn bản R2) được hẹn dọn qua outbox `media_asset_cleanup` trong CHÍNH
        // transaction này — cùng cơ chế `deleteMediaItem`. Không xoá gì trước commit:
        // rollback thì cây cũ vẫn là cây đang phục vụ. Trước đây đoạn này `rm`
        // `media/<slug>` (sai thư mục — tệp nằm ở `media/<uploadId>`), bỏ qua R2, và
        // chạy trước commit → mỗi lượt thay để rò nguyên cây cũ.
        await enqueueReplacedAssetCleanup(tx, existing, storagePath)
        await tx.update(mediaItems).set({
          // Tệp gốc mới nằm trên đĩa; pipeline đặt lại `r2` khi đồng bộ xong.
          storageProvider: 'local',
          storagePath, processingStatus: 'pending', processingError: null, processingAttempts: 0,
          processingNextAttemptAt: null, processingHeartbeatAt: null, claimedBy: null,
          resolutionsReady: [], durationSeconds: null, width: null, height: null,
        }).where(eq(mediaItems.id, replaceId))
        await tx.insert(activityLogs).values({ userId: input.adminUserId, action: 'update', resource: 'media_portal',
          resourceId: replaceId, meta: { operation: 'replace', source: 'upload', declaredSize: view.declaredSize, filename: view.filename } })
        await tx.update(mediaUploadSessions).set({ status: 'completed', mediaItemId: replaceId, contentType,
          completionClaim: null, completionHeartbeatAt: null, errorMessage: null, updatedAt: new Date() }).where(owned)
        return { mediaItemId: replaceId, slug: existing.slug, shortId: existing.shortId, replacedClaim: existing.claimedBy }
      }
      // ── Nhánh tạo mới (mặc định) ──────────────────────────────────────────
      const slug = await uniqueMediaSlug(tx, title)
      const shortId = await uniqueShortMediaId(tx)
      const [inserted] = await tx.insert(mediaItems).values({ slug, shortId, title, source: 'upload', storagePath,
        status: 'draft', processingStatus: 'pending', createdBy: input.adminUserId })
      const mediaItemId = Number(inserted.insertId)
      if (!mediaItemId) throw new Error('media_items insert returned no id')
      await tx.insert(activityLogs).values({ userId: input.adminUserId, action: 'create', resource: 'media_portal',
        resourceId: mediaItemId, meta: { slug, shortId, source: 'upload', declaredSize: view.declaredSize } })
      await tx.update(mediaUploadSessions).set({ status: 'completed', mediaItemId, contentType,
        completionClaim: null, completionHeartbeatAt: null, errorMessage: null, updatedAt: new Date() }).where(owned)
      return { mediaItemId, slug, shortId, replacedClaim: null }
    })
    // Lượt chuyển mã của tệp CŨ (nếu đang chạy) phải dừng trước khi worker dọn cây
    // cũ — sau commit, cùng thứ tự `deleteMediaItem`.
    abortProcessingClaim(replacedClaim)
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
