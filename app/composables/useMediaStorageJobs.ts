import { onUnmounted, ref } from 'vue'

// Relative paths, not `~/`: tests load this file directly, and the test loader
// (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { useConfirm } from './useConfirm'
import type { useToast } from './useToast'
import type {
  ScanCancelResponse,
  ScanForceResetResponse,
  ScanJobStatus,
  ScanStartResponse,
  ScanStatusResponse,
  ScanSummary,
  SyncCancelResponse,
  SyncDirection,
  SyncForceResetResponse,
  SyncJobStatus,
  SyncStartResponse,
  SyncStatusResponse,
  SyncSummary,
} from '../types/media-scan'

/**
 * The two BACKGROUND jobs of `/admin/media/scan`: the scan of orphaned files and the
 * local ↔ R2 sync. Each `POST` only starts a worker and returns at once; the page then
 * reads the job's status every 3 s until it stops, and toasts the outcome. Moved out of
 * the page verbatim when it was split (wave3 4.1); the page keeps the counts and the
 * three one-shot repairs, and calls both composables in its own `setup`.
 *
 * `toast` and `confirm` are the page's own (`useToast()`/`useConfirm()`), handed in, so
 * this file needs no Nuxt auto-import (tests/admin-media-scan-page.test.ts drives it
 * through the page's buttons).
 *
 * Two fixes over the pre-split page, each pinned by a test:
 *   - leaving the page while the first status read or a start request is still in flight
 *     no longer starts a 3-second poll afterwards — `onUnmounted` had already run, so
 *     nothing would ever stop it (`usePollTimer`);
 *   - "Hủy" answered `{ ok: false }` (HTTP 200: the job ended between two polls) shows the
 *     server's sentence instead of claiming a cancel was sent.
 */
export interface MediaJobDeps {
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error' | 'warning' | 'info'>
  confirm: ReturnType<typeof useConfirm>['confirm']
  /** A job this page was following just ended: re-read the local/R2 counts. */
  onFinished: () => Promise<void>
}

const POLL_INTERVAL_MS = 3000

/** The 3-second status poll of one job. Never armed once the page has left. */
function usePollTimer(poll: () => Promise<void>) {
  let timer: ReturnType<typeof setInterval> | null = null
  let left = false
  const start = () => {
    if (timer || left) return
    timer = setInterval(poll, POLL_INTERVAL_MS)
  }
  const stop = () => {
    if (timer) { clearInterval(timer); timer = null }
  }
  onUnmounted(() => { left = true; stop() })
  return { start, stop }
}

// ─── Quét thư mục uploads ─────────────────────────────────────────────────────
// Ai đó copy ảnh thẳng vào public/uploads/ (SCP, rsync, backup) thì tệp tồn tại
// trên đĩa nhưng không có hàng `media` → không hiện trên cổng. Nút này quét + tự
// động tạo hàng cho mọi tệp mồ côi.
//
// Worker nền: POST /scan chỉ khởi tạo job → trả ngay. Worker chạy nền, từng
// batch 50 file, sleep 200ms. UI poll /scan-status mỗi 3s.
export function useMediaScanJob({ toast, confirm, onFinished }: MediaJobDeps) {
  const scanning = ref(false)
  const scanResult = ref<ScanSummary | null>(null)
  const autoRepointToR2 = ref(false)
  const scanJob = ref<ScanJobStatus | null>(null)
  const forceResettingScan = ref(false)

  const timer = usePollTimer(() => pollScanStatus())

  async function pollScanStatus() {
    try {
      const res = await adminFetch<ScanStatusResponse>('/api/admin/media/scan-status')
      scanJob.value = res.status
      if (res.status?.running) {
        scanning.value = true
      } else {
        if (scanning.value && res.status) {
          scanning.value = false
          scanResult.value = { imported: res.status.imported, skipped: res.status.skipped, truncated: res.status.truncated }
          if (res.status.phase === 'done') {
            if (res.status.imported > 0) {
              toast.success(`Đã nhập ${res.status.imported} tệp ảnh${res.status.skipped > 0 ? `, bỏ qua ${res.status.skipped} tệp` : ''}.`)
            } else if (res.status.skipped > 0) {
              toast.info(`Không có tệp mới. Bỏ qua ${res.status.skipped} tệp.`)
            } else {
              toast.info('Không có tệp mới để nhập.')
            }
            if (res.status.truncated) toast.warning('Đạt giới hạn 5000 tệp. Chạy lại để quét tiếp.')
          } else if (res.status.phase === 'failed') {
            toast.error(`Quét lỗi: ${res.status.message}`)
          } else if (res.status.phase === 'cancelled') {
            toast.info(`Đã hủy: ${res.status.message}`)
          }
          await onFinished()
        }
        timer.stop()
      }
    } catch { /* không chặn poll */ }
  }

  const scanFolder = async () => {
    scanning.value = true
    scanResult.value = null
    try {
      await adminFetch<ScanStartResponse>('/api/admin/media/scan', {
        method: 'POST',
        body: { autoRepointToR2: autoRepointToR2.value },
      })
      toast.info(autoRepointToR2.value
        ? 'Đã khởi tạo job quét + tự đẩy R2. Đang chạy nền...'
        : 'Đã khởi tạo job quét. Đang chạy nền...')
      timer.start()
      await pollScanStatus()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi khởi tạo quét'))
      scanning.value = false
    }
  }

  const cancelScan = async () => {
    try {
      const res = await adminFetch<ScanCancelResponse>('/api/admin/media/scan-cancel', { method: 'POST' })
      // `ok: false` = the job ended between two polls; the next poll shows how it ended.
      toast.info(res.ok ? 'Đã yêu cầu hủy. Worker dừng ở batch tiếp theo.' : res.message)
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi hủy quét'))
    }
  }

  const forceResetScan = async () => {
    if (!await confirm({
      message: 'Buộc gỡ kẹt job quét đang treo? Job sẽ dừng ngay và có thể chạy lại. Worker cũ (nếu còn) sẽ tự hết.',
      confirmLabel: 'Gỡ kẹt job',
      danger: true,
    })) return
    forceResettingScan.value = true
    try {
      const res = await adminFetch<ScanForceResetResponse>('/api/admin/media/scan-force-reset', { method: 'POST' })
      toast.success(res.message)
      await pollScanStatus()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi gỡ kẹt quét'))
    } finally {
      forceResettingScan.value = false
    }
  }

  /** On mount: a scan from an earlier visit (or a restart mid-job) may still run — follow it. */
  const resumeScan = () => pollScanStatus().then(() => { if (scanJob.value?.running) timer.start() })

  return { scanning, scanResult, autoRepointToR2, scanJob, forceResettingScan, scanFolder, cancelScan, forceResetScan, resumeScan }
}

// ─── Đồng bộ storage (local ↔ R2) ────────────────────────────────────────────
// Chuyển toàn bộ ảnh sang storage bên kia: tải sang, xoá bản cũ, cập nhật URL
// trong SQL + rich-text bài viết. Chỉ ảnh (bảng `media`), không video.
//
// Worker nền: POST /sync-storage chỉ khởi tạo job → trả ngay. Worker chạy nền
// trong tiến trình, từng batch 20 file, sleep 500ms. UI poll /sync-status mỗi
// 3s để hiện tiến độ. Trước sync, worker tự backup (snapshot recover thủ công).
export function useMediaSyncJob({ toast, confirm, onFinished }: MediaJobDeps) {
  const syncing = ref(false)
  const syncDirection = ref<SyncDirection | ''>('')
  const syncResult = ref<SyncSummary | null>(null)
  // Trạng thái job nền (poll mỗi 3s).
  const jobStatus = ref<SyncJobStatus | null>(null)
  const forceResettingSync = ref(false)

  const timer = usePollTimer(() => pollStatus())

  async function pollStatus() {
    try {
      const res = await adminFetch<SyncStatusResponse>('/api/admin/media/sync-status')
      jobStatus.value = res.status
      if (res.status?.running) {
        syncing.value = true
        syncDirection.value = res.status.direction
      } else {
        // Job xong — dừng poll + hiện kết quả.
        if (syncing.value && res.status) {
          syncing.value = false
          syncDirection.value = ''
          if (res.status.phase === 'done') {
            toast.success(`Đã chuyển ${res.status.synced} ảnh sang ${res.status.direction === 'to-r2' ? 'R2' : 'local'}${res.status.skipped > 0 ? `, bỏ qua ${res.status.skipped}` : ''}.${res.status.articlesRewritten > 0 ? ` Đã sửa URL trong ${res.status.articlesRewritten} bài viết.` : ''}${res.status.preBackupStamp ? ` Snapshot: ${res.status.preBackupStamp}.` : ''}`)
          } else if (res.status.phase === 'failed') {
            toast.error(`Sync lỗi: ${res.status.message}`)
          } else if (res.status.phase === 'cancelled') {
            toast.info(`Đã hủy: ${res.status.message}`)
          }
          syncResult.value = { synced: res.status.synced, skipped: res.status.skipped, articlesRewritten: res.status.articlesRewritten }
          await onFinished()
        }
        timer.stop()
      }
    } catch { /* không chặn poll */ }
  }

  const syncStorage = async (direction: SyncDirection) => {
    syncing.value = true
    syncDirection.value = direction
    syncResult.value = null
    try {
      await adminFetch<SyncStartResponse>('/api/admin/media/sync-storage', {
        method: 'POST',
        body: { direction },
      })
      toast.info('Đã khởi tạo job sync. Đang chạy nền...')
      timer.start()
      await pollStatus()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi khởi tạo sync'))
      syncing.value = false
      syncDirection.value = ''
    }
  }

  const cancelSync = async () => {
    try {
      const res = await adminFetch<SyncCancelResponse>('/api/admin/media/sync-cancel', { method: 'POST' })
      // `ok: false` = the job ended between two polls; the next poll shows how it ended.
      toast.info(res.ok ? 'Đã yêu cầu hủy. Worker sẽ dừng ở batch tiếp theo.' : res.message)
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi hủy sync'))
    }
  }

  const forceResetSync = async () => {
    if (!await confirm({
      message: 'Buộc gỡ kẹt job sync đang treo? Job sẽ dừng ngay và có thể chạy lại. Worker cũ (nếu còn) sẽ tự hết — lần chạy mới có timeout 90s cho pre-backup.',
      confirmLabel: 'Gỡ kẹt job',
      danger: true,
    })) return
    forceResettingSync.value = true
    try {
      const res = await adminFetch<SyncForceResetResponse>('/api/admin/media/sync-force-reset', { method: 'POST' })
      toast.success(res.message)
      await pollStatus()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Lỗi gỡ kẹt sync'))
    } finally {
      forceResettingSync.value = false
    }
  }

  /** On mount: a sync from an earlier visit (or a restart mid-job) may still run — follow it. */
  const resumeSync = () => pollStatus().then(() => { if (jobStatus.value?.running) timer.start() })

  return { syncing, syncDirection, syncResult, jobStatus, forceResettingSync, syncStorage, cancelSync, forceResetSync, resumeSync }
}
