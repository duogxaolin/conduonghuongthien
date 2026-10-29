<script setup lang="ts">
/**
 * Trình soạn bài viết (`/admin/content/articles/new` và `/:id`). Tách (wave3, 773 dòng —
 * docs/decisions/refactor-large-files.md):
 *  - `components/admin/articles/editor/*.vue` — đầu trang (menu tự động dịch, nút lưu), cột soạn
 *    (panel AI, tiêu đề, tóm tắt, ô TinyMCE), cột "Cấu hình xuất bản", hộp nhắc dịch lại: chỉ
 *    hiển thị, props vào, sự kiện ra;
 *  - `useArticleEditorTinymce` (cấu hình + init TinyMCE — đường init thứ hai của dự án, cầu nối
 *    thân bài, chèn ảnh, mốc thân bài), `useArticleEditorUnsavedGuard` (rời trang / đóng tab),
 *    `useArticleEditorSave` (lưu, tạo + tự động dịch, nhắc dịch lại), `useArticleEditorMedia`
 *    (thư viện ảnh, tải ảnh đại diện), `useArticleEditorTaxonomy` (thể loại, danh mục).
 * Trang giữ: biểu mẫu; lượt tải `fetchArticle` với khung chờ, nhánh lỗi `role="alert"` + "Thử
 * lại" và cờ DƯƠNG `loaded`; bộ theo dõi thể loại cùng `suppressTypeReset`; thứ tự `onMounted`;
 * `translationPanelRef` (panel bản dịch là con trực tiếp).
 */
import type { ArticleReadResponse } from '~/types/admin-articles-api'
import type { ArticleRetranslateStatus } from '~/types/admin-article-editor'
import ArticleTranslationPanel from '~/components/admin/articles/ArticleTranslationPanel.vue'
import ArticleEditorHeader from '~/components/admin/articles/editor/ArticleEditorHeader.vue'
import ArticleEditorMainForm from '~/components/admin/articles/editor/ArticleEditorMainForm.vue'
import ArticleEditorPublishPanel from '~/components/admin/articles/editor/ArticleEditorPublishPanel.vue'
import ArticleReTranslateModal from '~/components/admin/articles/editor/ArticleReTranslateModal.vue'
import { useArticleEditorMedia } from '~/composables/useArticleEditorMedia'
import { useArticleEditorSave } from '~/composables/useArticleEditorSave'
import { useArticleEditorTaxonomy } from '~/composables/useArticleEditorTaxonomy'
import { useArticleEditorTinymce } from '~/composables/useArticleEditorTinymce'
import { useArticleEditorUnsavedGuard } from '~/composables/useArticleEditorUnsavedGuard'
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const route = useRoute()
const isNew = computed(() => route.params.id === 'new')
const articleId = computed(() => isNew.value ? null : Number(route.params.id))

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
// Tải hỏng → `errorMsg` ("Thử lại"); lưu hỏng → `saveError` (không tải lại đè chữ đang gõ);
// `loaded`: biểu mẫu đang giữ bài thật (bài mới: luôn) — chưa thì lưu là ghi đè bài bằng ô trống.
const errorMsg = ref('')
const loaded = ref(isNew.value)
const toast = useToast()
const { confirm } = useConfirm()

const {
  editorId, setEditorContent, getEditorContent, markBodySaved, bodyChanged, showLoadedContent,
  insertMediaIntoEditor, initTinyMCE, loadTinyMCEScript,
} = useArticleEditorTinymce({ form })

// ─── Unsaved-changes guard: route leave here (a Nuxt auto-import), the tab close in the composable ──
const { markSaved, confirmLeave } = useArticleEditorUnsavedGuard({ form, loading, markBodySaved, bodyChanged, confirm })
onBeforeRouteLeave(confirmLeave)

const { availableCategories, contentTypes, fetchContentTypes, fetchCategories } = useArticleEditorTaxonomy()

// Template ref tới ArticleTranslationPanel con. Khai báo trước computed đọc
// từ nó (tránh TDZ visual — dù computed là lazy, đặt ref trước cho rõ thứ tự).
const translationPanelRef = ref<InstanceType<typeof ArticleTranslationPanel> | null>(null)

// `availableLanguages` / `articleTranslations` / `translatingAll` sống trong
// `ArticleTranslationPanel` con. Cha đọc qua `translationPanelRef` (expose) cho
// auto-translate menu (new article) + re-translate modal (hiển thị list lang).
const availableLanguages = computed(() => translationPanelRef.value?.availableLanguages ?? [])

function scrollToTranslations() {
  nextTick(() => {
    document.getElementById('article-translations-section')?.scrollIntoView({ behavior: 'smooth' })
  })
}

// Wrapper gọi con — re-translate modal (confirmReTranslation) dùng. Con giữ state optimistic + polling.
async function translateAllForThisArticle(targetStatus: ArticleRetranslateStatus = 'ai_draft') {
  await translationPanelRef.value?.translateAllForThisArticle(targetStatus)
}

const {
  saving, saveError, autoTranslateLangs, handleSave,
  showReTranslateModal, reTranslatePublishImmediately, reTranslateRunning, recordInitialSnapshot, confirmReTranslation,
} = useArticleEditorSave({
  form, isNew, articleId, loaded, toast, getEditorContent, markSaved, navigate: navigateTo, translateAll: translateAllForThisArticle,
})

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
  loaded.value = false // trước await: "Thử lại" đang bay không được mở lại nút lưu
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
      // The (suppressed) type watcher won't: load this type's categories so the saved one shows.
      await fetchCategories(form.type)
      showLoadedContent()
      recordInitialSnapshot()
      loaded.value = true
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

const { openPicker } = useImagePicker()
const { uploading: uploadingThumb, uploadFile } = useUpload()
const { openMediaPicker, uploadThumbnailFromInput } = useArticleEditorMedia({ form, openPicker, uploadFile, insertMediaIntoEditor })

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
</script>
<template>
  <div class="flex flex-col gap-5">
    <ArticleEditorHeader
      v-model:auto-translate-langs="autoTranslateLangs"
      :is-new="isNew"
      :saving="saving"
      :loaded="loaded"
      :available-languages="availableLanguages"
      @save="handleSave"
      @scroll-to-translations="scrollToTranslations"
    />

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

    <!-- Two-column editor grid: the writing column, the publish settings -->
    <div v-else class="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">
      <ArticleEditorMainForm
        v-model:title="form.title"
        v-model:excerpt="form.excerpt"
        :editor-id="editorId"
        :get-editor-content="getEditorContent"
        :set-editor-content="setEditorContent"
        @insert-media="openMediaPicker('content')"
      />
      <ArticleEditorPublishPanel
        v-model:article-type="form.type"
        v-model:category-id="form.categoryId"
        v-model:status="form.status"
        v-model:thumbnail-url="form.thumbnailUrl"
        :content-types="contentTypes"
        :available-categories="availableCategories"
        :uploading="uploadingThumb"
        @pick-thumbnail="openMediaPicker('thumbnail')"
        @upload-thumbnail="uploadThumbnailFromInput"
      />
    </div>

    <!-- Quản lý Bản dịch Đa ngôn ngữ — ArticleTranslationPanel.vue.
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

    <ArticleReTranslateModal
      v-model:publish-immediately="reTranslatePublishImmediately"
      :open="showReTranslateModal"
      :running="reTranslateRunning"
      :available-languages="availableLanguages"
      @close="showReTranslateModal = false"
      @confirm="confirmReTranslation"
    />
  </div>
</template>
