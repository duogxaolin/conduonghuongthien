<script setup lang="ts">
import BackupSettingsPanel from '~/components/admin/backup/BackupSettingsPanel.vue'
import BackupOffsiteBadge from '~/components/admin/backup/BackupOffsiteBadge.vue'
import type { OffsiteStatus } from '~~/shared/backup-offsite-status'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()
const { confirm } = useConfirm()
// Khôi phục / tải về / xoá backup chỉ dành cho SuperAdmin. Server là nơi quyết
// định (403 cho người khác); giao diện chỉ không mời bấm nút sẽ bị từ chối.
const { user } = useAdminAuth()
const isSuperAdmin = computed(() => user.value?.isSuperAdmin === true)

// ─── Backup status (poll khi đang chạy) ──────────────────────────────────────
interface RunStatus { running: boolean; phase: string; message: string; progress?: number }
interface BackupItem {
  id: number
  filename: string
  type: string
  bytes: number
  stamp: string
  status: string
  driveUploaded: boolean
  // Bản ngoài máy chủ của tệp này; NULL = hàng cũ (lùi về driveUploaded) — offsiteStatusDisplay().
  offsiteStatus: OffsiteStatus | null
  createdAt: string
}

const backupStatus = ref<RunStatus | null>(null)
const restoreStatus = ref<RunStatus | null>(null)
const loading = ref(true)
const error = ref('')
const items = ref<BackupItem[]>([])
const page = ref(1)
const totalPages = ref(1)
const total = ref(0)
const filterType = ref('')
const running = ref(false)
const restoring = ref(false)
// Upload progress (XMLHttpRequest progress event) — 0-100. -1 = không đang upload.
const uploadProgress = ref(-1)
const uploadFilename = ref('')
const uploadBytesTotal = ref(0)
const uploadBytesLoaded = ref(0)
const uploadStartedAt = ref(0)
// Lịch sử các phase đã đi qua — để hiển thị dòng log chi tiết cho cán bộ.
const restoreLog = ref<Array<{ phase: string; message: string; at: number; percent?: number }>>([])

// % hiển thị trên thanh tiến trình:
//  - upload đang chạy (0-99%) → dùng uploadProgress; 100% → chuyển sang xử lý server
//  - phase 'upload' (server đang nhận body) → dùng uploadProgress (vẫn 0→99)
//  - phase 'save' (ghi file) → 100% (đã nhận xong, đang ghi)
//  - phase 'sql'/'schema'/'start' (chạy SQL, cập nhật cấu trúc) → 100% (giữ, không có sub-progress)
//  - phase 'extract' → dùng progress từ backend (0→100)
//  - phase 'audit'/'done' → 100%; phase 'failed' → 0 (đỏ)
const currentRestorePercent = computed(() => {
  if (restoreStatus.value?.phase === 'failed') return 0
  if (restoreStatus.value?.phase === 'done' || restoreStatus.value?.phase === 'audit') return 100
  if (uploadProgress.value >= 0 && uploadProgress.value < 100) return uploadProgress.value
  if (restoreStatus.value?.phase === 'save') return 100
  if (restoreStatus.value?.phase === 'sql') return 100
  if (restoreStatus.value?.phase === 'schema') return 100
  if (restoreStatus.value?.phase === 'start') return 100
  if (uploadProgress.value === 100 && (!restoreStatus.value?.phase || restoreStatus.value.phase === 'upload')) return uploadProgress.value
  if (restoreStatus.value?.phase === 'extract') return restoreStatus.value?.progress ?? 0
  return restoreStatus.value?.progress ?? 0
})

// Dung lượng đã upload + tốc độ ước tính.
const uploadSpeed = computed(() => {
  if (!uploadStartedAt.value || uploadBytesLoaded.value === 0) return ''
  const elapsed = (Date.now() - uploadStartedAt.value) / 1000
  if (elapsed < 0.5) return ''
  const bps = uploadBytesLoaded.value / elapsed
  return bps < 1024 ? `${Math.round(bps)} B/s` : bps < 1048576 ? `${(bps / 1024).toFixed(1)} KB/s` : `${(bps / 1048576).toFixed(2)} MB/s`
})

// Thời gian đã trôi qua kể từ lúc bắt đầu restore (upload hoặc gọi API).
const restoreElapsed = computed(() => {
  if (!uploadStartedAt.value) return ''
  const s = Math.round((Date.now() - uploadStartedAt.value) / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}p${s % 60}s`
})

const formatBytes = (b: number) => {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const typeLabel = (t: string) => ({ sql: 'CSDL', media: 'File', all: 'Cả hai' } as Record<string, string>)[t] || t

async function loadStatus() {
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; backup: RunStatus; restore: RunStatus }>)(`/api/admin/backup/status`)
    backupStatus.value = res.backup
    restoreStatus.value = res.restore
    running.value = res.backup.running
    restoring.value = res.restore.running
    // Ghi lại log phase khi restore đang chạy — chỉ thêm khi phase thay đổi.
    const rs = res.restore
    if (rs && rs.running && rs.phase) {
      const last = restoreLog.value[restoreLog.value.length - 1]
      if (!last || last.phase !== rs.phase) {
        restoreLog.value.push({ phase: rs.phase, message: rs.message, at: Date.now(), percent: rs.progress })
      } else if (rs.message && last.message !== rs.message) {
        last.message = rs.message
        if (rs.progress !== undefined) last.percent = rs.progress
      }
    }
  } catch { /* ignore */ }
}

async function loadBackups() {
  loading.value = true
  error.value = ''
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: BackupItem[]; total: number; totalPages: number }>)(`/api/admin/backup`, {
      params: { page: page.value, pageSize: 20, ...(filterType.value ? { type: filterType.value } : {}) },
    })
    items.value = res.items || []
    total.value = res.total || 0
    totalPages.value = res.totalPages || 1
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được danh sách backup.')
    items.value = []
  } finally {
    loading.value = false
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null
function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    await loadStatus()
    if (running.value || restoring.value) {
      await loadBackups() // refresh khi đang chạy
    } else {
      stopPolling()
    }
  }, 4000)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// ─── Backup mới ───────────────────────────────────────────────────────────────
const runBackup = async (type: 'sql' | 'files' | 'all') => {
  running.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; files: Array<{ name: string }>; driveUploaded: boolean; driveError?: string }>)(`/api/admin/backup/run`, {
      method: 'POST', body: { type },
    })
    toast.success(`Đã tạo ${res.files.length} file backup${res.driveUploaded ? ' + upload Drive' : ''}.${res.driveError ? ` (Drive lỗi: ${res.driveError})` : ''}`)
    await loadBackups()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi backup'))
  } finally {
    running.value = false
    await loadStatus()
  }
}

// ─── Khôi phục ───────────────────────────────────────────────────────────────
const restoreBackup = async (filename: string) => {
  const ok = await confirm({
    title: 'Khôi phục backup',
    message: `Khôi phục "${filename}" sẽ GHI ĐÈ dữ liệu hiện tại. Hành động này không thể hoàn tác. Tiếp tục?`,
    danger: true,
    confirmLabel: 'Khôi phục',
  })
  if (!ok) return
  restoring.value = true
  uploadStartedAt.value = Date.now()
  restoreLog.value = [{ phase: 'start', message: `Bắt đầu khôi phục ${filename}`, at: Date.now(), percent: 0 }]
  startPolling()
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; warning?: string | null }>)(`/api/admin/backup/restore`, { method: 'POST', body: { filename } })
    toast.success('Đã khôi phục backup thành công.')
    if (res?.warning) toast.warning(res.warning, undefined, 15000)
    await loadBackups()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi khôi phục'))
  } finally {
    restoring.value = false
    uploadStartedAt.value = 0
    await loadStatus()
    stopPolling()
  }
}

// ─── Upload khôi phục ─────────────────────────────────────────────────────────
// Dùng XMLHttpRequest thay $fetch để có upload progress event — fetch API không
// báo tiến độ upload. 69MB tar.gz qua $fetch chỉ thấy "pending" vài phút.
const RESTORE_PHASE_LABEL: Record<string, string> = {
  upload: 'Đang upload',
  save: 'Đang ghi file',
  start: 'Bắt đầu',
  safety: 'Đang sao lưu an toàn',
  sql: 'Đang phục hồi CSDL',
  schema: 'Đang cập nhật cấu trúc CSDL',
  extract: 'Đang giải nén',
  audit: 'Đang ghi audit',
  done: 'Xong',
  failed: 'Lỗi',
  '': '—',
}

const onRestoreUpload = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.name.endsWith('.sql.gz') && !file.name.endsWith('.tar.gz')) {
    toast.error('Chỉ nhận file .sql.gz hoặc .tar.gz')
    return
  }
  const ok = await confirm({
    title: 'Khôi phục từ file upload',
    message: `Khôi phục từ "${file.name}" sẽ GHI ĐÈ dữ liệu hiện tại. Hành động này không thể hoàn tác. Tiếp tục?`,
    danger: true,
    confirmLabel: 'Khôi phục',
  })
  if (!ok) { input.value = ''; return }
  restoring.value = true
  uploadProgress.value = 0
  uploadFilename.value = file.name
  uploadBytesTotal.value = file.size
  uploadBytesLoaded.value = 0
  uploadStartedAt.value = Date.now()
  restoreLog.value = [{ phase: 'upload', message: `Đang upload ${file.name} (${formatBytes(file.size)})`, at: Date.now(), percent: 0 }]
  startPolling()
  try {
    const warning = await new Promise<string | null>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/admin/backup/restore-upload')
      // Upload progress — chỉ fire khi upload > 0. Tar.gz 69MB sẽ thấy 0→100.
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          uploadBytesLoaded.value = ev.loaded
          uploadBytesTotal.value = ev.total
          uploadProgress.value = Math.min(100, Math.round((ev.loaded / ev.total) * 100))
        }
      }
      xhr.onload = () => {
        uploadProgress.value = 100
        if (xhr.status >= 200 && xhr.status < 300) {
          let note: string | null = null
          try { const j = JSON.parse(xhr.responseText); if (typeof j?.warning === 'string') note = j.warning } catch { /* noop */ }
          resolve(note)
        } else {
          let msg = `Lỗi khôi phục (HTTP ${xhr.status})`
          try { const j = JSON.parse(xhr.responseText); if (j?.statusMessage) msg = j.statusMessage } catch { /* noop */ }
          reject(new Error(msg))
        }
      }
      xhr.onerror = () => reject(new Error('Lỗi mạng khi upload'))
      const formData = new FormData()
      formData.append('file', file)
      xhr.send(formData)
    })
    toast.success('Đã khôi phục từ file upload.')
    if (warning) toast.warning(warning, undefined, 15000)
    await loadBackups()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi khôi phục'))
  } finally {
    restoring.value = false
    uploadProgress.value = -1
    uploadFilename.value = ''
    uploadBytesTotal.value = 0
    uploadBytesLoaded.value = 0
    uploadStartedAt.value = 0
    input.value = ''
    await loadStatus()
    stopPolling()
  }
}

// ─── Tải về ──────────────────────────────────────────────────────────────────
const downloadBackup = (filename: string) => {
  window.open(`/api/admin/backup/${encodeURIComponent(filename)}`, '_blank')
}

// ─── Xoá ─────────────────────────────────────────────────────────────────────
const deleteBackup = async (item: BackupItem) => {
  const ok = await confirm({ title: 'Xoá backup', message: `Xoá file "${item.filename}"?`, danger: true, confirmLabel: 'Xoá' })
  if (!ok) return
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/backup/${encodeURIComponent(item.filename)}?id=${item.id}`, { method: 'DELETE' })
    toast.success('Đã xoá backup.')
    await loadBackups()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi xoá backup'))
  }
}

onMounted(() => {
  loadBackups()
  loadStatus()
})
onUnmounted(() => stopPolling())

watch([running, restoring], ([r, rr]) => {
  if (r || rr) startPolling()
  else stopPolling()
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <header>
      <h1 class="m-0 text-[1.3rem] font-extrabold text-brand-950">Sao lưu & Khôi phục</h1>
      <p class="m-0 mt-1 text-sm text-ink-muted">Backup CSDL + file, tải về hoặc upload Google Drive, khôi phục khi cần.</p>
    </header>

    <!-- Banner trạng thái khôi phục — luôn hiển thị khi restoring, không rụt về 0 -->
    <div v-if="restoring" class="rounded-xl border border-[#f0dcae] bg-[#fdf6e7] p-4 text-sm text-warn-ink flex flex-col gap-3" role="status" :aria-busy="restoring">
      <div class="flex items-start gap-2">
        <i class="fa-solid fa-spinner animate-spin mt-0.5 motion-reduce:animate-none" aria-hidden="true"></i>
        <div class="flex-1 min-w-0">
          <strong class="block">
            {{ uploadProgress >= 0 && uploadProgress < 100 ? `Đang upload ${uploadFilename}` : RESTORE_PHASE_LABEL[restoreStatus?.phase ?? ''] ?? 'Đang khôi phục' }}
          </strong>
          <span class="text-ink-muted break-words">{{ restoreStatus?.message || 'đang xử lý...' }}</span>
        </div>
        <span v-if="restoreElapsed" class="text-xs font-bold tabular-nums text-warn-ink shrink-0">{{ restoreElapsed }}</span>
      </div>
      <!-- Progress bar: upload phase (0-100 từ XHR) hoặc extract phase (từ backend) -->
      <div class="flex items-center gap-2">
        <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-[#f0e0c0]" role="progressbar" :aria-valuenow="currentRestorePercent" aria-valuemin="0" aria-valuemax="100" :aria-label="`Tiến độ khôi phục ${currentRestorePercent}%`">
          <div class="h-full rounded-full bg-warn-ink transition-all duration-300 motion-reduce:transition-none" :style="{ width: `${currentRestorePercent}%` }"></div>
        </div>
        <span class="text-xs font-bold tabular-nums text-warn-ink min-w-[3rem] text-right">{{ currentRestorePercent }}%</span>
      </div>
      <!-- Thông tin thêm: dung lượng + tốc độ khi đang upload -->
      <div v-if="uploadProgress >= 0 && uploadProgress < 100 && uploadBytesTotal > 0" class="flex items-center gap-3 text-[0.78rem] text-ink-muted">
        <span><i class="fa-solid fa-file-arrow-up mr-1" aria-hidden="true"></i>{{ formatBytes(uploadBytesLoaded) }} / {{ formatBytes(uploadBytesTotal) }}</span>
        <span v-if="uploadSpeed" class="text-warn-ink font-semibold"><i class="fa-solid fa-gauge-high mr-1" aria-hidden="true"></i>{{ uploadSpeed }}</span>
      </div>
      <!-- Log các phase đã đi qua -->
      <ol v-if="restoreLog.length > 1" class="m-0 p-0 list-none flex flex-col gap-1 text-[0.78rem]">
        <li v-for="(log, i) in restoreLog" :key="i" class="flex items-start gap-2">
          <i class="fa-solid fa-check text-brand-700 mt-0.5 text-[0.7rem]" aria-hidden="true" v-if="i < restoreLog.length - 1 || currentRestorePercent === 100"></i>
          <i class="fa-solid fa-circle-notch fa-spin text-warn-ink mt-0.5 text-[0.7rem] motion-reduce:animate-none" aria-hidden="true" v-else></i>
          <span class="text-[#3d4a3e]"><strong>{{ RESTORE_PHASE_LABEL[log.phase] ?? log.phase }}:</strong> {{ log.message }}<span v-if="log.percent !== undefined" class="text-ink-muted"> ({{ log.percent }}%)</span></span>
        </li>
      </ol>
      <p class="m-0 text-[0.78rem] text-ink-muted"><i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>Cổng có thể chậm trong giây lát. Có thể đóng trang — worker tiếp tục trong nền.</p>
    </div>
    <div v-else-if="running" class="rounded-xl border border-[#cce5cd] bg-surface-tint px-4 py-3 text-sm text-brand-900 flex items-center gap-2" role="status">
      <i class="fa-solid fa-spinner animate-spin motion-reduce:animate-none" aria-hidden="true"></i>
      <span>Đang backup — {{ backupStatus?.message }}</span>
    </div>

    <!-- ─── Section 1: Backup mới ──────────────────────────────────────────── -->
    <section class="rounded-xl border border-line bg-white p-5 flex flex-col gap-3">
      <div class="flex items-start gap-2">
        <i class="fa-solid fa-floppy-disk text-lg text-brand-700 mt-0.5" aria-hidden="true"></i>
        <div>
          <h2 class="m-0 text-base font-bold text-brand-950">Tạo backup mới</h2>
          <p class="m-0 mt-0.5 text-[0.82rem] text-ink-muted">Tạo bản sao lưu ngay — CSDL, file tải lên, hoặc cả hai.</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-brand-900 disabled:opacity-50 disabled:cursor-not-allowed" :disabled="running || restoring" @click="runBackup('sql')">
          <i class="fa-solid fa-database" :class="running ? 'fa-spinner animate-spin motion-reduce:animate-none' : ''" aria-hidden="true"></i> Sao lưu CSDL
        </button>
        <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-brand-900 disabled:opacity-50 disabled:cursor-not-allowed" :disabled="running || restoring" @click="runBackup('files')">
          <i class="fa-solid fa-file-zipper" :class="running ? 'fa-spinner animate-spin motion-reduce:animate-none' : ''" aria-hidden="true"></i> Sao lưu File
        </button>
        <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-brand-950 disabled:opacity-50 disabled:cursor-not-allowed" :disabled="running || restoring" @click="runBackup('all')">
          <i class="fa-solid fa-floppy-disk" :class="running ? 'fa-spinner animate-spin motion-reduce:animate-none' : ''" aria-hidden="true"></i> Sao lưu cả hai
        </button>
      </div>
    </section>

    <!-- ─── Section 2: Khôi phục từ file upload (chỉ SuperAdmin) ──────────── -->
    <section v-if="isSuperAdmin" class="rounded-xl border border-line bg-white p-5 flex flex-col gap-3">
      <div class="flex items-start gap-2">
        <i class="fa-solid fa-upload text-lg text-brand-700 mt-0.5" aria-hidden="true"></i>
        <div>
          <h2 class="m-0 text-base font-bold text-brand-950">Khôi phục từ file upload</h2>
          <p class="m-0 mt-0.5 text-[0.82rem] text-ink-muted">Chọn file backup (.sql.gz hoặc .tar.gz) tải lên để khôi phục. File sẽ ghi đè dữ liệu hiện tại.</p>
        </div>
      </div>
      <div class="rounded-lg border border-dashed border-[#b8cdba] bg-surface p-4 flex flex-col gap-2">
        <label class="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white border-0 hover:bg-brand-900 disabled:opacity-50 disabled:cursor-not-allowed" :class="{ 'pointer-events-none opacity-50': restoring || running }">
          <i class="fa-solid fa-upload" aria-hidden="true"></i> Chọn file backup
          <input type="file" accept=".sql.gz,.tar.gz,application/gzip" class="sr-only" :disabled="restoring || running" @change="onRestoreUpload" />
        </label>
        <p class="m-0 text-[0.78rem] text-ink-muted"><i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>Hỗ trợ .sql.gz (CSDL) và .tar.gz (file). Hành động này không thể hoàn tác.</p>
      </div>
    </section>

    <!-- ─── Section 3: Danh sách backup ────────────────────────────────────── -->
    <section class="rounded-xl border border-line bg-white p-5 flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-start gap-2">
          <i class="fa-solid fa-list text-lg text-brand-700 mt-0.5" aria-hidden="true"></i>
          <div>
            <h2 class="m-0 text-base font-bold text-brand-950">Danh sách backup</h2>
            <p v-if="isSuperAdmin" class="m-0 mt-0.5 text-[0.82rem] text-ink-muted">Tải về, khôi phục hoặc xoá các bản sao lưu đã tạo.</p>
            <p v-else class="m-0 mt-0.5 text-[0.82rem] text-ink-muted">Các bản sao lưu đã tạo. Chỉ SuperAdmin được tải về, khôi phục hoặc xoá.</p>
          </div>
        </div>
        <div class="flex gap-2">
          <label for="backup-filter-type" class="sr-only">Lọc theo loại</label>
          <select id="backup-filter-type" v-model="filterType" class="rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-700" @change="page = 1; loadBackups()">
            <option value="">Tất cả</option>
            <option value="sql">CSDL</option>
            <option value="media">File</option>
          </select>
          <button type="button" class="rounded-lg border border-line-strong px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-surface-tint" aria-label="Tải lại danh sách" @click="loadBackups()"><i class="fa-solid fa-rotate-right" :class="loading ? 'fa-spinner animate-spin motion-reduce:animate-none' : ''" aria-hidden="true"></i></button>
        </div>
      </div>

      <SkeletonTable v-if="loading" label="Đang tải danh sách backup" :rows="5" :cols="6" />

      <div v-else-if="error" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-4 text-sm text-[#a32924]" role="alert">
        {{ error }} Vui lòng <button type="button" class="font-bold underline text-brand-600" @click="loadBackups()">thử lại</button>.
      </div>

      <div v-else-if="!items.length" class="py-12 text-center text-[#9ca3af]">
        <i class="fa-regular fa-floppy-disk text-4xl text-[#d1d5db]" aria-hidden="true"></i>
        <p class="m-0 mt-3 text-sm">Chưa có bản backup nào.</p>
      </div>

      <!-- Mobile Card View: Hiển thị dạng thẻ trên điện thoại -->
      <div class="md:hidden divide-y divide-surface-tint rounded-xl border border-line overflow-hidden">
        <div
          v-for="item in items"
          :key="'m-'+item.id"
          class="p-4 flex flex-col gap-2.5"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="m-0 font-mono font-bold text-xs text-brand-950 truncate" :title="item.filename">{{ item.filename }}</p>
              <span class="inline-block mt-1 rounded-full border border-[#cce5cd] bg-surface-tint px-2 py-0.5 text-[0.7rem] font-bold text-brand-900">
                {{ typeLabel(item.type) }}
              </span>
            </div>
            <span class="text-xs font-semibold text-ink-muted shrink-0">{{ formatBytes(item.bytes) }}</span>
          </div>

          <div class="flex items-center justify-between text-[0.75rem] text-ink-muted pt-1">
            <span>{{ formatWhen(item.createdAt) }}</span>
            <BackupOffsiteBadge :item="item" />
          </div>

          <div v-if="isSuperAdmin" class="flex items-center justify-end gap-2 pt-2 border-t border-surface">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-surface-tint px-3 py-1.5 text-xs font-bold text-brand-700 border-0 cursor-pointer hover:bg-[#e4f2e5]"
              title="Tải về"
              @click="downloadBackup(item.filename)"
            >
              <i class="fa-solid fa-download" aria-hidden="true"></i> Tải về
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-[#fdf6e7] px-3 py-1.5 text-xs font-bold text-warn-ink border-0 cursor-pointer hover:bg-[#f5e8c8] disabled:opacity-60"
              title="Khôi phục"
              :disabled="restoring || running"
              @click="restoreBackup(item.filename)"
            >
              <i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Khôi phục
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-danger-bg px-3 py-1.5 text-xs font-bold text-danger border-0 cursor-pointer hover:bg-red-200"
              title="Xoá"
              @click="deleteBackup(item)"
            >
              <i class="fa-regular fa-trash" aria-hidden="true"></i> Xóa
            </button>
          </div>
        </div>
      </div>

      <!-- Desktop Table View: Bảng đầy đủ trên máy tính -->
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full border-collapse text-left text-[0.84rem]">
          <thead class="bg-surface text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th class="px-3.5 py-3">Thời điểm</th>
              <th class="px-3.5 py-3">Loại</th>
              <th class="px-3.5 py-3">File</th>
              <th class="px-3.5 py-3">Dung lượng</th>
              <th class="px-3.5 py-3">Bản ngoài máy chủ</th>
              <th v-if="isSuperAdmin" class="px-3.5 py-3">Hành động</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" class="border-t border-surface-tint hover:bg-surface">
              <td class="px-3.5 py-2.5 whitespace-nowrap text-[#3d4a3e]">{{ formatWhen(item.createdAt) }}</td>
              <td class="px-3.5 py-2.5"><span class="rounded-full border border-[#cce5cd] bg-surface-tint px-2 py-0.5 text-[0.72rem] font-bold text-brand-900">{{ typeLabel(item.type) }}</span></td>
              <td class="px-3.5 py-2.5 truncate max-w-[200px] text-brand-950" :title="item.filename">{{ item.filename }}</td>
              <td class="px-3.5 py-2.5 text-ink-muted">{{ formatBytes(item.bytes) }}</td>
              <td class="px-3.5 py-2.5"><BackupOffsiteBadge :item="item" /></td>
              <td v-if="isSuperAdmin" class="px-3.5 py-2.5">
                <div class="flex gap-1.5">
                  <button type="button" class="rounded-md bg-surface-tint px-2 py-1 text-[0.72rem] font-medium text-brand-700 border-0 cursor-pointer hover:bg-[#e4f2e5]" title="Tải về" @click="downloadBackup(item.filename)"><i class="fa-solid fa-download" aria-hidden="true"></i></button>
                  <button type="button" class="rounded-md bg-[#fdf6e7] px-2 py-1 text-[0.72rem] font-medium text-warn-ink border-0 cursor-pointer hover:bg-[#f5e8c8]" title="Khôi phục" :disabled="restoring || running" @click="restoreBackup(item.filename)"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button>
                  <button type="button" class="rounded-md bg-danger-bg px-2 py-1 text-[0.72rem] font-medium text-danger border-0 cursor-pointer hover:bg-red-200" title="Xoá" @click="deleteBackup(item)"><i class="fa-regular fa-trash" aria-hidden="true"></i></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalPages > 1" class="pt-2">
        <AdminPagination
          :page="page"
          :total-pages="totalPages"
          @update:page="(p) => { page = p; loadBackups() }"
        />
      </div>
    </section>

    <!-- ─── Section 4: Cài đặt backup (khối riêng, tách thành component) ─────── -->
    <BackupSettingsPanel />
  </div>
</template>
