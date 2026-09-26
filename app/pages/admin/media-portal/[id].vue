<script setup lang="ts">
import type { AdminMediaItem, AdminMediaConfig } from '~/types/admin-api'
import { mediaProcessingMessage } from '../../../composables/mediaProcessingMessage'
import { errorMessage } from '~/utils/errorMessage'
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
const replacing = ref(false)
const confirmReprocess = ref(false)
// Nút "Chuyển mã" mở khu vực chọn bản — tách khỏi "Xử lý lại video" (xoá rendition
// + transcode toàn bộ theo selectRenditions) vì cán bộ có thể chỉ cần bổ sung
// một bản 1080p mà không xoá các bản đã có. `transcodeRenditions` là tập tên bản
// cán bộ tick; `transcoding` là trạng thái gửi yêu cầu.
const transcodeOpen = ref(false)
const transcodeRenditions = ref<Set<string>>(new Set())
const transcoding = ref(false)
const toast = useToast()
const { openPicker } = useImagePicker()
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let stopped = false
const mediaId = computed(() => Number(route.params.id))
const isPending = computed(() => item.value?.processingStatus === 'pending' || item.value?.processingStatus === 'processing')
const isUpload = computed(() => item.value?.source === 'upload')
const progressLabel = computed(() => item.value?.processingStatus === 'ready' ? 'Video đã sẵn sàng.' : item.value?.processingStatus === 'processing' ? 'Đang xử lý video. Có thể tiếp tục chỉnh sửa thông tin.' : item.value?.processingStatus === 'failed' ? mediaProcessingMessage(item.value.processingError) : 'Video đang chờ xử lý.')
// Huy hiệu lưu trữ: 'R2' / 'Cục bộ' / null (chưa transcode, passthrough mới hoàn
// tất). `storageProvider` null không đọc thành 'Cục bộ' — cán bộ cần thấy sự khác
// biệt giữa "đã đẩy R2" và "chưa xác định" để chẩn đoán đúng.
const storageLabel = computed<{ text: string, tone: 'r2' | 'local' | 'unknown' } | null>(() => {
  if (!item.value) return null
  if (item.value.storageProvider === 'r2') return { text: 'R2', tone: 'r2' }
  if (item.value.storageProvider === 'local') return { text: 'Cục bộ', tone: 'local' }
  return { text: 'Chưa xác định', tone: 'unknown' }
})
// Danh sách ba bản cố định, khớp `RENDITIONS` ở video-processing.ts. UI hardcode
// vì không import server; đổi server thì đổi cả hai (tiền lệ MediaProcessingTimeline).
const ALL_RENDITIONS = ['360p', '720p', '1080p'] as const
// Bản dự kiến theo chiều cao nguồn — mặc định tick khi mở khu vực chuyển mã. Video
// 480p → chỉ 360p (không nâng cấp); video ≥1080p → cả ba bản.
function defaultRenditions(): Set<string> {
  const h = item.value?.height
  if (!h || h <= 0) return new Set(ALL_RENDITIONS)
  return new Set(ALL_RENDITIONS.filter(name => Number(name.replace('p', '')) <= h))
}

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
    const response = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ item: AdminMediaItem }>)(`/api/admin/media-portal/${mediaId.value}`, { signal })
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
      ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ item: AdminMediaItem }>)(`/api/admin/media-portal/${mediaId.value}`, { signal }),
      ($fetch as (u: string, o?: Record<string, unknown>) => Promise<AdminMediaConfig>)(`/api/admin/media-portal/config`, { signal }),
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
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/media-portal/${mediaId.value}`, { method: 'PUT', body: fields, retry: 0 })
    toast.success('Đã lưu thay đổi.')
    await refreshProcessing()
  } catch (error) { actionError.value = errorMessage(error, 'Không lưu được thay đổi. Vui lòng thử lại.') }
  finally { saving.value = false }
}
async function reprocess() {
  if (!canUpdate.value || processing.value) return
  // Khi đang `ready`, xoá rendition + transcode lại từ đầu — needs confirm.
  if (item.value?.processingStatus === 'ready' && !confirmReprocess.value) {
    confirmReprocess.value = true
    return
  }
  processing.value = true
  actionError.value = ''
  confirmReprocess.value = false
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/media-portal/${mediaId.value}/process`, { method: 'POST', retry: 0 })
    if (item.value) {
      item.value.processingStatus = 'pending'
      item.value.processingError = null
      item.value.resolutionsReady = []
    }
    schedulePoll()
    toast.success('Đã yêu cầu xử lý lại video.')
  } catch (err: unknown) {
    const msg = (err as { statusMessage?: string }).statusMessage
    actionError.value = msg || 'Không gửi được yêu cầu xử lý lại. Vui lòng thử lại.'
  }
  finally { processing.value = false }
}
function cancelReprocess() { confirmReprocess.value = false }
// Mở khu vực "Chuyển mã" — tick mặc định theo chiều cao nguồn (selectRenditions).
function openTranscode() {
  if (!canUpdate.value || transcoding.value) return
  transcodeRenditions.value = defaultRenditions()
  transcodeOpen.value = true
}
function cancelTranscode() { transcodeOpen.value = false }
function toggleRendition(name: string) {
  const next = new Set(transcodeRenditions.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  transcodeRenditions.value = next
}
// Gửi yêu cầu chuyển mã với các bản đã tick. Khác `reprocess` (xoá + transcode
// toàn bộ theo selectRenditions): ở đây gửi `renditions` body để pipeline chỉ
// transcode đúng các bản đã chọn, giữ nguyên các bản đã có.
async function submitTranscode() {
  if (!canUpdate.value || transcoding.value) return
  const picked = Array.from(transcodeRenditions.value)
  if (picked.length === 0) { actionError.value = 'Cần chọn ít nhất một bản nén chất lượng.'; return }
  transcoding.value = true
  actionError.value = ''
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/media-portal/${mediaId.value}/process`, { method: 'POST', body: { renditions: picked }, retry: 0 })
    if (item.value) {
      item.value.processingStatus = 'pending'
      item.value.processingError = null
    }
    transcodeOpen.value = false
    schedulePoll()
    toast.success(`Đã yêu cầu nén chất lượng: ${picked.join(', ')}.`)
  } catch (err: unknown) {
    const msg = (err as { statusMessage?: string }).statusMessage
    actionError.value = msg || 'Không gửi được yêu cầu nén chất lượng. Vui lòng thử lại.'
  }
  finally { transcoding.value = false }
}
function onReplaced() {
  replacing.value = false
  toast.success('Đã thay tệp. Video đang được nén chất lượng lại.')
  void refreshProcessing()
}
// ─── Thumbnail custom ──────────────────────────────────────────────────────
// Cán bộ chọn ảnh từ Thư viện Media → máy chủ copy bytes vào `thumb.jpg` cấp
// gốc. Preview dùng `thumbnailUrl` (admin serialize) hoặc endpoint thumb công
// khai (fallback tự sinh). `thumbSaving` chặn double-submit; `confirmClearThumb`
// cho nút "Dùng ảnh mặc định" (xoá custom → lùi về thumb tự sinh).
const thumbSaving = ref(false)
const confirmClearThumb = ref(false)
const thumbPreviewSrc = computed(() => {
  if (!item.value) return ''
  // Ảnh custom lưu URL ảnh thư viện; vắng → dùng endpoint thumb công khai
  // (serve thumb tự sinh qua resolveThumbnailTarget). Thêm cache-buster khi
  // vừa đổi để trình duyệt không dùng cache ảnh cũ.
  return item.value.thumbnailUrl || `/api/public/media/${encodeURIComponent(item.value.shortId)}/thumb`
})
function pickThumbnail() {
  if (!canUpdate.value || thumbSaving.value) return
  openPicker({
    onSelect: (img) => {
      void setThumbnail(img.id)
    },
  })
}
async function setThumbnail(imageMediaId: number) {
  if (!canUpdate.value || thumbSaving.value) return
  thumbSaving.value = true
  actionError.value = ''
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/media-portal/${mediaId.value}/thumbnail`, {
      method: 'POST', body: { mediaId: imageMediaId }, retry: 0,
    })
    toast.success('Đã đổi ảnh thumbnail.')
    await refreshProcessing()
  } catch (error) {
    actionError.value = errorMessage(error, 'Không đổi được thumbnail. Vui lòng thử lại.')
  } finally {
    thumbSaving.value = false
  }
}
async function clearThumbnail() {
  if (!canUpdate.value || thumbSaving.value) return
  if (!confirmClearThumb.value) {
    confirmClearThumb.value = true
    return
  }
  thumbSaving.value = true
  confirmClearThumb.value = false
  actionError.value = ''
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/media-portal/${mediaId.value}/thumbnail`, { method: 'DELETE', retry: 0 })
    toast.success('Đã đặt lại thumbnail mặc định.')
    await refreshProcessing()
  } catch (error) {
    actionError.value = errorMessage(error, 'Không xoá được thumbnail. Vui lòng thử lại.')
  } finally {
    thumbSaving.value = false
  }
}
function cancelClearThumb() { confirmClearThumb.value = false }
watch(() => route.params.id, () => { controller?.abort(); replacing.value = false; confirmReprocess.value = false; transcodeOpen.value = false; void load() })
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
        <div class="flex items-center justify-between gap-3 mb-3">
          <div class="flex items-center gap-2">
            <h2 class="font-bold text-[#122815]">Tiến trình xử lý</h2>
            <!-- Huy hiệu lưu trữ: nơi video đang nằm (R2 / Cục bộ / chưa xác định).
                 Cán bộ cần biết để chẩn đoán một mục đã xuất bản mà không xem được. -->
            <span
              v-if="storageLabel"
              class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="{
                'bg-blue-50 text-blue-700': storageLabel.tone === 'r2',
                'bg-[#e8f0e8] text-[#2c6e33]': storageLabel.tone === 'local',
                'bg-gray-100 text-gray-500': storageLabel.tone === 'unknown',
              }"
              :title="storageLabel.tone === 'r2' ? 'Video đã được đẩy lên Cloudflare R2' : storageLabel.tone === 'local' ? 'Video nằm trên đĩa máy chủ' : 'Chưa xác định tầng lưu trữ'"
            >
              <i :class="storageLabel.tone === 'r2' ? 'fa-solid fa-cloud' : 'fa-solid fa-hard-drive'" class="text-[0.6rem]" aria-hidden="true"></i>
              {{ storageLabel.text }}
            </span>
          </div>
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
            :class="{
              'bg-[#e8f0e8] text-[#2c6e33]': item.processingStatus === 'ready',
              'bg-amber-100 text-amber-700': isPending,
              'bg-red-100 text-red-700': item.processingStatus === 'failed',
              'bg-gray-100 text-gray-600': item.processingStatus === 'pending' && !isPending,
            }"
          >
            <span v-if="isPending" class="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse motion-reduce:animate-none"></span>
            {{ progressLabel }}
          </span>
        </div>
        <AdminMediaProcessingTimeline :item="item" />
        <p v-if="progressError" role="alert" class="mt-3 text-sm text-red-800">{{ progressError }} <button class="underline font-semibold" @click="refreshProcessing()">Thử lại</button></p>
        <!-- Confirm re-transcode từ ready -->
        <div v-if="confirmReprocess" class="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm">
          <p class="text-amber-900 font-medium">Video đã sẵn sàng. Xử lý lại sẽ xoá bản hiện tại và nén chất lượng từ đầu.</p>
          <div class="mt-2 flex gap-2">
            <button :disabled="processing" class="rounded-lg bg-[#2c6e33] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" @click="reprocess()">{{ processing ? 'Đang gửi…' : 'Xác nhận xử lý lại' }}</button>
            <button class="rounded-lg border border-[#e2ece3] px-3 py-1.5 text-sm" @click="cancelReprocess">Hủy</button>
          </div>
        </div>
        <!-- Hành động: thay tệp / xử lý lại / chuyển mã -->
        <div v-if="isUpload && canUpdate && !replacing" class="mt-3 flex flex-wrap gap-2">
          <button
            v-if="item.processingStatus !== 'processing'"
            :disabled="processing"
            class="rounded-lg border border-[#2c6e33] px-3 py-1.5 text-sm font-semibold text-[#2c6e33] hover:bg-[#e8f0e8] disabled:opacity-50"
            @click="reprocess()"
          >
            <i class="fa-solid fa-rotate-right mr-1" aria-hidden="true"></i>{{ processing ? 'Đang gửi…' : 'Xử lý lại video' }}
          </button>
          <!-- Nút "Nén chất lượng" — mở khu vực chọn bản (360p/720p/1080p) thay
               vì xoá + transcode toàn bộ. Chỉ hiện khi video upload; đang xử lý thì chặn. -->
          <button
            v-if="!transcodeOpen"
            :disabled="transcoding || isPending"
            class="rounded-lg border border-[#2c6e33] px-3 py-1.5 text-sm font-semibold text-[#2c6e33] hover:bg-[#e8f0e8] disabled:opacity-50"
            @click="openTranscode()"
          >
            <i class="fa-solid fa-film mr-1" aria-hidden="true"></i>Nén chất lượng
          </button>
          <button
            :disabled="processing || isPending"
            class="rounded-lg border border-[#e2ece3] px-3 py-1.5 text-sm font-semibold text-[#4a5e4d] hover:bg-[#f5f8f5] disabled:opacity-50"
            @click="replacing = true"
          >
            <i class="fa-solid fa-arrows-rotate mr-1" aria-hidden="true"></i>Thay tệp video
          </button>
        </div>
        <!-- Khu vực chọn bản nén chất lượng (360p/720p/1080p) -->
        <div v-if="transcodeOpen && isUpload && canUpdate" class="mt-3 rounded-lg bg-[#f5f8f5] border border-[#e2ece3] p-3 text-sm">
          <p class="font-medium text-[#122815] mb-2">Chọn các bản cần nén chất lượng:</p>
          <div class="flex flex-wrap gap-2 mb-3">
            <button
              v-for="name in ALL_RENDITIONS"
              :key="name"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors"
              :class="transcodeRenditions.has(name)
                ? 'bg-[#2c6e33] text-white'
                : 'bg-white text-[#4a5e4d] border border-[#e2ece3] hover:bg-[#e8f0e8]'"
              :aria-pressed="transcodeRenditions.has(name)"
              @click="toggleRendition(name)"
            >
              <i v-if="transcodeRenditions.has(name)" class="fa-solid fa-check text-[0.6rem]" aria-hidden="true"></i>
              {{ name }}
            </button>
          </div>
          <p class="text-xs text-[#667768] mb-3">Mặc định chọn các bản phù hợp chiều cao video. Bản không tick sẽ không bị xoá nếu đã có sẵn.</p>
          <div class="flex gap-2">
            <button
              :disabled="transcoding || transcodeRenditions.size === 0"
              class="rounded-lg bg-[#2c6e33] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              @click="submitTranscode()"
            >{{ transcoding ? 'Đang gửi…' : 'Bắt đầu nén chất lượng' }}</button>
            <button class="rounded-lg border border-[#e2ece3] px-3 py-1.5 text-sm" @click="cancelTranscode">Hủy</button>
          </div>
        </div>
        <!-- Khu vực thumbnail: chọn ảnh từ Thư viện Media hoặc về mặc định (tự sinh) -->
        <div v-if="isUpload && canUpdate" class="mt-3 rounded-lg bg-[#f8faf7] border border-[#e2ece3] p-3">
          <p class="font-medium text-[#122815] mb-2">Ảnh thumbnail</p>
          <div class="flex items-start gap-4">
            <div class="relative w-40 aspect-video rounded-lg overflow-hidden bg-black/5 shrink-0 border border-[#e2ece3]">
              <img
                v-if="thumbPreviewSrc"
                :src="thumbPreviewSrc"
                :alt="item.title"
                loading="lazy"
                class="absolute inset-0 w-full h-full object-cover"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs text-[#667768] mb-3 leading-relaxed">
                Mặc định tự trích khung hình ở giây thứ 2. Đổi ảnh thumbnail để chọn khung khác từ Thư viện Media.
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  :disabled="thumbSaving"
                  class="rounded-lg bg-[#2c6e33] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#245b2a] disabled:opacity-50"
                  @click="pickThumbnail"
                >
                  <i class="fa-solid fa-image mr-1" aria-hidden="true"></i>{{ thumbSaving ? 'Đang xử lý…' : 'Đổi thumbnail' }}
                </button>
                <button
                  v-if="item.thumbnailUrl && !confirmClearThumb"
                  type="button"
                  :disabled="thumbSaving"
                  class="rounded-lg border border-[#e2ece3] px-3 py-1.5 text-sm font-semibold text-[#4a5e4d] hover:bg-[#e8f0e8] disabled:opacity-50"
                  @click="clearThumbnail"
                >
                  <i class="fa-solid fa-rotate-left mr-1" aria-hidden="true"></i>Dùng ảnh mặc định
                </button>
              </div>
              <!-- Confirm xoá custom → lùi về thumb tự sinh -->
              <div v-if="confirmClearThumb" class="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm">
                <p class="text-amber-900 font-medium">Đặt lại về ảnh thumbnail tự sinh?</p>
                <div class="mt-2 flex gap-2">
                  <button :disabled="thumbSaving" class="rounded-lg bg-[#2c6e33] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" @click="clearThumbnail">{{ thumbSaving ? 'Đang xoá…' : 'Xác nhận' }}</button>
                  <button class="rounded-lg border border-[#e2ece3] px-3 py-1.5 text-sm" @click="cancelClearThumb">Hủy</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <NuxtLink v-if="item.status === 'published'" :to="`/media/${item.shortId}`" class="mt-3 inline-block text-sm text-[#2c6e33] underline">Xem trang công khai</NuxtLink>
      </div>
      <!-- Mode thay tệp: uploader inline -->
      <div v-if="replacing && isUpload && canUpdate && config" class="rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-6">
        <AdminChunkedUploader
          :open="true"
          :max-upload-size="config.maxUploadSize"
          :replace-item-id="mediaId"
          @uploaded="onReplaced"
          @close="replacing = false"
        />
      </div>
      <div class="rounded-xl border border-[#e2ece3] bg-white p-4 sm:p-6">
        <p v-if="!canUpdate" class="mb-4 text-sm text-[#667768]">Bạn có quyền xem. Cần quyền sửa video để lưu thay đổi.</p>
        <p v-if="actionError" role="alert" class="mb-4 text-red-800">{{ actionError }}</p>
        <AdminMediaPortalForm :key="formVersion" :item="item" :categories="config.categories" :saving="saving" :disabled="!canUpdate" @submit="save" />
      </div>
    </div>
  </div>
</template>
