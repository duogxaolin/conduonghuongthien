<script setup lang="ts">
import type { MediaItem } from '~/types/media'

// Driven entirely by the global useImagePicker composable
const { isOpen, isMultiple, closePicker, handleSelect, handleSelectMultiple } = useImagePicker()
const { uploading, uploadFile } = useUpload()
const toast = useToast()

const mediaItems = ref<MediaItem[]>([])
const loading = ref(false)
const searchQuery = ref('')
const selectedMultiple = ref<MediaItem[]>([])
const page = ref(1)
const totalPages = ref(1)

const fetchMedia = async (pg = 1) => {
  loading.value = true
  try {
    const res = await $fetch<{ ok: boolean; items: MediaItem[]; totalPages: number }>('/api/admin/media', {
      params: { search: searchQuery.value, perPage: 20, page: pg }
    })
    if (res.ok) {
      mediaItems.value = res.items
      totalPages.value = res.totalPages || 1
      page.value = pg
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải thư viện media')
  } finally {
    loading.value = false
  }
}

const handleFileUpload = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const media = await uploadFile(file)
  if (media) {
    toast.success('Tải ảnh lên thành công!')
    await fetchMedia(1)
  }
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
              :class="uploading ? 'opacity-60 pointer-events-none' : ''"
            >
              <i class="fa-regular" :class="uploading ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i>
              {{ uploading ? 'Đang tải...' : 'Tải lên' }}
              <input type="file" accept="image/*,application/pdf" class="sr-only" :disabled="uploading" @change="handleFileUpload" />
            </label>
          </div>

          <!-- Body -->
          <div class="max-h-[60vh] overflow-y-auto py-2">

            <!-- Loading -->
            <div v-if="loading" class="flex items-center justify-center py-12">
              <i class="fa-regular fa-spinner animate-spin text-4xl text-green-700"></i>
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
