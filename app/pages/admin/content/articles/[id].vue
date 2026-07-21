<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const route = useRoute()
const isNew = computed(() => route.params.id === 'new')
const articleId = computed(() => isNew.value ? null : Number(route.params.id))

const showMediaModal = ref(false)
const mediaPickerTarget = ref<'thumbnail' | 'content'>('thumbnail')

const form = reactive({
  title: '',
  type: 'news',
  excerpt: '',
  content: '',
  thumbnailUrl: '',
  status: 'published',
})

const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')

const fetchArticle = async () => {
  if (isNew.value || !articleId.value) return
  loading.value = true
  try {
    const res = await $fetch(`/api/admin/articles/${articleId.value}`)
    if (res.ok && res.article) {
      form.title = res.article.title || ''
      form.type = res.article.type || 'news'
      form.excerpt = res.article.excerpt || ''
      form.content = res.article.content || ''
      form.thumbnailUrl = res.article.thumbnailUrl || ''
      form.status = res.article.status || 'published'
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Lỗi tải bài viết'
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  if (!form.title.trim()) {
    errorMsg.value = 'Vui lòng nhập tiêu đề bài viết.'
    return
  }

  errorMsg.value = ''
  saving.value = true

  try {
    if (isNew.value) {
      const res = await $fetch('/api/admin/articles', {
        method: 'POST',
        body: form
      })
      if (res.ok) {
        alert('Tạo bài viết mới thành công!')
        navigateTo('/admin/content/articles')
      }
    } else {
      const res = await $fetch(`/api/admin/articles/${articleId.value}`, {
        method: 'PUT',
        body: form
      })
      if (res.ok) {
        alert('Đã cập nhật bài viết!')
      }
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Lỗi lưu bài viết'
  } finally {
    saving.value = false
  }
}

const openMediaPicker = (target: 'thumbnail' | 'content') => {
  mediaPickerTarget.value = target
  showMediaModal.value = true
}

const handleMediaSelected = (media: any) => {
  if (mediaPickerTarget.value === 'thumbnail') {
    form.thumbnailUrl = media.url
  } else if (mediaPickerTarget.value === 'content') {
    // Append image tag into content textarea
    const imgHtml = `<p><img src="${media.url}" alt="${media.originalName}" /></p>\n`
    form.content += imgHtml
  }
}

onMounted(() => {
  fetchArticle()
})
</script>

<template>
  <div class="article-editor-page">
    <div class="page-header">
      <div>
        <h1>{{ isNew ? '✍️ Viết Bài Mới' : '✏️ Chỉnh Sửa Bài Viết' }}</h1>
        <p>Soạn thảo nội dung tin tức, bài viết bài bản với thư viện ảnh tích hợp</p>
      </div>
      <div class="header-actions">
        <nuxt-link to="/admin/content/articles" class="cancel-btn">Hủy & Quay lại</nuxt-link>
        <button class="primary-btn" :disabled="saving" @click="handleSave">
          <span v-if="saving">Đang lưu...</span>
          <span v-else>💾 {{ isNew ? 'Đăng Bài Mới' : 'Cập Nhật Bài Viết' }}</span>
        </button>
      </div>
    </div>

    <div v-if="errorMsg" class="error-alert">{{ errorMsg }}</div>

    <div class="editor-grid">
      <!-- Left Main Form -->
      <div class="main-form">
        <div class="form-card">
          <div class="form-group">
            <label>Tiêu đề bài viết (*)</label>
            <input
              type="text"
              v-model="form.title"
              placeholder="Nhập tiêu đề hấp dẫn..."
              class="title-input"
            />
          </div>

          <div class="form-group">
            <label>Tóm tắt bài viết (Excerpt)</label>
            <textarea
              v-model="form.excerpt"
              rows="3"
              placeholder="Nhập đoạn tóm tắt ngắn hiển thị ở trang danh sách..."
            ></textarea>
          </div>

          <div class="form-group">
            <div class="label-row">
              <label>Nội dung chi tiết (HTML / Editor)</label>
              <button class="media-btn" @click="openMediaPicker('content')">
                🖼️ Chèn Ảnh Từ Thư Viện
              </button>
            </div>
            <textarea
              v-model="form.content"
              rows="16"
              class="content-editor"
              placeholder="Nhập nội dung bài viết ở đây. Bạn có thể sử dụng các thẻ HTML như <p>, <h2>, <ul>, <strong> hoặc chèn ảnh từ Thư viện..."
            ></textarea>
          </div>
        </div>
      </div>

      <!-- Right Meta Panel -->
      <div class="meta-form">
        <div class="form-card">
          <h3>Cấu hình xuất bản</h3>

          <div class="form-group">
            <label>Thể loại bài viết (*)</label>
            <select v-model="form.type">
              <option value="news">📰 Bản tin & Tin tức</option>
              <option value="role_model">🏆 Tấm gương tiêu biểu</option>
              <option value="reintegration">🏭 Mô hình tái hòa nhập</option>
              <option value="document">📄 Văn bản pháp luật</option>
              <option value="faq">❓ Giải đáp pháp luật</option>
            </select>
          </div>

          <div class="form-group">
            <label>Trạng thái (*)</label>
            <select v-model="form.status">
              <option value="published">🟢 Xuất Bản Ngay</option>
              <option value="draft">🟡 Bản Nháp (Draft)</option>
              <option value="archived">⚪ Lưu Trữ</option>
            </select>
          </div>

          <div class="form-group">
            <label>Ảnh đại diện (Thumbnail)</label>
            <div class="thumb-picker-wrap">
              <div v-if="form.thumbnailUrl" class="thumb-preview">
                <img :src="form.thumbnailUrl" />
                <button class="remove-thumb" @click="form.thumbnailUrl = ''">✕</button>
              </div>
              <button class="select-thumb-btn" @click="openMediaPicker('thumbnail')">
                🖼️ {{ form.thumbnailUrl ? 'Đổi Ảnh Đại Diện' : 'Chọn Ảnh Từ Thư Viện' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Media Library Modal -->
    <MediaLibraryModal
      :show="showMediaModal"
      @close="showMediaModal = false"
      @select="handleMediaSelected"
    />
  </div>
</template>

<style scoped>
.article-editor-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
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

.header-actions {
  display: flex;
  gap: 12px;
}

.primary-btn {
  background: #1e4620;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}

.cancel-btn {
  background: white;
  border: 1px solid #c8d6c9;
  color: #667768;
  text-decoration: none;
  padding: 10px 16px;
  border-radius: 8px;
  font-weight: 600;
}

.error-alert {
  background: #ffebe9;
  color: #d12420;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
}

.editor-grid {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 20px;
}

.form-card {
  background: white;
  padding: 24px;
  border-radius: 12px;
  border: 1px solid #e2ece3;
}

.form-card h3 {
  margin: 0 0 16px 0;
  font-size: 1rem;
  color: #122815;
}

.form-group {
  margin-bottom: 20px;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.media-btn {
  background: #f0f7f1;
  color: #2c6e33;
  border: 1px solid #8ed694;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.form-group label {
  display: block;
  font-size: 0.84rem;
  font-weight: 700;
  margin-bottom: 6px;
  color: #2c3e2e;
}

.title-input {
  font-size: 1.1rem;
  font-weight: 700;
}

.form-group input, .form-group textarea, .form-group select {
  width: 100%;
  padding: 12px;
  border: 1px solid #c8d6c9;
  border-radius: 8px;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 0.92rem;
}

.content-editor {
  line-height: 1.6;
}

.thumb-picker-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.thumb-preview {
  position: relative;
  width: 100%;
  height: 160px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e2ece3;
}

.thumb-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.remove-thumb {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
}

.select-thumb-btn {
  background: #f0f7f1;
  border: 1px border #8ed694;
  color: #2c6e33;
  padding: 10px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}
</style>
