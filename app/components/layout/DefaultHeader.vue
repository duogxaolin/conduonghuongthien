<template>
  <!-- Main Header: sticky giữ header trong flow, không gây reflow khi cuộn.
       isSticky nay chỉ bật/tắt shadow — không đổi position nữa.
       z-index khi mở menu: `!z-[10006]` (cùng lớp overlay, dưới drawer `10007`) —
       Header đè overlay để nút hamburger vẫn nhận được, nhưng drawer đè Header
       để gradient header (logo + ✕) không bị nền trắng che 30px dưới. Trước đây
       bump lên `10008` (cao hơn drawer) khiến Header che drawer — bug #3. -->
  <header
    class="main-header notranslate bg-white w-full sticky top-0 z-[10001] border-b border-[#E2E8DF] transition-[box-shadow]"
    :class="[isSticky ? 'shadow-md' : 'shadow-none', isMobileMenuOpen ? '!z-[10006]' : '']"
    translate="no"
  >
    <!-- Dòng 1: Logo & Các nút hành động nhanh -->
    <div class="border-b border-[#E2E8DF] bg-white">
      <div class="container flex justify-between items-center h-16 lg:h-20">
        <!-- Logo Area -->
        <nuxt-link to="/" class="flex items-center gap-3 lg:gap-3.5 no-underline">
          <div v-if="siteMainLogo || siteLogo" class="flex items-center gap-2 lg:gap-2.5 shrink-0">
            <NuxtImg               v-if="siteMainLogo"               class="w-auto object-contain shrink-0"               :class="siteLogo ? 'h-10 lg:h-[56px]' : 'h-9 lg:h-[50px]'"               :src="siteMainLogo"               alt="Logo cơ quan chủ quản"               sizes="64px sm:96px"              format="webp" />
            <span v-if="siteMainLogo && siteLogo" class="h-6 lg:h-8 w-px bg-[#D0DDD1] shrink-0" aria-hidden="true"></span>
            <NuxtImg               v-if="siteLogo"               class="w-auto object-contain shrink-0 transition-all"               :class="siteMainLogo ? 'h-7 lg:h-[38px]' : 'h-9 lg:h-[50px]'"               :src="siteLogo"               alt="Logo Con Đường Hướng Thiện"               sizes="64px sm:96px"              format="webp" />
          </div>
          <div class="min-w-0">
            <!-- Brand, not a heading (design D22): each page supplies its one <h1>. -->
            <p class="text-[0.82rem] sm:text-[0.95rem] lg:text-[1.35rem] font-extrabold text-brand-600 tracking-[0.2px] sm:tracking-[0.5px] leading-[1.2] whitespace-nowrap">CON ĐƯỜNG HƯỚNG THIỆN</p>
            <p class="hidden lg:block text-[0.68rem] xl:text-[0.72rem] font-semibold text-[#5A6C58] uppercase pt-[0.2em] max-w-[280px] xl:max-w-[440px] 2xl:max-w-none leading-snug line-clamp-2">
              {{ t('portal_subtitle') }}
            </p>
          </div>
        </nuxt-link>

        <!-- Top Actions -->
        <div class="flex items-center gap-2 sm:gap-3">
          <button
            class="bg-surface border border-[#E2E8DF] w-9 h-9 sm:w-11 sm:h-11 rounded-full flex items-center justify-center cursor-pointer text-xs sm:text-[0.95rem] transition-all hover:bg-brand-600 hover:text-white hover:border-brand-600"
            :class="{ 'bg-brand-600 text-white border-[#4A6741]': isSearchActive }"
            @click="$emit('toggle-search')"
            :aria-label="isSearchActive ? t('search_close') : t('search_open')"
            :aria-expanded="isSearchActive">
            <i :class="isSearchActive ? 'fa-solid fa-xmark' : 'fa-solid fa-magnifying-glass'"></i>
          </button>
          <nuxt-link to="/contact" class="hidden xl:inline-flex items-center gap-2 btn btn-primary px-4 py-2 lg:px-5 lg:py-2.5 text-[0.85rem] rounded-sm shrink-0">
            <i class="fa-solid fa-headset"></i> {{ t('support_247') }}
          </nuxt-link>

          <!-- Trạng thái đăng nhập của người đọc.

               `<client-only>` là điều kiện tiên quyết, không phải tinh chỉnh:
               mọi trang công khai phục vụ qua `swr: 60`, nên một cái tên hiện
               trong HTML dựng phía máy chủ sẽ được phát lại cho người kế tiếp
               trong cùng cửa sổ 60 giây. Không có `fallback`: chỗ này để trống
               tới khi biết được người đọc là ai — một nút "Đăng nhập" nhấp nháy
               rồi đổi thành tên còn tệ hơn là xuất hiện muộn nửa giây. -->
          <client-only>
            <div v-if="readerLoaded" class="hidden lg:flex items-center gap-2">
              <!--
                Chuông thông báo — xem `ReaderNotificationBell.client.vue`.

                `.client` là bắt buộc: mọi tuyến công khai chạy `swr: 60`, nên một
                khối dựng phía máy chủ mang số chưa đọc của một người sẽ được phát
                lại cho người kế tiếp ghé vào trong cùng 60 giây.

                Component tự sở hữu Escape và mousedown ra ngoài của nó, nên layout
                không còn giữ ref hay nhánh nào cho menu này.
              -->
              <ReaderNotificationBell v-if="reader" ref="notifBellRef" />

              <div v-if="reader" ref="readerMenuRef" class="relative">
                <button
                  type="button"
                  class="flex items-center gap-2 bg-surface border border-[#E2E8DF] pl-1.5 pr-2.5 py-1.5 rounded-full transition-all hover:bg-[#EEF2EC] hover:border-[#CFDDC8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                  :aria-expanded="isReaderMenuOpen"
                  aria-haspopup="menu"
                  @click="$emit('toggle-reader-menu')"
                >
                  <ReaderAvatar :initials="reader.initials" size="sm" />
                  <span class="max-w-[132px] truncate text-[0.82rem] font-bold text-[#385130]">{{ reader.displayName }}</span>
                  <i class="fa-solid fa-chevron-down text-[0.6rem] text-[#5A6C58] transition-transform duration-200" :class="{ 'rotate-180': isReaderMenuOpen }" aria-hidden="true"></i>
                </button>

                <div
                  v-if="isReaderMenuOpen"
                  role="menu"
                  class="absolute right-0 top-[calc(100%+8px)] z-[10004] w-[236px] rounded-xl border border-[#E2E8DF] bg-white p-1.5 shadow-[0_12px_32px_rgba(15,35,18,0.14)]"
                >
                  <!-- Địa chỉ email chỉ hiện trong menu đã mở, không hiện trên
                       thanh header: nó là dữ liệu cá nhân của người đọc, và một
                       màn hình đang chia sẻ thì cả phòng đọc được. -->
                  <p v-if="reader.email" class="m-0 px-3 pt-1.5 pb-2 text-[0.72rem] text-[#5A6C58] truncate border-b border-[#EEF2EC]">{{ reader.email }}</p>
                  <nuxt-link
                    to="/profile"
                    role="menuitem"
                    class="mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[0.85rem] font-semibold text-ink no-underline transition-colors hover:bg-[#F3F7F1] hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    @click="$emit('close-reader-menu')"
                  >
                    <i class="fa-solid fa-user w-4 text-center text-[#7CB342]" aria-hidden="true"></i> {{ t('profile') }}
                  </nuxt-link>
                  <button
                    type="button"
                    role="menuitem"
                    class="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[0.85rem] font-semibold text-ink transition-colors hover:bg-[#F3F7F1] hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    @click="onReaderSignOut"
                  >
                    <i class="fa-solid fa-right-from-bracket w-4 text-center text-[#5A6C58]" aria-hidden="true"></i> {{ t('logout') }}
                  </button>
                </div>
              </div>

              <button
                v-else
                type="button"
                class="inline-flex items-center gap-2 bg-surface border border-[#E2E8DF] px-3.5 py-2 rounded-sm text-[0.82rem] font-semibold text-[#385130] transition-all hover:bg-brand-600 hover:text-white hover:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                @click="readerSignIn()"
              >
                <i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> {{ t('login') }}
              </button>
            </div>
          </client-only>
          <!-- Mobile/iPad Toggle — opens drawer on screens < xl (including tablets/iPad) -->
          <button
            class="xl:hidden flex flex-col justify-center items-center gap-1 w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-[#f0f6ef] border border-[#d9e7d7] text-brand-900 cursor-pointer transition-all hover:bg-[#e4f0e2]"
            @click="$emit('toggle-mobile-menu')"
            :aria-label="t('menu_open')"
            aria-controls="mobile-drawer"
            :aria-expanded="isMobileMenuOpen">
            <span class="block w-4 sm:w-5 h-[2px] rounded-[4px] bg-current"></span>
            <span class="block w-4 sm:w-5 h-[2px] rounded-[4px] bg-current"></span>
            <span class="block w-4 sm:w-5 h-[2px] rounded-[4px] bg-current"></span>
          </button>
        </div>
      </div>
    </div>

    <!-- Search dropdown — absolute top-full left-0, containing block là
         <header sticky> này (sticky qualifies làm containing block cho absolute). -->
    <LayoutDefaultSearchDropdown
      :is-search-active="isSearchActive"
      :search-query="searchQuery"
      :show-live-preview="showLivePreview"
      :is-searching-live="isSearchingLive"
      :live-search-results="liveSearchResults"
      @mount-bar="(el: HTMLElement | null) => $emit('mount-bar', el)"
      @mount-input="(el: HTMLInputElement | null) => $emit('mount-input', el)"
      @search-input="(v: string) => $emit('search-input', v)"
      @clear-search="$emit('clear-search')"
      @close-search-navigate="$emit('close-search-navigate')"
      @toggle-search="$emit('toggle-search')"
      @handle-search="$emit('handle-search')"
    />
  </header>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import type { ReaderProfile } from '~/composables/useReaderAuth'
import type { LiveSearchItem } from '~/composables/useLiveSearch'

/**
 * Header desktop: logo kép + search toggle + liên hệ + khối danh tính người đọc
 * (client-only) + hamburger.
 *
 * Logo markup giữ nguyên chuỗi `:src="siteMainLogo"`, `v-if="siteMainLogo || siteLogo"`,
 * `v-if="siteMainLogo && siteLogo"`, `v-if="siteLogo"`, và các lớp tỷ lệ
 * `h-10 lg:h-[56px]` v.v. — `tests/main-logo-settings.test.ts` grep.
 *
 * Reader menu:
 * - `@click="readerSignIn()"` / `@click="onReaderSignOut"` giữ cú pháp gọi hàm —
 *   `tests/public-pages-structure.test.ts` đếm xuất hiện ≥2 (header + drawer).
 *   Prop `readerSignIn`/`onReaderSignOut` là function, gọi được trực tiếp.
 * - `isReaderMenuOpen` + `toggle-reader-menu`/`close-reader-menu` qua emit vì chỉ
 *   là boolean flip; layout + `handleDocumentPointerDown`/`handleKeydown` (script
 *   default.vue) vẫn sở hữu state này.
 * - `readerMenuRef` + `notifBellRef` phơi qua `defineExpose` cho layout đọc.
 */
defineProps<{
  isSticky: boolean
  isMobileMenuOpen: boolean
  reader: ReaderProfile | null
  readerLoaded: boolean
  isReaderMenuOpen: boolean
  isSearchActive: boolean
  siteMainLogo: string
  siteLogo: string
  readerSignIn: () => void
  onReaderSignOut: () => void
  searchQuery: string
  showLivePreview: boolean
  isSearchingLive: boolean
  liveSearchResults: LiveSearchItem[]
}>()
defineEmits<{
  'toggle-mobile-menu': []
  'toggle-reader-menu': []
  'close-reader-menu': []
  'toggle-search': []
  'search-input': [value: string]
  'clear-search': []
  'close-search-navigate': []
  'handle-search': []
  'mount-bar': [el: HTMLElement | null]
  'mount-input': [el: HTMLInputElement | null]
}>()

const { t } = useI18n()

const readerMenuRef = ref<HTMLElement | null>(null)
const notifBellRef = ref<{ close?: () => void } | null>(null)
// Layout đọc 2 ref này qua template ref trên <DefaultHeader ref="headerRef">,
// rồi `headerRef.value?.readerMenuRef` / `notifBellRef`. `handleDocumentPointerDown`
// đóng menu danh tính khi bấm ra ngoài; `onReaderSignOut` gọi `notifBellRef.close()`.
defineExpose({ readerMenuRef, notifBellRef })
</script>
