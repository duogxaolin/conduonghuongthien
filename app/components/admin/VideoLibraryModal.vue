<!--
  Hộp chọn video của kho video (`media_items`) để chèn vào bài — cặp của `MediaLibraryModal` (thư viện ảnh).
  Một hộp duy nhất ở layout admin, mở bằng `useVideoPicker().openVideoPicker(callback)`.

  Chỉ liệt kê mục ĐÃ ĐĂNG (trang phát công khai chỉ trả mục đã đăng; nháp/lưu trữ là cùng một 404).
  Mục tải lên chưa xử lý xong hiện nhưng không chọn được, kèm lý do — ẩn đi thì cán bộ tưởng video mất.
  Cần quyền đọc `media_portal`; thiếu quyền thì lỗi do máy chủ soạn hiện ở khối `role="alert"`.

  Mỗi ô là `<button>` (dùng được bằng bàn phím); trạng thái tải / rỗng / lỗi riêng, lỗi có "Thử lại"
  gọi lại đúng lượt đã hỏng (openspec/ui-dna.md).
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import AdminModal from '~/components/admin/AdminModal.vue'
import { adminFetch } from '~/composables/adminFetch'
import { errorMessage } from '~/utils/errorMessage'
import { isDeliberateEnter } from '~/utils/admin-modal'
import { isEmbeddableVideo } from '~/utils/video-embed-html'
import { formatMediaDuration } from '~/utils/media-duration'
import type { AdminMediaItem, AdminMediaPage } from '~/types/admin-api'

const { isOpen, closeVideoPicker, selectVideo } = useVideoPicker()

const PER_PAGE = 12
const items = ref<AdminMediaItem[]>([])
const loading = ref(false)
const loadError = ref('')
const searchQuery = ref('')
const page = ref(1)
const totalPages = ref(1)
// The page the LAST request asked for: "Thử lại" repeats THAT request. `page` (what the pager shows) moves only
// once a page has arrived, so retrying `page` after a failed page 2 would load page 1 again.
let askedPage = 1

// Only the LATEST load writes (a search, then another, or a page click, before the first answer).
let listRequest = 0
const fetchVideos = async (pg = 1) => {
  askedPage = pg
  const ticket = ++listRequest
  loading.value = true
  loadError.value = ''
  try {
    const res = await adminFetch<AdminMediaPage>('/api/admin/media-portal', {
      query: { search: searchQuery.value, status: 'published', limit: PER_PAGE, page: pg, sort: 'updatedAt', order: 'desc' },
    })
    if (ticket !== listRequest) return
    items.value = res.items
    totalPages.value = Math.max(1, Math.ceil(res.total / PER_PAGE))
    page.value = pg
  } catch (err: unknown) {
    if (ticket !== listRequest) return
    loadError.value = errorMessage(err, 'Không tải được kho video.')
  } finally {
    if (ticket === listRequest) loading.value = false
  }
}

const onSearchEnter = (event: KeyboardEvent) => {
  if (!isDeliberateEnter(event)) return
  event.preventDefault()
  void fetchVideos(1)
}

/** Why an item cannot be chosen yet (it is listed, never hidden). Empty when it can. */
const blockedReason = (item: AdminMediaItem) =>
  isEmbeddableVideo(item) ? '' : item.processingStatus === 'failed' ? 'Xử lý lỗi' : 'Đang xử lý'

/** A disabled button never clicks in a browser; this keeps the rule in code that does not depend on that. */
const choose = (item: AdminMediaItem) => {
  if (blockedReason(item)) return
  selectVideo(item)
}

watch(isOpen, (open) => {
  if (open) {
    searchQuery.value = ''
    void fetchVideos(1)
  }
})
</script>

<template>
  <AdminModal :open="isOpen" title="Chèn video từ kho video" icon="fa-regular fa-film" size="2xl" @close="closeVideoPicker">
    <div class="relative pb-2">
      <i class="fa-regular fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft" aria-hidden="true"></i>
      <input
        v-model="searchQuery"
        type="text"
        aria-label="Tìm video theo tiêu đề"
        placeholder="Tìm theo tiêu đề... (Enter để tìm)"
        data-autofocus
        class="h-9 w-full rounded-lg border border-line px-3 pl-9 text-sm text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30"
        @keydown.enter="onSearchEnter"
      />
    </div>

    <div class="max-h-[60vh] overflow-y-auto py-2">
      <div v-if="loading" role="status" aria-busy="true" class="flex items-center justify-center py-12">
        <span class="sr-only">Đang tải kho video</span>
        <i class="fa-regular fa-spinner animate-spin text-4xl text-brand-600 motion-reduce:animate-none" aria-hidden="true"></i>
      </div>

      <div v-else-if="loadError" role="alert" class="py-12 text-center">
        <p class="m-0 text-sm text-danger">{{ loadError }}</p>
        <button
          type="button"
          class="mt-3 cursor-pointer rounded-lg border border-danger/40 bg-transparent px-4 py-2 text-sm font-bold text-danger hover:bg-danger-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          @click="fetchVideos(askedPage)"
        >
          Thử lại
        </button>
      </div>

      <div v-else-if="items.length === 0" class="py-12 text-center">
        <i class="fa-regular fa-film text-6xl text-line-strong" aria-hidden="true"></i>
        <p class="mt-4 text-sm text-ink-soft">{{ searchQuery ? 'Không có video đã đăng nào khớp.' : 'Chưa có video nào được đăng. Đăng video ở mục Kho video trước.' }}</p>
      </div>

      <ul v-else class="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 md:grid-cols-3">
        <li v-for="item in items" :key="item.id">
          <button
            type="button"
            class="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-lg border-2 border-line bg-white p-0 text-left transition hover:border-brand-600 focus-visible:border-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line"
            :disabled="!!blockedReason(item)"
            @click="choose(item)"
          >
            <span class="relative block aspect-video w-full bg-surface-tint">
              <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" alt="" class="h-full w-full object-cover" loading="lazy" />
              <i v-else class="fa-regular fa-film absolute inset-0 m-auto flex items-center justify-center text-3xl text-ink-soft" aria-hidden="true"></i>
              <span v-if="formatMediaDuration(item.durationSeconds)" class="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[0.7rem] font-bold text-white">{{ formatMediaDuration(item.durationSeconds) }}</span>
            </span>
            <span class="flex flex-1 flex-col gap-1 p-2.5">
              <span class="line-clamp-2 text-sm font-bold text-ink">{{ item.title }}</span>
              <span class="text-[0.72rem] font-semibold text-ink-soft">
                {{ item.source === 'youtube' ? 'YouTube' : 'Tải lên' }}<template v-if="blockedReason(item)"> · {{ blockedReason(item) }}</template>
              </span>
            </span>
          </button>
        </li>
      </ul>
    </div>

    <template v-if="totalPages > 1" #footer>
      <div class="mr-auto flex items-center gap-2">
        <button
          type="button"
          aria-label="Trang trước"
          :disabled="page <= 1"
          class="cursor-pointer rounded-lg border border-line bg-white px-3 py-2 text-sm transition hover:bg-surface-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          @click="fetchVideos(page - 1)"
        >
          <i class="fa-regular fa-chevron-left" aria-hidden="true"></i>
        </button>
        <span class="text-sm text-ink-soft">{{ page }} / {{ totalPages }}</span>
        <button
          type="button"
          aria-label="Trang sau"
          :disabled="page >= totalPages"
          class="cursor-pointer rounded-lg border border-line bg-white px-3 py-2 text-sm transition hover:bg-surface-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          @click="fetchVideos(page + 1)"
        >
          <i class="fa-regular fa-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
    </template>
  </AdminModal>
</template>
