import { computed, onBeforeUnmount, ref } from 'vue'

// Relative paths, not `~/`: tests import this file directly, and the test loader
// (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage, errorStatus } from '../utils/errorMessage'
import { rescanAiNotice, rescanFinishedToast, rescanSummaryText } from '../utils/moderation-rescan-summary'
import type { useConfirm } from './useConfirm'
import type { useToast } from './useToast'
import type {
  ModerationRescanStartResponse,
  ModerationRescanStatus,
  ModerationRestartServerResponse,
  ModerationRestartWorkerResponse,
  ModerationWorkerStatus,
  ModerationWorkerStatusResponse,
} from '../types/moderation'

/**
 * Tab "Trạng thái Worker & Hệ thống" of `/admin/ai/moderation`: the worker's status, the
 * background "Quét & dọn" run (started here, polled every 3 s while it runs) and the two
 * restarts. Moved out of the page verbatim when it was split (wave3 4.1) — the page keeps
 * the load/error/retry contract and calls `loadWorkerStatus` in its `loadData`.
 *
 * `toast` and `confirm` are the page's own (`useToast()`/`useConfirm()`), handed in rather
 * than called here, so this file needs no Nuxt auto-import and runs as is under the tests
 * (tests/admin-moderation-page.test.ts drives it through the page's buttons).
 */
export interface ModerationWorkerDeps {
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error' | 'warning' | 'info'>
  confirm: ReturnType<typeof useConfirm>['confirm']
  /** A rescan just ended (it may have hidden or deleted rows): reload the review queue. */
  onRescanFinished: () => void
}

/** Lượt quét tự dừng giữa chừng (máy chủ mất khoá đơn luồng) — phần đã quét giữ nguyên, lượt sau quét tiếp. */
const RESCAN_STOPPED_TEXT = 'Lượt quét gần nhất đã tạm dừng vì máy chủ mất kết nối giữa chừng. Chạy lại để quét tiếp phần còn lại.'

export function useModerationWorker({ toast, confirm, onRescanFinished }: ModerationWorkerDeps) {
  const workerData = ref<ModerationWorkerStatus | null>(null)
  const workerLoading = ref(false)
  // `workerPendingCount` = `pendingQueueCount` của worker-status, `null` khi lượt đọc hỏng
  // (huy hiệu ẩn, không hiện "0").
  const workerPendingCount = ref<number | null>(null)
  const rescanning = ref(false)
  const rescanStatus = ref<ModerationRescanStatus | null>(null)
  // Nút khoá cả khi request đang gửi lẫn khi job nền đang chạy (kể cả sau khi tải lại trang).
  const rescanBusy = computed(() => rescanning.value || rescanStatus.value?.state === 'running')
  const rescanProgressText = computed(() => {
    const s = rescanStatus.value
    if (!s) return ''
    if (s.state === 'running') {
      const p = s.progress
      if (!p) return 'Đang chuẩn bị quét...'
      return p.phase === 'messages'
        ? `Đang quét tin chat trực tiếp ${p.scannedMessages}/${p.totalMessages} · đã xóa ${p.deletedMessages}${p.failedMessages ? ` · lỗi ${p.failedMessages}` : ''}`
        : `Đang quét bình luận ${p.scannedComments}/${p.totalComments} · đã ẩn ${p.hiddenComments}${p.failedComments ? ` · lỗi ${p.failedComments}` : ''}`
    }
    if (s.state === 'completed' && s.summary) return rescanSummaryText(s.summary)
    if (s.state === 'failed') return 'Lượt quét gần nhất bị dừng do lỗi. Có thể chạy lại.'
    if (s.state === 'stopped') return RESCAN_STOPPED_TEXT
    return ''
  })
  const rescanAiUnavailableText = computed(() =>
    rescanStatus.value?.state === 'completed' ? rescanAiNotice(rescanStatus.value.summary) : '',
  )
  let rescanPollTimer: ReturnType<typeof setTimeout> | null = null
  /** The "back to this page" redirect 4 s after a website restart — cancelled if the officer leaves first. */
  let restartRedirectTimer: ReturnType<typeof setTimeout> | null = null
  let pageUnmounted = false
  const restartingWorker = ref(false)
  const restartingServer = ref(false)

  async function loadWorkerStatus() {
    workerLoading.value = true
    try {
      const res = await adminFetch<ModerationWorkerStatusResponse>('/api/admin/ai/moderation/worker-status')
      if (res.ok) {
        workerData.value = res.worker
        workerPendingCount.value = res.worker.pendingQueueCount
        applyRescanStatus(res.rescan ?? null)
      }
    } catch {
      // Non-blocking status lookup — nhưng số "pending" cũ không còn đáng tin: ẩn huy hiệu.
      workerPendingCount.value = null
    } finally {
      workerLoading.value = false
    }
    scheduleRescanPoll()
  }

  /** Cập nhật trạng thái job; khi job vừa chạy xong thì báo kết quả và tải lại hàng đợi. */
  function applyRescanStatus(next: ModerationRescanStatus | null) {
    const wasRunning = rescanStatus.value?.state === 'running'
    rescanStatus.value = next
    if (!wasRunning || !next || next.state === 'running') return
    if (next.state === 'completed' && next.summary) {
      const done = rescanFinishedToast(next.summary)
      if (done.type === 'warning') toast.warning(done.message)
      else toast.success(done.message)
    } else if (next.state === 'failed') {
      toast.error('Lượt quét lại bị dừng do lỗi. Vui lòng thử lại.')
    } else if (next.state === 'stopped') {
      toast.warning(RESCAN_STOPPED_TEXT)
    }
    onRescanFinished()
  }

  /** Hỏi lại trạng thái mỗi 3 giây, chỉ khi job nền đang chạy. */
  function scheduleRescanPoll() {
    // `pageUnmounted`: một lượt fetch trạng thái còn bay lúc rời trang không được
    // hẹn lại timer sau khi onBeforeUnmount đã dọn.
    if (pageUnmounted || rescanPollTimer || rescanStatus.value?.state !== 'running') return
    rescanPollTimer = setTimeout(() => {
      rescanPollTimer = null
      void loadWorkerStatus()
    }, 3000)
  }

  onBeforeUnmount(() => {
    pageUnmounted = true
    if (rescanPollTimer) clearTimeout(rescanPollTimer)
    rescanPollTimer = null
    if (restartRedirectTimer) clearTimeout(restartRedirectTimer)
    restartRedirectTimer = null
  })

  async function triggerRestartWorker() {
    const ok = await confirm({
      title: 'Khởi động lại Moderation Worker',
      message: 'Khởi động lại worker sẽ làm mới bộ đệm quy tắc trong RAM và đặt lại bộ đếm lỗi. Tiếp tục?',
      confirmText: 'Khởi động lại Worker',
      tone: 'primary',
    })
    if (!ok) return

    restartingWorker.value = true
    try {
      const res = await adminFetch<ModerationRestartWorkerResponse>('/api/admin/ai/moderation/restart-worker', { method: 'POST' })
      toast.success(res.message || 'Đã khởi động lại Moderation Worker.')
      await loadWorkerStatus()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể khởi động lại worker.'))
    } finally {
      restartingWorker.value = false
    }
  }

  async function triggerRescanAll() {
    const ok = await confirm({
      title: 'Quét & dọn sạch nội dung bẩn cũ',
      message: `Hệ thống sẽ quét lại ở nền các bình luận bài viết, video (qua AI, tối đa ${rescanStatus.value?.limits?.maxComments ?? 'một số'} bình luận mỗi lượt, mới nhất trước) và tin chat trực tiếp đang hiển thị. Nội dung vi phạm sẽ được tự động ẩn hoặc xóa. Tiến độ hiện ngay dưới nút. Tiếp tục?`,
      confirmText: 'Bắt đầu quét & dọn dẹp',
      tone: 'danger',
    })
    if (!ok) return

    rescanning.value = true
    try {
      // 202: job đã bắt đầu ở nền — tiến độ x/y hiện dưới nút, cập nhật bằng polling.
      const res = await adminFetch<ModerationRescanStartResponse>('/api/admin/ai/moderation/rescan-all', { method: 'POST' })
      toast.info(res.message)
      rescanStatus.value = res.rescan
      scheduleRescanPoll()
    } catch (err: unknown) {
      if (errorStatus(err) === 409) {
        // Đã có lượt khác chạy: không phải lỗi của cán bộ — hiện tiến độ của lượt đó.
        toast.warning(errorMessage(err, 'Đang có một lượt quét lại chạy.'))
        await loadWorkerStatus()
      } else {
        toast.error(errorMessage(err, 'Không thể quét lại nội dung.'))
      }
    } finally {
      rescanning.value = false
    }
  }

  async function triggerRestartServer() {
    const ok = await confirm({
      title: 'Khởi động lại máy chủ Website',
      message: 'CẢNH BÁO: Thao tác này sẽ gửi tín hiệu khởi động lại tiến trình máy chủ website (process restart). Website có thể gián đoạn trong 3-5 giây. Bạn có chắc chắn?',
      confirmText: 'Khởi động lại Website',
      tone: 'danger',
    })
    if (!ok) return

    restartingServer.value = true
    try {
      const res = await adminFetch<ModerationRestartServerResponse>('/api/admin/ai/moderation/restart-server', { method: 'POST' })
      toast.success(res.message)
      // Left the page while the request was out: no redirect to schedule (nor to clear).
      if (pageUnmounted) return
      restartRedirectTimer = setTimeout(() => {
        restartRedirectTimer = null
        window.location.replace('/admin/ai/moderation')
      }, 4000)
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể gửi lệnh khởi động lại.'))
      restartingServer.value = false
    }
  }

  return {
    workerData,
    workerLoading,
    workerPendingCount,
    rescanBusy,
    rescanProgressText,
    rescanAiUnavailableText,
    restartingWorker,
    restartingServer,
    loadWorkerStatus,
    triggerRestartWorker,
    triggerRescanAll,
    triggerRestartServer,
  }
}
