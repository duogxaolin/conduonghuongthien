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
const newLang = ref({ code: '', name: '', nativeName: '', displayOrder: 0 })

async function addLanguage() {
  if (!newLang.value.code || !newLang.value.name || !newLang.value.nativeName) {
    toast.error('Vui lòng nhập đầy đủ mã, tên và tên bản địa.')
    return
  }
  try {
    await $fetch('/api/admin/languages', {
      method: 'POST',
      body: newLang.value,
    })
    toast.success('Đã thêm ngôn ngữ mới.')
    showAddForm.value = false
    newLang.value = { code: '', name: '', nativeName: '', displayOrder: 0 }
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

const filteredTranslations = computed(() => {
  if (!searchQuery.value) return translations.value
  const s = searchQuery.value.toLowerCase()
  return translations.value.filter(
    (t) => t.key.toLowerCase().includes(s) || t.value.toLowerCase().includes(s),
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

const aiTranslating = ref(false)
async function aiTranslateAll() {
  if (!confirm(`Dịch tất cả key chưa có bản dịch sang ngôn ngữ "${selectedLangCode.value}" bằng AI?`)) return
  aiTranslating.value = true
  try {
    const res = await $fetch<{ ok: boolean; translated: number; total: number }>('/api/admin/languages/ai-translate', {
      method: 'POST',
      body: { langCode: selectedLangCode.value },
    })
    if (res.ok) {
      toast.success(`Đã dịch ${res.translated}/${res.total} key.`)
      await fetchTranslations()
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể dịch bằng AI.'))
  } finally {
    aiTranslating.value = false
  }
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

onMounted(() => {
  fetchLanguages().then(() => {
    if (languages.value.length > 0) {
      const nonDefault = languages.value.find((l) => l.code !== 'vi' && l.isActive)
      if (nonDefault) selectedLangCode.value = nonDefault.code
    }
    fetchTranslations()
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
          class="px-3.5 py-2.5 rounded-lg border border-[#c8d6c9] bg-white text-[#1e4620] hover:bg-[#f0f7f1] text-sm font-bold cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
          :disabled="seedingDefault"
          @click="seedDefaultTranslations"
        >
          <i class="fa-solid fa-cloud-arrow-down" :class="seedingDefault ? 'animate-spin' : ''"></i>
          <span>{{ seedingDefault ? 'Đang nạp...' : 'Nạp bản dịch mặc định' }}</span>
        </button>
        <button
          type="button"
          class="px-4 py-2.5 rounded-lg bg-[#2c6e33] hover:bg-[#1e4620] text-white text-sm font-bold cursor-pointer border-none flex items-center gap-2 transition-colors"
          @click="showAddForm = !showAddForm"
        >
          <i class="fa-solid fa-plus"></i> Thêm ngôn ngữ
        </button>
      </div>
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
    <div v-if="showAddForm" class="bg-white rounded-xl border border-[#e2ece3] p-5 flex flex-col gap-3">
      <h3 class="text-sm font-bold text-[#122815] m-0">Thêm ngôn ngữ mới</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <input v-model="newLang.code" type="text" placeholder="Mã (vd: en)" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]" />
        <input v-model="newLang.name" type="text" placeholder="Tên (vd: English)" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]" />
        <input v-model="newLang.nativeName" type="text" placeholder="Tên bản địa (vd: English)" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]" />
        <input v-model.number="newLang.displayOrder" type="number" placeholder="Thứ tự" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]" />
      </div>
      <div class="flex gap-2">
        <button class="px-4 py-2 rounded-lg bg-[#2c6e33] hover:bg-[#1e4620] text-white text-sm font-bold border-none cursor-pointer" @click="addLanguage">Thêm</button>
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
    <div v-else-if="activeTab === 'languages'" class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-[#f8faf7] border-b border-[#e2ece3]">
          <tr>
            <th class="px-4 py-3 text-left font-bold text-[#122815]">Ngôn ngữ</th>
            <th class="px-4 py-3 text-left font-bold text-[#122815]">Mã</th>
            <th class="px-4 py-3 text-left font-bold text-[#122815]">Tên bản địa</th>
            <th class="px-4 py-3 text-center font-bold text-[#122815]">Trạng thái</th>
            <th class="px-4 py-3 text-center font-bold text-[#122815]">Thao tác</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[#eef2ee]">
          <tr v-for="lang in languages" :key="lang.id" class="hover:bg-[#f0f7f1]">
            <td class="px-4 py-3 font-semibold text-[#122815]">
              {{ lang.name }}
              <span v-if="lang.isDefault" class="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-sm bg-[#e4f2e5] text-[#1e4620] text-[0.65rem] font-bold uppercase">Mặc định</span>
            </td>
            <td class="px-4 py-3 text-[#667768] font-mono">{{ lang.code }}</td>
            <td class="px-4 py-3 text-[#667768]">{{ lang.nativeName }}</td>
            <td class="px-4 py-3 text-center">
              <button
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer border transition-colors"
                :class="lang.isActive ? 'bg-[#e4f2e5] text-[#1e4620] border-[#c8dcc9]' : 'bg-[#f5f5f5] text-[#999] border-[#e0e0e0]'"
                @click="toggleActive(lang)"
              >
                <span class="w-1.5 h-1.5 rounded-full" :class="lang.isActive ? 'bg-[#2c6e33]' : 'bg-[#ccc]'"></span>
                {{ lang.isActive ? 'Bật' : 'Tắt' }}
              </button>
            </td>
            <td class="px-4 py-3 text-center">
              <div class="flex items-center justify-center gap-1.5">
                <button v-if="!lang.isDefault" class="px-2 py-1 rounded-md text-xs font-semibold bg-white border border-[#c8d6c9] text-[#2c6e33] hover:bg-[#f0f7f1] cursor-pointer" @click="setDefault(lang)">Đặt mặc định</button>
                <button v-if="!lang.isDefault" class="px-2 py-1 rounded-md text-xs font-semibold bg-white border border-[#e2c8c8] text-[#d12420] hover:bg-[#fff5f4] cursor-pointer" @click="deleteLanguage(lang)">
                  <i class="fa-solid fa-trash text-[0.7rem]"></i>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
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
        <input v-model="searchQuery" type="text" placeholder="Tìm kiếm key hoặc giá trị..." class="flex-1 min-w-[200px] px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]" @input="fetchTranslations" />
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
              <th class="px-4 py-3 text-left font-bold text-[#122815] w-[25%]">Key</th>
              <th class="px-4 py-3 text-left font-bold text-[#122815] w-[15%]">Nhóm</th>
              <th class="px-4 py-3 text-left font-bold text-[#122815]">Giá trị</th>
              <th class="px-4 py-3 text-center font-bold text-[#122815] w-[80px]">AI</th>
              <th class="px-4 py-3 text-center font-bold text-[#122815] w-[80px]">Sửa</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#eef2ee]">
            <tr v-for="t in filteredTranslations" :key="t.id" class="hover:bg-[#f0f7f1]">
              <td class="px-4 py-2.5 font-mono text-[0.8rem] text-[#667768]">{{ t.key }}</td>
              <td class="px-4 py-2.5 text-[0.8rem] text-[#667768]">{{ t.group }}</td>
              <td class="px-4 py-2.5 text-[#1E251C]">
                <div v-if="editingKey === `${t.group}::${t.key}`" class="flex flex-col gap-1">
                  <textarea v-model="editingValue" rows="2" class="w-full px-2.5 py-1.5 border border-[#c8d6c9] rounded-md text-sm outline-none focus:border-[#2c6e33] font-[inherit]"></textarea>
                  <div class="flex gap-1.5">
                    <button class="px-2.5 py-1 rounded-md bg-[#1e4620] text-white text-xs font-bold border-none cursor-pointer" @click="saveEdit(t)">Lưu</button>
                    <button class="px-2.5 py-1 rounded-md border border-[#c8d6c9] bg-white text-xs font-semibold text-[#667768] cursor-pointer" @click="editingKey = null">Hủy</button>
                  </div>
                </div>
                <span v-else>{{ t.value || '(trống)' }}</span>
              </td>
              <td class="px-4 py-2.5 text-center">
                <span v-if="t.isAiTranslated" class="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-[#e4f2e5] text-[#1e4620] text-[0.65rem] font-bold">AI</span>
              </td>
              <td class="px-4 py-2.5 text-center">
                <button class="px-2 py-1 rounded-md text-xs font-semibold bg-white border border-[#c8d6c9] text-[#2c6e33] hover:bg-[#f0f7f1] cursor-pointer" @click="startEdit(t)">
                  <i class="fa-solid fa-pen text-[0.7rem]"></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
