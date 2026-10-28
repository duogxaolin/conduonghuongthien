<script setup lang="ts">
/**
 * Quản lý Ngôn ngữ — orchestrator. Ba tab là ba component con (pattern `default.vue` +
 * `ai/index.vue`):
 *
 *  - `components/admin/languages/LanguagesListTab.vue` — card grid + form thêm
 *  - `components/admin/languages/TranslationsTab.vue` — bảng bản dịch UI
 *  - `components/admin/languages/UniversalTab.vue` — Dịch toàn cục (Auto-Scanner)
 *
 * Tách thêm (wave3 4.2, docs/decisions/refactor-large-files.md):
 *  - `components/admin/languages/page/*.vue` — đầu trang + dải lưu ý, hộp chuyển vị trí, hộp
 *    "Tiến trình Dịch AI": chỉ hiển thị, props vào, sự kiện ra;
 *  - `useLanguageWrites` — thêm/bật-tắt/mặc định/xoá/sắp xếp ngôn ngữ, lưu + dịch một khoá,
 *    "Nạp mặc định", "Đồng bộ key";
 *  - `useLanguageBatchTranslate` — lượt "Dịch AI" một ngôn ngữ / "Dịch tất cả còn thiếu" và
 *    trạng thái hộp tiến trình.
 *
 * Cha giữ: các danh sách (`languages`, `translations`, `viTranslationsMap`) + bộ lọc của bảng,
 * các lượt tải (`fetchLanguages`, `fetchTranslations`, `loadViSourceMap`, `loadData`), tab đang
 * mở, khung chờ + nhánh lỗi `role="alert"` + "Thử lại" của hai tab. Hai guard test ghim ở file
 * gốc (KHÔNG tách vào con):
 *  - `loadError` / `fetchLanguages` (LanguagesList)
 *  - `translationsError` / `fetchTranslations` (Translations)
 *
 * `getFlagEmoji` + maps flag đã tách ra `app/utils/language-flags.ts`.
 */
import { ref, onMounted } from 'vue'
import { useToast } from '~/composables/useToast'
import { errorMessage } from '~/utils/errorMessage'
import { useLanguageWrites } from '~/composables/useLanguageWrites'
import { useLanguageBatchTranslate } from '~/composables/useLanguageBatchTranslate'
import type { LanguageItem, TranslationItem, TranslationList } from '~/types/admin-languages'
import LanguagesListTab from '~/components/admin/languages/LanguagesListTab.vue'
import TranslationsTab from '~/components/admin/languages/TranslationsTab.vue'
import UniversalTab from '~/components/admin/languages/UniversalTab.vue'
import LanguagesPageHeader from '~/components/admin/languages/page/LanguagesPageHeader.vue'
import LanguagesMoveModal from '~/components/admin/languages/page/LanguagesMoveModal.vue'
import LanguagesTranslateProgressModal from '~/components/admin/languages/page/LanguagesTranslateProgressModal.vue'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
})

const toast = useToast()
const { confirm } = useConfirm()

// ─── Language list (source of truth — LanguagesListTab nhận prop) ──────
const loading = ref(true)
const loadError = ref('')
const languages = ref<LanguageItem[]>([])

const activeTab = ref<'languages' | 'translations' | 'universal'>('languages')

async function fetchLanguages() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await adminFetch<{ ok: true; items: typeof languages.value }>(`/api/admin/languages`)
    if (res.ok) languages.value = res.items
  } catch (err: unknown) {
    loadError.value = errorMessage(err, 'Không thể tải danh sách ngôn ngữ.')
  } finally {
    loading.value = false
  }
}

// ─── Translations (source of truth — TranslationsTab nhận prop) ────────
const translationsLoading = ref(false)
const translationsError = ref('')
const translations = ref<TranslationItem[]>([])
const translationGroups = ref<string[]>([])
const selectedGroup = ref('all')
const searchQuery = ref('')
const selectedLangCode = ref('en')
const statusFilter = ref<'all' | 'untranslated' | 'translated' | 'ai'>('all')

const viTranslationsMap = ref<Map<string, string>>(new Map())

// Every vi key (the server answers a language whole — it used to cap at 500 of ~600).
async function loadViSourceMap() {
  try {
    const res = await adminFetch<TranslationList>(`/api/admin/languages/vi/translations`)
    if (res.ok) viTranslationsMap.value = new Map(res.items.map((item): [string, string] => [`${item.group}::${item.key}`, item.value || '']))
  } catch {
    // Non-critical
  }
}

// Only the latest request writes (as in useAdminList): an older answer for another
// language/group landing last would show its rows under the new selection.
let translationsRequest: AbortController | null = null

async function fetchTranslations() {
  translationsRequest?.abort()
  const request = (translationsRequest = new AbortController())
  translationsLoading.value = true
  translationsError.value = ''
  try {
    const res = await adminFetch<TranslationList>(`/api/admin/languages/${selectedLangCode.value}/translations`, {
      query: { group: selectedGroup.value !== 'all' ? selectedGroup.value : undefined, search: searchQuery.value || undefined },
      signal: request.signal,
    })
    if (request !== translationsRequest) return
    if (res.ok) {
      // null → '': the tab's editor starts from `value`; an untouched null was saved as "null".
      translations.value = res.items.map((t) => ({ ...t, value: t.value ?? '' }))
      translationGroups.value = res.groups
    }
  } catch (err: unknown) {
    if (request === translationsRequest) translationsError.value = errorMessage(err, 'Không thể tải bản dịch.')
  } finally {
    if (request === translationsRequest) translationsLoading.value = false
  }
}

async function loadData() {
  await Promise.all([fetchLanguages(), fetchTranslations(), loadViSourceMap()])
}

/** The language the "Bản dịch UI" tab opens on (mount, after a delete): the first active one other than vi, else vi. */
function selectDefaultTranslationLanguage() {
  selectedLangCode.value = languages.value.find((l) => l.code !== 'vi' && l.isActive)?.code ?? 'vi'
}

// ─── Writes (cha cấp danh sách + lượt tải; con emit) ──────────────────
const {
  addLanguage, toggleActive, setDefault, deleteLanguage,
  showMoveModal, movingLang, openMoveModal, moveLanguageToPosition, shiftOrder,
  translatingSingleKey, translateSingleKey, saveEdit,
  seedingDefault, seedDefaultTranslations, syncing, syncAllLanguages,
} = useLanguageWrites({
  toast, confirm, languages, selectedLangCode, viTranslationsMap,
  fetchLanguages, fetchTranslations, loadData, selectDefaultTranslationLanguage,
})

// ─── Batch AI translation with progress modal ────────────────────────
const {
  showTranslateProgressModal, progressModalTitle, progressStats, progressLog,
  translatingCards, translatingAll,
  stopTranslate, startBatchTranslateWithProgress, translateAllLanguagesMissing,
} = useLanguageBatchTranslate({ toast, confirm, languages, viTranslationsMap, reload: loadData })

/** "Dịch AI" of the table: the language the table shows. */
async function aiTranslateAll() {
  const currentLangObj = languages.value.find((l) => l.code === selectedLangCode.value)
  const langName = currentLangObj?.name || selectedLangCode.value
  await startBatchTranslateWithProgress(selectedLangCode.value, langName)
}

/** "Dịch AI (n)" of a language card. */
async function oneTimeTranslate(lang: LanguageItem) {
  await startBatchTranslateWithProgress(lang.code, lang.name)
}

// ─── Opening the table from a card ("Bảng dịch" / "Xem thiếu") ────────
function openTranslationTabFor(code: string) {
  selectedLangCode.value = code
  statusFilter.value = 'all'
  searchQuery.value = ''
  selectedGroup.value = 'all'
  activeTab.value = 'translations'
  fetchTranslations()
  nextTick(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

function inspectMissingKeys(code: string) {
  selectedLangCode.value = code
  statusFilter.value = 'untranslated'
  searchQuery.value = ''
  selectedGroup.value = 'all'
  activeTab.value = 'translations'
  fetchTranslations()
  nextTick(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

// Universal tab self-contained: tự `onMounted(loadCoverage)` khi mount, cha
// không cần ref hay trigger — chỉ mount khi `activeTab === 'universal'`.

onMounted(() => {
  loadData().then(selectDefaultTranslationLanguage)
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Đầu trang + dải lưu ý ("Làm mới CSDL") -->
    <LanguagesPageHeader
      :syncing="syncing"
      :translating-all="translatingAll"
      :seeding-default="seedingDefault"
      :loading="loading"
      @sync="syncAllLanguages"
      @translate-all="translateAllLanguagesMissing"
      @seed="seedDefaultTranslations"
      @refresh="loadData"
    />

    <!-- Tab Switcher -->
    <div class="flex gap-1 border-b border-line">
      <button
        class="px-4 py-2.5 text-sm font-bold border-b-2 transition-colors cursor-pointer bg-transparent"
        :class="activeTab === 'languages' ? 'border-brand-700 text-brand-700' : 'border-transparent text-ink-muted hover:text-brand-950'"
        @click="activeTab = 'languages'"
      >
        <i class="fa-solid fa-globe mr-1.5"></i> Ngôn ngữ
      </button>
      <button
        class="px-4 py-2.5 text-sm font-bold border-b-2 transition-colors cursor-pointer bg-transparent"
        :class="activeTab === 'translations' ? 'border-brand-700 text-brand-700' : 'border-transparent text-ink-muted hover:text-brand-950'"
        @click="activeTab = 'translations'; fetchTranslations()"
      >
        <i class="fa-solid fa-language mr-1.5"></i> Bản dịch UI
      </button>
      <button
        class="px-4 py-2.5 text-sm font-bold border-b-2 transition-colors cursor-pointer bg-transparent flex items-center gap-1.5"
        :class="activeTab === 'universal' ? 'border-brand-700 text-brand-700' : 'border-transparent text-ink-muted hover:text-brand-950'"
        @click="activeTab = 'universal'"
      >
        <i class="fa-solid fa-wand-magic-sparkles text-xs"></i>
        <span>Dịch Toàn Cục (Auto-Scanner)</span>
      </button>
    </div>

    <!-- Skeleton + Error (Languages tab — guard ghim ở file gốc) -->
    <SkeletonTable v-if="loading && activeTab === 'languages'" label="Đang tải danh sách ngôn ngữ" :rows="4" :cols="5" />
    <div v-else-if="loadError && activeTab === 'languages'" role="alert" class="bg-danger-bg text-danger px-4 py-2.5 rounded-lg text-[0.85rem] flex items-center justify-between gap-3">
      <span>{{ loadError }}</span>
      <button type="button" class="shrink-0 text-sm font-bold underline text-danger bg-transparent border-0 cursor-pointer p-0 hover:no-underline" @click="fetchLanguages">Thử lại</button>
    </div>

    <!-- Languages Tab -->
    <LanguagesListTab
      v-if="activeTab === 'languages'"
      :languages="languages"
      :translating-cards="translatingCards"
      @toggle-active="toggleActive"
      @set-default="setDefault"
      @delete="deleteLanguage"
      @shift-order="shiftOrder"
      @open-move="openMoveModal"
      @move-to-position="moveLanguageToPosition"
      @one-time-translate="oneTimeTranslate"
      @inspect-missing="inspectMissingKeys"
      @open-translations="openTranslationTabFor"
      @add-language="addLanguage"
    />

    <!-- Translations Tab: luôn mount khi mở tab — bộ lọc + ô tìm kiếm giữ nguyên (không mất focus)
         lúc tải lại; khung chờ/lỗi chỉ thay bảng qua slot #status (guard ghim translationsError/fetchTranslations ở đây) -->
    <TranslationsTab
      v-if="activeTab === 'translations'"
      :loading="translationsLoading" :failed="!!translationsError"
      :languages="languages"
      :translations="translations"
      :translation-groups="translationGroups"
      :selected-lang-code="selectedLangCode"
      :selected-group="selectedGroup"
      :search-query="searchQuery"
      :status-filter="statusFilter"
      :translating-single-key="translatingSingleKey"
      :translating-all="translatingAll"
      :vi-translations-map="viTranslationsMap"
      @update:selected-lang-code="selectedLangCode = $event"
      @update:selected-group="selectedGroup = $event"
      @update:search-query="searchQuery = $event"
      @update:status-filter="statusFilter = $event"
      @save-edit="saveEdit"
      @translate-key="translateSingleKey"
      @ai-translate-all="aiTranslateAll"
      @fetch-translations="fetchTranslations"
    >
      <template #status>
        <SkeletonTable v-if="translationsLoading" label="Đang tải bản dịch" :rows="8" :cols="4" />
        <div v-else-if="translationsError" role="alert" class="bg-danger-bg text-danger px-4 py-2.5 rounded-lg text-[0.85rem] flex items-center justify-between gap-3">
          <span>{{ translationsError }}</span>
          <button type="button" class="shrink-0 text-sm font-bold underline text-danger bg-transparent border-0 cursor-pointer p-0 hover:no-underline" @click="fetchTranslations">Thử lại</button>
        </div>
      </template>
    </TranslationsTab>

    <!-- Universal Tab (self-contained, tự onMounted loadCoverage khi mount) -->
    <UniversalTab
      v-else-if="activeTab === 'universal'"
    />

    <!-- Hộp 1: chuyển ngôn ngữ đến vị trí khác (movingLang ở useLanguageWrites) -->
    <LanguagesMoveModal
      :open="showMoveModal"
      :moving-lang="movingLang"
      :languages="languages"
      @close="showMoveModal = false"
      @move="moveLanguageToPosition"
    />

    <!-- Hộp 2: Tiến trình Dịch AI (lượt dịch ở useLanguageBatchTranslate) -->
    <LanguagesTranslateProgressModal
      :open="showTranslateProgressModal"
      :title="progressModalTitle"
      :progress-stats="progressStats"
      :progress-log="progressLog"
      @close="showTranslateProgressModal = false"
      @stop="stopTranslate"
    />
  </div>
</template>
