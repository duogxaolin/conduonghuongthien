/**
 * Thu hồi công việc chuyển mã bị bỏ lại.
 *
 * Không có tệp này, một container bị giết giữa lúc chuyển mã để lại một mục nằm
 * mãi ở trạng thái `processing`. Triệu chứng duy nhất là **một video không bao
 * giờ phát được** — không lỗi, không log, không hàng nào nói ra. Cán bộ nhìn thấy
 * một mục "đang xử lý" và chờ, vô hạn.
 *
 * Liveness comes only from the dedicated processing heartbeat. A live PID can
 * belong to a restarted server or another job and never extends a lease.
 * Expired claims are fenced, locally aborted and retried with a bounded budget
 * and backoff. Each attempt has an isolated generation directory. The scheduler
 * also picks up persisted pending work after restart or admission contention.
 *
 * **Tệp này cố ý KHÔNG chạm `activity_logs`.** Việc thu hồi là sự kiện của máy,
 * không phải hành động của cán bộ; hành động đáng ghi kiểm toán là lượt tải lên,
 * và cặp hàng + nhật ký đó nằm trong transaction của `completeUpload`. Vì thế tệp
 * này không cần mục nào trong `SERVICE_EXEMPTIONS` — cổng quét chỉ hỏi những tệp
 * có chạm `activityLogs`.
 */
import type { Pool } from 'mysql2/promise'
import { and, eq, isNull, lt, or, lte, asc } from 'drizzle-orm'
import { getDb, getPool, type Database } from '../utils/db'
import { mediaItems } from '../db/schema'
import { resolveMediaConfig, type MediaConfig } from '../utils/media-config'
import { resolveMediaConfigWithDb } from './media-config-service'
import { withNamedLock } from '../utils/named-lock'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { logInfo, logWarn } from '../utils/logger'
import { TRANSCODE_LOCK_NAME, PROCESSING_ERROR_LIMIT, abortProcessingClaim, processMediaItem, retryAt, stopMediaProcessingJobs } from './video-processing'
import { processMediaAssetCleanup } from './media-asset-cleanup'

const LOCK_TIMEOUT_SECONDS = 0

/** Short polling interval so queued uploads start without another HTTP request. */
export const TICK_INTERVAL_MS = 15 * 1000

/** First boot pass; startup database failures are retried on the next tick. */
export const WARMUP_DELAY_MS = 1000

/**
 * Trần số mục xử lý trong một lượt.
 *
 * Một sự cố làm hàng nghìn mục kẹt cùng lúc sẽ biến lượt dọn thành một loạt ghi
 * giữ khoá hàng loạt — chính nó là một sự cố thứ hai. Có trần thì mỗi nhịp dọn
 * một phần, và nhịp sau tiếp tục.
 */
export const REAP_BATCH_LIMIT = 200

export type ReapOutcome = {
  scanned: number
  reclaimed: number
  refreshed: number
}

export type ReapDeps = {
  db?: Database
  pool?: Pool | null
  config?: MediaConfig
  /** Đồng hồ, để test ghim được mốc so sánh. Cùng lối với `now` của `housekeepUploads`. */
  now?: Date
}

/**
 * Ngưỡng cũ: `now` trừ đi cửa sổ, tính bằng mili giây.
 *
 * Hàm thuần, và là chỗ duy nhất dựng con số đó — một bản sao thứ hai trong câu
 * truy vấn và trong thông báo log sẽ lệch nhau đúng vào lúc có người đọc log để
 * tìm hiểu vì sao một video biến mất.
 */
export function stalenessCutoff(now: Date, staleMinutes: number): Date {
  const minutes = Number.isFinite(staleMinutes) && staleMinutes > 0 ? staleMinutes : 10
  return new Date(now.getTime() - minutes * 60 * 1000)
}

/** Lý do ghi vào `processing_error` khi thu hồi. Một chỗ, để log và cột khớp nhau. */
export function reclaimReason(claim: string | null | undefined): string {
  const who = claim ? `"${claim}"` : 'không rõ'
  return `Lượt chuyển mã bị dừng đột ngột (tiến trình ${who} không còn chạy). `
    + 'Mục đã được đưa về hàng chờ để xử lý lại.'
}

/**
 * Một lượt thu hồi.
 *
 * Trả `null` khi **không lấy được khoá** — cùng tên khoá với lượt bắt đầu đường
 * ống, nên một bản sao khác đang chuyển mã, hoặc một nhịp trước chưa xong, đều
 * cho ra "không làm gì" thay vì hai lượt cùng sửa một hàng.
 */
export async function reapStuckJobs(options: ReapDeps = {}): Promise<ReapOutcome | null> {
  const db = options.db ?? getDb()
  const config = options.config ?? resolveMediaConfig()
  const pool = options.pool ?? getPool()
  if (!pool) return null

  const now = options.now ?? new Date()
  const cutoff = stalenessCutoff(now, config.processingStaleMinutes)

  const outcome = await withNamedLock(pool, TRANSCODE_LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
    // Legacy pre-migration jobs have no heartbeat; updatedAt is their one-time
    // fallback. New jobs cannot be kept alive by unrelated admin edits.
    const stuck = await db
      .select({
        id: mediaItems.id,
        slug: mediaItems.slug,
        claimedBy: mediaItems.claimedBy,
        processingAttempts: mediaItems.processingAttempts,
      })
      .from(mediaItems)
      .where(and(
        eq(mediaItems.processingStatus, 'processing'),
        or(lt(mediaItems.processingHeartbeatAt, cutoff), and(isNull(mediaItems.processingHeartbeatAt), lt(mediaItems.updatedAt, cutoff))),
      ))
      .limit(REAP_BATCH_LIMIT)

    const result: ReapOutcome = { scanned: stuck.length, reclaimed: 0, refreshed: 0 }

    for (const item of stuck) {
      // PID existence is not proof of job liveness. Only the worker renews its lease.

      const reason = reclaimReason(item.claimedBy).slice(0, PROCESSING_ERROR_LIMIT)
      // Điều kiện `claimed_by` nằm TRONG mệnh đề `WHERE`: giữa lượt đọc và lượt
      // ghi, lượt chuyển mã có thể đã tự kết thúc và trả `claimed_by` về NULL.
      // Ghi đè lúc đó là đưa một mục vừa `ready` trở lại hàng chờ.
      const ownership = item.claimedBy === null
        ? isNull(mediaItems.claimedBy)
        : eq(mediaItems.claimedBy, item.claimedBy)
      const [reclaimed] = await db
        .update(mediaItems)
        .set({ processingStatus: item.processingAttempts >= (config.processingMaxAttempts ?? 3) ? 'failed' : 'pending',
          claimedBy: null, processingError: reason, updatedAt: now,
          processingNextAttemptAt: retryAt(item.processingAttempts, now) })
        .where(and(
          eq(mediaItems.id, item.id),
          eq(mediaItems.processingStatus, 'processing'),
          ownership,
          or(lt(mediaItems.processingHeartbeatAt, cutoff), and(isNull(mediaItems.processingHeartbeatAt), lt(mediaItems.updatedAt, cutoff))),
        ))
      if (affectedRowsOrZero(reclaimed) > 0) {
        abortProcessingClaim(item.claimedBy)
        result.reclaimed += 1
        logWarn({ event: 'media.processing_reclaimed', mediaItemId: item.id, slug: item.slug, claimedBy: item.claimedBy })
      }
    }

    return result
  })

  if (!outcome.acquired) {
    logInfo({ event: 'media.reaper_lock_contention' })
    return null
  }

  const result = outcome.value
  // Chỉ ghi log khi có việc thật: một dòng mỗi 15 phút nói "không có gì" là thứ
  // làm người vận hành ngừng đọc log.
  if (result.reclaimed > 0 || result.refreshed > 0) {
    logInfo({ event: 'media.reaper_pass', ...result })
  }
  return result
}

let timer: ReturnType<typeof setInterval> | null = null
let warmup: ReturnType<typeof setTimeout> | null = null
let ticking = false
let stopping = false

/** Durable pending rows are picked up after restart and after admission contention. */
export async function drainMediaQueue(options: ReapDeps & { waitForJobs?: boolean } = {}): Promise<void> {
  const db = options.db ?? getDb()
  const config = options.config ?? resolveMediaConfig()
  const now = options.now ?? new Date()
  const pending = await db.select({ id: mediaItems.id }).from(mediaItems)
    .where(and(eq(mediaItems.source, 'upload'), eq(mediaItems.processingStatus, 'pending'),
      or(isNull(mediaItems.processingNextAttemptAt), lte(mediaItems.processingNextAttemptAt, now))))
    .orderBy(asc(mediaItems.id)).limit(config.processingMaxJobs ?? 1)
  const jobs = Promise.all(pending.map(async item => {
    if (!stopping) await processMediaItem({ mediaItemId: item.id }, options)
  }))
  if (options.waitForJobs !== false) await jobs
  else void jobs.catch(error => logWarn({ event: 'media.queue_failed', message: String(error) }))
}

/**
 * Bộ đếm nhịp trong tiến trình.
 *
 * Lỗi trong một nhịp bị **nuốt có chủ đích**: một unhandled rejection trong
 * worker biến một lượt dọn trượt thành một lần sập tiến trình. `unref()` để
 * timer không giữ tiến trình sống qua lượt tắt máy.
 */
export function startMediaProcessingReaper(): void {
  if (timer) return
  stopping = false
  const tick = () => {
    if (ticking || stopping) return
    ticking = true
    // Mỗi nhịp nạp config từ DB (override > env > default) rồi truyền xuống cả
    // ba hàm — reaper chạy nền nên đây là con đường duy nhất để một cán bộ sửa
    // `processingMaxJobs`/`processingStaleMinutes` qua trang settings có hiệu lực
    // mà không cần restart container.
    resolveMediaConfigWithDb(getDb()).then(({ config }) => Promise.all([
      reapStuckJobs({ config }),
      drainMediaQueue({ waitForJobs: false, config }),
      processMediaAssetCleanup({ config }),
    ])).catch((error) => {
      logWarn({
        event: 'media.reaper_failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }).finally(() => { ticking = false })
  }
  timer = setInterval(tick, TICK_INTERVAL_MS)
  timer.unref?.()
  warmup = setTimeout(tick, WARMUP_DELAY_MS)
  warmup.unref?.()
}

export function stopMediaProcessingReaper(): void {
  stopping = true
  if (timer) clearInterval(timer)
  if (warmup) clearTimeout(warmup)
  warmup = null
  timer = null
  stopMediaProcessingJobs()
}
