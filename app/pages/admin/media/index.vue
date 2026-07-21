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
  if (!confirm(`Bạn có chắc muốn xóa file ${item.originalName}?`)) return
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
  <div class="media-page">
    <div class="page-header">
      <div>
        <h1>Thư viện Media & Tải lên</h1>
        <p>Quản lý toàn bộ hình ảnh, tài liệu và video được tải lên website</p>
      </div>
    </div>

    <!-- Upload Zone — drag & drop hoặc click -->
    <label
      class="upload-zone"
      :class="{ 'drag-over': isDragOver, 'is-uploading': uploading }"
      @dragover.prevent="isDragOver = true"
      @dragleave="isDragOver = false"
      @drop.prevent="onDrop"
    >
      <input type="file" accept="image/*,application/pdf" multiple class="sr-only" :disabled="uploading" @change="onFileInput" />
      <i class="fa-regular text-4xl" :class="uploading ? 'fa-spinner animate-spin text-green-700' : 'fa-cloud-arrow-up text-green-700'"></i>
      <strong class="mt-3 text-base text-gray-800">{{ uploading ? 'Đang tải lên...' : 'Kéo thả file vào đây hoặc bấm để chọn' }}</strong>
      <span class="text-sm text-gray-500 mt-1">Hỗ trợ JPEG, PNG, WebP, GIF, PDF — tối đa 20MB mỗi file</span>
    </label>

    <!-- Filter Bar -->
    <div class="filter-card">
      <input type="text" v-model="search" placeholder="Tìm kiếm file..." @keyup.enter="fetchMedia(1)" />
      <select v-model="filterType" @change="fetchMedia(1)">
        <option value="">Tất cả định dạng</option>
        <option value="image">Chỉ Ảnh (Image)</option>
        <option value="video">Chỉ Video</option>
      </select>
      <button class="search-btn" @click="fetchMedia(1)">
        <i class="fa-regular fa-magnifying-glass"></i> Tìm kiếm
      </button>
    </div>

    <!-- Media Grid -->
    <div v-if="loading" class="loading-state">Đang tải danh sách media...</div>

    <div v-else-if="mediaItems.length === 0" class="empty-state">
      <i class="fa-regular fa-images text-5xl text-gray-300"></i>
      <p>Chưa có file nào. Hãy tải lên file đầu tiên!</p>
    </div>

    <div v-else class="media-grid">
      <div v-for="m in mediaItems" :key="m.id" class="media-card">
        <div class="media-preview">
          <img v-if="m.mimeType?.startsWith('image/')" :src="m.url" :alt="m.originalName" loading="lazy" />
          <div v-else class="file-placeholder">
            <i class="fa-regular fa-file-lines text-3xl text-gray-400"></i>
          </div>
          <span class="provider-badge" :class="m.provider">{{ m.provider?.toUpperCase() }}</span>
        </div>
        <div class="media-info">
          <span class="media-title" :title="m.originalName">{{ m.originalName }}</span>
          <span class="media-size">{{ (m.sizeBytes / 1024).toFixed(1) }} KB</span>
          <div class="media-actions">
            <a :href="m.url" target="_blank" class="action-btn">
              <i class="fa-regular fa-link"></i> Link
            </a>
            <button class="action-btn delete" @click="deleteMedia(m)">
              <i class="fa-regular fa-trash"></i> Xóa
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div class="pagination" v-if="pagination.totalPages > 1">
      <button :disabled="pagination.page <= 1" @click="fetchMedia(pagination.page - 1)">
        <i class="fa-regular fa-chevron-left"></i> Trang trước
      </button>
      <span>Trang {{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button :disabled="pagination.page >= pagination.totalPages" @click="fetchMedia(pagination.page + 1)">
        Trang sau <i class="fa-regular fa-chevron-right"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.media-page { display: flex; flex-direction: column; gap: 20px; }

.page-header { display: flex; justify-content: space-between;
  align-items: center;
}

.page-header h1 {
  font-size: 1.3rem;
  font-weight: 800;
  margin: 0;
  color: #122815;
}

.page-header p {
  font-size: 0.85rem;
  color: #667768;
  margin: 4px 0 0 0;
}

.primary-btn {
  background: #1e4620;
  color: white;
  border: none;
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}

/* Upload zone */
.upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 2px dashed #c8d6c9;
  border-radius: 14px;
  padding: 36px 24px;
  background: #f8fbf8;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: center;
}
.upload-zone:hover, .upload-zone.drag-over {
  border-color: #2c6e33;
  background: #edf7ed;
}
.upload-zone.is-uploading { opacity: 0.7; cursor: not-allowed; pointer-events: none; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }

/* Empty state */
.empty-state {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 60px 0; color: #9ca3af;
}
.empty-state p { margin: 0; font-size: 0.9rem; }

.filter-card {
  background: white;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #e2ece3;
  display: flex;
  gap: 12px;
}

.filter-card input, .filter-card select {
  padding: 10px 14px;
  border: 1px solid #c8d6c9;
  border-radius: 8px;
}

.filter-card input {
  flex: 1;
}

.search-btn {
  background: #2c6e33;
  color: white;
  border: none;
  padding: 0 18px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}

.media-card {
  background: white;
  border: 1px solid #e2ece3;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.media-preview {
  height: 140px;
  background: #f8faf8;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-placeholder {
  font-size: 40px;
}

.provider-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 0.65rem;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
}

.provider-badge.r2 {
  background: #f38020;
}

.media-info {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.media-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: #122815;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.media-size {
  font-size: 0.72rem;
  color: #888;
}

.media-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.action-btn {
  flex: 1;
  text-align: center;
  font-size: 0.75rem;
  padding: 4px;
  border-radius: 6px;
  text-decoration: none;
  background: #f0f7f1;
  color: #2c6e33;
  border: none;
  cursor: pointer;
}

.action-btn.delete {
  background: #ffebe9;
  color: #d12420;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  margin-top: 10px;
}

.pagination button {
  background: white;
  border: 1px solid #c8d6c9;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
