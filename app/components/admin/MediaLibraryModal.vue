<script setup lang="ts">
import type { MediaItem } from '~/types/media'

// Driven entirely by the global useImagePicker composable
const { isOpen, isMultiple, closePicker, handleSelect, handleSelectMultiple } = useImagePicker()
const { uploading, uploadBatch, tasks, uploadingBatch } = useUpload()
const toast = useToast()

const mediaItems = ref<MediaItem[]>([])
const loading = ref(false)
const loadError = ref('')
const searchQuery = ref('')
const selectedMultiple = ref<MediaItem[]>([])
const page = ref(1)
const totalPages = ref(1)

/**
 * A rejection has to land in persistent markup, not only in a toast.
 *
 * The toast is gone in four seconds; the empty branch below ("Chưa có ảnh nào.
 * Hãy tải ảnh lên!") stays on screen indefinitely. So a failed fetch used to read
 * as an empty library — and the invitation printed on it is to upload an image
 * that is already there. Same contract as the admin pages in
 * tests/admin-error-retry-ui.test.ts.
 */
const fetchMedia = async (pg = 1) => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await $fetch<{ ok: boolean; items: MediaItem[]; totalPages: number }>('/api/admin/media', {
      params: { search: searchQuery.value, perPage: 20, page: pg }
    })
    if (res.ok) {
      mediaItems.value = res.items
      totalPages.value = res.totalPages || 1
      page.value = pg
    }
  } catch (err: unknown) {
    loadError.value = errorMessage(err, 'Lỗi tải thư viện media')
    toast.error(loadError.value)
  } finally {
    loading.value = false
  }
}

// Aggregate progress over the live task list — mirrors the media library page.
const completedCount = computed(() => tasks.value.filter((t) => t.status === 'success' || t.status === 'error').length)
const totalCount = computed(() => tasks.value.length)
const batchPercent = computed(() => {
  if (!tasks.value.length) return 0
  return Math.round(tasks.value.reduce((sum, t) => sum + (t.status === 'success' ? 100 : t.progress), 0) / tasks.value.length)
})

const handleFileUpload = async (event: Event) => {
  const files = (event.target as HTMLInputElement).files
  if (!files?.length) return
  await uploadBatch(files, 4)
  if (tasks.value.some((t) => t.media)) await fetchMedia(1)
  // Clear the progress list once the batch is fully terminal so the grid can breathe.
  tasks.value = []
  ;(event.target as HTMLInputElement).value = ''
}

const isSelected = (id: number) => selectedMultiple.value.some(i => i.id === id)

const selectImage = (item: MediaItem) => {
  if (isMultiple.value) {
    const idx = selectedMultiple.value.findIndex(i => i.id === item.id)
    if (idx > -1) selectedMultiple.value.splice(idx, 1)
    else selectedMultiple.value.push(item)
  } else {
    handleSelect(item)
  }
}

const confirmMultiple = () => {
  if (selectedMultiple.value.length > 0) {
    handleSelectMultiple(selectedMultiple.value)
  }
}

const close = () => {
  selectedMultiple.value = []
  closePicker()
}

watch(isOpen, (val) => {
  if (val) {
    selectedMultiple.value = []
    fetchMedia(1)
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-[99999] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      @keydown.escape="close"
    >
      <!-- Backdrop -->
      <div
        class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm"
        @click="close"
      ></div>

      <!-- Modal -->
      <div class="flex min-h-screen items-center justify-center p-4">
        <div class="relative w-full max-w-4xl rounded-2xl bg-white p-6 shadow-xl" @click.stop>

          <!-- Header -->
          <div class="flex items-center justify-between border-b border-gray-200 pb-4">
            <h3 class="flex items-center gap-2 text-base font-semibold text-gray-900">
              <i class="fa-regular fa-images text-green-700"></i>
              Thư viện ảnh
              <span
                v-if="isMultiple && selectedMultiple.length > 0"
                class="ml-2 rounded-full bg-green-800 px-2 py-0.5 text-xs text-white"
              >{{ selectedMultiple.length }} đã chọn</span>
            </h3>
            <button
              class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
              @click="close"
            >
              <i class="fa-regular fa-xmark text-xl"></i>
            </button>
          </div>

          <!-- Search + Upload bar -->
          <div class="flex items-center gap-2 pt-4 pb-2">
            <div class="relative flex-1">
              <i class="fa-regular fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none"></i>
              <input
                v-model="searchQuery"
                type="text"
                placeholder="Tìm theo tên file..."
                class="w-full h-9 rounded-lg border border-gray-200 pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600/10"
                @keyup.enter="fetchMedia(1)"
              />
            </div>
            <label
              class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-green-800 px-4 text-sm font-semibold text-white transition hover:bg-green-700"
              :class="{ 'opacity-60 pointer-events-none': uploading }"
            >
              <i class="fa-regular" :class="uploading ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i>
              {{ uploading ? (tasks.length ? `Đang tải ${completedCount}/${totalCount}...` : 'Đang tải...') : 'Tải lên (nhiều)' }}
              <input type="file" accept="image/*,application/pdf" multiple class="sr-only" :disabled="uploading" @change="handleFileUpload" />
            </label>
          </div>

          <!-- Per-file upload progress — parallel uploads inside the picker modal. -->
          <div v-if="tasks.length" class="mb-2 flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3" role="status" :aria-busy="uploadingBatch">
            <div class="flex items-center justify-between gap-2">
              <strong class="m-0 text-xs text-gray-700">
                Đang tải {{ completedCount }}/{{ totalCount }} file{{ uploadingBatch ? '' : ' — xong' }}
              </strong>
              <span class="text-[0.7rem] text-gray-500">{{ batchPercent }}%</span>
            </div>
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div class="h-full rounded-full bg-green-700 transition-[width] duration-200 motion-reduce:transition-none" :style="{ width: batchPercent + '%' }"></div>
            </div>
            <ul class="m-0 flex max-h-32 flex-col gap-1.5 overflow-y-auto p-0 list-none">
              <li v-for="t in tasks" :key="t.id" class="flex items-center gap-2 text-[0.75rem]">
                <i
                  class="fa-regular w-4 text-center"
                  :class="{
                    'fa-spinner animate-spin text-green-700': t.status === 'pending' || t.status === 'uploading',
                    'fa-circle-check text-green-700': t.status === 'success',
                    'fa-circle-xmark text-red-500': t.status === 'error',
                  }"
                  :aria-hidden="true"
                ></i>
                <span class="flex-1 truncate text-gray-700" :title="t.file.name">{{ t.file.name }}</span>
                <span v-if="t.status === 'pending' || t.status === 'uploading'" class="w-9 text-right text-gray-500">{{ t.progress }}%</span>
                <span v-else-if="t.status === 'success'" class="w-9 text-right font-semibold text-green-700">OK</span>
                <span v-else-if="t.status === 'error'" class="w-9 text-right font-semibold text-red-500" :title="t.error">Lỗi</span>
              </li>
            </ul>
          </div>

          <!-- Body -->
          <div class="max-h-[60vh] overflow-y-auto py-2">

            <!-- Loading -->
            <div v-if="loading" class="flex items-center justify-center py-12">
              <i class="fa-regular fa-spinner animate-spin text-4xl text-green-700"></i>
            </div>

            <!-- Error — must come before the empty branch, or a failed fetch reads as "no images yet". -->
            <div v-else-if="loadError" role="alert" class="py-12 text-center">
              <i class="fa-solid fa-triangle-exclamation text-4xl text-red-400" aria-hidden="true"></i>
              <p class="mt-4 text-sm text-red-600">{{ loadError }}</p>
              <button
                type="button"
                class="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50"
                @click="fetchMedia(page)"
              >
                Thử lại
              </button>
            </div>

            <!-- Empty -->
            <div v-else-if="mediaItems.length === 0" class="py-12 text-center">
              <i class="fa-regular fa-images text-6xl text-gray-300"></i>
              <p class="mt-4 text-sm text-gray-500">Chưa có ảnh nào. Hãy tải ảnh lên!</p>
            </div>

            <!-- Grid — 4 cột, h-32, border + ring on select -->
            <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              <div
                v-for="item in mediaItems"
                :key="item.id"
                class="group relative cursor-pointer overflow-hidden rounded-lg border-2 transition"
                :class="isSelected(item.id)
                  ? 'border-green-600 ring-2 ring-green-600/30'
                  : 'border-transparent hover:border-green-600'"
                @click="selectImage(item)"
              >
                <img
                  :src="item.url"
                  :alt="item.originalName"
                  class="h-32 w-full object-cover transition group-hover:scale-105"
                  loading="lazy"
                />
                <!-- Overlay check -->
                <div
                  class="absolute inset-0 flex items-center justify-center transition"
                  :class="isSelected(item.id) ? 'bg-black/40' : 'bg-black/0 group-hover:bg-black/40'"
                >
                  <i
                    class="fa-regular fa-circle-check text-3xl text-white transition"
                    :class="isSelected(item.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                  ></i>
                </div>
                <!-- Filename -->
                <div class="absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-black/60 to-transparent p-2 text-xs text-white">
                  {{ item.originalName }}
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div
            v-if="totalPages > 1 || isMultiple"
            class="flex items-center justify-between border-t border-gray-200 pt-4"
          >
            <!-- Pagination -->
            <div class="flex items-center gap-2">
              <template v-if="totalPages > 1">
                <button
                  :disabled="page <= 1"
                  class="rounded-lg border border-gray-200 px-3 py-2 text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  @click="fetchMedia(page - 1)"
                >
                  <i class="fa-regular fa-chevron-left"></i>
                </button>
                <span class="text-sm text-gray-500">{{ page }} / {{ totalPages }}</span>
                <button
                  :disabled="page >= totalPages"
                  class="rounded-lg border border-gray-200 px-3 py-2 text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  @click="fetchMedia(page + 1)"
                >
                  <i class="fa-regular fa-chevron-right"></i>
                </button>
              </template>
            </div>

            <!-- Multi confirm -->
            <button
              v-if="isMultiple"
              :disabled="selectedMultiple.length === 0"
              class="rounded-lg bg-green-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              @click="confirmMultiple"
            >
              <i class="fa-regular fa-check mr-1"></i>
              Thêm {{ selectedMultiple.length || '' }} ảnh
            </button>
          </div>

        </div>
      </div>
    </div>
  </Teleport>
</template>
