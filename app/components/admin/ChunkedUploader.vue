<script setup lang="ts">
import { useMediaUploadSession } from '../../composables/useMediaUploadSession'

const props = defineProps<{ open: boolean, maxUploadSize: number }>()
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
    <h2 id="chunked-uploader-title" class="font-bold text-[#122815]">Chọn tệp video</h2>
    <p class="text-sm text-[#667768]">Dung lượng tối đa {{ maxSizeLabel }} GB. Nếu tải lại trang, chọn lại đúng tệp để tiếp tục các phần còn thiếu.</p>
    <p v-if="state?.storageWarning" role="status" class="rounded-lg bg-amber-50 p-3 text-sm">{{ state.storageWarning }}</p>
    <p v-if="state?.descriptor" class="text-sm text-[#4a5e4d]">Lượt tải đang dở: <strong class="break-words">{{ state.descriptor.filename }}</strong></p>
    <div>
      <label for="chunked-file" class="block mb-1 text-sm font-semibold text-[#122815]">{{ state?.descriptor ? 'Chọn lại tệp ban đầu' : 'Tệp video' }}</label>
      <input id="chunked-file" ref="fileInput" type="file" accept="video/*" :disabled="busy || picking" class="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-[#2c6e33] file:px-4 file:py-2 file:text-white focus:outline-none focus:ring-2 focus:ring-[#2c6e33]" @change="pickFile" />
      <p v-if="picking" role="status" class="mt-1 text-sm text-[#667768]">Đang kiểm tra tệp…</p>
    </div>
    <div v-if="state?.total" class="space-y-2">
      <p class="text-sm text-[#667768]" aria-live="polite">{{ state.received }} / {{ state.total }} phần đã nhận</p>
      <progress :value="state.received" :max="state.total" aria-label="Tiến độ tải video" class="h-3 w-full accent-[#2c6e33]">{{ progress }}%</progress>
    </div>
    <p v-if="busy" role="status" class="text-sm text-[#667768]">{{ state?.completing ? 'Đang hoàn tất lượt tải…' : 'Đang tải video…' }}</p>
    <div v-if="lastError" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-800">
      <p>{{ lastError }}</p>
      <button type="button" :disabled="busy || picking" class="mt-2 font-semibold underline disabled:opacity-50" @click="retry">Thử lại</button>
    </div>
    <p v-if="state?.phase === 'done'" role="status" class="rounded-lg bg-green-50 p-3 text-sm text-green-800">Tải lên thành công. Đang mở trang chỉnh sửa video.</p>
    <div class="flex flex-wrap gap-3">
      <button v-if="!busy" type="button" :disabled="picking || !controller || (!state?.fileName && !state?.descriptor)" class="rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-semibold text-white hover:bg-[#245b2a] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] focus:ring-offset-2 disabled:opacity-50" @click="retry">{{ state?.descriptor ? 'Tiếp tục tải lên' : 'Bắt đầu tải lên' }}</button>
      <button v-if="busy" type="button" class="rounded-lg border border-[#e2ece3] px-4 py-2 text-sm font-semibold focus:ring-2 focus:ring-[#2c6e33]" @click="pause">Tạm dừng</button>
      <button v-if="state?.descriptor && !busy" type="button" class="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-800 focus:ring-2 focus:ring-red-500" @click="discard">Bỏ phiên cũ và chọn tệp khác</button>
      <button type="button" class="rounded-lg border border-[#e2ece3] px-4 py-2 text-sm focus:ring-2 focus:ring-[#2c6e33]" @click="close">Quay lại thư viện</button>
    </div>
  </section>
</template>
