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
 * `to-local`) mới là rollback đúng — idempotent, không mất dữ liệu. Snapshot hỏng thì
 * vẫn sync — trừ khi bị từ chối vì đang khôi phục CSDL: khi đó job `failed` trước lượt
 * ghi đầu tiên (`pre-job-backup.ts`).
 *
 * **File hỏng → bỏ qua + đi tiếp** (try/catch mỗi hàng). Một file R2 fail không
 * chặn cả lượt sync — đã chuyển X file xong thì vẫn giữ X, file hỏng vào
 * `skipped` + `errors`.
 *
 * ── Tệp này giữ ĐÚNG trạng thái job; phần còn lại nằm cạnh ───────────────────
 * `media-sync-worker.ts` (vòng worker + tăng phiên bản cache câu trả lời chatbot — xem đầu tệp
 * đó), `media-sync-shared.ts` (kiểu, hằng số, chọn hàng), `media-sync-legacy.ts` (đường đồng
 * bộ cũ trong một request), `media-sync-files.ts` / `-rewrite.ts` / `-url-match.ts` (từng hàng,
 * thay URL).
 */
import { logWarn } from '../utils/logger'
import { runSyncWorker } from './media-sync-worker'
import { BUSY_MESSAGE, type SyncDirection, type SyncJobStatus } from './media-sync-shared'

export { syncMediaStorage } from './media-sync-legacy'
export type { SyncDirection, SyncJobStatus, SyncResult } from './media-sync-shared'

// ── Job state (cấp module, sống trong tiến trình) ────────────────────────────
// Chủ duy nhất của `currentJob`/`currentGeneration`: worker nhận `job` và `owns()` từ đây,
// không import ngược lại.

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
 * Khởi tạo job sync nền. Trả `{ jobId }` ngay — worker chạy nền, tiến độ qua `getSyncJobStatus()`.
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

  // Worker chạy nền — không await, không block response. Nó tự bắt mọi lỗi; `.catch` chỉ là lưới
  // cuối để một lỗi bất ngờ không thành unhandled rejection làm sập tiến trình.
  const owns = () => generation === currentGeneration
  void runSyncWorker(job, owns, direction, adminUserId).catch((err: unknown) => {
    logWarn({ event: 'media.sync_worker_crashed', error: err instanceof Error ? err.message : String(err) })
  })

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
