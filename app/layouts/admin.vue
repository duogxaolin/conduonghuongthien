<script setup lang="ts">
import { errorMessage } from '~/utils/errorMessage'

const { user, logout, hasPermission } = useAdminAuth()
const route = useRoute()
const toast = useToast()

const isSidebarCollapsed = ref(false)
const isMobileMenuOpen = ref(false)

/**
 * Xoá cache SWR của trang công khai. Cán bộ sửa nội dung xong, khách vẫn thấy
 * bản cũ tới 60 giây (routeRules `swr: 60`) — đọc ra là "không update được".
 * Nút này là đường ra tường minh thay vì phải chờ hay tự đoán.
 */
const isClearingCache = ref(false)
async function clearPublicCache() {
  if (isClearingCache.value) return
  isClearingCache.value = true
  try {
    const res = await $fetch<{ ok: boolean; cleared: number; message: string }>('/api/admin/cache-clear', {
      method: 'POST',
      body: { confirm: true },
    })
    toast.success(res.message || `Đã xoá ${res.cleared} mục cache.`)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể xoá cache. Thử lại sau ít phút.'))
  } finally {
    isClearingCache.value = false
  }
}

const toggleSidebar = () => { isSidebarCollapsed.value = !isSidebarCollapsed.value }
const toggleMobileMenu = () => { isMobileMenuOpen.value = !isMobileMenuOpen.value }

watch(() => route.fullPath, () => { isMobileMenuOpen.value = false })

// Accordion cho sidebar: nhóm "Hệ thống & Cài đặt" tách thành sub-tab đóng mặc định,
// bấm vào title mới mở ra các item con — gọn sidebar khi không dùng.
// Lưu trữ theo tiêu đề nhóm (Set<string>) để không bị lệch khi lọc tìm kiếm.
const openAccordions = ref<Set<string>>(new Set())
const toggleAccordion = (title: string) => {
  const next = new Set(openAccordions.value)
  if (next.has(title)) next.delete(title)
  else next.add(title)
  openAccordions.value = next
}

// Tìm kiếm nhanh chức năng menu
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)

function focusSearch() {
  isSidebarCollapsed.value = false
  nextTick(() => {
    searchInputRef.value?.focus()
  })
}

function normalizeVi(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .trim()
}

const isSearching = computed(() => searchQuery.value.trim().length > 0)

const menuGroups = computed(() => [
  {
    title: 'Tổng quan',
    items: [
      { label: 'Dashboard', icon: 'fa-solid fa-chart-pie', path: '/admin' },
      ...(hasPermission('analytics', 'read') ? [{ label: 'Thống kê truy cập', icon: 'fa-solid fa-chart-line', path: '/admin/analytics' }] : []),
    ]
  },
  {
    title: 'Nội dung biên tập',
    items: [
      { label: 'Bài viết & Bản tin', icon: 'fa-solid fa-newspaper', path: '/admin/content/articles' },
      ...(hasPermission('pages', 'read') ? [{ label: 'Quản lý Trang', icon: 'fa-solid fa-file-lines', path: '/admin/content/pages' }] : []),
      { label: 'Thư viện Media', icon: 'fa-solid fa-images', path: '/admin/media' },
      { label: 'Danh mục', icon: 'fa-solid fa-folder-tree', path: '/admin/content/categories' },
      { label: 'Thể loại nội dung', icon: 'fa-solid fa-layer-group', path: '/admin/content/content-types' },
      { label: 'Menu chính (Navbar + ☰)', icon: 'fa-solid fa-bars-staggered', path: '/admin/content/navigation/navbar' },
      { label: 'Thanh nổi dưới (Mobile)', icon: 'fa-solid fa-mobile-screen', path: '/admin/content/navigation/mobile' },
    ]
  },
  {
    // Media Portal (video, table `media_items`) + Livestream — cùng nhóm tính
    // năng phát sóng/clip, tách khỏi "Nội dung biên tập" để người vận hành thấy
    // ngay đây là khu video/phát trực tiếp, khác với bài viết & trang.
    title: 'Media & Livestream',
    items: [
      ...(hasPermission('media_portal', 'read') ? [{ label: 'Thư viện Video', icon: 'fa-solid fa-video', path: '/admin/media-portal' }] : []),
      // Danh mục Media Portal — bảng `media_categories` riêng, tách khỏi danh mục
      // bài viết (bảng `categories`). Gate `media_portal.read` cùng Thư viện Video.
      ...(hasPermission('media_portal', 'read') ? [{ label: 'Danh mục Video', icon: 'fa-solid fa-folder-tree', path: '/admin/media-portal/categories' }] : []),
      // Livestream — bắt đầu/dừng buổi phát, kiểm duyệt chat.
      ...(hasPermission('livestream', 'read') ? [{ label: 'Livestream', icon: 'fa-solid fa-tower-broadcast', path: '/admin/livestream' }] : []),
      // Cài đặt Media Portal — nhận video, dung lượng, chuyển mã, R2. Nằm trong
      // nhóm Media (không phải "Hệ thống & Cài đặt") vì nó là config riêng của
      // Media Portal, không phải config chung của cổng.
      ...(hasPermission('settings', 'read') ? [{ label: 'Cài đặt Media Portal', icon: 'fa-solid fa-sliders', path: '/admin/settings/media-portal' }] : []),
    ]
  },
  {
    // Ba mục cùng hệ thống Chatbot: kho nội dung (chatbot_knowledge) + phiên
    // trò chuyện + cài đặt (chatbot_settings). Trước đây "Cài đặt Chatbot" bị
    // tách sang nhóm "Yêu cầu & Cài đặt", đứt gãy khỏi hai mục còn lại.
    title: 'Trợ lý Chatbot',
    items: [
      ...(hasPermission('chatbot_knowledge', 'read') ? [{ label: 'Kho nội dung Chatbot', icon: 'fa-solid fa-book-open', path: '/admin/chatbot/knowledge' }] : []),
      // Same gate as the knowledge bank: whoever may read the approved answers
      // may read the questions visitors asked of them.
      ...(hasPermission('chatbot_knowledge', 'read') ? [{ label: 'Phiên trò chuyện', icon: 'fa-solid fa-comments', path: '/admin/chatbot/sessions' }] : []),
      ...(hasPermission('chatbot_settings', 'read') ? [{ label: 'Cài đặt Chatbot', icon: 'fa-solid fa-robot', path: '/admin/chatbot/settings' }] : []),
    ]
  },
  {
    // Dữ liệu công dân (CLAUDE.md D13): đơn đăng ký + người đọc + bình luận.
    // `readers`/`comments` cố ý KHÔNG gộp vào quyền bài viết — cán bộ được viết
    // tin không vì thế mà được đọc email & lịch sử phát ngôn của công dân.
    title: 'Tương tác công dân',
    items: [
      { label: 'Đơn đăng ký hỗ trợ', icon: 'fa-solid fa-envelope-open-text', path: '/admin/submissions' },
      ...(hasPermission('readers', 'read') ? [{ label: 'Người đọc & bình luận', icon: 'fa-solid fa-user-group', path: '/admin/readers' }] : []),
      // Bình luận công khai. Gác bằng resource `comments` chứ không phải quyền
      // bài viết: cán bộ được viết tin không vì thế mà được đọc email và lịch sử
      // phát ngôn của công dân — đó là loại dữ liệu khác.
      ...(hasPermission('comments', 'read') ? [{ label: 'Kiểm duyệt bình luận', icon: 'fa-solid fa-comment-dots', path: '/admin/comments' }] : []),
    ]
  },
  {
    title: 'AI & Tự động hóa',
    items: [
      ...(hasPermission('ai', 'read') ? [{ label: 'AI Panel', icon: 'fa-solid fa-microchip', path: '/admin/ai' }] : []),
      ...(hasPermission('ai', 'read') ? [{ label: 'Kiểm duyệt An ninh', icon: 'fa-solid fa-shield-halved', path: '/admin/ai/moderation' }] : []),
    ]
  },
  {
    title: 'Hệ thống & Cài đặt',
    collapsible: true,
    subGroups: [
      {
        title: 'Tài khoản',
        items: [
          // Không gắn hasPermission: đây là tài khoản của chính người đang đăng nhập,
          // ai cũng phải đổi được mật khẩu và xem được lịch sử truy cập của mình.
          { label: 'Tài khoản của tôi', icon: 'fa-solid fa-user-gear', path: '/admin/profile' },
        ],
      },
      {
        title: 'Người dùng & Phân quyền',
        items: [
          { label: 'Người dùng', icon: 'fa-solid fa-users', path: '/admin/users' },
          { label: 'Vai trò & Phân quyền', icon: 'fa-solid fa-user-shield', path: '/admin/users/roles' },
          // Lịch sử của MỌI tài khoản — khác 'Tài khoản của tôi' (chỉ của chính mình),
          // nên phải có quyền đọc 'users' mới thấy mục này.
          ...(hasPermission('users', 'read') ? [{ label: 'Lịch sử hoạt động', icon: 'fa-solid fa-clock-rotate-left', path: '/admin/users/activity' }] : []),
        ],
      },
      {
        title: 'Cài đặt',
        items: [
          { label: 'Cài đặt chung', icon: 'fa-solid fa-gear', path: '/admin/settings/general' },
          ...(hasPermission('settings', 'read') ? [{ label: 'Cấu hình Email (SMTP)', icon: 'fa-solid fa-envelope', path: '/admin/settings/email' }] : []),
          ...(hasPermission('settings', 'read') ? [{ label: 'Tracking & Marketing', icon: 'fa-solid fa-chart-simple', path: '/admin/settings/tracking' }] : []),
          ...(hasPermission('settings', 'read') ? [{ label: 'Tự động dọn dữ liệu', icon: 'fa-solid fa-broom', path: '/admin/settings/data-retention' }] : []),
          ...(hasPermission('settings', 'read') ? [{ label: 'Đăng nhập Google', icon: 'fa-solid fa-right-to-bracket', path: '/admin/settings/google-oauth' }] : []),
          ...(hasPermission('readers', 'read') ? [{ label: 'Chặn địa chỉ IP', icon: 'fa-solid fa-ban', path: '/admin/settings/ip-bans' }] : []),
          ...(hasPermission('settings', 'read') ? [{ label: 'Ngôn ngữ & Bản dịch', icon: 'fa-solid fa-language', path: '/admin/languages' }] : []),
          { label: 'Lưu trữ Media (R2)', icon: 'fa-solid fa-cloud-arrow-up', path: '/admin/settings/media-storage' },
          ...(hasPermission('settings', 'read') ? [{ label: 'Sao lưu & Khôi phục', icon: 'fa-solid fa-floppy-disk', path: '/admin/settings/backup' }] : []),
        ],
      },
    ],
  },
])

const countSubGroupItems = (group: any) => {
  if (!group.subGroups) return 0
  return group.subGroups.reduce((acc: number, sub: any) => acc + (sub.items?.length || 0), 0)
}

function isGroupActive(group: any): boolean {
  if (group.items) {
    return group.items.some((i: any) => {
      if (i.path === '/admin') return route.path === '/admin'
      return route.path === i.path || route.path.startsWith(i.path + '/')
    })
  }
  if (group.subGroups) {
    return group.subGroups.some((sub: any) => {
      return sub.items.some((i: any) => {
        if (i.path === '/admin') return route.path === '/admin'
        return route.path === i.path || route.path.startsWith(i.path + '/')
      })
    })
  }
  return false
}

function autoExpandActiveAccordions() {
  menuGroups.value.forEach((group) => {
    if (group.collapsible && isGroupActive(group)) {
      openAccordions.value.add(group.title)
    }
  })
}

onMounted(() => {
  autoExpandActiveAccordions()
})

watch(() => route.path, () => {
  autoExpandActiveAccordions()
})

const filteredMenuGroups = computed(() => {
  const query = normalizeVi(searchQuery.value)
  if (!query) return menuGroups.value

  const result: any[] = []

  for (const group of menuGroups.value) {
    if (group.collapsible && group.subGroups) {
      const matchedSubGroups = group.subGroups
        .map(sub => ({
          ...sub,
          items: sub.items.filter(item => normalizeVi(item.label).includes(query)),
        }))
        .filter(sub => sub.items.length > 0)

      if (matchedSubGroups.length > 0) {
        result.push({
          ...group,
          subGroups: matchedSubGroups,
        })
      }
    } else if (group.items) {
      const matchedItems = group.items.filter(item => normalizeVi(item.label).includes(query))
      if (matchedItems.length > 0) {
        result.push({
          ...group,
          items: matchedItems,
        })
      }
    }
  }

  return result
})
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
      class="sidebar fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-[#0d1f11] text-[#e2ede3] border-r border-white/[0.08] shadow-[4px_0_24px_rgba(0,0,0,0.25)] overflow-hidden select-none"
      :class="{ 'is-open': isMobileMenuOpen, 'collapsed': isSidebarCollapsed }"
    >
      <!-- Sidebar Header -->
      <div class="h-16 flex items-center justify-between px-3.5 border-b border-white/10 shrink-0 bg-black/10">
        <!-- Brand / Logo (Expanded) -->
        <div v-if="!isSidebarCollapsed" class="flex items-center gap-3 overflow-hidden min-w-0">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2c6e33] to-[#1a441e] border border-[#8ed694]/30 shadow-[0_2px_10px_rgba(44,110,51,0.3)] flex items-center justify-center text-[#8ed694] shrink-0">
            <i class="fa-solid fa-leaf text-base"></i>
          </div>
          <div class="flex flex-col min-w-0">
            <span class="font-black text-[0.92rem] tracking-wide text-white truncate leading-tight">HƯỚNG THIỆN</span>
            <span class="text-[0.62rem] font-semibold text-[#8ed694] tracking-wider uppercase opacity-90 truncate mt-0.5">Cục C11 • Quản Trị</span>
          </div>
        </div>

        <!-- Brand / Logo (Collapsed) -->
        <div v-else class="w-9 h-9 mx-auto rounded-xl bg-gradient-to-br from-[#2c6e33] to-[#1a441e] border border-[#8ed694]/30 shadow-[0_2px_10px_rgba(44,110,51,0.3)] flex items-center justify-center text-[#8ed694] shrink-0 cursor-pointer" @click="toggleSidebar" title="Mở rộng menu">
          <i class="fa-solid fa-leaf text-base"></i>
        </div>

        <!-- Toggle Button for Desktop (Expanded) -->
        <button
          v-if="!isSidebarCollapsed"
          type="button"
          class="hidden lg:flex w-7 h-7 items-center justify-center rounded-lg bg-white/[0.07] hover:bg-white/[0.14] text-[#8ed694] hover:text-white transition-all cursor-pointer border-0 shrink-0"
          @click="toggleSidebar"
          title="Thu gọn sidebar"
        >
          <i class="fa-solid fa-chevron-left text-[11px]"></i>
        </button>

        <!-- Close Button for Mobile -->
        <button
          type="button"
          class="flex lg:hidden w-8 h-8 items-center justify-center rounded-lg bg-white/[0.07] hover:bg-white/[0.14] text-[#8ed694] hover:text-white transition-all cursor-pointer border-0 shrink-0"
          @click="isMobileMenuOpen = false"
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
            class="w-full bg-white/[0.05] hover:bg-white/[0.08] focus:bg-white/[0.12] border border-white/10 focus:border-[#8ed694]/50 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-white/35 focus:outline-none transition-all duration-150"
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
          class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] text-[0.74rem] text-white/70 hover:text-[#8ed694] no-underline font-medium transition-colors border border-white/[0.06] group/portal"
          title="Mở cổng thông tin công cộng trong tab mới"
        >
          <span class="flex items-center gap-2">
            <i class="fa-solid fa-globe text-[11px] text-[#8ed694] group-hover/portal:scale-110 transition-transform"></i>
            <span>Xem Website công khai</span>
          </span>
          <i class="fa-solid fa-arrow-up-right-from-square text-[9px] text-white/40 group-hover/portal:text-[#8ed694]"></i>
        </nuxt-link>
      </div>

      <!-- Quick Actions for Collapsed Mode -->
      <div v-else class="px-2 pt-3 pb-1 flex flex-col items-center gap-2 shrink-0">
        <button
          type="button"
          @click="focusSearch"
          class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.05] hover:bg-white/[0.12] text-white/60 hover:text-[#8ed694] transition-colors border-0 cursor-pointer"
          title="Tìm kiếm chức năng (Mở rộng)"
        >
          <i class="fa-solid fa-magnifying-glass text-xs"></i>
        </button>
        <nuxt-link
          to="/"
          target="_blank"
          class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.03] hover:bg-white/[0.12] text-white/60 hover:text-[#8ed694] transition-colors border border-white/[0.06] no-underline"
          title="Xem Website công khai ↗"
        >
          <i class="fa-solid fa-globe text-xs"></i>
        </nuxt-link>
      </div>

      <!-- Nav Items -->
      <nav class="flex-1 overflow-y-auto px-2.5 py-2 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.15)_transparent]">
        <!-- Search Empty State -->
        <div v-if="isSearching && filteredMenuGroups.length === 0" class="py-8 px-3 text-center flex flex-col items-center gap-2 text-white/50">
          <i class="fa-solid fa-magnifying-glass text-xl text-white/20"></i>
          <p class="text-xs m-0">Không tìm thấy chức năng</p>
          <p class="text-[0.7rem] text-white/40 m-0 font-medium">"{{ searchQuery }}"</p>
          <button
            type="button"
            @click="searchQuery = ''"
            class="mt-2 px-3 py-1 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-[#8ed694] text-xs border-0 cursor-pointer transition-colors"
          >
            Xoá bộ lọc
          </button>
        </div>

        <div v-for="group in filteredMenuGroups" :key="group.title" class="mb-4">
          <!-- Collapsible Accordion Group (Hệ thống & Cài đặt) -->
          <template v-if="group.collapsible && group.subGroups">
            <button
              v-if="!isSidebarCollapsed"
              type="button"
              class="w-full flex items-center justify-between gap-2 text-[0.68rem] uppercase tracking-[0.9px] text-[#8ed694]/75 font-bold px-3 py-2 rounded-lg hover:bg-white/[0.06] hover:text-[#8ed694] transition-colors bg-transparent border-0 cursor-pointer select-none"
              :aria-expanded="openAccordions.has(group.title) || isSearching"
              @click="toggleAccordion(group.title)"
            >
              <span class="flex items-center gap-2">
                <i class="fa-solid fa-sliders text-xs text-[#8ed694]"></i>
                <span>{{ group.title }}</span>
              </span>
              <div class="flex items-center gap-1.5">
                <span class="text-[0.62rem] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60 font-semibold">
                  {{ countSubGroupItems(group) }}
                </span>
                <i
                  class="fa-solid fa-chevron-right text-[0.6rem] transition-transform duration-200 text-white/40"
                  :class="{ 'rotate-90 !text-[#8ed694]': openAccordions.has(group.title) || isSearching }"
                ></i>
              </div>
            </button>
            <div v-show="isSidebarCollapsed || openAccordions.has(group.title) || isSearching">
              <div class="mt-1 space-y-2.5" :class="{ 'pl-2 border-l border-white/10 ml-3.5': !isSidebarCollapsed }">
                <div v-for="(sub, sIdx) in group.subGroups" :key="sIdx">
                  <div
                    v-if="!isSidebarCollapsed"
                    class="text-[0.64rem] uppercase tracking-[0.6px] text-white/40 font-semibold px-2.5 pt-1 pb-1"
                  >
                    {{ sub.title }}
                  </div>
                  <ul class="list-none p-0 m-0 flex flex-col gap-0.5">
                    <li v-for="item in sub.items" :key="item.path">
                      <nuxt-link
                        :to="item.path"
                        class="relative flex items-center gap-2.5 rounded-lg font-medium transition-all duration-150 no-underline group"
                        :class="[
                          isSidebarCollapsed
                            ? 'w-10 h-10 mx-auto justify-center text-white/70 hover:text-white hover:bg-white/[0.08]'
                            : 'px-2.5 py-1.5 text-white/70 hover:text-white hover:bg-white/[0.07] text-[0.82rem]'
                        ]"
                        active-class="!bg-gradient-to-r !from-[#2c6e33] !to-[#1f5225] !text-white !font-semibold shadow-[0_2px_8px_rgba(44,110,51,0.35)] border border-[#8ed694]/30 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-[#8ed694] before:rounded-r-full"
                        :title="item.label"
                      >
                        <i :class="item.icon" class="text-[0.92rem] shrink-0 w-4 text-center text-[#8ed694]/70 group-hover:text-[#8ed694] group-[.router-link-active]:text-white transition-colors"></i>
                        <span v-if="!isSidebarCollapsed" class="truncate flex-1">{{ item.label }}</span>
                      </nuxt-link>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </template>

          <!-- Regular Flat Group -->
          <template v-else>
            <div
              v-if="!isSidebarCollapsed"
              class="text-[0.66rem] uppercase tracking-[0.9px] text-[#8ed694]/70 font-bold px-3 pt-2 pb-1 select-none"
            >
              {{ group.title }}
            </div>
            <div v-else class="border-t border-white/[0.08] my-2 mx-3"></div>
            <ul class="list-none p-0 m-0 flex flex-col gap-0.5">
              <li v-for="item in group.items" :key="item.path">
                <nuxt-link
                  :to="item.path"
                  :exact="item.path === '/admin'"
                  class="relative flex items-center rounded-lg font-medium transition-all duration-150 no-underline group"
                  :class="[
                    isSidebarCollapsed
                      ? 'w-10 h-10 mx-auto justify-center text-white/70 hover:text-white hover:bg-white/[0.08]'
                      : 'gap-3 px-3 py-2 text-white/70 hover:text-white hover:bg-white/[0.07] text-[0.84rem]'
                  ]"
                  :active-class="item.path === '/admin' ? '' : '!bg-gradient-to-r !from-[#2c6e33] !to-[#1f5225] !text-white !font-semibold shadow-[0_3px_12px_rgba(44,110,51,0.35)] border border-[#8ed694]/30 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:bg-[#8ed694] before:rounded-r-full'"
                  :exact-active-class="'!bg-gradient-to-r !from-[#2c6e33] !to-[#1f5225] !text-white !font-semibold shadow-[0_3px_12px_rgba(44,110,51,0.35)] border border-[#8ed694]/30 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:bg-[#8ed694] before:rounded-r-full'"
                  :title="item.label"
                >
                  <i :class="item.icon" class="text-[0.98rem] shrink-0 w-5 text-center text-[#8ed694]/75 group-hover:text-[#8ed694] group-[.router-link-active]:text-white transition-colors"></i>
                  <span v-if="!isSidebarCollapsed" class="truncate flex-1">{{ item.label }}</span>
                </nuxt-link>
              </li>
            </ul>
          </template>
        </div>
      </nav>

      <!-- Sidebar Footer / User Profile Card -->
      <div v-if="user" class="p-2.5 border-t border-white/10 shrink-0 bg-black/20">
        <!-- Expanded User Card -->
        <div v-if="!isSidebarCollapsed" class="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-white/15 transition-all">
          <nuxt-link
            to="/admin/profile"
            class="flex items-center gap-2.5 min-w-0 flex-1 no-underline text-inherit group/user"
            title="Trang tài khoản của tôi"
          >
            <div class="relative shrink-0">
              <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#2c6e33] to-[#3a8b43] text-white flex items-center justify-center font-bold text-sm shadow-sm border border-[#8ed694]/30">
                {{ user.username.charAt(0).toUpperCase() }}
              </div>
              <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#4caf50] rounded-full border-2 border-[#0d1f11]" title="Đang trực tuyến"></span>
            </div>
            <div class="flex flex-col min-w-0">
              <span class="text-[0.82rem] font-bold text-white truncate group-hover/user:text-[#8ed694] transition-colors leading-tight">
                {{ user.username }}
              </span>
              <span class="text-[0.66rem] text-[#8ed694] font-medium truncate mt-0.5">
                {{ user.isSuperAdmin ? 'SuperAdmin' : user.roleName }}
              </span>
            </div>
          </nuxt-link>

          <button
            type="button"
            class="flex items-center gap-1.5 bg-red-500/15 border border-red-400/30 text-red-300 hover:text-white hover:bg-red-500 hover:border-transparent px-2.5 py-1.5 rounded-lg cursor-pointer text-[0.78rem] font-semibold transition-all shrink-0"
            @click="logout"
            title="Đăng xuất khỏi hệ thống"
          >
            <i class="fa-solid fa-right-from-bracket text-xs"></i>
            <span>Thoát</span>
          </button>
        </div>

        <!-- Collapsed User Card -->
        <div v-else class="flex flex-col items-center gap-2">
          <nuxt-link
            to="/admin/profile"
            class="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#2c6e33] to-[#3a8b43] text-white flex items-center justify-center font-bold text-sm shadow-sm border border-[#8ed694]/30 no-underline"
            :title="`${user.username} (${user.isSuperAdmin ? 'SuperAdmin' : user.roleName}) - Tài khoản`"
          >
            {{ user.username.charAt(0).toUpperCase() }}
          </nuxt-link>
          <button
            type="button"
            class="w-8 h-8 rounded-lg flex items-center justify-center text-red-300 hover:text-white bg-red-500/15 hover:bg-red-500 border border-red-500/20 hover:border-transparent transition-all cursor-pointer"
            @click="logout"
            title="Đăng xuất"
          >
            <i class="fa-solid fa-right-from-bracket text-xs"></i>
          </button>
        </div>
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
        <!-- Topbar right: clear-cache button + user chip with dropdown (desktop) -->
        <div class="flex items-center gap-2">
          <!-- Nút xoá cache SWR: sửa nội dung xong là khách thấy ngay, không chờ 60s -->
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#f0f7f1] hover:bg-[#e1f0e2] transition-colors cursor-pointer border-0 text-[#2c6e33]"
            :disabled="isClearingCache"
            :class="{ 'opacity-60 cursor-wait': isClearingCache }"
            :title="isClearingCache ? 'Đang xoá cache…' : 'Xoá cache trang công khai — nội dung vừa sửa hiện ngay, không chờ 60 giây'"
            @click="clearPublicCache"
          >
            <i class="fa-solid" :class="isClearingCache ? 'fa-spinner fa-spin' : 'fa-broom'"></i>
            <span class="hidden md:inline text-[0.82rem] font-semibold">{{ isClearingCache ? 'Đang xoá…' : 'Xoá cache' }}</span>
          </button>
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
                  class="flex items-center gap-2 px-3 py-2 rounded-md text-[0.85rem] text-[#2c6e33] font-semibold hover:bg-[#f0f7f1] transition-colors cursor-pointer border-0 w-full text-left"
                  :disabled="isClearingCache"
                  @click="clearPublicCache"
                >
                  <i class="fa-solid fa-broom w-4 text-center" :class="{ 'fa-spinner fa-spin': isClearingCache }"></i>
                  <span>{{ isClearingCache ? 'Đang xoá cache…' : 'Xoá cache Website' }}</span>
                </button>
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
