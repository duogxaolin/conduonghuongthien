<template>
  <!--
    Mobile Drawer Nav — available on mobile & iPad (< xl).
    Trạng thái đóng KHÔNG chỉ là đẩy ra ngoài màn hình: `inert` + `aria-hidden` loại
    cả cây khỏi thứ tự Tab và cây trợ năng (trước đây 18/60 lần Tab đầu rơi vào các
    điều khiển vô hình ngoài màn hình).

    `visibility` chỉ nằm trong `transition-property` khi ĐÓNG
    (`transition-[right,visibility]`: ẩn SAU khi trượt ra xong, không cần timer).
    Khi MỞ chỉ chuyển `right` (`visible transition-[right]`) nên ngăn kéo hiện NGAY ở
    lượt đổi style đầu tiên. Trước đây visibility chuyển cả khi mở → tới khung hình
    đầu của hiệu ứng nó vẫn `hidden`, và `focus()` lúc `nextTick` lên một cây đang ẩn
    bị trình duyệt lặng lẽ bỏ qua: focus kẹt ở nút "Mở menu"
    (tests/e2e/mobile-drawer-focus.spec.ts).
    Nút đóng (đích focus khi mở) KHÔNG được `transition-all`: visibility là thuộc tính
    kế thừa, và một phần tử con có `transition-property: all` tự chuyển visibility
    kế thừa của nó (hidden → visible trong 150ms) — chính nó vẫn `hidden` lúc focus()
    dù khung ngoài đã `visible` (đo bằng `document.getAnimations()` trên Chrome thật).

    Hộp thoại modal (DNA giao diện): `role="dialog"` + `aria-modal` + tên truy cập;
    phần còn lại của trang `inert` trong lúc mở (`inertOutside`) và Tab quay vòng
    trong ngăn kéo (`trapTabTarget`). `role="dialog"` không được phép đặt lên `<nav>`,
    nên khung ngoài là `<div>` và danh sách điều hướng nằm trong `<nav>` riêng.
  -->
  <div
    id="mobile-drawer"
    ref="drawerEl"
    role="dialog"
    aria-modal="true"
    :aria-label="t('menu_dialog_aria')"
    class="fixed top-0 w-[min(88vw,380px)] max-w-full h-[100dvh] flex flex-col bg-white shadow-[-12px_0_40px_rgba(15,35,18,0.24)] z-[10007] duration-[380ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none overflow-hidden xl:hidden"
    :class="isMobileMenuOpen ? 'right-0 visible transition-[right]' : '-right-full invisible transition-[right,visibility]'"
    :inert="isMobileMenuOpen ? undefined : true"
    :aria-hidden="isMobileMenuOpen ? undefined : 'true'"
    @click="onNavClick" @keydown.escape="$emit('toggle-mobile-menu')" @keydown.tab="onTrapTab"
  >
    <!-- Drawer Header -->
    <div class="flex items-center justify-between px-5 py-[18px] bg-gradient-to-br from-brand-900 to-[#133215] text-white border-b border-white/10 z-[2] flex-shrink-0">
      <div class="flex items-center gap-2.5 min-w-0">
        <div v-if="siteMainLogo || siteLogo" class="flex items-center gap-2 shrink-0">
          <NuxtImg             v-if="siteMainLogo"             :src="siteMainLogo"             alt="Logo cơ quan chủ quản"             class="w-auto object-contain drop-shadow-md"             :class="siteLogo ? 'h-10' : 'h-9'"             sizes="64px sm:96px"            format="webp" />
          <span v-if="siteMainLogo && siteLogo" class="h-6 w-px bg-white/25" aria-hidden="true"></span>
          <NuxtImg             v-if="siteLogo"             :src="siteLogo"             alt="Logo Con Đường Hướng Thiện"             class="w-auto object-contain drop-shadow-md"             :class="siteMainLogo ? 'h-7' : 'h-9'"             sizes="64px sm:96px"            format="webp" />
        </div>
        <div class="flex flex-col min-w-0">
          <span class="text-[0.85rem] font-extrabold tracking-[0.4px] text-white leading-[1.2] truncate">CON ĐƯỜNG HƯỚNG THIỆN</span>
          <span class="text-[0.65rem] text-white/75 font-medium mt-0.5 truncate">{{ t('portal_tagline_short') }}</span>
        </div>
      </div>
      <button
        ref="closeBtn"
        type="button"
        class="w-[34px] h-[34px] rounded-full border border-white/20 bg-white/[0.12] text-white text-[0.95rem] flex items-center justify-center cursor-pointer transition-[background-color,transform] active:bg-white/25 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        @click.stop="$emit('toggle-mobile-menu')" :aria-label="t('menu_close')">✕</button>
    </div>

    <!-- Drawer Locale Switcher (Grid layout for many languages) -->
    <div class="px-4 py-2.5 bg-[#f0f6ef] border-b border-[#e1e8e0] flex-shrink-0">
      <div class="text-[0.68rem] font-bold text-ink-muted uppercase mb-1.5">{{ t('language_switcher') }}</div>
      <div class="grid grid-cols-2 gap-1.5" role="group" :aria-label="t('language_switcher')">
        <button
          v-for="locale in locales"
          :key="`drawer-${locale.code}`"
          :class="currentLang === locale.code ? 'text-white bg-brand-700 shadow-xs' : 'text-brand-900 bg-white border border-line-strong hover:bg-[#e4ece4]'"
          class="border-none font-bold cursor-pointer text-xs px-2.5 py-1.5 rounded-lg transition-all flex items-center justify-between"
          :aria-label="locale.name"
          :aria-pressed="currentLang === locale.code"
          @click="setLang(locale.code)">
          <span class="flex items-center gap-1.5 truncate">
            <span class="text-sm leading-none">{{ getFlagEmoji(locale.code) }}</span>
            <span class="truncate">{{ locale.name }}</span>
          </span>
          <i v-if="currentLang === locale.code" class="fa-solid fa-check text-[0.65rem] shrink-0"></i>
        </button>
      </div>
    </div>

    <!-- Drawer Search -->
    <div class="px-4 pt-3 pb-2 bg-[#fcfdfe] border-b border-[rgba(30,70,32,0.06)] flex-shrink-0">
      <form @submit.prevent="$emit('handle-search')" class="flex items-center bg-[rgba(30,70,32,0.05)] border border-[rgba(30,70,32,0.12)] rounded-[10px] px-3 py-2 gap-2">
        <span class="text-[0.85rem] text-brand-600">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        </span>
        <input
          type="text"
          :placeholder="t('search_placeholder')"
          :aria-label="t('site_search_aria')"
          :value="searchQuery"
          @input="$emit('search-input', ($event.target as HTMLInputElement).value)"
          class="border-none bg-transparent w-full text-[0.88rem] text-ink outline-none"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="border-none bg-black/10 rounded-full w-[20px] h-[20px] text-[0.65rem] flex items-center justify-center cursor-pointer text-[#555] hover:bg-black/20 transition-colors"
          @click="$emit('clear-search')"
          aria-label="Xóa từ khóa"
        >
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </form>
    </div>

    <!-- Drawer Body -->
    <div class="flex-1 flex flex-col justify-between overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
      <nav aria-label="Điều hướng di động">
      <ul class="list-none flex flex-col px-3.5 pt-3.5 pb-5 gap-1">
        <li v-for="item in navMenu" :key="item.id">
          <!-- Has children: accordion -->
          <template v-if="item.children && item.children.length">
            <div
              class="no-underline text-ink font-semibold text-[0.95rem] px-4 py-3 rounded-[10px] flex justify-between items-center cursor-pointer transition-all hover:bg-[rgba(30,70,32,0.08)] hover:text-brand-600"
              :role="item.url === '#' ? 'button' : undefined"
              :tabindex="item.url === '#' ? 0 : undefined"
              :aria-label="item.url === '#' ? navItemLabel(item) : undefined"
              @click.stop="toggleMobileSubmenu(item.id)"
              @keydown.enter.stop.prevent="item.url === '#' ? toggleMobileSubmenu(item.id) : null"
            >
              <component
                :is="item.url && item.url !== '#' ? NuxtLink : 'span'"
                v-bind="item.url && item.url !== '#' ? { to: item.url, class: 'text-inherit no-underline' } : {}"
                @click.stop
              >{{ navItemLabel(item) }}</component>
              <i class="fa-solid fa-chevron-down text-[0.65rem] opacity-70 transition-transform duration-200" :class="{ 'rotate-180': mobileOpenSubmenu === item.id }" aria-hidden="true"></i>
            </div>
            <ul v-if="mobileOpenSubmenu === item.id" class="list-none static opacity-100 pointer-events-auto transform-none shadow-none p-1.5 pl-3.5 bg-[rgba(30,70,32,0.04)] border-l-[3px] border-brand-600 rounded-[0_10px_10px_0] my-1 ml-3">
              <li v-for="child in item.children" :key="child.id">
                <component
                  :is="shouldOpenNewTab(child) ? 'a' : NuxtLink"
                  v-bind="shouldOpenNewTab(child) ? { href: child.url, target: child.openNewTab ? '_blank' : undefined, rel: child.openNewTab ? 'noopener noreferrer' : undefined } : { to: child.url, 'aria-current-value': 'page' }"
                  class="block px-3.5 py-2.5 text-[0.88rem] font-medium text-ink-secondary rounded-lg no-underline transition-all hover:bg-[rgba(30,70,32,0.08)] hover:text-brand-600"
                >{{ navItemLabel(child) }}</component>
              </li>
            </ul>
          </template>
          <!-- No children: simple link -->
          <template v-else>
            <component
              :is="shouldOpenNewTab(item) ? 'a' : NuxtLink"
              v-bind="shouldOpenNewTab(item) ? { href: item.url, target: item.openNewTab ? '_blank' : undefined, rel: item.openNewTab ? 'noopener noreferrer' : undefined } : { to: item.url, 'active-class': 'bg-[rgba(30,70,32,0.08)] text-[#4A6741] font-extrabold', 'aria-current-value': 'page' }"
              class="no-underline text-[#1E251C] font-semibold text-[0.95rem] px-4 py-3 rounded-[10px] flex justify-between items-center transition-all hover:bg-[rgba(30,70,32,0.08)] hover:text-brand-600"
            >{{ navItemLabel(item) }}</component>
          </template>
        </li>
      </ul>
      </nav>

      <!-- Drawer Footer -->
      <div class="px-4 py-4 bg-surface border-t border-black/[0.06] flex flex-col gap-2.5 flex-shrink-0">
        <!-- Khối danh tính người đọc trên điện thoại.

             Đây là phần VÁ LỖI, không phải trang trí: khối ở header mang
             `hidden lg:flex`, và ngăn kéo này trước đây không có khối nào
             tương đương — nên trên điện thoại, tính năng đăng nhập của người
             đọc **không tồn tại**, trong khi phần lớn công dân đọc cổng này
             bằng điện thoại.

             `<client-only>` cùng lý do như ở header: mọi trang công khai phục
             vụ qua `swr: 60`, nên một cái tên lọt vào HTML dựng phía máy chủ
             sẽ được phát lại cho người kế tiếp. Không có `fallback`.

             Không dùng dropdown ở đây: ngăn kéo đã là một lớp phủ, và hai
             liên kết phẳng thì bấm được bằng ngón tay ngay, không cần mở thêm
             một lớp nữa. -->
        <client-only>
          <div v-if="readerLoaded">
            <div v-if="reader" class="flex flex-col gap-2">
              <div class="flex items-center gap-3 bg-white px-3.5 py-3 rounded-[14px] border border-[rgba(30,70,32,0.12)] shadow-sm">
                <ReaderAvatar :initials="reader.initials" />
                <div class="flex flex-col min-w-0">
                  <span class="text-[0.9rem] font-extrabold text-ink truncate">{{ reader.displayName }}</span>
                  <span v-if="reader.email" class="text-[0.72rem] text-[#5A6C58] truncate">{{ reader.email }}</span>
                </div>
              </div>
              <div class="flex gap-2">
                <nuxt-link
                  to="/profile"
                  class="flex-1 flex items-center justify-center gap-2 bg-white border border-[rgba(30,70,32,0.12)] rounded-xl px-3 py-2.5 text-[0.85rem] font-bold text-[#385130] no-underline transition-colors active:bg-[#EEF2EC]"
                  @click="$emit('toggle-mobile-menu')"
                >
                  <i class="fa-solid fa-user text-[#7CB342]" aria-hidden="true"></i> Trang cá nhân
                </nuxt-link>
                <button
                  type="button"
                  class="flex items-center justify-center gap-2 bg-white border border-[rgba(30,70,32,0.12)] rounded-xl px-3.5 py-2.5 text-[0.85rem] font-bold text-[#5A6C58] transition-colors active:bg-[#EEF2EC]"
                  @click="onReaderSignOut"
                >
                  <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Đăng xuất
                </button>
              </div>

              <!--
                Thông báo ở ngăn kéo.

                Bản mobile của chuông, và nó phải tồn tại riêng: khối desktop
                mang `hidden lg:flex`, nên thiếu chỗ này là **trên điện thoại
                tính năng không tồn tại** — đúng lỗi đã xảy ra một lần với nút
                đăng nhập. Không dựng lại danh sách ở đây: ngăn kéo đã là một
                lớp phủ, và một danh sách cuộn được lồng trong đó thì bấm hụt
                liên tục. Nó dẫn thẳng sang trang cá nhân, nơi danh sách đầy đủ
                đã có sẵn.
              -->
              <nuxt-link
                to="/profile#notifications"
                class="flex items-center justify-between gap-2 bg-white border border-[rgba(30,70,32,0.12)] rounded-xl px-3.5 py-2.5 text-[0.85rem] font-bold text-[#385130] no-underline transition-colors active:bg-[#EEF2EC]"
                @click="$emit('toggle-mobile-menu')"
              >
                <span class="flex items-center gap-2">
                  <i class="fa-solid fa-bell text-[#7CB342]" aria-hidden="true"></i> {{ t('notifications') }}
                </span>
                <span
                  v-if="unreadCount > 0"
                  class="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-[#B04A4A] text-white text-[0.7rem] font-bold leading-none"
                >{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
              </nuxt-link>
            </div>

            <button
              v-else
              type="button"
              class="w-full flex items-center justify-center gap-2 bg-white border border-[rgba(30,70,32,0.12)] rounded-xl px-4 py-3 text-[0.88rem] font-bold text-[#385130] shadow-sm transition-colors active:bg-[#EEF2EC]"
              @click="readerSignIn()"
            >
              <i class="fa-solid fa-right-to-bracket text-[#7CB342]" aria-hidden="true"></i> {{ t('login_to_comment') }}
            </button>
          </div>
        </client-only>

        <a :href="siteHotlineTel" class="flex items-center gap-3 bg-white px-3.5 py-3 rounded-[14px] border border-[rgba(30,70,32,0.12)] no-underline shadow-sm">
          <span class="text-xl">📞</span>
          <div class="flex flex-col">
            <span class="text-[0.72rem] text-[#5A6C58] font-semibold">{{ t('hotline_lbl') }}</span>
            <span class="text-[0.95rem] font-extrabold text-brand-600">{{ siteHotline }}</span>
          </div>
        </a>
        <nuxt-link to="/contact" class="btn btn-primary w-full flex items-center justify-center gap-2 px-4 py-3 text-[0.88rem] font-bold rounded-xl" @click="$emit('toggle-mobile-menu')">
          <span class="w-1.5 h-1.5 bg-[#7CB342] rounded-full inline-block animate-pulse motion-reduce:animate-none" aria-hidden="true"></span> {{ t('register_help') }}
        </nuxt-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, resolveComponent, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { createFocusReturn, inertOutside, trapTabTarget } from '~/utils/focus-return'
import type { NavItem } from '~/utils/nav-config'
import type { ReaderProfile } from '~/composables/useReaderAuth'

/**
 * Drawer mobile: accordion nav + locale grid + search + khối danh tính người đọc
 * (client-only) + hotline + nút đăng ký hỗ trợ.
 *
 * Giữ tên biến `navMenu`, `navItemLabel`, `toggleMobileSubmenu(item.id)`,
 * `readerSignIn()`, `onReaderSignOut`, `v-for="item in navMenu"`,
 * `v-for="child in item.children"`, `fa-bell`, `unreadCount > 9 ? '9+' : unreadCount`,
 * `/profile#notifications`, `animate-pulse` — `tests/public-pages-structure` và
 * `tests/reader-notifications` grep.
 */
const props = defineProps<{
  isMobileMenuOpen: boolean
  navMenu: NavItem[]
  navItemLabel: (item: NavItem) => string
  mobileOpenSubmenu: string | null
  reader: ReaderProfile | null
  readerLoaded: boolean
  unreadCount: number
  siteMainLogo: string
  siteLogo: string
  siteHotline: string
  siteHotlineTel: string
  searchQuery: string
  toggleMobileSubmenu: (id: string) => void
  onNavClick: (event: Event) => void
  readerSignIn: () => void
  onReaderSignOut: () => void
}>()
defineEmits<{
  'toggle-mobile-menu': []
  'search-input': [value: string]
  'clear-search': []
  'handle-search': []
}>()

const { t, currentLang, locales, setLang } = useI18n()

const NuxtLink = resolveComponent('NuxtLink')

// ── Quản lý focus: mở → vào nút đóng; đóng → về đúng nút đã mở ngăn kéo ────────
// Ngăn kéo đóng là `inert`, nên nếu focus đang nằm trong đó lúc đóng, trình duyệt
// ném focus về <body> — người dùng bàn phím mất vị trí. `watch` mặc định chạy
// TRƯỚC lượt cập nhật DOM, nên ở đó `document.activeElement` còn nằm trong ngăn kéo.
const drawerEl = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
const focusReturn = createFocusReturn((el) => el === document.body)

// Gỡ `inert` đã đặt lên phần còn lại của trang. Phải chạy TRƯỚC khi trả focus: nút
// mở ngăn kéo nằm trong header — đang `inert` thì `focus()` lên nó vô hiệu.
let releaseOutside: (() => void) | null = null
const releasePage = () => {
  releaseOutside?.()
  releaseOutside = null
}
onBeforeUnmount(releasePage)

watch(
  () => props.isMobileMenuOpen,
  async (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      focusReturn.remember(document.activeElement as HTMLElement | null)
      await nextTick() // đợi `inert`/`invisible` của ngăn kéo gỡ xong rồi mới focus được
      if (drawerEl.value && !releaseOutside) releaseOutside = inertOutside(drawerEl.value)
      closeBtn.value?.focus()
      return
    }
    const active = document.activeElement
    // Chỉ trả focus nếu nó còn trong ngăn kéo (hoặc đã rơi về <body>); nếu người
    // dùng đã bấm sang chỗ khác thì không giật focus của họ.
    const shouldRestore = !active || active === document.body || !!drawerEl.value?.contains(active)
    releasePage()
    await nextTick()
    focusReturn.restore(shouldRestore)
  },
)

/** Phần tử focus được, ĐANG hiển thị, trong ngăn kéo — tính lại mỗi lần bấm Tab
 *  vì danh sách đổi theo submenu đang mở và khối người đọc (client-only). */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
function drawerFocusables(): HTMLElement[] {
  const root = drawerEl.value
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'))
}

function onTrapTab(event: KeyboardEvent) {
  if (!props.isMobileMenuOpen) return
  const items = drawerFocusables()
  const target = trapTabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey)
  if (target === null) return
  event.preventDefault()
  items[target]?.focus()
}

/**
 * Có nên render `<a target="_blank">` thay vì `NuxtLink` — đồng bộ với
 * `DefaultDesktopNav`. Link ngoài luôn `<a>`; link nội bộ chỉ `<a target=_blank>`
 * khi `openNewTab === true`. Xem lý do ở `DefaultDesktopNav.vue`.
 */
function shouldOpenNewTab(item: NavItem): boolean {
  return !!(item.url && (item.url.startsWith('http') || item.openNewTab === true))
}

const FLAG_MAP: Record<string, string> = {
  vi: '🇻🇳', en: '🇬🇧', zh: '🇨🇳', fr: '🇫🇷', ru: '🇷🇺', lo: '🇱🇦',
  ja: '🇯🇵', ko: '🇰🇷', th: '🇹🇭', ms: '🇲🇾', de: '🇩🇪', es: '🇪🇸',
  it: '🇮🇹', pt: '🇵🇹', ar: '🇸🇦', km: '🇰🇭', my: '🇲🇲', id: '🇮🇩', us: '🇺🇸',
}
const getFlagEmoji = (code: string) => FLAG_MAP[code?.toLowerCase()] || '🌐'
</script>
