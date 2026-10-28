<script setup lang="ts">
import type { WindowWithTinyMce } from '~/types/tinymce'
import type { AdminCategoryRow, AdminContentTypeRow, AdminMediaUploadResult } from '~/types/admin-api'
import type { ArticleCreateResponse, ArticleReadResponse, ArticleTranslateResponse, ArticleUpdateResponse } from '~/types/admin-articles-api'
import type { AdminCategoriesResponse, AdminContentTypesResponse } from '~/types/admin-taxonomy-api'
import type { MediaItem } from '~/types/media'
import TinyMceEditor from '~/components/admin/TinyMceEditor.vue'
import AdminModal from '~/components/admin/AdminModal.vue'
import ArticleTranslationPanel from '~/components/admin/articles/ArticleTranslationPanel.vue'
import ArticleAIPanel from '~/components/admin/articles/ArticleAIPanel.vue'
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
/** Tải bài hỏng ("Thử lại" tải lại). Lưu hỏng là `saveError`: không tải lại đè lên chữ đang gõ. */
const errorMsg = ref('')
const saveError = ref('')
const tinymceReady = ref(false)

function setEditorContent(html: string): void {
  form.content = html
  if (tinymceReady.value && (window as WindowWithTinyMce).tinymce) {
    const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
    if (ed) ed.setContent(html)
  }
}

function getEditorContent(): string {
  if (typeof window !== 'undefined' && (window as WindowWithTinyMce).tinymce) {
    const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
    if (ed) {
      const c = ed.getContent()
      if (c && c.trim()) return c
    }
  }
  return form.content || ''
}

// ─── Unsaved-changes guard ────────────────────────────────────────────
// Leaving the editor (another admin link, back button, closing the tab) used to
// drop an unsaved article without a word. The baseline is what was last loaded
// or saved; the body is compared as TinyMCE serialises it, since setContent()
// normalises HTML and `form.content` only follows the editor on `change`.
const savedFields = ref('')
const savedContent = ref<string | null>(null)

function fieldsSnapshot(): string {
  const { title, type, category, categoryId, excerpt, thumbnailUrl, status } = form
  return JSON.stringify({ title, type, category, categoryId, excerpt, thumbnailUrl, status })
}

/** The editor's current HTML, or null before TinyMCE has initialised. */
function editorHtml(): string | null {
  if (typeof window === 'undefined' || !tinymceReady.value) return null
  return (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)?.getContent() ?? null
}

/** Record the current state as saved. The body baseline waits for the editor (see `init`). */
function markSaved(): void {
  savedFields.value = fieldsSnapshot()
  savedContent.value = editorHtml()
}

function hasUnsavedChanges(): boolean {
  if (loading.value || !savedFields.value) return false
  if (fieldsSnapshot() !== savedFields.value) return true
  const html = editorHtml()
  return savedContent.value !== null && html !== null && html !== savedContent.value
}

// (AI editorial + translation đã chuyển vào ArticleAIPanel.vue / ArticleTranslationPanel.vue)

// Dynamic categories for the selected article type
const availableCategories = ref<AdminCategoryRow[]>([])

// Content types from DB — drives the Type <select> so a type created in
// /admin/content/content-types shows up here too (not just the 5 hardcoded ones).
const contentTypes = ref<AdminContentTypeRow[]>([])

const fetchContentTypes = async () => {
  try {
    contentTypes.value = (await adminFetch<AdminContentTypesResponse>('/api/admin/content-types')).items
  } catch { /* keep empty — select falls back to nothing */ }
}

// Chỉ lượt mới nhất được ghi: danh mục của thể loại chọn trước, về sau, không lấp ô "Danh mục".
let categoriesRequest = 0
const fetchCategories = async (type: string) => {
  const ticket = ++categoriesRequest
  try {
    const { items } = await adminFetch<AdminCategoriesResponse>('/api/admin/categories', { query: { type } })
    if (ticket === categoriesRequest) availableCategories.value = items
  } catch { if (ticket === categoriesRequest) availableCategories.value = [] }
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
  errorMsg.value = ''
  try {
    const res = await adminFetch<ArticleReadResponse>(`/api/admin/articles/${articleId.value}`)
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
      if (tinymceReady.value && (window as WindowWithTinyMce).tinymce) {
        const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
        if (ed) ed.setContent(form.content)
      }
      recordInitialSnapshot()
    }
  } catch (err: unknown) {
    errorMsg.value = errorMessage(err, 'Lỗi tải bài viết')
  } finally {
    loading.value = false
    // Wait for Vue to flush the queued watcher (triggered by form.type assignment
    // above) so it runs — and is suppressed — before we release the guard.
    await nextTick()
    suppressTypeReset = false
  }
}
const toast = useToast()

// ─── Initial Content Snapshot & Re-translation Prompt ─────────────────
const initialContentSnapshot = ref<{ title: string; excerpt: string; content: string } | null>(null)
const showReTranslateModal = ref(false)
const reTranslatePublishImmediately = ref(false)
const reTranslateRunning = ref(false)

function recordInitialSnapshot() {
  initialContentSnapshot.value = {
    title: form.title.trim(),
    excerpt: form.excerpt.trim(),
    content: form.content.trim(),
  }
}

function checkAndPromptReTranslation() {
  if (!initialContentSnapshot.value) return
  const currentTitle = form.title.trim()
  const currentExcerpt = form.excerpt.trim()
  const currentContent = form.content.trim()

  const hasContentChanged =
    currentTitle !== initialContentSnapshot.value.title ||
    currentExcerpt !== initialContentSnapshot.value.excerpt ||
    currentContent !== initialContentSnapshot.value.content

  if (hasContentChanged) {
    recordInitialSnapshot()
    showReTranslateModal.value = true
  }
}

async function confirmReTranslation() {
  reTranslateRunning.value = true
  try {
    const targetStatus = reTranslatePublishImmediately.value ? 'published' : 'ai_draft'
    await translateAllForThisArticle(targetStatus)
    showReTranslateModal.value = false
  } finally {
    reTranslateRunning.value = false
  }
}

const autoTranslateLangs = ref<string[]>(['en'])
const showAutoTranslateMenu = ref(false)

// Template ref tới ArticleTranslationPanel con. Khai báo trước computed đọc
// từ nó (tránh TDZ visual — dù computed là lazy, đặt ref trước cho rõ thứ tự).
const translationPanelRef = ref<InstanceType<typeof ArticleTranslationPanel> | null>(null)

// `availableLanguages` / `articleTranslations` / `translatingAll` giờ sống trong
// `ArticleTranslationPanel` con. Cha đọc qua `translationPanelRef` (expose) cho
// auto-translate menu (new article) + re-translate modal (hiển thị list lang).
// Badge "Bản dịch X/Y" ở header không cần nữa — con đã hiển thị count trong panel.
const availableLanguages = computed(() => translationPanelRef.value?.availableLanguages ?? [])

function scrollToTranslations() {
  nextTick(() => {
    document.getElementById('article-translations-section')?.scrollIntoView({ behavior: 'smooth' })
  })
}

// Wrapper gọi con — cha dùng cho re-translate modal (confirmReTranslation) và
// auto-translate sau khi tạo bài mới. Con giữ state optimistic + polling.
async function translateAllForThisArticle(targetStatus: 'ai_draft' | 'published' = 'ai_draft') {
  await translationPanelRef.value?.translateAllForThisArticle(targetStatus)
}

const handleSave = async () => {
  if (errorMsg.value) return // bài chưa tải được: lưu biểu mẫu trống là ghi đè bài thật
  if (!form.title.trim()) {
    toast.warning('Tiêu đề bài viết không được để trống'); return
  }
  form.content = getEditorContent()
  saveError.value = ''
  saving.value = true
  try {
    if (isNew.value) {
      const res = await adminFetch<ArticleCreateResponse>('/api/admin/articles', { method: 'POST', body: form })
      if (res.ok) {
        toast.success('Tạo bài viết mới thành công!')
        // Saved: the redirect to the new article's page must not ask "leave without saving?".
        markSaved()
        const newId = res.id
        if (autoTranslateLangs.value.length > 0 && newId) {
          try {
            for (const langCode of autoTranslateLangs.value) {
              await adminFetch<ArticleTranslateResponse>(`/api/admin/articles/${newId}/translations/translate`, { method: 'POST', body: { langCode } })
            }
            toast.success(`Đã kích hoạt dịch tự động sang ${autoTranslateLangs.value.length} ngôn ngữ trong nền!`)
          } catch { /* Non-blocking */ }
        }
        navigateTo(`/admin/content/articles/${newId}`)
      }
    } else {
      // Máy chủ chỉ trả `{ ok: true }` — từ chối là ném lỗi, nên không còn nhánh `ok` để kiểm.
      await adminFetch<ArticleUpdateResponse>(`/api/admin/articles/${articleId.value}`, { method: 'PUT', body: form })
      toast.success('Đã cập nhật bài viết thành công!')
      markSaved()
      checkAndPromptReTranslation()
    }
  } catch (err: unknown) {
    saveError.value = errorMessage(err, 'Lỗi lưu bài viết')
    toast.error(saveError.value)
  } finally {
    saving.value = false
  }
}

const { openPicker } = useImagePicker()
const { uploading: uploadingThumb, uploadFile } = useUpload()

const insertMediaIntoEditor = (media: MediaItem) => {
  const imgHtml = `<p><img src="${media.url}" alt="${media.originalName}" /></p>`
  if ((window as WindowWithTinyMce).tinymce) {
    const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
    if (ed) { ed.insertContent(imgHtml); return }
  }
  form.content += '\n' + imgHtml
}

const openMediaPicker = (target: 'thumbnail' | 'content') => {
  if (target === 'thumbnail') {
    openPicker({ onSelect: (media) => { form.thumbnailUrl = media.url } })
  } else {
    // Multiple-select: chọn nhiều ảnh cùng lúc rồi chèn hết vào editor theo thứ tự.
    openPicker({
      multiple: true,
      onSelectMultiple: (items) => {
        for (const media of items) insertMediaIntoEditor(media)
      },
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
  const win = window as WindowWithTinyMce
  if (!win.tinymce) return
  // Lấy một lần rồi dùng: gọi `.get()` hai lần thì lời gọi thứ hai có thể trả
    // `undefined` khi trình soạn thảo bị gỡ giữa hai lần — và `.remove()` trên
    // undefined là một lỗi lúc chạy ngay giữa lượt điều hướng.
    win.tinymce?.get(TINYMCE_EDITOR_ID)?.remove()
  win.tinymce.init({
    selector: `#${TINYMCE_EDITOR_ID}`,
    height: 700,
    menubar: true,
    promotion: false,
    branding: false,
    skin: 'oxide',
    content_css: 'default',
    relative_urls: false,
    remove_script_host: false,
    convert_urls: true,
    plugins: [
      'advlist', 'autolink', 'lists', 'link', 'image', 'charmap',
      'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
      'insertdatetime', 'media', 'table', 'wordcount', 'quickbars'
    ],
    toolbar: 'undo redo | blocks | ' +
      'bold italic underline strikethrough | forecolor backcolor | ' +
      'alignleft aligncenter alignright alignjustify | ' +
      'bullist numlist outdent indent | ' +
      'link image media | ' +
      'table | removeformat | fullscreen code',
    toolbar_mode: 'sliding',
    quickbars_selection_toolbar: 'bold italic | quicklink h2 h3 blockquote',
    quickbars_insert_toolbar: 'quickimage quicktable',
    contextmenu: 'link image table',
    image_advtab: true,
    image_caption: true,
    automatic_uploads: true,
    paste_data_images: true,
    paste_merge_formats: true,
    file_picker_types: 'image',
    images_upload_handler: (blobInfo: { blob: () => Blob, filename: () => string }) => new Promise<string>((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', blobInfo.blob(), blobInfo.filename())
      void adminFetch<AdminMediaUploadResult>(`/api/admin/media/upload`, { method: 'POST', body: formData })
        .then((res) => {
          if (res.ok && res.media?.url) resolve(res.media.url)
          else reject('Upload thất bại')
        })
        .catch((err) => reject(errorMessage(err, 'Upload thất bại')))
    }),
    setup: (editor: {
        on: (event: string, handler: () => void) => void
        setContent: (html: string) => void
        getContent: () => string
      }) => {
      editor.on('init', () => {
        tinymceReady.value = true
        if (form.content) editor.setContent(form.content)
        // Body baseline as the editor serialises the loaded content.
        if (savedContent.value === null) savedContent.value = editor.getContent()
      })
      editor.on('change', () => { form.content = editor.getContent() })
    },
    content_style: `
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; padding: 12px; color: #1a1a1a; }
      img { max-width: 100%; height: auto; border-radius: 8px; }
      iframe, video { max-width: 100%; height: auto; }
      pre[class*="language-"] { background: #2d2d2d; border-radius: 6px; padding: 1em; overflow-x: auto; }
      code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: 'Fira Code', monospace; }
      blockquote { border-left: 4px solid #2c6e33; margin: 1em 0; padding-left: 1em; color: #555; }
      table { border-collapse: collapse; width: 100%; }
      table td, table th { border: 1px solid #ddd; padding: 8px; }
    `
  })
}

const loadTinyMCEScript = () => new Promise<void>((resolve) => {
  if ((window as WindowWithTinyMce).tinymce) { resolve(); return }
  // Self-host only — TinyMCE đã có đủ 28 file trong public/assets/tinymce/.
  // Không fallback ra cdnjs.cloudflare.com: cổng Bộ Công an không nên tải JS
  // từ bên thứ ba, và file local luôn có (đã commit vào repo).
  const script = document.createElement('script')
  script.src = '/assets/tinymce/tinymce.min.js'
  script.onload = () => resolve()
  script.onerror = () => {
    console.error('TinyMCE local assets missing — chạy npm run build lại, hoặc kiểm public/assets/tinymce/')
    resolve()
  }
  document.head.appendChild(script)
})

onMounted(async () => {
  // The script download runs alongside the data fetch, but initTinyMCE must
  // come last: it attaches to #tinymce-content-editor, which only exists once
  // the loading placeholder has been replaced by the real editor grid.
  const scriptReady = loadTinyMCEScript()
  await fetchCategories(form.type)
  // Fetch content-types in parallel — non-blocking, the select just renders
  // empty until it lands (typical admin pattern, no SSR here).
  void fetchContentTypes()
  // Article translations fetch + poll đã chuyển vào ArticleTranslationPanel
  // (con tự onMounted/onUnmounted) — cha chỉ fetch bài viết gốc.
  await fetchArticle()
  // Field baseline once the article (or a new article's defaults and first
  // category) is in place; the body baseline is taken in the editor's `init`.
  markSaved()
  await scriptReady
  await nextTick()
  initTinyMCE()
})

const { confirm } = useConfirm()
onBeforeRouteLeave(async () => {
  if (!hasUnsavedChanges()) return true
  return await confirm({
    title: 'Rời trang?',
    message: 'Bài viết có thay đổi chưa lưu. Rời trang bây giờ sẽ mất các thay đổi này.',
    confirmLabel: 'Rời trang',
    cancelLabel: 'Ở lại',
    danger: true,
  })
})

// Closing the tab or reloading: browsers show their own generic prompt.
function warnBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasUnsavedChanges()) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))

onUnmounted(() => {
  window.removeEventListener('beforeunload', warnBeforeUnload)
  if ((window as WindowWithTinyMce).tinymce) {
    const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
    if (ed) ed.destroy()
  }
})
// (Article translations state + fetch/poll/trigger/edit/delete đã chuyển vào
// `components/admin/articles/ArticleTranslationPanel.vue` — con tự fetch +
// lifecycle. Cha giữ re-translate modal + auto-translate menu vì chúng phụ thuộc
// form state sống ở cha. `translationPanelRef` khai báo ở trên cùng script.)
</script>
<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-brand-950 m-0">
          {{ isNew ? '✍️ Viết Bài Mới' : '✏️ Chỉnh Sửa Bài Viết' }}
        </h1>
        <p class="text-[0.85rem] text-ink-muted mt-1 mb-0">Soạn thảo nội dung tin tức, bài viết bài bản với thư viện ảnh tích hợp</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <!-- Khi tạo mới (isNew): Tích chọn những ngôn ngữ muốn tự động dịch qua -->
        <div v-if="isNew" class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-bold cursor-pointer transition-colors"
            :class="autoTranslateLangs.length > 0
              ? 'border-brand-700 bg-surface-tint text-brand-900'
              : 'border-line-strong bg-white text-ink-muted hover:bg-surface'"
            @click="showAutoTranslateMenu = !showAutoTranslateMenu"
          >
            <i class="fa-solid fa-language text-sm"></i>
            <span>{{ autoTranslateLangs.length > 0 ? `Tự động dịch (${autoTranslateLangs.length})` : 'Tự động dịch...' }}</span>
            <i class="fa-solid fa-chevron-down text-[0.6rem]"></i>
          </button>

          <!-- Popover chọn ngôn ngữ -->
          <div
            v-if="showAutoTranslateMenu"
            class="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-white border border-line-strong shadow-xl p-3 z-30 flex flex-col gap-2"
          >
            <div class="flex items-center justify-between border-b border-line pb-1.5 text-xs">
              <span class="font-bold text-brand-950">Chọn ngôn ngữ dịch tự động:</span>
              <button
                type="button"
                class="text-[0.68rem] text-brand-700 hover:underline bg-transparent border-0 cursor-pointer p-0"
                @click="autoTranslateLangs = autoTranslateLangs.length === availableLanguages.length ? [] : availableLanguages.map(l => l.code)"
              >
                {{ autoTranslateLangs.length === availableLanguages.length ? 'Bỏ chọn' : 'Tất cả' }}
              </button>
            </div>
            <div class="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              <label
                v-for="l in availableLanguages"
                :key="l.code"
                class="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-tint cursor-pointer text-xs font-semibold text-brand-950"
              >
                <input
                  type="checkbox"
                  :value="l.code"
                  v-model="autoTranslateLangs"
                  class="h-3.5 w-3.5 accent-brand-700 rounded"
                />
                <span>{{ l.flag }}</span>
                <span>{{ l.label }}</span>
              </label>
            </div>
            <p class="m-0 text-[0.68rem] text-ink-muted border-t border-line pt-1.5">
              Sau khi lưu bài gốc, hệ thống sẽ tự động kích hoạt dịch sang các ngôn ngữ đã chọn trong nền.
            </p>
          </div>
        </div>

        <!-- Khi chỉnh sửa (!isNew): Nút xem nhanh bản dịch -->
        <button
          v-else
          type="button"
          class="inline-flex items-center gap-1.5 bg-white border border-line-strong text-brand-900 hover:bg-surface-tint px-3.5 py-2.5 rounded-lg text-sm font-bold cursor-pointer transition-colors"
          @click="scrollToTranslations"
        >
          <i class="fa-solid fa-language text-sm"></i>
          <span>Bản dịch ({{ availableLanguages.length }} ngôn ngữ)</span>
        </button>
        <nuxt-link
          to="/admin/content/articles"
          class="inline-flex items-center bg-white border border-line-strong text-ink-muted no-underline px-4 py-2.5 rounded-lg font-semibold hover:bg-surface transition-colors"
        >Hủy & Quay lại</nuxt-link>
        <button
          class="inline-flex items-center gap-2 bg-brand-900 hover:bg-brand-700 text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer transition-colors border-0 disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="saving || !!errorMsg"
          @click="handleSave"
        >
          <i class="fa-solid fa-floppy-disk"></i>
          {{ saving ? 'Đang lưu...' : (isNew ? 'Đăng Bài Mới' : 'Cập Nhật Bài Viết') }}
        </button>
      </div>
    </div>

    <div v-if="errorMsg || saveError" role="alert" class="bg-danger-bg text-danger px-4 py-2.5 rounded-lg text-[0.85rem] flex items-center justify-between gap-3">
      <span>{{ errorMsg || saveError }}</span>
      <button v-if="errorMsg && !loading && !saving" type="button" class="shrink-0 text-sm font-bold underline text-danger bg-transparent border-0 cursor-pointer p-0 hover:no-underline whitespace-nowrap" @click="fetchArticle">Thử lại</button>
    </div>

    <!-- Loading — shaped like the editor grid below, which is `v-else`, so the
         real grid does not exist in the DOM while this is showing. That is safe
         only because of the ordering in onMounted: initTinyMCE() runs after
         `await fetchArticle()` and a nextTick(), i.e. after the flag has flipped
         and #tinymce-content-editor has actually been rendered. Moving
         initTinyMCE() ahead of the fetch would attach the editor to an element
         that is about to be unmounted. -->
    <div v-if="loading" class="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5" role="status" aria-busy="true">
      <span class="sr-only">Đang tải nội dung bài viết</span>
      <div class="bg-white rounded-xl border border-line p-6 flex flex-col gap-5" aria-hidden="true">
        <div class="flex flex-col gap-1.5">
          <div class="h-3 w-40 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
          <div class="h-[50px] w-full rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="h-3 w-48 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
          <div class="h-20 w-full rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
        </div>
        <div class="flex flex-col gap-2">
          <div class="h-3 w-56 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
          <div class="min-h-[700px] w-full rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
        </div>
      </div>
      <div class="bg-white rounded-xl border border-line p-6 flex flex-col gap-4 self-start" aria-hidden="true">
        <div class="h-4 w-40 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
        <div v-for="n in 3" :key="'sf-' + n" class="flex flex-col gap-1.5">
          <div class="h-3 w-28 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
          <div class="h-10 w-full rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
        </div>
        <div class="flex flex-col gap-2">
          <div class="h-3 w-36 rounded bg-line animate-pulse motion-reduce:animate-none"></div>
          <div class="h-40 w-full rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
          <div class="h-10 w-full rounded-lg bg-surface-tint animate-pulse motion-reduce:animate-none"></div>
          <div class="h-10 w-full rounded-lg bg-line animate-pulse motion-reduce:animate-none"></div>
        </div>
      </div>
    </div>

    <!-- Two-column editor grid -->
    <div v-else class="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">
      <!-- Main Form -->
      <div class="bg-white rounded-xl border border-line p-6 flex flex-col gap-5">
        <!-- AI Editorial Toolbar (gợi ý tiêu đề / tóm tắt / soát lỗi) — tách vào
             ArticleAIPanel.vue. Con truyền kết quả về qua update:title/excerpt. -->
        <ArticleAIPanel
          :form-title="form.title"
          :get-editor-content="getEditorContent"
          :set-editor-content="setEditorContent"
          @update:title="form.title = $event"
          @update:excerpt="form.excerpt = $event"
        />
        <div class="flex flex-col gap-1.5">
          <label class="text-[0.84rem] font-bold text-ink-admin">Tiêu đề bài viết (*)</label>
          <input
            type="text"
            v-model="form.title"
            placeholder="Nhập tiêu đề hấp dẫn..."
            class="w-full px-3.5 py-3 border border-line-strong rounded-lg text-[1.1rem] font-bold outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[0.84rem] font-bold text-ink-admin">Tóm tắt bài viết (Excerpt)</label>
          <textarea
            v-model="form.excerpt"
            rows="3"
            placeholder="Nhập đoạn tóm tắt ngắn hiển thị ở trang danh sách..."
            class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15 box-border resize-none font-[inherit]"
          ></textarea>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <label class="text-[0.84rem] font-bold text-ink-admin">Nội dung chi tiết (HTML / Editor)</label>
            <button
              class="inline-flex items-center gap-1.5 bg-surface-tint text-brand-700 border border-brand-300 px-2.5 py-1.5 rounded-md text-[0.78rem] font-bold cursor-pointer hover:bg-[#e4f2e5] transition-colors"
              @click="openMediaPicker('content')"
            >
              <i class="fa-regular fa-images"></i> Chèn Ảnh Từ Thư Viện
            </button>
          </div>
          <div :id="TINYMCE_EDITOR_ID" class="min-h-[700px]"></div>
        </div>
      </div>

      <!-- Meta Sidebar -->
      <div class="bg-white rounded-xl border border-line p-6 flex flex-col gap-4 self-start">
        <h3 class="text-[1rem] font-bold text-brand-950 m-0">Cấu hình xuất bản</h3>

        <div class="flex flex-col gap-1.5">
          <label class="text-[0.82rem] font-bold text-ink-admin">Thể loại bài viết (*)</label>
          <select v-model="form.type" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 box-border">
            <option v-for="ct in contentTypes" :key="ct.id" :value="ct.slug">
              {{ ct.icon ? ct.icon.replace('fa-solid ', '').replace('fa-regular ', '') : '' }} {{ ct.name }}
            </option>
          </select>
        </div>

        <!-- Dynamic category select — populated from DB by type -->
        <div v-if="availableCategories.length > 0" class="flex flex-col gap-1.5">
          <label class="text-[0.82rem] font-bold text-ink-admin">
            Danh mục
            <span class="font-normal text-ink-muted">— tùy chọn</span>
          </label>
          <select v-model="form.categoryId" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 box-border">
            <option :value="null">— Không có danh mục —</option>
            <template v-for="cat in availableCategories" :key="cat.id">
              <option v-if="!cat.parentId" :value="cat.id" class="font-bold">{{ cat.name }}</option>
              <option v-else :value="cat.id">&nbsp;&nbsp;↳ {{ cat.name }}</option>
            </template>
          </select>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[0.82rem] font-bold text-ink-admin">Trạng thái (*)</label>
          <select v-model="form.status" class="w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 box-border">
            <option value="published">🟢 Xuất Bản Ngay</option>
            <option value="draft">🟡 Bản Nháp (Draft)</option>
            <option value="archived">⚪ Lưu Trữ</option>
          </select>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-[0.82rem] font-bold text-ink-admin">Ảnh đại diện (Thumbnail)</label>
          <div v-if="form.thumbnailUrl" class="relative w-full h-40 rounded-lg overflow-hidden border border-line">
            <img :src="form.thumbnailUrl" class="w-full h-full object-cover" />
            <button type="button" aria-label="Xóa ảnh đại diện" class="absolute top-2 right-2 bg-black/70 text-white border-0 w-6 h-6 rounded-full cursor-pointer flex items-center justify-center text-xs" @click="form.thumbnailUrl = ''">
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>
          <button
            class="w-full flex items-center justify-center gap-2 bg-surface-tint border border-brand-300 text-brand-700 px-3 py-2.5 rounded-lg font-bold cursor-pointer text-sm hover:bg-[#e4f2e5] transition-colors"
            @click="openMediaPicker('thumbnail')"
          >
            <i class="fa-regular fa-images"></i> {{ form.thumbnailUrl ? 'Đổi từ thư viện' : 'Chọn từ thư viện' }}
          </button>
          <label
            class="w-full flex items-center justify-center gap-2 bg-brand-900 hover:bg-brand-700 text-white px-3 py-2.5 rounded-lg font-bold cursor-pointer text-sm transition-colors"
            :class="{ 'opacity-60 cursor-not-allowed pointer-events-none': uploadingThumb }"
          >
            <i class="fa-regular" :class="uploadingThumb ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i>
            {{ uploadingThumb ? 'Đang tải...' : 'Upload ảnh' }}
            <input type="file" accept="image/*" class="sr-only" :disabled="uploadingThumb" @change="uploadThumbnailFromInput" />
          </label>
        </div>
      </div>
    </div>

    <!-- Quản lý Bản dịch Đa ngôn ngữ — tách vào ArticleTranslationPanel.vue.
         Con tự fetch `/api/admin/articles/:id/translations` + poll tiến trình,
         giữ state `articleTranslations` / `availableLanguages` / editing drawer.
         Cha giữ `translationPanelRef` để: (1) đọc `availableLanguages` cho
         header badge + re-translate modal + auto-translate menu (new article),
         (2) gọi `translateAllForThisArticle(targetStatus)` cho re-translate modal.
         LUÔN mount (kể cả khi isNew) — con có `v-if="!isNew"` trên root div nên
         không render panel khi tạo bài mới, nhưng `onMounted(fetchDbLanguages)`
         vẫn chạy → `availableLanguages` có giá trị cho auto-translate menu. -->
    <ArticleTranslationPanel
      ref="translationPanelRef"
      :article-id="articleId"
      :is-new="isNew"
      :form-title="form.title"
    />

    <!-- Modal: Nhắc nhở cập nhật bản dịch khi nội dung Tiếng Việt thay đổi -->
    <AdminModal
      :open="showReTranslateModal"
      title="Phát hiện nội dung Tiếng Việt vừa thay đổi!"
      icon="fa-solid fa-lightbulb"
      :busy="reTranslateRunning"
      @close="showReTranslateModal = false"
    >
      <div class="flex flex-col gap-4">
        <p class="m-0 text-xs text-ink-muted">
          Bài viết gốc Tiếng Việt vừa được cập nhật nội dung mới. Bạn có muốn AI tự động cập nhật và dịch lại toàn bộ các ngôn ngữ quốc tế khác không?
        </p>

        <!-- Target languages preview -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-brand-950">Các ngôn ngữ sẽ được đồng bộ hóa lại:</label>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="l in availableLanguages"
              :key="l.code"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-tint border border-[#c8dcc9] text-xs font-bold text-brand-900"
            >
              <span>{{ l.flag }}</span>
              <span>{{ l.label }}</span>
            </span>
          </div>
        </div>

        <!-- Publish Option -->
        <label class="flex items-center gap-2.5 p-3 rounded-xl bg-surface border border-surface-tint cursor-pointer text-xs text-ink">
          <input
            type="checkbox"
            v-model="reTranslatePublishImmediately"
            class="h-4 w-4 accent-brand-700 rounded"
          />
          <div class="flex flex-col">
            <span class="font-bold">Tự động xuất bản luôn các bản dịch mới</span>
            <span class="text-[0.68rem] text-ink-muted">Nếu không chọn, bản dịch sẽ lưu ở dạng Bản nháp AI để rà soát trước.</span>
          </div>
        </label>

      </div>
      <template #footer>
          <button
            type="button"
            class="px-4 py-2.5 rounded-xl border border-line-strong bg-white text-xs font-semibold text-ink-muted hover:bg-gray-50 cursor-pointer"
            @click="showReTranslateModal = false"
          >
            Để sau / Giữ bản dịch hiện tại
          </button>
          <button
            type="button"
            class="px-5 py-2.5 rounded-xl bg-brand-900 hover:bg-[#153317] text-white text-xs font-extrabold cursor-pointer border-none flex items-center gap-2 shadow-sm transition-all hover:-translate-y-0.5 disabled:opacity-50"
            :disabled="reTranslateRunning"
            @click="confirmReTranslation"
          >
            <i class="fa-solid fa-wand-magic-sparkles text-xs" :class="reTranslateRunning ? 'animate-spin' : ''" aria-hidden="true"></i>
            <span>{{ reTranslateRunning ? 'Đang kích hoạt...' : '⚡ Dịch lại tất cả ngay' }}</span>
          </button>
      </template>
    </AdminModal>
  </div>
</template>
