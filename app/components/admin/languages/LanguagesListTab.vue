<script setup lang="ts">
/**
 * Languages list tab của trang Quản lý Ngôn ngữ — Card grid + form thêm +
 * reorder modal. Tách khỏi `pages/admin/languages/index.vue`.
 *
 * Nhận prop `languages` (source ở cha — guard test ghim `loadError`/
 * `fetchLanguages` ở file gốc nên cha giữ fetch). Các action mutation
 * (toggle/setDefault/delete/reorder/oneTimeTranslate) emit lên cha để cha
 * gọi API + re-fetch, không tự nắm state dùng chung.
 */
import { errorMessage } from '~/utils/errorMessage'
import { getFlagEmoji } from '~/utils/language-flags'

interface LanguageRow {
  id: number
  code: string
  name: string
  nativeName: string
  isActive: boolean
  isDefault: boolean
  displayOrder: number
  stats?: {
    totalKeys: number
    translatedKeys: number
    missingKeys: number
    aiKeys: number
    percent: number
  }
}

const props = defineProps<{
  languages: LanguageRow[]
  translatingCards: Record<string, boolean>
}>()

const emit = defineEmits<{
  'toggle-active': [lang: LanguageRow]
  'set-default': [lang: LanguageRow]
  'delete': [lang: LanguageRow]
  'shift-order': [index: number, direction: 'up' | 'down']
  'open-move': [lang: LanguageRow]
  'move-to-position': [targetIndex: number]
  'one-time-translate': [lang: LanguageRow]
  'inspect-missing': [code: string]
  'open-translations': [code: string]
  'add-language': [data: { code: string; name: string; nativeName: string; displayOrder: number }]
}>()

const toast = useToast()

// ── Add language form ────────────────────────────────────────────────
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
  emit('add-language', {
    code: newLang.value.code.trim().toLowerCase(),
    name: newLang.value.name.trim(),
    nativeName: newLang.value.nativeName.trim(),
    displayOrder: newLang.value.displayOrder || 0,
  })
  showAddForm.value = false
  newLang.value = { code: '', name: '', nativeName: '', displayOrder: 0, flagEmoji: '' }
}

// Move/reorder: con chỉ emit vị trí đích lên cha (modal + movingLang ở cha).
function moveLanguageToPosition(targetIndex: number) {
  emit('move-to-position', targetIndex)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Add Language Form -->
    <div v-if="showAddForm" class="bg-white rounded-xl border border-line p-5 flex flex-col gap-3 shadow-sm">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-brand-950 m-0">Thêm ngôn ngữ mới</h3>
        <span class="text-xs text-ink-muted">Hệ thống tự động gợi ý cờ quốc gia khi bạn gõ mã code ISO.</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div>
          <label class="block text-xs font-bold text-brand-950 mb-1">Mã (vd: ja, ko, de)</label>
          <input
            v-model="newLang.code"
            type="text"
            placeholder="vd: ja"
            class="w-full px-3 py-2 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
            @input="onAddCodeInput"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-brand-950 mb-1">Cờ quốc gia (Emoji)</label>
          <input
            v-model="newLang.flagEmoji"
            type="text"
            placeholder="vd: 🇯🇵 (Tự động)"
            class="w-full px-3 py-2 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-brand-950 mb-1">Tên quốc tế</label>
          <input
            v-model="newLang.name"
            type="text"
            placeholder="vd: Japanese"
            class="w-full px-3 py-2 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-brand-950 mb-1">Tên bản địa</label>
          <input
            v-model="newLang.nativeName"
            type="text"
            placeholder="vd: 日本語"
            class="w-full px-3 py-2 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-brand-950 mb-1">Thứ tự hiển thị</label>
          <input
            v-model.number="newLang.displayOrder"
            type="number"
            placeholder="0"
            class="w-full px-3 py-2 border border-line-strong rounded-lg text-sm outline-none focus:border-brand-700"
          />
        </div>
      </div>
      <div class="flex gap-2 pt-1">
        <button class="px-4 py-2 rounded-lg bg-brand-700 hover:bg-brand-900 text-white text-sm font-bold border-none cursor-pointer" @click="addLanguage">Thêm ngôn ngữ</button>
        <button class="px-4 py-2 rounded-lg border border-line-strong bg-white text-sm font-semibold text-ink-muted cursor-pointer hover:bg-surface" @click="showAddForm = false">Hủy</button>
      </div>
    </div>

    <!-- Languages Tab: Forum-style Card Grid -->
    <!-- Skeleton/error do cha renders (guard ghim loadError/fetchLanguages ở file gốc) -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="(lang, index) in props.languages"
        :key="lang.id"
        class="rounded-xl border bg-white p-4 flex flex-col justify-between gap-3 shadow-xs hover:shadow-md transition-all relative overflow-hidden"
        :class="lang.isDefault ? 'border-brand-700 border-l-4' : 'border-line'"
      >
        <!-- Top row: Order badge + Default / Active badge -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="inline-flex items-center justify-center min-w-7 h-7 px-1.5 rounded-md bg-surface text-brand-900 font-bold text-xs border border-line-strong hover:bg-line hover:border-brand-700 cursor-pointer transition-colors shadow-2xs group"
              title="Bấm để chuyển đổi vị trí thứ tự"
              @click="emit('open-move', lang)"
            >
              <span>#{{ index + 1 }}</span>
              <i class="fa-solid fa-arrows-up-down text-[0.6rem] ml-1 text-ink-muted group-hover:text-brand-900"></i>
            </button>
            <div class="flex flex-col gap-0.5">
              <button
                type="button"
                :disabled="index === 0"
                class="w-4 h-3 bg-white border border-line-strong rounded-xs text-[0.52rem] text-ink-muted hover:text-brand-900 hover:bg-surface-tint flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed leading-none p-0"
                title="Di chuyển lên trên"
                @click="emit('shift-order', index, 'up')"
              >▲</button>
              <button
                type="button"
                :disabled="index === props.languages.length - 1"
                class="w-4 h-3 bg-white border border-line-strong rounded-xs text-[0.52rem] text-ink-muted hover:text-brand-900 hover:bg-surface-tint flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed leading-none p-0"
                title="Di chuyển xuống dưới"
                @click="emit('shift-order', index, 'down')"
              >▼</button>
            </div>
          </div>
          <div class="flex items-center gap-1.5">
            <span v-if="lang.isDefault" class="px-2 py-0.5 rounded-full bg-[#e4f2e5] text-brand-900 text-[0.65rem] font-bold uppercase tracking-wider">
              Mặc định
            </span>
            <button
              type="button"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-bold cursor-pointer border transition-colors"
              :class="lang.isActive ? 'bg-[#e4f2e5] text-[#1e4620] border-[#c8dcc9]' : 'bg-[#f5f5f5] text-[#999] border-[#e0e0e0]'"
              @click="emit('toggle-active', lang)"
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
              <h4 class="m-0 text-base font-bold text-brand-950 flex items-center gap-1.5">
                <span>{{ lang.nativeName }}</span>
                <span class="text-xs font-mono font-normal text-ink-muted">({{ lang.code }})</span>
              </h4>
              <p class="m-0 text-xs text-ink-muted">{{ lang.name }}</p>
            </div>
          </div>
        </div>
        <!-- Translation Progress & Missing Keys -->
        <div class="flex flex-col gap-1.5 bg-surface p-2.5 rounded-lg border border-surface-tint">
          <div class="flex items-center justify-between text-xs">
            <span class="text-ink-muted font-medium text-[0.75rem]">Tiến độ:</span>
            <span
              class="font-bold text-[0.72rem]"
              :class="(lang.stats?.missingKeys || 0) === 0 ? 'text-[#2c6e33]' : 'text-[#b78103]'"
            >
              {{ (lang.stats?.missingKeys || 0) === 0 ? '✓ Đã hoàn tất 100%' : `Còn thiếu ${lang.stats?.missingKeys} key (${lang.stats?.percent || 0}%)` }}
            </span>
          </div>
          <div class="w-full h-1.5 bg-line rounded-full overflow-hidden">
            <div
              class="h-full transition-all duration-500 rounded-full"
              :class="(lang.stats?.missingKeys || 0) === 0 ? 'bg-[#2c6e33]' : 'bg-[#b78103]'"
              :style="{ width: `${lang.stats?.percent || 0}%` }"
            ></div>
          </div>
          <div class="flex items-center justify-between text-[0.68rem] text-ink-muted mt-0.5">
            <span>Đã dịch: <strong class="text-brand-950">{{ lang.stats?.translatedKeys || 0 }}/{{ lang.stats?.totalKeys || 0 }}</strong></span>
            <span v-if="(lang.stats?.aiKeys || 0) > 0" class="text-brand-700 font-medium">AI: {{ lang.stats?.aiKeys }}</span>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex items-center gap-1.5 pt-2 border-t border-surface-tint flex-wrap">
          <button
            v-if="lang.code !== 'vi' && (lang.stats?.missingKeys || 0) > 0"
            type="button"
            class="px-2.5 py-1 rounded-md bg-brand-700 hover:bg-brand-900 text-white text-xs font-bold border-none cursor-pointer flex items-center gap-1 transition-colors disabled:opacity-50 shadow-2xs"
            :disabled="!!translatingCards[lang.code]"
            title="Dịch AI một lần (One-time) tất cả các key còn thiếu của ngôn ngữ này"
            :data-admin-modal-opener="`translate-${lang.code}`"
            @click="emit('one-time-translate', lang)"
          >
            <i class="fa-solid fa-wand-magic-sparkles text-[0.68rem]" :class="translatingCards[lang.code] ? 'animate-spin' : ''"></i>
            <span>{{ translatingCards[lang.code] ? 'Đang dịch...' : `Dịch AI (${lang.stats?.missingKeys})` }}</span>
          </button>

          <button
            v-if="(lang.stats?.missingKeys || 0) > 0"
            type="button"
            class="px-2 py-1 rounded-md border border-[#ffe082] bg-[#fff8e1] text-[#b78103] hover:bg-[#ffecb3] text-xs font-bold cursor-pointer flex items-center gap-1"
            title="Xem danh sách các key chưa dịch"
            @click="emit('inspect-missing', lang.code)"
          >
            <i class="fa-solid fa-list-check text-[0.65rem]"></i> Xem thiếu
          </button>

          <button
            type="button"
            class="px-2 py-1 rounded-md border border-line-strong bg-white text-brand-900 hover:bg-surface-tint text-xs font-semibold cursor-pointer flex items-center gap-1"
            @click="emit('open-translations', lang.code)"
          >
            <i class="fa-solid fa-table-list text-[0.68rem]"></i> Bảng dịch
          </button>

          <button
            v-if="!lang.isDefault"
            type="button"
            class="px-2 py-1 rounded-md border border-line-strong bg-white text-ink-muted hover:bg-surface-tint text-xs font-semibold cursor-pointer"
            title="Đặt làm mặc định"
            @click="emit('set-default', lang)"
          >
            <i class="fa-regular fa-star text-[0.68rem]"></i>
          </button>

          <button
            v-if="!lang.isDefault"
            type="button"
            class="px-2 py-1 rounded-md border border-[#e2c8c8] bg-white text-danger hover:bg-[#fff5f4] text-xs font-semibold cursor-pointer"
            title="Xoá ngôn ngữ"
            @click="emit('delete', lang)"
          >
            <i class="fa-solid fa-trash text-[0.68rem]"></i>
          </button>
        </div>
      </div>

      <!-- Add new language dashed card -->
      <div
        class="rounded-xl border-2 border-dashed border-line-strong hover:border-brand-700 bg-surface hover:bg-surface-tint p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all min-h-[140px] text-center"
        @click="showAddForm = !showAddForm"
      >
        <div class="w-10 h-10 rounded-full bg-white border border-line-strong flex items-center justify-center text-brand-700 text-lg shadow-2xs">
          <i class="fa-solid fa-plus"></i>
        </div>
        <span class="text-sm font-bold text-brand-900">Thêm ngôn ngữ mới</span>
        <span class="text-xs text-ink-muted">Bấm để thêm ngôn ngữ quốc tế khác</span>
      </div>
    </div>
  </div>
</template>
