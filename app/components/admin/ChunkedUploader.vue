<script setup lang="ts">
import { useMediaUploadSession } from '../../composables/useMediaUploadSession'

const props = defineProps<{ open: boolean, maxUploadSize: number, replaceItemId?: number }>()
const emit = defineEmits<{
  close: []
  uploaded: [payload: { mediaItemId: number, slug: string }]
}>()
const { user } = useAdminAuth()
const controller = shallowRef<ReturnType<typeof useMediaUploadSession> | null>(null)
const picking = ref(false)
const pickError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const lastError = computed(() => pickError.value || controller.value?.state.error || '')
const state = computed(() => controller.value?.state)
const busy = computed(() => state.value?.phase === 'working')
const progress = computed(() => state.value?.total ? Math.round(state.value.received / state.value.total * 100) : 0)
const maxSizeLabel = computed(() => (props.maxUploadSize / (1024 ** 3)).toLocaleString('vi-VN', { maximumFractionDigits: 2 }))

// ── % byte và ETA ─────────────────────────────────────────────────────────────
// % byte chính xác hơn % phần vì phần cuối thường nhỏ hơn. ETA suy từ tốc độ
// trung bình (byte / giây) từ lúc `startedAt`. Cập nhật mỗi khi state đổi (reactive).
const byteProgress = computed(() => {
  const s = state.value
  if (!s || !s.totalBytes) return 0
  return Math.min(100, Math.round((s.uploadedBytes / s.totalBytes) * 100))
})
const eta = computed(() => {
  const s = state.value
  if (!s || !s.startedAt || !s.totalBytes || s.uploadedBytes <= 0) return ''
  const elapsedMs = Date.now() - s.startedAt
  if (elapsedMs <= 0) return ''
  const bytesPerMs = s.uploadedBytes / elapsedMs
  if (bytesPerMs <= 0) return ''
  const remainingBytes = s.totalBytes - s.uploadedBytes
  if (remainingBytes <= 0) return 'Sắp xong'
  const remainingMs = remainingBytes / bytesPerMs
  const seconds = Math.ceil(remainingMs / 1000)
  if (seconds < 60) return ` còn khoảng ${seconds} giây`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return ` còn khoảng ${minutes} phút ${secs} giây`
})
// Làm mới ETA mỗi giây (vì `Date.now()` không reactive).
const tick = ref(0)
let ticker: ReturnType<typeof setInterval> | undefined
watchEffect((onCleanup) => {
  if (!busy.value) return
  ticker = setInterval(() => { tick.value++ }, 1000)
  onCleanup(() => { if (ticker) clearInterval(ticker) })
})
// Phụ thuộc `tick` để trigger recompute khi đang tải.
const etaLabel = computed(() => { void tick.value; return eta.value })
const speedLabel = computed(() => {
  const s = state.value
  if (!s || !s.startedAt || s.uploadedBytes <= 0) return ''
  void tick.value
  const elapsedSec = (Date.now() - s.startedAt) / 1000
  if (elapsedSec <= 0) return ''
  const bytesPerSec = s.uploadedBytes / elapsedSec
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`
})

onMounted(() => {
  if (!user.value) return
  // sessionStorage is per browser tab and the key is scoped to the authenticated admin.
  // The server independently checks the session owner on every request.
  let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  try { storage = window.sessionStorage }
  catch {
    storage = { getItem: () => null, setItem: () => { throw new Error('unavailable') }, removeItem: () => {} }
  }
  controller.value = useMediaUploadSession({
    actorId: user.value.id, storage, maxUploadSize: props.maxUploadSize,
    ...(props.replaceItemId ? { replaceItemId: props.replaceItemId } : {}),
    request: (url, options) => $fetch(url, options as Parameters<typeof $fetch>[1]),
  })
})
onBeforeUnmount(() => controller.value?.pause())
watch(() => props.open, open => { if (!open) controller.value?.pause() })

async function pickFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  picking.value = true
  pickError.value = ''
  try { await controller.value?.select(file) }
  catch { pickError.value = 'Không kiểm tra được tệp đã chọn. Hãy thử chọn lại tệp.' }
  finally { picking.value = false }
}
async function retry() {
  if (picking.value) return
  await controller.value?.run()
  const result = state.value?.result
  if (state.value?.phase === 'done' && result) emit('uploaded', result)
}
function pause() { controller.value?.pause() }
function close() { pause(); emit('close') }
function discard() {
  controller.value?.discard()
  pickError.value = ''
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <section v-if="open" aria-labelledby="chunked-uploader-title" class="rounded-2xl border border-[#e2ece3] bg-white p-6 space-y-5 shadow-sm">
    <div class="flex items-center gap-3">
      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e8f0e8] text-[#2c6e33]">
        <i class="fa-solid fa-film" aria-hidden="true"></i>
      </div>
      <div>
        <h2 id="chunked-uploader-title" class="font-bold text-[#122815] m-0">{{ props.replaceItemId ? 'Thay tệp video' : 'Chọn tệp video' }}</h2>
        <p class="text-xs text-[#8aa08c] m-0 mt-0.5">Định dạng MP4, MOV, WebM, MKV — tối đa {{ maxSizeLabel }} GB</p>
      </div>
    </div>

    <p v-if="props.replaceItemId" class="text-sm text-[#667768] m-0 rounded-lg bg-[#f8faf7] p-3 border border-[#eef2ee]">
      <i class="fa-solid fa-circle-info text-[#2c6e33] mr-1.5" aria-hidden="true"></i>
      Tệp mới sẽ thay tệp gốc, giữ tiêu đề và bình luận. Video sẽ được chuyển mã lại từ đầu.
    </p>
    <p v-if="state?.storageWarning" role="status" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 border border-amber-100">{{ state.storageWarning }}</p>

    <!-- Dropzone / file picker -->
    <div
      class="relative rounded-xl border-2 border-dashed transition-colors"
      :class="state?.descriptor ? 'border-[#2c6e33] bg-[#f8faf7]' : 'border-[#c8d6c9] bg-[#fbfdfb] hover:border-[#2c6e33] hover:bg-[#f8faf7]'"
    >
      <label for="chunked-file" class="block cursor-pointer p-8 text-center">
        <div class="flex flex-col items-center gap-3">
          <div class="flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f0e8] text-[#2c6e33]">
            <i class="fa-solid fa-cloud-arrow-up text-2xl" aria-hidden="true"></i>
          </div>
          <div>
            <p class="text-sm font-semibold text-[#122815] m-0">{{ state?.descriptor ? 'Chọn lại tệp ban đầu' : 'Kéo tệp video vào hoặc bấm để chọn' }}</p>
            <p class="text-xs text-[#8aa08c] m-0 mt-1">{{ state?.descriptor ? 'Phải đúng tệp ban đầu để tiếp tục các phần còn thiếu' : 'Hỗ trợ MP4, MOV, WebM, MKV' }}</p>
          </div>
          <input id="chunked-file" ref="fileInput" type="file" accept="video/*" :disabled="busy || picking" aria-label="Tệp video" class="sr-only" @change="pickFile" />
        </div>
      </label>
    </div>
    <p v-if="picking" role="status" class="text-sm text-[#667768] -mt-2 flex items-center gap-1.5"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>Đang kiểm tra tệp…</p>

    <!-- Tệp đã chọn (chưa bấm bắt đầu) — `state.fileName` được đặt ngay trong
         `select()`, còn `state.descriptor` chỉ có sau `initUpload` trong `run()`.
         Nếu chỉ dựa vào `descriptor` thì khoảng từ lúc chọn xong tới lúc bấm
         "Bắt đầu tải lên" không có gì cho biết file đã được chọn. -->
    <div v-if="state?.fileName && !state?.descriptor && !picking" class="rounded-lg bg-[#f8faf7] border border-[#eef2ee] p-3 flex items-center gap-2.5">
      <i class="fa-solid fa-file-video text-[#2c6e33]" aria-hidden="true"></i>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-[#122815] m-0 truncate">{{ state.fileName }}</p>
        <p class="text-xs text-[#8aa08c] m-0">Đã chọn — bấm "Bắt đầu tải lên" để tiếp tục</p>
      </div>
    </div>

    <!-- Lượt tải đang dở -->
    <div v-if="state?.descriptor" class="rounded-lg bg-[#f8faf7] border border-[#eef2ee] p-3 flex items-center gap-2.5">
      <i class="fa-solid fa-file-video text-[#2c6e33]" aria-hidden="true"></i>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-[#122815] m-0 truncate">{{ state.descriptor.filename }}</p>
        <p class="text-xs text-[#8aa08c] m-0">Lượt tải đang dở — tiếp tục để hoàn tất</p>
      </div>
    </div>

    <!-- Tiến độ tải -->
    <div v-if="state?.total" class="space-y-2.5">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <p class="text-sm text-[#667768] m-0" aria-live="polite">
          {{ state.received }} / {{ state.total }} phần đã nhận
        </p>
        <p class="text-sm font-bold text-[#2c6e33] m-0">{{ byteProgress }}%{{ etaLabel }}</p>
      </div>
      <div class="h-2.5 w-full overflow-hidden rounded-full bg-[#eef2ee]">
        <div class="h-full rounded-full bg-[#2c6e33] transition-all duration-300 motion-reduce:transition-none" :style="{ width: `${byteProgress}%` }"></div>
      </div>
      <p v-if="speedLabel && busy && !state?.completing" class="text-xs text-[#8aa08c] m-0 flex items-center gap-1.5"><i class="fa-solid fa-gauge-high" aria-hidden="true"></i>Tốc độ: {{ speedLabel }}</p>
    </div>
    <p v-if="busy" role="status" class="text-sm text-[#667768] flex items-center gap-1.5"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>{{ state?.completing ? 'Đang hoàn tất lượt tải…' : 'Đang tải video…' }}</p>

    <!-- Lỗi -->
    <div v-if="lastError" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-800 border border-red-100">
      <p class="flex items-start gap-2 m-0"><i class="fa-solid fa-triangle-exclamation mt-0.5" aria-hidden="true"></i><span>{{ lastError }}</span></p>
      <button type="button" :disabled="busy || picking" class="mt-2 font-semibold underline disabled:opacity-50" @click="retry">Thử lại</button>
    </div>

    <!-- Thành công -->
    <p v-if="state?.phase === 'done'" role="status" class="rounded-lg bg-green-50 p-3 text-sm text-green-800 border border-green-100 flex items-center gap-2 m-0">
      <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
      {{ props.replaceItemId ? 'Đã thay tệp. Video đang được chuyển mã lại.' : 'Tải lên thành công. Đang mở trang chỉnh sửa video.' }}
    </p>

    <!-- Hành động -->
    <div class="flex flex-wrap gap-3 pt-1">
      <button v-if="!busy" type="button" :disabled="picking || !controller || (!state?.fileName && !state?.descriptor)" class="inline-flex items-center gap-2 rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-semibold text-white hover:bg-[#245b2a] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" @click="retry">
        <i class="fa-solid fa-play" aria-hidden="true"></i>{{ state?.descriptor ? 'Tiếp tục tải lên' : 'Bắt đầu tải lên' }}
      </button>
      <button v-if="busy" type="button" class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] px-4 py-2 text-sm font-semibold text-[#2c3e2e] bg-white hover:bg-[#f8faf8] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2 transition-colors" @click="pause">
        <i class="fa-solid fa-pause" aria-hidden="true"></i>Tạm dừng
      </button>
      <button v-if="state?.descriptor && !busy" type="button" class="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-800 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors" @click="discard">
        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>Bỏ phiên cũ
      </button>
      <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-[#e2ece3] px-4 py-2 text-sm text-[#2c3e2e] bg-white hover:bg-[#f8faf8] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2 transition-colors" @click="close">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>{{ props.replaceItemId ? 'Hủy thay tệp' : 'Quay lại thư viện' }}
      </button>
    </div>
  </section>
</template>
