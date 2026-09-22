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
  <section v-if="open" aria-labelledby="chunked-uploader-title" class="rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-6 space-y-5">
    <h2 id="chunked-uploader-title" class="font-bold text-[#122815]">{{ props.replaceItemId ? 'Thay tệp video' : 'Chọn tệp video' }}</h2>
    <p class="text-sm text-[#667768]">
      {{ props.replaceItemId
        ? 'Tệp mới sẽ thay tệp gốc, giữ tiêu đề và bình luận. Video sẽ được chuyển mã lại từ đầu. '
        : '' }}
      Dung lượng tối đa {{ maxSizeLabel }} GB. Nếu tải lại trang, chọn lại đúng tệp để tiếp tục các phần còn thiếu.
    </p>
    <p v-if="state?.storageWarning" role="status" class="rounded-lg bg-amber-50 p-3 text-sm">{{ state.storageWarning }}</p>
    <p v-if="state?.descriptor" class="text-sm text-[#4a5e4d]">Lượt tải đang dở: <strong class="break-words">{{ state.descriptor.filename }}</strong></p>
    <div>
      <label for="chunked-file" class="block mb-1 text-sm font-semibold text-[#122815]">{{ state?.descriptor ? 'Chọn lại tệp ban đầu' : 'Tệp video' }}</label>
      <input id="chunked-file" ref="fileInput" type="file" accept="video/*" :disabled="busy || picking" class="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-[#2c6e33] file:px-4 file:py-2 file:text-white focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @change="pickFile" />
      <p v-if="picking" role="status" class="mt-1 text-sm text-[#667768]">Đang kiểm tra tệp…</p>
    </div>
    <div v-if="state?.total" class="space-y-2">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <p class="text-sm text-[#667768] m-0" aria-live="polite">
          {{ state.received }} / {{ state.total }} phần đã nhận
        </p>
        <p class="text-sm font-bold text-[#2c6e33] m-0">{{ byteProgress }}%{{ etaLabel }}</p>
      </div>
      <progress :value="state.uploadedBytes" :max="state.totalBytes" aria-label="Tiến độ tải video" class="h-3 w-full accent-[#2c6e33]">{{ byteProgress }}%</progress>
      <p v-if="speedLabel && busy && !state?.completing" class="text-xs text-[#8aa08c] m-0">Tốc độ: {{ speedLabel }}</p>
    </div>
    <p v-if="busy" role="status" class="text-sm text-[#667768]">{{ state?.completing ? 'Đang hoàn tất lượt tải…' : 'Đang tải video…' }}</p>
    <div v-if="lastError" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-800">
      <p>{{ lastError }}</p>
      <button type="button" :disabled="busy || picking" class="mt-2 font-semibold underline disabled:opacity-50" @click="retry">Thử lại</button>
    </div>
    <p v-if="state?.phase === 'done'" role="status" class="rounded-lg bg-green-50 p-3 text-sm text-green-800">
      {{ props.replaceItemId ? 'Đã thay tệp. Video đang được chuyển mã lại.' : 'Tải lên thành công. Đang mở trang chỉnh sửa video.' }}
    </p>
    <div class="flex flex-wrap gap-3">
      <button v-if="!busy" type="button" :disabled="picking || !controller || (!state?.fileName && !state?.descriptor)" class="rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-semibold text-white hover:bg-[#245b2a] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2 disabled:opacity-50" @click="retry">{{ state?.descriptor ? 'Tiếp tục tải lên' : 'Bắt đầu tải lên' }}</button>
      <button v-if="busy" type="button" class="rounded-lg border border-[#e2ece3] px-4 py-2 text-sm font-semibold focus:ring-2 focus:ring-[#2c6e33]" @click="pause">Tạm dừng</button>
      <button v-if="state?.descriptor && !busy" type="button" class="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-800 focus:ring-2 focus:ring-red-500" @click="discard">Bỏ phiên cũ và chọn tệp khác</button>
      <button type="button" class="rounded-lg border border-[#e2ece3] px-4 py-2 text-sm focus:ring-2 focus:ring-[#2c6e33]" @click="close">{{ props.replaceItemId ? 'Hủy thay tệp' : 'Quay lại thư viện' }}</button>
    </div>
  </section>
</template>
