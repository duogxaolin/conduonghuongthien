<script setup lang="ts">
/**
 * Sidebar của khung quản trị — tách khỏi `app/layouts/admin.vue` (wave3 D-SPLIT): thương
 * hiệu + nút thu gọn/đóng, ô tìm nhanh + lối ra trang công khai, danh sách menu
 * (`AdminSidebarNav`) và thẻ tài khoản (`AdminSidebarUserCard`). Chỉ hiển thị — trạng thái
 * thu gọn / ngăn kéo là của `useAdminLayoutSidebar`, menu và ô tìm của `useAdminLayoutMenu`,
 * đăng xuất của `useAdminAuth`; phần này nhận props và phát sự kiện.
 *
 * MỘT gốc duy nhất, `<aside class="sidebar …">`, không chú thích ở cấp gốc: CSS `.sidebar`
 * (ẩn trên màn hẹp tới khi `.is-open`, rộng 260/70 px) nằm trong `<style scoped>` của layout
 * và chỉ tới được phần tử gốc của component con (Vue gắn scope id của cha lên gốc của con).
 * Thêm gốc thứ hai — kể cả một chú thích, vốn được giữ ở chế độ dev — là sidebar mất CSS
 * (tests/admin-layout-split-source.test.ts canh điều này).
 *
 * Ô tìm và `focusSearch` ở đây cùng ref của ô: bấm kính lúp ở chế độ thu gọn mở rộng sidebar
 * (`expandSidebar`) rồi đưa con trỏ vào ô ở nhịp sau, khi ô đã được vẽ lại.
 */
import { nextTick, ref } from 'vue'
import type { AdminUser } from '~/composables/useAdminAuth'
import type { AdminMenuGroup } from '~/utils/admin-layout-menu'
import AdminSidebarNav from '~/components/admin/layout/AdminSidebarNav.vue'
import AdminSidebarUserCard from '~/components/admin/layout/AdminSidebarUserCard.vue'

defineProps<{
  isSidebarCollapsed: boolean
  isMobileMenuOpen: boolean
  user: AdminUser | null
  filteredMenuGroups: AdminMenuGroup[]
  isSearching: boolean
  openAccordions: Set<string>
}>()

const searchQuery = defineModel<string>('searchQuery', { required: true })
const emit = defineEmits<{
  toggleSidebar: []
  expandSidebar: []
  closeMobileMenu: []
  toggleAccordion: [title: string]
  logout: []
}>()

const searchInputRef = ref<HTMLInputElement | null>(null)

function focusSearch() {
  emit('expandSidebar')
  nextTick(() => {
    searchInputRef.value?.focus()
  })
}
</script>

<template>
  <aside
    class="sidebar fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-[#0d1f11] text-line border-r border-white/[0.08] shadow-[4px_0_24px_rgba(0,0,0,0.25)] overflow-hidden select-none"
    :class="{ 'is-open': isMobileMenuOpen, 'collapsed': isSidebarCollapsed }"
  >
    <!-- Sidebar Header -->
    <div class="h-16 flex items-center justify-between px-3.5 border-b border-white/10 shrink-0 bg-black/10">
      <!-- Brand / Logo (Expanded) -->
      <div v-if="!isSidebarCollapsed" class="flex items-center gap-3 overflow-hidden min-w-0">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 border border-brand-300/30 shadow-[0_2px_10px_rgba(44,110,51,0.3)] flex items-center justify-center text-brand-300 shrink-0">
          <i class="fa-solid fa-leaf text-base"></i>
        </div>
        <div class="flex flex-col min-w-0">
          <span class="font-black text-[0.92rem] tracking-wide text-white truncate leading-tight">HƯỚNG THIỆN</span>
          <span class="text-[0.62rem] font-semibold text-brand-300 tracking-wider uppercase opacity-90 truncate mt-0.5">Cục C11 • Quản Trị</span>
        </div>
      </div>

      <!-- Brand / Logo (Collapsed) -->
      <div v-else class="w-9 h-9 mx-auto rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 border border-brand-300/30 shadow-[0_2px_10px_rgba(44,110,51,0.3)] flex items-center justify-center text-brand-300 shrink-0 cursor-pointer" @click="emit('toggleSidebar')" title="Mở rộng menu">
        <i class="fa-solid fa-leaf text-base"></i>
      </div>

      <!-- Toggle Button for Desktop (Expanded) -->
      <button
        v-if="!isSidebarCollapsed"
        type="button"
        class="hidden lg:flex w-7 h-7 items-center justify-center rounded-lg bg-white/[0.07] hover:bg-white/[0.14] text-brand-300 hover:text-white transition-all cursor-pointer border-0 shrink-0"
        @click="emit('toggleSidebar')"
        title="Thu gọn sidebar"
      >
        <i class="fa-solid fa-chevron-left text-[11px]"></i>
      </button>

      <!-- Close Button for Mobile -->
      <button
        type="button"
        class="flex lg:hidden w-8 h-8 items-center justify-center rounded-lg bg-white/[0.07] hover:bg-white/[0.14] text-brand-300 hover:text-white transition-all cursor-pointer border-0 shrink-0"
        @click="emit('closeMobileMenu')"
        title="Đóng menu"
      >
        <i class="fa-solid fa-xmark text-sm"></i>
      </button>
    </div>

    <!-- Quick Search & Actions (Expanded) -->
    <div v-if="!isSidebarCollapsed" class="px-3 pt-3 pb-1.5 shrink-0 space-y-2">
      <!-- Search bar -->
      <div class="relative flex items-center">
        <i class="fa-solid fa-magnifying-glass absolute left-3 text-white/30 text-xs pointer-events-none"></i>
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          placeholder="Tìm nhanh chức năng..."
          class="w-full bg-white/[0.05] hover:bg-white/[0.08] focus:bg-white/[0.12] border border-white/10 focus:border-brand-300/50 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-white/35 focus:outline-none transition-all duration-150"
        />
        <button
          v-if="searchQuery"
          type="button"
          @click="searchQuery = ''"
          class="absolute right-2 text-white/40 hover:text-white text-xs p-1 bg-transparent border-0 cursor-pointer"
          title="Xoá tìm kiếm"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <!-- Quick link to public site -->
      <nuxt-link
        v-if="!searchQuery"
        to="/"
        target="_blank"
        class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] text-[0.74rem] text-white/70 hover:text-brand-300 no-underline font-medium transition-colors border border-white/[0.06] group/portal"
        title="Mở cổng thông tin công cộng trong tab mới"
      >
        <span class="flex items-center gap-2">
          <i class="fa-solid fa-globe text-[11px] text-brand-300 group-hover/portal:scale-110 transition-transform"></i>
          <span>Xem Website công khai</span>
        </span>
        <i class="fa-solid fa-arrow-up-right-from-square text-[9px] text-white/40 group-hover/portal:text-brand-300"></i>
      </nuxt-link>
    </div>

    <!-- Quick Actions for Collapsed Mode -->
    <div v-else class="px-2 pt-3 pb-1 flex flex-col items-center gap-2 shrink-0">
      <button
        type="button"
        @click="focusSearch"
        class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.05] hover:bg-white/[0.12] text-white/60 hover:text-brand-300 transition-colors border-0 cursor-pointer"
        title="Tìm kiếm chức năng (Mở rộng)"
      >
        <i class="fa-solid fa-magnifying-glass text-xs"></i>
      </button>
      <nuxt-link
        to="/"
        target="_blank"
        class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.03] hover:bg-white/[0.12] text-white/60 hover:text-brand-300 transition-colors border border-white/[0.06] no-underline"
        title="Xem Website công khai ↗"
      >
        <i class="fa-solid fa-globe text-xs"></i>
      </nuxt-link>
    </div>

    <!-- Nav Items -->
    <AdminSidebarNav
      v-model:search-query="searchQuery"
      :filtered-menu-groups="filteredMenuGroups"
      :is-sidebar-collapsed="isSidebarCollapsed"
      :is-searching="isSearching"
      :open-accordions="openAccordions"
      @toggle-accordion="emit('toggleAccordion', $event)"
    />

    <!-- Sidebar Footer / User Profile Card -->
    <AdminSidebarUserCard
      v-if="user"
      :user="user"
      :is-sidebar-collapsed="isSidebarCollapsed"
      @logout="emit('logout')"
    />
  </aside>
</template>
