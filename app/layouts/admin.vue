<script setup lang="ts">
import { useLayoutConfig, parseLayoutSetting } from '~/composables/useLayoutConfig'
import { useAdminLayoutMenu } from '~/composables/useAdminLayoutMenu'
import { useAdminLayoutSidebar } from '~/composables/useAdminLayoutSidebar'
import { useAdminLayoutCacheClear } from '~/composables/useAdminLayoutCacheClear'
import { adminFetch } from '~/composables/adminFetch'
import type { PublicSettingsPayload } from '~/types/public-site-api'
import { adminPageTitle } from '~/utils/admin-layout-menu'
import AdminSidebar from '~/components/admin/layout/AdminSidebar.vue'
import AdminTopBar from '~/components/admin/layout/AdminTopBar.vue'

// Khung quản trị, tách ở wave3 (D-SPLIT; docs/decisions/refactor-large-files.md): layout giữ
// lượt đọc `layout_config`, nền mờ của ngăn kéo mobile, vùng nội dung và các hộp thoại toàn
// cục; sidebar và thanh trên là `components/admin/layout/*` (chỉ hiển thị), trạng thái và
// mọi lượt gọi ở các composable `useAdminLayout*`. Hành vi: tests/admin-layout.test.ts.

// Container width áp cho mọi trang admin — admin chỉnh ở /admin/settings/social-links
// (bố cục site). Default 1240 khớp với chuẩn cũ, fallback an toàn.
// Admin.vue không share useAsyncData('public-settings-nav') với default.vue
// (khác layout, khác cây component) nên tự fetch key `layout_config` một lần.
// Dùng `--container-max` CSS var (cùng cơ chế với default.vue) thay vì max-width
// trực tiếp — nhất quán khi sau này admin dùng class `.container`.
const { containerPx, setConfig } = useLayoutConfig()
const containerStyleVar = computed(() => ({ '--container-max': `${containerPx.value}px` }))

await useAsyncData<PublicSettingsPayload | null>(
  'admin-layout-config',
  () => adminFetch<PublicSettingsPayload>('/api/public/settings'),
  { default: () => null },
).then(({ data }) => {
  if (data.value?.settings?.layout_config) {
    try {
      setConfig(parseLayoutSetting(data.value.settings.layout_config))
    } catch { /* fallback default */ }
  }
})

const { user, logout, hasPermission } = useAdminAuth()
const route = useRoute()
const toast = useToast()

const { isSidebarCollapsed, isMobileMenuOpen, toggleSidebar, expandSidebar, toggleMobileMenu, closeMobileMenu } = useAdminLayoutSidebar(route)
const { isClearingCache, clearPublicCache } = useAdminLayoutCacheClear(toast)
const { searchQuery, isSearching, filteredMenuGroups, openAccordions, toggleAccordion } = useAdminLayoutMenu({ route, user, hasPermission })

const currentAdminPageTitle = computed(() => adminPageTitle(route.name))
</script>

<template>
  <div class="min-h-screen bg-surface font-[Inter,system-ui,sans-serif] text-ink-admin">
    <ToastContainer />

    <!-- Mobile backdrop -->
    <Transition name="fade">
      <div
        v-if="isMobileMenuOpen"
        class="fixed inset-0 bg-black/50 z-40 lg:hidden"
        @click="closeMobileMenu"
        @touchmove.prevent
      />
    </Transition>
    <!-- Sidebar -->
    <AdminSidebar
      v-model:search-query="searchQuery"
      :is-sidebar-collapsed="isSidebarCollapsed"
      :is-mobile-menu-open="isMobileMenuOpen"
      :user="user"
      :filtered-menu-groups="filteredMenuGroups"
      :is-searching="isSearching"
      :open-accordions="openAccordions"
      @toggle-sidebar="toggleSidebar"
      @expand-sidebar="expandSidebar"
      @close-mobile-menu="closeMobileMenu"
      @toggle-accordion="toggleAccordion"
      @logout="logout"
    />

    <!-- Main Content Area -->
    <div class="main-content flex flex-col min-h-screen min-w-0 max-w-full overflow-x-hidden" :class="{ 'sidebar-collapsed': isSidebarCollapsed }">
      <!-- Topbar -->
      <AdminTopBar
        :current-admin-page-title="currentAdminPageTitle"
        :user="user"
        :is-clearing-cache="isClearingCache"
        @toggle-mobile-menu="toggleMobileMenu"
        @clear-public-cache="clearPublicCache"
        @logout="logout"
      />

      <!-- Page Content -->
      <main class="p-4 md:p-6 flex-1 min-w-0 max-w-full">
        <div class="mx-auto w-full min-w-0 max-w-full" :style="containerStyleVar">
          <AdminMfaEnrollmentBanner />
          <slot />
        </div>
      </main>
    </div>
  </div>

  <!-- Global Media Library Modal — rendered once, driven by useImagePicker() -->
  <AdminMediaLibraryModal />
  <!-- Global Confirm Dialog — rendered once, driven by useConfirm() -->
  <AdminConfirmModal />
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.sidebar {
  display: none;
  width: 260px;
  transition: width 250ms ease;
}
.sidebar.collapsed { width: 70px; }
.sidebar.is-open { display: flex; }
@media (min-width: 1024px) {
  .sidebar { display: flex; }
}

.main-content {
  transition: margin-left 250ms ease;
}
@media (min-width: 1024px) {
  .main-content { margin-left: 260px; }
  .main-content.sidebar-collapsed { margin-left: 70px; }
}
</style>
