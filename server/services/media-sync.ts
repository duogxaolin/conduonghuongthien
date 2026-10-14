/**
 * Đồng bộ storage ảnh (bảng `media`) giữa local disk và Cloudflare R2.
 *
 * Ca sử dụng: ảnh đang ở local muốn chuyển hết lên R2 (hoặc ngược lại) mà không
 * mất hàng CSDL, không mất liên kết trong nội dung. Một nút bấm — tải hết sang
 * bên kia, cập nhật `provider` + `url` + `storagePath`, thay URL cũ ở mọi nội dung
 * tham chiếu, rồi mới xoá bản cũ.
 *
 * ── Worker nền + chia đợt (không chạy trong 1 HTTP request) ───────────────────
 * Sync 3000 ảnh × 1-2s/file = 50-100 phút → HTTP timeout cắt giữa chừng. Nên
 * `startSyncJob` chỉ **khởi tạo** job và trả ngay `{ jobId }`; worker chạy nền
 * trong tiến trình Nitro, ghi audit tiến độ mỗi 20 file, sleep ngắn giữa các đợt
 * để không chiếm CPU 100%. Trạng thái hiển thị sống trong biến cấp module.
 *
 * ── An toàn khi bị cắt ngang (huỷ / lỗi / container khởi động lại) ─────────────
 * Mỗi hàng là một đơn vị trọn vẹn (`media-sync-files.ts`): chép sang bên mới →
 * MỘT transaction đổi hàng + thay URL mọi nội dung + audit → SAU commit mới xoá
 * bản cũ. Dừng ở đâu cũng không để nội dung trỏ vào tệp đã xoá. Trước đây URL
 * chỉ được thay một lần ở cuối lượt từ một mảng trong RAM, trong khi file local
 * bị xoá ngay từng hàng — huỷ/restart giữa chừng là 404 vĩnh viễn.
 *
 * Trạng thái dở dang do mã cũ để lại được vá ở đầu mỗi lượt (và ở nút "Vá URL"):
 * `repairInterruptedSyncRewrites` dựng lại URL cũ từ audit trail.
 *
 * ── Một worker duy nhất, thật sự ────────────────────────────────────────────
 * Worker giữ khoá MySQL `cdkt:media:sync-storage` (timeout 0) SUỐT lượt chạy — kể
 * cả đường đồng bộ cũ `syncMediaStorage` và lượt vá URL. `forceResetSyncJob` chỉ
 * gỡ trạng thái hiển thị và tăng `generation`: worker cũ kiểm `generation` trước
 * mỗi hàng và ngay trước khi ghi, nên nó dừng mà không ghi thêm; lượt mới chỉ
 * chạy được khi worker cũ đã nhả khoá (nếu chưa, lượt mới báo lỗi rõ, không chạy
 * chồng).
 *
 * ── Pre-backup trước sync ───────────────────────────────────────────────────
 * Trước khi sync, tự chạy `runBackup('all')` → snapshot SQL + file. KHÔNG dùng
 * để auto-rollback (restore toàn DB = mất mọi thao tác unrelated trong window
 * sync). Snapshot để **recover thủ công** nếu thảm họa. Sync ngược (`to-r2` →
 * `to-local`) mới là rollback đúng — idempotent, không mất dữ liệu.
 *
 * **File hỏng → bỏ qua + đi tiếp** (try/catch mỗi hàng). Một file R2 fail không
 * chặn cả lượt sync — đã chuyển X file xong thì vẫn giữ X, file hỏng vào
 * `skipped` + `errors`.
 */
import { eq } from 'drizzle-orm'

import { getDb, getPool } from '../utils/db'
import { media, activityLogs } from '../db/schema'
import { loadR2Config } from './media'
import { assertUsableR2Config } from '../utils/media-r2'
import { withNamedLock } from '../utils/named-lock'
import { logInfo, logWarn } from '../utils/logger'
import { runBackup } from './backup'
import { MEDIA_SYNC_LOCK_NAME, repairInterruptedSyncRewrites } from './media-sync-rewrite'
import { hasR2Config, isSyncSuperseded, syncOneToR2, syncOneToLocal } from './media-sync-files'

const LOCK_TIMEOUT_SECONDS = 0
const BUSY_MESSAGE = 'Một lượt đồng bộ khác đang chạy. Thử lại sau.'

export type SyncDirection = 'to-r2' | 'to-local'

export interface SyncResult {
  synced: number
  skipped: number
  errors: string[]
  /** Số hàng nội dung (bài viết, bản dịch, khối trang) đã được thay URL. */
  articlesRewritten: number
}

// ── Job state (cấp module, sống trong tiến trình) ────────────────────────────

export interface SyncJobStatus {
  jobId: string
  direction: SyncDirection
  running: boolean
  cancelling: boolean
  /** Tổng số hàng cần sync (đếm khi worker đã giữ khoá). */
  total: number
  /** Số hàng đã xử lý (OK + skip). */
  done: number
  synced: number
  skipped: number
  errors: string[]
  /** Số hàng nội dung đã được thay URL (gồm cả lượt vá đầu job). */
  articlesRewritten: number
  /** Số URL dở dang từ lượt đồng bộ trước đã được vá ở đầu job. */
  urlsRepaired: number
  phase: 'backup' | 'sync' | 'rewrite' | 'done' | 'failed' | 'cancelled'
  message: string
  startedAt: number
  finishedAt: number | null
  /** Stamp snapshot backup trước sync (để recover thủ công nếu thảm họa). */
  preBackupStamp: string | null
}

let currentJob: SyncJobStatus | null = null
/**
 * Thẻ thế hệ: mỗi job mới và mỗi lần buộc dừng tăng nó. Worker chỉ được ghi (CSDL
 * lẫn trạng thái hiển thị) khi thế hệ nó cầm còn là thế hệ hiện tại.
 */
let currentGeneration = 0

/**
 * Trạng thái job hiện tại (snapshot). UI poll endpoint đọc hàm này.
 * Trả `null` nếu không có job nào (chưa chạy hoặc đã dọn).
 */
export function getSyncJobStatus(): SyncJobStatus | null {
  return currentJob ? { ...currentJob, errors: [...currentJob.errors] } : null
}

/**
 * Khởi tạo job sync nền. Trả `{ jobId }` ngay — worker chạy tiếp trong nền.
 * Nếu đã có job đang chạy → throw 409-style (caller lo bắt). Chặn thật sự nằm ở
 * khoá MySQL mà worker giữ; cờ `running` chỉ để trả lời nhanh cho UI.
 *
 * `adminUserId` để audit mỗi hàng + backup pre-sync.
 */
export async function startSyncJob(
  direction: SyncDirection,
  adminUserId: number | null,
): Promise<{ jobId: string }> {
  if (currentJob?.running) {
    throw new Error(BUSY_MESSAGE)
  }

  currentGeneration += 1
  const generation = currentGeneration
  const jobId = `sync_${Date.now()}`
  const job: SyncJobStatus = {
    jobId,
    direction,
    running: true,
    cancelling: false,
    total: 0,
    done: 0,
    synced: 0,
    skipped: 0,
    errors: [],
    articlesRewritten: 0,
    urlsRepaired: 0,
    phase: 'backup',
    message: 'Đang backup trước sync',
    startedAt: Date.now(),
    finishedAt: null,
    preBackupStamp: null,
  }
  currentJob = job

  // Worker chạy nền — không await, không block response.
  void runSyncWorker(job, generation, direction, adminUserId)

  return { jobId }
}

/**
 * Đánh dấu cancel. Worker kiểm tra `cancelling` trước mỗi hàng → dừng sạch.
 * Hàng đang chạy được làm trọn (hàng là đơn vị nguyên tử — không có nửa hàng).
 */
export function cancelSyncJob(): void {
  if (currentJob?.running) {
    currentJob.cancelling = true
  }
}

/**
 * Buộc gỡ kẹt khi worker treo (vd: `tar`/`mysqldump` treo trong pre-backup, hay
 * một lượt tải R2 không trả lời). `cancelSyncJob()` chỉ đặt cờ — worker treo thì
 * không bao giờ tới điểm kiểm. Hàm này gỡ trạng thái hiển thị NGAY và tăng thế hệ:
 * worker cũ, khi tỉnh lại, thấy mình không còn là thế hệ hiện tại và dừng trước
 * khi ghi gì thêm. Nó vẫn giữ khoá MySQL cho tới khi thoát — lượt mới bấm trong
 * lúc đó sẽ báo "đang chạy" thay vì chạy chồng.
 *
 * Chỉ SuperAdmin / người có `media.update` mới gọi được (do endpoint gác).
 */
export function forceResetSyncJob(): { ok: boolean; message: string } {
  if (!currentJob) return { ok: false, message: 'Không có job sync nào.' }
  if (!currentJob.running) return { ok: false, message: 'Job sync đã dừng rồi.' }
  currentGeneration += 1
  const prevPhase = currentJob.phase
  const elapsed = Math.round((Date.now() - currentJob.startedAt) / 1000)
  currentJob.running = false
  currentJob.cancelling = false
  currentJob.phase = 'cancelled'
  currentJob.message = `Đã buộc dừng (treo ở ${prevPhase} ${elapsed}s). Worker cũ sẽ dừng trước hàng kế tiếp mà không ghi thêm; lượt mới chạy được khi nó đã nhả khoá.`
  currentJob.finishedAt = Date.now()
  logWarn({ event: 'media.sync_force_reset', prevPhase, elapsed })
  return { ok: true, message: currentJob.message }
}

const BATCH_SIZE = 20
const BATCH_SLEEP_MS = 500
const PRE_BACKUP_TIMEOUT_MS = 90_000

type SyncItem = typeof media.$inferSelect

/** Chọn hàng cần sync theo hướng. */
async function selectItems(direction: SyncDirection): Promise<SyncItem[]> {
  const db = getDb()
  return direction === 'to-r2'
    ? await db.select().from(media).where(eq(media.provider, 'local'))
    : await db.select().from(media).where(eq(media.provider, 'r2'))
}

/**
 * Worker nền: (giữ khoá) pre-backup → vá URL dở dang → sync từng hàng → done.
 * Mọi lượt ghi trạng thái đi qua `update`/`finish`, là no-op khi worker đã bị
 * thay thế — worker cũ không bao giờ ghi đè trạng thái của job mới.
 */
async function runSyncWorker(
  job: SyncJobStatus,
  generation: number,
  direction: SyncDirection,
  adminUserId: number | null,
): Promise<void> {
  const owns = () => generation === currentGeneration
  const update = (patch: Partial<SyncJobStatus>) => {
    if (owns()) Object.assign(job, patch)
  }
  const finish = (phase: SyncJobStatus['phase'], message: string) => {
    if (!owns()) {
      logWarn({ event: 'media.sync_worker_superseded', direction, synced: job.synced, done: job.done })
      return
    }
    Object.assign(job, { running: false, phase, message, finishedAt: Date.now() })
    logInfo({
      event: 'media.sync_job_done',
      direction,
      phase,
      synced: job.synced,
      skipped: job.skipped,
      errors: job.errors.length,
      articlesRewritten: job.articlesRewritten,
      urlsRepaired: job.urlsRepaired,
      preBackupStamp: job.preBackupStamp,
    })
  }

  try {
    const pool = getPool()
    if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

    const outcome = await withNamedLock(pool, MEDIA_SYNC_LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
      await runLocked(job, owns, update, finish, direction, adminUserId)
    })
    if (!outcome.acquired) {
      finish('failed', 'Một lượt đồng bộ khác (có thể là worker cũ đã bị buộc dừng nhưng chưa thoát) vẫn đang giữ khoá. Thử lại sau ít phút.')
    }
  } catch (err: unknown) {
    logWarn({
      event: 'media.sync_job_failed',
      error: err instanceof Error ? err.message : String(err),
    })
    finish('failed', err instanceof Error ? err.message : String(err))
  }
}

async function runLocked(
  job: SyncJobStatus,
  owns: () => boolean,
  update: (patch: Partial<SyncJobStatus>) => void,
  finish: (phase: SyncJobStatus['phase'], message: string) => void,
  direction: SyncDirection,
  adminUserId: number | null,
): Promise<void> {
  const db = getDb()

  // ── Phase 1: Pre-backup (snapshot recover thủ công) ─────────────────────
  // 3212 file → tar + dump có thể treo phút dài. Bọc timeout 90s: quá hạn thì
  // bỏ qua snapshot và tiến thẳng vào phase sync.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const backupPromise = runBackup('all', 'pre-sync', adminUserId)
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Pre-backup timeout sau 90s — bỏ qua snapshot, tiếp tục sync.')), PRE_BACKUP_TIMEOUT_MS)
    })
    const backupRes = await Promise.race([backupPromise, timeoutPromise])
    update({ preBackupStamp: backupRes.stamp })
    logInfo({ event: 'media.sync_pre_backup_done', stamp: backupRes.stamp })
  } catch (err: unknown) {
    // Pre-backup fail/timeout → cảnh báo nhưng vẫn tiếp sync. Snapshot là bonus,
    // không phải điều kiện tiên quyết — sync vẫn idempotent.
    logWarn({
      event: 'media.sync_pre_backup_failed',
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    if (timer) clearTimeout(timer)
  }

  if (!owns()) return finish('cancelled', 'Đã bị buộc dừng.')
  if (job.cancelling) return finish('cancelled', 'Đã hủy sau pre-backup')

  const r2Config = await loadR2Config()
  if (direction === 'to-r2' && !hasR2Config(r2Config)) {
    throw new Error('Cấu hình Cloudflare R2 chưa đầy đủ. Hãy kiểm tra /admin/settings/media-storage.')
  }
  // Đủ trường nhưng account id / bucket (lưu từ trước bản vá kiểm-lúc-lưu) dị dạng
  // → dừng cả lượt NGAY bằng lỗi có phân loại, thay vì để từng hàng hỏng một.
  if (hasR2Config(r2Config)) assertUsableR2Config(r2Config)

  // ── Phase 2: Vá URL còn trỏ bản cũ từ lượt đồng bộ trước bị cắt ngang ────
  update({ phase: 'rewrite', message: 'Đang vá URL còn sót từ lượt đồng bộ trước' })
  const repaired = await repairInterruptedSyncRewrites(db, adminUserId, {
    shouldStop: () => !owns() || job.cancelling,
  })
  update({ urlsRepaired: repaired.urlsRepaired, articlesRewritten: job.articlesRewritten + repaired.rowsRewritten })

  // ── Phase 3: Sync từng hàng (mỗi hàng nguyên tử) ─────────────────────────
  const items = await selectItems(direction)
  update({
    total: items.length,
    phase: 'sync',
    message: `Đang sync ${direction === 'to-r2' ? 'lên R2' : 'về local'}`,
  })

  for (let i = 0; i < items.length; i += 1) {
    if (!owns()) return finish('cancelled', 'Đã bị buộc dừng.')
    if (job.cancelling) return finish('cancelled', `Đã hủy ở ${job.done}/${job.total}`)

    const item = items[i]!
    try {
      const { rowsRewritten } = direction === 'to-r2'
        ? await syncOneToR2(db, item, r2Config, adminUserId, { stillOwner: owns })
        : await syncOneToLocal(db, item, r2Config, adminUserId, { stillOwner: owns })
      update({ synced: job.synced + 1, done: job.done + 1, articlesRewritten: job.articlesRewritten + rowsRewritten })
    } catch (err: unknown) {
      if (isSyncSuperseded(err)) return finish('cancelled', 'Đã bị buộc dừng.')
      update({ skipped: job.skipped + 1, done: job.done + 1, errors: [...job.errors, item.filename] })
      logWarn({
        event: 'media.sync_item_failed',
        direction,
        mediaId: item.id,
        filename: item.filename,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    const batchEnded = (i + 1) % BATCH_SIZE === 0 || i === items.length - 1
    if (!batchEnded) continue

    // Audit tiến độ mỗi đợt (ngoài transaction — đợt là đơn vị tiến độ, không
    // phải đơn vị dữ liệu; cặp hàng + audit thật nằm trong transaction từng hàng).
    try {
      await db.insert(activityLogs).values({
        userId: adminUserId,
        action: 'sync_storage_batch',
        resource: 'media',
        resourceId: null,
        meta: {
          direction,
          batch: Math.floor(i / BATCH_SIZE) + 1,
          done: job.done,
          total: job.total,
          synced: job.synced,
          skipped: job.skipped,
        },
      })
    } catch {
      // Audit hỏng không làm hỏng đợt đã thành công.
    }

    // Sleep ngắn giữa đợt — không CPU 100%, cho request khác qua.
    if (i < items.length - 1) await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS))
  }

  finish('done', `Sync xong: ${job.synced} file, ${job.skipped} bỏ qua`)
}

/**
 * Legacy: chạy sync đồng bộ trong 1 HTTP request (giữ cho backward compat, nhưng
 * giờ UI dùng worker nền). Không khuyến nghị — 3000 file timeout. Cùng khoá, cùng
 * lượt vá, cùng đơn vị nguyên tử từng hàng như worker nền.
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
  if (hasR2Config(r2Config)) assertUsableR2Config(r2Config)

  // Khoá MySQL named lock — timeout 0 (không xếp hàng).
  const outcome = await withNamedLock(pool, MEDIA_SYNC_LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
    const repaired = await repairInterruptedSyncRewrites(db, adminUserId)
    const items = await selectItems(direction)

    let synced = 0
    let skipped = 0
    const errors: string[] = []
    let articlesRewritten = repaired.rowsRewritten

    for (const item of items) {
      try {
        const { rowsRewritten } = direction === 'to-r2'
          ? await syncOneToR2(db, item, r2Config, adminUserId)
          : await syncOneToLocal(db, item, r2Config, adminUserId)
        synced += 1
        articlesRewritten += rowsRewritten
      } catch (err: unknown) {
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

    return { synced, skipped, errors, articlesRewritten }
  })

  if (!outcome.acquired) {
    throw new Error(BUSY_MESSAGE)
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
