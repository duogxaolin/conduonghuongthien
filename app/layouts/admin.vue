<script setup lang="ts">
const { user, logout, hasPermission } = useAdminAuth()
const route = useRoute()

const isSidebarCollapsed = ref(false)
const isMobileMenuOpen = ref(false)

const toggleSidebar = () => { isSidebarCollapsed.value = !isSidebarCollapsed.value }
const toggleMobileMenu = () => { isMobileMenuOpen.value = !isMobileMenuOpen.value }

watch(() => route.fullPath, () => { isMobileMenuOpen.value = false })

const menuGroups = computed(() => [
  {
    title: 'Tổng quan',
    items: [
      { label: 'Dashboard', icon: 'fa-solid fa-chart-pie', path: '/admin' },
      ...(hasPermission('analytics', 'read') ? [{ label: 'Thống kê truy cập', icon: 'fa-solid fa-chart-line', path: '/admin/analytics' }] : []),
    ]
  },
  {
    title: 'Hệ thống & Nhân sự',
    items: [
      // Không gắn hasPermission: đây là tài khoản của chính người đang đăng nhập,
      // ai cũng phải đổi được mật khẩu và xem được lịch sử truy cập của mình.
      { label: 'Tài khoản của tôi', icon: 'fa-solid fa-user-gear', path: '/admin/profile' },
      { label: 'Người dùng', icon: 'fa-solid fa-users', path: '/admin/users' },
      { label: 'Vai trò & Phân quyền', icon: 'fa-solid fa-user-shield', path: '/admin/users/roles' },
    ]
  },
  {
    title: 'Nội dung Website',
    items: [
      ...(hasPermission('pages', 'read') ? [{ label: 'Quản lý Trang', icon: 'fa-solid fa-file-lines', path: '/admin/content/pages' }] : []),
      { label: 'Menu chính (Navbar + ☰)', icon: 'fa-solid fa-bars-staggered', path: '/admin/content/navigation/navbar' },
      { label: 'Thanh nổi dưới (Mobile)', icon: 'fa-solid fa-mobile-screen', path: '/admin/content/navigation/mobile' },
      { label: 'Thể loại nội dung', icon: 'fa-solid fa-layer-group', path: '/admin/content/content-types' },
      { label: 'Danh mục', icon: 'fa-solid fa-folder-tree', path: '/admin/content/categories' },
      { label: 'Bài viết & Bản tin', icon: 'fa-solid fa-newspaper', path: '/admin/content/articles' },
      { label: 'Thư viện Media', icon: 'fa-solid fa-images', path: '/admin/media' },
      ...(hasPermission('chatbot_knowledge', 'read') ? [{ label: 'Kho nội dung Chatbot', icon: 'fa-solid fa-book-open', path: '/admin/chatbot/knowledge' }] : []),
    ]
  },
  {
    title: 'Yêu cầu & Cài đặt',
    items: [
      { label: 'Đơn đăng ký hỗ trợ', icon: 'fa-solid fa-envelope-open-text', path: '/admin/submissions' },
      { label: 'Cài đặt chung', icon: 'fa-solid fa-gear', path: '/admin/settings/general' },
      ...(hasPermission('settings', 'read') ? [{ label: 'Cấu hình Email (SMTP)', icon: 'fa-solid fa-envelope', path: '/admin/settings/email' }] : []),
      ...(hasPermission('settings', 'read') ? [{ label: 'Tracking & Marketing', icon: 'fa-solid fa-chart-simple', path: '/admin/settings/tracking' }] : []),
      { label: 'Lưu trữ Media (R2)', icon: 'fa-solid fa-cloud-arrow-up', path: '/admin/settings/media-storage' },
      ...(hasPermission('chatbot_settings', 'read') ? [{ label: 'Cài đặt Chatbot', icon: 'fa-solid fa-robot', path: '/admin/chatbot/settings' }] : []),
    ]
  }
])
</script>

<template>
  <div class="min-h-screen bg-[#f4f7f4] font-[Inter,system-ui,sans-serif] text-[#2c3e2e]">
    <ToastContainer />

    <!-- Mobile backdrop -->
    <Transition name="fade">
      <div
        v-if="isMobileMenuOpen"
        class="fixed inset-0 bg-black/50 z-40 lg:hidden"
        @click="isMobileMenuOpen = false"
      />
    </Transition>

    <!-- Sidebar -->
    <aside
      class="sidebar fixed top-0 bottom-0 left-0 z-50 flex-col bg-[#122815] text-[#e2ede3] overflow-hidden"
      :class="{ 'is-open': isMobileMenuOpen, 'collapsed': isSidebarCollapsed }"
    >
      <!-- Sidebar Header -->
      <div class="h-16 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
        <div class="flex items-center gap-2.5 font-extrabold text-[1.05rem] text-[#8ed694] overflow-hidden">
          <i class="fa-solid fa-leaf text-lg shrink-0"></i>
          <span v-if="!isSidebarCollapsed" class="truncate">ADMIN PANEL</span>
        </div>
        <button
          class="hidden lg:flex w-8 h-8 items-center justify-center rounded-md bg-white/10 text-[#8ed694] hover:bg-white/20 cursor-pointer border-0 shrink-0"
          @click="toggleSidebar"
          :title="isSidebarCollapsed ? 'Mở rộng' : 'Thu gọn'"
        >
          <i :class="isSidebarCollapsed ? 'fa-solid fa-arrow-right' : 'fa-solid fa-arrow-left'" class="text-xs"></i>
        </button>
        <button
          class="flex lg:hidden w-8 h-8 items-center justify-center rounded-md bg-white/10 text-[#8ed694] hover:bg-white/20 cursor-pointer border-0 shrink-0"
          @click="isMobileMenuOpen = false"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <!-- Mobile-only user card -->
      <div
        v-if="user && !isSidebarCollapsed"
        class="flex lg:hidden items-center gap-3 px-4 py-3 border-b border-white/10 bg-white/5"
      >
        <div class="w-9 h-9 rounded-full bg-[#2c6e33] text-white flex items-center justify-center font-bold text-sm shrink-0">
          {{ user.username.charAt(0).toUpperCase() }}
        </div>
        <div class="flex flex-col min-w-0">
          <span class="text-[0.85rem] font-bold text-white truncate">{{ user.username }}</span>
          <span class="text-[0.7rem] text-[#8ed694]">{{ user.isSuperAdmin ? 'SuperAdmin' : user.roleName }}</span>
        </div>
      </div>

      <!-- Nav -->
      <nav class="flex-1 overflow-y-auto py-4 px-2.5">
        <div v-for="(group, gIdx) in menuGroups" :key="gIdx" class="mb-5">
          <div
            v-if="!isSidebarCollapsed"
            class="text-[0.7rem] uppercase tracking-[0.8px] text-white/40 font-bold px-2.5 pb-2"
          >
            {{ group.title }}
          </div>
          <ul class="list-none p-0 m-0 flex flex-col gap-0.5">
            <li v-for="item in group.items" :key="item.path">
              <nuxt-link
                :to="item.path"
                class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/75 no-underline text-[0.88rem] font-medium transition-all duration-200 hover:bg-white/10 hover:text-white"
                active-class="!bg-[#2c6e33] !text-white !font-bold shadow-[0_4px_12px_rgba(44,110,51,0.4)]"
                :title="isSidebarCollapsed ? item.label : ''"
              >
                <i :class="item.icon" class="text-[1.1rem] shrink-0 w-5 text-center"></i>
                <span v-if="!isSidebarCollapsed" class="truncate">{{ item.label }}</span>
              </nuxt-link>
            </li>
          </ul>
        </div>
      </nav>

      <!-- Sidebar Footer -->
      <div v-if="user" class="px-4 py-4 border-t border-white/10 flex items-center justify-between gap-2 shrink-0">
        <div v-if="!isSidebarCollapsed" class="flex items-center gap-2.5 min-w-0">
          <div class="w-9 h-9 rounded-full bg-[#2c6e33] text-white flex items-center justify-center font-bold text-sm shrink-0">
            {{ user.username.charAt(0).toUpperCase() }}
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-[0.85rem] font-bold text-white truncate">{{ user.username }}</span>
            <span class="text-[0.7rem] text-[#8ed694]">{{ user.isSuperAdmin ? 'SuperAdmin' : user.roleName }}</span>
          </div>
        </div>
        <button
          class="flex items-center gap-1.5 bg-red-500/15 border border-red-400/30 text-red-400 px-3 py-1.5 rounded-md cursor-pointer text-[0.82rem] font-semibold hover:bg-red-500 hover:text-white transition-colors shrink-0"
          @click="logout"
          title="Đăng xuất"
        >
          <i class="fa-solid fa-right-from-bracket"></i>
          <span v-if="!isSidebarCollapsed">Thoát</span>
        </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <div class="main-content flex flex-col min-h-screen" :class="{ 'sidebar-collapsed': isSidebarCollapsed }">
      <!-- Topbar -->
      <header class="h-16 bg-white border-b border-[#e2ece3] flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
        <div class="flex items-center gap-3">
          <button
            class="flex lg:hidden w-9 h-9 items-center justify-center rounded-lg bg-[#f0f7f1] text-[#2c6e33] cursor-pointer border-0 hover:bg-[#e1f0e2]"
            @click="toggleMobileMenu"
          >
            <i class="fa-solid fa-bars"></i>
          </button>
          <div class="flex items-center gap-2 text-[0.88rem] text-[#667768]">
            <span class="hidden sm:inline">Con Đường Hướng Thiện</span>
            <span class="hidden sm:inline">/</span>
            <span class="text-[#122815] font-bold">{{ route.name || 'Admin' }}</span>
          </div>
        </div>
        <!-- Topbar right: user chip with dropdown (desktop) -->
        <div class="flex items-center gap-2">
          <div v-if="user" class="relative group hidden sm:flex">
            <button class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#f0f7f1] hover:bg-[#e1f0e2] transition-colors cursor-pointer border-0">
              <div class="w-8 h-8 rounded-full bg-[#2c6e33] text-white text-sm font-bold flex items-center justify-center shrink-0">
                {{ user.username.charAt(0).toUpperCase() }}
              </div>
              <span class="text-[0.85rem] font-semibold text-[#122815] truncate max-w-[100px]">{{ user.username }}</span>
              <i class="fa-solid fa-caret-down text-[#2c6e33] text-xs"></i>
            </button>
            <!-- Dropdown panel -->
            <div class="absolute top-full right-0 mt-1 w-52 bg-white border border-[#e2ece3] rounded-lg shadow-lg z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150">
              <div class="px-4 py-3">
                <div class="text-[0.85rem] font-bold text-[#122815]">{{ user.username }}</div>
                <div class="text-[0.75rem] text-[#667768]">{{ user.isSuperAdmin ? 'SuperAdmin' : user.roleName }}</div>
              </div>
              <div class="border-t border-[#e2ece3]"></div>
              <div class="px-2 py-2 flex flex-col gap-1">
                <nuxt-link
                  to="/admin/profile"
                  class="flex items-center gap-2 px-3 py-2 rounded-md text-[0.85rem] text-[#122815] font-semibold no-underline hover:bg-[#f0f7f1] transition-colors"
                >
                  <i class="fa-solid fa-user-gear w-4 text-center" aria-hidden="true"></i>
                  <span>Tài khoản của tôi</span>
                </nuxt-link>
                <nuxt-link
                  to="/"
                  target="_blank"
                  class="flex items-center gap-2 px-3 py-2 rounded-md text-[0.85rem] text-[#2c6e33] font-semibold no-underline hover:bg-[#f0f7f1] transition-colors"
                >
                  <i class="fa-solid fa-globe w-4 text-center"></i>
                  <span>Xem Website ↗</span>
                </nuxt-link>
                <button
                  class="flex items-center gap-2 px-3 py-2 rounded-md text-[0.85rem] text-red-500 font-semibold hover:bg-red-50 transition-colors cursor-pointer border-0 w-full text-left"
                  @click="logout"
                >
                  <i class="fa-solid fa-right-from-bracket w-4 text-center"></i>
                  <span>Đăng xuất</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <!-- Page Content -->
      <main class="p-4 md:p-6 flex-1">
        <div class="mx-auto w-full max-w-[1920px]">
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
