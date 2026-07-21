<script setup lang="ts">
const props = defineProps<{
  show: boolean
  multiple?: boolean
}>()

const emit = defineEmits(['close', 'select', 'select-multiple'])

const mediaItems = ref<any[]>([])
const loading = ref(false)
const uploading = ref(false)
const searchQuery = ref('')
const selectedMedia = ref<any>(null)
const selectedMultiple = ref<any[]>([])
const page = ref(1)
const totalPages = ref(1)

const toast = useToast()

const fetchMedia = async (pg = 1) => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/media', {
      params: { search: searchQuery.value, perPage: 20, page: pg }
    }) as any
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
  const target = event.target as HTMLInputElement
  if (!target.files?.length) return
  const file = target.files[0]
  const formData = new FormData()
  formData.append('file', file)
  uploading.value = true
  try {
    const res = await $fetch('/api/admin/media/upload', { method: 'POST', body: formData }) as any
    if (res.ok && res.media) {
      toast.success('Tải ảnh lên thành công!')
      await fetchMedia(1)
      if (props.multiple) selectedMultiple.value = [res.media]
      else selectedMedia.value = res.media
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Tải ảnh lên thất bại')
  } finally {
    uploading.value = false
    target.value = ''
  }
}

const isSelected = (id: number) =>
  props.multiple
    ? selectedMultiple.value.some(i => i.id === id)
    : selectedMedia.value?.id === id

const selectImage = (item: any) => {
  if (props.multiple) {
    const idx = selectedMultiple.value.findIndex(i => i.id === item.id)
    if (idx > -1) selectedMultiple.value.splice(idx, 1)
    else selectedMultiple.value.push(item)
  } else {
    // single — emit ngay và đóng (giống forum)
    emit('select', item)
    close()
  }
}

const confirmSelection = () => {
  if (props.multiple && selectedMultiple.value.length > 0) {
    emit('select-multiple', selectedMultiple.value)
    close()
  }
}

const close = () => {
  selectedMedia.value = null
  selectedMultiple.value = []
  emit('close')
}

watch(() => props.show, (val) => {
  if (val) {
    selectedMedia.value = null
    selectedMultiple.value = []
    fetchMedia(1)
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="mlm-backdrop"
      @click.self="close"
      @keydown.escape="close"
      role="dialog"
      aria-modal="true"
    >
      <!-- Animate wrapper -->
      <div class="mlm-wrapper">
        <div class="mlm-card">

          <!-- Header — giống forum: border-bottom, title + badge + close -->
          <div class="mlm-header">
            <h3 class="mlm-title">
              <i class="fa-regular fa-images"></i>
              Thư viện ảnh
              <span v-if="multiple && selectedMultiple.length > 0" class="mlm-badge">
                {{ selectedMultiple.length }} đã chọn
              </span>
            </h3>
            <button class="mlm-close" @click="close" aria-label="Đóng">
              <i class="fa-regular fa-xmark"></i>
            </button>
          </div>

          <!-- Body: max-height + scroll, giống forum max-h-[60vh] -->
          <div class="mlm-body">

            <!-- Search bar -->
            <div class="mlm-search-row">
              <div class="mlm-search-wrap">
                <i class="fa-regular fa-magnifying-glass mlm-search-icon"></i>
                <input
                  v-model="searchQuery"
                  type="text"
                  class="mlm-search-input"
                  placeholder="Tìm theo tên file..."
                  @keyup.enter="fetchMedia(1)"
                />
              </div>
              <label class="mlm-upload-btn" :class="{ disabled: uploading }">
                <i class="fa-regular fa-cloud-arrow-up"></i>
                <span>{{ uploading ? 'Đang tải...' : 'Tải lên' }}</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  class="sr-only"
                  :disabled="uploading"
                  @change="handleFileUpload"
                />
              </label>
            </div>

            <!-- Loading -->
            <div v-if="loading" class="mlm-state">
              <i class="fa-regular fa-spinner mlm-spin"></i>
            </div>

            <!-- Empty -->
            <div v-else-if="mediaItems.length === 0" class="mlm-state">
              <i class="fa-regular fa-images mlm-state-icon"></i>
              <p>Chưa có ảnh nào. Hãy tải ảnh lên!</p>
            </div>

            <!-- Grid — giống forum: grid-cols-4, h-32, rounded-lg, border-2, ring on select -->
            <div v-else class="mlm-grid">
              <div
                v-for="item in mediaItems"
                :key="item.id"
                class="mlm-item"
                :class="{ 'mlm-item--selected': isSelected(item.id) }"
                @click="selectImage(item)"
              >
                <img :src="item.url" :alt="item.originalName" loading="lazy" class="mlm-item-img" />
                <!-- Overlay check — giống forum: opacity-0 → opacity-100 -->
                <div class="mlm-item-overlay">
                  <i
                    class="fa-regular fa-circle-check mlm-check-icon"
                    :class="{ 'mlm-check-icon--visible': isSelected(item.id) }"
                  ></i>
                </div>
                <!-- Bottom gradient + filename — giống forum -->
                <div class="mlm-item-name">{{ item.originalName }}</div>
              </div>
            </div>
          </div>

          <!-- Footer — giống forum: border-top, page/totalPages, nút confirm cho multiple -->
          <div class="mlm-footer" v-if="totalPages > 1 || multiple">
            <div class="mlm-pagination" v-if="totalPages > 1">
              <button
                :disabled="page <= 1"
                @click="fetchMedia(page - 1)"
                class="mlm-page-btn"
              ><i class="fa-regular fa-chevron-left"></i></button>
              <span class="mlm-page-text">{{ page }} / {{ totalPages }}</span>
              <button
                :disabled="page >= totalPages"
                @click="fetchMedia(page + 1)"
                class="mlm-page-btn"
              ><i class="fa-regular fa-chevron-right"></i></button>
            </div>
            <div v-else></div>

            <button
              v-if="multiple"
              class="mlm-confirm-btn"
              :disabled="selectedMultiple.length === 0"
              @click="confirmSelection"
            >
              <i class="fa-regular fa-check"></i>
              Thêm {{ selectedMultiple.length || '' }} ảnh
            </button>
          </div>

        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Backdrop — giống forum: bg-gray-900/60 backdrop-blur-sm */
.mlm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(17, 24, 39, 0.6);
  backdrop-filter: blur(4px);
  overflow-y: auto;
}

/* Centering wrapper — giống forum: flex min-h-screen items-center justify-center p-4 */
.mlm-wrapper {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

/* Card — giống forum: max-w-4xl rounded-2xl bg-white p-6 shadow-xl */
.mlm-card {
  position: relative;
  width: 100%;
  max-width: 896px;
  background: #fff;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.05);
}

/* Header — giống forum: flex items-center justify-between border-b pb-4 */
.mlm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 16px;
  margin-bottom: 0;
}

.mlm-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1rem;
  font-weight: 600;
  color: #111827;
  margin: 0;
}

.mlm-title i {
  color: #2c6e33;
}

/* Badge — giống forum: rounded-full bg-brand-700 px-2 py-0.5 text-xs text-white */
.mlm-badge {
  margin-left: 8px;
  background: #1e4620;
  color: #fff;
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
}

/* Close btn — giống forum: rounded-lg p-1 text-gray-400 hover:bg-gray-100 */
.mlm-close {
  background: none;
  border: none;
  padding: 6px;
  border-radius: 8px;
  color: #9ca3af;
  font-size: 1.2rem;
  cursor: pointer;
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}
.mlm-close:hover {
  background: #f3f4f6;
  color: #4b5563;
}

/* Body — giống forum: max-h-[60vh] overflow-y-auto py-4 */
.mlm-body {
  max-height: 60vh;
  overflow-y: auto;
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Search row */
.mlm-search-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.mlm-search-wrap {
  flex: 1;
  position: relative;
}

.mlm-search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  font-size: 0.8rem;
  pointer-events: none;
}

.mlm-search-input {
  width: 100%;
  height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 12px 0 32px;
  font-size: 0.85rem;
  color: #111827;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}
.mlm-search-input:focus {
  border-color: #2c6e33;
  box-shadow: 0 0 0 3px rgba(44, 110, 51, 0.1);
}

/* Upload button — inline label giống forum upload button style -->
.mlm-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  background: #1e4620;
  color: #fff;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
  flex-shrink: 0;
}
.mlm-upload-btn:hover { background: #2c6e33; }
.mlm-upload-btn.disabled { opacity: 0.6; cursor: not-allowed; pointer-events: none; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }

/* States */
.mlm-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 0;
  color: #9ca3af;
  font-size: 0.9rem;
}
.mlm-state-icon { font-size: 3.5rem; }
.mlm-state p { margin: 0; }

/* Spinner */
.mlm-spin {
  font-size: 2.5rem;
  color: #2c6e33;
  animation: mlm-spin 0.8s linear infinite;
}
@keyframes mlm-spin { to { transform: rotate(360deg); } }

/* Grid — giống forum: grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 */
.mlm-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
@media (max-width: 640px) { .mlm-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 641px) and (max-width: 768px) { .mlm-grid { grid-template-columns: repeat(3, 1fr); } }

/* Item — giống forum: group relative cursor-pointer overflow-hidden rounded-lg border-2 transition */
.mlm-item {
  position: relative;
  cursor: pointer;
  overflow: hidden;
  border-radius: 8px;
  border: 2px solid transparent;
  transition: border-color 0.15s;
}
.mlm-item:hover {
  border-color: #2c6e33;
}
/* Selected — giống forum: border-brand-500 ring-2 ring-brand-500/30 */
.mlm-item--selected {
  border-color: #2c6e33;
  box-shadow: 0 0 0 2px rgba(44, 110, 51, 0.3);
}

/* Image — giống forum: h-32 w-full object-cover transition group-hover:scale-105 */
.mlm-item-img {
  width: 100%;
  height: 128px;
  object-fit: cover;
  display: block;
  transition: transform 0.2s;
}
.mlm-item:hover .mlm-item-img { transform: scale(1.05); }

/* Overlay — giống forum: absolute inset-0 flex items-center justify-center */
.mlm-item-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: background 0.15s;
}
.mlm-item:hover .mlm-item-overlay { background: rgba(0,0,0,0.4); }
.mlm-item--selected .mlm-item-overlay { background: rgba(0,0,0,0.4); }

/* Check icon — giống forum: fa-circle-check opacity-0 group-hover:opacity-100 text-3xl text-white */
.mlm-check-icon {
  font-size: 1.875rem;
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s;
}
.mlm-item:hover .mlm-check-icon { opacity: 1; }
.mlm-check-icon--visible { opacity: 1 !important; }

/* Item name — giống forum: absolute bottom-0 bg-gradient-to-t from-black/60 text-xs text-white truncate */
.mlm-item-name {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 6px 8px;
  font-size: 0.7rem;
  color: #fff;
  background: linear-gradient(to top, rgba(0,0,0,0.65), transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Footer — giống forum: flex items-center justify-between border-t pt-4 */
.mlm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #e5e7eb;
  padding-top: 16px;
  margin-top: 0;
}

/* Pagination — giống forum: flex gap-2 */
.mlm-pagination {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mlm-page-text {
  font-size: 0.85rem;
  color: #6b7280;
}

/* Page btn — giống forum: rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled */
.mlm-page-btn {
  border: 1px solid #e5e7eb;
  background: #fff;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s;
  color: #374151;
}
.mlm-page-btn:hover:not(:disabled) { background: #f9fafb; }
.mlm-page-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Confirm btn — giống forum: rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white */
.mlm-confirm-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #1e4620;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.mlm-confirm-btn:hover:not(:disabled) { background: #2c6e33; }
.mlm-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
