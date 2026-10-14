<template>
  <!-- Top Bar: z-[10005] thường trực cao hơn Header (z-[10001]) để dropdown không bao giờ bị Header che lấp dù cuộn hay đứng yên -->
  <div class="bg-[#385130] text-white py-2 text-[0.82rem] border-b border-white/10 relative z-[10005]">
    <div class="container flex justify-between items-center">
      <div class="flex items-center gap-4">
        <span><i class="fa-solid fa-phone" aria-hidden="true"></i> {{ t('hotline_lbl') }}: {{ siteHotline }}</span>
      </div>
      <div class="flex items-center gap-4">
        <!-- Polished Language Switcher Dropdown (Scalable for many languages) -->
        <div class="relative" ref="langDropdownRef">
          <button
            type="button"
            class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition-all border border-white/20 cursor-pointer shadow-2xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9CCC65]"
            :aria-expanded="isLangMenuOpen"
            aria-haspopup="true"
            :aria-label="t('language_switcher')"
            @click="$emit('toggle-lang')"
          >
            <span class="text-sm leading-none">{{ currentLocaleFlag }}</span>
            <span class="font-bold text-xs whitespace-nowrap">{{ currentLocale.name }}</span>
            <i class="fa-solid fa-chevron-down text-[0.6rem] transition-transform opacity-80" :class="isLangMenuOpen ? 'rotate-180' : ''"></i>
          </button>

          <!-- Dropdown Popover: Premium, spacious card with crystal-clear contrast and flags -->
          <div
            v-if="isLangMenuOpen"
            class="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-white text-[#1E251C] shadow-[0_20px_50px_rgba(15,35,18,0.22),0_4px_12px_rgba(0,0,0,0.06)] border border-[#c8d6c9] p-2 z-[10006] flex flex-col gap-1 animate-fade-slide-up"
            role="menu"
          >
            <!-- Popover Header -->
            <div class="px-2.5 py-1.5 flex items-center justify-between border-b border-[#f0f4f0] mb-1">
              <span class="text-[0.68rem] font-extrabold text-[#5A6C58] uppercase tracking-wider">{{ t('language') || 'Ngôn ngữ' }}</span>
              <span class="px-1.5 py-0.2 rounded-full bg-[#f0f4f0] text-[#2c6e33] text-[0.62rem] font-bold">{{ locales.length }} ngôn ngữ</span>
            </div>

            <!-- Language Options List -->
            <div class="max-h-72 overflow-y-auto pr-1 flex flex-col gap-1">
              <button
                v-for="locale in locales"
                :key="`dropdown-${locale.code}`"
                type="button"
                role="menuitem"
                class="w-full text-left px-2.5 py-2 text-xs font-semibold rounded-xl transition-all border cursor-pointer flex items-center justify-between"
                :class="currentLang === locale.code
                  ? 'text-[#1e4620] font-bold bg-[#e4f2e5] border-[#c8dcc9] shadow-2xs'
                  : 'text-[#2C3529] hover:bg-[#f0f7f1] border-transparent hover:border-[#e2ece3]'"
                @click="$emit('set-lang', locale.code)"
              >
                <span class="flex items-center gap-2.5 min-w-0">
                  <span class="w-7 h-7 rounded-lg bg-white border border-[#e2ece3] flex items-center justify-center text-sm shadow-2xs shrink-0">
                    {{ getFlagEmoji(locale.code) }}
                  </span>
                  <span class="flex flex-col min-w-0">
                    <span class="truncate font-bold text-xs">{{ locale.name }}</span>
                    <span class="text-[0.65rem] text-[#667768] font-mono uppercase">{{ locale.code }}</span>
                  </span>
                </span>
                <i v-if="currentLang === locale.code" class="fa-solid fa-circle-check text-sm text-[#2c6e33] shrink-0 ml-2"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from '~/composables/useI18n'

/**
 * Top Bar — hotline bên trái, language switcher bên phải.
 *
 * `t`/`locales`/`currentLang`/`currentLocale` lấy trực tiếp `useI18n()` (module
 * state, chia sẻ giữa mọi consumer) — không cần truyền qua props.
 *
 * `isLangMenuOpen` + `langDropdownRef` do component sở hữu. Outside-click đóng
 * menu ngôn ngữ sống ở đây (mousedown), không còn ở layout.
 */
const FLAG_MAP: Record<string, string> = {
  vi: '🇻🇳', en: '🇬🇧', zh: '🇨🇳', fr: '🇫🇷', ru: '🇷🇺', lo: '🇱🇦',
  ja: '🇯🇵', ko: '🇰🇷', th: '🇹🇭', ms: '🇲🇾', de: '🇩🇪', es: '🇪🇸',
  it: '🇮🇹', pt: '🇵🇹', ar: '🇸🇦', km: '🇰🇭', my: '🇲🇲', id: '🇮🇩', us: '🇺🇸',
}
const getFlagEmoji = (code: string) => FLAG_MAP[code?.toLowerCase()] || '🌐'

const props = defineProps<{ siteHotline: string; isLangMenuOpen: boolean }>()
const emit = defineEmits<{ 'toggle-lang': []; 'set-lang': [code: string]; 'close-lang': [] }>()

const { t, currentLang, currentLocale, locales } = useI18n()
const currentLocaleFlag = computed(() => getFlagEmoji(currentLang.value))

const langDropdownRef = ref<HTMLElement | null>(null)
defineExpose({ langDropdownRef })

const onDocPointerDown = (event: MouseEvent) => {
  if (!props.isLangMenuOpen) return
  const target = event.target instanceof Node ? event.target : null
  const root = langDropdownRef.value
  if (root && (!target || !root.contains(target))) emit('close-lang')
}
onMounted(() => document.addEventListener('mousedown', onDocPointerDown))
onUnmounted(() => document.removeEventListener('mousedown', onDocPointerDown))
</script>
