<script setup lang="ts">
import type { AdminMediaItem, AdminMediaConfig } from '~/types/admin-api'
import { mediaProcessingMessage } from '../../../composables/mediaProcessingMessage'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
const route = useRoute()
const { hasPermission } = useAdminAuth()
const canRead = computed(() => hasPermission('media_portal', 'read'))
const canUpdate = computed(() => hasPermission('media_portal', 'update'))
const item = ref<AdminMediaItem | null>(null)
const config = ref<AdminMediaConfig | null>(null)
const loading = ref(true)
const loadError = ref('')
const actionError = ref('')
const progressError = ref('')
const saving = ref(false)
const processing = ref(false)
const formVersion = ref(0)
const toast = useToast()
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let stopped = false
const mediaId = computed(() => Number(route.params.id))
const isPending = computed(() => item.value?.processingStatus === 'pending' || item.value?.processingStatus === 'processing')
const progressLabel = computed(() => item.value?.processingStatus === 'ready' ? 'Video đã sẵn sàng.' : item.value?.processingStatus === 'processing' ? 'Đang xử lý video. Có thể tiếp tục chỉnh sửa thông tin.' : item.value?.processingStatus === 'failed' ? mediaProcessingMessage(item.value.processingError) : 'Video đang chờ xử lý.')

function schedulePoll() {
  clearTimeout(timer)
  if (!stopped && isPending.value) timer = setTimeout(refreshProcessing, 3000)
}
async function refreshProcessing() {
  clearTimeout(timer)
  progressError.value = ''
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  try {
    const response = await $fetch(`/api/admin/media-portal/${mediaId.value}`, { signal })
    if (stopped || signal.aborted) return
    item.value = response.item
    schedulePoll()
  } catch {
    if (!stopped && !signal.aborted) progressError.value = 'Không cập nhật được trạng thái xử lý.'
  }
}
async function load() {
  clearTimeout(timer)
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  loading.value = true
  loadError.value = ''
  try {
    if (!canRead.value) return
    if (!Number.isSafeInteger(mediaId.value) || mediaId.value < 1) throw new Error('invalid')
    const [response, options] = await Promise.all([
      $fetch(`/api/admin/media-portal/${mediaId.value}`, { signal }), $fetch('/api/admin/media-portal/config', { signal }),
    ])
    if (stopped || signal.aborted) return
    item.value = response.item
    config.value = options
    formVersion.value++
    schedulePoll()
  } catch { if (!stopped && !signal.aborted) loadError.value = 'Không tải được video. Video có thể đã bị xóa hoặc bạn không còn quyền truy cập.' }
  finally { if (!signal.aborted) loading.value = false }
}
async function save(fields: Record<string, unknown>) {
  if (!canUpdate.value || saving.value) return
  saving.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/admin/media-portal/${mediaId.value}`, { method: 'PUT', body: fields, retry: 0 })
    toast.success('Đã lưu thay đổi.')
    await refreshProcessing()
  } catch (error) { actionError.value = errorMessage(error, 'Không lưu được thay đổi. Vui lòng thử lại.') }
  finally { saving.value = false }
}
async function reprocess() {
  if (!canUpdate.value || processing.value) return
  processing.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/admin/media-portal/${mediaId.value}/process`, { method: 'POST', retry: 0 })
    if (item.value) item.value.processingStatus = 'pending'
    schedulePoll()
    toast.success('Đã yêu cầu xử lý lại video.')
  } catch { actionError.value = 'Không gửi được yêu cầu xử lý lại. Vui lòng thử lại.' }
  finally { processing.value = false }
}
watch(() => route.params.id, () => { controller?.abort(); void load() })
onMounted(load)
onBeforeUnmount(() => { stopped = true; clearTimeout(timer); controller?.abort() })
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <NuxtLink to="/admin/media-portal" class="text-sm text-[#2c6e33] underline">Quay lại thư viện video</NuxtLink>
    <h1 class="text-xl font-extrabold text-[#122815]">Chi tiết video</h1>
    <div v-if="loading" role="status" aria-busy="true"><span class="sr-only">Đang tải video</span><SkeletonForm label="Đang tải video" :fields="6" /></div>
    <div v-else-if="loadError" role="alert" class="rounded-lg bg-red-50 p-4 text-red-800">{{ loadError }} <button class="font-semibold underline" @click="load()">Thử lại</button></div>
    <p v-else-if="!canRead" role="alert" class="rounded-lg bg-amber-50 p-4">Bạn chưa được cấp quyền xem video.</p>
    <div v-else-if="item && config" class="space-y-5">
      <div class="rounded-xl border border-[#e2ece3] bg-white p-4">
        <p role="status" aria-live="polite" :aria-busy="isPending" class="text-sm text-[#4a5e4d]">{{ progressLabel }}</p>
        <p v-if="progressError" role="alert" class="mt-2 text-sm text-red-800">{{ progressError }} <button class="underline font-semibold" @click="refreshProcessing()">Thử lại</button></p>
        <button v-if="item.source === 'upload' && item.processingStatus === 'failed' && canUpdate" :disabled="processing" class="mt-3 rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" @click="reprocess()">{{ processing ? 'Đang gửi…' : 'Xử lý lại video' }}</button>
        <NuxtLink v-if="item.status === 'published'" :to="`/media/${item.slug}`" class="mt-3 inline-block text-sm text-[#2c6e33] underline">Xem trang công khai</NuxtLink>
      </div>
      <div class="rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-6">
        <p v-if="!canUpdate" class="mb-4 text-sm text-[#667768]">Bạn có quyền xem. Cần quyền sửa video để lưu thay đổi.</p>
        <p v-if="actionError" role="alert" class="mb-4 text-red-800">{{ actionError }}</p>
        <AdminMediaPortalForm :key="formVersion" :item="item" :categories="config.categories" :saving="saving" :disabled="!canUpdate" @submit="save" />
      </div>
    </div>
  </div>
</template>
