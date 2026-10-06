import { ref, watch } from 'vue'

/**
 * State ngăn kéo mobile + submenu accordion + sticky header.
 *
 * `handleScroll`/`handleKeydown`/`handleDocumentPointerDown` và các listener
 * `onMounted`/`onUnmounted` ở default.vue, không ở đây: `tests/public-pages-structure.test.ts`
 * grep source text default.vue cho `mousedown', handleDocumentPointerDown` và
 * `removeEventListener('mousedown', handleDocumentPointerDown)` — đó là ràng
 * buộc thật, không phải chỉ江市. Composable này chỉ giữ state + `watch` khóa
 * cuộn body — phần không bị grep.
 *
 * `isSticky` là boolean flip theo ngưỡng cuộn (hysteresis 80/60) — giá trị
 * thật do `handleScroll` (default.vue) đặt; composable merely owns the ref.
 */
export function useMobileMenu() {
  const clientMounted = ref(false)
  const isSticky = ref(false)
  const isMobileMenuOpen = ref(false)
  const mobileOpenSubmenu = ref<string | null>(null)

  const toggleMobileMenu = () => {
    isMobileMenuOpen.value = !isMobileMenuOpen.value
  }

  const toggleMobileSubmenu = (menuKey: string) => {
    mobileOpenSubmenu.value = mobileOpenSubmenu.value === menuKey ? null : menuKey
  }

  /** Bấm một `<a>` trong drawer thì đóng drawer lại. */
  const onNavClick = (e: Event) => {
    // `closest` là của `Element`; một target không phải Element không có liên kết nào
    // để bấm vào, nên nó chỉ đơn giản không đóng menu.
    if (e.target instanceof Element && e.target.closest('a')) {
      isMobileMenuOpen.value = false
    }
  }

  // Widget khóa cuộn cho dialog của nó; layout chỉ trả cho ngăn kéo mobile.
  watch(isMobileMenuOpen, (isMenuOpen) => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = isMenuOpen ? 'hidden' : ''
      document.documentElement.style.overflow = isMenuOpen ? 'hidden' : ''
      document.body.style.touchAction = isMenuOpen ? 'none' : ''
    }
  })

  return {
    clientMounted,
    isSticky,
    isMobileMenuOpen,
    mobileOpenSubmenu,
    toggleMobileMenu,
    toggleMobileSubmenu,
    onNavClick,
  }
}
