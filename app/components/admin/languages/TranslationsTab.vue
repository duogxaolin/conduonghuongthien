<script setup lang="ts">
/**
 * Translations tab của trang Quản lý Ngôn ngữ — bảng bản dịch UI + filter +
 * edit inline + dịch AI từng key. Tách khỏi `pages/admin/languages/index.vue`.
 *
 * Cha giữ state chia sẻ (translations, translationsError, fetchTranslations,
 * selectedLangCode/Group, searchQuery, statusFilter, viTranslationsMap,
 * translatingSingleKey/All) vì: (1) guard test ghim `translationsError`/
 * `fetchTranslations` ở file gốc, (2) LanguagesList tab mutate
 * selectedLangCode/Group/searchQuery/statusFilter khi "Bảng dịch"/"Xem thiếu",
 * (3) `startBatchTranslateWithProgress` chạy ở cha cho cả 2 tab. Con chỉ giữ
 * `editingKey`/`editingValue` nội bộ.
 *
 * Tab luôn mount khi đang mở: bản cũ gỡ cả tab (kèm ô đang gõ) suốt mỗi lượt tải
 * lại — ô mất focus sau một ký tự. Slot `#status` (khung chờ / lỗi + "Thử lại" do cha
 * vẽ) chỉ thay BẢNG, và chỉ ở lượt tải đầu hoặc khi lỗi; các lượt tải lại sau giữ bảng
 * cũ với `aria-busy="true"` (không nháy khung chờ mỗi phím). Ô tìm kiếm gửi yêu cầu
 * sau `SEARCH_DEBOUNCE_MS` ngừng gõ, không phải mỗi phím. Tìm kiếm chạy ở máy chủ
 * trên mọi hàng (SQL, không phân biệt hoa thường/dấu); không lọc lần hai ở đây —
 * phép `includes` phía trình duyệt phân biệt dấu nên sẽ giấu hàng máy chủ đã khớp.
 * Hàng `id: null` là khoá tiếng Việt mà ngôn ngữ này chưa có hàng (máy chủ thêm vào
 * để "Xem thiếu" khớp số trên thẻ) — khoá `v-for` theo `group::key`.
 */

import { useToast } from '~/composables/useToast'

/** Ngừng gõ chừng này thì mới tìm (một yêu cầu, không phải một yêu cầu mỗi phím). */
const SEARCH_DEBOUNCE_MS = 300

interface LanguageRow {
  id: number
  code: string
  name: string
  nativeName: string
  isActive: boolean
  isDefault: boolean
  displayOrder: number
  stats?: { totalKeys: number; translatedKeys: number; missingKeys: number; aiKeys: number; percent: number }
}

interface TranslationRow {
  /** `null`: a vi key this language has no row for yet (saving it creates the row). */
  id: number | null
  /** The language the row was loaded under — edits and saves are bound to it. */
  langCode: string
  group: string
  key: string
  value: string
  isAiTranslated: boolean
}

const props = defineProps<{
  /** Một lượt tải danh sách đang chạy. */
  loading: boolean
  /** Lượt tải gần nhất lỗi: bảng nhường chỗ cho slot `#status` (thông báo + "Thử lại"). */
  failed: boolean
  languages: LanguageRow[]
  translations: TranslationRow[]
  translationGroups: string[]
  selectedLangCode: string
  selectedGroup: string
  searchQuery: string
  statusFilter: 'all' | 'untranslated' | 'translated' | 'ai'
  translatingSingleKey: string | null
  translatingAll: boolean
  viTranslationsMap: Map<string, string>
}>()

const emit = defineEmits<{
  'update:selectedLangCode': [code: string]
  'update:selectedGroup': [group: string]
  'update:searchQuery': [q: string]
  'update:statusFilter': [f: 'all' | 'untranslated' | 'translated' | 'ai']
  'save-edit': [t: TranslationRow, value: string]
  'translate-key': [t: TranslationRow]
  'ai-translate-all': []
  'fetch-translations': []
}>()

const toast = useToast()

// `editingKey`/`editingValue` chỉ dùng trong tab này — giữ nội bộ. `editingLang`: ngôn
// ngữ của HÀNG mà ô sửa được mở trên đó. Tab không bị gỡ mỗi lượt tải lại, và
// `editingKey` (`group::key`) giống nhau ở mọi ngôn ngữ: bản nháp mở trên hàng tiếng
// Anh từng hiện ở hàng tiếng Pháp cùng khoá và "Lưu" ghi nó thành tiếng Pháp (C1).
const editingKey = ref<string | null>(null)
const editingValue = ref('')
const editingLang = ref<string | null>(null)
function closeEditor() {
  editingKey.value = null
  editingValue.value = ''
  editingLang.value = null
}

// The skeleton stands in for the table only until the first answer; a later reload
// (a search, a filter) keeps the rows on screen, marked busy. A language switch is a
// FIRST load: the old language's rows must not stay on screen (and clickable) while the
// new ones load. Any open editor is closed with it.
const loadedOnce = ref(!props.loading)
watch(() => props.loading, (loading) => {
  if (!loading && !props.failed) loadedOnce.value = true
})
watch(() => props.selectedLangCode, () => {
  loadedOnce.value = false
  closeEditor()
})
const showStatus = computed(() => props.failed || (props.loading && !loadedOnce.value))

// One request once typing pauses; a select change fetches at once (with the current text).
let searchTimer: ReturnType<typeof setTimeout> | undefined
function cancelPendingSearch() {
  clearTimeout(searchTimer)
  searchTimer = undefined
}
function onSearchInput(value: string) {
  emit('update:searchQuery', value)
  cancelPendingSearch()
  searchTimer = setTimeout(() => {
    searchTimer = undefined
    emit('fetch-translations')
  }, SEARCH_DEBOUNCE_MS)
}
function fetchNow() {
  cancelPendingSearch()
  emit('fetch-translations')
}
onBeforeUnmount(cancelPendingSearch)

// Search is already applied by the server (see the header); only the status filter is local.
const filteredTranslations = computed(() => {
  const list = props.translations
  if (props.statusFilter === 'untranslated') return list.filter((t) => !t.value || !t.value.trim())
  if (props.statusFilter === 'translated') return list.filter((t) => t.value && t.value.trim())
  if (props.statusFilter === 'ai') return list.filter((t) => t.isAiTranslated)
  return list
})

function startEdit(t: TranslationRow) {
  // Rows on screen during a reload are about to be replaced: no edit starts on them
  // (the buttons are disabled too; this holds even if a click gets through).
  if (props.loading) return
  editingKey.value = `${t.group}::${t.key}`
  editingValue.value = t.value
  editingLang.value = t.langCode
}

function saveEdit(t: TranslationRow) {
  // The draft belongs to the row it was opened on. If the row now on screen under this
  // key is another language's, saving would write that draft there: refuse, no PUT.
  if (editingLang.value !== t.langCode) {
    closeEditor()
    toast.warning('Danh sách đã chuyển sang ngôn ngữ khác — chưa lưu. Mở lại ô sửa trên hàng đang hiện.')
    return
  }
  emit('save-edit', t, editingValue.value)
  closeEditor()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Translation filters -->
    <div class="bg-white rounded-xl border border-line p-4 flex flex-col sm:flex-row flex-wrap gap-3">
      <select
        :value="props.selectedLangCode"
        aria-label="Ngôn ngữ"
        class="px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
        @change="emit('update:selectedLangCode', ($event.target as HTMLSelectElement).value); fetchNow()"
      >
        <option v-for="lang in props.languages.filter(l => l.isActive)" :key="lang.code" :value="lang.code">{{ lang.name }}</option>
      </select>
      <select
        :value="props.selectedGroup"
        aria-label="Nhóm bản dịch"
        class="px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
        @change="emit('update:selectedGroup', ($event.target as HTMLSelectElement).value); fetchNow()"
      >
        <option value="all">Tất cả nhóm</option>
        <option v-for="g in props.translationGroups" :key="g" :value="g">{{ g }}</option>
      </select>
      <select
        :value="props.statusFilter"
        aria-label="Trạng thái bản dịch"
        class="px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
        @change="emit('update:statusFilter', ($event.target as HTMLSelectElement).value as 'all' | 'untranslated' | 'translated' | 'ai')"
      >
        <option value="all">Tất cả trạng thái</option>
        <option value="untranslated">Chưa dịch (trống)</option>
        <option value="translated">Đã có bản dịch</option>
        <option value="ai">Do AI dịch</option>
      </select>
      <input
        :value="props.searchQuery"
        type="text"
        aria-label="Tìm kiếm khoá hoặc bản dịch"
        placeholder="Tìm kiếm key hoặc giá trị..."
        class="flex-1 min-w-[200px] px-3.5 py-2.5 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
        @input="onSearchInput(($event.target as HTMLInputElement).value)"
      />
      <span class="text-xs font-bold text-ink-muted self-center px-1 whitespace-nowrap">
        {{ filteredTranslations.length }} / {{ props.translations.length }} key
      </span>
      <button
        class="px-4 py-2.5 rounded-lg bg-brand-900 hover:bg-[#153317] text-white text-sm font-bold cursor-pointer border-none flex items-center gap-2 disabled:opacity-50"
        :disabled="props.translatingAll"
        @click="emit('ai-translate-all')"
      >
        <i class="fa-solid fa-wand-magic-sparkles"></i> {{ props.translatingAll ? 'Đang dịch...' : 'Dịch AI' }}
      </button>
    </div>

    <!-- Live region for a reload: always present (one that appears already holding text is
         often not announced) and OUTSIDE the aria-busy table (whose updates screen readers
         hold back while it is busy). The first load's skeleton announces itself. -->
    <p role="status" class="sr-only">{{ props.loading && !showStatus ? 'Đang tải lại danh sách bản dịch…' : '' }}</p>

    <!-- Khung chờ (lượt tải đầu) + lỗi do cha vẽ (guard ghim translationsError/fetchTranslations
         ở pages/admin/languages/index.vue); chỉ thay bảng — bộ lọc phía trên giữ nguyên. -->
    <slot v-if="showStatus" name="status" />

    <!-- Translation table — tải lại thì giữ bảng cũ, đánh dấu bận; nút trên hàng tắt -->
    <div
      v-else
      class="bg-white rounded-xl border border-line overflow-hidden shadow-xs transition-opacity motion-reduce:transition-none"
      :class="props.loading ? 'opacity-60' : ''"
      :aria-busy="props.loading ? 'true' : undefined"
    >
      <!-- Mobile Card View -->
      <div class="md:hidden divide-y divide-[#eef2ee]">
        <p v-if="filteredTranslations.length === 0" class="m-0 p-6 text-center text-sm text-ink-muted">Không tìm thấy bản dịch</p>
        <div
          v-for="t in filteredTranslations"
          :key="`m-${t.group}::${t.key}`"
          class="p-3.5 flex flex-col gap-2"
        >
          <div class="flex items-center justify-between gap-2">
            <code class="font-mono text-xs text-brand-700 bg-surface-tint px-1.5 py-0.5 rounded break-all">{{ t.key }}</code>
            <div class="flex items-center gap-1.5 shrink-0">
              <span class="text-[0.65rem] font-bold bg-[#f4f7f4] text-ink-muted px-1.5 py-0.5 rounded">{{ t.group }}</span>
              <span v-if="t.isAiTranslated" class="px-1.5 py-0.5 rounded bg-[#e4f2e5] text-brand-900 text-[0.65rem] font-bold">AI</span>
            </div>
          </div>

          <div class="bg-[#fafcfa] border border-[#eef2ee] rounded-lg p-2 text-xs text-ink-secondary">
            <span class="font-bold text-ink-muted block text-[0.68rem] mb-0.5">Tiếng Việt (Gốc):</span>
            {{ props.viTranslationsMap.get(`${t.group}::${t.key}`) || '—' }}
          </div>

          <div class="text-xs">
            <span class="font-bold text-ink-muted block text-[0.68rem] mb-0.5">Bản dịch ({{ props.selectedLangCode.toUpperCase() }}):</span>
            <div v-if="editingKey === `${t.group}::${t.key}`" class="flex flex-col gap-1.5 mt-1">
              <textarea v-model="editingValue" rows="2" class="w-full px-2.5 py-1.5 border border-line-strong rounded-md text-sm outline-none focus:border-brand-700 font-[inherit]"></textarea>
              <div class="flex gap-1.5">
                <button class="px-3 py-1 rounded-md bg-brand-900 text-white text-xs font-bold border-none cursor-pointer" @click="saveEdit(t)">Lưu</button>
                <button class="px-3 py-1 rounded-md border border-line-strong bg-white text-xs font-semibold text-ink-muted cursor-pointer" @click="closeEditor">Hủy</button>
              </div>
            </div>
            <div v-else class="text-[#1E251C] font-medium" :class="!t.value ? 'italic text-[#9ca3af]' : ''">
              {{ t.value || '(chưa có bản dịch)' }}
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 pt-1.5 border-t border-[#f4f7f4]">
            <button
              type="button"
              class="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#e4f2e5] border border-[#c8dcc9] text-brand-900 hover:bg-[#d6ecd8] cursor-pointer flex items-center gap-1 disabled:opacity-50"
              :disabled="props.loading || props.translatingSingleKey === t.key"
              @click="emit('translate-key', t)"
            >
              <i class="fa-solid fa-wand-magic-sparkles text-[0.68rem]" :class="props.translatingSingleKey === t.key ? 'animate-spin' : ''"></i>
              <span>Dịch AI</span>
            </button>
            <button
              type="button"
              class="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white border border-line-strong text-brand-700 hover:bg-surface-tint cursor-pointer flex items-center gap-1 disabled:opacity-50"
              :disabled="props.loading"
              @click="startEdit(t)"
            >
              <i class="fa-solid fa-pen text-[0.68rem]"></i>
              <span>Sửa</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Desktop Table View -->
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface border-b border-line">
            <tr>
              <th class="px-4 py-3 text-left font-bold text-brand-950 w-[20%]">Khóa (Key)</th>
              <th class="px-4 py-3 text-left font-bold text-brand-950 w-[12%]">Nhóm</th>
              <th class="px-4 py-3 text-left font-bold text-brand-950 w-[30%]">Bản gốc (Tiếng Việt)</th>
              <th class="px-4 py-3 text-left font-bold text-brand-950">Bản dịch</th>
              <th class="px-4 py-3 text-center font-bold text-brand-950 w-[50px]">AI</th>
              <th class="px-4 py-3 text-center font-bold text-brand-950 w-[110px]">Thao tác</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#eef2ee]">
            <tr v-if="filteredTranslations.length === 0">
              <td colspan="6" class="px-4 py-8 text-center text-sm text-ink-muted">Không tìm thấy bản dịch</td>
            </tr>
            <tr v-for="t in filteredTranslations" :key="`${t.group}::${t.key}`" class="hover:bg-surface-tint">
              <td class="px-4 py-2.5 font-mono text-[0.78rem] text-ink-muted">{{ t.key }}</td>
              <td class="px-4 py-2.5 text-[0.78rem] text-ink-muted">{{ t.group }}</td>
              <td class="px-4 py-2.5 text-xs text-ink-secondary bg-[#fafcfa]">
                {{ props.viTranslationsMap.get(`${t.group}::${t.key}`) || '—' }}
              </td>
              <td class="px-4 py-2.5 text-ink">
                <div v-if="editingKey === `${t.group}::${t.key}`" class="flex flex-col gap-1">
                  <textarea v-model="editingValue" rows="2" class="w-full px-2.5 py-1.5 border border-line-strong rounded-md text-sm outline-none focus:border-brand-700 font-[inherit]"></textarea>
                  <div class="flex gap-1.5">
                    <button class="px-2.5 py-1 rounded-md bg-brand-900 text-white text-xs font-bold border-none cursor-pointer" @click="saveEdit(t)">Lưu</button>
                    <button class="px-2.5 py-1 rounded-md border border-line-strong bg-white text-xs font-semibold text-ink-muted cursor-pointer" @click="closeEditor">Hủy</button>
                  </div>
                </div>
                <span v-else :class="!t.value ? 'italic text-[#999]' : ''">{{ t.value || '(chưa dịch)' }}</span>
              </td>
              <td class="px-4 py-2.5 text-center">
                <span v-if="t.isAiTranslated" class="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-[#e4f2e5] text-brand-900 text-[0.65rem] font-bold">AI</span>
                <span v-else class="text-xs text-[#b8c4b8]">—</span>
              </td>
              <td class="px-4 py-2.5 text-center">
                <div class="flex items-center justify-center gap-1.5">
                  <button
                    type="button"
                    class="px-2 py-1 rounded-md text-xs font-bold bg-[#e4f2e5] border border-[#c8dcc9] text-brand-900 hover:bg-[#d6ecd8] cursor-pointer flex items-center gap-1 transition-colors disabled:opacity-50"
                    :disabled="props.loading || props.translatingSingleKey === t.key"
                    title="Dịch AI cho riêng khóa này"
                    @click="emit('translate-key', t)"
                  >
                    <i class="fa-solid fa-wand-magic-sparkles text-[0.68rem]" :class="props.translatingSingleKey === t.key ? 'animate-spin' : ''"></i>
                    <span class="sr-only sm:not-sr-only sm:inline-block">Dịch</span>
                  </button>
                  <button
                    type="button"
                    class="px-2 py-1 rounded-md text-xs font-semibold bg-white border border-line-strong text-brand-700 hover:bg-surface-tint cursor-pointer disabled:opacity-50"
                    :disabled="props.loading"
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
  </div>
</template>
