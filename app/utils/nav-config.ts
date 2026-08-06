/**
 * Hai bảng điều hướng mặc định của trang công khai, và bộ đọc cấu hình đã lưu.
 *
 * Rút khỏi `app/layouts/default.vue` (866 dòng) vì `parseNavConfig` là **biên
 * tin cậy chưa có test nào**: nó đọc chuỗi JSON từ cột `settings`, do quản trị
 * viên nhập ở `/admin/content/navigation/*`, rồi kết quả đi thẳng vào `v-for`
 * dựng thanh điều hướng của **mọi trang công khai**. Nằm trong `<script setup>`
 * thì không nơi nào import được.
 *
 * Bản cũ chỉ có `try { JSON.parse(raw) } catch { return null }` — bắt được JSON
 * hỏng cú pháp, **không** bắt được JSON hợp lệ mang hình dạng sai. Một `{}` hay
 * một `[{}]` đi qua trót lọt, rồi `item.url` là `undefined` và `<NuxtLink :to>`
 * nhận `undefined`: thanh điều hướng **biến mất hoặc dựng liên kết chết trên
 * toàn cổng**, do một ô cấu hình lưu thành công mà không có gì báo. Đó là lý do
 * `null` (→ lùi về bảng mặc định) phải là kết quả cho **mọi** dữ liệu không dùng
 * được, không chỉ cho chuỗi không phân tích được.
 *
 * Bảng mặc định ở đây, không ở component, vì chúng chính là thứ `null` lùi về —
 * kiểm bộ đọc mà không có bảng mặc định trong tay thì không kiểm được nhánh
 * quan trọng nhất.
 */

/** Một mục điều hướng ngang (thanh nav trên đầu). */
export interface NavItem {
  id: string
  label: string | null
  labelKey?: string
  url: string
  children?: NavItem[]
}

/** Một mục thanh tab dưới cùng trên điện thoại. Hình dạng khác `NavItem`. */
export interface BottomNavItem {
  id: string
  label: string | null
  labelKey?: string
  icon: string
  type: 'link' | 'chatbot' | 'drawer'
  url: string
  featured: boolean
}

export const DEFAULT_NAV: NavItem[] = [
  { id: 'home', label: null, labelKey: 'home', url: '/', children: [] },
  { id: 'about', label: null, labelKey: 'about', url: '/about', children: [] },
  {
    id: 'news', label: null, labelKey: 'news', url: '/news',
    children: [
      { id: 'news-featured', label: null, labelKey: 'news_featured', url: '/news/featured-news' },
      { id: 'news-activity', label: null, labelKey: 'news_activities', url: '/news/activity-news' },
      { id: 'news-local', label: null, labelKey: 'news_local', url: '/news/local-news' },
    ],
  },
  { id: 'role-models', label: null, labelKey: 'role_models', url: '/role-models', children: [] },
  { id: 'reintegration', label: null, labelKey: 'reintegration', url: '/reintegration-models', children: [] },
  { id: 'documents', label: null, labelKey: 'documents', url: '/documents', children: [] },
  // Hỏi – Đáp mở ra hai nguồn khác nhau, nên nó là dropdown chứ không phải một
  // liên kết: `/legal-qa` là bài biên tập (`articles` type=faq), còn
  // `/qa-documents` là kho câu trả lời đã duyệt mà chính trợ lý ảo dẫn lại.
  // Thêm mục thứ 9 ngang hàng sẽ làm tràn thanh nav ở md.
  {
    id: 'legal-qa', label: null, labelKey: 'faq', url: '/legal-qa',
    children: [
      { id: 'legal-qa-articles', label: null, labelKey: 'faq_articles', url: '/legal-qa' },
      { id: 'qa-approved-docs', label: null, labelKey: 'faq_approved_docs', url: '/qa-documents' },
    ],
  },
  { id: 'contact', label: null, labelKey: 'contact', url: '/contact', children: [] },
]

// Mobile bottom navigation bar (floating tab bar). Different shape from navMenu:
// each item has an icon + a type ('link' | 'chatbot' | 'drawer') + featured flag.
export const DEFAULT_BOTTOM_NAV: BottomNavItem[] = [
  { id: 'home', label: null, labelKey: 'home', icon: 'fa-solid fa-house', type: 'link', url: '/', featured: false },
  { id: 'news', label: null, labelKey: 'news', icon: 'fa-solid fa-newspaper', type: 'link', url: '/news', featured: false },
  { id: 'chatbot', label: null, labelKey: 'ask_ai', icon: 'fa-solid fa-comment-dots', type: 'chatbot', url: '', featured: true },
  { id: 'documents', label: null, labelKey: 'documents', icon: 'fa-solid fa-file-lines', type: 'link', url: '/documents', featured: false },
  { id: 'drawer', label: null, labelKey: 'categories', icon: 'fa-solid fa-bars', type: 'drawer', url: '', featured: false },
]

const BOTTOM_NAV_TYPES = new Set(['link', 'chatbot', 'drawer'])

function usableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Một mục nav ngang dùng được, hoặc `null`.
 *
 * `id` và `url` là **bắt buộc**: `id` là `:key` của `v-for` (thiếu thì Vue dùng
 * chỉ số và vẽ lại sai khi danh sách đổi), `url` là `:to` của `NuxtLink` (thiếu
 * thì thành một liên kết không dẫn tới đâu). `label` được phép `null` — đó là
 * cách khai "dùng `labelKey` để dịch", chứ không phải dữ liệu thiếu.
 */
function normalizeNavItem(raw: unknown, depth = 0): NavItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as Record<string, unknown>
  const id = usableText(item.id)
  const url = usableText(item.url)
  if (!id || !url) return null

  const node: NavItem = {
    id,
    label: usableText(item.label),
    url,
  }
  const labelKey = usableText(item.labelKey)
  if (labelKey) node.labelKey = labelKey

  // Đúng MỘT cấp con. Thanh nav chỉ vẽ được một tầng dropdown, nên một cây sâu
  // hơn không phải cấu hình phong phú mà là những mục **không bao giờ hiện ra** —
  // cán bộ lưu xong rồi đi tìm vì sao chúng biến mất.
  if (depth === 0 && Array.isArray(item.children)) {
    node.children = item.children
      .map(child => normalizeNavItem(child, depth + 1))
      .filter((value): value is NavItem => value !== null)
  } else {
    node.children = []
  }
  return node
}

/**
 * Một mục thanh tab dưới dùng được, hoặc `null`.
 *
 * `type` phải nằm trong danh sách đã biết: template phân nhánh theo nó, nên một
 * giá trị lạ cho ra một tab **bấm không có tác dụng gì**. `url` chỉ bắt buộc với
 * `type: 'link'` — `chatbot` và `drawer` cố ý để rỗng vì chúng không điều hướng.
 */
function normalizeBottomNavItem(raw: unknown): BottomNavItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as Record<string, unknown>
  const id = usableText(item.id)
  const type = usableText(item.type)
  if (!id || !type || !BOTTOM_NAV_TYPES.has(type)) return null

  const url = usableText(item.url) ?? ''
  if (type === 'link' && !url) return null

  const node: BottomNavItem = {
    id,
    label: usableText(item.label),
    icon: usableText(item.icon) ?? 'fa-solid fa-circle',
    type: type as BottomNavItem['type'],
    url,
    featured: item.featured === true,
  }
  const labelKey = usableText(item.labelKey)
  if (labelKey) node.labelKey = labelKey
  return node
}

/**
 * Đọc cấu hình nav đã lưu, hoặc `null` để nơi gọi lùi về bảng mặc định.
 *
 * Trả `null` — **không** trả mảng rỗng — khi không còn mục nào dùng được: một
 * mảng rỗng làm thanh điều hướng biến mất trên toàn cổng, còn `null` lùi về bảng
 * mặc định. Một cấu hình sai nên làm cổng trông như chưa cấu hình, chứ không nên
 * làm cổng trông như bị hỏng.
 */
export function parseNavConfig(raw: unknown): NavItem[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const items = parsed
    .map(item => normalizeNavItem(item))
    .filter((value): value is NavItem => value !== null)
  return items.length ? items : null
}

export function parseBottomNavConfig(raw: unknown): BottomNavItem[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const items = parsed
    .map(item => normalizeBottomNavItem(item))
    .filter((value): value is BottomNavItem => value !== null)
  return items.length ? items : null
}
