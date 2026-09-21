/** Durable, retrying cleanup of a deleted upload's asset tree — local hoặc R2. */
import fs from 'node:fs/promises'
import path from 'node:path'

import { and, asc, eq, isNull, lte, or } from 'drizzle-orm'

import { mediaAssetCleanup, mediaItems } from '../db/schema'
import { getDb, type Database } from '../utils/db'
import { resolveMediaConfig, type MediaConfig } from '../utils/media-config'
import { logInfo, logWarn } from '../utils/logger'
import { mediaAssetRoot } from './video-processing'
import { deleteR2Tree } from './video-r2-sync'

export const MEDIA_CLEANUP_BATCH_LIMIT = 50

export function cleanupRetryAt(attempts: number, now = new Date()): Date {
  return new Date(now.getTime() + Math.min(24 * 60 * 60, 30 * 2 ** Math.max(0, attempts - 1)) * 1000)
}

export async function processMediaAssetCleanup(options: {
  db?: Database
  config?: MediaConfig
  now?: Date
  limit?: number
} = {}): Promise<{ removed: number, retried: number, protected: number }> {
  const db = options.db ?? getDb()
  const config = options.config ?? resolveMediaConfig()
  const now = options.now ?? new Date()
  const tasks = await db.select().from(mediaAssetCleanup)
    .where(or(isNull(mediaAssetCleanup.nextAttemptAt), lte(mediaAssetCleanup.nextAttemptAt, now)))
    .orderBy(asc(mediaAssetCleanup.createdAt)).limit(options.limit ?? MEDIA_CLEANUP_BATCH_LIMIT)

  let removed = 0
  let retried = 0
  let protectedRoots = 0

  // Danh sách mục media nguồn `upload` **không phụ thuộc vào `task` nào** — cùng
  // kết quả mỗi vòng lặp — nên hoist ra ngoài. Trong loop thì đây là N truy vấn
  // trả về đúng một tập, và một mục media mới tạo giữa hai vòng lặp liền nhau
  // là một đường race hẹp mà guard `startsWith(mediaRoot)` đã lo: nếu mục mới
  // trỏ đúng root đang dọn, vòng sau (với truy vấn đã làm mới) vẫn bảo vệ nó.
  // Nguồn: remind CLAUDE.md "không tự ép kiểu kết quả truy vấn" + nguyên tắc
  // không lặp truy vấn độc lập trong loop.
  const uploadCandidates = await db.select({ storagePath: mediaItems.storagePath, slug: mediaItems.slug })
    .from(mediaItems).where(eq(mediaItems.source, 'upload'))
  const protectedRootsSet = new Set(
    uploadCandidates.map(item => {
      try { return mediaAssetRoot(item) } catch { return null }
    }).filter((r): r is string => r !== null),
  )

  for (const task of tasks) {
    // Do not rely on root uniqueness alone. A manually repaired or newly-created
    // item may point at this root; re-checking protects it before every rm.
    if (protectedRootsSet.has(task.assetRoot)) {
      await db.delete(mediaAssetCleanup).where(eq(mediaAssetCleanup.id, task.id))
      protectedRoots += 1
      continue
    }

    try {
      // R2 cleanup: `assetRoot` là R2 key prefix (không phải filesystem path).
      // Xoá toàn bộ object có prefix qua `deleteR2Tree`. Không kiểm
      // `startsWith(mediaRoot)` vì không có filesystem — key prefix đã là một
      // chuỗi do `mediaAssetRoot` dựng, không chứa `..`.
      if (task.storageProvider === 'r2') {
        const r2 = config.videoStorage.provider === 'r2' ? config.videoStorage.r2 : undefined
        if (!r2) {
          // R2 đã tắt/sai sau khi task tạo — không thể xoá. Giữ task để thử lại
          // khi R2 được cấu hình lại. Báo lỗi rõ thay vì lặng lẽ bỏ qua.
          throw new Error('R2 không khả dụng để dọn tệp — kiểm cấu hình R2 video.')
        }
        await deleteR2Tree(task.assetRoot, r2)
        await db.delete(mediaAssetCleanup).where(eq(mediaAssetCleanup.id, task.id))
        removed += 1
        continue
      }

      const root = path.resolve(config.workdir, task.assetRoot)
      const mediaRoot = path.resolve(config.workdir, 'media')
      if (!root.startsWith(`${mediaRoot}${path.sep}`)) throw new Error('Đường dẫn dọn dẹp không hợp lệ.')
      await fs.rm(root, { recursive: true, force: true })
      await db.delete(mediaAssetCleanup).where(eq(mediaAssetCleanup.id, task.id))
      removed += 1
    } catch (error) {
      const attempts = Number(task.attempts ?? 0) + 1
      const message = error instanceof Error ? error.message.slice(0, 512) : String(error).slice(0, 512)
      await db.update(mediaAssetCleanup).set({ attempts, lastError: message, nextAttemptAt: cleanupRetryAt(attempts, now) })
        .where(eq(mediaAssetCleanup.id, task.id))
      retried += 1
      logWarn({ event: 'media.asset_cleanup_failed', assetRoot: task.assetRoot, attempts, message })
    }
  }
  if (removed || retried || protectedRoots) logInfo({ event: 'media.asset_cleanup_pass', removed, retried, protected: protectedRoots })
  return { removed, retried, protected: protectedRoots }
}
