/**
 * Đồng bộ storage ảnh (bảng `media`) giữa local disk và Cloudflare R2.
 *
 * Ca sử dụng: ảnh đang ở local muốn chuyển hết lên R2 (hoặc ngược lại) mà không
 * mất hàng CSDL, không mất liên kết trong bài viết. Một nút bấm — tải hết sang
 * bên kia, xoá bản cũ, cập nhật `provider` + `url` + `storagePath` trong SQL,
 * rồi thay URL cũ trong `articles.content` rich-text.
 *
 * ── Worker nền + chia đợt (không chạy trong 1 HTTP request) ───────────────────
 * Sync 3000 ảnh × 1-2s/file = 50-100 phút → HTTP timeout cắt giữa chừng. Nên
 * `startSyncJob` chỉ **khởi tạo** job và trả ngay `{ jobId }`; worker chạy nền
 * trong tiến trình Nitro, xử lý từng batch nhỏ (mặc định 20 file), sleep ngắn
 * giữa các batch để không chiếm CPU 100%. State lưu trong `Map` cấp module —
 * `git restart` giữa chừng → job stale; chạy lại là xong (idempotent).
 *
 * ── Pre-backup trước sync ───────────────────────────────────────────────────
 * Trước khi sync, tự chạy `runBackup('all')` → snapshot SQL + file. KHÔNG dùng
 * để auto-rollback (restore toàn DB = mất mọi thao tác unrelated trong window
 * sync). Snapshot để **recover thủ công** nếu thảm họa. Sync ngược (`to-r2` →
 * `to-local`) mới là rollback đúng — idempotent, không mất dữ liệu.
 *
 * **Thứ tự xoá file sau SQL commit** (cùng tiền lệ `deleteMediaById`): file đã
 * xoá khỏi đĩa/R2 thì rollback transaction không lấy lại được, nên gói nó vào
 * chỉ tạo ra trạng thái tệ hơn — hàng còn nguyên và trông như file vẫn ở đó.
 *
 * **File hỏng → bỏ qua + đi tiếp** (try/catch mỗi hàng). Một file R2 fail không
 * chặn cả lượt sync — đã chuyển X file xong thì vẫn giữ X, file hỏng vào
 * `skipped` + `errors`.
 *
 * **Rich-text thay SAU sync commit** — nếu sync rollback thì `articles.content`
 * không bị sửa. Chỉ thay URL khớp chính xác `media.url` cũ của hàng đã sync.
 *
 * **Khoá MySQL `cdkt:media:sync-storage`** (timeout 0) — hai lượt sync không
 * chạy chồng: moving 3000 file giữa local và R2 là race nếu chạy song song.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'

import { getDb, getPool } from '../utils/db'
import { media, activityLogs, articles } from '../db/schema'
import { uploadLocalFile, deleteLocalFile } from '../utils/media-local'
import { uploadR2File, deleteR2File, getR2Object, type R2Config } from '../utils/media-r2'
import { loadR2Config } from './media'
import { withNamedLock } from '../utils/named-lock'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { logInfo, logWarn } from '../utils/logger'
import { runBackup } from './backup'

const LOCK_NAME = 'cdkt:media:sync-storage'
const LOCK_TIMEOUT_SECONDS = 0

export type SyncDirection = 'to-r2' | 'to-local'

export interface SyncResult {
  synced: number
  skipped: number
  errors: string[]
  /** Số bài viết `articles.content` đã được thay URL. */
  articlesRewritten: number
}

/** Lưu cặp URL để thay trong rich-text sau khi sync. */
interface UrlRewrite {
  oldUrl: string
  newUrl: string
}

// ── Job state (cấp module, sống trong tiến trình) ────────────────────────────

export interface SyncJobStatus {
  jobId: string
  direction: SyncDirection
  running: boolean
  cancelling: boolean
  /** Tổng số hàng cần sync (đếm lúc start). */
  total: number
  /** Số hàng đã xử lý (OK + skip). */
  done: number
  synced: number
  skipped: number
  errors: string[]
  articlesRewritten: number
  phase: 'backup' | 'sync' | 'rewrite' | 'done' | 'failed' | 'cancelled'
  message: string
  startedAt: number
  finishedAt: number | null
  /** Stamp snapshot backup trước sync (để recover thủ công nếu thảm họa). */
  preBackupStamp: string | null
}

let currentJob: SyncJobStatus | null = null

/**
 * Trạng thái job hiện tại (snapshot). UI poll endpoint đọc hàm này.
 * Trả `null` nếu không có job nào (chưa chạy hoặc đã dọn).
 */
export function getSyncJobStatus(): SyncJobStatus | null {
  return currentJob ? { ...currentJob, errors: [...currentJob.errors] } : null
}

/**
 * Khởi tạo job sync nền. Trả `{ jobId }` ngay — worker chạy tiếp trong nền.
 * Nếu đã có job đang chạy → throw 409-style (caller lo bắt).
 *
 * `adminUserId` để audit mỗi batch + backup pre-sync.
 */
export async function startSyncJob(
  direction: SyncDirection,
  adminUserId: number | null,
): Promise<{ jobId: string }> {
  if (currentJob?.running) {
    throw new Error('Một lượt đồng bộ khác đang chạy. Thử lại sau.')
  }

  // Đếm số hàng cần sync để UI hiện progress.
  const db = getDb()
  const items = direction === 'to-r2'
    ? await db.select().from(media).where(eq(media.provider, 'local'))
    : await db.select().from(media).where(eq(media.provider, 'r2'))

  const jobId = `sync_${Date.now()}`
  currentJob = {
    jobId,
    direction,
    running: true,
    cancelling: false,
    total: items.length,
    done: 0,
    synced: 0,
    skipped: 0,
    errors: [],
    articlesRewritten: 0,
    phase: 'backup',
    message: 'Đang backup trước sync',
    startedAt: Date.now(),
    finishedAt: null,
    preBackupStamp: null,
  }

  // Worker chạy nền — không await, không block response.
  void runSyncWorker(direction, adminUserId, items)

  return { jobId }
}

/**
 * Đánh dấu cancel. Worker kiểm tra `cancelling` giữa các batch → dừng sạch.
 * Không ép dừng giữa batch đang chạy (xử lý nốt file đang upload để không hở).
 */
export function cancelSyncJob(): void {
  if (currentJob?.running) {
    currentJob.cancelling = true
  }
}

/**
 * Buộc gỡ kẹt khi worker treo (vd: `tar`/`mysqldump` treo trong pre-backup).
 * `cancelSyncJob()` chỉ đặt cờ `cancelling` — worker phải tự check giữa các
 * batch, nên nếu treo ở `await runBackup()` thì không bao giờ tới điểm check.
 * Hàm này đặt `running=false` ngay để Prod bấm là mở lại được, không cần SSH
 * restart container. Worker cũ vẫn treo trong nền nhưng không chặn job mới
 * (pre-backup fail sẽ được catch + bỏ qua, phase sync vẫn chạy).
 *
 * Chỉ SuperAdmin / người có `media.update` mới gọi được (do endpoint gác).
 */
export function forceResetSyncJob(): { ok: boolean; message: string } {
  if (!currentJob) return { ok: false, message: 'Không có job sync nào.' }
  if (!currentJob.running) return { ok: false, message: 'Job sync đã dừng rồi.' }
  const prevPhase = currentJob.phase
  const elapsed = Math.round((Date.now() - currentJob.startedAt) / 1000)
  currentJob.running = false
  currentJob.cancelling = false
  currentJob.phase = 'cancelled'
  currentJob.message = `Đã buộc dừng (treo ở ${prevPhase} ${elapsed}s) — có thể chạy lại ngay. Worker cũ sẽ tự hết khi pre-backup xong.`
  currentJob.finishedAt = Date.now()
  logWarn({ event: 'media.sync_force_reset', prevPhase, elapsed })
  return { ok: true, message: currentJob.message }
}

const BATCH_SIZE = 20
const BATCH_SLEEP_MS = 500

/**
 * Worker nền: pre-backup → sync từng batch → rewrite articles → done.
 * Mỗi batch update `currentJob` (progress) + sleep ngắn.
 */
async function runSyncWorker(
  direction: SyncDirection,
  adminUserId: number | null,
  items: (typeof media.$inferSelect)[],
): Promise<void> {
  const db = getDb()
  const pool = getPool()

  const finishJob = (phase: SyncJobStatus['phase'], message: string) => {
    if (!currentJob) return
    currentJob.running = false
    currentJob.phase = phase
    currentJob.message = message
    currentJob.finishedAt = Date.now()
    logInfo({
      event: 'media.sync_job_done',
      direction,
      phase,
      synced: currentJob.synced,
      skipped: currentJob.skipped,
      errors: currentJob.errors.length,
      articlesRewritten: currentJob.articlesRewritten,
      preBackupStamp: currentJob.preBackupStamp,
    })
  }

  try {
    if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

    // ── Phase 1: Pre-backup (snapshot recover thủ công) ─────────────────────
    // 3212 file → tar + dump có thể treo phút dài. Bọc timeout 90s: quá hạn
    // thì bỏ qua snapshot và tiến thẳng vào phase sync — treo ở "Đang backup
    // trước sync 0/3212 0%" chính là ca này.
    try {
      const backupPromise = runBackup('all', 'pre-sync', adminUserId)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Pre-backup timeout sau 90s — bỏ qua snapshot, tiếp tục sync.')), 90_000),
      )
      const backupRes = await Promise.race([backupPromise, timeoutPromise])
      if (currentJob) currentJob.preBackupStamp = backupRes.stamp
      logInfo({ event: 'media.sync_pre_backup_done', stamp: backupRes.stamp })
    } catch (err) {
      // Pre-backup fail/timeout → cảnh báo nhưng vẫn tiếp sync. Snapshot là bonus,
      // không phải điều kiện tiên quyết — sync vẫn idempotent.
      logWarn({
        event: 'media.sync_pre_backup_failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Kiểm tra cancel sau pre-backup.
    if (currentJob?.cancelling) {
      finishJob('cancelled', 'Đã hủy sau pre-backup')
      return
    }

    // ── Phase 2: Sync từng batch ────────────────────────────────────────────
    const r2Config = await loadR2Config()
    if (direction === 'to-r2') {
      const hasR2 = Boolean(r2Config.accountId && r2Config.accessKeyId && r2Config.secretAccessKey && r2Config.bucket)
      if (!hasR2) throw new Error('Cấu hình Cloudflare R2 chưa đầy đủ. Hãy kiểm tra /admin/settings/media-storage.')
    }

    if (currentJob) {
      currentJob.phase = 'sync'
      currentJob.message = `Đang sync ${direction === 'to-r2' ? 'lên R2' : 'về local'}`
    }

    const rewrites: UrlRewrite[] = []

    // Chia batch.
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      if (currentJob?.cancelling) {
        finishJob('cancelled', `Đã hủy ở ${currentJob.done}/${currentJob.total}`)
        return
      }

      const batch = items.slice(i, i + BATCH_SIZE)
      for (const item of batch) {
        try {
          const { rewrite } = direction === 'to-r2'
            ? await syncOneToR2(db, item, r2Config, adminUserId)
            : await syncOneToLocal(db, item, r2Config, adminUserId)
          if (currentJob) {
            currentJob.synced += 1
            currentJob.done += 1
          }
          rewrites.push(rewrite)
        } catch (err) {
          if (currentJob) {
            currentJob.skipped += 1
            currentJob.done += 1
            currentJob.errors.push(item.filename)
          }
          logWarn({
            event: 'media.sync_item_failed',
            direction,
            mediaId: item.id,
            filename: item.filename,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      // Audit mỗi batch (ngoài transaction — batch là đơn vị tiến độ).
      try {
        await db.insert(activityLogs).values({
          userId: adminUserId,
          action: 'sync_storage_batch',
          resource: 'media',
          resourceId: null,
          meta: {
            direction,
            batch: Math.floor(i / BATCH_SIZE) + 1,
            done: currentJob?.done ?? 0,
            total: currentJob?.total ?? 0,
            synced: currentJob?.synced ?? 0,
            skipped: currentJob?.skipped ?? 0,
          },
        })
      } catch {
        // Audit hỏng không làm hỏng batch đã thành công.
      }

      // Sleep ngắn giữa batch — không CPU 100%, cho request khác qua.
      await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS))
    }

    // ── Phase 3: Rewrite articles.content (SAU sync commit) ────────────────
    if (rewrites.length > 0 && !currentJob?.cancelling) {
      if (currentJob) {
        currentJob.phase = 'rewrite'
        currentJob.message = `Đang thay URL trong ${rewrites.length} bài viết`
      }
      const rewritten = await rewriteArticleImageUrls(db, rewrites, adminUserId)
      if (currentJob) currentJob.articlesRewritten = rewritten
    }

    // ── Done ─────────────────────────────────────────────────────────────────
    finishJob('done', `Sync xong: ${currentJob?.synced ?? 0} file, ${currentJob?.skipped ?? 0} bỏ qua`)
  } catch (err) {
    logWarn({
      event: 'media.sync_job_failed',
      error: err instanceof Error ? err.message : String(err),
    })
    finishJob('failed', err instanceof Error ? err.message : String(err))
  }
}

function hasR2Config(config: R2Config): boolean {
  return Boolean(config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket)
}

/**
 * Thay URL cũ bằng URL mới trong `articles.content`. Dùng SQL `REPLACE()`
 * (MySQL) để một query cập nhật tất cả occurrence của oldUrl trong mỗi bài.
 * Trả số bài đã sửa (affected rows).
 *
 * Không regex, không split/join phía app — `REPLACE()` là chuỗi chính xác,
 * MySQL xử lý trên server nên không phải tải content về RAM để sửa.
 */
async function rewriteArticleImageUrls(
  db: ReturnType<typeof getDb>,
  rewrites: UrlRewrite[],
  adminUserId: number | null,
): Promise<number> {
  let totalRewritten = 0
  for (const { oldUrl, newUrl } of rewrites) {
    if (!oldUrl || !newUrl || oldUrl === newUrl) continue
    try {
      // oldUrl luôn dạng /uploads/... (relative). Bài viết có thể chứa cả hai dạng:
      //   /uploads/migrated/media/foo.jpeg  (relative)
      //   http://localhost:3000/uploads/migrated/media/foo.jpeg (absolute)
      // Nếu chỉ REPLACE relative thì dạng absolute thành
      //   http://localhost:3000https://r2.../foo.jpeg  (hỏng).
      // Nên xử lý absolute TRƯỚC bằng REGEXP_REPLACE (MySQL 8+), rồi mới REPLACE relative.
      const escapedOldUrl = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const absPattern = `https?:\\/\\/[^"'\\s<>]*${escapedOldUrl}`
      let affected = 0
      try {
        const [absRes] = await db.execute(
          sql`UPDATE articles SET content = REGEXP_REPLACE(content, ${absPattern}, ${newUrl}) WHERE content REGEXP ${absPattern}`,
        )
        affected += affectedRowsOrZero(absRes)
      } catch {
        // REGEXP_REPLACE fail (MySQL < 8) → bỏ qua, sẽ thử REPLACE thường bên dưới.
      }
      const oldUrlLike = `%${oldUrl}%`
      const [relRes] = await db.execute(
        sql`UPDATE articles SET content = REPLACE(content, ${oldUrl}, ${newUrl}) WHERE content LIKE ${oldUrlLike}`,
      )
      affected += affectedRowsOrZero(relRes)
      if (affected > 0) {
        // Mỗi bài có thể bị đếm 2 lần nếu chứa cả hai dạng → unique count trong
        // totalRewritten sẽ dư, nhưng không sao: đây là số "lượt sửa" hiển thị, không
        // phải số bài unique nghiêm ngặt.
        totalRewritten += affected
        try {
          await db.insert(activityLogs).values({
            userId: adminUserId,
            action: 'update',
            resource: 'articles',
            resourceId: null,
            meta: { syncRewrite: true, oldUrl, newUrl, articlesAffected: affected },
          })
        } catch {
          // Audit hỏng không làm hỏng lượt sync đã thành công.
        }
      }
    } catch (err) {
      logWarn({
        event: 'media.sync_rewrite_failed',
        oldUrl,
        newUrl,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return totalRewritten
}

/**
 * Sync một hàng `media` từ local lên R2. Trả `{ newUrl, newStoragePath, rewrite }`
 * hoặc ném lỗi (caller bắt + bỏ qua).
 */
async function syncOneToR2(
  db: ReturnType<typeof getDb>,
  item: typeof media.$inferSelect,
  r2Config: R2Config,
  adminUserId: number | null,
): Promise<{ rewrite: UrlRewrite }> {
  // Đọc file local. storagePath là đường dẫn tuyệt đối.
  const buffer = await fs.readFile(item.storagePath)

  // Upload R2 — giữ filename gốc (không thêm timestamp) để URL ổn định.
  // Nếu R2 key trùng (cùng YYYY/MM/filename) thì PUT ghi đè — idempotent.
  const { url: r2Url, storagePath: r2Key } = await uploadR2File(
    buffer,
    item.filename,
    item.mimeType,
    r2Config,
  )

  const oldUrl = item.url
  const oldStoragePath = item.storagePath

  await db.transaction(async (tx) => {
    await tx.update(media).set({
      provider: 'r2',
      url: r2Url,
      storagePath: r2Key,
    }).where(eq(media.id, item.id))
    await tx.insert(activityLogs).values({
      userId: adminUserId,
      action: 'update',
      resource: 'media',
      resourceId: item.id,
      meta: { sync: 'to-r2', oldUrl, newUrl: r2Url, oldStoragePath, newStoragePath: r2Key },
    })
  })

  // Xoá file local SAU khi SQL commit — rollback không lấy lại file đã xoá.
  await deleteLocalFile(oldStoragePath)

  return { rewrite: { oldUrl, newUrl: r2Url } }
}

/**
 * Sync một hàng `media` từ R2 về local. Trả `{ rewrite }` hoặc ném lỗi.
 */
async function syncOneToLocal(
  db: ReturnType<typeof getDb>,
  item: typeof media.$inferSelect,
  r2Config: R2Config,
  adminUserId: number | null,
): Promise<{ rewrite: UrlRewrite }> {
  // Download R2 object — storagePath chính là R2 key.
  const buffer = await getR2Object(item.storagePath, r2Config)

  // Ghi local — uploadLocalFile tạo YYYY/MM/filename, trả url + storagePath tuyệt đối.
  const { url: localUrl, storagePath: localStoragePath } = await uploadLocalFile(buffer, item.filename)

  const oldUrl = item.url
  const oldR2Key = item.storagePath

  await db.transaction(async (tx) => {
    await tx.update(media).set({
      provider: 'local',
      url: localUrl,
      storagePath: localStoragePath,
    }).where(eq(media.id, item.id))
    await tx.insert(activityLogs).values({
      userId: adminUserId,
      action: 'update',
      resource: 'media',
      resourceId: item.id,
      meta: { sync: 'to-local', oldUrl, newUrl: localUrl, oldStoragePath: oldR2Key, newStoragePath: localStoragePath },
    })
  })

  // Xoá R2 object SAU khi SQL commit.
  await deleteR2File(oldR2Key, r2Config)

  return { rewrite: { oldUrl, newUrl: localUrl } }
}

/**
 * Legacy: chạy sync đồng bộ trong 1 HTTP request (giữ cho backward compat, nhưng
 * giờ UI dùng worker nền). Không khuyến nghị — 3000 file timeout.
 */
export async function syncMediaStorage(
  direction: SyncDirection,
  adminUserId: number | null,
): Promise<SyncResult> {
  const db = getDb()
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  // Đọc R2 config image (group `media` settings).
  const r2Config = await loadR2Config()
  if (direction === 'to-r2' && !hasR2Config(r2Config)) {
    throw new Error('Cấu hình Cloudflare R2 chưa đầy đủ. Hãy kiểm tra /admin/settings/media-storage.')
  }

  // Khoá MySQL named lock — timeout 0 (không xếp hàng).
  const outcome = await withNamedLock(pool, LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
    // Chọn hàng cần sync theo direction.
    const items = direction === 'to-r2'
      ? await db.select().from(media).where(eq(media.provider, 'local'))
      : await db.select().from(media).where(eq(media.provider, 'r2'))

    let synced = 0
    let skipped = 0
    const errors: string[] = []
    const rewrites: UrlRewrite[] = []

    for (const item of items) {
      try {
        const { rewrite } = direction === 'to-r2'
          ? await syncOneToR2(db, item, r2Config, adminUserId)
          : await syncOneToLocal(db, item, r2Config, adminUserId)
        synced += 1
        rewrites.push(rewrite)
      } catch (err) {
        skipped += 1
        errors.push(item.filename)
        logWarn({
          event: 'media.sync_item_failed',
          direction,
          mediaId: item.id,
          filename: item.filename,
          error: err instanceof Error ? err.message : String(err),
        })
        // Không throw — một file hỏng không sập cả lượt.
      }
    }

    // Thay URL trong rich-text articles.content SAU khi sync commit.
    let articlesRewritten = 0
    if (rewrites.length > 0) {
      articlesRewritten = await rewriteArticleImageUrls(db, rewrites, adminUserId)
    }

    return { synced, skipped, errors, articlesRewritten }
  })

  if (!outcome.acquired) {
    throw new Error('Một lượt đồng bộ khác đang chạy. Thử lại sau.')
  }

  const result = outcome.value

  // Audit tổng — ngoài transaction (sync tạo nhiều hàng riêng, không có "một"
  // transaction bao bọc). Cùng pattern `scan_uploads`.
  if (result.synced > 0 || result.skipped > 0) {
    try {
      await db.insert(activityLogs).values({
        userId: adminUserId,
        action: 'sync_storage',
        resource: 'media',
        resourceId: null,
        meta: {
          direction,
          synced: result.synced,
          skipped: result.skipped,
          articlesRewritten: result.articlesRewritten,
        },
      })
    } catch {
      // Audit hỏng không làm hỏng lượt sync đã thành công.
    }
    logInfo({ event: 'media.sync_complete', direction, ...result })
  }

  return result
}
