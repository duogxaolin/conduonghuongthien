<script setup lang="ts">
const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits(['close', 'select'])

const activeTab = ref<'browse' | 'upload'>('browse')
const mediaItems = ref<any[]>([])
const loading = ref(false)
const uploading = ref(false)
const searchQuery = ref('')
const selectedMedia = ref<any>(null)

const fetchMedia = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/media', {
      params: { search: searchQuery.value, perPage: 40 }
    })
    if (res.ok) {
      mediaItems.value = res.items
    }
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Lỗi tải thư viện media')
  } finally {
    loading.value = false
  }
}

const handleFileUpload = async (event: Event) => {
  const target = event.target as HTMLInputElement
  if (!target.files || target.files.length === 0) return

  const file = target.files[0]
  const formData = new FormData()
  formData.append('file', file)

  uploading.value = true
  try {
    const res = await $fetch('/api/admin/media/upload', {
      method: 'POST',
      body: formData,
    })
    if (res.ok && res.media) {
      activeTab.value = 'browse'
      await fetchMedia()
      selectedMedia.value = res.media
    }
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Tải ảnh lên thất bại')
  } finally {
    uploading.value = false
  }
}

const confirmSelection = () => {
  if (selectedMedia.value) {
    emit('select', selectedMedia.value)
    emit('close')
  }
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    fetchMedia()
  }
})
</script>

<template>
  <div v-if="show" class="media-modal-overlay" @click.self="emit('close')">
    <div class="media-modal-card">
      <div class="modal-header">
        <h3>🖼️ Thư viện Media & Tải ảnh</h3>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <div class="modal-tabs">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'browse' }"
          @click="activeTab = 'browse'"
        >
          📂 Chọn từ Thư viện
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'upload' }"
          @click="activeTab = 'upload'"
        >
          📤 Tải ảnh/video Mới
        </button>
      </div>

      <!-- Tab Browse -->
      <div v-if="activeTab === 'browse'" class="tab-content">
        <div class="search-bar">
          <input
            type="text"
            v-model="searchQuery"
            placeholder="Tìm theo tên file..."
            @keyup.enter="fetchMedia"
          />
          <button class="search-btn" @click="fetchMedia">Tìm kiếm</button>
        </div>

        <div v-if="loading" class="loading-state">Đang tải thư viện ảnh...</div>

        <div v-else class="media-grid">
          <div
            v-for="item in mediaItems"
            :key="item.id"
            class="media-item"
            :class="{ selected: selectedMedia?.id === item.id }"
            @click="selectedMedia = item"
          >
            <img :src="item.url" :alt="item.originalName" />
            <span class="media-name">{{ item.originalName }}</span>
          </div>
        </div>

        <div class="modal-footer">
          <span v-if="selectedMedia" class="selected-info">
            Đã chọn: <strong>{{ selectedMedia.originalName }}</strong>
          </span>
          <div class="footer-actions">
            <button class="cancel-btn" @click="emit('close')">Hủy</button>
            <button
              class="primary-btn"
              :disabled="!selectedMedia"
              @click="confirmSelection"
            >
              Chèn File Đã Chọn
            </button>
          </div>
        </div>
      </div>

      <!-- Tab Upload -->
      <div v-if="activeTab === 'upload'" class="tab-content upload-tab">
        <div class="upload-dropzone">
          <div class="upload-icon">☁️</div>
          <h4>Kéo thả file vào đây hoặc bấm nút chọn</h4>
          <p>Hỗ trợ JPEG, PNG, WebP, GIF, MP4 (Tối đa 20MB)</p>
          <input
            type="file"
            accept="image/*,video/*,application/pdf"
            @change="handleFileUpload"
            :disabled="uploading"
          />
        </div>
        <div v-if="uploading" class="uploading-state">Đang tải và tối ưu file...</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.media-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.media-modal-card {
  background: white;
  width: 90%;
  max-width: 840px;
  height: 600px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
}

.modal-header {
  padding: 16px 24px;
  background: #122815;
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.close-btn {
  background: none;
  border: none;
  color: white;
  font-size: 1.2rem;
  cursor: pointer;
}

.modal-tabs {
  display: flex;
  background: #f0f7f1;
  border-bottom: 1px solid #e2ece3;
}

.tab-btn {
  padding: 12px 24px;
  border: none;
  background: none;
  font-weight: 700;
  color: #667768;
  cursor: pointer;
}

.tab-btn.active {
  background: white;
  color: #2c6e33;
  border-bottom: 3px solid #2c6e33;
}

.tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px;
  overflow: hidden;
}

.search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.search-bar input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #c8d6c9;
  border-radius: 8px;
}

.search-btn {
  background: #2c6e33;
  color: white;
  border: none;
  padding: 0 16px;
  border-radius: 8px;
  cursor: pointer;
}

.media-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
  overflow-y: auto;
  padding-right: 6px;
}

.media-item {
  border: 2px solid #e2ece3;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  height: 120px;
  display: flex;
  flex-direction: column;
  position: relative;
}

.media-item img {
  width: 100%;
  height: 90px;
  object-fit: cover;
}

.media-name {
  font-size: 0.7rem;
  padding: 4px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: #f8faf8;
}

.media-item.selected {
  border-color: #2c6e33;
  box-shadow: 0 0 0 3px rgba(44, 110, 51, 0.3);
}

.modal-footer {
  padding-top: 16px;
  border-top: 1px solid #eef2ee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-actions {
  display: flex;
  gap: 12px;
  margin-left: auto;
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

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cancel-btn {
  background: #f0f0f0;
  border: none;
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
}

.upload-dropzone {
  border: 2px dashed #2c6e33;
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  background: #f0f7f1;
  position: relative;
  margin: auto 0;
}

.upload-dropzone input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.upload-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
</style>
