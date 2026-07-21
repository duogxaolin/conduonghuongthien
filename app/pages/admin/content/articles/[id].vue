<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const route = useRoute()
const isNew = computed(() => route.params.id === 'new')
const articleId = computed(() => isNew.value ? null : Number(route.params.id))

const TINYMCE_EDITOR_ID = 'tinymce-content-editor'

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
const tinymceReady = ref(false)

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
      // If TinyMCE is already initialized, set content
      if (tinymceReady.value && (window as any).tinymce) {
        const ed = (window as any).tinymce.get(TINYMCE_EDITOR_ID)
        if (ed) ed.setContent(form.content)
      }
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Lỗi tải bài viết'
  } finally {
    loading.value = false
  }
}

const toast = useToast()

const getEditorContent = (): string => {
  if ((window as any).tinymce) {
    const ed = (window as any).tinymce.get(TINYMCE_EDITOR_ID)
    if (ed) return ed.getContent()
  }
  return form.content
}

const handleSave = async () => {
  if (!form.title.trim()) {
    errorMsg.value = 'Tiêu đề bài viết không được để trống'
    toast.warning('Tiêu đề bài viết không được để trống')
    return
  }

  // Get latest content from TinyMCE before saving
  form.content = getEditorContent()

  errorMsg.value = ''
  saving.value = true

  try {
    if (isNew.value) {
      const res = await $fetch('/api/admin/articles', {
        method: 'POST',
        body: form
      })
      if (res.ok) {
        toast.success('Tạo bài viết mới thành công!')
        navigateTo('/admin/content/articles')
      }
    } else {
      const res = await $fetch(`/api/admin/articles/${articleId.value}`, {
        method: 'PUT',
        body: form
      })
      if (res.ok) {
        toast.success('Đã cập nhật bài viết thành công!')
      }
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Lỗi lưu bài viết'
    toast.error(errorMsg.value)
  } finally {
    saving.value = false
  }
}

const { openPicker } = useImagePicker()
const { uploading: uploadingThumb, pickAndUpload } = useUpload()

const openMediaPicker = (target: 'thumbnail' | 'content') => {
  if (target === 'thumbnail') {
    openPicker({
      onSelect: (media) => { form.thumbnailUrl = media.url }
    })
  } else {
    openPicker({
      onSelect: (media) => {
        const imgHtml = `<p><img src="${media.url}" alt="${media.originalName}" /></p>`
        if ((window as any).tinymce) {
          const ed = (window as any).tinymce.get(TINYMCE_EDITOR_ID)
          if (ed) { ed.insertContent(imgHtml); return }
        }
        form.content += '\n' + imgHtml
      }
    })
  }
}

const uploadThumbnail = async () => {
  const media = await pickAndUpload('image/*')
  if (media) form.thumbnailUrl = media.url
}

const initTinyMCE = () => {
  if (typeof window === 'undefined') return
  const win = window as any
  if (!win.tinymce) return

  // Destroy existing instance if any (SPA navigation)
  if (win.tinymce.get(TINYMCE_EDITOR_ID)) {
    win.tinymce.get(TINYMCE_EDITOR_ID).remove()
  }

  win.tinymce.init({
    selector: `#${TINYMCE_EDITOR_ID}`,
    height: 480,
    menubar: true,
    promotion: false,
    branding: false,
    skin: 'oxide',
    content_css: 'default',
    relative_urls: false,
    remove_script_host: false,
    convert_urls: true,
    plugins: [
      'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'preview',
      'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
      'insertdatetime', 'media', 'table', 'help', 'wordcount', 'codesample',
      'emoticons', 'quickbars'
    ],
    toolbar: 'undo redo | blocks | ' +
      'bold italic underline strikethrough | forecolor backcolor | ' +
      'alignleft aligncenter alignright alignjustify | ' +
      'bullist numlist outdent indent | ' +
      'link image media codesample | emoticons | ' +
      'table | removeformat | fullscreen code help',
    toolbar_mode: 'sliding',
    quickbars_selection_toolbar: 'bold italic | quicklink h2 h3 blockquote',
    quickbars_insert_toolbar: 'quickimage quicktable',
    contextmenu: 'link image table',
    codesample_languages: [
      { text: 'HTML/XML', value: 'markup' },
      { text: 'JavaScript', value: 'javascript' },
      { text: 'CSS', value: 'css' },
      { text: 'PHP', value: 'php' },
      { text: 'Python', value: 'python' },
      { text: 'SQL', value: 'sql' },
      { text: 'Bash', value: 'bash' },
      { text: 'JSON', value: 'json' },
    ],
    image_advtab: true,
    image_caption: true,
    automatic_uploads: true,
    paste_data_images: true,
    paste_merge_formats: true,
    file_picker_types: 'image',
    images_upload_handler: (blobInfo: any, progress: any) => new Promise<string>((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', blobInfo.blob(), blobInfo.filename())
      $fetch('/api/admin/media/upload', { method: 'POST', body: formData })
        .then((res: any) => {
          if (res.ok && res.media?.url) resolve(res.media.url)
          else reject('Upload thất bại')
        })
        .catch((err: any) => reject(err?.data?.statusMessage || 'Upload thất bại'))
    }),
    setup: (editor: any) => {
      editor.on('init', () => {
        tinymceReady.value = true
        if (form.content) {
          editor.setContent(form.content)
        }
      })
      editor.on('change', () => {
        form.content = editor.getContent()
      })
    },
    content_style: `
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        padding: 12px;
        color: #1a1a1a;
      }
      img { max-width: 100%; height: auto; border-radius: 8px; }
      pre[class*="language-"] {
        background: #2d2d2d; border-radius: 6px;
        padding: 1em; overflow-x: auto;
      }
      code {
        background: #f4f4f4; padding: 2px 6px;
        border-radius: 4px; font-family: 'Fira Code', monospace;
      }
      blockquote {
        border-left: 4px solid #2c6e33; margin: 1em 0;
        padding-left: 1em; color: #555;
      }
      table { border-collapse: collapse; width: 100%; }
      table td, table th { border: 1px solid #ddd; padding: 8px; }
    `
  })
}

const loadTinyMCEScript = () => {
  return new Promise<void>((resolve) => {
    if ((window as any).tinymce) {
      resolve()
      return
    }
    // Load từ CDN cdnjs (giống forum) — đầy đủ plugins không cần self-host
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/tinymce/6.8.6/tinymce.min.js'
    script.referrerPolicy = 'no-referrer'
    script.onload = () => resolve()
    script.onerror = () => {
      // Fallback về local nếu CDN không khả dụng
      const fallback = document.createElement('script')
      fallback.src = '/assets/tinymce/tinymce.min.js'
      fallback.onload = () => resolve()
      document.head.appendChild(fallback)
    }
    document.head.appendChild(script)
  })
}

onMounted(async () => {
  await loadTinyMCEScript()
  initTinyMCE()
  await fetchArticle()
})

onUnmounted(() => {
  if ((window as any).tinymce) {
    const ed = (window as any).tinymce.get(TINYMCE_EDITOR_ID)
    if (ed) ed.destroy()
  }
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
                Chèn Ảnh Từ Thư Viện
              </button>
            </div>
            <div :id="TINYMCE_EDITOR_ID" class="tinymce-target"></div>
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
              <div class="thumb-actions">
                <button class="select-thumb-btn" @click="openMediaPicker('thumbnail')">
                  <i class="fa-regular fa-images"></i> {{ form.thumbnailUrl ? 'Đổi từ thư viện' : 'Chọn từ thư viện' }}
                </button>
                <label class="select-thumb-btn upload-btn" :class="{ disabled: uploadingThumb }">
                  <i class="fa-regular" :class="uploadingThumb ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i>
                  {{ uploadingThumb ? 'Đang tải...' : 'Upload ảnh' }}
                  <input type="file" accept="image/*" class="sr-only" :disabled="uploadingThumb" @change="async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if(f) { const m = await (useUpload().uploadFile)(f); if(m) form.thumbnailUrl = m.url; (e.target as HTMLInputElement).value='' } }" />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
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

.tinymce-target {
  min-height: 480px;
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
