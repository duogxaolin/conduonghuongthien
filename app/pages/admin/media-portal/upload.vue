<script setup lang="ts">
import type { AdminMediaItem, AdminMediaConfig } from '~/types/admin-api'
import { mediaProcessingMessage } from '../../../composables/mediaProcessingMessage'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
const { hasPermission } = useAdminAuth()
const canUpload = computed(() => hasPermission('media_portal', 'create') && hasPermission('media_portal', 'read'))
const config = ref<AdminMediaConfig | null>(null)
const loading = ref(true)
const loadError = ref('')

// ─── Post-upload: timeline xử lý hiện ngay trên trang ─────────────────────────
// Trước đây upload xong redirect thẳng tới `/admin/media-portal/{id}`. Anh muốn
// thấy tiến trình xử lý (7 bước) ngay tại đây thay vì phải bấm vào trang chi tiết.
// Cùng pattern poll như `[id].vue`: fetch item mỗi 3 giây khi pending/processing.
const uploadedItem = ref<AdminMediaItem | null>(null)
const progressError = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let stopped = false

const isPending = computed(() => uploadedItem.value?.processingStatus === 'pending' || uploadedItem.value?.processingStatus === 'processing')
const progressLabel = computed(() => {
  const s = uploadedItem.value?.processingStatus
  if (s === 'ready') return 'Video đã sẵn sàng.'
  if (s === 'processing') return 'Đang xử lý video. Bạn có thể chỉnh sửa thông tin ở trang chi tiết.'
  if (s === 'failed') return mediaProcessingMessage(uploadedItem.value?.processingError)
  return 'Video đang chờ xử lý.'
})

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
  if (!uploadedItem.value) return
  try {
    const response = await $fetch(`/api/admin/media-portal/${uploadedItem.value.id}`, { signal })
    if (stopped || signal.aborted) return
    uploadedItem.value = response.item
    schedulePoll()
  } catch {
    if (!stopped && !signal.aborted) progressError.value = 'Không cập nhật được trạng thái xử lý.'
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try { if (canUpload.value) config.value = await $fetch('/api/admin/media-portal/config') }
  catch { loadError.value = 'Không kiểm tra được khả năng tải video của máy chủ.' }
  finally { loading.value = false }
}

/** ChunkedUploader báo xong → chuyển sang phase timeline thay vì redirect. */
function onUploaded(result: { mediaItemId: number }) {
  uploadedItem.value = { id: result.mediaItemId, processingStatus: 'pending', slug: '', title: '',
    createdAt: null, source: 'upload', thumbnailUrl: null, categoryName: null, categorySlug: null,
    durationSeconds: null, width: null, height: null, resolutionsReady: null, processingError: null } as AdminMediaItem
  void refreshProcessing()
}

function openDetail() { return navigateTo(`/admin/media-portal/${uploadedItem.value?.id}`) }
function uploadAnother() {
  uploadedItem.value = null
  progressError.value = ''
  clearTimeout(timer)
}
function close() { return navigateTo('/admin/media-portal') }

onMounted(load)
onBeforeUnmount(() => { stopped = true; clearTimeout(timer); controller?.abort() })
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <NuxtLink to="/admin/media-portal" class="text-sm text-[#2c6e33] underline">Quay lại thư viện video</NuxtLink>
    <h1 class="text-xl font-extrabold text-[#122815]">Tải video lên</h1>

    <!-- Phase 1: Kiểm tra khả năng tải + uploader -->
    <template v-if="!uploadedItem">
      <div v-if="loading" role="status" aria-busy="true"><span class="sr-only">Đang kiểm tra khả năng tải lên</span><SkeletonForm label="Đang kiểm tra khả năng tải lên" :fields="1" /></div>
      <div v-else-if="loadError" role="alert" class="rounded-lg bg-red-50 p-4 text-red-800">{{ loadError }} <button class="font-semibold underline" @click="load()">Thử lại</button></div>
      <p v-else-if="!canUpload" role="alert" class="rounded-lg bg-amber-50 p-4">Bạn cần quyền tạo và xem video để tải lên và theo dõi tiến độ.</p>
      <p v-else-if="!config?.uploadEnabled" role="status" class="rounded-lg bg-amber-50 p-4">Máy chủ hiện chưa bật tải video. Bạn vẫn có thể đăng video YouTube.</p>
      <AdminChunkedUploader v-else :open="true" :max-upload-size="config.maxUploadSize" @uploaded="onUploaded" @close="close" />
    </template>

    <!-- Phase 2: Timeline xử lý sau khi upload xong -->
    <template v-else>
      <div class="rounded-xl border border-[#e2ece3] bg-white p-5 space-y-4">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="text-lg font-extrabold text-[#122815] m-0">
            <i class="fa-solid fa-circle-check text-[#2c6e33] mr-1.5" aria-hidden="true"></i>
            Đã tải lên xong
          </h2>
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
            :class="{
              'bg-[#e8f0e8] text-[#2c6e33]': uploadedItem.processingStatus === 'ready',
              'bg-amber-100 text-amber-700': isPending,
              'bg-red-100 text-red-700': uploadedItem.processingStatus === 'failed',
              'bg-gray-100 text-gray-600': uploadedItem.processingStatus === 'pending' && !isPending,
            }"
          >
            <span v-if="isPending" class="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse motion-reduce:animate-none"></span>
            {{ progressLabel }}
          </span>
        </div>

        <AdminMediaProcessingTimeline :item="uploadedItem" />

        <p v-if="progressError" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-800">{{ progressError }} <button class="underline font-semibold" @click="refreshProcessing()">Thử lại</button></p>

        <!-- Hành động -->
        <div class="flex flex-wrap items-center gap-3 border-t border-[#eef2ee] pt-4">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-[#1e4620] px-4 py-2 text-sm font-bold text-white cursor-pointer border-0 hover:bg-[#2c6e33] transition-colors"
            @click="openDetail()"
          >
            <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
            Mở trang chỉnh sửa
          </button>
          <button
            v-if="uploadedItem.processingStatus === 'ready'"
            type="button"
            class="inline-flex items-center gap-2 rounded-lg border border-[#c8d6c9] px-4 py-2 text-sm font-semibold text-[#2c3e2e] cursor-pointer bg-white hover:bg-[#f8faf8] transition-colors"
            @click="uploadAnother()"
          >
            <i class="fa-solid fa-upload" aria-hidden="true"></i>
            Tải video khác
          </button>
        </div>

        <p class="text-xs text-[#8aa08c] m-0">
          <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
          Trạng thái cập nhật tự động. Bạn có thể rời trang — xử lý tiếp tục ở máy chủ.
        </p>
      </div>
    </template>
  </div>
</template>
