<script setup lang="ts">
import type { WindowWithTinyMce } from '~/types/tinymce'
import type { AdminCategoryRow } from '~/types/admin-api'
import type { MediaItem } from '~/types/media'
import TinyMceEditor from '~/components/admin/TinyMceEditor.vue'
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

const autoTranslateLangs = ref<string[]>(['en'])
const showAutoTranslateMenu = ref(false)
const translatingAll = ref(false)

function scrollToTranslations() {
  showTranslationsPanel.value = true
  nextTick(() => {
    document.getElementById('article-translations-section')?.scrollIntoView({ behavior: 'smooth' })
  })
}

async function translateAllForThisArticle() {
  if (isNew.value || !articleId.value) return
  translatingAll.value = true

  // Cập nhật lạc quan (Optimistic update): đánh dấu ngay các ngôn ngữ chưa có hoặc lỗi thành 'translating'
  for (const lang of availableLanguages.value) {
    const existing = articleTranslations.value.find(t => t.langCode === lang.code)
    if (!existing) {
      articleTranslations.value.push({
        id: 0,
        langCode: lang.code,
        status: 'translating',
        progress: 10,
        currentChunk: 0,
        totalChunks: 1,
        title: null,
        errorMessage: null,
        translatedBy: 'ai',
        completedAt: null,
      })
    } else if (existing.status === 'failed') {
      existing.status = 'translating'
      existing.progress = 10
      existing.errorMessage = null
    }
  }

  startTranslationPolling()

  try {
    const res = await $fetch<{ ok: boolean; queued: number; message: string }>(
      `/api/admin/articles/${articleId.value}/translations/translate-all`,
      { method: 'POST' },
    )
    toast.success(res.message || 'Đã xếp lịch dịch tất cả ngôn ngữ còn thiếu!')
    await fetchArticleTranslations()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể dịch tất cả ngôn ngữ.'))
    await fetchArticleTranslations()
  } finally {
    translatingAll.value = false
  }
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
      const res = await $fetch<{ ok: boolean; id: number }>('/api/admin/articles', { method: 'POST', body: form })
      if (res.ok) {
        toast.success('Tạo bài viết mới thành công!')
        const newId = res.id
        if (autoTranslateLangs.value.length > 0 && newId) {
          try {
            for (const langCode of autoTranslateLangs.value) {
              await $fetch(`/api/admin/articles/${newId}/translations/translate`, {
                method: 'POST',
                body: { langCode },
              })
            }
            toast.success(`Đã kích hoạt dịch tự động sang ${autoTranslateLangs.value.length} ngôn ngữ trong nền!`)
          } catch {
            // Non-blocking
          }
        }
        navigateTo(`/admin/content/articles/${newId}`)
      }
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
  await Promise.all([fetchArticle(), fetchArticleTranslations(), fetchDbLanguages()])
  if (articleTranslations.value.some((t) => t.status === 'translating')) {
    startTranslationPolling()
  }
  await scriptReady
  await nextTick()
  initTinyMCE()
})

onUnmounted(() => {
  stopTranslationPolling()
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

const LANG_TO_FLAG: Record<string, string> = {
  en: '🇬🇧', zh: '🇨🇳', fr: '🇫🇷', ru: '🇷🇺', ja: '🇯🇵',
  ko: '🇰🇷', lo: '🇱🇦', km: '🇰🇭', th: '🇹🇭', de: '🇩🇪',
  es: '🇪🇸', it: '🇮🇹', us: '🇺🇸', my: '🇲🇲', id: '🇮🇩',
  pt: '🇵🇹', ar: '🇸🇦',
}

function getFlagEmoji(code: string): string {
  if (!code) return '🌐'
  const c = code.toLowerCase()
  return LANG_TO_FLAG[c] || '🌐'
}

const DEFAULT_TRANSLATION_LANGS = [
  { code: 'en', label: 'Tiếng Anh', flag: '🇬🇧' },
  { code: 'zh', label: 'Tiếng Trung', flag: '🇨🇳' },
  { code: 'fr', label: 'Tiếng Pháp', flag: '🇫🇷' },
  { code: 'ru', label: 'Tiếng Nga', flag: '🇷🇺' },
  { code: 'ja', label: 'Tiếng Nhật', flag: '🇯🇵' },
  { code: 'ko', label: 'Tiếng Hàn', flag: '🇰🇷' },
  { code: 'lo', label: 'Tiếng Lào', flag: '🇱🇦' },
  { code: 'km', label: 'Tiếng Campuchia', flag: '🇰🇭' },
]

const activeDbLanguages = ref<Array<{ code: string; label: string; flag: string }>>([])

const availableLanguages = computed(() => {
  if (activeDbLanguages.value.length > 0) return activeDbLanguages.value
  return DEFAULT_TRANSLATION_LANGS
})

async function fetchDbLanguages() {
  try {
    const res = await $fetch<{ ok: boolean; items: Array<{ code: string; name: string; nativeName: string; isActive: boolean; isDefault: boolean }> }>('/api/admin/languages')
    if (res.ok && Array.isArray(res.items)) {
      const nonDefault = res.items.filter(l => l.isActive && l.code !== 'vi')
      if (nonDefault.length > 0) {
        activeDbLanguages.value = nonDefault.map(l => ({
          code: l.code,
          label: l.name,
          flag: getFlagEmoji(l.code),
        }))
      }
    }
  } catch {
    // Non-critical: fallback to DEFAULT_TRANSLATION_LANGS
  }
}

const failedTranslations = computed(() =>
  articleTranslations.value.filter(t => t.status === 'failed')
)

const retryingAllFailed = ref(false)
async function retryAllFailedTranslations() {
  if (failedTranslations.value.length === 0) return
  retryingAllFailed.value = true
  try {
    for (const t of failedTranslations.value) {
      await triggerTranslation(t.langCode)
    }
    toast.success(`Đã kích hoạt thử lại cho ${failedTranslations.value.length} bản dịch lỗi.`)
  } finally {
    retryingAllFailed.value = false
  }
}

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
  if (isNew.value || !articleId.value) {
    toast.error('Vui lòng lưu bài viết trước khi dịch.')
    return
  }

  // Cập nhật lạc quan (Optimistic update) để thẻ hiển thị ngay trạng thái đang dịch
  const existing = articleTranslations.value.find((t) => t.langCode === langCode)
  if (existing) {
    existing.status = 'translating'
    existing.progress = 10
    existing.errorMessage = null
  } else {
    articleTranslations.value.push({
      id: 0,
      langCode,
      status: 'translating',
      progress: 10,
      currentChunk: 0,
      totalChunks: 1,
      title: null,
      errorMessage: null,
      translatedBy: 'ai',
      completedAt: null,
    })
  }

  translatingLang.value = langCode
  startTranslationPolling()

  try {
    await $fetch(`/api/admin/articles/${articleId.value}/translations/translate`, {
      method: 'POST',
      body: { langCode },
    })
    toast.success(`Đã bắt đầu dịch sang ${availableLanguages.value.find((l) => l.code === langCode)?.label ?? langCode}.`)
    await fetchArticleTranslations()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể bắt đầu dịch.'))
    if (existing) existing.status = 'failed'
    await fetchArticleTranslations()
  }
}

let isPollingTranslations = false
function startTranslationPolling() {
  if (translationPollTimer) return
  translationPollTimer = window.setInterval(async () => {
    if (isPollingTranslations || isNew.value || !articleId.value) return
    isPollingTranslations = true
    try {
      await fetchArticleTranslations()
      const stillTranslating = articleTranslations.value.some((t) => t.status === 'translating')
      if (!stillTranslating) {
        stopTranslationPolling()
        translatingLang.value = null
        toast.success('Bản dịch AI đã hoàn tất!')
      }
    } catch {
      // Non-critical poll failure
    } finally {
      isPollingTranslations = false
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
  if (!confirm(`Xoá bản dịch ${availableLanguages.value.find(l => l.code === row.langCode)?.label ?? row.langCode}?`)) return
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
      <div class="flex items-center gap-2 flex-wrap">
        <!-- Khi tạo mới (isNew): Tích chọn những ngôn ngữ muốn tự động dịch qua -->
        <div v-if="isNew" class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-bold cursor-pointer transition-colors"
            :class="autoTranslateLangs.length > 0
              ? 'border-[#2c6e33] bg-[#f0f7f1] text-[#1e4620]'
              : 'border-[#c8d6c9] bg-white text-[#667768] hover:bg-[#f8faf8]'"
            @click="showAutoTranslateMenu = !showAutoTranslateMenu"
          >
            <i class="fa-solid fa-language text-sm"></i>
            <span>{{ autoTranslateLangs.length > 0 ? `Tự động dịch (${autoTranslateLangs.length})` : 'Tự động dịch...' }}</span>
            <i class="fa-solid fa-chevron-down text-[0.6rem]"></i>
          </button>

          <!-- Popover chọn ngôn ngữ -->
          <div
            v-if="showAutoTranslateMenu"
            class="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-white border border-[#c8d6c9] shadow-xl p-3 z-30 flex flex-col gap-2"
          >
            <div class="flex items-center justify-between border-b border-[#e2ece3] pb-1.5 text-xs">
              <span class="font-bold text-[#122815]">Chọn ngôn ngữ dịch tự động:</span>
              <button
                type="button"
                class="text-[0.68rem] text-[#2c6e33] hover:underline bg-transparent border-0 cursor-pointer p-0"
                @click="autoTranslateLangs = autoTranslateLangs.length === availableLanguages.length ? [] : availableLanguages.map(l => l.code)"
              >
                {{ autoTranslateLangs.length === availableLanguages.length ? 'Bỏ chọn' : 'Tất cả' }}
              </button>
            </div>
            <div class="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              <label
                v-for="l in availableLanguages"
                :key="l.code"
                class="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-[#f0f7f1] cursor-pointer text-xs font-semibold text-[#122815]"
              >
                <input
                  type="checkbox"
                  :value="l.code"
                  v-model="autoTranslateLangs"
                  class="h-3.5 w-3.5 accent-[#2c6e33] rounded"
                />
                <span>{{ l.flag }}</span>
                <span>{{ l.label }}</span>
              </label>
            </div>
            <p class="m-0 text-[0.68rem] text-[#667768] border-t border-[#e2ece3] pt-1.5">
              Sau khi lưu bài gốc, hệ thống sẽ tự động kích hoạt dịch sang các ngôn ngữ đã chọn trong nền.
            </p>
          </div>
        </div>

        <!-- Khi chỉnh sửa (!isNew): Nút xem nhanh bản dịch -->
        <button
          v-else
          type="button"
          class="inline-flex items-center gap-1.5 bg-white border border-[#c8d6c9] text-[#1e4620] hover:bg-[#f0f7f1] px-3.5 py-2.5 rounded-lg text-sm font-bold cursor-pointer transition-colors"
          @click="scrollToTranslations"
        >
          <i class="fa-solid fa-language text-sm"></i>
          <span>Bản dịch ({{ articleTranslations.filter(t => t.status === 'published').length }}/{{ availableLanguages.length }})</span>
        </button>
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
              <!-- Dịch bài viết đã được chuyển vào phần Quản lý Bản dịch chuyên biệt -->
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

    <!-- Article Translations Section (Intelligent, Scientific Translation Workspace) -->
    <div v-if="!isNew" id="article-translations-section" class="bg-white rounded-xl border border-[#e2ece3] p-5 sm:p-6 flex flex-col gap-4 shadow-xs">
      <!-- Section Header with Controls -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#e2ece3] pb-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg bg-[#f0f7f1] text-[#2c6e33] flex items-center justify-center text-sm">
              <i class="fa-solid fa-language"></i>
            </span>
            <h3 class="text-base font-extrabold text-[#122815] m-0">Quản lý Bản dịch Đa ngôn ngữ</h3>
            <span class="px-2 py-0.5 rounded-full bg-[#e4f2e5] text-[#1e4620] text-xs font-bold">
              {{ articleTranslations.filter(t => t.status === 'published').length }}/{{ availableLanguages.length }} đã xuất bản
            </span>
          </div>
          <p class="text-xs text-[#667768] m-0 mt-1">Quản lý, dịch tự động bằng AI và xuất bản các phiên bản ngôn ngữ quốc tế cho bài viết này.</p>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <!-- Nút thử lại các bản dịch lỗi nếu có -->
          <button
            v-if="failedTranslations.length > 0"
            type="button"
            class="px-3.5 py-2 rounded-lg bg-[#d12420] hover:bg-[#b71c1c] text-white text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50 border-none"
            :disabled="retryingAllFailed"
            title="Kích hoạt thử lại cho tất cả các bản dịch đang bị lỗi"
            @click="retryAllFailedTranslations"
          >
            <i class="fa-solid fa-rotate-right text-xs" :class="retryingAllFailed ? 'animate-spin' : ''"></i>
            <span>{{ retryingAllFailed ? 'Đang thử lại...' : `🔄 Thử lại lỗi (${failedTranslations.length})` }}</span>
          </button>

          <!-- Nút dịch toàn bộ còn thiếu -->
          <button
            type="button"
            class="px-3.5 py-2 rounded-lg bg-[#1e4620] hover:bg-[#153317] text-white text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50 border-none"
            :disabled="translatingAll"
            title="Kích hoạt dịch AI cho tất cả các ngôn ngữ chưa có bản dịch"
            @click="translateAllForThisArticle"
          >
            <i class="fa-solid fa-wand-magic-sparkles text-xs" :class="translatingAll ? 'animate-spin' : ''"></i>
            <span>{{ translatingAll ? 'Đang kích hoạt...' : '⚡ Dịch toàn bộ còn thiếu' }}</span>
          </button>

          <button
            type="button"
            class="px-3 py-2 rounded-lg border border-[#c8d6c9] bg-white text-[#1e4620] hover:bg-[#f0f7f1] text-xs font-semibold cursor-pointer flex items-center gap-1.5 transition-colors"
            title="Làm mới trạng thái các bản dịch"
            @click="fetchArticleTranslations"
          >
            <i class="fa-solid fa-arrows-rotate text-xs"></i>
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      <!-- Modern Language Cards Grid (4 columns) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div
          v-for="lang in availableLanguages"
          :key="lang.code"
          class="rounded-xl border p-4 flex flex-col justify-between gap-3 transition-all relative"
          :class="[
            getTranslationRow(lang.code)?.status === 'published'
              ? 'border-[#8ed694] bg-[#f8faf7] shadow-2xs'
              : getTranslationRow(lang.code)?.status === 'ai_draft'
                ? 'border-[#ffe082] bg-[#fffdf7]'
                : getTranslationRow(lang.code)?.status === 'translating'
                  ? 'border-[#90caf9] bg-[#f4f9ff]'
                  : getTranslationRow(lang.code)?.status === 'failed'
                    ? 'border-[#f1b8b5] bg-[#fff5f4]'
                    : 'border-[#e2ece3] bg-white opacity-80'
          ]"
        >
          <!-- Card Header: Flag + Name + Code -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-2xl leading-none">{{ lang.flag }}</span>
              <div>
                <h4 class="m-0 text-sm font-bold text-[#122815] leading-tight">{{ lang.label }}</h4>
                <span class="text-[0.68rem] font-mono text-[#667768]">({{ lang.code }})</span>
              </div>
            </div>

            <!-- Status Badge -->
            <span
              v-if="getTranslationRow(lang.code)"
              class="px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider"
              :class="[
                getTranslationRow(lang.code)?.status === 'published'
                  ? 'bg-[#e4f2e5] text-[#1e4620]'
                  : getTranslationRow(lang.code)?.status === 'ai_draft'
                    ? 'bg-[#fff8e1] text-[#b78103]'
                    : getTranslationRow(lang.code)?.status === 'reviewed'
                      ? 'bg-[#eef2ee] text-[#4a5545]'
                      : getTranslationRow(lang.code)?.status === 'translating'
                        ? 'bg-[#e3f2fd] text-[#1565c0]'
                        : 'bg-[#ffebe9] text-[#d12420]'
              ]"
            >
              {{
                getTranslationRow(lang.code)?.status === 'published' ? 'Đã xuất bản'
                : getTranslationRow(lang.code)?.status === 'ai_draft' ? 'Bản nháp AI'
                : getTranslationRow(lang.code)?.status === 'reviewed' ? 'Đã duyệt'
                : getTranslationRow(lang.code)?.status === 'translating' ? 'Đang dịch'
                : 'Lỗi'
              }}
            </span>
            <span v-else class="px-2 py-0.5 rounded-full bg-[#f0f0f0] text-[#888] text-[0.65rem] font-bold">
              Chưa dịch
            </span>
          </div>

          <!-- Translating progress bar -->
          <div v-if="getTranslationRow(lang.code)?.status === 'translating'" class="flex flex-col gap-1.5 py-1">
            <div class="flex items-center justify-between text-[0.7rem] text-[#1565c0] font-bold">
              <span class="flex items-center gap-1.5">
                <i class="fa-solid fa-spinner animate-spin"></i>
                <span>Đang dịch bằng AI...</span>
              </span>
              <span>
                {{ getTranslationRow(lang.code)?.progress || 10 }}%
                <span v-if="(getTranslationRow(lang.code)?.totalChunks || 0) > 1" class="font-normal text-[0.65rem] opacity-75">
                  ({{ getTranslationRow(lang.code)?.currentChunk || 0 }}/{{ getTranslationRow(lang.code)?.totalChunks }} đoạn)
                </span>
              </span>
            </div>
            <div class="w-full h-2 rounded-full bg-[#bbdefb] overflow-hidden">
              <div
                class="h-full bg-[#1976d2] transition-all duration-500 rounded-full"
                :style="{ width: `${getTranslationRow(lang.code)?.progress || 10}%` }"
              ></div>
            </div>
          </div>
          <!-- Failed error text -->
          <div v-else-if="getTranslationRow(lang.code)?.status === 'failed'" class="text-[0.7rem] text-[#d12420] flex flex-col gap-1 bg-white p-2 rounded-lg border border-red-200">
            <div class="flex items-center gap-1 font-bold">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <span>Lỗi tạo bản dịch:</span>
            </div>
            <p class="m-0 text-[0.68rem] text-red-700 line-clamp-2">{{ getTranslationRow(lang.code)?.errorMessage || 'Không có phản hồi từ AI.' }}</p>
          </div>

          <!-- Snippet preview if exists -->
          <div v-else-if="getTranslationRow(lang.code)?.title" class="flex flex-col gap-0.5">
            <span class="text-[0.68rem] text-[#667768] font-medium">Tiêu đề:</span>
            <p class="m-0 text-xs font-semibold text-[#122815] line-clamp-1" :title="getTranslationRow(lang.code)?.title || ''">{{ getTranslationRow(lang.code)?.title }}</p>
          </div>
          <div v-else class="text-xs text-[#888] italic py-1">
            Chưa có bản dịch cho ngôn ngữ này.
          </div>

          <!-- Card Action Buttons -->
          <div class="flex items-center justify-between pt-2 border-t border-[#eef2ee] gap-1">
            <!-- Untranslated: Direct AI Translate Button -->
            <!-- Untranslated or Failed: Direct AI Translate Button -->
            <template v-if="!getTranslationRow(lang.code) || getTranslationRow(lang.code)?.status === 'failed'">
              <button
                type="button"
                class="w-full py-1.5 px-3 rounded-lg text-white text-xs font-bold border-none cursor-pointer flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                :class="getTranslationRow(lang.code)?.status === 'failed' ? 'bg-[#d12420] hover:bg-[#b71c1c]' : 'bg-[#2c6e33] hover:bg-[#1e4620]'"
                :disabled="translatingLang === lang.code"
                @click="triggerTranslation(lang.code)"
              >
                <i class="fa-solid text-[0.7rem]" :class="translatingLang === lang.code ? 'fa-spinner animate-spin' : (getTranslationRow(lang.code)?.status === 'failed' ? 'fa-rotate-right' : 'fa-wand-magic-sparkles')"></i>
                <span>{{ translatingLang === lang.code ? 'Đang dịch...' : (getTranslationRow(lang.code)?.status === 'failed' ? '🔄 Thử lại bản dịch' : '⚡ Dịch bằng AI') }}</span>
              </button>
            </template>

            <!-- Translated: View/Edit + Publish/Unpublish + Delete -->
            <template v-else>
              <button
                type="button"
                class="px-2.5 py-1 rounded-md bg-[#1e4620] hover:bg-[#153317] text-white text-xs font-bold border-none cursor-pointer flex items-center gap-1 transition-colors"
                @click="getTranslationRow(lang.code) && openEditTranslation(getTranslationRow(lang.code)!)"
              >
                <i class="fa-solid fa-pen-to-square text-[0.68rem]"></i> Sửa
              </button>

              <button
                type="button"
                class="px-2 py-1 rounded-md text-xs font-bold cursor-pointer border transition-colors"
                :class="getTranslationRow(lang.code)?.status === 'published'
                  ? 'border-[#c8d6c9] bg-white text-[#d12420] hover:bg-[#fff5f4]'
                  : 'border-[#2c6e33] bg-[#e4f2e5] text-[#1e4620] hover:bg-[#d4ebd6]'"
                @click="getTranslationRow(lang.code) && toggleTranslationStatus(getTranslationRow(lang.code)!)"
              >
                {{ getTranslationRow(lang.code)?.status === 'published' ? 'Gỡ' : 'Xuất bản' }}
              </button>

              <button
                type="button"
                class="px-2 py-1 rounded-md border border-[#e2c8c8] bg-white text-[#d12420] hover:bg-[#fff5f4] text-xs font-semibold cursor-pointer"
                title="Xoá bản dịch này"
                @click="getTranslationRow(lang.code) && deleteTranslation(getTranslationRow(lang.code)!)"
              >
                <i class="fa-solid fa-trash text-[0.68rem]"></i>
              </button>
            </template>
          </div>
        </div>
      </div>

      <!-- Edit Translation Drawer (Rich side-by-side editing with TinyMCE) -->
      <div v-if="showEditTranslationDrawer && editingTranslation" class="bg-[#f8faf7] rounded-xl border border-[#c8d6c9] p-4 sm:p-5 flex flex-col gap-3 shadow-md">
        <div class="flex items-center justify-between border-b border-[#e2ece3] pb-2.5">
          <div class="flex items-center gap-2">
            <span class="text-xl">{{ availableLanguages.find(l => l.code === editingTranslation.lang)?.flag }}</span>
            <span class="text-sm font-extrabold text-[#122815]">Chỉnh sửa bản dịch: {{ availableLanguages.find(l => l.code === editingTranslation.lang)?.label }}</span>
          </div>
          <button type="button" class="text-xs text-[#667768] hover:text-[#d12420] border-none bg-transparent cursor-pointer font-bold" @click="showEditTranslationDrawer = false; editingTranslation = null">✕ Đóng</button>
        </div>

        <!-- Reference original title -->
        <div class="p-2.5 rounded-lg bg-white border border-[#e2ece3] text-xs flex flex-col gap-1">
          <span class="text-[#667768] font-bold">Tiêu đề gốc (Tiếng Việt):</span>
          <p class="m-0 font-semibold text-[#1e4620]">{{ form.title }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tiêu đề dịch (*)</label>
          <input v-model="editingTranslation.title" type="text" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] bg-white font-semibold" />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Tóm tắt dịch</label>
          <textarea v-model="editingTranslation.excerpt" rows="2" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] resize-none font-[inherit] bg-white"></textarea>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <label class="text-[0.82rem] font-bold text-[#2c3e2e]">Nội dung dịch (Trình soạn thảo TinyMCE)</label>
            <span class="text-xs text-[#667768]">Hỗ trợ đầy đủ định dạng rich-text, bảng biểu, ảnh</span>
          </div>
          <div class="bg-white rounded-lg border border-[#c8d6c9] overflow-hidden">
            <TinyMceEditor
              v-model="editingTranslation.content"
              :height="450"
              placeholder="Nhập hoặc chỉnh sửa nội dung bản dịch..."
            />
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#e2ece3]">
          <button type="button" class="px-3.5 py-2 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#667768] hover:bg-gray-50 cursor-pointer" @click="showEditTranslationDrawer = false; editingTranslation = null">Hủy</button>
          <button type="button" class="px-5 py-2 rounded-lg bg-[#1e4620] hover:bg-[#153317] text-white text-xs font-bold border-none cursor-pointer flex items-center gap-1.5" @click="saveTranslationEdit">
            <i class="fa-solid fa-floppy-disk"></i>
            <span>Lưu bản dịch</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
