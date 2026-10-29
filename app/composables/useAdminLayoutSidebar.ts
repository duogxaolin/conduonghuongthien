import { ref, watch } from 'vue'

/**
 * The admin sidebar's two states (`app/layouts/admin.vue`, split in wave3 D-SPLIT): collapsed
 * to an icon rail on desktop, and open as a drawer over a backdrop on a narrow screen. Moved
 * verbatim from the layout; the route is the layout's own, handed in.
 *
 * - Any navigation closes the drawer — `fullPath`, so a change of query alone (a list's
 *   `?page=2`) closes it too.
 * - While the drawer is open the page behind it does not scroll (body + html `overflow`,
 *   body `touch-action`), the same lock `useMobileMenu` holds for the public drawer. Nothing
 *   releases it when the layout unmounts with the drawer still open (pinned as is in
 *   tests/admin-layout.test.ts): every way out of the layout is a navigation, which closes
 *   the drawer first.
 */
export function useAdminLayoutSidebar(route: { readonly fullPath: string }) {
  const isSidebarCollapsed = ref(false)
  const isMobileMenuOpen = ref(false)

  const toggleSidebar = () => { isSidebarCollapsed.value = !isSidebarCollapsed.value }
  const expandSidebar = () => { isSidebarCollapsed.value = false }
  const toggleMobileMenu = () => { isMobileMenuOpen.value = !isMobileMenuOpen.value }
  const closeMobileMenu = () => { isMobileMenuOpen.value = false }

  watch(() => route.fullPath, () => { isMobileMenuOpen.value = false })

  watch(isMobileMenuOpen, (isMenuOpen) => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = isMenuOpen ? 'hidden' : ''
      document.documentElement.style.overflow = isMenuOpen ? 'hidden' : ''
      document.body.style.touchAction = isMenuOpen ? 'none' : ''
    }
  })

  return { isSidebarCollapsed, isMobileMenuOpen, toggleSidebar, expandSidebar, toggleMobileMenu, closeMobileMenu }
}
