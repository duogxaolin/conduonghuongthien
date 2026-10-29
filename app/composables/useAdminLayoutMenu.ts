import { computed, onMounted, ref, watch, type Ref } from 'vue'

// Relative paths and explicit `vue` imports, not `~/` or auto-imports: the layout's mount
// test (tests/admin-layout.test.ts) loads this file as is.
import { filterAdminMenuGroups, isAdminMenuGroupActive, type AdminMenuGroup } from '../utils/admin-layout-menu'
import type { AdminUser } from './useAdminAuth'

/**
 * The admin sidebar menu (`app/layouts/admin.vue`, split in wave3 D-SPLIT): which entries the
 * signed-in account sees, the quick search over them, and the "Hệ thống & Cài đặt" accordion
 * that opens itself when the route enters one of its pages. Moved verbatim from the layout;
 * the account (`user`, `hasPermission` of `useAdminAuth`) and the route are the layout's own,
 * handed in.
 *
 * Hiding an entry is navigation, not security: every page and endpoint behind it checks the
 * same permission on the server (`requireResourcePermission`).
 */
export interface AdminLayoutMenuDeps {
  route: { readonly path: string }
  user: Ref<AdminUser | null>
  hasPermission: (resource: string, action: 'create' | 'read' | 'update' | 'delete') => boolean
}

export function useAdminLayoutMenu({ route, user, hasPermission }: AdminLayoutMenuDeps) {
  // Accordion cho sidebar: nhóm "Hệ thống & Cài đặt" mở rộng mặc định để hiện
  // hết ~13 mục con (Tài khoản, Người dùng & Phân quyền, Cài đặt...), không thu gọn
  // gây tưởng thiếu mục. Bấm vào title để thu lại nếu muốn. Lưu trữ theo tiêu đề
  // nhóm (Set<string>) để không bị lệch khi lọc tìm kiếm.
  const openAccordions = ref<Set<string>>(new Set(['Hệ thống & Cài đặt']))
  const toggleAccordion = (title: string) => {
    const next = new Set(openAccordions.value)
    if (next.has(title)) next.delete(title)
    else next.add(title)
    openAccordions.value = next
  }

  // Tìm kiếm nhanh chức năng menu
  const searchQuery = ref('')
  const isSearching = computed(() => searchQuery.value.trim().length > 0)

  const menuGroups = computed<AdminMenuGroup[]>(() => [
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
            ...(hasPermission('settings', 'read') ? [{ label: 'Sitemap', icon: 'fa-solid fa-sitemap', path: '/admin/settings/sitemap' }] : []),
            ...(hasPermission('settings', 'read') ? [{ label: 'Đăng nhập Google', icon: 'fa-solid fa-right-to-bracket', path: '/admin/settings/google-oauth' }] : []),
            ...(hasPermission('readers', 'read') ? [{ label: 'Chặn địa chỉ IP', icon: 'fa-solid fa-ban', path: '/admin/settings/ip-bans' }] : []),
            // Chính sách bắt buộc MFA: endpoint chỉ nhận SuperAdmin, nên chỉ họ thấy mục này.
            ...(user.value?.isSuperAdmin ? [{ label: 'Bắt buộc xác thực hai bước', icon: 'fa-solid fa-shield-halved', path: '/admin/settings/security' }] : []),
            ...(hasPermission('settings', 'read') ? [{ label: 'Ngôn ngữ & Bản dịch', icon: 'fa-solid fa-language', path: '/admin/languages' }] : []),
            ...(hasPermission('settings', 'read') ? [{ label: 'Mạng xã hội', icon: 'fa-solid fa-share-nodes', path: '/admin/settings/social-links' }] : []),
            { label: 'Lưu trữ Media (R2)', icon: 'fa-solid fa-cloud-arrow-up', path: '/admin/settings/media-storage' },
            ...(hasPermission('settings', 'read') ? [{ label: 'Sao lưu & Khôi phục', icon: 'fa-solid fa-floppy-disk', path: '/admin/settings/backup' }] : []),
            ...(hasPermission('settings', 'read') ? [{ label: 'Tài liệu hệ thống', icon: 'fa-solid fa-circle-question', path: '/admin/docs' }] : []),
          ],
        },
      ],
    },
  ])

  function autoExpandActiveAccordions() {
    menuGroups.value.forEach((group) => {
      if (group.collapsible && isAdminMenuGroupActive(group, route.path)) {
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

  const filteredMenuGroups = computed(() => filterAdminMenuGroups(menuGroups.value, searchQuery.value))

  return { searchQuery, isSearching, filteredMenuGroups, openAccordions, toggleAccordion }
}
