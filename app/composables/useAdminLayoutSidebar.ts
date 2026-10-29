import { onScopeDispose, ref, watch } from 'vue'

/**
 * The admin sidebar's two states (`app/layouts/admin.vue`, split in wave3 D-SPLIT): collapsed
 * to an icon rail on desktop, and open as a drawer over a backdrop on a narrow screen. Moved
 * verbatim from the layout; the route is the layout's own, handed in.
 *
 * - Any navigation closes the drawer — `fullPath`, so a change of query alone (a list's
 *   `?page=2`) closes it too.
 * - While the drawer is open the page behind it does not scroll (body + html `overflow`,
 *   body `touch-action`), the same lock `useMobileMenu` holds for the public drawer.
 * - FINDING-AL1 (2026-10-29, measured in Chromium on the base build): "Thoát" in the open
 *   drawer signs out and goes to `/admin/login` (`layout: false`). The layout unmounts before
 *   the route watcher above closes the drawer, so the login page kept `overflow: hidden` and
 *   `touch-action: none` — no scrolling, no pinch-zoom on a phone until a full reload. The
 *   lock is now released when the layout goes away with the drawer still open.
 */
export function useAdminLayoutSidebar(route: { readonly fullPath: string }) {
  const isSidebarCollapsed = ref(false)
  const isMobileMenuOpen = ref(false)

  const toggleSidebar = () => { isSidebarCollapsed.value = !isSidebarCollapsed.value }
  const expandSidebar = () => { isSidebarCollapsed.value = false }
  const toggleMobileMenu = () => { isMobileMenuOpen.value = !isMobileMenuOpen.value }
  const closeMobileMenu = () => { isMobileMenuOpen.value = false }

  watch(() => route.fullPath, () => { isMobileMenuOpen.value = false })

  const applyScrollLock = (isMenuOpen: boolean) => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = isMenuOpen ? 'hidden' : ''
      document.documentElement.style.overflow = isMenuOpen ? 'hidden' : ''
      document.body.style.touchAction = isMenuOpen ? 'none' : ''
    }
  }
  watch(isMobileMenuOpen, applyScrollLock)
  // FINDING-AL1: the layout unmounting with the drawer open must not leave the next page locked.
  onScopeDispose(() => {
    if (isMobileMenuOpen.value) applyScrollLock(false)
  })

  return { isSidebarCollapsed, isMobileMenuOpen, toggleSidebar, expandSidebar, toggleMobileMenu, closeMobileMenu }
}
