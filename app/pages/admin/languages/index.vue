<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToast } from '~/composables/useToast'
import { errorMessage } from '~/utils/errorMessage'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const toast = useToast()

// ─── Language list ──────────────────────────────────────────────────────
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

const activeTab = ref<'languages' | 'translations'>('languages')

async function fetchLanguages() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await $fetch<{ ok: boolean; items: typeof languages.value }>('/api/admin/languages')
    if (res.ok) languages.value = res.items
  } catch (err: unknown) {
    loadError.value = errorMessage(err, 'Không thể tải danh sách ngôn ngữ.')
  } finally {
    loading.value = false
  }
}

// ─── Add language ──────────────────────────────────────────────────────
const showAddForm = ref(false)
const newLang = ref({ code: '', name: '', nativeName: '', displayOrder: 0, flagEmoji: '' })

function onAddCodeInput() {
  const code = newLang.value.code.trim().toLowerCase()
  if (code.length >= 2) {
    const flag = getFlagEmoji(code)
    if (flag && flag !== '🌐' && !newLang.value.flagEmoji) {
      newLang.value.flagEmoji = flag
    }
  }
}

async function addLanguage() {
  if (!newLang.value.code || !newLang.value.name || !newLang.value.nativeName) {
    toast.error('Vui lòng nhập đầy đủ mã, tên và tên bản địa.')
    return
  }
  try {
    await $fetch('/api/admin/languages', {
      method: 'POST',
      body: {
        code: newLang.value.code.trim().toLowerCase(),
        name: newLang.value.name.trim(),
        nativeName: newLang.value.nativeName.trim(),
        displayOrder: newLang.value.displayOrder || 0,
      },
    })
    toast.success('Đã thêm ngôn ngữ mới.')
    showAddForm.value = false
    newLang.value = { code: '', name: '', nativeName: '', displayOrder: 0, flagEmoji: '' }
    await fetchLanguages()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể thêm ngôn ngữ.'))
  }
}
async function toggleActive(lang: typeof languages.value[0]) {
  try {
    await $fetch(`/api/admin/languages/${lang.code}`, {
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
    await $fetch(`/api/admin/languages/${lang.code}`, {
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
  if (!confirm(`Xoá ngôn ngữ "${lang.name}"? Tất cả bản dịch cho ngôn ngữ này cũng sẽ bị xoá.`)) return
  try {
    await $fetch(`/api/admin/languages/${lang.code}`, { method: 'DELETE' })
    toast.success('Đã xoá ngôn ngữ.')
    await fetchLanguages()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá.'))
  }
}

// ─── Translations tab ───────────────────────────────────────────────────
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

const FLAG_MAP: Record<string, string> = {
  vi: '🇻🇳',
  en: '🇬🇧',
  zh: '🇨🇳',
  fr: '🇫🇷',
  ru: '🇷🇺',
  lo: '🇱🇦',
  ja: '🇯🇵',
  ko: '🇰🇷',
  es: '🇪🇸',
  de: '🇩🇪',
  th: '🇹🇭',
  km: '🇰🇭',
  my: '🇲🇲',
  id: '🇮🇩',
  pt: '🇵🇹',
  it: '🇮🇹',
  ar: '🇸🇦',
}

const LANG_TO_COUNTRY: Record<string, string> = {
  vi: 'VN', en: 'GB', zh: 'CN', ja: 'JP', ko: 'KR', fr: 'FR', de: 'DE',
  es: 'ES', ru: 'RU', th: 'TH', id: 'ID', pt: 'PT', it: 'IT', ar: 'SA',
  pl: 'PL', tr: 'TR', nl: 'NL', sv: 'SE', da: 'DK', fi: 'FI', no: 'NO',
  cs: 'CZ', el: 'GR', he: 'IL', hi: 'IN', ms: 'MY', tl: 'PH', uk: 'UA',
  ro: 'RO', hu: 'HU', sk: 'SK', bg: 'BG', hr: 'HR', sr: 'RS', sl: 'SI',
  lo: 'LA', km: 'KH', my: 'MM', us: 'US',
}

function countryCodeToFlagEmoji(countryCode: string): string {
  const cc = countryCode.toUpperCase()
  if (cc.length !== 2) return ''
  return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65)
}

function getFlagEmoji(langCode: string): string {
  if (!langCode) return '🌐'
  const code = langCode.toLowerCase()
  if (FLAG_MAP[code]) return FLAG_MAP[code]!
  const cc = LANG_TO_COUNTRY[code]
  return cc ? countryCodeToFlagEmoji(cc) : '🌐'
}
const viTranslationsMap = ref<Map<string, string>>(new Map())

async function loadViSourceMap() {
  try {
    const res = await $fetch<{ ok: boolean; items: Array<{ group: string; key: string; value: string }> }>('/api/admin/languages/vi/translations?limit=500')
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


const filteredTranslations = computed(() => {
  let list = translations.value
  if (statusFilter.value === 'untranslated') {
    list = list.filter((t) => !t.value || !t.value.trim())
  } else if (statusFilter.value === 'translated') {
    list = list.filter((t) => t.value && t.value.trim())
  } else if (statusFilter.value === 'ai') {
    list = list.filter((t) => t.isAiTranslated)
  }
  if (!searchQuery.value) return list
  const s = searchQuery.value.toLowerCase()
  return list.filter(
    (t) => t.key.toLowerCase().includes(s) || (t.value || '').toLowerCase().includes(s),
  )
})

async function fetchTranslations() {
  translationsLoading.value = true
  translationsError.value = ''
  try {
    const params: Record<string, string> = {}
    if (selectedGroup.value !== 'all') params.group = selectedGroup.value
    if (searchQuery.value) params.search = searchQuery.value
    const res = await $fetch<{
      ok: boolean; items: typeof translations.value; groups: string[]
    }>(`/api/admin/languages/${selectedLangCode.value}/translations`, { params })
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

const editingKey = ref<string | null>(null)
const editingValue = ref('')

function startEdit(t: typeof translations.value[0]) {
  editingKey.value = `${t.group}::${t.key}`
  editingValue.value = t.value
}

async function saveEdit(t: typeof translations.value[0]) {
  try {
    await $fetch(`/api/admin/languages/${selectedLangCode.value}/translations`, {
      method: 'PUT',
      body: { items: [{ group: t.group, key: t.key, value: editingValue.value }] },
    })
    toast.success('Đã lưu bản dịch.')
    editingKey.value = null
    await fetchTranslations()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể lưu.'))
  }
}
// ─── Move / Reorder Language Position ──────────────────────────────────
const showMoveModal = ref(false)
const movingLang = ref<typeof languages.value[0] | null>(null)
const reordering = ref(false)

function openMoveModal(lang: typeof languages.value[0]) {
  movingLang.value = lang
  showMoveModal.value = true
}

async function moveLanguageToPosition(targetIndex: number) {
  if (!movingLang.value) return
  const currentIdx = languages.value.findIndex(l => l.code === movingLang.value!.code)
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
    await $fetch('/api/admin/languages/reorder', {
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

// ─── Single Key AI Translation ─────────────────────────────────────────
const translatingSingleKey = ref<string | null>(null)

async function translateSingleKey(t: typeof translations.value[0]) {
  translatingSingleKey.value = t.key
  const sourceText = viTranslationsMap.value.get(`${t.group}::${t.key}`) || t.key
  const currentLangObj = languages.value.find(l => l.code === selectedLangCode.value)
  try {
    const res = await $fetch<{ ok: boolean; value: string }>('/api/admin/languages/ai-translate-key', {
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
      await fetchLanguages() // Refresh stats
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, `Không thể dịch khóa "${t.key}".`))
  } finally {
    translatingSingleKey.value = null
  }
}

// ─── AI Translation with Real-time Progress Modal ──────────────────────
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

  try {
    const res = await $fetch<{ ok: boolean; items: typeof translations.value }>(`/api/admin/languages/${langCode}/translations?limit=500`)
    const missing = (res.items || []).filter(item => !item.value || !item.value.trim())

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
      progressStats.value.currentKey = `Đang dịch: ${chunk.map(c => c.key).slice(0, 3).join(', ')}...`

      const payloadItems = chunk.map(item => ({
        group: item.group,
        key: item.key,
        sourceText: viTranslationsMap.value.get(`${item.group}::${item.key}`) || item.key,
      }))

      try {
        const chunkRes = await $fetch<{ ok: boolean; translated: Array<{ group: string; key: string; value: string }> }>('/api/admin/languages/ai-translate-chunk', {
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
    await loadData()
  }
}

async function aiTranslateAll() {
  const currentLangObj = languages.value.find(l => l.code === selectedLangCode.value)
  const langName = currentLangObj?.name || selectedLangCode.value
  await startBatchTranslateWithProgress(selectedLangCode.value, langName)
}

const seedingDefault = ref(false)
async function seedDefaultTranslations() {
  if (!confirm('Hệ thống sẽ nạp lại 6 ngôn ngữ và toàn bộ các bản dịch mặc định (insert-only, không ghi đè dữ liệu bạn đã sửa). Tiếp tục?')) return
  seedingDefault.value = true
  try {
    const res = await $fetch<{ ok: boolean; message: string }>('/api/admin/languages/seed-default', { method: 'POST' })
    toast.success(res.message || 'Đã nạp bản dịch mặc định thành công!')
    await Promise.all([fetchLanguages(), fetchTranslations()])
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể nạp bản dịch mặc định.'))
  } finally {
    seedingDefault.value = false
  }
}

const translatingCards = reactive<Record<string, boolean>>({})
const syncing = ref(false)
const translatingAll = ref(false)

async function oneTimeTranslate(lang: typeof languages.value[0]) {
  await startBatchTranslateWithProgress(lang.code, lang.name)
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

async function syncAllLanguages() {
  syncing.value = true
  try {
    const res = await $fetch<{ ok: boolean; message: string }>('/api/admin/languages/sync', { method: 'POST' })
    toast.success(res.message)
    await loadData()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể đồng bộ ngôn ngữ.'))
  } finally {
    syncing.value = false
  }
}

async function translateAllLanguagesMissing() {
  const targets = languages.value.filter(l => l.isActive && !l.isDefault && (l.stats?.missingKeys || 0) > 0)
  if (targets.length === 0) {
    toast.info('Tất cả ngôn ngữ đang hoạt động đã được dịch đầy đủ 100%!')
    return
  }
  const names = targets.map(l => l.name).join(', ')
  if (!confirm(`Dịch AI tất cả các key còn thiếu cho ${targets.length} ngôn ngữ (${names})?`)) return

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
        <!-- Nút đồng bộ ngôn ngữ (Forum-style) -->
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

        <!-- Nút dịch tất cả ngôn ngữ còn thiếu (Forum-style) -->
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

        <!-- Nút nạp bản dịch mặc định -->
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

        <button
          type="button"
          class="px-3.5 py-2 rounded-lg bg-[#2c6e33] hover:bg-[#1e4620] text-white text-xs font-bold cursor-pointer border-none flex items-center gap-1.5 transition-colors shadow-xs"
          @click="showAddForm = !showAddForm"
        >
          <i class="fa-solid fa-plus text-xs"></i> Thêm ngôn ngữ
        </button>
      </div>
    </div>

    <!-- Info Banner (Forum-style clear explanation) -->
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
    </div>

    <!-- Add Language Form -->
    <div v-if="showAddForm" class="bg-white rounded-xl border border-[#e2ece3] p-5 flex flex-col gap-3 shadow-sm">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-[#122815] m-0">Thêm ngôn ngữ mới</h3>
        <span class="text-xs text-[#667768]">Hệ thống tự động gợi ý cờ quốc gia khi bạn gõ mã code ISO.</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div>
          <label class="block text-xs font-bold text-[#122815] mb-1">Mã (vd: ja, ko, de)</label>
          <input
            v-model="newLang.code"
            type="text"
            placeholder="vd: ja"
            class="w-full px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
            @input="onAddCodeInput"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-[#122815] mb-1">Cờ quốc gia (Emoji)</label>
          <input
            v-model="newLang.flagEmoji"
            type="text"
            placeholder="vd: 🇯🇵 (Tự động)"
            class="w-full px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-[#122815] mb-1">Tên quốc tế</label>
          <input
            v-model="newLang.name"
            type="text"
            placeholder="vd: Japanese"
            class="w-full px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-[#122815] mb-1">Tên bản địa</label>
          <input
            v-model="newLang.nativeName"
            type="text"
            placeholder="vd: 日本語"
            class="w-full px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-[#122815] mb-1">Thứ tự hiển thị</label>
          <input
            v-model.number="newLang.displayOrder"
            type="number"
            placeholder="0"
            class="w-full px-3 py-2 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
          />
        </div>
      </div>
      <div class="flex gap-2 pt-1">
        <button class="px-4 py-2 rounded-lg bg-[#2c6e33] hover:bg-[#1e4620] text-white text-sm font-bold border-none cursor-pointer" @click="addLanguage">Thêm ngôn ngữ</button>
        <button class="px-4 py-2 rounded-lg border border-[#c8d6c9] bg-white text-sm font-semibold text-[#667768] cursor-pointer hover:bg-[#f8faf8]" @click="showAddForm = false">Hủy</button>
      </div>
    </div>

    <!-- Loading -->
    <SkeletonTable v-if="loading && activeTab === 'languages'" label="Đang tải danh sách ngôn ngữ" :rows="4" :cols="5" />

    <!-- Error -->
    <div v-else-if="loadError && activeTab === 'languages'" role="alert" class="bg-[#ffebe9] text-[#d12420] px-4 py-2.5 rounded-lg text-[0.85rem] flex items-center justify-between gap-3">
      <span>{{ loadError }}</span>
      <button type="button" class="shrink-0 text-sm font-bold underline text-[#d12420] bg-transparent border-0 cursor-pointer p-0 hover:no-underline" @click="fetchLanguages">Thử lại</button>
    </div>

    <!-- Languages Tab -->
    <!-- Languages Tab: Forum-style Card Grid -->
    <div v-else-if="activeTab === 'languages'" class="flex flex-col gap-4">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="(lang, index) in languages"
          :key="lang.id"
          class="rounded-xl border bg-white p-4 flex flex-col justify-between gap-3 shadow-xs hover:shadow-md transition-all relative overflow-hidden"
          :class="lang.isDefault ? 'border-[#2c6e33] border-l-4' : 'border-[#e2ece3]'"
        >
          <!-- Top row: Order badge (interactive reorder) + Default / Active badge -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="inline-flex items-center justify-center min-w-7 h-7 px-1.5 rounded-md bg-[#f0f4f0] text-[#1e4620] font-bold text-xs border border-[#c8d6c9] hover:bg-[#e4ece4] hover:border-[#2c6e33] cursor-pointer transition-colors shadow-2xs group"
                title="Bấm để chuyển đổi vị trí thứ tự"
                @click="openMoveModal(lang)"
              >
                <span>#{{ index + 1 }}</span>
                <i class="fa-solid fa-arrows-up-down text-[0.6rem] ml-1 text-[#667768] group-hover:text-[#1e4620]"></i>
              </button>
              <div class="flex flex-col gap-0.5">
                <button
                  type="button"
                  :disabled="index === 0"
                  class="w-4 h-3 bg-white border border-[#c8d6c9] rounded-xs text-[0.52rem] text-[#667768] hover:text-[#1e4620] hover:bg-[#f0f7f1] flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed leading-none p-0"
                  title="Di chuyển lên trên"
                  @click="shiftOrder(index, 'up')"
                >▲</button>
                <button
                  type="button"
                  :disabled="index === languages.length - 1"
                  class="w-4 h-3 bg-white border border-[#c8d6c9] rounded-xs text-[0.52rem] text-[#667768] hover:text-[#1e4620] hover:bg-[#f0f7f1] flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed leading-none p-0"
                  title="Di chuyển xuống dưới"
                  @click="shiftOrder(index, 'down')"
                >▼</button>
              </div>
            </div>
            <div class="flex items-center gap-1.5">
              <span v-if="lang.isDefault" class="px-2 py-0.5 rounded-full bg-[#e4f2e5] text-[#1e4620] text-[0.65rem] font-bold uppercase tracking-wider">
                Mặc định
              </span>
              <button
                type="button"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-bold cursor-pointer border transition-colors"
                :class="lang.isActive ? 'bg-[#e4f2e5] text-[#1e4620] border-[#c8dcc9]' : 'bg-[#f5f5f5] text-[#999] border-[#e0e0e0]'"
                @click="toggleActive(lang)"
              >
                <span class="w-1.5 h-1.5 rounded-full" :class="lang.isActive ? 'bg-[#2c6e33]' : 'bg-[#ccc]'"></span>
                {{ lang.isActive ? 'Hoạt động' : 'Tắt' }}
              </button>
            </div>
          </div>

          <!-- Language Info -->
          <div>
            <div class="flex items-center gap-3">
              <span class="text-3xl leading-none">{{ getFlagEmoji(lang.code) }}</span>
              <div>
                <h4 class="m-0 text-base font-bold text-[#122815] flex items-center gap-1.5">
                  <span>{{ lang.nativeName }}</span>
                  <span class="text-xs font-mono font-normal text-[#667768]">({{ lang.code }})</span>
                </h4>
                <p class="m-0 text-xs text-[#667768]">{{ lang.name }}</p>
              </div>
            </div>
          </div>
          <!-- Translation Progress & Missing Keys (Forum-style on-card check) -->
          <div class="flex flex-col gap-1.5 bg-[#fcfdfc] p-2.5 rounded-lg border border-[#eef2ee]">
            <div class="flex items-center justify-between text-xs">
              <span class="text-[#667768] font-medium text-[0.75rem]">Tiến độ:</span>
              <span
                class="font-bold text-[0.72rem]"
                :class="(lang.stats?.missingKeys || 0) === 0 ? 'text-[#2c6e33]' : 'text-[#b78103]'"
              >
                {{ (lang.stats?.missingKeys || 0) === 0 ? '✓ Đã hoàn tất 100%' : `Còn thiếu ${lang.stats?.missingKeys} key (${lang.stats?.percent || 0}%)` }}
              </span>
            </div>

            <!-- Progress bar -->
            <div class="w-full h-1.5 bg-[#e2ece3] rounded-full overflow-hidden">
              <div
                class="h-full transition-all duration-500 rounded-full"
                :class="(lang.stats?.missingKeys || 0) === 0 ? 'bg-[#2c6e33]' : 'bg-[#b78103]'"
                :style="{ width: `${lang.stats?.percent || 0}%` }"
              ></div>
            </div>

            <div class="flex items-center justify-between text-[0.68rem] text-[#667768] mt-0.5">
              <span>Đã dịch: <strong class="text-[#122815]">{{ lang.stats?.translatedKeys || 0 }}/{{ lang.stats?.totalKeys || 0 }}</strong></span>
              <span v-if="(lang.stats?.aiKeys || 0) > 0" class="text-[#2c6e33] font-medium">AI: {{ lang.stats?.aiKeys }}</span>
            </div>
          </div>

          <!-- Action buttons (Forum-style with one-time translate and missing key inspection) -->
          <div class="flex items-center gap-1.5 pt-2 border-t border-[#eef2ee] flex-wrap">
            <!-- Nút dịch One-time ngay trên card nếu còn key thiếu -->
            <button
              v-if="lang.code !== 'vi' && (lang.stats?.missingKeys || 0) > 0"
              type="button"
              class="px-2.5 py-1 rounded-md bg-[#2c6e33] hover:bg-[#1e4620] text-white text-xs font-bold border-none cursor-pointer flex items-center gap-1 transition-colors disabled:opacity-50 shadow-2xs"
              :disabled="translatingCards[lang.code]"
              title="Dịch AI một lần (One-time) tất cả các key còn thiếu của ngôn ngữ này"
              @click="oneTimeTranslate(lang)"
            >
              <i class="fa-solid fa-wand-magic-sparkles text-[0.68rem]" :class="translatingCards[lang.code] ? 'animate-spin' : ''"></i>
              <span>{{ translatingCards[lang.code] ? 'Đang dịch...' : `Dịch AI (${lang.stats?.missingKeys})` }}</span>
            </button>

            <!-- Nút kiểm tra xem còn bao nhiêu key chưa dịch (nhảy sang tab bản dịch lọc untranslated) -->
            <button
              v-if="(lang.stats?.missingKeys || 0) > 0"
              type="button"
              class="px-2 py-1 rounded-md border border-[#ffe082] bg-[#fff8e1] text-[#b78103] hover:bg-[#ffecb3] text-xs font-bold cursor-pointer flex items-center gap-1"
              title="Xem danh sách các key chưa dịch"
              @click="inspectMissingKeys(lang.code)"
            >
              <i class="fa-solid fa-list-check text-[0.65rem]"></i> Xem thiếu
            </button>

            <!-- Sửa bản dịch -->
            <button
              type="button"
              class="px-2 py-1 rounded-md border border-[#c8d6c9] bg-white text-[#1e4620] hover:bg-[#f0f7f1] text-xs font-semibold cursor-pointer flex items-center gap-1"
              @click="openTranslationTabFor(lang.code)"
            >
              <i class="fa-solid fa-table-list text-[0.68rem]"></i> Bảng dịch
            </button>

            <button
              v-if="!lang.isDefault"
              type="button"
              class="px-2 py-1 rounded-md border border-[#c8d6c9] bg-white text-[#667768] hover:bg-[#f0f7f1] text-xs font-semibold cursor-pointer"
              title="Đặt làm mặc định"
              @click="setDefault(lang)"
            >
              <i class="fa-regular fa-star text-[0.68rem]"></i>
            </button>

            <button
              v-if="!lang.isDefault"
              type="button"
              class="px-2 py-1 rounded-md border border-[#e2c8c8] bg-white text-[#d12420] hover:bg-[#fff5f4] text-xs font-semibold cursor-pointer"
              title="Xoá ngôn ngữ"
              @click="deleteLanguage(lang)"
            >
              <i class="fa-solid fa-trash text-[0.68rem]"></i>
            </button>
          </div>
        </div>

        <!-- Add new language dashed card -->
        <div
          class="rounded-xl border-2 border-dashed border-[#c8d6c9] hover:border-[#2c6e33] bg-[#fafcfa] hover:bg-[#f0f7f1] p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all min-h-[140px] text-center"
          @click="showAddForm = !showAddForm"
        >
          <div class="w-10 h-10 rounded-full bg-white border border-[#c8d6c9] flex items-center justify-center text-[#2c6e33] text-lg shadow-2xs">
            <i class="fa-solid fa-plus"></i>
          </div>
          <span class="text-sm font-bold text-[#1e4620]">Thêm ngôn ngữ mới</span>
          <span class="text-xs text-[#667768]">Bấm để thêm ngôn ngữ quốc tế khác</span>
        </div>
      </div>
    </div>

    <!-- Translations Tab -->
    <div v-if="activeTab === 'translations'" class="flex flex-col gap-4">
      <!-- Translation filters -->
      <div class="bg-white rounded-xl border border-[#e2ece3] p-4 flex flex-col sm:flex-row flex-wrap gap-3">
        <select v-model="selectedLangCode" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]" @change="fetchTranslations">
          <option v-for="lang in languages.filter(l => l.isActive)" :key="lang.code" :value="lang.code">{{ lang.name }}</option>
        </select>
        <select v-model="selectedGroup" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]" @change="fetchTranslations">
          <option value="all">Tất cả nhóm</option>
          <option v-for="g in translationGroups" :key="g" :value="g">{{ g }}</option>
        </select>
        <select v-model="statusFilter" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]">
          <option value="all">Tất cả trạng thái</option>
          <option value="untranslated">Chưa dịch (trống)</option>
          <option value="translated">Đã có bản dịch</option>
          <option value="ai">Do AI dịch</option>
        </select>
        <input v-model="searchQuery" type="text" placeholder="Tìm kiếm key hoặc giá trị..." class="flex-1 min-w-[200px] px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]" @input="fetchTranslations" />
        <span class="text-xs font-bold text-[#667768] self-center px-1 whitespace-nowrap">
          {{ filteredTranslations.length }} / {{ translations.length }} key
        </span>
        <button
          class="px-4 py-2.5 rounded-lg bg-[#1e4620] hover:bg-[#153317] text-white text-sm font-bold cursor-pointer border-none flex items-center gap-2 disabled:opacity-50"
          :disabled="aiTranslating"
          @click="aiTranslateAll"
        >
          <i class="fa-solid fa-wand-magic-sparkles"></i> {{ aiTranslating ? 'Đang dịch...' : 'Dịch AI' }}
        </button>
      </div>

      <!-- Skeleton -->
      <SkeletonTable v-if="translationsLoading" label="Đang tải bản dịch" :rows="8" :cols="4" />

      <!-- Error -->
      <div v-else-if="translationsError" role="alert" class="bg-[#ffebe9] text-[#d12420] px-4 py-2.5 rounded-lg text-[0.85rem] flex items-center justify-between gap-3">
        <span>{{ translationsError }}</span>
        <button type="button" class="shrink-0 text-sm font-bold underline text-[#d12420] bg-transparent border-0 cursor-pointer p-0 hover:no-underline" @click="fetchTranslations">Thử lại</button>
      </div>

      <!-- Translation table -->
      <div v-else class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-[#f8faf7] border-b border-[#e2ece3]">
            <tr>
              <th class="px-4 py-3 text-left font-bold text-[#122815] w-[20%]">Khóa (Key)</th>
              <th class="px-4 py-3 text-left font-bold text-[#122815] w-[12%]">Nhóm</th>
              <th class="px-4 py-3 text-left font-bold text-[#122815] w-[30%]">Bản gốc (Tiếng Việt)</th>
              <th class="px-4 py-3 text-left font-bold text-[#122815]">Bản dịch</th>
              <th class="px-4 py-3 text-center font-bold text-[#122815] w-[50px]">AI</th>
              <th class="px-4 py-3 text-center font-bold text-[#122815] w-[110px]">Thao tác</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#eef2ee]">
            <tr v-for="t in filteredTranslations" :key="t.id" class="hover:bg-[#f0f7f1]">
              <td class="px-4 py-2.5 font-mono text-[0.78rem] text-[#667768]">{{ t.key }}</td>
              <td class="px-4 py-2.5 text-[0.78rem] text-[#667768]">{{ t.group }}</td>
              <td class="px-4 py-2.5 text-xs text-[#4A5545] bg-[#fafcfa]">
                {{ viTranslationsMap.get(`${t.group}::${t.key}`) || '—' }}
              </td>
              <td class="px-4 py-2.5 text-[#1E251C]">
                <div v-if="editingKey === `${t.group}::${t.key}`" class="flex flex-col gap-1">
                  <textarea v-model="editingValue" rows="2" class="w-full px-2.5 py-1.5 border border-[#c8d6c9] rounded-md text-sm outline-none focus:border-[#2c6e33] font-[inherit]"></textarea>
                  <div class="flex gap-1.5">
                    <button class="px-2.5 py-1 rounded-md bg-[#1e4620] text-white text-xs font-bold border-none cursor-pointer" @click="saveEdit(t)">Lưu</button>
                    <button class="px-2.5 py-1 rounded-md border border-[#c8d6c9] bg-white text-xs font-semibold text-[#667768] cursor-pointer" @click="editingKey = null">Hủy</button>
                  </div>
                </div>
                <span v-else :class="!t.value ? 'italic text-[#999]' : ''">{{ t.value || '(chưa dịch)' }}</span>
              </td>
              <td class="px-4 py-2.5 text-center">
                <span v-if="t.isAiTranslated" class="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-[#e4f2e5] text-[#1e4620] text-[0.65rem] font-bold">AI</span>
                <span v-else class="text-xs text-[#b8c4b8]">—</span>
              </td>
              <td class="px-4 py-2.5 text-center">
                <div class="flex items-center justify-center gap-1.5">
                  <!-- Nút dịch AI cho riêng khóa này -->
                  <button
                    type="button"
                    class="px-2 py-1 rounded-md text-xs font-bold bg-[#e4f2e5] border border-[#c8dcc9] text-[#1e4620] hover:bg-[#d6ecd8] cursor-pointer flex items-center gap-1 transition-colors disabled:opacity-50"
                    :disabled="translatingSingleKey === t.key"
                    title="Dịch AI cho riêng khóa này"
                    @click="translateSingleKey(t)"
                  >
                    <i class="fa-solid fa-wand-magic-sparkles text-[0.68rem]" :class="translatingSingleKey === t.key ? 'animate-spin' : ''"></i>
                    <span class="sr-only sm:not-sr-only sm:inline-block">Dịch</span>
                  </button>

                  <!-- Nút sửa thủ công -->
                  <button
                    type="button"
                    class="px-2 py-1 rounded-md text-xs font-semibold bg-white border border-[#c8d6c9] text-[#2c6e33] hover:bg-[#f0f7f1] cursor-pointer"
                    title="Sửa bản dịch"
                    @click="startEdit(t)"
                  >
                    <i class="fa-solid fa-pen text-[0.7rem]"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal 1: Đổi vị trí thứ tự ngôn ngữ -->
    <div
      v-if="showMoveModal && movingLang"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      @click.self="showMoveModal = false"
    >
      <div class="w-full max-w-sm rounded-xl border border-[#e2ece3] bg-white p-5 shadow-lg flex flex-col gap-4">
        <div class="flex items-center justify-between border-b border-[#eef2ee] pb-3">
          <div class="flex items-center gap-2">
            <span class="text-2xl">{{ getFlagEmoji(movingLang.code) }}</span>
            <div>
              <h3 class="m-0 text-base font-bold text-[#122815]">{{ movingLang.nativeName }}</h3>
              <p class="m-0 text-xs text-[#667768]">Chuyển đến vị trí nào?</p>
            </div>
          </div>
          <button
            type="button"
            class="text-[#667768] hover:text-[#122815] border-0 bg-transparent cursor-pointer p-1 text-base"
            @click="showMoveModal = false"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div>
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

        <div class="flex justify-end pt-2 border-t border-[#eef2ee]">
          <button
            type="button"
            class="px-4 py-2 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#667768] hover:bg-[#f8faf8] cursor-pointer"
            @click="showMoveModal = false"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>

    <!-- Modal 2: Tiến trình Dịch AI trực quan -->
    <div
      v-if="showTranslateProgressModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      @click.self="progressStats.finished || progressStats.stopped ? showTranslateProgressModal = false : null"
    >
      <div class="w-full max-w-lg rounded-xl border border-[#e2ece3] bg-white p-5 shadow-xl flex flex-col gap-4">
        <!-- Modal Header -->
        <div class="flex items-center justify-between border-b border-[#eef2ee] pb-3">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg bg-[#e4f2e5] text-[#1e4620] flex items-center justify-center text-sm">
              <i class="fa-solid fa-wand-magic-sparkles" :class="!progressStats.finished && !progressStats.stopped ? 'animate-spin' : ''"></i>
            </div>
            <div>
              <h3 class="m-0 text-[1.05rem] font-bold text-[#122815]">{{ progressModalTitle }}</h3>
              <p class="m-0 text-xs text-[#667768]">Dịch tự động các chuỗi giao diện qua AI Gateway</p>
            </div>
          </div>
          <button
            v-if="progressStats.finished || progressStats.stopped"
            type="button"
            class="text-[#667768] hover:text-[#122815] border-0 bg-transparent cursor-pointer p-1 text-base"
            @click="showTranslateProgressModal = false"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <!-- Progress bar & metrics -->
        <div class="flex flex-col gap-2 bg-[#f8faf7] p-3.5 rounded-lg border border-[#e8efe6]">
          <div class="flex items-center justify-between text-xs font-bold">
            <span class="text-[#122815]">
              {{ progressStats.finished ? '✓ Hoàn tất bản dịch' : (progressStats.stopped ? '⏹ Đã dừng tiến trình' : 'Đang xử lý...') }}
            </span>
            <span class="text-[#1e4620] text-sm">{{ progressStats.percent }}%</span>
          </div>

          <!-- The animated progress bar -->
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

        <!-- Live translated keys log -->
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

        <!-- Modal Footer Actions -->
        <div class="flex items-center justify-between pt-2 border-t border-[#eef2ee]">
          <button
            v-if="!progressStats.finished && !progressStats.stopped"
            type="button"
            class="px-3.5 py-2 rounded-lg border border-[#e2c8c8] bg-white text-xs font-bold text-[#d12420] hover:bg-[#fff5f4] cursor-pointer flex items-center gap-1.5"
            @click="stopTranslate"
          >
            <i class="fa-solid fa-stop"></i>
            <span>Dừng lại</span>
          </button>
          <div v-else></div>

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
        </div>
      </div>
    </div>
  </div>
</template>
