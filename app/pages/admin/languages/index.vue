<script setup lang="ts">
/**
 * Quản lý Ngôn ngữ — orchestrator. Tách 3 tab thành 3 component con (pattern
 * `default.vue` + `ai/index.vue`):
 *
 *  - `components/admin/languages/LanguagesListTab.vue` — card grid + form thêm
 *  - `components/admin/languages/TranslationsTab.vue` — bảng bản dịch UI
 *  - `components/admin/languages/UniversalTab.vue` — Dịch toàn cục (Auto-Scanner)
 *
 * Cha giữ: state chia sẻ (`languages`, `translations`, `viTranslationsMap`,
 * `selectedLangCode/Group`, `searchQuery`, `statusFilter`, `translationGroups`,
 * `translatingCards`, `translatingSingleKey`, `translatingAll`, `loading`,
 * `loadError`, `translationsError`/`translationsLoading`, `reordering`,
 * `syncing`, `seedingDefault`, `showTranslateProgressModal`, `progressStats`,
 * `progressLog`) + các hàm fetch + mutation + `startBatchTranslateWithProgress`.
 *
 * Hai guard test ghim ở file gốc (KHÔNG tách vào con theo plan rule #4):
 *  - `loadError` / `fetchLanguages` (LanguagesList)
 *  - `translationsError` / `fetchTranslations` (Translations)
 *
 * `getFlagEmoji` + maps flag đã tách ra `app/utils/language-flags.ts`.
 */
import { ref, onMounted } from 'vue'
import { useToast } from '~/composables/useToast'
import { errorMessage } from '~/utils/errorMessage'
import { getFlagEmoji } from '~/utils/language-flags'
import LanguagesListTab from '~/components/admin/languages/LanguagesListTab.vue'
import TranslationsTab from '~/components/admin/languages/TranslationsTab.vue'
import UniversalTab from '~/components/admin/languages/UniversalTab.vue'
import AdminModal from '~/components/admin/AdminModal.vue'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
})

const toast = useToast()
const { confirm } = useConfirm()

// ─── Language list (source of truth — LanguagesListTab nhận prop) ──────
const loading = ref(true)
const loadError = ref('')
const languages = ref<Array<{
  id: number; code: string; name: string; nativeName: string
  isActive: boolean; isDefault: boolean; displayOrder: number
  stats?: {
    totalKeys: number
    translatedKeys: number
    missingKeys: number
    aiKeys: number
    percent: number
  }
}>>([])

const activeTab = ref<'languages' | 'translations' | 'universal'>('languages')

async function fetchLanguages() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: typeof languages.value }>)(`/api/admin/languages`)
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
const translations = ref<Array<{
  id: number; group: string; key: string; value: string; isAiTranslated: boolean
}>>([])
const translationGroups = ref<string[]>([])
const selectedGroup = ref('all')
const searchQuery = ref('')
const selectedLangCode = ref('en')
const statusFilter = ref<'all' | 'untranslated' | 'translated' | 'ai'>('all')

const viTranslationsMap = ref<Map<string, string>>(new Map())

async function loadViSourceMap() {
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: Array<{ group: string; key: string; value: string }> }>)(`/api/admin/languages/vi/translations?limit=500`)
    if (res.ok) {
      const map = new Map<string, string>()
      for (const item of res.items) {
        map.set(`${item.group}::${item.key}`, item.value || '')
      }
      viTranslationsMap.value = map
    }
  } catch {
    // Non-critical
  }
}

async function fetchTranslations() {
  translationsLoading.value = true
  translationsError.value = ''
  try {
    const params: Record<string, string> = {}
    if (selectedGroup.value !== 'all') params.group = selectedGroup.value
    if (searchQuery.value) params.search = searchQuery.value
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{
      ok: boolean; items: typeof translations.value; groups: string[]
    }>)(`/api/admin/languages/${selectedLangCode.value}/translations`, { params })
    if (res.ok) {
      translations.value = res.items
      translationGroups.value = res.groups
    }
  } catch (err: unknown) {
    translationsError.value = errorMessage(err, 'Không thể tải bản dịch.')
  } finally {
    translationsLoading.value = false
  }
}

// ─── Mutations (cha xử lý API; con emit) ───────────────────────────────
async function addLanguage(data: { code: string; name: string; nativeName: string; displayOrder: number }) {
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/languages`, {
      method: 'POST',
      body: data,
    })
    toast.success('Đã thêm ngôn ngữ mới.')
    await fetchLanguages()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể thêm ngôn ngữ.'))
  }
}

async function toggleActive(lang: typeof languages.value[0]) {
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/languages/${lang.code}`, {
      method: 'PUT',
      body: { isActive: !lang.isActive },
    })
    toast.success(`Đã ${lang.isActive ? 'tắt' : 'bật'} ngôn ngữ.`)
    await fetchLanguages()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể cập nhật.'))
  }
}

async function setDefault(lang: typeof languages.value[0]) {
  if (lang.isDefault) return
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/languages/${lang.code}`, {
      method: 'PUT',
      body: { isDefault: true },
    })
    toast.success(`Đã đặt ${lang.name} làm ngôn ngữ mặc định.`)
    await fetchLanguages()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể đặt mặc định.'))
  }
}

async function deleteLanguage(lang: typeof languages.value[0]) {
  if (!await confirm({
    message: `Xoá ngôn ngữ "${lang.name}"? Tất cả bản dịch cho ngôn ngữ này cũng sẽ bị xoá.`,
    confirmLabel: 'Xoá ngôn ngữ',
    danger: true,
  })) return
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/languages/${lang.code}`, { method: 'DELETE' })
    toast.success('Đã xoá ngôn ngữ.')
    await fetchLanguages()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá.'))
  }
}

// ─── Reorder (LanguagesList emit shift-order / move-to-position) ──────
const showMoveModal = ref(false)
const movingLang = ref<typeof languages.value[0] | null>(null)
const reordering = ref(false)

function openMoveModal(lang: typeof languages.value[0]) {
  movingLang.value = lang
  showMoveModal.value = true
}

async function moveLanguageToPosition(targetIndex: number) {
  if (!movingLang.value) return
  const currentIdx = languages.value.findIndex((l) => l.code === movingLang.value!.code)
  if (currentIdx === -1 || currentIdx === targetIndex) {
    showMoveModal.value = false
    return
  }
  const list = [...languages.value]
  const [item] = list.splice(currentIdx, 1)
  if (item) list.splice(targetIndex, 0, item)
  languages.value = list
  showMoveModal.value = false
  await persistOrder(list)
}

async function shiftOrder(index: number, direction: 'up' | 'down') {
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= languages.value.length) return
  const list = [...languages.value]
  const item = list[index]!
  list[index] = list[targetIndex]!
  list[targetIndex] = item
  languages.value = list
  await persistOrder(list)
}

async function persistOrder(list: typeof languages.value) {
  reordering.value = true
  const orders = list.map((l, idx) => ({ code: l.code, displayOrder: idx }))
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/languages/reorder`, {
      method: 'POST',
      body: { orders },
    })
    toast.success('Đã cập nhật thứ tự ngôn ngữ thành công!')
    await fetchLanguages()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể lưu thứ tự.'))
  } finally {
    reordering.value = false
  }
}

// ─── Single key AI translation (TranslationsTab emit translate-key) ───
const translatingSingleKey = ref<string | null>(null)

async function translateSingleKey(t: typeof translations.value[0]) {
  translatingSingleKey.value = t.key
  const sourceText = viTranslationsMap.value.get(`${t.group}::${t.key}`) || t.key
  const currentLangObj = languages.value.find((l) => l.code === selectedLangCode.value)
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; value: string }>)(`/api/admin/languages/ai-translate-key`, {
      method: 'POST',
      body: {
        langCode: selectedLangCode.value,
        langName: currentLangObj?.name || selectedLangCode.value,
        group: t.group,
        key: t.key,
        sourceText,
      },
    })
    if (res.ok) {
      t.value = res.value
      t.isAiTranslated = true
      toast.success(`Đã dịch khóa "${t.key}" bằng AI!`)
      await fetchLanguages()
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, `Không thể dịch khóa "${t.key}".`))
  } finally {
    translatingSingleKey.value = null
  }
}

async function saveEdit(t: typeof translations.value[0], value: string) {
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/languages/${selectedLangCode.value}/translations`, {
      method: 'PUT',
      body: { items: [{ group: t.group, key: t.key, value }] },
    })
    toast.success('Đã lưu bản dịch.')
    await fetchTranslations()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể lưu.'))
  }
}

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

// ─── Batch AI translation with progress modal ────────────────────────
const showTranslateProgressModal = ref(false)
const progressModalTitle = ref('')
const progressStats = ref({
  done: 0,
  total: 0,
  percent: 0,
  currentKey: '',
  finished: false,
  stopped: false,
})
const progressLog = ref<Array<{ key: string; value: string; success: boolean }>>([])
let stopTranslateSignal = false

// `translatingCards` disable nút "Dịch AI" trên từng card language khi đang
// chạy batch cho ngôn ngữ đó. State ở cha vì `startBatchTranslateWithProgress`
// chạy ở cha; LanguageListTab nhận prop.
const translatingCards = reactive<Record<string, boolean>>({})
const syncing = ref(false)
const translatingAll = ref(false)

function stopTranslate() {
  stopTranslateSignal = true
  progressStats.value.stopped = true
}

async function startBatchTranslateWithProgress(langCode: string, langName: string) {
  stopTranslateSignal = false
  progressModalTitle.value = `Tiến trình Dịch AI: ${getFlagEmoji(langCode)} ${langName} (${langCode})`
  progressLog.value = []
  progressStats.value = {
    done: 0,
    total: 0,
    percent: 0,
    currentKey: 'Đang kiểm tra các key còn thiếu...',
    finished: false,
    stopped: false,
  }
  showTranslateProgressModal.value = true
  translatingCards[langCode] = true

  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: typeof translations.value }>)(`/api/admin/languages/${langCode}/translations?limit=500`)
    const missing = (res.items || []).filter((item) => !item.value || !item.value.trim())

    if (missing.length === 0) {
      progressStats.value.currentKey = 'Tất cả các key đã có bản dịch!'
      progressStats.value.finished = true
      toast.info(`Ngôn ngữ ${langName} đã có bản dịch đầy đủ 100%!`)
      return
    }

    progressStats.value.total = missing.length

    const CHUNK_SIZE = 10
    let processed = 0

    for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
      if (stopTranslateSignal) {
        progressStats.value.stopped = true
        toast.warning('Đã dừng tiến trình dịch AI.')
        break
      }

      const chunk = missing.slice(i, i + CHUNK_SIZE)
      progressStats.value.currentKey = `Đang dịch: ${chunk.map((c) => c.key).slice(0, 3).join(', ')}...`

      const payloadItems = chunk.map((item) => ({
        group: item.group,
        key: item.key,
        sourceText: viTranslationsMap.value.get(`${item.group}::${item.key}`) || item.key,
      }))

      try {
        const chunkRes = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; translated: Array<{ group: string; key: string; value: string }> }>)(`/api/admin/languages/ai-translate-chunk`, {
          method: 'POST',
          body: {
            langCode,
            langName,
            items: payloadItems,
          },
        })

        if (chunkRes.ok && Array.isArray(chunkRes.translated)) {
          for (const item of chunkRes.translated) {
            progressLog.value.unshift({ key: item.key, value: item.value, success: true })
          }
        }
      } catch {
        for (const item of chunk) {
          progressLog.value.unshift({ key: item.key, value: 'Lỗi dịch', success: false })
        }
      }

      processed = Math.min(i + CHUNK_SIZE, missing.length)
      progressStats.value.done = processed
      progressStats.value.percent = Math.round((processed / missing.length) * 100)
    }

    if (!stopTranslateSignal) {
      progressStats.value.finished = true
      progressStats.value.currentKey = 'Hoàn tất dịch thành công!'
      toast.success(`Đã hoàn tất dịch ${progressStats.value.done}/${progressStats.value.total} key cho ${langName}!`)
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi trong quá trình dịch AI.'))
  } finally {
    translatingCards[langCode] = false
    await loadData()
  }
}

async function aiTranslateAll() {
  const currentLangObj = languages.value.find((l) => l.code === selectedLangCode.value)
  const langName = currentLangObj?.name || selectedLangCode.value
  await startBatchTranslateWithProgress(selectedLangCode.value, langName)
}

async function oneTimeTranslate(lang: typeof languages.value[0]) {
  await startBatchTranslateWithProgress(lang.code, lang.name)
}

const seedingDefault = ref(false)
async function seedDefaultTranslations() {
  if (!await confirm({
    message: 'Hệ thống sẽ nạp lại 6 ngôn ngữ và toàn bộ các bản dịch mặc định (insert-only, không ghi đè dữ liệu bạn đã sửa). Tiếp tục?',
    confirmLabel: 'Nạp bản dịch mặc định',
  })) return
  seedingDefault.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>)(`/api/admin/languages/seed-default`, { method: 'POST' })
    toast.success(res.message || 'Đã nạp bản dịch mặc định thành công!')
    await Promise.all([fetchLanguages(), fetchTranslations()])
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể nạp bản dịch mặc định.'))
  } finally {
    seedingDefault.value = false
  }
}

async function syncAllLanguages() {
  syncing.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>)(`/api/admin/languages/sync`, { method: 'POST' })
    toast.success(res.message)
    await loadData()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể đồng bộ ngôn ngữ.'))
  } finally {
    syncing.value = false
  }
}

async function translateAllLanguagesMissing() {
  const targets = languages.value.filter((l) => l.isActive && !l.isDefault && (l.stats?.missingKeys || 0) > 0)
  if (targets.length === 0) {
    toast.info('Tất cả ngôn ngữ đang hoạt động đã được dịch đầy đủ 100%!')
    return
  }
  const names = targets.map((l) => l.name).join(', ')
  if (!await confirm({
    message: `Dịch AI tất cả các key còn thiếu cho ${targets.length} ngôn ngữ (${names})?`,
    confirmLabel: 'Dịch bằng AI',
  })) return

  translatingAll.value = true
  for (const lang of targets) {
    await startBatchTranslateWithProgress(lang.code, lang.name)
    if (stopTranslateSignal) break
  }
  translatingAll.value = false
  await loadData()
}

async function loadData() {
  await Promise.all([fetchLanguages(), fetchTranslations(), loadViSourceMap()])
}

// Universal tab self-contained: tự `onMounted(loadCoverage)` khi mount, cha
// không cần ref hay trigger — chỉ mount khi `activeTab === 'universal'`.

onMounted(() => {
  loadData().then(() => {
    if (languages.value.length > 0) {
      const nonDefault = languages.value.find((l) => l.code !== 'vi' && l.isActive)
      if (nonDefault) selectedLangCode.value = nonDefault.code
    }
  })
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Quản lý Ngôn ngữ</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Quản lý ngôn ngữ và bản dịch giao diện</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          class="px-3 py-2 rounded-lg border border-[#c8d6c9] bg-white text-[#1e4620] hover:bg-[#f0f7f1] text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
          :disabled="syncing"
          title="Đồng bộ tất cả các key từ ngôn ngữ mặc định sang các ngôn ngữ khác"
          @click="syncAllLanguages"
        >
          <i class="fa-solid fa-arrows-rotate text-xs" :class="syncing ? 'animate-spin' : ''"></i>
          <span>{{ syncing ? 'Đang đồng bộ...' : 'Đồng bộ key' }}</span>
        </button>

        <button
          type="button"
          class="px-3 py-2 rounded-lg bg-[#1e4620] hover:bg-[#153317] text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-colors border-none disabled:opacity-50 shadow-xs"
          :disabled="translatingAll"
          title="Dịch AI tất cả các key còn thiếu cho mọi ngôn ngữ đang hoạt động"
          @click="translateAllLanguagesMissing"
        >
          <i class="fa-solid fa-globe text-xs" :class="translatingAll ? 'animate-spin' : ''"></i>
          <span>{{ translatingAll ? 'Đang dịch tất cả...' : 'Dịch tất cả còn thiếu' }}</span>
        </button>

        <button
          type="button"
          class="px-3 py-2 rounded-lg border border-[#c8d6c9] bg-white text-[#667768] hover:bg-[#f0f7f1] text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
          :disabled="seedingDefault"
          title="Khôi phục hoặc nạp lại bản dịch mặc định ban đầu"
          @click="seedDefaultTranslations"
        >
          <i class="fa-solid fa-cloud-arrow-down text-xs" :class="seedingDefault ? 'animate-spin' : ''"></i>
          <span>{{ seedingDefault ? 'Đang nạp...' : 'Nạp mặc định' }}</span>
        </button>
      </div>
    </div>

    <!-- Info Banner -->
    <div class="rounded-xl border border-[#c8dcc9] bg-[#f0f7f1] p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[#1e4620]">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-circle-info text-base text-[#2c6e33] shrink-0"></i>
        <span><strong>Lưu ý:</strong> Sửa hoặc nạp bản dịch xong sẽ lưu ngay vào CSDL. Phía trang công khai sẽ tự động cập nhật khi người đọc tải lại trang hoặc chuyển ngôn ngữ.</span>
      </div>
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg border border-[#a2cca4] bg-white text-xs font-bold text-[#1e4620] hover:bg-[#e4ece4] transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-2xs"
        @click="loadData"
      >
        <i class="fa-solid fa-arrows-rotate text-[0.7rem]" :class="loading ? 'animate-spin' : ''"></i>
        <span>Làm mới CSDL</span>
      </button>
    </div>

    <!-- Tab Switcher -->
    <div class="flex gap-1 border-b border-[#e2ece3]">
      <button
        class="px-4 py-2.5 text-sm font-bold border-b-2 transition-colors cursor-pointer bg-transparent"
        :class="activeTab === 'languages' ? 'border-[#2c6e33] text-[#2c6e33]' : 'border-transparent text-[#667768] hover:text-[#122815]'"
        @click="activeTab = 'languages'"
      >
        <i class="fa-solid fa-globe mr-1.5"></i> Ngôn ngữ
      </button>
      <button
        class="px-4 py-2.5 text-sm font-bold border-b-2 transition-colors cursor-pointer bg-transparent"
        :class="activeTab === 'translations' ? 'border-[#2c6e33] text-[#2c6e33]' : 'border-transparent text-[#667768] hover:text-[#122815]'"
        @click="activeTab = 'translations'; fetchTranslations()"
      >
        <i class="fa-solid fa-language mr-1.5"></i> Bản dịch UI
      </button>
      <button
        class="px-4 py-2.5 text-sm font-bold border-b-2 transition-colors cursor-pointer bg-transparent flex items-center gap-1.5"
        :class="activeTab === 'universal' ? 'border-[#2c6e33] text-[#2c6e33]' : 'border-transparent text-[#667768] hover:text-[#122815]'"
        @click="activeTab = 'universal'"
      >
        <i class="fa-solid fa-wand-magic-sparkles text-xs"></i>
        <span>Dịch Toàn Cục (Auto-Scanner)</span>
      </button>
    </div>

    <!-- Skeleton + Error (Languages tab — guard ghim ở file gốc) -->
    <SkeletonTable v-if="loading && activeTab === 'languages'" label="Đang tải danh sách ngôn ngữ" :rows="4" :cols="5" />
    <div v-else-if="loadError && activeTab === 'languages'" role="alert" class="bg-[#ffebe9] text-[#d12420] px-4 py-2.5 rounded-lg text-[0.85rem] flex items-center justify-between gap-3">
      <span>{{ loadError }}</span>
      <button type="button" class="shrink-0 text-sm font-bold underline text-[#d12420] bg-transparent border-0 cursor-pointer p-0 hover:no-underline" @click="fetchLanguages">Thử lại</button>
    </div>

    <!-- Skeleton + Error (Translations tab — guard ghim translationsError/fetchTranslations ở file gốc) -->
    <SkeletonTable v-if="translationsLoading && activeTab === 'translations'" label="Đang tải bản dịch" :rows="8" :cols="4" />
    <div v-else-if="translationsError && activeTab === 'translations'" role="alert" class="bg-[#ffebe9] text-[#d12420] px-4 py-2.5 rounded-lg text-[0.85rem] flex items-center justify-between gap-3">
      <span>{{ translationsError }}</span>
      <button type="button" class="shrink-0 text-sm font-bold underline text-[#d12420] bg-transparent border-0 cursor-pointer p-0 hover:no-underline" @click="fetchTranslations">Thử lại</button>
    </div>

    <!-- Languages Tab -->
    <LanguagesListTab
      v-else-if="activeTab === 'languages'"
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

    <!-- Translations Tab (chỉ mount khi không loading/error — skeleton+error render ở cha) -->
    <TranslationsTab
      v-if="activeTab === 'translations' && !translationsLoading && !translationsError"
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
    />

    <!-- Universal Tab (self-contained, tự onMounted loadCoverage khi mount) -->
    <UniversalTab
      v-else-if="activeTab === 'universal'"
    />

    <!-- Modal 1: Đổi vị trí thứ tự ngôn ngữ (cha sở设立的 movingLang) -->
    <AdminModal
      :open="showMoveModal && !!movingLang"
      :title="movingLang ? `${getFlagEmoji(movingLang.code)} ${movingLang.nativeName} — chuyển đến vị trí nào?` : ''"
      size="sm"
      @close="showMoveModal = false"
    >
        <div v-if="movingLang">
          <p class="text-xs text-[#667768] mb-2.5">
            Bấm chọn số thứ tự bên dưới để chuyển ngôn ngữ <strong>{{ movingLang.name }}</strong> đến vị trí đó:
          </p>
          <div class="grid grid-cols-4 sm:grid-cols-6 gap-2">
            <button
              v-for="(_, idx) in languages"
              :key="idx"
              type="button"
              class="py-2.5 px-3 rounded-lg font-bold text-sm cursor-pointer transition-all border flex flex-col items-center justify-center gap-0.5"
              :class="languages[idx]?.code === movingLang.code
                ? 'bg-[#1e4620] text-white border-[#1e4620] shadow-sm'
                : 'bg-white hover:bg-[#f0f7f1] text-[#122815] border-[#c8d6c9] hover:border-[#2c6e33]'"
              @click="moveLanguageToPosition(idx)"
            >
              <span>{{ idx + 1 }}</span>
              <span class="text-[0.62rem] opacity-75 font-normal">
                {{ languages[idx]?.code === movingLang.code ? 'Hiện tại' : languages[idx]?.code.toUpperCase() }}
              </span>
            </button>
          </div>
        </div>

        <template #footer>
          <button
            type="button"
            class="px-4 py-2 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#667768] hover:bg-[#f8faf8] cursor-pointer"
            @click="showMoveModal = false"
          >
            Đóng
          </button>
        </template>
    </AdminModal>

    <!-- Modal 2: Tiến trình Dịch AI trực quan. Đang dịch = bận: Escape/✕/bấm nền không
         đóng (như trước — chỉ nút "Đóng cửa sổ" và "Dừng lại" ở chân). -->
    <AdminModal
      :open="showTranslateProgressModal"
      :title="progressModalTitle"
      icon="fa-solid fa-wand-magic-sparkles"
      :busy="!progressStats.finished && !progressStats.stopped"
      @close="showTranslateProgressModal = false"
    >
      <div class="flex flex-col gap-4">
        <p class="m-0 text-xs text-[#667768]">Dịch tự động các chuỗi giao diện qua AI Gateway</p>

        <div class="flex flex-col gap-2 bg-[#f8faf7] p-3.5 rounded-lg border border-[#e8efe6]">
          <div class="flex items-center justify-between text-xs font-bold">
            <span class="text-[#122815]">
              {{ progressStats.finished ? '✓ Hoàn tất bản dịch' : (progressStats.stopped ? '⏹ Đã dừng tiến trình' : 'Đang xử lý...') }}
            </span>
            <span class="text-[#1e4620] text-sm">{{ progressStats.percent }}%</span>
          </div>

          <div class="w-full h-2.5 bg-[#e2ece3] rounded-full overflow-hidden">
            <div
              class="h-full bg-[#2c6e33] transition-all duration-300 rounded-full"
              :class="!progressStats.finished && !progressStats.stopped ? 'animate-pulse motion-reduce:animate-none' : ''"
              :style="{ width: `${progressStats.percent}%` }"
            ></div>
          </div>

          <div class="flex items-center justify-between text-[0.72rem] text-[#667768]">
            <span>Đã dịch: <strong class="text-[#122815]">{{ progressStats.done }} / {{ progressStats.total }}</strong> key</span>
            <span class="truncate max-w-[220px]" :title="progressStats.currentKey">{{ progressStats.currentKey }}</span>
          </div>
        </div>

        <div>
          <h4 class="text-xs font-bold text-[#122815] mb-1.5 flex items-center justify-between">
            <span>Nhật ký dịch theo thời gian thực ({{ progressLog.length }} mục)</span>
            <span v-if="!progressStats.finished && !progressStats.stopped" class="text-[0.68rem] text-[#2c6e33] font-normal flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-[#2c6e33] animate-ping"></span> Đang nạp...
            </span>
          </h4>
          <div class="h-44 overflow-y-auto border border-[#e2ece3] rounded-lg p-2 bg-[#fcfdfc] flex flex-col gap-1 text-xs font-mono">
            <div
              v-for="(item, idx) in progressLog"
              :key="idx"
              class="px-2 py-1 rounded bg-white border flex items-start gap-1.5"
              :class="item.success ? 'border-[#e2ece3] text-[#122815]' : 'border-[#ffebe9] text-[#d12420]'"
            >
              <span class="font-bold shrink-0" :class="item.success ? 'text-[#2c6e33]' : 'text-[#d12420]'">
                {{ item.success ? '✓' : '✗' }}
              </span>
              <span class="font-semibold shrink-0 text-[#4A5545]">{{ item.key }}:</span>
              <span class="truncate text-[#667768]">{{ item.value }}</span>
            </div>
            <div v-if="progressLog.length === 0" class="text-center py-6 text-[#999] text-xs font-sans">
              Chưa có khóa nào được dịch trong phiên này...
            </div>
          </div>
        </div>

      </div>
      <template #footer>
          <button
            v-if="!progressStats.finished && !progressStats.stopped"
            type="button"
            class="mr-auto px-3.5 py-2 rounded-lg border border-[#e2c8c8] bg-white text-xs font-bold text-[#d12420] hover:bg-[#fff5f4] cursor-pointer flex items-center gap-1.5"
            @click="stopTranslate"
          >
            <i class="fa-solid fa-stop" aria-hidden="true"></i>
            <span>Dừng lại</span>
          </button>

          <button
            type="button"
            class="px-4 py-2 rounded-lg text-xs font-bold cursor-pointer"
            :class="progressStats.finished || progressStats.stopped
              ? 'bg-[#1e4620] hover:bg-[#153317] text-white border-0'
              : 'border border-[#c8d6c9] bg-white text-[#667768]'"
            @click="showTranslateProgressModal = false"
          >
            {{ progressStats.finished ? 'Hoàn tất & Đóng' : 'Đóng cửa sổ' }}
          </button>
      </template>
    </AdminModal>
  </div>
</template>
