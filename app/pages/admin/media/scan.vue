<script setup lang="ts">
import type { AdminMediaRow } from '~/types/admin-api'
import { errorMessage } from '~/utils/errorMessage'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()

// ─── Quét thư mục uploads ─────────────────────────────────────────────────────
// Ai đó copy ảnh thẳng vào public/uploads/ (SCP, rsync, backup) thì tệp tồn tại
// trên đĩa nhưng không có hàng `media` → không hiện trên cổng. Nút này quét + tự
// động tạo hàng cho mọi tệp mồ côi.
//
// Worker nền: POST /scan chỉ khởi tạo job → trả ngay. Worker chạy nền, từng
// batch 50 file, sleep 200ms. UI poll /scan-status mỗi 3s.
const scanning = ref(false)
const scanResult = ref<{ imported: number; skipped: number; truncated: boolean } | null>(null)

interface ScanJobStatus {
  jobId: string
  running: boolean
  cancelling: boolean
  total: number
  done: number
  imported: number
  skipped: number
  errors: string[]
  phase: 'scanning' | 'done' | 'failed' | 'cancelled'
  message: string
  startedAt: number
  finishedAt: number | null
  truncated: boolean
}
const scanJob = ref<ScanJobStatus | null>(null)
let scanPollTimer: ReturnType<typeof setInterval> | null = null

const scanPhaseLabel: Record<ScanJobStatus['phase'], string> = {
  scanning: 'Đang quét',
  done: 'Xong',
  failed: 'Lỗi',
  cancelled: 'Đã hủy',
}

const scanProgressPercent = computed(() => {
  if (!scanJob.value || scanJob.value.total === 0) return 0
  return Math.min(100, Math.round((scanJob.value.done / scanJob.value.total) * 100))
})

const pollScanStatus = async () => {
  try {
    const res = await $fetch<{ ok: boolean, status: ScanJobStatus | null }>('/api/admin/media/scan-status')
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
        await loadCounts()
      }
      stopScanPolling()
    }
  } catch { /* không chặn poll */ }
}

const startScanPolling = () => {
  if (scanPollTimer) return
  scanPollTimer = setInterval(pollScanStatus, 3000)
}

const stopScanPolling = () => {
  if (scanPollTimer) { clearInterval(scanPollTimer); scanPollTimer = null }
}

const scanFolder = async () => {
  scanning.value = true
  scanResult.value = null
  try {
    await $fetch('/api/admin/media/scan', { method: 'POST' })
    toast.info('Đã khởi tạo job quét. Đang chạy nền...')
    startScanPolling()
    await pollScanStatus()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi khởi tạo quét'))
    scanning.value = false
  }
}

const cancelScan = async () => {
  try {
    await $fetch('/api/admin/media/scan-cancel', { method: 'POST' })
    toast.info('Đã yêu cầu hủy. Worker dừng ở batch tiếp theo.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi hủy quét'))
  }
}

const scanStalled = computed(() => {
  if (!scanJob.value?.running) return false
  // Treo > 90s ở cùng phase mà chưa tăng `done` → coi là kẹt.
  return Date.now() - scanJob.value.startedAt > 90_000 && scanJob.value.done === 0
})
const forceResettingScan = ref(false)
const forceResetScan = async () => {
  if (!confirm('Buộc gỡ kẹt job quét đang treo? Job sẽ dừng ngay và có thể chạy lại. Worker cũ (nếu còn) sẽ tự hết.')) return
  forceResettingScan.value = true
  try {
    const res = await $fetch<{ ok: boolean; message: string }>('/api/admin/media/scan-force-reset', { method: 'POST' })
    toast.success(res.message)
    await pollScanStatus()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi gỡ kẹt quét'))
  } finally {
    forceResettingScan.value = false
  }
}

// ─── Đồng bộ storage (local ↔ R2) ────────────────────────────────────────────
// Chuyển toàn bộ ảnh sang storage bên kia: tải sang, xoá bản cũ, cập nhật URL
// trong SQL + rich-text bài viết. Chỉ ảnh (bảng `media`), không video.
//
// Worker nền: POST /sync-storage chỉ khởi tạo job → trả ngay. Worker chạy nền
// trong tiến trình, từng batch 20 file, sleep 500ms. UI poll /sync-status mỗi
// 3s để hiện tiến độ. Trước sync, worker tự backup (snapshot recover thủ công).
const syncing = ref(false)
const syncDirection = ref<'to-r2' | 'to-local' | ''>('')
const syncResult = ref<{ synced: number; skipped: number; articlesRewritten: number } | null>(null)
const counts = ref<{ local: number; r2: number }>({ local: 0, r2: 0 })

// Trạng thái job nền (poll mỗi 3s).
interface SyncJobStatus {
  jobId: string
  direction: 'to-r2' | 'to-local'
  running: boolean
  cancelling: boolean
  total: number
  done: number
  synced: number
  skipped: number
  errors: string[]
  articlesRewritten: number
  phase: 'backup' | 'sync' | 'rewrite' | 'done' | 'failed' | 'cancelled'
  message: string
  startedAt: number
  finishedAt: number | null
  preBackupStamp: string | null
}
const jobStatus = ref<SyncJobStatus | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

const phaseLabel: Record<SyncJobStatus['phase'], string> = {
  backup: 'Đang backup trước sync',
  sync: 'Đang sync',
  rewrite: 'Đang thay URL bài viết',
  done: 'Xong',
  failed: 'Lỗi',
  cancelled: 'Đã hủy',
}

const progressPercent = computed(() => {
  if (!jobStatus.value || jobStatus.value.total === 0) return 0
  return Math.min(100, Math.round((jobStatus.value.done / jobStatus.value.total) * 100))
})

const loadCounts = async () => {
  try {
    const res = await $fetch<{ local: number; r2: number }>('/api/admin/media/counts')
    counts.value = { local: res.local ?? 0, r2: res.r2 ?? 0 }
  } catch { /* không chặn trang */ }
}

const pollStatus = async () => {
  try {
    const res = await $fetch<{ ok: boolean, status: SyncJobStatus | null }>('/api/admin/media/sync-status')
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
        await loadCounts()
      }
      stopPolling()
    }
  } catch { /* không chặn poll */ }
}

const startPolling = () => {
  if (pollTimer) return
  pollTimer = setInterval(pollStatus, 3000)
}

const stopPolling = () => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

const syncStorage = async (direction: 'to-r2' | 'to-local') => {
  syncing.value = true
  syncDirection.value = direction
  syncResult.value = null
  try {
    await $fetch('/api/admin/media/sync-storage', {
      method: 'POST',
      body: { direction },
    })
    toast.info('Đã khởi tạo job sync. Đang chạy nền...')
    startPolling()
    await pollStatus()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi khởi tạo sync'))
    syncing.value = false
    syncDirection.value = ''
  }
}

const cancelSync = async () => {
  try {
    await $fetch('/api/admin/media/sync-cancel', { method: 'POST' })
    toast.info('Đã yêu cầu hủy. Worker sẽ dừng ở batch tiếp theo.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi hủy sync'))
  }
}

const syncStalled = computed(() => {
  if (!jobStatus.value?.running) return false
  return Date.now() - jobStatus.value.startedAt > 90_000 && jobStatus.value.done === 0
})
const forceResettingSync = ref(false)
const forceResetSync = async () => {
  if (!confirm('Buộc gỡ kẹt job sync đang treo? Job sẽ dừng ngay và có thể chạy lại. Worker cũ (nếu còn) sẽ tự hết — lần chạy mới có timeout 90s cho pre-backup.')) return
  forceResettingSync.value = true
  try {
    const res = await $fetch<{ ok: boolean; message: string }>('/api/admin/media/sync-force-reset', { method: 'POST' })
    toast.success(res.message)
    await pollStatus()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi gỡ kẹt sync'))
  } finally {
    forceResettingSync.value = false
  }
}

onMounted(() => {
  loadCounts()
  // Kiểm tra job đang chạy từ session trước (restart container giữa sync/scan).
  pollStatus().then(() => { if (jobStatus.value?.running) startPolling() })
  pollScanStatus().then(() => { if (scanJob.value?.running) startScanPolling() })
})

onUnmounted(() => { stopPolling(); stopScanPolling() })

// ─── Đổi domain URL R2 ─────────────────────────────────────────────────────────
// Đổi domain CDN R2 (cùng account + bucket) — chỉ update URL trong DB, không
// tải file. Chạy < 2 giây. Tự backup SQL trước (snapshot recover thủ công).
const repointing = ref(false)
const oldDomain = ref('')
const newDomain = ref('')
const repointResult = ref<{ mediaUpdated: number; articlesUpdated: number; backupStamp: string | null } | null>(null)

const repointUrls = async () => {
  if (!oldDomain.value.trim() || !newDomain.value.trim()) {
    toast.error('Cần nhập cả domain cũ và domain mới.')
    return
  }
  if (oldDomain.value.trim() === newDomain.value.trim()) {
    toast.error('Domain cũ và domain mới giống nhau.')
    return
  }
  if (!confirm(`Đổi URL R2 từ "${oldDomain.value}" sang "${newDomain.value}"?\n\nSẽ UPDATE media.url + articles.content. Tự backup SQL trước (snapshot recover thủ công).`)) return
  repointing.value = true
  repointResult.value = null
  try {
    const res = await $fetch<{ ok: boolean, mediaUpdated: number, articlesUpdated: number, backupStamp: string | null, message: string }>('/api/admin/media/repoint-r2-urls', {
      method: 'POST',
      body: { oldDomain: oldDomain.value.trim(), newDomain: newDomain.value.trim() },
    })
    repointResult.value = { mediaUpdated: res.mediaUpdated, articlesUpdated: res.articlesUpdated, backupStamp: res.backupStamp }
    toast.success(res.message)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi đổi domain URL'))
  } finally {
    repointing.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Quét & Đồng bộ Media</h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Thao tác hàng loạt lên thư viện ảnh — quét tệp mồ côi và chuyển storage giữa local / R2.</p>
    </div>

    <!-- Nút quay lại -->
    <NuxtLink to="/admin/media" class="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#2c6e33] no-underline hover:underline">
      <i class="fa-regular fa-arrow-left" aria-hidden="true"></i> Về Thư viện Media
    </NuxtLink>

    <!-- ─── Section 1: Quét thư mục ───────────────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-3">
      <header class="flex items-start gap-3">
        <i class="fa-solid fa-folder-tree text-2xl text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
        <div>
          <h2 class="m-0 text-base font-bold text-[#122815]">Quét thư mục ảnh mồ côi</h2>
          <p class="m-0 mt-1 text-[0.82rem] text-[#667768]">Duyệt đệ quy <code class="rounded bg-[#f0f7f1] px-1.5 py-0.5 font-mono text-[0.78rem]">public/uploads/</code> và tự động nhập ảnh chưa có hàng CSDL. Hữu ích khi copy ảnh thẳng vào thư mục (SCP, rsync, backup).</p>
        </div>
      </header>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer transition-colors hover:bg-[#1e4620] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="scanning"
          :aria-busy="scanning"
          @click="scanFolder"
        >
          <i class="fa-solid fa-folder-tree" :class="scanning ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
          {{ scanning ? 'Đang quét...' : 'Bắt đầu quét' }}
        </button>
        <button
          v-if="scanning"
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-[#a32924] bg-white px-4 py-2.5 text-sm font-bold text-[#a32924] cursor-pointer transition-colors hover:bg-[#fdf0f0] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="scanJob?.cancelling"
          @click="cancelScan"
        >
          <i class="fa-solid fa-stop" aria-hidden="true"></i>
          {{ scanJob?.cancelling ? 'Đang dừng...' : 'Hủy quét' }}
        </button>
        <button
          v-if="scanStalled"
          type="button"
          class="inline-flex items-center gap-2 rounded-lg bg-[#a32924] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#7a1e1c] disabled:opacity-50"
          :disabled="forceResettingScan"
          :aria-busy="forceResettingScan"
          @click="forceResetScan"
        >
          <i class="fa-solid" :class="forceResettingScan ? 'fa-spinner animate-spin' : 'fa-bolt'" aria-hidden="true"></i>
          {{ forceResettingScan ? 'Đang gỡ...' : 'Buộc gỡ kẹt' }}
        </button>
        <span v-if="scanning" class="text-sm text-[#667768]">Đang chạy nền. Có thể đóng trang — worker tiếp tục.</span>
      </div>

      <!-- Tiến độ job quét -->
      <div v-if="scanJob" class="rounded-lg border border-[#cce5cd] bg-[#f0f7f1] p-4 flex flex-col gap-2" role="status" :aria-busy="scanJob.running">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm font-bold text-[#122815]">
            <i
              class="fa-solid mr-1.5"
              :class="{
                'fa-spinner animate-spin': scanJob.running && !scanJob.cancelling,
                'fa-check-circle text-[#2c6e33]': scanJob.phase === 'done',
                'fa-circle-xmark text-[#a32924]': scanJob.phase === 'failed',
                'fa-circle-stop text-[#8a6412]': scanJob.phase === 'cancelled',
              }"
              aria-hidden="true"
            ></i>
            {{ scanPhaseLabel[scanJob.phase] }}
            <span v-if="scanJob.cancelling" class="text-[#8a6412]">(đang dừng)</span>
          </span>
          <span class="text-xs text-[#667768]">
            {{ scanJob.done }} / {{ scanJob.total }} file
            <span v-if="scanJob.total > 0">· {{ scanProgressPercent }}%</span>
          </span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-[#d0ddd1]" role="progressbar" :aria-valuenow="scanProgressPercent" aria-valuemin="0" aria-valuemax="100">
          <div class="h-full rounded-full bg-[#2c6e33] transition-all duration-300" :style="{ width: `${scanProgressPercent}%` }"></div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <div><span class="font-bold text-[#1e4620]">{{ scanJob.imported }}</span><span class="text-[#667768]"> đã nhập</span></div>
          <div><span class="font-bold text-[#667768]">{{ scanJob.skipped }}</span><span class="text-[#667768]"> bỏ qua</span></div>
          <div class="text-[#667768]">{{ scanJob.message }}</div>
        </div>
        <div v-if="scanJob.truncated" class="text-xs text-[#8a6412]">
          <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
          Đạt giới hạn 5000 tệp — chạy lại để quét tiếp.
        </div>
        <div v-if="scanJob.errors.length > 0" class="text-xs text-[#a32924]">
          <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
          {{ scanJob.errors.length }} file lỗi: {{ scanJob.errors.slice(0, 5).join(', ') }}{{ scanJob.errors.length > 5 ? '...' : '' }}
        </div>
      </div>

      <!-- Kết quả quét (giữ hiện sau khi xong) -->
      <div v-if="scanResult && !scanning" class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
        <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Đã nhập</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#1e4620]">{{ scanResult.imported }}</p>
        </div>
        <div class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Bỏ qua</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#667768]">{{ scanResult.skipped }}</p>
        </div>
        <div v-if="scanResult.truncated" class="rounded-lg border border-[#f0dcae] bg-[#fdf6e7] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#8a6412]">Cắt ngang</p>
          <p class="m-0 mt-1 text-sm font-bold text-[#8a6412]">Đạt 5000 tệp — chạy lại để quét tiếp</p>
        </div>
      </div>
      <p v-if="scanResult && scanResult.imported > 0 && !scanning" class="m-0 text-sm">
        <NuxtLink to="/admin/media" class="text-[#2c6e33] font-semibold no-underline hover:underline">Xem thư viện →</NuxtLink>
      </p>
    </section>

    <!-- ─── Section 2: Đồng bộ storage ────────────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-3">
      <header class="flex items-start gap-3">
        <i class="fa-solid fa-cloud-arrow-up text-2xl text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
        <div>
          <h2 class="m-0 text-base font-bold text-[#122815]">Đồng bộ storage ảnh</h2>
          <p class="m-0 mt-1 text-[0.82rem] text-[#667768]">Chuyển toàn bộ ảnh sang storage bên kia — tải sang, xoá bản cũ, cập nhật URL trong CSDL + bài viết. Chỉ ảnh (bảng <code class="font-mono">media</code>).</p>
        </div>
      </header>

      <!-- Số lượng hiện tại -->
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-3 text-center">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Local</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#122815]">{{ counts.local }}</p>
        </div>
        <div class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-3 text-center">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">R2</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#122815]">{{ counts.r2 }}</p>
        </div>
      </div>

      <!-- Cảnh báo -->
      <div class="rounded-lg border border-[#f0dcae] bg-[#fdf6e7] px-3.5 py-2.5 text-[0.82rem] text-[#8a6412]" role="status">
        <i class="fa-solid fa-triangle-exclamation mt-0.5 mr-1.5" aria-hidden="true"></i>
        <span>Ảnh đã nhúng trong bài viết sẽ được tự thay URL sang storage mới. Trước khi sync, hệ thống tự backup (SQL + file) để recover thủ công nếu lỗi — không auto rollback (restore toàn DB mất dữ liệu unrelated). Để hoàn tác, chạy sync ngược.</span>
      </div>

      <!-- Nút đồng bộ -->
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 text-sm font-bold text-[#2c6e33] cursor-pointer transition-colors hover:bg-[#f0f7f1] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="syncing || counts.local === 0"
          :aria-busy="syncing && syncDirection === 'to-r2'"
          @click="syncStorage('to-r2')"
        >
          <i class="fa-solid fa-cloud-arrow-up" :class="syncing && syncDirection === 'to-r2' ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
          {{ syncing && syncDirection === 'to-r2' ? 'Đang chuyển lên R2...' : 'Đồng bộ lên R2' }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 text-sm font-bold text-[#2c6e33] cursor-pointer transition-colors hover:bg-[#f0f7f1] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="syncing || counts.r2 === 0"
          :aria-busy="syncing && syncDirection === 'to-local'"
          @click="syncStorage('to-local')"
        >
          <i class="fa-solid fa-cloud-arrow-down" :class="syncing && syncDirection === 'to-local' ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
          {{ syncing && syncDirection === 'to-local' ? 'Đang chuyển về local...' : 'Đồng bộ về local' }}
        </button>
        <button
          v-if="syncing"
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-[#a32924] bg-white px-4 py-2.5 text-sm font-bold text-[#a32924] cursor-pointer transition-colors hover:bg-[#fdf0f0] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="jobStatus?.cancelling"
          @click="cancelSync"
        >
          <i class="fa-solid fa-stop" aria-hidden="true"></i>
          {{ jobStatus?.cancelling ? 'Đang dừng...' : 'Hủy sync' }}
        </button>
        <button
          v-if="syncStalled"
          type="button"
          class="inline-flex items-center gap-2 rounded-lg bg-[#a32924] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#7a1e1c] disabled:opacity-50"
          :disabled="forceResettingSync"
          :aria-busy="forceResettingSync"
          @click="forceResetSync"
        >
          <i class="fa-solid" :class="forceResettingSync ? 'fa-spinner animate-spin' : 'fa-bolt'" aria-hidden="true"></i>
          {{ forceResettingSync ? 'Đang gỡ...' : 'Buộc gỡ kẹt' }}
        </button>
      </div>
      <p v-if="syncing" class="m-0 text-sm text-[#667768]">
        Đang chạy nền. Có thể đóng trang — worker tiếp tục. Mở lại sẽ thấy tiến độ.
        <span v-if="syncStalled" class="font-bold text-[#a32924]"> — Treo quá 90s ở backup, bấm "Buộc gỡ kẹt" để chạy lại ngay (không cần restart server).</span>
      </p>

      <!-- Tiến độ job nền -->
      <div v-if="jobStatus" class="rounded-lg border border-[#cce5cd] bg-[#f0f7f1] p-4 flex flex-col gap-2" role="status" :aria-busy="jobStatus.running">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm font-bold text-[#122815]">
            <i
              class="fa-solid mr-1.5"
              :class="{
                'fa-spinner animate-spin': jobStatus.running && !jobStatus.cancelling,
                'fa-check-circle text-[#2c6e33]': jobStatus.phase === 'done',
                'fa-circle-xmark text-[#a32924]': jobStatus.phase === 'failed',
                'fa-circle-stop text-[#8a6412]': jobStatus.phase === 'cancelled',
              }"
              aria-hidden="true"
            ></i>
            {{ phaseLabel[jobStatus.phase] }}
            <span v-if="jobStatus.cancelling" class="text-[#8a6412]">(đang dừng)</span>
          </span>
          <span class="text-xs text-[#667768]">
            {{ jobStatus.done }} / {{ jobStatus.total }} file
            <span v-if="jobStatus.total > 0">· {{ progressPercent }}%</span>
          </span>
        </div>

        <!-- Progress bar -->
        <div class="h-2 w-full overflow-hidden rounded-full bg-[#d0ddd1]" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100">
          <div class="h-full rounded-full bg-[#2c6e33] transition-all duration-300" :style="{ width: `${progressPercent}%` }"></div>
        </div>

        <!-- Chi tiết -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div>
            <span class="font-bold text-[#1e4620]">{{ jobStatus.synced }}</span>
            <span class="text-[#667768]"> đã chuyển</span>
          </div>
          <div>
            <span class="font-bold text-[#667768]">{{ jobStatus.skipped }}</span>
            <span class="text-[#667768]"> bỏ qua</span>
          </div>
          <div>
            <span class="font-bold text-[#1e4620]">{{ jobStatus.articlesRewritten }}</span>
            <span class="text-[#667768]"> bài sửa URL</span>
          </div>
          <div class="text-[#667768]">
            {{ jobStatus.message }}
          </div>
        </div>

        <!-- Snapshot backup -->
        <div v-if="jobStatus.preBackupStamp" class="text-xs text-[#8a6412]">
          <i class="fa-solid fa-shield-halved mr-1" aria-hidden="true"></i>
          Snapshot trước sync: <code class="font-mono">{{ jobStatus.preBackupStamp }}</code> (giữ để recover thủ công)
        </div>

        <!-- Lỗi -->
        <div v-if="jobStatus.errors.length > 0" class="text-xs text-[#a32924]">
          <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>
          {{ jobStatus.errors.length }} file lỗi: {{ jobStatus.errors.slice(0, 5).join(', ') }}{{ jobStatus.errors.length > 5 ? '...' : '' }}
        </div>
      </div>

      <!-- Kết quả sync (giữ hiện sau khi xong) -->
      <div v-if="syncResult && !syncing" class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
        <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Đã chuyển</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#1e4620]">{{ syncResult.synced }}</p>
        </div>
        <div class="rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Bỏ qua</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#667768]">{{ syncResult.skipped }}</p>
        </div>
        <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
          <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Bài viết sửa URL</p>
          <p class="m-0 mt-1 text-xl font-extrabold text-[#1e4620]">{{ syncResult.articlesRewritten }}</p>
        </div>
      </div>
    </section>

    <!-- ─── Section 3: Đổi domain URL R2 ──────────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-3">
      <header class="flex items-start gap-3">
        <i class="fa-solid fa-arrow-right-arrow-left text-2xl text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
        <div>
          <h2 class="m-0 text-base font-bold text-[#122815]">Đổi domain URL R2</h2>
          <p class="m-0 mt-1 text-[0.82rem] text-[#667768]">Đổi domain CDN R2 (cùng account + bucket) — tự cập nhật URL trong <code class="font-mono">media.url</code> + <code class="font-mono">articles.content</code>. File không tải lại (đã ở R2). Chạy < 2 giây. Tự backup SQL trước.</p>
        </div>
      </header>

      <div class="flex flex-col gap-3 rounded-lg border border-[#cce5cd] bg-[#f0f7f1] p-3">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label class="flex flex-col gap-1 text-sm font-bold text-[#122815] flex-1">
            Domain cũ
            <input
              v-model="oldDomain"
              type="text"
              placeholder="cdn.domaincu.com"
              class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2 text-sm font-normal text-[#122815] focus:border-[#2c6e33] focus:outline-none"
              :disabled="repointing"
            />
          </label>
          <div class="hidden sm:flex sm:items-center sm:pb-2">
            <i class="fa-solid fa-arrow-right text-[#667768]" aria-hidden="true"></i>
          </div>
          <label class="flex flex-col gap-1 text-sm font-bold text-[#122815] flex-1">
            Domain mới
            <input
              v-model="newDomain"
              type="text"
              placeholder="media.domainmoi.com"
              class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2 text-sm font-normal text-[#122815] focus:border-[#2c6e33] focus:outline-none"
              :disabled="repointing"
            />
          </label>
        </div>

        <button
          type="button"
          class="inline-flex w-fit items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer transition-colors hover:bg-[#1e4620] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="repointing || !oldDomain.trim() || !newDomain.trim()"
          :aria-busy="repointing"
          @click="repointUrls"
        >
          <i class="fa-solid fa-arrow-right-arrow-left" :class="repointing ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i>
          {{ repointing ? 'Đang đổi...' : 'Đổi URL R2' }}
        </button>

        <p v-if="repointing" class="m-0 text-sm text-[#667768]">Đang backup SQL + REPLACE URL... (< 2 giây)</p>

        <div v-if="repointResult" class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
          <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
            <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Ảnh sửa URL</p>
            <p class="m-0 mt-1 text-xl font-extrabold text-[#1e4620]">{{ repointResult.mediaUpdated }}</p>
          </div>
          <div class="rounded-lg border border-[#cce5cd] bg-[#eef7ee] p-3">
            <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#667768]">Bài viết sửa URL</p>
            <p class="m-0 mt-1 text-xl font-extrabold text-[#1e4620]">{{ repointResult.articlesUpdated }}</p>
          </div>
          <div v-if="repointResult.backupStamp" class="rounded-lg border border-[#f0dcae] bg-[#fdf6e7] p-3">
            <p class="m-0 text-xs font-bold uppercase tracking-wide text-[#8a6412]">Snapshot</p>
            <p class="m-0 mt-1 text-sm font-bold text-[#8a6412] break-all">{{ repointResult.backupStamp }}</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
