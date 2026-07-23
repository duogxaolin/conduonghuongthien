<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const mediaItems = ref<any[]>([])
const loading = ref(true)
const search = ref('')
const filterType = ref('')
const pagination = ref({ page: 1, totalPages: 1, total: 0 })
const isDragOver = ref(false)

const toast = useToast()
const { confirm } = useConfirm()
const { uploading, uploadFile } = useUpload()

const fetchMedia = async (page = 1) => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/media', {
      params: { page, search: search.value, type: filterType.value, perPage: 24 }
    })
    if (res.ok) {
      mediaItems.value = res.items
      pagination.value = res.pagination
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải thư viện media')
  } finally {
    loading.value = false
  }
}

const handleUpload = async (files: FileList | File[]) => {
  const list = Array.from(files)
  let ok = 0
  for (const file of list) {
    const media = await uploadFile(file)
    if (media) ok++
  }
  if (ok > 0) {
    toast.success(`Đã tải lên ${ok} file thành công!`)
    await fetchMedia(1)
  }
}

const onFileInput = (e: Event) => {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) handleUpload(files)
  ;(e.target as HTMLInputElement).value = ''
}

const onDrop = (e: DragEvent) => {
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (files?.length) handleUpload(files)
}

const deleteMedia = async (item: any) => {
  const ok = await confirm({ title: 'Xóa tệp', message: `Bạn có chắc muốn xóa file ${item.originalName}?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  try {
    await $fetch(`/api/admin/media/${item.id}`, { method: 'DELETE' })
    toast.success('Đã xóa tệp media thành công!')
    await fetchMedia(pagination.value.page)
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi xóa file')
  }
}

onMounted(() => { fetchMedia() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Thư viện Media & Tải lên</h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Quản lý toàn bộ hình ảnh, tài liệu và video được tải lên website</p>
    </div>

    <!-- Upload Zone -->
    <label
      class="flex flex-col items-center justify-content-center gap-1.5 border-2 border-dashed border-[#c8d6c9] rounded-2xl py-9 px-6 bg-[#f8fbf8] cursor-pointer text-center transition-all duration-150"
      :class="{ 'border-[#2c6e33] bg-[#edf7ed]': isDragOver, 'opacity-70 cursor-not-allowed pointer-events-none': uploading }"
      @dragover.prevent="isDragOver = true"
      @dragleave="isDragOver = false"
      @drop.prevent="onDrop"
    >
      <input type="file" accept="image/*,application/pdf" multiple class="sr-only" :disabled="uploading" @change="onFileInput" />
      <i class="fa-regular text-4xl" :class="uploading ? 'fa-spinner animate-spin text-[#2c6e33]' : 'fa-cloud-arrow-up text-[#2c6e33]'"></i>
      <strong class="mt-2 text-base text-[#1a2e1c]">{{ uploading ? 'Đang tải lên...' : 'Kéo thả file vào đây hoặc bấm để chọn' }}</strong>
      <span class="text-sm text-[#667768]">Hỗ trợ JPEG, PNG, WebP, GIF, PDF — tối đa 20MB mỗi file</span>
    </label>

    <!-- Filter Bar -->
    <div class="bg-white rounded-xl border border-[#e2ece3] p-4 flex flex-col sm:flex-row gap-3">
      <input
        type="text"
        v-model="search"
        placeholder="Tìm kiếm file..."
        @keyup.enter="fetchMedia(1)"
        class="flex-1 px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
      />
      <select
        v-model="filterType"
        @change="fetchMedia(1)"
        class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
      >
        <option value="">Tất cả định dạng</option>
        <option value="image">Chỉ Ảnh (Image)</option>
        <option value="video">Chỉ Video</option>
      </select>
      <button
        class="inline-flex items-center gap-2 bg-[#2c6e33] hover:bg-[#1e4620] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 transition-colors"
        @click="fetchMedia(1)"
      >
        <i class="fa-regular fa-magnifying-glass"></i> Tìm kiếm
      </button>
    </div>

    <!-- Media Grid -->
    <div v-if="loading" class="py-16 text-center text-[#667768]">Đang tải danh sách media...</div>

    <div v-else-if="mediaItems.length === 0" class="flex flex-col items-center gap-3 py-16 text-[#9ca3af]">
      <i class="fa-regular fa-images text-5xl text-[#d1d5db]"></i>
      <p class="m-0 text-[0.9rem]">Chưa có file nào. Hãy tải lên file đầu tiên!</p>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
      <div v-for="m in mediaItems" :key="m.id" class="bg-white border border-[#e2ece3] rounded-xl overflow-hidden flex flex-col">
        <div class="h-[140px] bg-[#f8faf8] relative flex items-center justify-center">
          <img v-if="m.mimeType?.startsWith('image/')" :src="m.url" :alt="m.originalName" loading="lazy" class="w-full h-full object-cover" />
          <div v-else class="flex items-center justify-center">
            <i class="fa-regular fa-file-lines text-4xl text-[#9ca3af]"></i>
          </div>
          <span
            class="absolute top-2 right-2 text-[0.65rem] font-bold px-1.5 py-0.5 rounded text-white"
            :class="m.provider === 'r2' ? 'bg-orange-500' : 'bg-black/60'"
          >{{ m.provider?.toUpperCase() }}</span>
        </div>
        <div class="p-3 flex flex-col gap-1 flex-1">
          <span class="text-[0.82rem] font-bold text-[#122815] truncate" :title="m.originalName">{{ m.originalName }}</span>
          <span class="text-[0.72rem] text-[#9ca3af]">{{ (m.sizeBytes / 1024).toFixed(1) }} KB</span>
          <div class="flex gap-2 mt-1">
            <a
              :href="m.url"
              target="_blank"
              class="flex-1 text-center text-[0.75rem] py-1 rounded-md bg-[#f0f7f1] text-[#2c6e33] no-underline hover:bg-[#e4f2e5] transition-colors font-medium"
            ><i class="fa-regular fa-link"></i> Link</a>
            <button
              class="flex-1 text-[0.75rem] py-1 rounded-md bg-[#ffebe9] text-[#d12420] border-0 cursor-pointer hover:bg-red-200 transition-colors font-medium"
              @click="deleteMedia(m)"
            ><i class="fa-regular fa-trash"></i> Xóa</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="pagination.totalPages > 1" class="flex justify-center items-center gap-4 mt-2">
      <button
        :disabled="pagination.page <= 1"
        @click="fetchMedia(pagination.page - 1)"
        class="inline-flex items-center gap-2 bg-white border border-[#c8d6c9] px-4 py-2 rounded-lg cursor-pointer text-sm font-medium hover:bg-[#f0f7f1] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      ><i class="fa-regular fa-chevron-left"></i> Trang trước</button>
      <span class="text-sm text-[#667768] font-medium">Trang {{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button
        :disabled="pagination.page >= pagination.totalPages"
        @click="fetchMedia(pagination.page + 1)"
        class="inline-flex items-center gap-2 bg-white border border-[#c8d6c9] px-4 py-2 rounded-lg cursor-pointer text-sm font-medium hover:bg-[#f0f7f1] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >Trang sau <i class="fa-regular fa-chevron-right"></i></button>
    </div>
  </div>
</template>
