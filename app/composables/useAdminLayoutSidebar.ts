import { onScopeDispose, ref, watch } from 'vue'

/**
 * The admin sidebar's two states (`app/layouts/admin.vue`, split in wave3 D-SPLIT): collapsed
 * to an icon rail on desktop, and open as a drawer over a backdrop on a narrow screen. Moved
 * from the layout (the scroll-lock release on unmount is new: FINDING-AL1 below); the route
 * is the layout's own, handed in.
 *
 * - Any navigation closes the drawer — `fullPath`, so a change of query alone (a list's
 *   `?page=2`) closes it too.
 * - While the drawer is open the page behind it does not scroll (body + html `overflow`,
 *   body `touch-action`), the same lock `useMobileMenu` holds for the public drawer.
 * - FINDING-AL1 (2026-10-29, measured in Chromium on the base build): "Thoát" in the open
 *   drawer signs out and goes to `/admin/login` (`layout: false`). The layout unmounts before
 *   the route watcher above closes the drawer, so the login page kept `overflow: hidden` and
 *   `touch-action: none` — no scrolling, no pinch-zoom on a phone until a full reload. The
 *   lock is now released when the layout goes away while it holds the lock (`lockApplied`,
 *   not the drawer flag: they differ for one tick after a toggle — verifier cases R1/R2).
 */
export function useAdminLayoutSidebar(route: { readonly fullPath: string }) {
  const isSidebarCollapsed = ref(false)
  const isMobileMenuOpen = ref(false)

  const toggleSidebar = () => { isSidebarCollapsed.value = !isSidebarCollapsed.value }
  const expandSidebar = () => { isSidebarCollapsed.value = false }
  const toggleMobileMenu = () => { isMobileMenuOpen.value = !isMobileMenuOpen.value }
  const closeMobileMenu = () => { isMobileMenuOpen.value = false }

  watch(() => route.fullPath, () => { isMobileMenuOpen.value = false })

  // Whether the page styles currently hold THIS composable's lock — not whether the drawer
  // is open: the watcher below runs in the pre-flush, so in the tick between a toggle and the
  // flush the two disagree.
  let lockApplied = false
  const applyScrollLock = (isMenuOpen: boolean) => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = isMenuOpen ? 'hidden' : ''
      document.documentElement.style.overflow = isMenuOpen ? 'hidden' : ''
      document.body.style.touchAction = isMenuOpen ? 'none' : ''
      lockApplied = isMenuOpen
    }
  }
  watch(isMobileMenuOpen, applyScrollLock)
  // FINDING-AL1: the layout unmounting while its lock is on must not leave the next page
  // locked — also when the drawer was closed in the same tick (the watcher never ran). A lock
  // this composable never applied (opened in the same tick) is someone else's styles: left alone.
  onScopeDispose(() => {
    if (lockApplied) applyScrollLock(false)
  })

  return { isSidebarCollapsed, isMobileMenuOpen, toggleSidebar, expandSidebar, toggleMobileMenu, closeMobileMenu }
}
