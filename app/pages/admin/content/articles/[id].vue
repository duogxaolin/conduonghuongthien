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
  category: '',
  categoryId: null as number | null,
  excerpt: '',
  content: '',
  thumbnailUrl: '',
  status: 'published',
})

// True from the first frame when editing an existing article, so the editor
// grid is never painted empty before the fetched values arrive. A new article
// has nothing to fetch, so it starts false.
const loading = ref(!isNew.value)
const saving = ref(false)
const errorMsg = ref('')
const tinymceReady = ref(false)

// Dynamic categories for the selected article type
const availableCategories = ref<any[]>([])

const fetchCategories = async (type: string) => {
  try {
    const res = await $fetch('/api/admin/categories', { params: { type } })
    if (res.ok) availableCategories.value = res.items
  } catch { availableCategories.value = [] }
}

// Guard: true while fetchArticle is populating the form on initial load.
// Prevents the type watcher from resetting categoryId during article load.
let suppressTypeReset = false

// When article type changes: refetch categories and reset categoryId.
// Skipped during initial load via suppressTypeReset so the saved value is preserved.
watch(() => form.type, async (newType) => {
  if (suppressTypeReset) return
  form.category = ''
  form.categoryId = null
  await fetchCategories(newType)
})

const fetchArticle = async () => {
  if (isNew.value || !articleId.value) return
  suppressTypeReset = true  // block watcher resets during form population
  loading.value = true
  try {
    const res = await $fetch(`/api/admin/articles/${articleId.value}`)
    if (res.ok && res.article) {
      form.title = res.article.title || ''
      form.type = res.article.type || 'news'
      form.category = res.article.category || ''
      form.categoryId = res.article.categoryId ?? null
      form.excerpt = res.article.excerpt || ''
      form.content = res.article.content || ''
      form.thumbnailUrl = res.article.thumbnailUrl || ''
      form.status = res.article.status || 'published'
      // Explicitly load categories for the article's type so the dropdown
      // renders the saved selection. The watcher is suppressed and won't do this.
      await fetchCategories(form.type)
      if (tinymceReady.value && (window as any).tinymce) {
        const ed = (window as any).tinymce.get(TINYMCE_EDITOR_ID)
        if (ed) ed.setContent(form.content)
      }
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Lỗi tải bài viết'
  } finally {
    loading.value = false
    // Wait for Vue to flush the queued watcher (triggered by form.type assignment
    // above) so it runs — and is suppressed — before we release the guard.
    await nextTick()
    suppressTypeReset = false
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
    toast.warning('Tiêu đề bài viết không được để trống'); return
  }
  form.content = getEditorContent()
  errorMsg.value = ''
  saving.value = true
  try {
    if (isNew.value) {
      const res = await $fetch('/api/admin/articles', { method: 'POST', body: form })
      if (res.ok) { toast.success('Tạo bài viết mới thành công!'); navigateTo('/admin/content/articles') }
    } else {
      const res = await $fetch(`/api/admin/articles/${articleId.value}`, { method: 'PUT', body: form })
      if (res.ok) toast.success('Đã cập nhật bài viết thành công!')
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || 'Lỗi lưu bài viết'
    toast.error(errorMsg.value)
  } finally {
    saving.value = false
  }
}

const { openPicker } = useImagePicker()
const { uploading: uploadingThumb, uploadFile } = useUpload()

const openMediaPicker = (target: 'thumbnail' | 'content') => {
  if (target === 'thumbnail') {
    openPicker({ onSelect: (media) => { form.thumbnailUrl = media.url } })
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

const uploadThumbnailFromInput = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const media = await uploadFile(file)
  if (media) form.thumbnailUrl = media.url
  ;(e.target as HTMLInputElement).value = ''
}

const initTinyMCE = () => {
  if (typeof window === 'undefined') return
  const win = window as any
  if (!win.tinymce) return
  if (win.tinymce.get(TINYMCE_EDITOR_ID)) win.tinymce.get(TINYMCE_EDITOR_ID).remove()
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
      { text: 'HTML/XML', value: 'markup' }, { text: 'JavaScript', value: 'javascript' },
      { text: 'CSS', value: 'css' }, { text: 'PHP', value: 'php' },
      { text: 'Python', value: 'python' }, { text: 'SQL', value: 'sql' },
      { text: 'Bash', value: 'bash' }, { text: 'JSON', value: 'json' },
    ],
    image_advtab: true,
    image_caption: true,
    automatic_uploads: true,
    paste_data_images: true,
    paste_merge_formats: true,
    file_picker_types: 'image',
    images_upload_handler: (blobInfo: any) => new Promise<string>((resolve, reject) => {
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
        if (form.content) editor.setContent(form.content)
      })
      editor.on('change', () => { form.content = editor.getContent() })
    },
    content_style: `
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; padding: 12px; color: #1a1a1a; }
      img { max-width: 100%; height: auto; border-radius: 8px; }
      pre[class*="language-"] { background: #2d2d2d; border-radius: 6px; padding: 1em; overflow-x: auto; }
      code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: 'Fira Code', monospace; }
      blockquote { border-left: 4px solid #2c6e33; margin: 1em 0; padding-left: 1em; color: #555; }
      table { border-collapse: collapse; width: 100%; }
      table td, table th { border: 1px solid #ddd; padding: 8px; }
    `
  })
}

const loadTinyMCEScript = () => new Promise<void>((resolve) => {
  if ((window as any).tinymce) { resolve(); return }
  const script = document.createElement('script')
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/tinymce/6.8.6/tinymce.min.js'
  script.referrerPolicy = 'no-referrer'
  script.onload = () => resolve()
  script.onerror = () => {
    const fallback = document.createElement('script')
    fallback.src = '/assets/tinymce/tinymce.min.js'
    fallback.onload = () => resolve()
    document.head.appendChild(fallback)
  }
  document.head.appendChild(script)
})

onMounted(async () => {
  // The script download runs alongside the data fetch, but initTinyMCE must
  // come last: it attaches to #tinymce-content-editor, which only exists once
  // the loading placeholder has been replaced by the real editor grid.
  const scriptReady = loadTinyMCEScript()
  await fetchCategories(form.type)
  await fetchArticle()
  await scriptReady
  await nextTick()
  initTinyMCE()
})

onUnmounted(() => {
  if ((window as any).tinymce) {
    const ed = (window as any).tinymce.get(TINYMCE_EDITOR_ID)
    if (ed) ed.destroy()
  }
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">
          {{ isNew ? '✍️ Viết Bài Mới' : '✏️ Chỉnh Sửa Bài Viết' }}
        </h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Soạn thảo nội dung tin tức, bài viết bài bản với thư viện ảnh tích hợp</p>
      </div>
      <div class="flex gap-3">
        <nuxt-link
          to="/admin/content/articles"
          class="inline-flex items-center bg-white border border-[#c8d6c9] text-[#667768] no-underline px-4 py-2.5 rounded-lg font-semibold hover:bg-[#f8faf8] transition-colors"
        >Hủy & Quay lại</nuxt-link>
        <button
          class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="saving"
          @click="handleSave"
        >
          <i class="fa-solid fa-floppy-disk"></i>
          {{ saving ? 'Đang lưu...' : (isNew ? 'Đăng Bài Mới' : 'Cập Nhật Bài Viết') }}
        </button>
      </div>
    </div>

    <div v-if="errorMsg" class="bg-[#ffebe9] text-[#d12420] px-4 py-2.5 rounded-lg text-[0.85rem]">{{ errorMsg }}</div>

    <!-- Loading — shaped like the editor grid below, which is `v-else`, so the
         real grid does not exist in the DOM while this is showing. That is safe
         only because of the ordering in onMounted: initTinyMCE() runs after
         `await fetchArticle()` and a nextTick(), i.e. after the flag has flipped
         and #tinymce-content-editor has actually been rendered. Moving
         initTinyMCE() ahead of the fetch would attach the editor to an element
         that is about to be unmounted. -->
    <div v-if="loading" class="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5" role="status" aria-busy="true">
      <span class="sr-only">Đang tải nội dung bài viết</span>
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6 flex flex-col gap-5" aria-hidden="true">
        <div class="flex flex-col gap-1.5">
          <div class="h-3 w-40 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
          <div class="h-[50px] w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="h-3 w-48 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
          <div class="h-20 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
        </div>
        <div class="flex flex-col gap-2">
          <div class="h-3 w-56 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
          <div class="min-h-[480px] w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
        </div>
      </div>
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6 flex flex-col gap-4 self-start" aria-hidden="true">
        <div class="h-4 w-40 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
        <div v-for="n in 3" :key="'sf-' + n" class="flex flex-col gap-1.5">
          <div class="h-3 w-28 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
          <div class="h-10 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
        </div>
        <div class="flex flex-col gap-2">
          <div class="h-3 w-36 rounded bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
          <div class="h-40 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
          <div class="h-10 w-full rounded-lg bg-[#edf3ed] animate-pulse motion-reduce:animate-none"></div>
          <div class="h-10 w-full rounded-lg bg-[#dfe9e0] animate-pulse motion-reduce:animate-none"></div>
        </div>
      </div>
    </div>

    <!-- Two-column editor grid -->
    <div v-else class="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">
      <!-- Main Form -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6 flex flex-col gap-5">
        <div class="flex flex-col gap-1.5">
          <label class="text-[0.84rem] font-bold text-[#2c3e2e]">Tiêu đề bài viết (*)</label>
          <input
            type="text"
            v-model="form.title"
            placeholder="Nhập tiêu đề hấp dẫn..."
            class="w-full px-3.5 py-3 border border-[#c8d6c9] rounded-lg text-[1.1rem] font-bold outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[0.84rem] font-bold text-[#2c3e2e]">Tóm tắt bài viết (Excerpt)</label>
          <textarea
            v-model="form.excerpt"
            rows="3"
            placeholder="Nhập đoạn tóm tắt ngắn hiển thị ở trang danh sách..."
            class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border resize-none font-[inherit]"
          ></textarea>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <label class="text-[0.84rem] font-bold text-[#2c3e2e]">Nội dung chi tiết (HTML / Editor)</label>
            <button
              class="inline-flex items-center gap-1.5 bg-[#f0f7f1] text-[#2c6e33] border border-[#8ed694] px-2.5 py-1.5 rounded-md text-[0.78rem] font-bold cursor-pointer hover:bg-[#e4f2e5] transition-colors"
              @click="openMediaPicker('content')"
            >
              <i class="fa-regular fa-images"></i> Chèn Ảnh Từ Thư Viện
            </button>
          </div>
          <div :id="TINYMCE_EDITOR_ID" class="min-h-[480px]"></div>
        </div>
      </div>

      <!-- Meta Sidebar -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-6 flex flex-col gap-4 self-start">
        <h3 class="text-[1rem] font-bold text-[#122815] m-0">Cấu hình xuất bản</h3>

        <div class="flex flex-col gap-1.5">
          <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Thể loại bài viết (*)</label>
          <select v-model="form.type" class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border">
            <option value="news">📰 Bản tin & Tin tức</option>
            <option value="role_model">🏆 Tấm gương tiêu biểu</option>
            <option value="reintegration">🏭 Mô hình tái hòa nhập</option>
            <option value="document">📄 Văn bản pháp luật</option>
            <option value="faq">❓ Giải đáp pháp luật</option>
          </select>
        </div>

        <!-- Dynamic category select — populated from DB by type -->
        <div v-if="availableCategories.length > 0" class="flex flex-col gap-1.5">
          <label class="text-[0.82rem] font-bold text-[#2c3e2e]">
            Danh mục
            <span class="font-normal text-[#667768]">— tùy chọn</span>
          </label>
          <select v-model="form.categoryId" class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border">
            <option :value="null">— Không có danh mục —</option>
            <template v-for="cat in availableCategories" :key="cat.id">
              <option v-if="!cat.parentId" :value="cat.id" class="font-bold">{{ cat.name }}</option>
              <option v-else :value="cat.id">&nbsp;&nbsp;↳ {{ cat.name }}</option>
            </template>
          </select>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Trạng thái (*)</label>
          <select v-model="form.status" class="w-full px-3 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] box-border">
            <option value="published">🟢 Xuất Bản Ngay</option>
            <option value="draft">🟡 Bản Nháp (Draft)</option>
            <option value="archived">⚪ Lưu Trữ</option>
          </select>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Ảnh đại diện (Thumbnail)</label>
          <div v-if="form.thumbnailUrl" class="relative w-full h-40 rounded-lg overflow-hidden border border-[#e2ece3]">
            <img :src="form.thumbnailUrl" class="w-full h-full object-cover" />
            <button class="absolute top-2 right-2 bg-black/70 text-white border-0 w-6 h-6 rounded-full cursor-pointer flex items-center justify-center text-xs" @click="form.thumbnailUrl = ''">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <button
            class="w-full flex items-center justify-center gap-2 bg-[#f0f7f1] border border-[#8ed694] text-[#2c6e33] px-3 py-2.5 rounded-lg font-bold cursor-pointer text-sm hover:bg-[#e4f2e5] transition-colors"
            @click="openMediaPicker('thumbnail')"
          >
            <i class="fa-regular fa-images"></i> {{ form.thumbnailUrl ? 'Đổi từ thư viện' : 'Chọn từ thư viện' }}
          </button>
          <label
            class="w-full flex items-center justify-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white px-3 py-2.5 rounded-lg font-bold cursor-pointer text-sm transition-colors"
            :class="{ 'opacity-60 cursor-not-allowed pointer-events-none': uploadingThumb }"
          >
            <i class="fa-regular" :class="uploadingThumb ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i>
            {{ uploadingThumb ? 'Đang tải...' : 'Upload ảnh' }}
            <input type="file" accept="image/*" class="sr-only" :disabled="uploadingThumb" @change="uploadThumbnailFromInput" />
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
