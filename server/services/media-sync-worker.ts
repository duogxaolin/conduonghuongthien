/**
 * Worker nền của job đồng bộ ảnh: (giữ khoá) pre-backup → vá URL dở dang → sync từng hàng.
 *
 * Tệp này KHÔNG giữ trạng thái cấp module. Job hiện tại và thẻ thế hệ sống ở `media-sync.ts`
 * (một chủ); worker nhận `job` + `owns()` từ đó và không import ngược lại. Mọi lượt ghi
 * trạng thái đi qua `update`/`finish`, là no-op khi worker đã bị thay thế — worker cũ không
 * bao giờ ghi đè trạng thái của job mới.
 *
 * ── Vô hiệu bộ đệm câu trả lời chatbot (`answer-cache-invalidator` ở cuối tệp) ──
 * Câu trả lời đã cache có thể chép URL ảnh; hàng `media` vừa chuyển thì URL cũ sắp bị xoá.
 * Phiên bản cache được tăng đúng hai lúc, luôn SAU commit và ngoài transaction (một request
 * chen vào giữa mà dựng lại câu từ dữ liệu cũ sẽ thành câu "mới" mang số phiên bản mới):
 *   1. ngay sau commit của hàng ĐẦU TIÊN (hook `onCommitted`, trước khi xoá bản cũ) — lần đầu
 *      một URL cũ có thể chết. Không bao giờ sớm hơn: job bị chặn vì đang khôi phục CSDL hay
 *      hàng đầu tiên hỏng thì chưa ghi gì, và không được ghi gì ở đây;
 *   2. khi job kết thúc — xong, huỷ, lỗi hay bị buộc dừng — nếu còn thay đổi chưa được tăng
 *      (các hàng sau hàng đầu, hoặc lượt vá URL dở dang khi không có hàng nào để chuyển).
 * Bước 2 chạy TRƯỚC khi trạng thái job chuyển sang kết thúc, nên người poll thấy `running:false`
 * thì lượt tăng cuối đã xong. Tăng hỏng (log, trả null) không làm hỏng job.
 *
 * GIỚI HẠN đã biết: giữa hai lúc trên, hàng thứ hai trở đi vẫn có thể làm một URL chết trong
 * khi cache đang phát câu chép nó; và tiến trình bị dừng giữa job (CI tự deploy) làm mất lượt
 * tăng ở bước 2 cho các hàng sau hàng đầu. Tăng theo từng đợt/hàng sẽ thu hẹp cửa sổ đó nhưng
 * làm cache gần như vô dụng suốt job — đánh đổi chưa được chọn.
 * Buộc dừng (`forceResetSyncJob`) đặt `running:false` NGAY, trước lượt tăng cuối của worker cũ: nếu worker cũ treo
 * mãi (vd. giữa lượt tải R2 của hàng k) thì các hàng 2..k-1 đã commit và đã xoá bản cũ mà không bao giờ có lượt tăng
 * cuối. Cần "Xoá toàn bộ cache" ở /admin/chatbot/answer-cache sau một lần buộc dừng.
 * Một lượt tăng thất bại (`null`) ở hàng đầu được thử lại MỘT lần khi job kết thúc.
 */
import { activityLogs } from '../db/schema'
import { getDb, getPool } from '../utils/db'
import { loadR2Config } from './media'
import { assertUsableR2Config } from '../utils/media-r2'
import { withNamedLock } from '../utils/named-lock'
import { logInfo, logWarn } from '../utils/logger'
import { runBackup } from './backup'
import { bumpAnswerCacheVersion } from './chatbot-answer-cache'
import { abortJobIfRestoreInProgress } from './pre-job-backup'
import { MEDIA_SYNC_LOCK_NAME, repairInterruptedSyncRewrites } from './media-sync-rewrite'
import { hasR2Config, isSyncSuperseded, syncOneToR2, syncOneToLocal } from './media-sync-files'
import { LOCK_TIMEOUT_SECONDS, selectItems, type SyncDirection, type SyncJobStatus } from './media-sync-shared'

const BATCH_SIZE = 20
const BATCH_SLEEP_MS = 500
const PRE_BACKUP_TIMEOUT_MS = 90_000

type Phase = SyncJobStatus['phase']
/** Trạng thái cuối mà `runLocked` trả về; `runSyncWorker` ghi nó SAU lượt tăng phiên bản cuối. */
interface Outcome { phase: Phase, message: string }

/**
 * Worker nền: (giữ khoá) pre-backup → vá URL dở dang → sync từng hàng → done.
 * `owns()` là `generation === currentGeneration` do `media-sync.ts` đóng sẵn.
 */
export async function runSyncWorker(
  job: SyncJobStatus,
  owns: () => boolean,
  direction: SyncDirection,
  adminUserId: number | null,
): Promise<void> {
  const update = (patch: Partial<SyncJobStatus>) => {
    if (owns()) Object.assign(job, patch)
  }
  const finish = (phase: Phase, message: string) => {
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

  const invalidator = answerCacheInvalidator()
  let outcome: Outcome
  try {
    const pool = getPool()
    if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

    const locked = await withNamedLock(pool, MEDIA_SYNC_LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
      return await runLocked(job, owns, update, direction, adminUserId, invalidator)
    })
    outcome = locked.acquired
      ? locked.value
      : { phase: 'failed', message: 'Một lượt đồng bộ khác (có thể là worker cũ đã bị buộc dừng nhưng chưa thoát) vẫn đang giữ khoá. Thử lại sau ít phút.' }
  } catch (err: unknown) {
    logWarn({
      event: 'media.sync_job_failed',
      error: err instanceof Error ? err.message : String(err),
    })
    outcome = { phase: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
  // Mọi đường kết thúc (xong/huỷ/lỗi/bị thay thế) đi qua đây; chỉ tăng khi có gì đã đổi.
  await invalidator.flush()
  finish(outcome.phase, outcome.message)
}

async function runLocked(
  job: SyncJobStatus,
  owns: () => boolean,
  update: (patch: Partial<SyncJobStatus>) => void,
  direction: SyncDirection,
  adminUserId: number | null,
  invalidator: AnswerCacheInvalidator,
): Promise<Outcome> {
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
    // Đang khôi phục CSDL → dừng cả lượt TRƯỚC bước vá URL (lượt ghi đầu tiên): lỗi ném
    // ra tới `runSyncWorker`, trạng thái job `failed` mang câu của `pre-job-backup.ts`
    // (UI poll `sync-status` hiện nó).
    abortJobIfRestoreInProgress(err, 'sync', 'đồng bộ ảnh')
    // Pre-backup fail/timeout khác → cảnh báo nhưng vẫn tiếp sync. Snapshot là bonus,
    // không phải điều kiện tiên quyết — sync vẫn idempotent.
    logWarn({
      event: 'media.sync_pre_backup_failed',
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    if (timer) clearTimeout(timer)
  }

  if (!owns()) return { phase: 'cancelled', message: 'Đã bị buộc dừng.' }
  if (job.cancelling) return { phase: 'cancelled', message: 'Đã hủy sau pre-backup' }

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
  // Vá đã commit từng URL một → nội dung đã đổi dù job sau đó hỏng/huỷ.
  if (repaired.urlsRepaired > 0 || repaired.rowsRewritten > 0) invalidator.markChanged()
  update({ urlsRepaired: repaired.urlsRepaired, articlesRewritten: job.articlesRewritten + repaired.rowsRewritten })

  // ── Phase 3: Sync từng hàng (mỗi hàng nguyên tử) ─────────────────────────
  const items = await selectItems(direction)
  update({
    total: items.length,
    phase: 'sync',
    message: `Đang sync ${direction === 'to-r2' ? 'lên R2' : 'về local'}`,
  })

  for (let i = 0; i < items.length; i += 1) {
    if (!owns()) return { phase: 'cancelled', message: 'Đã bị buộc dừng.' }
    if (job.cancelling) return { phase: 'cancelled', message: `Đã hủy ở ${job.done}/${job.total}` }

    const item = items[i]!
    try {
      const options = { stillOwner: owns, onCommitted: invalidator.onRowCommitted }
      const { rowsRewritten } = direction === 'to-r2'
        ? await syncOneToR2(db, item, r2Config, adminUserId, options)
        : await syncOneToLocal(db, item, r2Config, adminUserId, options)
      update({ synced: job.synced + 1, done: job.done + 1, articlesRewritten: job.articlesRewritten + rowsRewritten })
    } catch (err: unknown) {
      if (isSyncSuperseded(err)) return { phase: 'cancelled', message: 'Đã bị buộc dừng.' }
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

  return { phase: 'done', message: `Sync xong: ${job.synced} file, ${job.skipped} bỏ qua` }
}

interface AnswerCacheInvalidator {
  /** Có thay đổi đã commit mà phiên bản cache chưa được tăng sau đó. */
  markChanged: () => void
  /** Hook sau commit của từng hàng: hàng ĐẦU TIÊN tăng ngay, các hàng sau chỉ đánh dấu. */
  onRowCommitted: () => Promise<void>
  /** Tăng nếu còn thay đổi chưa tăng; không bao giờ ném. */
  flush: () => Promise<void>
}

/**
 * Sổ "đã đổi gì kể từ lần tăng gần nhất". `bumpAnswerCacheVersion` tự log và trả `null` khi hỏng;
 * thêm try/catch ở đây để một bản thay thế ném lỗi cũng không làm hỏng job. Cờ được hạ TRƯỚC
 * lúc tăng: tăng hỏng không được lặp vô hạn, và thay đổi mới chen vào lúc đang tăng vẫn được tính.
 */
function answerCacheInvalidator(): AnswerCacheInvalidator {
  let dirty = false
  let firstRowCommitted = false
  const flush = async () => {
    if (!dirty) return
    dirty = false
    try {
      // `null` = tăng hỏng (đã log). Giữ cờ để lượt kết thúc thử lại; không vòng lặp nào gọi flush lặp lại nên không thử vô hạn.
      if ((await bumpAnswerCacheVersion()) === null) dirty = true
    } catch (err: unknown) {
      logWarn({ event: 'media.sync_cache_bump_failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return {
    markChanged: () => { dirty = true },
    onRowCommitted: async () => {
      dirty = true
      if (firstRowCommitted) return
      firstRowCommitted = true
      await flush()
    },
    flush,
  }
}
