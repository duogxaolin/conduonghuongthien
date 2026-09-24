<script setup lang="ts">
import type { WindowWithTinyMce } from '~/types/tinymce'
import type { AdminCategoryRow } from '~/types/admin-api'
import type { MediaItem } from '~/types/media'
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

const aiLoading = ref(false)
const aiLoadingText = ref('')
const showTranslateMenu = ref(false)
const suggestedTitles = ref<string[]>([])
interface PolishChangeItem {
  original: string
  suggested: string
  reason: string
  applied?: boolean
}

const suggestedSummaries = ref<string[]>([])
const polishedPreview = ref<{
  content: string
  summaryNotes?: string
  changes: PolishChangeItem[]
} | null>(null)
const translatedPreview = ref<{ title?: string; excerpt?: string; content?: string; langName: string } | null>(null)

const SUPPORTED_TRANSLATE_LANGUAGES = [
  { code: 'en', label: 'Tiếng Anh (English)', flag: '🇬🇧' },
  { code: 'zh', label: 'Tiếng Trung (中文)', flag: '🇨🇳' },
  { code: 'fr', label: 'Tiếng Pháp (Français)', flag: '🇫🇷' },
  { code: 'ru', label: 'Tiếng Nga (Русский)', flag: '🇷🇺' },
  { code: 'ja', label: 'Tiếng Nhật (日本語)', flag: '🇯🇵' },
  { code: 'ko', label: 'Tiếng Hàn (한국어)', flag: '🇰🇷' },
  { code: 'lo', label: 'Tiếng Lào', flag: '🇱🇦' },
  { code: 'km', label: 'Tiếng Campuchia', flag: '🇰🇭' },
]


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

function applyTitle(title: string) {
  form.title = title
  suggestedTitles.value = []
  toast.success('Đã áp dụng tiêu đề!')
}

function applySummary(summary: string) {
  // Clean any "Phương án 1:" prefix if present
  const cleanSummary = summary.replace(/^Phương án\s*\d+[^:]*:\s*/i, '').replace(/^Option\s*\d+[^:]*:\s*/i, '').trim()
  form.excerpt = cleanSummary
  suggestedSummaries.value = []
  toast.success('Đã áp dụng tóm tắt bài viết!')
}

function applySingleChange(change: PolishChangeItem) {
  const current = getEditorContent()
  if (!change.original) return
  if (!current.includes(change.original)) {
    const plainOrig = change.original.replace(/<[^>]*>/g, '').trim()
    if (!current.includes(plainOrig)) {
      toast.error(`Không tìm thấy đoạn "${change.original.slice(0, 35)}..." trong bài viết hiện tại.`)
      return
    }
    const cleanSug = change.suggested.replace(/<[^>]*>/g, '').trim()
    setEditorContent(current.replace(plainOrig, cleanSug))
  } else {
    setEditorContent(current.replace(change.original, change.suggested))
  }
  change.applied = true
  toast.success(`Đã sửa: "${change.suggested.slice(0, 30)}..."`)
}

function applyAllPolishedChanges() {
  if (!polishedPreview.value) return
  if (polishedPreview.value.content) {
    setEditorContent(polishedPreview.value.content)
  } else {
    let html = getEditorContent()
    for (const c of polishedPreview.value.changes) {
      if (html.includes(c.original)) {
        html = html.replace(c.original, c.suggested)
        c.applied = true
      }
    }
    setEditorContent(html)
  }
  if (polishedPreview.value.changes) {
    polishedPreview.value.changes.forEach(c => { c.applied = true })
  }
  toast.success('Đã áp dụng toàn bộ sửa đổi vào bài viết!')
}

// (applyTranslation removed — translations are managed independently in article_translations)

async function callAiEditorial(action: 'summary' | 'suggest_titles' | 'polish') {
  const content = getEditorContent()
  if (!content && !form.title) {
    toast.error('Vui lòng nhập tiêu đề hoặc nội dung bài viết trước khi dùng Trợ lý AI.')
    return
  }

  aiLoading.value = true
  if (action === 'summary') aiLoadingText.value = 'Trợ lý AI đang đề xuất các phương án tóm tắt...'
  else if (action === 'suggest_titles') aiLoadingText.value = 'Trợ lý AI đang sáng tạo các tiêu đề hay...'
  else aiLoadingText.value = 'Trợ lý AI đang rà soát chính tả và văn phong...'

  try {
    const res = await $fetch<{
      ok: boolean
      action: string
      options?: string[]
      titles?: string[]
      polishedContent?: string
      notes?: string[]
      rawText?: string
    }>('/api/admin/ai/editorial', {
      method: 'POST',
      body: { action, title: form.title, content },
    })

    if (action === 'summary') {
      suggestedSummaries.value = res.options && res.options.length > 0 ? res.options : [res.rawText || '']
      toast.success('Đã có đề xuất tóm tắt, mời bạn xem và chọn bên dưới!')
    } else if (action === 'suggest_titles') {
      suggestedTitles.value = res.titles && res.titles.length > 0 ? res.titles : (res.rawText || '').split('\n').filter(Boolean)
      toast.success('Đã có đề xuất tiêu đề, mời bạn bấm chọn bên dưới!')
    } else if (action === 'polish') {
      polishedPreview.value = {
        content: res.polishedContent || res.rawText || '',
        summaryNotes: (res as { summaryNotes?: string }).summaryNotes || (res.notes?.join(' • ')) || 'Đã rà soát chính tả, ngữ pháp và thuật ngữ pháp lý.',
        changes: Array.isArray((res as { changes?: PolishChangeItem[] }).changes)
          ? (res as { changes: PolishChangeItem[] }).changes.map(c => ({ ...c, applied: false }))
          : [],
      }
      toast.success('Đã rà soát xong, mời bạn xem các điểm sửa đổi bên dưới!')
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi khi gọi Trợ lý AI.'))
  } finally {
    aiLoading.value = false
  }
}

async function translateArticleTo(targetLang: string) {
  showTranslateMenu.value = false
  await triggerTranslation(targetLang)
}
// Dynamic categories for the selected article type
const availableCategories = ref<AdminCategoryRow[]>([])

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
      if (tinymceReady.value && (window as WindowWithTinyMce).tinymce) {
        const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
        if (ed) ed.setContent(form.content)
      }
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
  } catch (err: unknown) {
    errorMsg.value = errorMessage(err, 'Lỗi lưu bài viết')
    toast.error(errorMsg.value)
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
    images_upload_handler: (blobInfo: { blob: () => Blob, filename: () => string }) => new Promise<string>((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', blobInfo.blob(), blobInfo.filename())
      $fetch('/api/admin/media/upload', { method: 'POST', body: formData })
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
  if ((window as WindowWithTinyMce).tinymce) { resolve(); return }
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
  await fetchArticleTranslations()
  await scriptReady
  await nextTick()
  initTinyMCE()
})

onUnmounted(() => {
  if ((window as WindowWithTinyMce).tinymce) {
    const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
    if (ed) ed.destroy()
  }
})

// ─── Article translations ────────────────────────────────────────────────
const articleTranslations = ref<Array<{
  id: number; langCode: string; status: string; title: string | null
  progress: number; currentChunk: number; totalChunks: number
  errorMessage: string | null; translatedBy: string; completedAt: string | null
}>>([])
const showTranslationsPanel = ref(true)
const translatingLang = ref<string | null>(null)
const translationProgress = ref(0)
const editingTranslation = ref<{ lang: string; title: string; excerpt: string; content: string } | null>(null)
const showEditTranslationDrawer = ref(false)
let translationPollTimer: number | undefined

const TRANSLATION_LANGS = [
  { code: 'en', label: 'Tiếng Anh', flag: '🇬🇧' },
  { code: 'zh', label: 'Tiếng Trung', flag: '🇨🇳' },
  { code: 'fr', label: 'Tiếng Pháp', flag: '🇫🇷' },
  { code: 'ru', label: 'Tiếng Nga', flag: '🇷🇺' },
  { code: 'ja', label: 'Tiếng Nhật', flag: '🇯🇵' },
  { code: 'ko', label: 'Tiếng Hàn', flag: '🇰🇷' },
  { code: 'lo', label: 'Tiếng Lào', flag: '🇱🇦' },
  { code: 'km', label: 'Tiếng Campuchia', flag: '🇰🇭' },
]

async function fetchArticleTranslations() {
  if (isNew.value || !articleId.value) return
  try {
    const res = await $fetch<{ ok: boolean; items: typeof articleTranslations.value }>(
      `/api/admin/articles/${articleId.value}/translations`,
    )
    if (res.ok) articleTranslations.value = res.items
  } catch {
    // Non-critical
  }
}

async function triggerTranslation(langCode: string) {
  if (isNew.value) {
    toast.error('Vui lòng lưu bài viết trước khi dịch.')
    return
  }
  translatingLang.value = langCode
  translationProgress.value = 0
  try {
    await $fetch(`/api/admin/articles/${articleId.value}/translations/translate`, {
      method: 'POST',
      body: { langCode },
    })
    toast.success(`Đã bắt đầu dịch sang ${TRANSLATION_LANGS.find(l => l.code === langCode)?.label ?? langCode}.`)
    await fetchArticleTranslations()
    startTranslationPolling()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể bắt đầu dịch.'))
    translatingLang.value = null
  }
}

function startTranslationPolling() {
  if (translationPollTimer) window.clearInterval(translationPollTimer)
  translationPollTimer = window.setInterval(async () => {
    if (!translatingLang.value) return
    try {
      const res = await $fetch<{
        ok: boolean; status: string; progress: number
        currentChunk: number; totalChunks: number; errorMessage: string | null
      }>(`/api/admin/articles/${articleId.value}/translations/${translatingLang.value}/progress`)
      if (res.ok) {
        translationProgress.value = res.progress
        if (res.status !== 'translating') {
          stopTranslationPolling()
          translatingLang.value = null
          await fetchArticleTranslations()
          if (res.status === 'ai_draft') {
            toast.success('Dịch xong! Vui lòng duyệt trước khi xuất bản.')
          } else if (res.status === 'failed') {
            toast.error(`Lỗi dịch: ${res.errorMessage ?? 'không xác định'}`)
          }
        }
      }
    } catch {
      // Non-critical poll failure
    }
  }, 2000)
}

function stopTranslationPolling() {
  if (translationPollTimer) {
    window.clearInterval(translationPollTimer)
    translationPollTimer = undefined
  }
}

function openEditTranslation(row: typeof articleTranslations.value[0]) {
  editingTranslation.value = {
    lang: row.langCode,
    title: row.title ?? '',
    excerpt: (row as unknown as { excerpt?: string }).excerpt ?? '',
    content: (row as unknown as { content?: string }).content ?? '',
  }
  showEditTranslationDrawer.value = true
}

async function saveTranslationEdit() {
  if (!editingTranslation.value) return
  try {
    await $fetch(
      `/api/admin/articles/${articleId.value}/translations/${editingTranslation.value.lang}`,
      { method: 'PUT', body: editingTranslation.value },
    )
    toast.success('Đã lưu bản dịch.')
    showEditTranslationDrawer.value = false
    editingTranslation.value = null
    await fetchArticleTranslations()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể lưu bản dịch.'))
  }
}

async function toggleTranslationStatus(row: typeof articleTranslations.value[0]) {
  const newStatus = row.status === 'published' ? 'reviewed' : 'published'
  try {
    await $fetch(
      `/api/admin/articles/${articleId.value}/translations/${row.langCode}/status`,
      { method: 'PATCH', body: { status: newStatus } },
    )
    toast.success(newStatus === 'published' ? 'Đã xuất bản bản dịch.' : 'Đã bỏ xuất bản.')
    await fetchArticleTranslations()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể đổi trạng thái.'))
  }
}

async function deleteTranslation(row: typeof articleTranslations.value[0]) {
  if (!confirm(`Xoá bản dịch ${TRANSLATION_LANGS.find(l => l.code === row.langCode)?.label ?? row.langCode}?`)) return
  try {
    await $fetch(
      `/api/admin/articles/${articleId.value}/translations/${row.langCode}`,
      { method: 'DELETE' },
    )
    toast.success('Đã xoá bản dịch.')
    await fetchArticleTranslations()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá.'))
  }
}
function getTranslationRow(langCode: string): typeof articleTranslations.value[0] | undefined {
  return articleTranslations.value.find((t) => t.langCode === langCode)
}
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

    <div v-if="errorMsg" role="alert" class="bg-[#ffebe9] text-[#d12420] px-4 py-2.5 rounded-lg text-[0.85rem] flex items-center justify-between gap-3">
      <span>{{ errorMsg }}</span>
      <button v-if="!loading && !saving" type="button" class="shrink-0 text-sm font-bold underline text-[#d12420] bg-transparent border-0 cursor-pointer p-0 hover:no-underline whitespace-nowrap" @click="fetchArticle">Thử lại</button>
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
        <!-- AI Editorial & Translation Toolbar -->
        <div class="rounded-xl border border-[#c8dcc9] bg-[#f0f7f1] p-3.5 flex flex-col gap-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-md bg-[#1e4620] text-white flex items-center justify-center text-xs shadow-xs">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
              </span>
              <span class="text-xs font-bold text-[#1e4620] uppercase tracking-wide">Trợ lý AI Biên tập & Dịch thuật</span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                class="px-2.5 py-1 rounded-lg border border-[#a2cca4] bg-white text-xs font-semibold text-[#1e4620] hover:bg-[#e4ece4] transition-all flex items-center gap-1 shadow-2xs disabled:opacity-50 cursor-pointer"
                :disabled="aiLoading"
                @click="callAiEditorial('suggest_titles')"
              >
                <i class="fa-regular fa-lightbulb text-[0.7rem]"></i>
                Gợi ý tiêu đề
              </button>
              <button
                type="button"
                class="px-2.5 py-1 rounded-lg border border-[#a2cca4] bg-white text-xs font-semibold text-[#1e4620] hover:bg-[#e4ece4] transition-all flex items-center gap-1 shadow-2xs disabled:opacity-50 cursor-pointer"
                :disabled="aiLoading"
                @click="callAiEditorial('summary')"
              >
                <i class="fa-regular fa-file-lines text-[0.7rem]"></i>
                Tự động viết tóm tắt
              </button>
              <button
                type="button"
                class="px-2.5 py-1 rounded-lg border border-[#a2cca4] bg-white text-xs font-semibold text-[#1e4620] hover:bg-[#e4ece4] transition-all flex items-center gap-1 shadow-2xs disabled:opacity-50 cursor-pointer"
                :disabled="aiLoading"
                @click="callAiEditorial('polish')"
              >
                <i class="fa-solid fa-spell-check text-[0.7rem]"></i>
                Soát lỗi & Văn phong
              </button>
              <!-- Multi-language Translate Dropdown Button -->
              <div class="relative">
                <button
                  type="button"
                  class="px-2.5 py-1 rounded-lg border border-[#2c6e33] bg-[#1e4620] text-white text-xs font-bold hover:bg-[#153317] transition-all flex items-center gap-1 shadow-xs disabled:opacity-50 cursor-pointer"
                  :disabled="aiLoading"
                  @click="showTranslateMenu = !showTranslateMenu"
                >
                  <i class="fa-solid fa-language text-[0.75rem]"></i>
                  <span>Dịch bài viết</span>
                  <i class="fa-solid fa-chevron-down text-[0.55rem]"></i>
                </button>
                <div
                  v-if="showTranslateMenu"
                  class="absolute right-0 top-full mt-1 w-52 rounded-xl bg-white border border-[#c8d6c9] shadow-lg p-1.5 z-20 flex flex-col gap-0.5"
                >
                  <div class="px-2 py-1 text-[0.68rem] font-bold text-[#667768] uppercase">Chọn ngôn ngữ dịch</div>
                  <button
                    v-for="l in SUPPORTED_TRANSLATE_LANGUAGES"
                    :key="l.code"
                    type="button"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-[#f0f7f1] text-[#122815] transition-colors border-none bg-transparent cursor-pointer flex items-center gap-2"
                    @click="translateArticleTo(l.code)"
                  >
                    <span>{{ l.flag }}</span>
                    <span>{{ l.label }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Loading state -->
          <div v-if="aiLoading" class="flex items-center gap-2 py-1 text-xs text-[#2c6e33] font-semibold animate-pulse motion-reduce:animate-none">
            <i class="fa-solid fa-circle-notch fa-spin"></i>
            <span>{{ aiLoadingText }}</span>
          </div>

          <!-- Suggested Titles Drawer -->
          <div v-if="suggestedTitles.length > 0" class="rounded-lg bg-white border border-[#c8d6c9] p-3 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-[#1e4620]">💡 Đề xuất tiêu đề từ AI (Bấm vào tiêu đề để chọn):</span>
              <button type="button" class="text-xs text-[#667768] hover:text-[#d12420] border-none bg-transparent cursor-pointer" @click="suggestedTitles = []">Đóng</button>
            </div>
            <div class="flex flex-col gap-1.5">
              <button
                v-for="(t, idx) in suggestedTitles"
                :key="idx"
                type="button"
                class="w-full text-left p-2 rounded-lg border border-[#e2ece3] hover:border-[#2c6e33] hover:bg-[#f0f7f1] text-xs font-semibold text-[#122815] transition-colors cursor-pointer"
                @click="form.title = t; suggestedTitles = []"
              >
                {{ t }}
              </button>
            </div>
          </div>

          <!-- Suggested Summaries Drawer -->
          <div v-if="suggestedSummaries.length > 0" class="rounded-lg bg-white border border-[#c8d6c9] p-3.5 flex flex-col gap-2.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-[#1e4620]">📝 Đề xuất tóm tắt từ AI (Chọn phương án bạn ưng ý nhất):</span>
              <button type="button" class="text-xs text-[#667768] hover:text-[#d12420] border-none bg-transparent cursor-pointer" @click="suggestedSummaries = []">Đóng</button>
            </div>
            <div class="flex flex-col gap-2">
              <div
                v-for="(s, idx) in suggestedSummaries"
                :key="idx"
                class="p-3 rounded-lg border border-[#e2ece3] hover:border-[#2c6e33] bg-[#fcfdfc] hover:bg-[#f0f7f1] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <p class="m-0 text-xs text-[#2d3748] leading-relaxed flex-1">{{ s }}</p>
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-md bg-[#1e4620] hover:bg-[#153317] text-white text-xs font-bold shrink-0 transition-colors border-none cursor-pointer self-start sm:self-auto"
                  @click="applySummary(s)"
                >
                  <i class="fa-solid fa-check mr-1"></i> Áp dụng vào Tóm tắt
                </button>
              </div>
            </div>
          </div>

          <!-- Polished Content Preview Drawer -->
          <div v-if="polishedPreview" class="rounded-xl bg-white border border-[#c8d6c9] p-4 flex flex-col gap-3 shadow-md">
            <div class="flex items-center justify-between border-b border-[#e2ece3] pb-2.5">
              <div class="flex items-center gap-2">
                <span class="w-7 h-7 rounded-lg bg-[#f0f7f1] text-[#2c6e33] flex items-center justify-center text-xs">
                  <i class="fa-solid fa-spell-check"></i>
                </span>
                <span class="text-sm font-extrabold text-[#122815]">Kết quả rà soát &amp; đề xuất sửa lỗi:</span>
                <span v-if="polishedPreview.changes?.length" class="text-xs font-bold px-2 py-0.5 rounded-full bg-[#f0f7f1] text-[#2c6e33]">
                  {{ polishedPreview.changes.length }} điểm cần sửa
                </span>
              </div>
              <button type="button" class="text-xs text-[#667768] hover:text-[#d12420] border-none bg-transparent cursor-pointer p-1" @click="polishedPreview = null">
                <i class="fa-solid fa-xmark text-sm"></i>
              </button>
            </div>

            <!-- Summary note -->
            <div v-if="polishedPreview.summaryNotes" class="text-xs font-medium text-[#2c6e33] bg-[#f0f7f1] p-2.5 rounded-lg border border-[#c8d6c9] flex items-start gap-2">
              <i class="fa-solid fa-lightbulb text-sm mt-0.5 shrink-0 text-[#7CB342]"></i>
              <span>{{ polishedPreview.summaryNotes }}</span>
            </div>

            <!-- List of specific changes (Cái nào sai đổi thành cái nào) -->
            <div v-if="polishedPreview.changes && polishedPreview.changes.length > 0" class="flex flex-col gap-2.5 max-h-96 overflow-y-auto pr-1">
              <div
                v-for="(change, idx) in polishedPreview.changes"
                :key="idx"
                class="rounded-xl border p-3 flex flex-col gap-2 transition-all text-xs"
                :class="change.applied ? 'border-green-300 bg-green-50/50 opacity-75' : 'border-[#e2ece3] bg-white hover:border-[#2c6e33]/40 shadow-xs'"
              >
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <span class="font-bold text-[#667768] text-[0.72rem]">Lỗi #{{ idx + 1 }}: {{ change.reason || 'Chuẩn hóa câu từ' }}</span>
                  <span v-if="change.applied" class="text-[0.7rem] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <i class="fa-solid fa-check"></i> Đã áp dụng
                  </span>
                  <button
                    v-else
                    type="button"
                    class="px-2.5 py-1 rounded-md bg-[#2c6e33] hover:bg-[#1e4620] text-white text-[0.72rem] font-bold cursor-pointer border-none flex items-center gap-1 transition-all active:scale-95"
                    @click="applySingleChange(change)"
                  >
                    <i class="fa-solid fa-check"></i> Áp dụng sửa đổi này
                  </button>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <!-- Đoạn sai / cũ -->
                  <div class="p-2 rounded-lg bg-red-50 border border-red-200 text-red-900 flex flex-col gap-0.5">
                    <span class="text-[0.65rem] font-extrabold uppercase tracking-wide text-red-700 flex items-center gap-1">
                      <i class="fa-solid fa-xmark"></i> Đoạn văn bản gốc:
                    </span>
                    <span class="line-through decoration-red-400 font-medium break-words leading-relaxed">{{ change.original }}</span>
                  </div>

                  <!-- Đoạn sửa / mới -->
                  <div class="p-2 rounded-lg bg-green-50 border border-green-200 text-green-900 flex flex-col gap-0.5">
                    <span class="text-[0.65rem] font-extrabold uppercase tracking-wide text-green-700 flex items-center gap-1">
                      <i class="fa-solid fa-check"></i> Đề xuất chuẩn hóa:
                    </span>
                    <span class="font-bold break-words leading-relaxed">{{ change.suggested }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Nếu không có danh sách chi tiết mà chỉ có nội dung đã sửa -->
            <div v-else class="max-h-60 overflow-y-auto p-3 rounded-lg border border-[#e2ece3] bg-[#fcfdfc] text-xs leading-relaxed text-[#2d3748]">
              <div v-html="polishedPreview.content"></div>
            </div>

            <!-- Footer actions -->
            <div class="flex items-center justify-between pt-2 border-t border-[#e2ece3] flex-wrap gap-2">
              <button
                type="button"
                class="px-3 py-1.5 rounded-md border border-[#c8d6c9] bg-white text-xs font-semibold text-[#667768] hover:bg-[#f8faf8] cursor-pointer"
                @click="polishedPreview = null"
              >
                Đóng
              </button>
              <button
                type="button"
                class="px-4 py-2 rounded-lg bg-[#1e4620] hover:bg-[#153317] text-white text-xs font-bold cursor-pointer border-none flex items-center gap-2 shadow-xs transition-all active:scale-95"
                @click="applyAllPolishedChanges"
              >
                <i class="fa-solid fa-check-double"></i> Áp dụng tất cả sửa đổi vào bài viết
              </button>
            </div>
          </div>

        </div>
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

    <!-- Article Translations Section -->
    <div v-if="!isNew" id="article-translations-section" class="bg-white rounded-xl border border-[#e2ece3] p-6 flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h3 class="text-[1rem] font-bold text-[#122815] m-0 flex items-center gap-2">
          <i class="fa-solid fa-language text-[#2c6e33]"></i> Bản dịch bài viết
        </h3>
        <button
          class="text-xs font-semibold text-[#2c6e33] bg-transparent border-0 cursor-pointer hover:underline"
          @click="showTranslationsPanel = !showTranslationsPanel; if (showTranslationsPanel) fetchArticleTranslations()"
        >
          {{ showTranslationsPanel ? 'Ẩn' : 'Hiện' }}
        </button>
      </div>

      <div v-if="showTranslationsPanel" class="flex flex-col gap-3">
        <!-- Language list -->
        <div class="flex flex-wrap gap-2">
          <div
            v-for="lang in TRANSLATION_LANGS"
            :key="lang.code"
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm"
            :class="getTranslationRow(lang.code) ? 'border-[#c8d6c9] bg-[#f8faf7]' : 'border-[#e2ece3] bg-white'"
          >
            <span>{{ lang.flag }}</span>
            <span class="font-semibold text-[#122815]">{{ lang.label }}</span>

            <!-- Status badge -->
            <template v-if="getTranslationRow(lang.code)">
              <span v-if="getTranslationRow(lang.code)?.status === 'translating'" class="text-xs text-[#2c6e33] font-bold">
                {{ translationProgress }}% ({{ getTranslationRow(lang.code)?.currentChunk }}/{{ getTranslationRow(lang.code)?.totalChunks }})
              </span>
              <span v-else-if="getTranslationRow(lang.code)?.status === 'ai_draft'" class="text-xs font-bold text-[#b78103]">Bản nháp AI</span>
              <span v-else-if="getTranslationRow(lang.code)?.status === 'reviewed'" class="text-xs font-bold text-[#667768]">Đã duyệt</span>
              <span v-else-if="getTranslationRow(lang.code)?.status === 'published'" class="text-xs font-bold text-[#1e4620]">Đã xuất bản</span>
              <span v-else-if="getTranslationRow(lang.code)?.status === 'failed'" class="text-xs font-bold text-[#d12420]" :title="getTranslationRow(lang.code)?.errorMessage ?? ''">Lỗi</span>
            </template>

            <!-- Actions -->
            <template v-if="translatingLang === lang.code">
              <!-- Progress bar -->
              <div class="w-16 h-1.5 rounded-full bg-[#e2ece3] overflow-hidden">
                <div class="h-full bg-[#2c6e33] transition-all" :style="{ width: `${translationProgress}%` }"></div>
              </div>
            </template>
            <template v-else-if="!getTranslationRow(lang.code)">
              <button class="text-xs font-bold text-[#2c6e33] bg-[#e4f2e5] px-2 py-0.5 rounded border border-[#c8dcc9] cursor-pointer hover:bg-[#d4ebd6]" @click="triggerTranslation(lang.code)">Dịch</button>
            </template>
            <template v-else>
              <button class="text-xs font-semibold text-[#2c6e33] bg-transparent border-0 cursor-pointer hover:underline" @click="getTranslationRow(lang.code) && openEditTranslation(getTranslationRow(lang.code)!)">Sửa</button>
              <button
                class="text-xs font-semibold bg-transparent border-0 cursor-pointer hover:underline"
                :class="getTranslationRow(lang.code)?.status === 'published' ? 'text-[#d12420]' : 'text-[#1e4620]'"
                @click="getTranslationRow(lang.code) && toggleTranslationStatus(getTranslationRow(lang.code)!)"
              >
                {{ getTranslationRow(lang.code)?.status === 'published' ? 'Bỏ XB' : 'Xuất bản' }}
              </button>
              <button class="text-xs font-semibold text-[#d12420] bg-transparent border-0 cursor-pointer hover:underline" @click="getTranslationRow(lang.code) && deleteTranslation(getTranslationRow(lang.code)!)">Xoá</button>
            </template>
          </div>
        </div>

        <!-- Failed translation retry -->
        <div v-for="row in articleTranslations.filter(r => r.status === 'failed')" :key="row.id" class="text-xs text-[#d12420] flex items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation"></i>
          Lỗi dịch {{ TRANSLATION_LANGS.find(l => l.code === row.langCode)?.label ?? row.langCode }}: {{ row.errorMessage }}
          <button class="text-[#2c6e33] font-bold underline bg-transparent border-0 cursor-pointer p-0" @click="triggerTranslation(row.langCode)">Thử lại</button>
        </div>

        <!-- Edit Translation Drawer -->
        <div v-if="showEditTranslationDrawer && editingTranslation" class="bg-[#f8faf7] rounded-xl border border-[#e2ece3] p-4 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="text-sm font-bold text-[#122815]">Sửa bản dịch {{ TRANSLATION_LANGS.find(l => l.code === editingTranslation.lang)?.label ?? editingTranslation.lang }}</span>
            <button class="text-xs text-[#667768] hover:text-[#d12420] border-none bg-transparent cursor-pointer" @click="showEditTranslationDrawer = false; editingTranslation = null">Đóng</button>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tiêu đề dịch</label>
            <input v-model="editingTranslation.title" type="text" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tóm tắt dịch</label>
            <textarea v-model="editingTranslation.excerpt" rows="2" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] resize-none font-[inherit]"></textarea>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Nội dung dịch (HTML)</label>
            <textarea v-model="editingTranslation.content" rows="8" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] resize-y font-mono"></textarea>
          </div>
          <button class="self-end px-4 py-2 rounded-lg bg-[#1e4620] hover:bg-[#153317] text-white text-sm font-bold border-none cursor-pointer" @click="saveTranslationEdit">Lưu bản dịch</button>
        </div>
      </div>
    </div>
  </div>
</template>
