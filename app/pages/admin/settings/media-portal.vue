<script setup lang="ts">
import { errorMessage } from '~/utils/errorMessage'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * Cài đặt Media Portal — lớp override CSDL > env > mặc định.
 *
 * Chín thông số sửa được qua form (nhận video, dung lượng, chunk, ngưỡng đĩa,
 * dọn upload bỏ dở, chuyển mã). Workdir và FFmpeg chỉ hiển thị read-only vì
 * đổi chúng cần restart container. Mỗi field ghi nguồn hiện tại (CSDL/env/mặc
 * định) — cùng pattern `data-retention.vue`.
 */

type MediaPortalConfig = {
  uploadEnabled: boolean
  maxUploadSize: number
  chunkSize: number
  diskFloorBytes: number
  sessionInactivityHours: number
  processingHeartbeatSeconds: number
  processingStaleMinutes: number
  processingMaxJobs: number
  processingMaxAttempts: number
  videoStorage: {
    provider: 'local' | 'r2'
    r2AccountId: string
    r2AccessKey: string
    r2Bucket: string
    r2PublicUrl: string
  }
}

type Source = 'database' | 'environment' | 'default'

type VideoStorageSources = {
  provider: Source
  r2AccountId: Source
  r2AccessKey: Source
  r2SecretKey: Source
  r2Bucket: Source
  r2PublicUrl: Source
}

type SettingsResponse = {
  ok: true
  config: MediaPortalConfig
  sources: Record<keyof Omit<MediaPortalConfig, 'videoStorage'>, Source>
  videoStorageSources: VideoStorageSources
  videoStorage: {
    provider: 'local' | 'r2'
    r2Configured: boolean
    secretMasked: string
    secretUnreadable: boolean
    localCount: number
    r2Count: number
  }
  workdir: string
  workdirIsDefault: boolean
  ffmpegInstalled: boolean
  ffmpegPath: string | null
  diskFreeBytes: number | null
  diskFloorBytes: number
}

const SOURCE_LABELS: Record<Source, string> = {
  database: 'đang đặt tại đây',
  environment: 'đang lấy từ biến môi trường',
  default: 'đang dùng giá trị mặc định',
}

const toast = useToast()
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const cleaning = ref(false)
const data = ref<SettingsResponse | null>(null)

const form = reactive({
  uploadEnabled: true,
  maxUploadSizeGb: 2,
  chunkSizeMb: 8,
  diskFloorGb: 5,
  sessionInactivityHours: 12,
  processingHeartbeatSeconds: 30,
  processingStaleMinutes: 10,
  processingMaxJobs: 1,
  processingMaxAttempts: 3,
  // R2 cho video
  videoStorageProvider: 'local' as 'local' | 'r2',
  videoR2AccountId: '',
  videoR2AccessKey: '',
  videoR2SecretKey: '',
  videoR2Bucket: '',
  videoR2PublicUrl: '',
})

const BYTES_PER_GB = 1024 * 1024 * 1024
const BYTES_PER_MB = 1024 * 1024

function bytesToGb(bytes: number): number {
  return Number((bytes / BYTES_PER_GB).toFixed(2))
}
function gbToBytes(gb: number): number {
  return Math.round(gb * BYTES_PER_GB)
}
function bytesToMb(bytes: number): number {
  return Number((bytes / BYTES_PER_MB).toFixed(1))
}
function mbToBytes(mb: number): number {
  return Math.round(mb * BYTES_PER_MB)
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'không rõ'
  if (bytes >= BYTES_PER_GB) return `${bytesToGb(bytes)} GB`
  if (bytes >= BYTES_PER_MB) return `${bytesToMb(bytes)} MB`
  return `${bytes} B`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<SettingsResponse>)(`/api/admin/settings/media-portal`)
    const c = data.value.config
    form.uploadEnabled = c.uploadEnabled
    form.maxUploadSizeGb = bytesToGb(c.maxUploadSize)
    form.chunkSizeMb = bytesToMb(c.chunkSize)
    form.diskFloorGb = bytesToGb(c.diskFloorBytes)
    form.sessionInactivityHours = c.sessionInactivityHours
    form.processingHeartbeatSeconds = c.processingHeartbeatSeconds
    form.processingStaleMinutes = c.processingStaleMinutes
    form.processingMaxJobs = c.processingMaxJobs
    form.processingMaxAttempts = c.processingMaxAttempts
    // R2
    form.videoStorageProvider = c.videoStorage.provider
    form.videoR2AccountId = c.videoStorage.r2AccountId
    form.videoR2AccessKey = c.videoStorage.r2AccessKey
    form.videoR2Bucket = c.videoStorage.r2Bucket
    form.videoR2PublicUrl = c.videoStorage.r2PublicUrl
    // Secret key: hiển thị masked từ server, không điền vào form. Ô input để trống
    // — cán bộ chỉ nhập khi muốn đổi. `videoStorage.secretMasked` hiển thị riêng.
    form.videoR2SecretKey = ''
    // Phát hiện "đang dùng chung R2 với Media Storage" — so khớp 4 field public
    // với settings `r2_*`. Khớp hết → dùng chung, khác → R2 riêng.
    try {
      const msRes = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean, settings: Record<string, string | null> }>)(`/api/admin/settings`)
      const ms = msRes.settings ?? {}
      const sameAccount = ms.r2_account_id && form.videoR2AccountId === ms.r2_account_id
      const sameAccess = ms.r2_access_key && form.videoR2AccessKey === ms.r2_access_key
      const sameBucket = ms.r2_bucket && form.videoR2Bucket === ms.r2_bucket
      usingSharedMediaStorageR2.value = Boolean(sameAccount && sameAccess && sameBucket)
    } catch { /* không chặn load */ }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Không tải được cấu hình Media Portal.'
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/settings/media-portal`, {
      method: 'PUT',
      body: {
        fields: {
          uploadEnabled: String(form.uploadEnabled),
          maxUploadSize: String(gbToBytes(form.maxUploadSizeGb)),
          chunkSize: String(mbToBytes(form.chunkSizeMb)),
          diskFloorBytes: String(gbToBytes(form.diskFloorGb)),
          sessionInactivityHours: String(form.sessionInactivityHours),
          processingHeartbeatSeconds: String(form.processingHeartbeatSeconds),
          processingStaleMinutes: String(form.processingStaleMinutes),
          processingMaxJobs: String(form.processingMaxJobs),
          processingMaxAttempts: String(form.processingMaxAttempts),
          // R2 — secret key rỗng = giữ nguyên (server skip), có giá trị = mã hoá mới
          videoStorageProvider: form.videoStorageProvider,
          videoR2AccountId: form.videoR2AccountId,
          videoR2AccessKey: form.videoR2AccessKey,
          videoR2SecretKey: form.videoR2SecretKey,
          videoR2Bucket: form.videoR2Bucket,
          videoR2PublicUrl: form.videoR2PublicUrl,
        },
      },
    })
    toast.success('Đã lưu cài đặt Media Portal.')
    await load()
  } catch (err) {
    const msg = err && typeof err === 'object' && 'statusMessage' in err
      ? String((err as { statusMessage?: string }).statusMessage ?? '')
      : (err instanceof Error ? err.message : 'Không lưu được cài đặt.')
    toast.error(msg || 'Không lưu được cài đặt.')
  } finally {
    saving.value = false
  }
}

async function cleanNow() {
  cleaning.value = true
  try {
    const result = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: true, sessions: number, orphans: number }>)(
      '/api/admin/media-portal/upload/housekeep',
      { method: 'POST', body: { confirm: true } },
    )
    const total = result.sessions + result.orphans
    if (total === 0) toast.success('Không có phiên bỏ dở nào cần dọn.')
    else toast.success(`Đã dọn ${result.sessions} phiên, ${result.orphans} thư mục mồ côi.`)
  } catch (err) {
    const msg = err && typeof err === 'object' && 'statusMessage' in err
      ? String((err as { statusMessage?: string }).statusMessage ?? '')
      : (err instanceof Error ? err.message : 'Không dọn được.')
    toast.error(msg || 'Không dọn được.')
  } finally {
    cleaning.value = false
  }
}

const importingFromMediaStorage = ref(false)
const usingSharedMediaStorageR2 = ref(false)

/**
 * "Dùng R2 của Media Storage" — copy cả 5 field + set provider=r2 + báo dùng chung.
 * Endpoint `/api/admin/settings` mask `r2_secret_key` thành `********` cho non-superadmin,
 * nên chỉ superadmin mới thấy secret thật để tự điền. Non-superadmin phải nhập tay.
 * Đây là "sử dụng chung" copy 1 lần, không phải reference động.
 */
async function useMediaStorageR2() {
  importingFromMediaStorage.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean, settings: Record<string, string | null> }>)(`/api/admin/settings`)
    const s = res.settings ?? {}
    const filled: string[] = []
    if (s.r2_account_id) { form.videoR2AccountId = s.r2_account_id; filled.push('Account ID') }
    if (s.r2_access_key) { form.videoR2AccessKey = s.r2_access_key; filled.push('Access Key') }
    if (s.r2_bucket) { form.videoR2Bucket = s.r2_bucket; filled.push('Bucket') }
    if (s.r2_public_url) { form.videoR2PublicUrl = s.r2_public_url; filled.push('Public URL') }
    // Secret chỉ plaintext khi superadmin; `********` = mask, không điền mask giả.
    if (s.r2_secret_key && s.r2_secret_key !== '********') {
      form.videoR2SecretKey = s.r2_secret_key
      filled.push('Secret Key')
    }
    if (s.media_provider === 'r2') {
      form.videoStorageProvider = 'r2'
    }
    if (filled.length === 0) {
      toast.info('Media Storage chưa cấu hình R2. Nhập tay 5 field bên dưới hoặc cấu hình Media Storage trước.')
      usingSharedMediaStorageR2.value = false
      return
    }
    usingSharedMediaStorageR2.value = true
    const secretNote = filled.includes('Secret Key')
      ? ''
      : '. Secret Key nhập tay bên dưới (chỉ SuperAdmin thấy sẵn)'
    toast.success(`Đã dùng chung R2 với Media Storage (${filled.join(', ')}). Bấm "Lưu cấu hình" để áp dụng${secretNote}.`)
  } catch (err) {
    toast.error(errorMessage(err, 'Không lấy được config từ Media Storage'))
  } finally {
    importingFromMediaStorage.value = false
  }
}

/**
 * "Nhập R2 riêng" — xóa 4 field public + set flag dùng R2 riêng.
 * Cán bộ nhập tay 5 field bên dưới cho video bucket tách biệt ảnh.
 */
function useCustomR2() {
  form.videoR2AccountId = ''
  form.videoR2AccessKey = ''
  form.videoR2SecretKey = ''
  form.videoR2Bucket = ''
  form.videoR2PublicUrl = ''
  form.videoStorageProvider = 'r2'
  usingSharedMediaStorageR2.value = false
  toast.info('Đã xóa field. Nhập 5 field R2 riêng cho video bên dưới, rồi bấm "Lưu cấu hình".')
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Cài Đặt Media Portal</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">
          Cấu hình nhận video, dung lượng tải lên, chuyển mã và dọn upload bỏ dở — override qua CSDL, không cần restart.
        </p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button
          type="button"
          class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="saving || loading"
          @click="save"
        >
          <i class="fa-regular" :class="saving ? 'fa-spinner animate-spin' : 'fa-floppy-disk'"></i>
          {{ saving ? 'Đang lưu...' : 'Lưu cấu hình' }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" role="status" aria-busy="true" class="bg-white rounded-xl border border-[#e2ece3] p-6">
      <span class="sr-only">Đang tải cấu hình Media Portal</span>
      <div class="flex flex-col gap-4">
        <div v-for="n in 5" :key="n" class="animate-pulse motion-reduce:animate-none">
          <div class="h-4 bg-[#EEF2EC] rounded w-1/4 mb-2" aria-hidden="true"></div>
          <div class="h-10 bg-[#EEF2EC] rounded" aria-hidden="true"></div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }} Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="load()">thử lại</button>.
    </div>

    <template v-else-if="data">
      <!-- Cảnh báo khi đang tắt nhận video -->
      <div
        v-if="!form.uploadEnabled"
        class="rounded-xl border border-[#f0c98a] bg-[#fdf6e9] px-5 py-4 flex gap-3 items-start"
      >
        <i class="fa-solid fa-circle-pause text-[#b07d1f] mt-0.5"></i>
        <div>
          <p class="text-[0.9rem] font-bold text-[#7a5a1b] m-0">Đang tắt nhận video</p>
          <p class="text-[0.82rem] text-[#7a5a1b] mt-1 mb-0">
            Cán bộ không thể tải video mới lên cho tới khi bật lại. Video đã lưu vẫn phát được bình thường.
          </p>
        </div>
      </div>

      <!-- Hạ tầng (read-only) -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-1">Hạ tầng máy chủ</h3>
        <p class="text-[0.8rem] text-[#667768] mt-0 mb-5">
          Thư mục lưu video và FFmpeg cố định lúc dựng container — không đổi được qua trang này.
        </p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="rounded-lg border border-[#e2ece3] p-4">
            <p class="text-[0.7rem] text-[#1e4620] m-0 mb-1 uppercase tracking-wide">FFmpeg</p>
            <p class="text-[0.95rem] font-bold m-0" :class="data.ffmpegInstalled ? 'text-[#2c6e33]' : 'text-[#a83232]'">
              <i class="fa-solid mr-1" :class="data.ffmpegInstalled ? 'fa-circle-check' : 'fa-circle-xmark'"></i>
              {{ data.ffmpegInstalled ? 'đã cài' : 'chưa cài' }}
            </p>
            <p v-if="data.ffmpegPath" class="text-[0.72rem] text-[#8a9a8c] m-0 mt-1 break-all">{{ data.ffmpegPath }}</p>
            <p v-else class="text-[0.72rem] text-[#a83232] m-0 mt-1">
              Chuyển mã không chạy được. Cài FFmpeg trong image Docker hoặc qua biến môi trường.
            </p>
          </div>
          <div class="rounded-lg border border-[#e2ece3] p-4">
            <p class="text-[0.7rem] text-[#1e4620] m-0 mb-1 uppercase tracking-wide">Thư mục lưu video</p>
            <p class="text-[0.88rem] font-bold text-[#122815] m-0 break-all">{{ data.workdir }}</p>
            <p class="text-[0.72rem] text-[#8a9a8c] m-0 mt-1">
              {{ data.workdirIsDefault ? 'mặc định' : 'tuỳ chỉnh qua biến môi trường' }} — đổi cần restart container.
            </p>
          </div>
          <div class="rounded-lg border border-[#e2ece3] p-4">
            <p class="text-[0.7rem] text-[#1e4620] m-0 mb-1 uppercase tracking-wide">Đĩa trống</p>
            <p class="text-[0.95rem] font-bold m-0" :class="(data.diskFreeBytes ?? 0) < data.diskFloorBytes ? 'text-[#a83232]' : 'text-[#122815]'">
              {{ formatBytes(data.diskFreeBytes) }}
            </p>
            <p class="text-[0.72rem] text-[#8a9a8c] m-0 mt-1">
              Ngưỡng tối thiểu {{ formatBytes(data.diskFloorBytes) }} — dưới mức này máy chủ từ chối nhận video.
            </p>
          </div>
        </div>
      </div>

      <!-- Form cấu hình -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-1">Nhận & tải lên</h3>
        <p class="text-[0.8rem] text-[#667768] mt-0 mb-5">
          Các thông số dưới đây lưu vào CSDL, override biến môi trường — có hiệu lực ngay cho lượt tải mới, không cần restart container.
        </p>

        <label class="flex items-start gap-3 rounded-lg border border-[#c8d6c9] bg-[#f4f7f4] px-4 py-3 cursor-pointer mb-5">
          <input type="checkbox" v-model="form.uploadEnabled" class="mt-0.5 w-4 h-4 accent-[#2c6e33] cursor-pointer" />
          <span>
            <span class="block text-[0.88rem] font-bold text-[#122815]">Nhận video từ cán bộ</span>
            <span class="block text-[0.78rem] text-[#667768] mt-0.5">
              Tắt đi để khoá toàn bộ lượt tải lên — nút "Tải video" ẩn trên trang Media Portal.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.sources.uploadEnabled] }})</span>
            </span>
          </span>
        </label>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Dung lượng tối đa mỗi video (GB)</label>
            <input type="number" min="0.1" max="10" step="0.1" v-model.number="form.maxUploadSizeGb"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Từ 0.1 đến 10 GB. Vượt mức này bị từ chối trước khi ghi xuống đĩa.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.sources.maxUploadSize] }})</span>
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Kích thước chunk (MB)</label>
            <input type="number" min="1" max="64" step="1" v-model.number="form.chunkSizeMb"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              1–64 MB. Đổi giữa lượt tải đang chạy sẽ dùng chunk cũ cho tới khi hoàn tất.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.sources.chunkSize] }})</span>
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Ngưỡng đĩa tối thiểu (GB)</label>
            <input type="number" min="1" max="100" step="1" v-model.number="form.diskFloorGb"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Dưới mức này máy chủ từ chối nhận video để tránh đầy đĩa.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.sources.diskFloorBytes] }})</span>
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Dọn upload bỏ dở sau (giờ)</label>
            <input type="number" min="1" max="168" step="1" v-model.number="form.sessionInactivityHours"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Phiên tải không hoạt động quá số giờ này sẽ bị xoá khỏi đĩa.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.sources.sessionInactivityHours] }})</span>
            </p>
            <button
              type="button"
              class="inline-flex items-center gap-2 self-start mt-1 px-3 py-1.5 text-[0.78rem] font-bold border border-[#c8d6c9] bg-[#f4f7f4] text-[#1e4620] rounded-lg cursor-pointer hover:bg-[#e6f2e6] hover:border-[#2c6e33] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="cleaning"
              @click="cleanNow"
            >
              <i class="fa-solid" :class="cleaning ? 'fa-spinner animate-spin' : 'fa-broom'"></i>
              {{ cleaning ? 'Đang dọn...' : 'Dọn ngay' }}
            </button>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-1">Chuyển mã (FFmpeg)</h3>
        <p class="text-[0.8rem] text-[#667768] mt-0 mb-5">
          Quản lý hàng đợi chuyển mã video sang HLS đa độ phân giải. Lượt đang chạy dùng config cũ, lượt mới dùng config mới ngay.
        </p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Nhịp tim xử lý (giây)</label>
            <input type="number" min="5" max="300" step="1" v-model.number="form.processingHeartbeatSeconds"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Khoảng cách giữa hai lần cập nhật tiến trình. Quá ngắn tốn CSDL, quá dài khó phát job treo.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.sources.processingHeartbeatSeconds] }})</span>
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tuổi stale (phút)</label>
            <input type="number" min="1" max="120" step="1" v-model.number="form.processingStaleMinutes"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Job không heartbeat quá số phút này bị thu hồi và thử lại.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.sources.processingStaleMinutes] }})</span>
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Job xử lý tối đa</label>
            <input type="number" min="1" max="4" step="1" v-model.number="form.processingMaxJobs"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              1–4. Số video chuyển mã song song. VPS nhỏ nên để 1–2.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.sources.processingMaxJobs] }})</span>
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Số lần thử lại</label>
            <input type="number" min="1" max="10" step="1" v-model.number="form.processingMaxAttempts"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              1–10. Vượt số lần thử, video đánh dấu lỗi và cần bấm "chuyển mã lại" bằng tay.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.sources.processingMaxAttempts] }})</span>
            </p>
          </div>
        </div>
      </div>

      <!-- Lưu trữ R2 cho video -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6">
        <h3 class="text-[1.05rem] font-bold text-[#122815] m-0 mb-1">Lưu trữ R2 cho video</h3>
        <p class="text-[0.8rem] text-[#667768] mt-0 mb-5">
          Bucket + credential R2 <strong>riêng cho video</strong> — tách biệt khỏi thư viện ảnh. Video mới (khi bật R2) sync lên R2 sau khi chuyển mã; video cũ vẫn ở đĩa máy chủ. Stream luôn qua proxy của cổng, không redirect.
        </p>

        <!-- Nút dùng R2 của Media Storage (ảnh) hoặc nhập R2 riêng -->
        <div class="flex flex-col gap-3 mb-5 rounded-lg border border-[#cce5cd] bg-[#eef7ee] px-4 py-3">
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg border border-[#2c6e33] bg-white px-3.5 py-2 text-[0.82rem] font-bold text-[#2c6e33] cursor-pointer transition-colors hover:bg-[#f0f7f1] disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="importingFromMediaStorage"
              @click="useMediaStorageR2"
            >
              <i class="fa-solid" :class="importingFromMediaStorage ? 'fa-spinner animate-spin' : 'fa-link'" aria-hidden="true"></i>
              {{ importingFromMediaStorage ? 'Đang lấy...' : 'Dùng R2 của Media Storage' }}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg border border-[#c8d6c9] bg-white px-3.5 py-2 text-[0.82rem] font-bold text-[#667768] cursor-pointer transition-colors hover:bg-[#f0f7f1] disabled:cursor-not-allowed disabled:opacity-50"
              @click="useCustomR2"
            >
              <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
              Nhập R2 riêng
            </button>
          </div>
          <p class="m-0 text-[0.78rem] text-[#667768]">
            <strong>"Dùng R2 của Media Storage"</strong> — dùng chung R2 với thư viện ảnh (account + bucket + credential từ <NuxtLink to="/admin/settings/media-storage" class="text-[#2c6e33] font-semibold no-underline hover:underline">Media Storage</NuxtLink>). Video + ảnh cùng 1 R2.<br />
            <strong>"Nhập R2 riêng"</strong> — bucket + credential riêng cho video, tách khỏi ảnh. Nhập tay 5 field bên dưới.
          </p>
          <div v-if="usingSharedMediaStorageR2" class="text-[0.78rem] text-[#1e4620] font-semibold">
            <i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i>
            Đang dùng chung R2 với Media Storage. Sửa ở <NuxtLink to="/admin/settings/media-storage" class="text-[#2c6e33] underline">Media Storage</NuxtLink> sẽ không tự cập nhật ở đây — cần bấm lại nút này.
          </div>
        </div>

        <!-- Cảnh báo secret không đọc được (khóa xoay hoặc CSDL copy sai) -->
        <div
          v-if="data.videoStorage.secretUnreadable"
          class="rounded-lg border border-[#E2A0A0] bg-[#fdf0f0] px-4 py-3 mb-5 flex gap-3 items-start"
        >
          <i class="fa-solid fa-triangle-exclamation text-[#a83232] mt-0.5"></i>
          <div>
            <p class="text-[0.88rem] font-bold text-[#a83232] m-0">Secret key không giải mã được</p>
            <p class="text-[0.78rem] text-[#a83232] mt-1 mb-0">
              Khóa mã hoá (`CHATBOT_ENCRYPTION_SECRET`) có thể đã xoay, hoặc CSDL bị copy từ nơi khác. Xoay khóa cũng vô hiệu hoá mọi secret TOTP đã lưu. Nhập lại secret key để khôi phục.
            </p>
          </div>
        </div>

        <!-- Bật/tắt R2 -->
        <label class="flex items-start gap-3 rounded-lg border border-[#c8d6c9] bg-[#f4f7f4] px-4 py-3 cursor-pointer mb-5">
          <input
            type="checkbox"
            :checked="form.videoStorageProvider === 'r2'"
            class="mt-0.5 w-4 h-4 accent-[#2c6e33] cursor-pointer"
            @change="form.videoStorageProvider = ($event.target as HTMLInputElement).checked ? 'r2' : 'local'"
          />
          <span>
            <span class="block text-[0.88rem] font-bold text-[#122815]">Dùng R2 cho video</span>
            <span class="block text-[0.78rem] text-[#667768] mt-0.5">
              Bật để video mới upload sync lên R2 bucket riêng. Tắt để giữ trên đĩa máy chủ (local).
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.videoStorageSources.provider] }})</span>
            </span>
          </span>
        </label>

        <!-- Thống kê video theo provider -->
        <div class="grid grid-cols-2 gap-3 mb-5">
          <div class="rounded-lg border border-[#e2ece3] px-4 py-3">
            <p class="text-[0.7rem] text-[#1e4620] m-0 mb-1 uppercase tracking-wide">Video trên đĩa (local)</p>
            <p class="text-[1.1rem] font-bold text-[#122815] m-0">{{ data.videoStorage.localCount }}</p>
          </div>
          <div class="rounded-lg border border-[#e2ece3] px-4 py-3">
            <p class="text-[0.7rem] text-[#1e4620] m-0 mb-1 uppercase tracking-wide">Video trên R2</p>
            <p class="text-[1.1rem] font-bold text-[#122815] m-0">{{ data.videoStorage.r2Count }}</p>
          </div>
        </div>

        <!-- 5 ô nhập R2 (chỉ hiện khi provider=r2) -->
        <div v-if="form.videoStorageProvider === 'r2'" class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">R2 Account ID</label>
            <input type="text" v-model="form.videoR2AccountId" maxlength="128"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Cloudflare dashboard → R2 → Overview → Account ID.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.videoStorageSources.r2AccountId] }})</span>
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">R2 Access Key ID</label>
            <input type="text" v-model="form.videoR2AccessKey" maxlength="128"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Tạo token R2 với quyền Object Read & Write.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.videoStorageSources.r2AccessKey] }})</span>
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">R2 Secret Key</label>
            <input type="password" v-model="form.videoR2SecretKey" maxlength="256" placeholder="••••••••"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              <template v-if="data.videoStorage.secretMasked">
                Đã lưu: <span class="font-mono font-bold text-[#2c6e33]">{{ data.videoStorage.secretMasked }}</span>. Để trống để giữ nguyên.
              </template>
              <template v-else>
                Chưa cấu hình. Nhập secret key từ token R2.
              </template>
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.videoStorageSources.r2SecretKey] }})</span>
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">R2 Bucket</label>
            <input type="text" v-model="form.videoR2Bucket" maxlength="128"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Tên bucket R2 (tạo sẵn trong Cloudflare).
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.videoStorageSources.r2Bucket] }})</span>
            </p>
          </div>

          <div class="flex flex-col gap-1.5 md:col-span-2">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">R2 Public URL (tuỳ chọn)</label>
            <input type="text" v-model="form.videoR2PublicUrl" maxlength="512" placeholder="https://pub-xxx.r2.dev"
              class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
            <p class="text-[0.72rem] text-[#8a9a8c] m-0">
              Dùng cho thumbnail/preview trực tiếp (nếu bucket công khai). Stream vẫn qua proxy của cổng, không dùng URL này.
              <span class="text-[#8a9a8c]">({{ SOURCE_LABELS[data.videoStorageSources.r2PublicUrl] }})</span>
            </p>
          </div>
        </div>

        <!-- Cảnh báo khi bật R2 nhưng thiếu credential -->
        <div
          v-if="form.videoStorageProvider === 'r2' && !data.videoStorage.r2Configured"
          class="rounded-lg border border-[#f0c98a] bg-[#fdf6e9] px-4 py-3 mt-5 flex gap-3 items-start"
        >
          <i class="fa-solid fa-circle-exclamation text-[#b07d1f] mt-0.5"></i>
          <div>
            <p class="text-[0.88rem] font-bold text-[#7a5a1b] m-0">R2 chưa đủ credential</p>
            <p class="text-[0.78rem] text-[#7a5a1b] mt-1 mb-0">
              Để bật R2, cần nhập đủ Account ID, Access Key, Secret Key và Bucket. Thiếu một trong các này, video mới sẽ lưu local (lùi an toàn).
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
