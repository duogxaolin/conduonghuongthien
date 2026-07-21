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
const activeTab = ref<'content' | 'style' | 'preview'>('content')

const showMediaModal = ref(false)

const sectionTypes: Record<string, { name: string; icon: string; desc: string }> = {
  hero:          { name: 'Hero Banner Đầu trang', icon: 'fa-solid fa-image', desc: 'Khối hình ảnh banner lớn kèm nút kêu gọi hành động (CTA)' },
  stats:         { name: 'Khối Thống kê Con số', icon: 'fa-solid fa-chart-line', desc: 'Hiển thị các chỉ số ấn tượng về công tác hỗ trợ tái hòa nhập' },
  news:          { name: 'Bản tin & Tin tức Nổi bật', icon: 'fa-solid fa-newspaper', desc: 'Danh sách bài viết tin tức hoạt động mới nhất' },
  role_models:   { name: 'Tấm Gương Tiêu Biểu', icon: 'fa-solid fa-star', desc: 'Các câu chuyện hoàn lương và mô hình lập nghiệp thành công' },
  reintegration: { name: 'Mô Hình Tái Hòa Nhập', icon: 'fa-solid fa-cubes', desc: 'Các mô hình kinh tế, đào tạo nghề nghiệp tiêu biểu' },
  documents:     { name: 'Văn bản Quy phạm Pháp luật', icon: 'fa-solid fa-file-contract', desc: 'Bảng tra cứu các văn bản, chỉ thị, chính sách hỗ trợ' },
  support_form:  { name: 'Form Đăng Ký Tư Vấn', icon: 'fa-solid fa-paper-plane', desc: 'Khối gửi yêu cầu hỗ trợ 24/7 của công dân' },
  links:         { name: 'Liên Kết Hữu Ích', icon: 'fa-solid fa-link', desc: 'Danh sách các cổng thông tin và trang web liên kết' },
}

const toast = useToast()

const fetchSections = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/home-sections')
    if (res.ok) {
      sections.value = res.sections
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải danh sách sections')
  } finally {
    loading.value = false
  }
}

const toggleVisibility = async (sec: any) => {
  try {
    const res = await $fetch(`/api/admin/home-sections/${sec.id}/toggle`, { method: 'PATCH' })
    if (res.ok) {
      sec.isVisible = res.isVisible
      toast.success(`Đã ${res.isVisible ? 'hiển thị' : 'ẩn'} Block "${sec.title}"!`)
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi đổi trạng thái hiển thị')
  }
}

const openEditModal = (sec: any) => {
  selectedSection.value = sec
  editConfig.value = JSON.parse(JSON.stringify(sec.config || {}))
  
  // Default values if missing
  if (editConfig.value.title === undefined) editConfig.value.title = sec.title || ''
  if (editConfig.value.subtitle === undefined) editConfig.value.subtitle = ''
  if (editConfig.value.description === undefined) editConfig.value.description = ''
  if (editConfig.value.maxItems === undefined) editConfig.value.maxItems = 6
  if (editConfig.value.bgVariant === undefined) editConfig.value.bgVariant = 'default'
  if (editConfig.value.layoutStyle === undefined) editConfig.value.layoutStyle = 'grid-3'
  if (editConfig.value.bgImage === undefined) editConfig.value.bgImage = ''
  if (editConfig.value.btnText === undefined) editConfig.value.btnText = 'Xem tất cả'
  if (editConfig.value.btnLink === undefined) editConfig.value.btnLink = ''

  activeTab.value = 'content'
}

const saveSectionConfig = async () => {
  if (!selectedSection.value) return
  saving.value = true
  try {
    const res = await $fetch(`/api/admin/home-sections/${selectedSection.value.id}`, {
      method: 'PUT',
      body: { 
        title: editConfig.value.title,
        config: editConfig.value 
      }
    })
    if (res.ok) {
      selectedSection.value.title = editConfig.value.title
      selectedSection.value.config = JSON.parse(JSON.stringify(editConfig.value))
      selectedSection.value = null
      toast.success('Đã lưu cấu hình Block Gutenberg thành công!')
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu cấu hình')
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
    toast.success('Đã sắp xếp lại thứ tự Block!')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu thứ tự mới')
  }
}

const onSelectMedia = (media: any) => {
  editConfig.value.bgImage = media.url
  toast.success('Đã chọn hình ảnh từ Thư viện Media!')
}

onMounted(() => {
  fetchSections()
})
</script>

<template>
  <div class="wp-gutenberg-editor">
    <!-- Header Page -->
    <div class="page-header">
      <div>
        <h1 class="page-title">
          <i class="fa-solid fa-cubes"></i> Quản lý Block Trang chủ (WordPress Gutenberg Style)
        </h1>
        <p class="page-subtitle">Sắp xếp thứ tự kéo-thả, tùy chỉnh nội dung văn bản & phong cách hiển thị từng khối</p>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-state">
      <i class="fa-solid fa-spinner fa-spin"></i> Đang tải dữ liệu cấu hình Trang chủ...
    </div>

    <!-- Gutenberg Block List -->
    <div v-else class="gutenberg-blocks-wrap">
      <div class="blocks-container">
        <div
          v-for="(sec, idx) in sections"
          :key="sec.id"
          class="wp-block-card"
          :class="{ 'is-disabled': !sec.isVisible }"
        >
          <!-- Left: Drag Handle & Block Meta -->
          <div class="block-drag-side">
            <span class="drag-grip-icon" title="Kéo thả đổi vị trí">⠿</span>
            <div class="block-type-badge">
              <i :class="sectionTypes[sec.type]?.icon || 'fa-solid fa-box'"></i>
            </div>
            <div class="block-meta">
              <div class="block-title-row">
                <span class="block-name">{{ sectionTypes[sec.type]?.name || sec.type }}</span>
                <span class="block-tag">{{ sec.type }}</span>
              </div>
              <p class="block-subtitle">
                {{ sec.config?.title || sectionTypes[sec.type]?.desc }}
              </p>
            </div>
          </div>

          <!-- Right: Action Buttons -->
          <div class="block-actions-side">
            <div class="reorder-btns">
              <button
                class="icon-action-btn"
                :disabled="idx === 0"
                @click="moveSection(idx, 'up')"
                title="Di chuyển lên"
              >
                <i class="fa-solid fa-arrow-up"></i>
              </button>
              <button
                class="icon-action-btn"
                :disabled="idx === sections.length - 1"
                @click="moveSection(idx, 'down')"
                title="Di chuyển xuống"
              >
                <i class="fa-solid fa-arrow-down"></i>
              </button>
            </div>

            <button
              class="status-toggle-btn"
              :class="{ 'is-active': sec.isVisible }"
              @click="toggleVisibility(sec)"
              :title="sec.isVisible ? 'Bấm để ẩn khỏi trang chủ' : 'Bấm để hiển thị lên trang chủ'"
            >
              <i :class="sec.isVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i>
              <span>{{ sec.isVisible ? 'Hiển thị' : 'Đã ẩn' }}</span>
            </button>

            <button class="wp-customizer-btn" @click="openEditModal(sec)">
              <i class="fa-solid fa-sliders"></i> Tùy biến Block
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- WordPress Gutenberg Block Customizer Modal / Drawer -->
    <div v-if="selectedSection" class="customizer-overlay" @click.self="selectedSection = null">
      <div class="customizer-panel">
        <!-- Panel Header -->
        <div class="panel-header">
          <div class="panel-title-group">
            <div class="panel-icon">
              <i :class="sectionTypes[selectedSection.type]?.icon || 'fa-solid fa-box'"></i>
            </div>
            <div>
              <h3>Tùy biến Block: {{ sectionTypes[selectedSection.type]?.name }}</h3>
              <p>Chỉnh sửa giao diện & nội dung theo phong cách WordPress Gutenberg</p>
            </div>
          </div>
          <button class="close-panel-btn" @click="selectedSection = null">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <!-- Panel Tabs -->
        <div class="panel-tabs">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'content' }"
            @click="activeTab = 'content'"
          >
            <i class="fa-solid fa-pen-to-square"></i> 1. Nội dung & Văn bản
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'style' }"
            @click="activeTab = 'style'"
          >
            <i class="fa-solid fa-palette"></i> 2. Giao diện & Layout
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'preview' }"
            @click="activeTab = 'preview'"
          >
            <i class="fa-solid fa-desktop"></i> 3. Xem trước (Live Preview)
          </button>
        </div>

        <!-- Panel Body -->
        <div class="panel-body">
          <!-- TAB 1: CONTENT -->
          <div v-if="activeTab === 'content'" class="tab-content">
            <div class="form-group">
              <label>Tiêu đề chính của Block (*)</label>
              <input type="text" v-model="editConfig.title" placeholder="Nhập tiêu đề hiển thị" />
              <span class="field-hint">Tiêu đề nổi bật nằm ở đầu Block</span>
            </div>

            <div class="form-group">
              <label>Tiêu đề phụ / Khẩu hiệu (Subtitle)</label>
              <input type="text" v-model="editConfig.subtitle" placeholder="Nhập mô tả ngắn gọn" />
              <span class="field-hint">Hiển thị chữ nhỏ bên dưới tiêu đề chính</span>
            </div>

            <div class="form-group" v-if="selectedSection.type === 'hero'">
              <label>Văn bản đoạn giới thiệu</label>
              <textarea v-model="editConfig.description" rows="3" placeholder="Nhập mô tả cho banner hero..."></textarea>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Nhãn nút bấm (Button CTA)</label>
                <input type="text" v-model="editConfig.btnText" placeholder="eg: Xem tất cả →" />
              </div>
              <div class="form-group">
                <label>Đường dẫn liên kết (Button URL)</label>
                <input type="text" v-model="editConfig.btnLink" placeholder="eg: /news" />
              </div>
            </div>

            <div class="form-group" v-if="['news', 'role_models', 'reintegration', 'documents'].includes(selectedSection.type)">
              <label>Số lượng mục hiển thị trên trang chủ</label>
              <select v-model="editConfig.maxItems">
                <option :value="3">3 bài (Đề xuất)</option>
                <option :value="4">4 bài</option>
                <option :value="6">6 bài</option>
                <option :value="8">8 bài</option>
              </select>
            </div>
          </div>

          <!-- TAB 2: STYLE & LAYOUT -->
          <div v-if="activeTab === 'style'" class="tab-content">
            <div class="form-group">
              <label>Màu nền Section (Background Variant)</label>
              <div class="variant-selector">
                <label class="variant-option" :class="{ selected: editConfig.bgVariant === 'default' }">
                  <input type="radio" value="default" v-model="editConfig.bgVariant" />
                  <span class="swatch swatch-white"></span>
                  <span>Nền Trắng (Mặc định)</span>
                </label>
                <label class="variant-option" :class="{ selected: editConfig.bgVariant === 'light' }">
                  <input type="radio" value="light" v-model="editConfig.bgVariant" />
                  <span class="swatch swatch-gray"></span>
                  <span>Nền Xám Nhạt</span>
                </label>
                <label class="variant-option" :class="{ selected: editConfig.bgVariant === 'primary' }">
                  <input type="radio" value="primary" v-model="editConfig.bgVariant" />
                  <span class="swatch swatch-green"></span>
                  <span>Nền Xanh Đậm</span>
                </label>
              </div>
            </div>

            <div class="form-group">
              <label>Bố cục hiển thị (Layout Grid Style)</label>
              <select v-model="editConfig.layoutStyle">
                <option value="grid-3">Bố cục Grid 3 Cột (Tiêu chuẩn)</option>
                <option value="grid-4">Bố cục Grid 4 Cột (Mở rộng)</option>
                <option value="list">Bố cục Danh sách Hàng dọc</option>
                <option value="card-hero">Bố cục Card Nổi bật</option>
              </select>
            </div>

            <div class="form-group">
              <label>Hình ảnh Banner / Nền Block</label>
              <div class="media-picker-group">
                <input type="text" v-model="editConfig.bgImage" placeholder="Đường dẫn ảnh (/uploads/...)" />
                <button type="button" class="media-select-btn" @click="showMediaModal = true">
                  <i class="fa-solid fa-images"></i> Thư viện Media
                </button>
              </div>
              <div v-if="editConfig.bgImage" class="image-preview-box">
                <img :src="editConfig.bgImage" alt="Preview Background" />
                <button type="button" class="remove-img-btn" @click="editConfig.bgImage = ''">✕ Xóa ảnh</button>
              </div>
            </div>
          </div>

          <!-- TAB 3: LIVE PREVIEW -->
          <div v-if="activeTab === 'preview'" class="tab-content">
            <div class="live-preview-box" :class="`bg-${editConfig.bgVariant || 'default'}`">
              <div class="preview-header">
                <span class="preview-icon"><i :class="sectionTypes[selectedSection.type]?.icon"></i></span>
                <div>
                  <h4 class="preview-title">{{ editConfig.title || 'Tiêu đề chưa nhập' }}</h4>
                  <p class="preview-sub" v-if="editConfig.subtitle">{{ editConfig.subtitle }}</p>
                </div>
              </div>

              <div class="preview-mockup-grid" :class="editConfig.layoutStyle">
                <div v-for="i in 3" :key="i" class="mockup-card">
                  <div class="mockup-img"></div>
                  <div class="mockup-lines">
                    <div class="line line-title"></div>
                    <div class="line line-desc"></div>
                  </div>
                </div>
              </div>

              <div class="preview-footer" v-if="editConfig.btnText">
                <span class="preview-btn">{{ editConfig.btnText }} →</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Panel Footer -->
        <div class="panel-footer">
          <button class="cancel-panel-btn" @click="selectedSection = null">Hủy bỏ</button>
          <button class="save-panel-btn" :disabled="saving" @click="saveSectionConfig">
            <i v-if="saving" class="fa-solid fa-spinner fa-spin"></i>
            <i v-else class="fa-solid fa-check"></i>
            <span>{{ saving ? 'Đang lưu...' : 'Lưu thay đổi Block' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Media Library Picker Modal -->
    <AdminMediaLibraryModal
      :show="showMediaModal"
      @close="showMediaModal = false"
      @select="onSelectMedia"
    />
  </div>
</template>

<style scoped>
.wp-gutenberg-editor {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-title {
  font-size: 1.35rem;
  font-weight: 800;
  margin: 0;
  color: #122815;
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-subtitle {
  font-size: 0.85rem;
  color: #667768;
  margin: 4px 0 0 0;
}

.loading-state {
  padding: 40px;
  text-align: center;
  color: #667768;
  font-size: 1.1rem;
}

/* Gutenberg Block Cards */
.gutenberg-blocks-wrap {
  background: white;
  border-radius: 14px;
  border: 1px solid #e2ece3;
  padding: 20px;
}

.blocks-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.wp-block-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-radius: 12px;
  background: #fbfdfb;
  border: 1px solid #e0eae1;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.wp-block-card:hover {
  border-color: #a8d5ab;
  box-shadow: 0 4px 14px rgba(30, 70, 32, 0.06);
  transform: translateY(-1px);
}

.wp-block-card.is-disabled {
  opacity: 0.55;
  background: #f4f6f4;
}

.block-drag-side {
  display: flex;
  align-items: center;
  gap: 16px;
}

.drag-grip-icon {
  font-size: 1.2rem;
  color: #a0b2a2;
  cursor: grab;
  user-select: none;
}

.block-type-badge {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: #e4f2e5;
  color: #1e4620;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
}

.block-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.block-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.block-name {
  font-size: 0.98rem;
  font-weight: 700;
  color: #122815;
}

.block-tag {
  font-size: 0.72rem;
  font-weight: 700;
  background: #eef3ee;
  color: #556655;
  padding: 2px 8px;
  border-radius: 6px;
}

.block-subtitle {
  font-size: 0.83rem;
  color: #667768;
  margin: 0;
}

.block-actions-side {
  display: flex;
  align-items: center;
  gap: 12px;
}

.reorder-btns {
  display: flex;
  gap: 4px;
}

.icon-action-btn {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid #dce4dd;
  background: white;
  color: #445544;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.icon-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.icon-action-btn:not(:disabled):hover {
  background: #e4f2e5;
  color: #1e4620;
  border-color: #a8d5ab;
}

.status-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  background: #ffebe9;
  color: #d12420;
  transition: all 0.2s ease;
}

.status-toggle-btn.is-active {
  background: #e4f2e5;
  color: #2c6e33;
}

.wp-customizer-btn {
  background: #1e4620;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 0.85rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.wp-customizer-btn:hover {
  background: #2c6e33;
}

/* Customizer Panel (Drawer Modal) */
.customizer-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  z-index: 2000;
  display: flex;
  justify-content: flex-end;
}

.customizer-panel {
  width: 100%;
  max-width: 580px;
  height: 100%;
  background: white;
  display: flex;
  flex-direction: column;
  box-shadow: -10px 0 30px rgba(0, 0, 0, 0.2);
  animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.panel-header {
  padding: 20px 24px;
  border-bottom: 1px solid #e2ece3;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8faf8;
}

.panel-title-group {
  display: flex;
  align-items: center;
  gap: 14px;
}

.panel-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: #1e4620;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
}

.panel-title-group h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 800;
  color: #122815;
}

.panel-title-group p {
  margin: 2px 0 0 0;
  font-size: 0.8rem;
  color: #667768;
}

.close-panel-btn {
  background: transparent;
  border: none;
  font-size: 1.3rem;
  color: #889988;
  cursor: pointer;
}

.panel-tabs {
  display: flex;
  background: #eef3ee;
  padding: 6px 12px;
  gap: 6px;
  border-bottom: 1px solid #e2ece3;
}

.tab-btn {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  font-size: 0.83rem;
  font-weight: 700;
  color: #556655;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: white;
  color: #1e4620;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 0.85rem;
  font-weight: 700;
  color: #122815;
  margin-bottom: 6px;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 11px 14px;
  border: 1px solid #c8d6c9;
  border-radius: 8px;
  font-size: 0.9rem;
  box-sizing: border-box;
}

.field-hint {
  display: block;
  font-size: 0.78rem;
  color: #889988;
  margin-top: 4px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.variant-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.variant-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #dce4dd;
  cursor: pointer;
  font-size: 0.85rem;
}

.variant-option.selected {
  border-color: #1e4620;
  background: #f4f8f4;
  font-weight: 700;
}

.swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid #ccc;
}
.swatch-white { background: #ffffff; }
.swatch-gray { background: #f8faf8; }
.swatch-green { background: #1e4620; }

.media-picker-group {
  display: flex;
  gap: 8px;
}

.media-select-btn {
  background: #1e4620;
  color: white;
  border: none;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}

.image-preview-box {
  margin-top: 10px;
  position: relative;
  display: inline-block;
}

.image-preview-box img {
  max-width: 100%;
  max-height: 140px;
  border-radius: 8px;
  border: 1px solid #ddd;
}

.remove-img-btn {
  position: absolute;
  top: 6px; right: 6px;
  background: rgba(209, 36, 32, 0.9);
  color: white;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  cursor: pointer;
}

/* Live Preview Mockup */
.live-preview-box {
  padding: 20px;
  border-radius: 12px;
  border: 1px solid #e0eae1;
}
.live-preview-box.bg-default { background: #ffffff; }
.live-preview-box.bg-light { background: #f8faf8; }
.live-preview-box.bg-primary { background: #1e4620; color: white; }

.preview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.preview-icon {
  font-size: 1.4rem;
}

.preview-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 800;
}

.preview-sub {
  margin: 2px 0 0 0;
  font-size: 0.8rem;
  opacity: 0.8;
}

.preview-mockup-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.mockup-card {
  background: rgba(0,0,0,0.04);
  border-radius: 6px;
  padding: 8px;
}

.mockup-img {
  height: 50px;
  background: rgba(0,0,0,0.08);
  border-radius: 4px;
  margin-bottom: 6px;
}

.mockup-lines .line {
  height: 6px;
  background: rgba(0,0,0,0.1);
  border-radius: 3px;
  margin-bottom: 4px;
}
.line-title { width: 70%; }
.line-desc { width: 40%; }

.preview-footer {
  text-align: center;
}

.preview-btn {
  display: inline-block;
  padding: 6px 14px;
  background: #1e4620;
  color: white;
  font-size: 0.78rem;
  border-radius: 6px;
  font-weight: 700;
}

.panel-footer {
  padding: 16px 24px;
  border-top: 1px solid #e2ece3;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  background: #f8faf8;
}

.cancel-panel-btn {
  background: #f0f0f0;
  border: none;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
}

.save-panel-btn {
  background: #1e4620;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.save-panel-btn:hover {
  background: #2c6e33;
}
</style>
