<template>
  <div class="app-layout" :style="containerStyleVar">
    <!-- Skip link: bàn phím/tab qua header tới nội dung chính — yêu cầu a11y
         cho cổng thông tin nhà nước (Luật Người khuyết tật 2010 / NĐ 28/2012). -->
    <a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[#2c6e33] focus:text-white focus:rounded-lg">Bỏ qua tới nội dung</a>
    <!-- Thanh tiến trình chuyển trang. Điều hướng client-side phải chờ dữ liệu
         của trang đích, và trong khoảng đó trình duyệt không vẽ gì cả — bấm một
         liên kết trông y hệt như bấm hụt. Đây là phản hồi tức thì cho lần bấm. -->
    <NuxtLoadingIndicator
      color="repeating-linear-gradient(90deg,#7ED957 0%,#A6F28A 40%,#7ED957 100%)"
      :height="3"
      :duration="1500"
      :throttle="0"
    />
    <ToastContainer />
    <!-- Mobile Menu Overlay -->
    <div
      class="fixed inset-0 w-screen h-screen bg-[rgba(20,43,23,0.58)] backdrop-blur-[2px] z-[10006] opacity-0 pointer-events-none transition-opacity duration-300"
      :class="{ 'opacity-100 pointer-events-auto': isMobileMenuOpen }"
      @click="toggleMobileMenu"
      @touchmove.prevent
    ></div>

    <LayoutDefaultTopBar
      :site-hotline="siteHotline"
      :is-lang-menu-open="isLangMenuOpen"
      @toggle-lang="isLangMenuOpen = !isLangMenuOpen"
      @set-lang="(code: string) => { setLang(code); isLangMenuOpen = false }"
      @close-lang="isLangMenuOpen = false"
    />

    <div>
      <LayoutDefaultHeader
        ref="headerRef"
        :is-sticky="isSticky"
        :is-mobile-menu-open="isMobileMenuOpen"
        :reader="reader"
        :reader-loaded="readerLoaded"
        :is-reader-menu-open="isReaderMenuOpen"
        :is-search-active="isSearchActive"
        :site-main-logo="siteMainLogo"
        :site-logo="siteLogo"
        :reader-sign-in="readerSignIn"
        :on-reader-sign-out="onReaderSignOut"
        :search-query="searchQuery"
        :show-live-preview="showLivePreview"
        :is-searching-live="isSearchingLive"
        :live-search-results="liveSearchResults"
        @toggle-mobile-menu="toggleMobileMenu"
        @toggle-reader-menu="isReaderMenuOpen = !isReaderMenuOpen"
        @close-reader-menu="isReaderMenuOpen = false"
        @toggle-search="toggleSearch"
        @search-input="(v: string) => { searchQuery = v; onSearchInput() }"
        @clear-search="clearSearch"
        @close-search-navigate="closeSearchAndNavigate"
        @handle-search="handleSearch"
        @mount-bar="(el: HTMLElement | null) => searchBarRef = el"
        @mount-input="(el: HTMLInputElement | null) => searchInputRef = el"
      />

      <LayoutDefaultMobileDrawer
        :is-mobile-menu-open="isMobileMenuOpen"
        :nav-menu="navMenu"
        :nav-item-label="navItemLabel"
        :mobile-open-submenu="mobileOpenSubmenu"
        :reader="reader"
        :reader-loaded="readerLoaded"
        :unread-count="unreadCount"
        :site-main-logo="siteMainLogo"
        :site-logo="siteLogo"
        :site-hotline="siteHotline"
        :site-hotline-tel="siteHotlineTel"
        :search-query="searchQuery"
        :toggle-mobile-submenu="toggleMobileSubmenu"
        :on-nav-click="onNavClick"
        :reader-sign-in="readerSignIn"
        :on-reader-sign-out="onReaderSignOut"
        @toggle-mobile-menu="toggleMobileMenu"
        @search-input="(v: string) => { searchQuery = v; onSearchInput() }"
        @clear-search="clearSearch"
        @handle-search="handleSearch"
      />

      <LayoutDefaultDesktopNav
        :nav-menu="navMenu"
        :nav-item-label="navItemLabel"
        :on-nav-click="onNavClick"
        @toggle-mobile-menu="toggleMobileMenu"
      />

      <!-- Thanh thông báo phát trực tiếp — trong header sticky để dính theo khi cuộn.
           Client-only: `/media` phục vụ qua `swr: 60` nên không mang state này ra SSR. -->
      <ClientOnly>
        <LiveTickerBar />
      </ClientOnly>
    </div>

    <!-- Main Content Area — không bù padding-top: header đã sticky nên còn
         trong flow, nếu cộng pt ở đây thì isSticky flip (khi cuộn qua ngưỡng) sẽ
         bật/tắt 130px đột ngột → layout shift giật toàn trang. Hero của từng trang
         tự có padding nội bộ đủ lớn để text không bị header sticky che. -->
    <main id="main-content" :class="isAssistant ? 'overflow-hidden p-0' : 'min-h-[calc(100vh-165px)] pb-24 md:pb-0'">
      <slot />
    </main>

    <LayoutDefaultFooter
      v-if="!isAssistant"
      :site-main-logo="siteMainLogo"
      :site-logo="siteLogo"
      :site-email="siteEmail"
      :site-hotline="siteHotline"
      :site-address="siteAddress"
    />

    <!-- Chatbot: all state and markup live in the component. -->
    <ChatWidget ref="chatWidget" />

    <!-- Social bubble: popup/floating MXH đối xứng chatbot ở góc trái (PC) / góc phải (Mobile). -->
    <SocialBubble v-if="!isAssistant" :is-hidden="isMobileMenuOpen || isChatOpen" />

    <LayoutDefaultBottomNav
      v-if="!isAssistant"
      :bottom-nav="bottomNav"
      :nav-item-label="navItemLabel"
      :is-mobile-menu-open="isMobileMenuOpen"
      :is-chat-open="isChatOpen"
      @bottom-nav-click="onBottomNavClick"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, resolveComponent } from 'vue'
import { useLiveSearch } from '~/composables/useLiveSearch'
import { useMobileMenu } from '~/composables/useMobileMenu'
import { useReaderMenu } from '~/composables/useReaderMenu'
import { useLayoutNav } from '~/composables/useLayoutNav'
import { useSiteSettings, type PublicSettingsResponse } from '~/composables/useSiteSettings'

// `setConfig` ghi vào `useState('layout-config')` chia sẻ với useLayoutConfig
// ở mọi consumer (admin, list pages, SocialBubble). Đăng ký một lần ở layout.
// `containerPx` → set `--container-max` trên root để .container (main.css) nắm theo.
//
// `useAsyncData` ở top-level setup với `await` ép Nuxt Suspense đợi settings
// resolve trước khi commit SSR. Nếu không `await` (composable không-`await`),
// `settingsData.value` = `null` khi setup chạy đồng bộ → `navMenu` computed
// dựng `DEFAULT_NAV` → client hydrate dùng payload DB config → hydration
// mismatch → class `group` trên `<li>` bị Vue gán sai chỗ → `group-hover` của
// "Đào tạo nghề"/"Pháp luật" không trigger. Xem `useSiteSettings.ts` +
// `useLayoutNav.ts`.
const { data: settingsData } = await useAsyncData<PublicSettingsResponse | null>(
  'public-settings-nav',
  () => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<PublicSettingsResponse>)('/api/public/settings'),
  { default: () => null },
)
const { containerPx, applySettings, sitePublicSettings } = useSiteSettings(settingsData)
const containerStyleVar = computed(() => ({ '--container-max': `${containerPx.value}px` }))

// Resolve NuxtLink once so runtime `:is` bindings render a real <a> (a string
// `:is="'nuxt-link'"` renders an inert custom element that never navigates).
// Giữ lại cho các component con import không cần; bản layout không dùng trực tiếp
// sau tách, nhưng resolveComponent('NuxtLink') không có tác dụng phụ.
void resolveComponent('NuxtLink')

const { currentLang, locales, t, setLang } = useI18n()
const isLangMenuOpen = ref(false)

// ── Mobile menu + sticky + submenu ──────────────────────────────────────────
// `handleScroll`/`handleKeydown`/`handleDocumentPointerDown` + listeners ở đây
// (không trong composable) vì `tests/public-pages-structure.test.ts` grep
// `mousedown', handleDocumentPointerDown` + `removeEventListener('mousedown',
// handleDocumentPointerDown)` trong source default.vue — đó là ràng buộc thật.
const {
  clientMounted,
  isSticky,
  isMobileMenuOpen,
  mobileOpenSubmenu,
  toggleMobileMenu,
  toggleMobileSubmenu,
  onNavClick,
} = useMobileMenu()

// ── Live search (chia `isMobileMenuOpen` để đóng drawer khi điều hướng) ─────
const {
  searchQuery,
  isSearchActive,
  liveSearchResults,
  isSearchingLive,
  showLivePreview,
  searchInputRef,
  searchBarRef,
  onSearchInput,
  clearSearch,
  closeSearchAndNavigate,
  toggleSearch,
  handleSearch,
} = useLiveSearch(isMobileMenuOpen)

// ── Reader auth + notifications + menu danh tính ────────────────────────────
// `onReaderSignOut` ở đây (không trong composable) vì nó đóng `isReaderMenuOpen`
// và test grep `isReaderMenuOpen.value = false` trong default.vue source.
const {
  reader,
  readerLoaded,
  loadReader,
  readerSignIn,
  readerSignOut,
  readerSignInMessage,
  isReaderMenuOpen,
  unreadCount,
  notifLoaded,
  loadNotifications,
  resetNotifications,
} = useReaderMenu()

// Template ref trên <DefaultHeader ref="headerRef">; con expose readerMenuRef
// + notifBellRef qua `defineExpose`. Layout đọc qua `headerRef.value?.readerMenuRef`
// trong `handleDocumentPointerDown` và `headerRef.value?.notifBellRef` trong
// `onReaderSignOut`. Hai ref destructured từ `useReaderMenu()` không dùng trực
// tiếp ở layout — component con owns DOM và expose qua `headerRef`.
const headerRef = ref<{ readerMenuRef?: HTMLElement | null; notifBellRef?: { close?: () => void } | null } | null>(null)

// ─── Thông báo: nạp sớm cho huy hiệu mobile ─────────────────────────────────
// `watch(reader)` ở đây (không trong composable) vì `tests/reader-notifications.test.ts`
// grep `watch(reader` + `loadNotifications(` trong default.vue source — eager
// load là trách nhiệm layout (huy hiệu mobile không có cú mở nào để bám), tách
// vào composable là một maintainance inversion mà test chặn.
watch(reader, (value) => {
  if (!value) { resetNotifications(); return }
  if (!notifLoaded.value) {
    loadNotifications().catch(() => {
      // 401 ở đây nghĩa là vé đã hết hiệu lực. `useReaderAuth` sở hữu quyết định
      // đó và lượt tải trang sau sẽ tự chỉnh; một thông báo lỗi ở header cho một
      // danh sách chưa ai mở là tiếng ồn.
    })
  }
})

/**
 * Đăng xuất từ cả hai bề mặt (menu desktop và ngăn kéo mobile).
 *
 * Đóng cả hai lớp phủ trước khi gọi: `signOut` xoá danh tính, nên khối chứa nút
 * vừa bấm bị `v-if` tháo ra. Để menu mở lại thì lần đăng nhập sau nó vẫn còn mở
 * đúng ở chỗ đó, treo dưới một cái tên đã không còn.
 */
async function onReaderSignOut() {
  isReaderMenuOpen.value = false
  headerRef.value?.notifBellRef?.close?.()
  isMobileMenuOpen.value = false
  await readerSignOut()
  // Xoá luôn danh sách và bộ đếm: state ở cấp module nên nó sống qua lượt đăng
  // xuất, và trên máy dùng chung người kế tiếp sẽ thấy huy hiệu của người trước.
  resetNotifications()
}

const route = useRoute()
const isAssistant = computed(() => route.path === '/assistant' || route.path.startsWith('/assistant/'))
const router = useRouter()
const { error: toastError } = useToast()

// Đóng dropdown nav desktop khi chuyển trang.
//
// Dropdown nav mở bằng `:focus-within`/`:hover` thuần CSS (không có state JS),
// nên sau khi bấm một mục con, focus vẫn nằm trong `<li>` đó và menu cứ mở
// regardless route đã đổi. `activeElement.blur()` gỡ focus → `:focus-within`
// tắt → menu đóng theo chính CSS đã có, không phải thêm(state mới.
watch(() => route.path, () => {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLElement && active.closest('.desktop-nav')) active.blur()
})

// ── Nav config động từ admin settings (fallback DEFAULT_NAV) ───────────────
// Truyền `settingsData` vào `useLayoutNav` để `navMenu`/`bottomNav` computed đọc
// trực tiếp — SSR dựng đúng DB config, tránh hydration mismatch (xem giải thích
// trong `useLayoutNav.ts`).
const { navMenu, bottomNav, navItemLabel, setNavMenu, setBottomNav } = useLayoutNav(settingsData)

// The bottom nav dims itself while the chat is open and highlights its chatbot
// item; both need to read the widget's state, which the widget owns.
// Widget phơi `isChatbotOpen` + `toggleChatbot` cho thanh nav dưới đọc trạng thái.
const chatWidget = ref<{ isChatbotOpen?: boolean; toggleChatbot?: () => void } | null>(null)
const isChatOpen = computed(() => chatWidget.value?.isChatbotOpen ?? false)
const onBottomNavClick = (item: { type: string }) => {
  if (item.type === 'chatbot') chatWidget.value?.toggleChatbot?.()
  else if (item.type === 'drawer') toggleMobileMenu()
}

// `siteLogo`/`siteMainLogo` computed giữ ở default.vue (không tách vào
// `useSiteSettings`) vì `tests/main-logo-settings.test.ts` grep
// `siteMainLogo = computed(` và `siteLogo = computed(` trong source default.vue.
const siteLogo = computed(() => {
  const val = sitePublicSettings.value.logo_url
  if (val === '') return ''
  return val?.trim() || '/Logo.png'
})
const siteMainLogo = computed(() => sitePublicSettings.value.main_logo_url?.trim() || '')
const siteHotline = computed(() => sitePublicSettings.value.hotline?.trim() || '0903.480.985')
const siteEmail = computed(() => sitePublicSettings.value.email?.trim() || 'contact@conduonghuongthien.com.vn')
const siteAddress = computed(() => sitePublicSettings.value.address?.trim() || 'Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội')
const siteHotlineTel = computed(() => 'tel:' + siteHotline.value.replace(/[^0-9+]/g, ''))

// Áp dụng settings khi `settingsData` thay đổi: nav menu (navbar + mobile) +
// layout config. `parseNavConfig`/`parseBottomNavConfig` kiểm cả HÌNH DẠNG, không
// chỉ cú pháp JSON — một JSON hợp lệ mà sai hình dạng (`{}`, `[{}]`) trả `null`
// → lùi về bảng mặc định, không làm cổng trông như bị hỏng.
watch(settingsData, (res) => {
  if (!res?.settings) return
  const navbarRaw = res.settings.nav_menu_navbar || res.settings.nav_menu
  if (navbarRaw) setNavMenu(navbarRaw)
  const mobileRaw = res.settings.nav_menu_mobile
  if (mobileRaw) setBottomNav(mobileRaw)
  applySettings(res)
}, { immediate: true })

// rAF-throttled scroll handler: coalesces bursts of scroll events into one write
// per frame and only mutates `isSticky` when the boolean actually flips. Hysteresis
// (sticky >80, unsticky <60) prevents flicker right at the threshold. The listener
// is registered passive (see onMounted) so it never blocks the compositor.
let scrollTicking = false
const applyStickyState = () => {
  scrollTicking = false
  const y = window.scrollY
  const next = isSticky.value ? y > 60 : y > 80
  if (next !== isSticky.value) isSticky.value = next
}
const handleScroll = () => {
  if (isLangMenuOpen.value) isLangMenuOpen.value = false
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(applyStickyState)
}

const handleKeydown = (event: KeyboardEvent) => {
  // The chatbot dialog handles its own Escape via a keydown on the dialog; this
  // only needs to catch the mobile menu.
  if (event.key !== 'Escape') return
  if (isMobileMenuOpen.value) isMobileMenuOpen.value = false
  // Đóng cả menu danh tính: một menu chỉ đóng được bằng cách bấm lại đúng nút đã
  // mở nó là một cái bẫy bàn phím — Escape là cách người dùng bàn phím thoát khỏi
  // mọi lớp phủ khác trên trang này.
  if (isReaderMenuOpen.value) isReaderMenuOpen.value = false
  if (isLangMenuOpen.value) isLangMenuOpen.value = false
  if (isSearchActive.value) {
    isSearchActive.value = false
    showLivePreview.value = false
  }
}

/**
 * Bấm ra ngoài thì đóng menu danh tính hoặc khung xem trước tìm kiếm.
 *
 * Bắt ở pha `mousedown` chứ không `click`: một cú bấm vào liên kết bên trong menu
 * là `mousedown` rồi `click`, và nếu đóng ở `click` thì handler này chạy **sau**
 * khi Vue đã tháo phần tử — nhưng bắt ở `mousedown` với kiểm tra `contains` thì
 * liên kết vẫn còn trong cây, nên nó vẫn điều hướng bình thường.
 */
const handleDocumentPointerDown = (event: MouseEvent) => {
  const target = event.target instanceof Node ? event.target : null
  if (isReaderMenuOpen.value) {
    const root = headerRef.value?.readerMenuRef ?? null
    if (root && (!target || !root.contains(target))) isReaderMenuOpen.value = false
  }
  // Lang menu outside-click do DefaultTopBar sở hữu (mousedown listener riêng).
  if (showLivePreview.value) {
    const searchRoot = searchBarRef.value
    if (searchRoot && (!target || !searchRoot.contains(target))) {
      showLivePreview.value = false
    }
  }
}

onMounted(() => {
  clientMounted.value = true
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('keydown', handleKeydown)
  document.addEventListener('mousedown', handleDocumentPointerDown)
  // Sau khi mount, không phải trong lúc dựng: mọi trang công khai phục vụ qua
  // `swr: 60`, nên danh tính người đọc mà lọt vào HTML sẽ được phát lại cho
  // người kế tiếp. Không `await`: header không được chặn lượt vẽ đầu để chờ một
  // lượt fetch chỉ quyết định hiện tên hay hiện nút đăng nhập.
  loadReader()

  // Cổng OAuth chuyển người đọc về kèm `?dangnhap=<lý do>` khi lượt đăng nhập bị
  // từ chối. Không có chỗ hiện lý do thì một cú bấm "Đăng nhập" không dẫn tới
  // đâu cả, và người đọc chỉ biết là nó không chạy.
  const reason = readerSignInMessage(route.query.dangnhap)
  if (reason) {
    toastError(reason)
    // Gỡ tham số khỏi URL để F5 không hiện lại thông báo của một lượt đã xong.
    router.replace({ query: { ...route.query, dangnhap: undefined } })
  }
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('mousedown', handleDocumentPointerDown)
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>
