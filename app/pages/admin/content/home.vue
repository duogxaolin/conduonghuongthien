<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const sections = ref<any[]>([])
const loading = ref(true)
const saving = ref(false)
const selectedSection = ref<any>(null)
const editConfig = ref<any>({})

const sectionLabels: Record<string, { name: string; icon: string }> = {
  hero:          { name: 'Hero Banner Đầu trang', icon: '🌄' },
  stats:         { name: 'Khối Thống kê Con số', icon: '📊' },
  news:          { name: 'Tin tức & Bản tin Nổi bật', icon: '📰' },
  role_models:   { name: 'Tấm Gương Tiêu Biểu', icon: '🏆' },
  reintegration: { name: 'Mô Hình Tái Hòa Nhập', icon: '🏭' },
  documents:     { name: 'Văn bản Pháp luật Mới', icon: '📄' },
  support_form:  { name: 'Form Đăng Ký Tư Vấn', icon: '📝' },
  links:         { name: 'Liên Kết Hữu Ích', icon: '🔗' },
}

const fetchSections = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/home-sections')
    if (res.ok) {
      sections.value = res.sections
    }
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Lỗi tải danh sách sections')
  } finally {
    loading.value = false
  }
}

const toggleVisibility = async (sec: any) => {
  try {
    const res = await $fetch(`/api/admin/home-sections/${sec.id}/toggle`, { method: 'PATCH' })
    if (res.ok) {
      sec.isVisible = res.isVisible
    }
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Lỗi đổi trạng thái hiển thị')
  }
}

const openEditModal = (sec: any) => {
  selectedSection.value = sec
  editConfig.value = JSON.parse(JSON.stringify(sec.config || {}))
}

const saveSectionConfig = async () => {
  if (!selectedSection.value) return
  saving.value = true
  try {
    const res = await $fetch(`/api/admin/home-sections/${selectedSection.value.id}`, {
      method: 'PUT',
      body: { config: editConfig.value }
    })
    if (res.ok) {
      selectedSection.value.config = JSON.parse(JSON.stringify(editConfig.value))
      selectedSection.value = null
      alert('Đã cập nhật cấu hình Section!')
    }
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Lỗi lưu cấu hình')
  } finally {
    saving.value = false
  }
}

const moveSection = async (index: number, direction: 'up' | 'down') => {
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= sections.value.length) return

  // Swap
  const temp = sections.value[index]
  sections.value[index] = sections.value[targetIndex]
  sections.value[targetIndex] = temp

  // Update displayOrder
  const ordersPayload = sections.value.map((sec, idx) => ({
    id: sec.id,
    displayOrder: idx + 1
  }))

  try {
    await $fetch('/api/admin/home-sections/reorder', {
      method: 'PUT',
      body: { orders: ordersPayload }
    })
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Lỗi lưu thứ tự mới')
  }
}

onMounted(() => {
  fetchSections()
})
</script>

<template>
  <div class="home-editor-page">
    <div class="page-header">
      <div>
        <h1>Quản lý & Kéo-thả Custom Trang chủ</h1>
        <p>Thay đổi thứ tự hiển thị các khối (Section), bật/tắt hiển thị và chỉnh sửa chữ trực tiếp</p>
      </div>
    </div>

    <div v-if="loading" class="loading-state">Đang tải danh sách Section...</div>

    <div v-else class="sections-list">
      <div
        v-for="(sec, idx) in sections"
        :key="sec.id"
        class="section-card"
        :class="{ hidden: !sec.isVisible }"
      >
        <div class="card-left">
          <div class="drag-handle">⠿</div>
          <div class="sec-icon">{{ sectionLabels[sec.type]?.icon || '📦' }}</div>
          <div class="sec-details">
            <span class="sec-title">{{ sectionLabels[sec.type]?.name || sec.type }}</span>
            <span class="sec-desc" v-if="sec.config?.title">
              Tiêu đề: "{{ sec.config.title }}"
            </span>
          </div>
        </div>

        <div class="card-right">
          <button
            class="action-btn order-btn"
            :disabled="idx === 0"
            @click="moveSection(idx, 'up')"
            title="Di chuyển lên"
          >
            ⬆️
          </button>
          <button
            class="action-btn order-btn"
            :disabled="idx === sections.length - 1"
            @click="moveSection(idx, 'down')"
            title="Di chuyển xuống"
          >
            ⬇️
          </button>

          <button
            class="action-btn eye-btn"
            :class="{ active: sec.isVisible }"
            @click="toggleVisibility(sec)"
          >
            {{ sec.isVisible ? '👁️ Hiển thị' : '🚫 Đã ẩn' }}
          </button>

          <button class="primary-btn edit-btn" @click="openEditModal(sec)">
            ✏️ Sửa nội dung & Text
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Section Config Drawer/Modal -->
    <div v-if="selectedSection" class="modal-overlay" @click.self="selectedSection = null">
      <div class="modal-card">
        <h3>✏️ Chỉnh sửa Section: {{ sectionLabels[selectedSection.type]?.name }}</h3>
        <p class="modal-subtitle">Tùy biến tiêu đề, mô tả và nội dung cấu hình</p>

        <div class="modal-form">
          <div class="form-group" v-if="editConfig.title !== undefined">
            <label>Tiêu đề Section (*)</label>
            <input type="text" v-model="editConfig.title" />
          </div>

          <div class="form-group" v-if="editConfig.subtitle !== undefined">
            <label>Mô tả phụ (Subtitle)</label>
            <input type="text" v-model="editConfig.subtitle" />
          </div>

          <div class="form-group" v-if="editConfig.maxItems !== undefined">
            <label>Số lượng bài hiển thị trên trang chủ</label>
            <input type="number" min="1" max="12" v-model="editConfig.maxItems" />
          </div>

          <div class="form-group" v-if="editConfig.bgImage !== undefined">
            <label>Ảnh nền (URL)</label>
            <input type="text" v-model="editConfig.bgImage" />
          </div>

          <div class="modal-actions">
            <button class="cancel-btn" @click="selectedSection = null">Hủy</button>
            <button class="primary-btn" :disabled="saving" @click="saveSectionConfig">
              <span v-if="saving">Đang lưu...</span>
              <span v-else>💾 Lưu Thay Đổi</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-editor-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
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

.sections-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-card {
  background: white;
  border: 1px solid #e2ece3;
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: all 0.2s;
}

.section-card.hidden {
  opacity: 0.6;
  background: #f8faf8;
}

.card-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.drag-handle {
  font-size: 20px;
  color: #aaa;
  cursor: grab;
}

.sec-icon {
  font-size: 28px;
}

.sec-details {
  display: flex;
  flex-direction: column;
}

.sec-title {
  font-size: 1rem;
  font-weight: 800;
  color: #122815;
}

.sec-desc {
  font-size: 0.8rem;
  color: #667768;
}

.card-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-btn {
  border: 1px solid #c8d6c9;
  background: white;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.82rem;
}

.action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.eye-btn.active {
  background: #e4f2e5;
  color: #2c6e33;
  border-color: #8ed694;
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

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-card {
  background: white;
  padding: 28px;
  border-radius: 14px;
  width: 100%;
  max-width: 480px;
}

.modal-card h3 {
  margin: 0 0 4px 0;
  font-size: 1.1rem;
}

.modal-subtitle {
  font-size: 0.82rem;
  color: #667768;
  margin: 0 0 20px 0;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 0.82rem;
  font-weight: 700;
  margin-bottom: 6px;
}

.form-group input {
  width: 100%;
  padding: 10px;
  border: 1px solid #c8d6c9;
  border-radius: 6px;
  box-sizing: border-box;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.cancel-btn {
  background: #f0f0f0;
  border: none;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
}
</style>
