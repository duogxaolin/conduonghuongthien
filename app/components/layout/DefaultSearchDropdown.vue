<template>
  <!-- Search Dropdown Bar -->
  <transition name="slide-down">
    <div :ref="mountBar" class="absolute top-full left-0 w-full bg-[#385130] py-4 shadow-xl z-[99] border-b border-[#2A3E24]" v-if="isSearchActive">
      <div class="container relative">
        <form @submit.prevent="$emit('handle-search')" class="flex flex-col sm:flex-row gap-3 items-center">
          <div class="relative flex-1 w-full">
            <span class="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A6C58] text-sm pointer-events-none">
              <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            </span>
            <input
              type="text"
              :placeholder="t('search_placeholder')"
              :value="searchQuery"
              @input="$emit('search-input', ($event.target as HTMLInputElement).value)"
              :ref="mountInput"
              class="w-full py-3 pl-11 pr-10 rounded-lg border border-[#4A6741] bg-white font-[inherit] text-[0.95rem] text-[#172516] outline-none focus:ring-2 focus:ring-[#7CB342] shadow-inner"
            />
            <button
              v-if="searchQuery"
              type="button"
              @click="$emit('clear-search')"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A9A88] hover:text-[#2D5A27] w-6 h-6 rounded-full flex items-center justify-center text-xs cursor-pointer border-none bg-transparent transition-colors"
              aria-label="Xóa từ khóa"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>

          <div class="flex gap-2 w-full sm:w-auto shrink-0">
            <button
              type="submit"
              class="flex-1 sm:flex-none bg-[#7CB342] hover:bg-[#689F38] text-white border-none px-6 py-3 rounded-lg font-extrabold text-[0.9rem] cursor-pointer transition-all shadow-sm flex items-center justify-center gap-2"
            >
              <i class="fa-solid fa-magnifying-glass text-xs" aria-hidden="true"></i>
              <span>Tìm kiếm</span>
            </button>
            <button
              type="button"
              class="flex-1 sm:flex-none bg-white/10 hover:bg-white/20 text-white border border-white/20 px-4 py-3 rounded-lg text-[0.9rem] font-bold cursor-pointer transition-all flex items-center justify-center gap-1.5"
              @click="$emit('toggle-search')"
            >
              <i class="fa-solid fa-xmark text-sm" aria-hidden="true"></i>
              <span>Đóng</span>
            </button>
          </div>
        </form>

        <!-- Instant Live Preview Dropdown -->
        <div
          v-if="showLivePreview && searchQuery.trim().length >= 2"
          class="absolute left-0 right-0 top-full mt-2 bg-white rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.25)] border border-[#DDE6DC] overflow-hidden z-[105] max-h-[440px] flex flex-col text-[#172516]"
        >
          <!-- Header -->
          <div class="px-4 py-2.5 bg-[#F7FAF6] border-b border-[#E8EFE6] flex items-center justify-between text-xs font-semibold text-[#556450]">
            <span v-if="isSearchingLive" class="flex items-center gap-2 text-[#4A6741]">
              <i class="fa-solid fa-circle-notch animate-spin text-sm" aria-hidden="true"></i>
              <span>Đang tìm kiếm...</span>
            </span>
            <span v-else>
              Gợi ý kết quả cho: <strong class="text-[#2D5A27]">&laquo;{{ searchQuery }}&raquo;</strong>
            </span>
            <span v-if="!isSearchingLive && liveSearchResults.length" class="text-[0.72rem] text-[#7A8A76]">
              {{ liveSearchResults.length }} kết quả nổi bật
            </span>
          </div>

          <!-- List -->
          <div v-if="liveSearchResults.length" class="overflow-y-auto divide-y divide-[#F0F5EE] p-1.5">
            <nuxt-link
              v-for="item in liveSearchResults"
              :key="item.id"
              :to="item.url"
              @click="$emit('close-search-navigate')"
              class="flex items-center gap-3.5 p-2.5 rounded-lg hover:bg-[#F2F7F0] transition-colors no-underline text-inherit group"
            >
              <div v-if="item.thumbnailUrl" class="w-12 h-12 rounded-lg overflow-hidden bg-[#EBF1EA] shrink-0 border border-[#E2E8DF]">
                <NuxtImg :src="item.thumbnailUrl" :alt="item.title" width="48" height="48" sizes="48px" format="webp" class="w-full h-full object-cover" />
              </div>
              <div v-else class="w-10 h-10 rounded-lg bg-[#EBF1EA] text-[#4A6741] flex items-center justify-center shrink-0 text-sm">
                <i :class="item.typeIcon" aria-hidden="true"></i>
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  <span :class="['text-[0.65rem] font-extrabold px-1.5 py-0.2 rounded uppercase tracking-wider', item.typeBadgeClass]">
                    {{ item.typeLabel }}
                  </span>
                  <span v-if="item.categoryName" class="text-[0.7rem] text-[#7A8A76] truncate font-medium">
                    {{ item.categoryName }}
                  </span>
                </div>
                <p class="text-xs sm:text-[0.88rem] font-bold text-[#172516] group-hover:text-[#2D5A27] truncate m-0 leading-snug">
                  {{ item.title }}
                </p>
              </div>

              <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#BAC8B6] group-hover:text-[#2D5A27] group-hover:translate-x-0.5 transition-all mr-1 shrink-0" aria-hidden="true"></i>
            </nuxt-link>
          </div>

          <!-- Empty State -->
          <div v-else-if="!isSearchingLive" class="p-6 text-center text-xs text-[#7A8A76]">
            <i class="fa-solid fa-magnifying-glass text-lg mb-2 text-[#BAC8B6] block" aria-hidden="true"></i>
            <span>Không tìm thấy kết quả phù hợp cho &laquo;{{ searchQuery }}&raquo;</span>
          </div>

          <!-- Footer -->
          <div class="p-2.5 bg-[#F7FAF6] border-t border-[#E8EFE6] text-center">
            <button
              type="button"
              @click="$emit('handle-search')"
              class="w-full py-2 px-3 rounded-lg text-xs font-extrabold text-[#2D5A27] hover:bg-[#EBF3E8] transition-colors border-none bg-transparent cursor-pointer flex items-center justify-center gap-2"
            >
              <span>{{ t('search_view_all') }}</span>
              <i class="fa-solid fa-arrow-right text-[0.7rem]" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { LiveSearchItem } from '~/composables/useLiveSearch'

/** Search dropdown — slide-down transition, live preview list.
 *  Refs của input + bar mount về layout qua emit `mount-bar`/`mount-input` để
 *  `handleDocumentPointerDown` (default.vue) và `useLiveSearch` (focus input)
 *  truy cập được. Dùng hàm named + guard `instanceof HTMLElement` thay vì
 *  inline arrow cast `ComponentPublicInstance → HTMLElement`: cast ngang là
 *  ép kiểu không an toàn, guard thì compiler thu hẹp kiểu đúng. */
defineProps<{
  isSearchActive: boolean
  searchQuery: string
  showLivePreview: boolean
  isSearchingLive: boolean
  liveSearchResults: LiveSearchItem[]
}>()
const emit = defineEmits<{
  'search-input': [value: string]
  'clear-search': []
  'close-search-navigate': []
  'toggle-search': []
  'handle-search': []
  'mount-bar': [el: HTMLElement | null]
  'mount-input': [el: HTMLInputElement | null]
}>()

const { t } = useI18n()

const mountBar = (el: Element | ComponentPublicInstance | null) => {
  emit('mount-bar', el instanceof HTMLElement ? el : null)
}
const mountInput = (el: Element | ComponentPublicInstance | null) => {
  emit('mount-input', el instanceof HTMLInputElement ? el : null)
}
</script>

<style scoped>
/* Slide-down transition for search bar */
.slide-down-enter-active, .slide-down-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.slide-down-enter-from, .slide-down-leave-to {
  transform: translateY(-20px);
  opacity: 0;
}
</style>
