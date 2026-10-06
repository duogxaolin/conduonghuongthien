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
 */

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
  id: number
  group: string
  key: string
  value: string
  isAiTranslated: boolean
}

const props = defineProps<{
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

// `editingKey`/`editingValue` chỉ dùng trong tab này — giữ nội bộ.
const editingKey = ref<string | null>(null)
const editingValue = ref('')

const filteredTranslations = computed(() => {
  let list = props.translations
  if (props.statusFilter === 'untranslated') {
    list = list.filter((t) => !t.value || !t.value.trim())
  } else if (props.statusFilter === 'translated') {
    list = list.filter((t) => t.value && t.value.trim())
  } else if (props.statusFilter === 'ai') {
    list = list.filter((t) => t.isAiTranslated)
  }
  if (!props.searchQuery) return list
  const s = props.searchQuery.toLowerCase()
  return list.filter(
    (t) => t.key.toLowerCase().includes(s) || (t.value || '').toLowerCase().includes(s),
  )
})

function startEdit(t: TranslationRow) {
  editingKey.value = `${t.group}::${t.key}`
  editingValue.value = t.value
}

function saveEdit(t: TranslationRow) {
  emit('save-edit', t, editingValue.value)
  editingKey.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Translation filters -->
    <div class="bg-white rounded-xl border border-[#e2ece3] p-4 flex flex-col sm:flex-row flex-wrap gap-3">
      <select
        :value="props.selectedLangCode"
        class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
        @change="emit('update:selectedLangCode', ($event.target as HTMLSelectElement).value); emit('fetch-translations')"
      >
        <option v-for="lang in props.languages.filter(l => l.isActive)" :key="lang.code" :value="lang.code">{{ lang.name }}</option>
      </select>
      <select
        :value="props.selectedGroup"
        class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
        @change="emit('update:selectedGroup', ($event.target as HTMLSelectElement).value); emit('fetch-translations')"
      >
        <option value="all">Tất cả nhóm</option>
        <option v-for="g in props.translationGroups" :key="g" :value="g">{{ g }}</option>
      </select>
      <select
        :value="props.statusFilter"
        class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
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
        placeholder="Tìm kiếm key hoặc giá trị..."
        class="flex-1 min-w-[200px] px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
        @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value); emit('fetch-translations')"
      />
      <span class="text-xs font-bold text-[#667768] self-center px-1 whitespace-nowrap">
        {{ filteredTranslations.length }} / {{ props.translations.length }} key
      </span>
      <button
        class="px-4 py-2.5 rounded-lg bg-[#1e4620] hover:bg-[#153317] text-white text-sm font-bold cursor-pointer border-none flex items-center gap-2 disabled:opacity-50"
        :disabled="props.translatingAll"
        @click="emit('ai-translate-all')"
      >
        <i class="fa-solid fa-wand-magic-sparkles"></i> {{ props.translatingAll ? 'Đang dịch...' : 'Dịch AI' }}
      </button>
    </div>

    <!-- Skeleton + error render ở cha (guard ghim translationsError/fetchTranslations
         ở pages/admin/languages/index.vue). Con chỉ mount khi đã có data. -->

    <!-- Translation table -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden shadow-xs">
      <!-- Mobile Card View -->
      <div class="md:hidden divide-y divide-[#eef2ee]">
        <div
          v-for="t in filteredTranslations"
          :key="'m-'+t.id"
          class="p-3.5 flex flex-col gap-2"
        >
          <div class="flex items-center justify-between gap-2">
            <code class="font-mono text-xs text-[#2c6e33] bg-[#f0f7f1] px-1.5 py-0.5 rounded break-all">{{ t.key }}</code>
            <div class="flex items-center gap-1.5 shrink-0">
              <span class="text-[0.65rem] font-bold bg-[#f4f7f4] text-[#667768] px-1.5 py-0.5 rounded">{{ t.group }}</span>
              <span v-if="t.isAiTranslated" class="px-1.5 py-0.5 rounded bg-[#e4f2e5] text-[#1e4620] text-[0.65rem] font-bold">AI</span>
            </div>
          </div>

          <div class="bg-[#fafcfa] border border-[#eef2ee] rounded-lg p-2 text-xs text-[#4A5545]">
            <span class="font-bold text-[#667768] block text-[0.68rem] mb-0.5">Tiếng Việt (Gốc):</span>
            {{ props.viTranslationsMap.get(`${t.group}::${t.key}`) || '—' }}
          </div>

          <div class="text-xs">
            <span class="font-bold text-[#667768] block text-[0.68rem] mb-0.5">Bản dịch ({{ props.selectedLangCode.toUpperCase() }}):</span>
            <div v-if="editingKey === `${t.group}::${t.key}`" class="flex flex-col gap-1.5 mt-1">
              <textarea v-model="editingValue" rows="2" class="w-full px-2.5 py-1.5 border border-[#c8d6c9] rounded-md text-sm outline-none focus:border-[#2c6e33] font-[inherit]"></textarea>
              <div class="flex gap-1.5">
                <button class="px-3 py-1 rounded-md bg-[#1e4620] text-white text-xs font-bold border-none cursor-pointer" @click="saveEdit(t)">Lưu</button>
                <button class="px-3 py-1 rounded-md border border-[#c8d6c9] bg-white text-xs font-semibold text-[#667768] cursor-pointer" @click="editingKey = null">Hủy</button>
              </div>
            </div>
            <div v-else class="text-[#1E251C] font-medium" :class="!t.value ? 'italic text-[#9ca3af]' : ''">
              {{ t.value || '(chưa có bản dịch)' }}
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 pt-1.5 border-t border-[#f4f7f4]">
            <button
              type="button"
              class="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#e4f2e5] border border-[#c8dcc9] text-[#1e4620] hover:bg-[#d6ecd8] cursor-pointer flex items-center gap-1 disabled:opacity-50"
              :disabled="props.translatingSingleKey === t.key"
              @click="emit('translate-key', t)"
            >
              <i class="fa-solid fa-wand-magic-sparkles text-[0.68rem]" :class="props.translatingSingleKey === t.key ? 'animate-spin' : ''"></i>
              <span>Dịch AI</span>
            </button>
            <button
              type="button"
              class="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white border border-[#c8d6c9] text-[#2c6e33] hover:bg-[#f0f7f1] cursor-pointer flex items-center gap-1"
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
                {{ props.viTranslationsMap.get(`${t.group}::${t.key}`) || '—' }}
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
                  <button
                    type="button"
                    class="px-2 py-1 rounded-md text-xs font-bold bg-[#e4f2e5] border border-[#c8dcc9] text-[#1e4620] hover:bg-[#d6ecd8] cursor-pointer flex items-center gap-1 transition-colors disabled:opacity-50"
                    :disabled="props.translatingSingleKey === t.key"
                    title="Dịch AI cho riêng khóa này"
                    @click="emit('translate-key', t)"
                  >
                    <i class="fa-solid fa-wand-magic-sparkles text-[0.68rem]" :class="props.translatingSingleKey === t.key ? 'animate-spin' : ''"></i>
                    <span class="sr-only sm:not-sr-only sm:inline-block">Dịch</span>
                  </button>
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
  </div>
</template>
