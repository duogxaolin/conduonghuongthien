<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()
const { confirm } = useConfirm()

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
//  - phase 'sql'/'start' (chạy SQL) → 100% (giữ, không có sub-progress)
//  - phase 'extract' → dùng progress từ backend (0→100)
//  - phase 'audit'/'done' → 100%; phase 'failed' → 0 (đỏ)
const currentRestorePercent = computed(() => {
  if (restoreStatus.value?.phase === 'failed') return 0
  if (restoreStatus.value?.phase === 'done' || restoreStatus.value?.phase === 'audit') return 100
  if (uploadProgress.value >= 0 && uploadProgress.value < 100) return uploadProgress.value
  if (restoreStatus.value?.phase === 'save') return 100
  if (restoreStatus.value?.phase === 'sql') return 100
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

const formatWhen = (v: string) => {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('vi-VN')
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
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/backup/restore`, { method: 'POST', body: { filename } })
    toast.success('Đã khôi phục backup thành công.')
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
  sql: 'Đang phục hồi CSDL',
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
    await new Promise<void>((resolve, reject) => {
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
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else {
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
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/backup/${encodeURIComponent(item.filename)}`, { method: 'DELETE' })
    toast.success('Đã xoá backup.')
    await loadBackups()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi xoá backup'))
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────
const savingSettings = ref(false)
const backupSettings = ref({
  backup_auto_enabled: 'false',
  backup_auto_hour: '3',
  backup_auto_days: '[]',
  backup_keep_count: '14',
  backup_drive_enabled: 'false',
  backup_drive_service_account: '',
  backup_drive_folder_id: '',
})

// ─── Google Drive OAuth link ────────────────────────────────────────────────
interface DriveLink {
  linked: boolean
  linkedEmail: string | null
  linkedSub: string | null
  linkedAt: string | null
  status: 'not_linked' | 'linked' | 'secret_unreadable'
}
const driveLink = ref<DriveLink | null>(null)
const driveRedirectUri = ref('')
const driveLinkLoading = ref(false)
const disconnecting = ref(false)
const driveToast = ref('')

async function loadDriveStatus() {
  driveLinkLoading.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; link: DriveLink; redirectUri: string }>)(`/api/admin/backup/drive/status`)
    driveLink.value = res.link
    driveRedirectUri.value = res.redirectUri
  } catch (err: unknown) {
    driveToast.value = errorMessage(err, 'Không tải được trạng thái liên kết Drive.')
  } finally {
    driveLinkLoading.value = false
  }
}

async function disconnectDrive() {
  const ok = await confirm({
    title: 'Hủy liên kết Google Drive',
    message: 'Hủy liên kết? Backup tiếp theo sẽ dùng Service Account (nếu cấu hình) hoặc không upload Drive.',
    confirmLabel: 'Hủy liên kết',
  })
  if (!ok) return
  disconnecting.value = true
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/backup/drive/disconnect`, { method: 'POST' })
    toast.success('Đã hủy liên kết Google Drive.')
    await loadDriveStatus()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi hủy liên kết'))
  } finally {
    disconnecting.value = false
  }
}

function copyRedirectUri() {
  navigator.clipboard.writeText(driveRedirectUri.value).then(
    () => toast.success('Đã copy Redirect URI.'),
    () => toast.error('Không copy được — copy thủ công.'),
  )
}

// ─── Google Drive OAuth config (Client ID/Secret riêng cho Drive) ──────────
interface DriveConfig {
  clientId: string
  hasClientSecret: boolean
  clientSecretMasked: string | null
  clientSecretStatus: 'not_configured' | 'configured' | 'secret_unreadable'
  isEnabled: boolean
  redirectUri: string
  missing: string[]
  updatedAt: string | null
}
const driveConfig = ref<DriveConfig | null>(null)
const driveConfigLoading = ref(false)
const savingDriveConfig = ref(false)
const clearingDriveSecret = ref(false)
const driveClientId = ref('')
const driveClientSecret = ref('')
const driveEnabled = ref(false)

async function loadDriveConfig() {
  driveConfigLoading.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; config: DriveConfig }>)(`/api/admin/backup/drive/config`)
    driveConfig.value = res.config
    driveClientId.value = res.config.clientId
    driveEnabled.value = res.config.isEnabled
    driveClientSecret.value = ''
    // Redirect URI từ config endpoint (cùng source với status endpoint).
    if (res.config.redirectUri) driveRedirectUri.value = res.config.redirectUri
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không tải được cấu hình OAuth Drive.'))
  } finally {
    driveConfigLoading.value = false
  }
}

async function saveDriveConfig() {
  savingDriveConfig.value = true
  try {
    const body: Record<string, unknown> = {
      clientId: driveClientId.value.trim(),
      isEnabled: driveEnabled.value,
    }
    // Chỉ gửi clientSecret khi cán bộ nhập mới — bỏ trống = giữ cũ.
    if (driveClientSecret.value.trim()) body.clientSecret = driveClientSecret.value.trim()
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; config: DriveConfig }>)(`/api/admin/backup/drive/config`, {
      method: 'PUT',
      body,
    })
    driveConfig.value = res.config
    driveClientId.value = res.config.clientId
    driveEnabled.value = res.config.isEnabled
    driveClientSecret.value = ''
    toast.success('Đã lưu cấu hình OAuth Drive.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi lưu cấu hình OAuth Drive.'))
  } finally {
    savingDriveConfig.value = false
  }
}

async function clearDriveSecret() {
  const ok = await confirm({
    title: 'Gỡ client secret Drive',
    message: 'Gỡ client secret và tắt OAuth Drive? Cần nhập lại secret để liên kết lại. Client ID được giữ lại.',
    confirmLabel: 'Gỡ secret',
  })
  if (!ok) return
  clearingDriveSecret.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; config: DriveConfig }>)(`/api/admin/backup/drive/clear-secret`, { method: 'POST' })
    driveConfig.value = res.config
    driveEnabled.value = res.config.isEnabled
    driveClientSecret.value = ''
    toast.success('Đã gỡ client secret Drive.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi gỡ client secret.'))
  } finally {
    clearingDriveSecret.value = false
  }
}
const daysOptions = [
  { label: 'CN', value: 0 }, { label: 'T2', value: 1 }, { label: 'T3', value: 2 },
  { label: 'T4', value: 3 }, { label: 'T5', value: 4 }, { label: 'T6', value: 5 }, { label: 'T7', value: 6 },
]
const selectedDays = ref<number[]>([])

async function loadSettings() {
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; settings: Record<string, string | null> }>)(`/api/admin/settings/backup`)
    const s = res.settings || {}
    backupSettings.value = {
      backup_auto_enabled: s.backup_auto_enabled || 'false',
      backup_auto_hour: s.backup_auto_hour || '3',
      backup_auto_days: s.backup_auto_days || '[]',
      backup_keep_count: s.backup_keep_count || '14',
      backup_drive_enabled: s.backup_drive_enabled || 'false',
      backup_drive_service_account: s.backup_drive_service_account || '',
      backup_drive_folder_id: s.backup_drive_folder_id || '',
    }
    try { selectedDays.value = JSON.parse(backupSettings.value.backup_auto_days) } catch { selectedDays.value = [] }
  } catch { /* ignore */ }
}

async function saveSettings() {
  savingSettings.value = true
  try {
    backupSettings.value.backup_auto_days = JSON.stringify(selectedDays.value)
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/settings/backup`, { method: 'PUT', body: backupSettings.value })
    toast.success('Đã lưu cấu hình backup.')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi lưu cấu hình'))
  } finally {
    savingSettings.value = false
  }
}

onMounted(() => {
  loadBackups()
  loadStatus()
  loadSettings()
  loadDriveStatus()
  loadDriveConfig()
  // Toast feedback từ lượt callback OAuth Drive.
  const route = useRoute()
  if (route.query.drive_linked === '1') {
    toast.success('Đã liên kết Google Drive thành công.')
  } else if (typeof route.query.drive_error === 'string') {
    const reasonMap: Record<string, string> = {
      oauth_not_configured: 'Chưa cấu hình OAuth Drive (Client ID/Secret) ở trang này.',
      disabled: 'OAuth Drive đang tắt.',
      not_configured: 'Chưa cấu hình OAuth Drive (Client ID/Secret).',
      secret_unreadable: 'Client secret Drive không giải mã được — dịch khoá hoặc nhập lại.',
      state_failed: 'Xác thực state thất bại — thử lại.',
      declined: 'Bạn đã từ chối consent Google.',
      exchange_failed: 'Đổi mã Google token thất bại — thử lại.',
      aud_mismatch: 'Token Google không khớp ứng dụng — kiểm tra Client ID Drive.',
      store_failed: 'Lưu liên kết thất bại — thử lại.',
      failed: 'Liên kết thất bại — thử lại.',
    }
    toast.error(reasonMap[route.query.drive_error] || `Liên kết Drive thất bại (${route.query.drive_error}).`)
  }
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
      <h1 class="m-0 text-[1.3rem] font-extrabold text-[#122815]">Sao lưu & Khôi phục</h1>
      <p class="m-0 mt-1 text-sm text-[#667768]">Backup CSDL + file, tải về hoặc upload Google Drive, khôi phục khi cần.</p>
    </header>

    <!-- Banner trạng thái khôi phục — luôn hiển thị khi restoring, không rụt về 0 -->
    <div v-if="restoring" class="rounded-xl border border-[#f0dcae] bg-[#fdf6e7] p-4 text-sm text-[#8a6412] flex flex-col gap-3" role="status" :aria-busy="restoring">
      <div class="flex items-start gap-2">
        <i class="fa-solid fa-spinner animate-spin mt-0.5 motion-reduce:animate-none" aria-hidden="true"></i>
        <div class="flex-1 min-w-0">
          <strong class="block">
            {{ uploadProgress >= 0 && uploadProgress < 100 ? `Đang upload ${uploadFilename}` : RESTORE_PHASE_LABEL[restoreStatus?.phase ?? ''] ?? 'Đang khôi phục' }}
          </strong>
          <span class="text-[#667768] break-words">{{ restoreStatus?.message || 'đang xử lý...' }}</span>
        </div>
        <span v-if="restoreElapsed" class="text-xs font-bold tabular-nums text-[#8a6412] shrink-0">{{ restoreElapsed }}</span>
      </div>
      <!-- Progress bar: upload phase (0-100 từ XHR) hoặc extract phase (từ backend) -->
      <div class="flex items-center gap-2">
        <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-[#f0e0c0]" role="progressbar" :aria-valuenow="currentRestorePercent" aria-valuemin="0" aria-valuemax="100" :aria-label="`Tiến độ khôi phục ${currentRestorePercent}%`">
          <div class="h-full rounded-full bg-[#8a6412] transition-all duration-300 motion-reduce:transition-none" :style="{ width: `${currentRestorePercent}%` }"></div>
        </div>
        <span class="text-xs font-bold tabular-nums text-[#8a6412] min-w-[3rem] text-right">{{ currentRestorePercent }}%</span>
      </div>
      <!-- Thông tin thêm: dung lượng + tốc độ khi đang upload -->
      <div v-if="uploadProgress >= 0 && uploadProgress < 100 && uploadBytesTotal > 0" class="flex items-center gap-3 text-[0.78rem] text-[#667768]">
        <span><i class="fa-solid fa-file-arrow-up mr-1" aria-hidden="true"></i>{{ formatBytes(uploadBytesLoaded) }} / {{ formatBytes(uploadBytesTotal) }}</span>
        <span v-if="uploadSpeed" class="text-[#8a6412] font-semibold"><i class="fa-solid fa-gauge-high mr-1" aria-hidden="true"></i>{{ uploadSpeed }}</span>
      </div>
      <!-- Log các phase đã đi qua -->
      <ol v-if="restoreLog.length > 1" class="m-0 p-0 list-none flex flex-col gap-1 text-[0.78rem]">
        <li v-for="(log, i) in restoreLog" :key="i" class="flex items-start gap-2">
          <i class="fa-solid fa-check text-[#2c6e33] mt-0.5 text-[0.7rem]" aria-hidden="true" v-if="i < restoreLog.length - 1 || currentRestorePercent === 100"></i>
          <i class="fa-solid fa-circle-notch fa-spin text-[#8a6412] mt-0.5 text-[0.7rem] motion-reduce:animate-none" aria-hidden="true" v-else></i>
          <span class="text-[#3d4a3e]"><strong>{{ RESTORE_PHASE_LABEL[log.phase] ?? log.phase }}:</strong> {{ log.message }}<span v-if="log.percent !== undefined" class="text-[#667768]"> ({{ log.percent }}%)</span></span>
        </li>
      </ol>
      <p class="m-0 text-[0.78rem] text-[#667768]"><i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>Cổng có thể chậm trong giây lát. Có thể đóng trang — worker tiếp tục trong nền.</p>
    </div>
    <div v-else-if="running" class="rounded-xl border border-[#cce5cd] bg-[#eef7ee] px-4 py-3 text-sm text-[#1e4620] flex items-center gap-2" role="status">
      <i class="fa-solid fa-spinner animate-spin motion-reduce:animate-none" aria-hidden="true"></i>
      <span>Đang backup — {{ backupStatus?.message }}</span>
    </div>

    <!-- ─── Section 1: Backup mới ──────────────────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-3">
      <div class="flex items-start gap-2">
        <i class="fa-solid fa-floppy-disk text-lg text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
        <div>
          <h2 class="m-0 text-base font-bold text-[#122815]">Tạo backup mới</h2>
          <p class="m-0 mt-0.5 text-[0.82rem] text-[#667768]">Tạo bản sao lưu ngay — CSDL, file tải lên, hoặc cả hai.</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#1e4620] disabled:opacity-50 disabled:cursor-not-allowed" :disabled="running || restoring" @click="runBackup('sql')">
          <i class="fa-solid fa-database" :class="running ? 'fa-spinner animate-spin motion-reduce:animate-none' : ''" aria-hidden="true"></i> Sao lưu CSDL
        </button>
        <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#1e4620] disabled:opacity-50 disabled:cursor-not-allowed" :disabled="running || restoring" @click="runBackup('files')">
          <i class="fa-solid fa-file-zipper" :class="running ? 'fa-spinner animate-spin motion-reduce:animate-none' : ''" aria-hidden="true"></i> Sao lưu File
        </button>
        <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-[#1e4620] px-4 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#122815] disabled:opacity-50 disabled:cursor-not-allowed" :disabled="running || restoring" @click="runBackup('all')">
          <i class="fa-solid fa-floppy-disk" :class="running ? 'fa-spinner animate-spin motion-reduce:animate-none' : ''" aria-hidden="true"></i> Sao lưu cả hai
        </button>
      </div>
    </section>

    <!-- ─── Section 2: Khôi phục từ file upload ────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-3">
      <div class="flex items-start gap-2">
        <i class="fa-solid fa-upload text-lg text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
        <div>
          <h2 class="m-0 text-base font-bold text-[#122815]">Khôi phục từ file upload</h2>
          <p class="m-0 mt-0.5 text-[0.82rem] text-[#667768]">Chọn file backup (.sql.gz hoặc .tar.gz) tải lên để khôi phục. File sẽ ghi đè dữ liệu hiện tại.</p>
        </div>
      </div>
      <div class="rounded-lg border border-dashed border-[#b8cdba] bg-[#f8faf8] p-4 flex flex-col gap-2">
        <label class="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2.5 text-sm font-bold text-white border-0 hover:bg-[#1e4620] disabled:opacity-50 disabled:cursor-not-allowed" :class="{ 'pointer-events-none opacity-50': restoring || running }">
          <i class="fa-solid fa-upload" aria-hidden="true"></i> Chọn file backup
          <input type="file" accept=".sql.gz,.tar.gz,application/gzip" class="sr-only" :disabled="restoring || running" @change="onRestoreUpload" />
        </label>
        <p class="m-0 text-[0.78rem] text-[#667768]"><i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>Hỗ trợ .sql.gz (CSDL) và .tar.gz (file). Hành động này không thể hoàn tác.</p>
      </div>
    </section>

    <!-- ─── Section 3: Danh sách backup ────────────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-start gap-2">
          <i class="fa-solid fa-list text-lg text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
          <div>
            <h2 class="m-0 text-base font-bold text-[#122815]">Danh sách backup</h2>
            <p class="m-0 mt-0.5 text-[0.82rem] text-[#667768]">Tải về, khôi phục hoặc xoá các bản sao lưu đã tạo.</p>
          </div>
        </div>
        <div class="flex gap-2">
          <label for="backup-filter-type" class="sr-only">Lọc theo loại</label>
          <select id="backup-filter-type" v-model="filterType" class="rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm outline-none focus:border-[#2c6e33]" @change="page = 1; loadBackups()">
            <option value="">Tất cả</option>
            <option value="sql">CSDL</option>
            <option value="media">File</option>
          </select>
          <button type="button" class="rounded-lg border border-[#c8d6c9] px-3 py-2 text-sm font-semibold text-[#2c6e33] hover:bg-[#f0f7f1]" aria-label="Tải lại danh sách" @click="loadBackups()"><i class="fa-solid fa-rotate-right" :class="loading ? 'fa-spinner animate-spin motion-reduce:animate-none' : ''" aria-hidden="true"></i></button>
        </div>
      </div>

      <SkeletonTable v-if="loading" label="Đang tải danh sách backup" :rows="5" :cols="6" />

      <div v-else-if="error" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-4 text-sm text-[#a32924]" role="alert">
        {{ error }} Vui lòng <button type="button" class="font-bold underline text-[#4A6741]" @click="loadBackups()">thử lại</button>.
      </div>

      <div v-else-if="!items.length" class="py-12 text-center text-[#9ca3af]">
        <i class="fa-regular fa-floppy-disk text-4xl text-[#d1d5db]" aria-hidden="true"></i>
        <p class="m-0 mt-3 text-sm">Chưa có bản backup nào.</p>
      </div>

      <!-- Mobile Card View: Hiển thị dạng thẻ trên điện thoại -->
      <div class="md:hidden divide-y divide-[#eef2ee] rounded-xl border border-[#e2ece3] overflow-hidden">
        <div
          v-for="item in items"
          :key="'m-'+item.id"
          class="p-4 flex flex-col gap-2.5"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="m-0 font-mono font-bold text-xs text-[#122815] truncate" :title="item.filename">{{ item.filename }}</p>
              <span class="inline-block mt-1 rounded-full border border-[#cce5cd] bg-[#eef7ee] px-2 py-0.5 text-[0.7rem] font-bold text-[#1e4620]">
                {{ typeLabel(item.type) }}
              </span>
            </div>
            <span class="text-xs font-semibold text-[#667768] shrink-0">{{ formatBytes(item.bytes) }}</span>
          </div>

          <div class="flex items-center justify-between text-[0.75rem] text-[#667768] pt-1">
            <span>{{ formatWhen(item.createdAt) }}</span>
            <span class="flex items-center gap-1">
              <span class="text-[0.7rem] text-[#8a9a8c]">Drive:</span>
              <i v-if="item.driveUploaded" class="fa-solid fa-circle-check text-[#2c6e33]" aria-hidden="true"></i>
              <i v-else class="fa-regular fa-circle text-[#d1d5db]" aria-hidden="true"></i>
            </span>
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#f4f7f4]">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-[#f0f7f1] px-3 py-1.5 text-xs font-bold text-[#2c6e33] border-0 cursor-pointer hover:bg-[#e4f2e5]"
              title="Tải về"
              @click="downloadBackup(item.filename)"
            >
              <i class="fa-solid fa-download" aria-hidden="true"></i> Tải về
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-[#fdf6e7] px-3 py-1.5 text-xs font-bold text-[#8a6412] border-0 cursor-pointer hover:bg-[#f5e8c8] disabled:opacity-60"
              title="Khôi phục"
              :disabled="restoring || running"
              @click="restoreBackup(item.filename)"
            >
              <i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Khôi phục
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-[#ffebe9] px-3 py-1.5 text-xs font-bold text-[#d12420] border-0 cursor-pointer hover:bg-red-200"
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
          <thead class="bg-[#f4f7f4] text-xs uppercase tracking-wide text-[#667768]">
            <tr>
              <th class="px-3.5 py-3">Thời điểm</th>
              <th class="px-3.5 py-3">Loại</th>
              <th class="px-3.5 py-3">File</th>
              <th class="px-3.5 py-3">Dung lượng</th>
              <th class="px-3.5 py-3">Drive</th>
              <th class="px-3.5 py-3">Hành động</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" class="border-t border-[#eef2ee] hover:bg-[#fafcfa]">
              <td class="px-3.5 py-2.5 whitespace-nowrap text-[#3d4a3e]">{{ formatWhen(item.createdAt) }}</td>
              <td class="px-3.5 py-2.5"><span class="rounded-full border border-[#cce5cd] bg-[#eef7ee] px-2 py-0.5 text-[0.72rem] font-bold text-[#1e4620]">{{ typeLabel(item.type) }}</span></td>
              <td class="px-3.5 py-2.5 truncate max-w-[200px] text-[#122815]" :title="item.filename">{{ item.filename }}</td>
              <td class="px-3.5 py-2.5 text-[#667768]">{{ formatBytes(item.bytes) }}</td>
              <td class="px-3.5 py-2.5">
                <i v-if="item.driveUploaded" class="fa-solid fa-circle-check text-[#2c6e33]" aria-hidden="true"></i>
                <i v-else class="fa-regular fa-circle text-[#d1d5db]" aria-hidden="true"></i>
              </td>
              <td class="px-3.5 py-2.5">
                <div class="flex gap-1.5">
                  <button type="button" class="rounded-md bg-[#f0f7f1] px-2 py-1 text-[0.72rem] font-medium text-[#2c6e33] border-0 cursor-pointer hover:bg-[#e4f2e5]" title="Tải về" @click="downloadBackup(item.filename)"><i class="fa-solid fa-download" aria-hidden="true"></i></button>
                  <button type="button" class="rounded-md bg-[#fdf6e7] px-2 py-1 text-[0.72rem] font-medium text-[#8a6412] border-0 cursor-pointer hover:bg-[#f5e8c8]" title="Khôi phục" :disabled="restoring || running" @click="restoreBackup(item.filename)"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button>
                  <button type="button" class="rounded-md bg-[#ffebe9] px-2 py-1 text-[0.72rem] font-medium text-[#d12420] border-0 cursor-pointer hover:bg-red-200" title="Xoá" @click="deleteBackup(item)"><i class="fa-regular fa-trash" aria-hidden="true"></i></button>
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

    <!-- ─── Section 4: Cài đặt backup ───────────────────────────────────────── -->
    <section class="rounded-xl border border-[#e2ece3] bg-white p-5 flex flex-col gap-4">
      <div class="flex items-start gap-2">
        <i class="fa-solid fa-gear text-lg text-[#2c6e33] mt-0.5" aria-hidden="true"></i>
        <div>
          <h2 class="m-0 text-base font-bold text-[#122815]">Cài đặt backup</h2>
          <p class="m-0 mt-0.5 text-[0.82rem] text-[#667768]">Lịch backup tự động và cấu hình Google Drive.</p>
        </div>
      </div>

      <!-- Tự động -->
      <div class="flex flex-col gap-3 rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-4">
        <label class="flex items-center gap-3 text-sm font-bold text-[#122815]">
          <input type="checkbox" v-model="backupSettings.backup_auto_enabled" true-value="true" false-value="false" class="h-4 w-4 accent-[#2c6e33]" />
          Backup tự động theo lịch
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-sm font-bold">Giờ chạy (0-23)
            <input type="number" v-model="backupSettings.backup_auto_hour" min="0" max="23" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal" />
          </label>
          <label class="text-sm font-bold">Số bản giữ
            <input type="number" v-model="backupSettings.backup_keep_count" min="1" max="365" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal" />
          </label>
        </div>
        <div class="flex flex-col gap-2">
          <span class="text-sm font-bold">Ngày chạy</span>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="day in daysOptions" :key="day.value" type="button" class="rounded-lg border px-3 py-1.5 text-sm font-semibold" :class="selectedDays.includes(day.value) ? 'border-[#2c6e33] bg-[#2c6e33] text-white' : 'border-[#c8d6c9] bg-white text-[#2c6e33] hover:bg-[#f0f7f1]'" @click="selectedDays.includes(day.value) ? selectedDays = selectedDays.filter(d => d !== day.value) : selectedDays.push(day.value)">{{ day.label }}</button>
            <button type="button" class="rounded-lg border border-[#c8d6c9] px-3 py-1.5 text-sm font-semibold text-[#667768] hover:bg-[#f0f7f1]" @click="selectedDays = []">Mỗi ngày</button>
          </div>
        </div>
      </div>

      <!-- Google Drive -->
      <div class="flex flex-col gap-4 rounded-lg border border-[#e2ece3] bg-[#f8faf8] p-4">
        <label class="flex items-center gap-3 text-sm font-bold text-[#122815]">
          <input type="checkbox" v-model="backupSettings.backup_drive_enabled" true-value="true" false-value="false" class="h-4 w-4 accent-[#2c6e33]" />
          Upload lên Google Drive
        </label>

        <!-- Sub-block A: Liên kết tài khoản Google (OAuth) — ưu tiên -->
        <div class="flex flex-col gap-3 rounded-lg border border-[#cce5cd] bg-white p-3">
          <h3 class="m-0 text-sm font-bold text-[#1e4620]">Liên kết tài khoản Google (OAuth)</h3>
          <p class="m-0 text-[0.8rem] text-[#667768]">Liên kết tài khoản Google cá nhân — backup upload lên Drive của bạn, tự làm mới token. Được ưu tiên nếu đã liên kết.</p>
          <p class="m-0 text-[0.78rem] text-[#8a6412]">
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
            OAuth Drive dùng <strong>Client ID/Secret riêng</strong> (không dùng chung với đăng nhập người đọc). Tạo OAuth Client riêng trong Google Cloud Console, chọn "Web application", thêm Redirect URI bên dưới.
          </p>

          <!-- Form credentials Drive (tách khỏi reader) -->
          <div v-if="driveConfigLoading" class="text-[0.8rem] text-[#667768]">Đang tải cấu hình…</div>
          <div v-else class="flex flex-col gap-2.5">
            <label class="text-sm font-bold text-[#122815]">Client ID (Drive)
              <input v-model="driveClientId" type="text" placeholder="xxxx.apps.googleusercontent.com" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal text-[0.82rem] outline-none focus:border-[#2c6e33]" />
            </label>
            <label class="text-sm font-bold text-[#122815]">Client Secret (Drive)
              <input v-model="driveClientSecret" type="password" :placeholder="driveConfig?.hasClientSecret ? `••••${driveConfig.clientSecretMasked?.slice(-4) || ''}` : 'Nhập client secret'" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal text-[0.82rem] outline-none focus:border-[#2c6e33]" />
            </label>
            <div v-if="driveConfig?.hasClientSecret" class="flex items-center gap-2">
              <button type="button" class="inline-flex items-center gap-1 rounded-md bg-[#ffebe9] px-2.5 py-1 text-[0.72rem] font-bold text-[#d12420] border-0 cursor-pointer hover:bg-red-200 disabled:opacity-50" :disabled="clearingDriveSecret" @click="clearDriveSecret">
                <i class="fa-solid fa-trash-can" :class="clearingDriveSecret ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Gỡ client secret
              </button>
              <span v-if="driveConfig?.clientSecretStatus === 'secret_unreadable'" class="text-[0.72rem] text-[#8a6412]">Secret không giải mã được — dịch khoá hoặc nhập lại.</span>
            </div>
            <label class="flex items-center gap-2 text-sm font-bold text-[#122815]">
              <input type="checkbox" v-model="driveEnabled" class="h-4 w-4 accent-[#2c6e33]" /> Bật OAuth Drive
            </label>
            <button type="button" class="inline-flex w-fit items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#1e4620] disabled:opacity-50" :disabled="savingDriveConfig" @click="saveDriveConfig">
              <i class="fa-solid fa-floppy-disk" :class="savingDriveConfig ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Lưu credentials
            </button>
          </div>

          <!-- Redirect URI để copy vào Google Console -->
          <div class="flex items-center gap-2 rounded border border-[#e2ece3] bg-[#f8faf8] px-2.5 py-1.5">
            <span class="text-[0.72rem] font-bold text-[#667768] whitespace-nowrap">Redirect URI:</span>
            <code class="flex-1 overflow-x-auto text-[0.74rem] text-[#122815]">{{ driveRedirectUri || '(chưa tải)' }}</code>
            <button type="button" class="rounded p-1 text-[#2c6e33] border-0 bg-transparent cursor-pointer hover:bg-[#e4f2e5]" title="Copy" @click="copyRedirectUri"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
          </div>

          <!-- Nút liên kết (chỉ khi config đã bật) -->
          <div v-if="driveLinkLoading" class="text-[0.8rem] text-[#667768]">Đang tải trạng thái liên kết…</div>
          <div v-else-if="driveLink?.linked" class="flex flex-wrap items-center gap-2">
            <i class="fa-solid fa-circle-check text-[#2c6e33]" aria-hidden="true"></i>
            <span class="text-[0.84rem] text-[#122815]">Đã liên kết: <strong>{{ driveLink.linkedEmail || '(không có email)' }}</strong> <span v-if="driveLink.linkedAt">— {{ formatWhen(driveLink.linkedAt) }}</span></span>
            <button type="button" class="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#ffebe9] px-2.5 py-1 text-[0.72rem] font-bold text-[#d12420] border-0 cursor-pointer hover:bg-red-200 disabled:opacity-50" :disabled="disconnecting" @click="disconnectDrive">
              <i class="fa-solid fa-link-slash" :class="disconnecting ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Hủy liên kết
            </button>
          </div>
          <div v-else-if="driveLink?.status === 'secret_unreadable'" class="flex flex-wrap items-center gap-2">
            <i class="fa-solid fa-triangle-exclamation text-[#8a6412]" aria-hidden="true"></i>
            <span class="text-[0.84rem] text-[#8a6412]">Refresh token không giải mã được — dịch khoá CHATBOT_ENCRYPTION_SECRET hoặc liên kết lại.</span>
            <button type="button" class="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#fdf6e7] px-2.5 py-1 text-[0.72rem] font-bold text-[#8a6412] border-0 cursor-pointer hover:bg-[#f5e8c8]" @click="disconnectDrive">Xoá liên kết hỏng</button>
          </div>
          <div v-else-if="driveConfig?.isEnabled" class="flex flex-col gap-2">
            <a href="/api/admin/backup/drive/start" class="inline-flex w-fit items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-bold text-white border-0 no-underline hover:bg-[#1e4620]">
              <i class="fa-brands fa-google" aria-hidden="true"></i> Liên kết Google Drive
            </a>
            <p v-if="driveToast" class="m-0 text-[0.78rem] text-[#a32924]" role="alert">{{ driveToast }}</p>
          </div>
          <div v-else class="text-[0.78rem] text-[#8a6412]">
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
            Cần nhập Client ID + Client Secret + bật công tắc + Lưu credentials trước khi liên kết.
          </div>
        </div>

        <!-- Sub-block B: Service Account (fallback) -->
        <div class="flex flex-col gap-2 rounded-lg border border-[#e2ece3] bg-white p-3">
          <h3 class="m-0 text-sm font-bold text-[#122815]">Service Account (fallback cho scheduler)</h3>
          <p class="m-0 text-[0.8rem] text-[#667768]">Dùng khi không liên kết tài khoản cá nhân, hoặc cho backup tự động qua scheduler. Cần share folder Drive với email service account.</p>
          <label class="text-sm font-bold">Service Account JSON key
            <textarea v-model="backupSettings.backup_drive_service_account" placeholder="{ &quot;type&quot;: &quot;service_account&quot;, ... }" rows="4" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-mono text-[0.78rem]" />
          </label>
          <label class="text-sm font-bold">Folder ID (tùy chọn — dùng chung cho cả 2 mode)
            <input type="text" v-model="backupSettings.backup_drive_folder_id" placeholder="1aBcDeFgHiJkLmNoPqRsTuVwXyZ" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2 font-normal" />
          </label>
        </div>
      </div>

      <button type="button" class="inline-flex w-fit items-center gap-2 rounded-lg bg-[#2c6e33] px-5 py-2.5 text-sm font-bold text-white border-0 cursor-pointer hover:bg-[#1e4620] disabled:opacity-50" :disabled="savingSettings" @click="saveSettings">
        <i class="fa-solid fa-floppy-disk" :class="savingSettings ? 'fa-spinner animate-spin' : ''" aria-hidden="true"></i> Lưu cấu hình
      </button>
    </section>
  </div>
</template>
