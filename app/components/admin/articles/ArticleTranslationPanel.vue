<script setup lang="ts">
/**
 * Quản lý Bản dịch Đa ngôn ngữ — tách khỏi `pages/admin/content/articles/[id].vue`.
 *
 * Tự fetch `/api/admin/articles/:id/translations` + poll tiến trình dịch. KHÔNG có
 * error branch (toast only — bản dịch là best-effort, lỗi 1 bản không blank cả
 * panel). Có loading state qua optimistic update (`status: 'translating'` + progress
 * bar), KHÔNG có skeleton (cards luôn render với status cũ/giá trị mặc định).
 * → `NO_CONTRACT_NEEDED` + `NO_SKELETON_NEEDED` ở test guard.
 *
 * Cha truyền `articleId` (null = bài mới, panel ẩn), `isNew` (ẩn panel khi tạo mới),
 * `formTitle` (tiêu đề gốc cho edit drawer reference), `availableLanguagesFallback`
 * (fallback khi DB chưa load). Con emit 'scroll-to-self' cho nút "Bản dịch" ở header
 * (cha scroll xuống section này).
 */
import { getFlagEmoji } from '~/utils/language-flags'
import TinyMceEditor from '~/components/admin/TinyMceEditor.vue'
import type {
  ArticleTranslateAllResponse, ArticleTranslateResponse, ArticleTranslationDeleteResponse, ArticleTranslationRow, ArticleTranslationSaveResponse,
  ArticleTranslationsResponse, ArticleTranslationStatusResponse, LanguagesResponse,
} from '~/types/admin-articles-api'

/** The columns the cards read — a Pick of the server row, so an optimistic "translating" row stays constructible. */
type TranslationRow = Pick<ArticleTranslationRow, 'id' | 'langCode' | 'status' | 'title' | 'excerpt' | 'content' | 'progress'
  | 'currentChunk' | 'totalChunks' | 'errorMessage' | 'translatedBy' | 'completedAt'>

const props = defineProps<{
  articleId: number | null
  isNew: boolean
  formTitle: string
}>()

const toast = useToast()
const { confirm } = useConfirm()

// ─── State ──────────────────────────────────────────────────────────────────
// Các cột thẻ bản dịch đọc từ hàng `article_translations` (`TranslationRow`, Pick của kiểu
// suy từ handler — `listTranslationsForArticle` trả cả hàng, kể cả `excerpt`/`content`).
const articleTranslations = ref<TranslationRow[]>([])
const translatingLang = ref<string | null>(null)
const editingTranslation = ref<{ lang: string; title: string; excerpt: string; content: string } | null>(null)
const showEditTranslationDrawer = ref(false)
let translationPollTimer: number | undefined
let isPollingTranslations = false

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

const failedTranslations = computed(() =>
  articleTranslations.value.filter(t => t.status === 'failed')
)

const retryingAllFailed = ref(false)
const translatingAll = ref(false)

// ─── Fetch ──────────────────────────────────────────────────────────────────
async function fetchDbLanguages() {
  try {
    const res = await adminFetch<LanguagesResponse>('/api/admin/languages')
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

async function fetchArticleTranslations() {
  if (props.isNew || !props.articleId) return
  try {
    const res = await adminFetch<ArticleTranslationsResponse>(`/api/admin/articles/${props.articleId}/translations`)
    if (res.ok) articleTranslations.value = res.items
  } catch {
    // Non-critical
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────
async function triggerTranslation(langCode: string, targetStatus: 'ai_draft' | 'published' = 'ai_draft') {
  if (props.isNew || !props.articleId) {
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
      excerpt: null,
      content: null,
      errorMessage: null,
      translatedBy: 'ai',
      completedAt: null,
    })
  }

  translatingLang.value = langCode
  startTranslationPolling()

  try {
    await adminFetch<ArticleTranslateResponse>(`/api/admin/articles/${props.articleId}/translations/translate`, {
      method: 'POST',
      body: { langCode, targetStatus },
    })
    toast.success(`Đã bắt đầu dịch sang ${availableLanguages.value.find((l) => l.code === langCode)?.label ?? langCode}.`)
    await fetchArticleTranslations()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể bắt đầu dịch.'))
    if (existing) existing.status = 'failed'
    await fetchArticleTranslations()
  }
}

async function translateAllForThisArticle(targetStatus: 'ai_draft' | 'published' = 'ai_draft') {
  if (props.isNew || !props.articleId) return
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
        excerpt: null,
        content: null,
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
    const res = await adminFetch<ArticleTranslateAllResponse>(
      `/api/admin/articles/${props.articleId}/translations/translate-all`,
      { method: 'POST', body: { targetStatus } },
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

async function retryAllFailedTranslations() {
  if (failedTranslations.value.length === 0) return
  retryingAllFailed.value = true
  // Counted BEFORE retrying: each retry flips its row to "translating", and the count read
  // afterwards always said "0 bản dịch lỗi".
  const retried = failedTranslations.value.map(t => t.langCode)
  try {
    for (const langCode of retried) {
      await triggerTranslation(langCode)
    }
    toast.success(`Đã kích hoạt thử lại cho ${retried.length} bản dịch lỗi.`)
  } finally {
    retryingAllFailed.value = false
  }
}

function openEditTranslation(row: TranslationRow) {
  editingTranslation.value = {
    lang: row.langCode,
    title: row.title ?? '',
    excerpt: row.excerpt ?? '',
    content: row.content ?? '',
  }
  showEditTranslationDrawer.value = true
}

async function saveTranslationEdit() {
  if (!editingTranslation.value || !props.articleId) return
  try {
    await adminFetch<ArticleTranslationSaveResponse>(
      `/api/admin/articles/${props.articleId}/translations/${editingTranslation.value.lang}`,
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

async function toggleTranslationStatus(row: TranslationRow) {
  if (!props.articleId) return
  const newStatus = row.status === 'published' ? 'reviewed' : 'published'
  try {
    await adminFetch<ArticleTranslationStatusResponse>(
      `/api/admin/articles/${props.articleId}/translations/${row.langCode}/status`,
      { method: 'PATCH', body: { status: newStatus } },
    )
    toast.success(newStatus === 'published' ? 'Đã xuất bản bản dịch.' : 'Đã bỏ xuất bản.')
    await fetchArticleTranslations()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể đổi trạng thái.'))
  }
}

async function deleteTranslation(row: TranslationRow) {
  if (!props.articleId) return
  if (!await confirm({
    message: `Xoá bản dịch ${availableLanguages.value.find(l => l.code === row.langCode)?.label ?? row.langCode}?`,
    confirmLabel: 'Xoá bản dịch',
    danger: true,
  })) return
  try {
    await adminFetch<ArticleTranslationDeleteResponse>(
      `/api/admin/articles/${props.articleId}/translations/${row.langCode}`,
      { method: 'DELETE' },
    )
    toast.success('Đã xoá bản dịch.')
    await fetchArticleTranslations()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá.'))
  }
}

function getTranslationRow(langCode: string): TranslationRow | undefined {
  return articleTranslations.value.find((t) => t.langCode === langCode)
}

// ─── Polling ────────────────────────────────────────────────────────────────
function startTranslationPolling() {
  if (translationPollTimer) return
  translationPollTimer = window.setInterval(async () => {
    if (isPollingTranslations || props.isNew || !props.articleId) return
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

// ─── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([fetchArticleTranslations(), fetchDbLanguages()])
  if (articleTranslations.value.some((t) => t.status === 'translating')) {
    startTranslationPolling()
  }
})

onUnmounted(() => {
  stopTranslationPolling()
})

// Expose cho cha gọi:
// - `translateAllForThisArticle(targetStatus)` — cha dùng cho re-translate modal
//   (khi user sửa nội dung đã có bản dịch, modal hỏi "dịch lại toàn bộ?").
// - `availableLanguages` — cha dùng ở header (badge "Bản dịch X/Y") + re-translate
//   modal (hiển thị danh sách ngôn ngữ sẽ dịch lại) + auto-translate menu (new
//   article chọn ngôn ngữ dịch tự động).
// - `fetchArticleTranslations` / `getTranslationRow` — cha dùng nếu cần đọc state.
defineExpose({ fetchArticleTranslations, getTranslationRow, translateAllForThisArticle, availableLanguages })
</script>

<template>
  <div v-if="!isNew" id="article-translations-section" class="bg-white rounded-xl border border-line p-5 sm:p-6 flex flex-col gap-4 shadow-xs">
    <!-- Section Header with Controls -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="w-7 h-7 rounded-lg bg-surface-tint text-brand-700 flex items-center justify-center text-sm">
            <i class="fa-solid fa-language"></i>
          </span>
          <h3 class="text-base font-extrabold text-brand-950 m-0">Quản lý Bản dịch Đa ngôn ngữ</h3>
          <span class="px-2 py-0.5 rounded-full bg-[#e4f2e5] text-brand-900 text-xs font-bold">
            {{ articleTranslations.filter(t => t.status === 'published').length }}/{{ availableLanguages.length }} đã xuất bản
          </span>
        </div>
        <p class="text-xs text-ink-muted m-0 mt-1">Quản lý, dịch tự động bằng AI và xuất bản các phiên bản ngôn ngữ quốc tế cho bài viết này.</p>
        <div class="mt-2 p-2.5 rounded-lg bg-[#fff8e1] border border-[#ffe082] text-xs text-[#735100] flex items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation text-sm shrink-0 text-[#b78103]"></i>
          <span><strong>Lưu ý kiểm duyệt:</strong> Bài viết dịch AI xong cần rà soát lại trước khi bấm "Xuất bản" ra trang công khai (trừ khi đã chọn Xuất bản luôn).</span>
        </div>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <!-- Nút thử lại các bản dịch lỗi nếu có -->
        <button
          v-if="failedTranslations.length > 0"
          type="button"
          class="px-3.5 py-2 rounded-lg bg-danger hover:bg-[#b71c1c] text-white text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50 border-none"
          :disabled="retryingAllFailed"
          title="Kích hoạt thử lại cho tất cả các bản dịch đang bị lỗi"
          @click="retryAllFailedTranslations"
        >
          <i class="fa-solid fa-rotate-right text-xs" :class="retryingAllFailed ? 'animate-spin' : ''"></i>
          <span>{{ retryingAllFailed ? 'Đang thử lại...' : `🔄 Thử lại lỗi (${failedTranslations.length})` }}</span>
        </button>

        <!-- Nút dịch toàn bộ còn thiếu (Lưu bản nháp AI để rà soát) -->
        <button
          type="button"
          class="px-3.5 py-2 rounded-lg bg-brand-900 hover:bg-[#153317] text-white text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50 border-none"
          :disabled="translatingAll"
          title="Dịch AI tất cả ngôn ngữ còn thiếu và lưu ở trạng thái Bản nháp AI để rà soát"
          @click="translateAllForThisArticle('ai_draft')"
        >
          <i class="fa-solid fa-wand-magic-sparkles text-xs" :class="translatingAll ? 'animate-spin' : ''"></i>
          <span>{{ translatingAll ? 'Đang kích hoạt...' : '⚡ Dịch & Lưu nháp' }}</span>
        </button>

        <!-- Nút dịch và xuất bản luôn -->
        <button
          type="button"
          class="px-3.5 py-2 rounded-lg bg-brand-700 hover:bg-brand-900 text-white text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50 border-none"
          :disabled="translatingAll"
          title="Dịch AI và tự động xuất bản ngay ra trang công khai khi hoàn tất"
          @click="translateAllForThisArticle('published')"
        >
          <i class="fa-solid fa-paper-plane text-xs"></i>
          <span>🚀 Dịch & Xuất bản luôn</span>
        </button>
        <button
          type="button"
          class="px-3 py-2 rounded-lg border border-line-strong bg-white text-brand-900 hover:bg-surface-tint text-xs font-semibold cursor-pointer flex items-center gap-1.5 transition-colors"
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
              <h4 class="m-0 text-sm font-bold text-brand-950 leading-tight">{{ lang.label }}</h4>
              <span class="text-[0.68rem] font-mono text-ink-muted">({{ lang.code }})</span>
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
                      : 'bg-[#ffebe9] text-danger'
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
        <div v-else-if="getTranslationRow(lang.code)?.status === 'failed'" class="text-[0.7rem] text-danger flex flex-col gap-1 bg-white p-2 rounded-lg border border-red-200">
          <div class="flex items-center gap-1 font-bold">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>Lỗi tạo bản dịch:</span>
          </div>
          <p class="m-0 text-[0.68rem] text-red-700 line-clamp-2">{{ getTranslationRow(lang.code)?.errorMessage || 'Không có phản hồi từ AI.' }}</p>
        </div>

        <!-- Snippet preview if exists -->
        <div v-else-if="getTranslationRow(lang.code)?.title" class="flex flex-col gap-0.5">
          <span class="text-[0.68rem] text-ink-muted font-medium">Tiêu đề:</span>
          <p class="m-0 text-xs font-semibold text-brand-950 line-clamp-1" :title="getTranslationRow(lang.code)?.title || ''">{{ getTranslationRow(lang.code)?.title }}</p>
        </div>
        <div v-else class="text-xs text-[#888] italic py-1">
          Chưa có bản dịch cho ngôn ngữ này.
        </div>

        <!-- Card Action Buttons -->
        <div class="flex items-center justify-between pt-2 border-t border-surface-tint gap-1">
          <!-- Untranslated or Failed: Direct AI Translate Button -->
          <template v-if="!getTranslationRow(lang.code) || getTranslationRow(lang.code)?.status === 'failed'">
            <button
              type="button"
              class="w-full py-1.5 px-3 rounded-lg text-white text-xs font-bold border-none cursor-pointer flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              :class="getTranslationRow(lang.code)?.status === 'failed' ? 'bg-danger hover:bg-[#b71c1c]' : 'bg-brand-700 hover:bg-[#1e4620]'"
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
              class="px-2.5 py-1 rounded-md bg-brand-900 hover:bg-[#153317] text-white text-xs font-bold border-none cursor-pointer flex items-center gap-1 transition-colors"
              @click="getTranslationRow(lang.code) && openEditTranslation(getTranslationRow(lang.code)!)"
            >
              <i class="fa-solid fa-pen-to-square text-[0.68rem]"></i> Sửa
            </button>

            <button
              type="button"
              class="px-2 py-1 rounded-md text-xs font-bold cursor-pointer border transition-colors"
              :class="getTranslationRow(lang.code)?.status === 'published'
                ? 'border-line-strong bg-white text-danger hover:bg-[#fff5f4]'
                : 'border-brand-700 bg-[#e4f2e5] text-brand-900 hover:bg-[#d4ebd6]'"
              @click="getTranslationRow(lang.code) && toggleTranslationStatus(getTranslationRow(lang.code)!)"
            >
              {{ getTranslationRow(lang.code)?.status === 'published' ? 'Gỡ' : 'Xuất bản' }}
            </button>

            <button
              type="button"
              class="px-2 py-1 rounded-md border border-[#e2c8c8] bg-white text-danger hover:bg-[#fff5f4] text-xs font-semibold cursor-pointer"
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
    <div v-if="showEditTranslationDrawer && editingTranslation" class="bg-surface rounded-xl border border-line-strong p-4 sm:p-5 flex flex-col gap-3 shadow-md">
      <div class="flex items-center justify-between border-b border-line pb-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xl">{{ availableLanguages.find(l => l.code === editingTranslation?.lang)?.flag }}</span>
          <span class="text-sm font-extrabold text-brand-950">Chỉnh sửa bản dịch: {{ availableLanguages.find(l => l.code === editingTranslation?.lang)?.label }}</span>
        </div>
        <button type="button" class="text-xs text-ink-muted hover:text-danger border-none bg-transparent cursor-pointer font-bold" @click="showEditTranslationDrawer = false; editingTranslation = null">✕ Đóng</button>
      </div>

      <!-- Reference original title -->
      <div class="p-2.5 rounded-lg bg-white border border-line text-xs flex flex-col gap-1">
        <span class="text-ink-muted font-bold">Tiêu đề gốc (Tiếng Việt):</span>
        <p class="m-0 font-semibold text-brand-900">{{ formTitle }}</p>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[0.82rem] font-bold text-ink-admin">Tiêu đề dịch (*)</label>
        <input v-model="editingTranslation.title" type="text" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 bg-white font-semibold" />
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[0.82rem] font-bold text-ink-admin">Tóm tắt dịch</label>
        <textarea v-model="editingTranslation.excerpt" rows="2" class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700 resize-none font-[inherit] bg-white"></textarea>
      </div>

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <label class="text-[0.82rem] font-bold text-ink-admin">Nội dung dịch (Trình soạn thảo TinyMCE)</label>
          <span class="text-xs text-ink-muted">Hỗ trợ đầy đủ định dạng rich-text, bảng biểu, ảnh</span>
        </div>
        <div class="bg-white rounded-lg border border-line-strong overflow-hidden">
          <TinyMceEditor
            v-model="editingTranslation.content"
            :height="450"
            placeholder="Nhập hoặc chỉnh sửa nội dung bản dịch..."
          />
        </div>
      </div>
      <div class="flex items-center justify-end gap-2 pt-2 border-t border-line">
        <button type="button" class="px-3.5 py-2 rounded-lg border border-line-strong bg-white text-xs font-semibold text-ink-muted hover:bg-gray-50 cursor-pointer" @click="showEditTranslationDrawer = false; editingTranslation = null">Hủy</button>
        <button type="button" class="px-5 py-2 rounded-lg bg-brand-900 hover:bg-[#153317] text-white text-xs font-bold border-none cursor-pointer flex items-center gap-1.5" @click="saveTranslationEdit">
          <i class="fa-solid fa-floppy-disk"></i>
          <span>Lưu bản dịch</span>
        </button>
      </div>
    </div>
  </div>
</template>
