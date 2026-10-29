/**
 * Pure pieces of the admin sidebar (`app/layouts/admin.vue`, split in wave3 D-SPLIT): the
 * menu's shape, the quick-search filter, "is the route inside this group", the accordion's
 * count and the top-bar page title. No state, no Nuxt runtime — which entries an account
 * sees is `useAdminLayoutMenu` (app/composables/useAdminLayoutMenu.ts).
 *
 * Moved from the layout with the same bodies; what reached for the route or the menu ref now
 * takes it as a parameter (`routePath`, `menuGroups`, `searchQuery`, `routeName`).
 * tests/admin-layout.test.ts mounts the layout over them.
 */

/** Một mục menu admin — label + icon + path. */
export interface AdminMenuItem {
  label: string
  icon: string
  path: string
}

/** Group menu admin — hoặc có `items` trực tiếp, hoặc `collapsible` + `subGroups`. */
export interface AdminMenuGroup {
  title: string
  collapsible?: true
  items?: AdminMenuItem[]
  subGroups?: { title: string; items: AdminMenuItem[] }[]
}

export function normalizeVi(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .trim()
}

export const countSubGroupItems = (group: AdminMenuGroup) => {
  if (!group.subGroups) return 0
  return group.subGroups.reduce((acc: number, sub) => acc + (sub.items?.length || 0), 0)
}

/** The route is on one of the group's pages, or below one (`/admin` itself only exactly). */
export function isAdminMenuGroupActive(group: AdminMenuGroup, routePath: string): boolean {
  if (group.items) {
    return group.items.some((i) => {
      if (i.path === '/admin') return routePath === '/admin'
      return routePath === i.path || routePath.startsWith(i.path + '/')
    })
  }
  if (group.subGroups) {
    return group.subGroups.some((sub) => {
      return sub.items.some((i) => {
        if (i.path === '/admin') return routePath === '/admin'
        return routePath === i.path || routePath.startsWith(i.path + '/')
      })
    })
  }
  return false
}

/** The groups whose entries match the quick search (diacritics and `đ` ignored); all of them for a blank query. */
export function filterAdminMenuGroups(menuGroups: AdminMenuGroup[], searchQuery: string): AdminMenuGroup[] {
  const query = normalizeVi(searchQuery)
  if (!query) return menuGroups

  const result: AdminMenuGroup[] = []

  for (const group of menuGroups) {
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
}

const ADMIN_PAGE_TITLES: Record<string, string> = {
  admin: 'Dashboard',
  'admin-analytics': 'Thống kê truy cập',
  'admin-content-articles': 'Bài viết & Tin tức',
  'admin-content-articles-new': 'Viết bài mới',
  'admin-content-articles-id': 'Chỉnh sửa bài viết',
  'admin-content-pages': 'Quản lý Trang',
  'admin-content-categories': 'Danh mục bài viết',
  'admin-content-content-types': 'Thể loại nội dung',
  'admin-content-navigation-navbar': 'Menu chính',
  'admin-content-navigation-mobile': 'Thanh nổi Mobile',
  'admin-media': 'Thư viện Media',
  'admin-media-portal': 'Thư viện Video',
  'admin-media-portal-categories': 'Danh mục Video',
  'admin-livestream': 'Quản lý Livestream',
  'admin-chatbot-knowledge': 'Kho nội dung Chatbot',
  'admin-chatbot-sessions': 'Phiên trò chuyện Chatbot',
  'admin-chatbot-settings': 'Cài đặt Chatbot',
  'admin-readers': 'Quản lý Người đọc',
  'admin-comments': 'Kiểm duyệt Bình luận',
  'admin-submissions': 'Đơn đăng ký hỗ trợ',
  'admin-users': 'Tài khoản & Phân quyền',
  'admin-users-roles': 'Quản lý Vai trò',
  'admin-users-activity': 'Nhật ký hoạt động',
  'admin-settings-general': 'Cài đặt chung',
  'admin-settings-social-links': 'Mạng xã hội & Bố cục',
  'admin-settings-data-retention': 'Lưu trữ dữ liệu',
  'admin-settings-backup': 'Sao lưu & Phục hồi',
  'admin-settings-security': 'Bắt buộc xác thực hai bước',
  'admin-profile': 'Tài khoản của tôi',
  'admin-ai': 'Kiểm duyệt an ninh AI',
}

/** The top bar's name for the page: a known route name, else the name made readable, else "Admin". */
export function adminPageTitle(routeName: unknown): string {
  const name = String(routeName || '')
  return ADMIN_PAGE_TITLES[name] || name.replace(/^admin-?/, '').replace(/-/g, ' ') || 'Admin'
}
