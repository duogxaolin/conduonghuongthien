// ─── Block Registry ──────────────────────────────────────────────────────────
// Single source of truth for the page builder. Keyed by blockType. Consumed by:
//   (a) the admin builder (palette grouping + edit-drawer field generation),
//   (b) server-side validation (isValidBlockType),
//   (c) seeding / freshly-added blocks (getDefaultData),
//   (d) the public PageRenderer (blockType → renderer component mapping lives there).
// Section blocks reproduce the existing homepage sections (design preserved);
// content blocks are new, for about/contact/custom pages.

export type EditorFieldType =
  | 'text' | 'textarea' | 'richtext' | 'number' | 'select' | 'image' | 'toggle' | 'url'

export interface EditorField {
  key: string
  label: string
  type: EditorFieldType
  options?: Array<{ value: string; label: string }>
  help?: string
  placeholder?: string
}

export interface BlockDefinition {
  label: string
  icon: string
  category: 'section' | 'content'
  defaultData: Record<string, any>
  fields: EditorField[]
  /** true for blocks that fetch articles at render time (news, role_models, …) */
  dataDriven?: boolean
}

const BG_VARIANT_OPTIONS = [
  { value: 'white', label: 'Trắng' },
  { value: 'light', label: 'Xám nhạt' },
  { value: 'green', label: 'Xanh lá đậm' },
]

export const BLOCK_REGISTRY: Record<string, BlockDefinition> = {
  // ─── Section blocks (ported from index.vue) ───────────────────────────────
  hero: {
    label: 'Banner Hero',
    icon: 'fa-solid fa-image',
    category: 'section',
    defaultData: {
      badge: 'Cổng thông tin chính thống',
      titleLine1: 'Đồng hành cùng',
      titleLine2: 'hành trình hướng thiện',
      subtitle: 'Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý',
      bgImage: '/assets/hero_banner.jpg',
      btnAboutText: 'Về chúng tôi',
      btnAboutLink: '/about',
      btnHelpText: 'Nhận hỗ trợ 24/7',
      btnHelpLink: '#tro-giup',
    },
    fields: [
      { key: 'badge', label: 'Nhãn (badge)', type: 'text' },
      { key: 'titleLine1', label: 'Tiêu đề dòng 1', type: 'text' },
      { key: 'titleLine2', label: 'Tiêu đề dòng 2 (nhấn mạnh)', type: 'text' },
      { key: 'subtitle', label: 'Mô tả', type: 'textarea' },
      { key: 'bgImage', label: 'Ảnh nền', type: 'image' },
      { key: 'btnAboutText', label: 'Nút 1 — nhãn', type: 'text' },
      { key: 'btnAboutLink', label: 'Nút 1 — liên kết', type: 'url' },
      { key: 'btnHelpText', label: 'Nút 2 — nhãn', type: 'text' },
      { key: 'btnHelpLink', label: 'Nút 2 — liên kết', type: 'url' },
    ],
  },
  stats: {
    label: 'Số liệu nổi bật',
    icon: 'fa-solid fa-chart-simple',
    category: 'section',
    defaultData: {
      stats: [
        { icon: 'fa-solid fa-map-location-dot', value: '34', label: 'Tỉnh / Thành phố đồng hành' },
        { icon: 'fa-solid fa-hands-holding-circle', value: '10.000+', label: 'Người hoàn lương được hỗ trợ' },
        { icon: 'fa-solid fa-seedling', value: '500+', label: 'Mô hình kinh tế tiêu biểu' },
        { icon: 'fa-solid fa-headset', value: '24/7', label: 'Tư vấn pháp lý & Tâm lý miễn phí' },
      ],
    },
    // Stat items edited as raw JSON via textarea (kept simple; array editor is future work).
    fields: [
      { key: 'stats', label: 'Danh sách số liệu (JSON)', type: 'textarea', help: 'Mảng {icon, value, label}' },
    ],
  },
  news: {
    label: 'Tin tức',
    icon: 'fa-solid fa-newspaper',
    category: 'section',
    dataDriven: true,
    defaultData: { title: 'Tin nổi bật', categorySlug: '', maxItems: 5 },
    fields: [
      { key: 'title', label: 'Tiêu đề khối', type: 'text' },
      { key: 'categorySlug', label: 'Lọc theo danh mục (slug)', type: 'text', help: 'Để trống = tất cả tin' },
      { key: 'maxItems', label: 'Số bài hiển thị', type: 'number' },
    ],
  },
  role_models: {
    label: 'Tấm gương tiêu biểu',
    icon: 'fa-solid fa-award',
    category: 'section',
    dataDriven: true,
    defaultData: { title: 'Tấm Gương Sáng Điển Hình', subtitle: 'Hành trình hướng thiện', description: 'Những câu chuyện nghị lực phi thường vượt qua lầm lỡ, xây dựng cuộc sống ấm no và giúp đỡ đồng đội', maxItems: 4 },
    fields: [
      { key: 'title', label: 'Tiêu đề', type: 'text' },
      { key: 'subtitle', label: 'Nhãn nhỏ (eyebrow)', type: 'text' },
      { key: 'description', label: 'Mô tả', type: 'textarea' },
      { key: 'maxItems', label: 'Số mục hiển thị', type: 'number' },
    ],
  },
  reintegration: {
    label: 'Mô hình tái hòa nhập',
    icon: 'fa-solid fa-people-roof',
    category: 'section',
    dataDriven: true,
    defaultData: { title: 'Mô Hình Tái Hòa Nhập Cộng Đồng', subtitle: 'Mô hình hỗ trợ', description: 'Hệ thống giải pháp và cơ sở hỗ trợ sinh kế bền vững do Nhà nước và các địa phương tổ chức', maxItems: 4 },
    fields: [
      { key: 'title', label: 'Tiêu đề', type: 'text' },
      { key: 'subtitle', label: 'Nhãn nhỏ (eyebrow)', type: 'text' },
      { key: 'description', label: 'Mô tả', type: 'textarea' },
      { key: 'maxItems', label: 'Số mục hiển thị', type: 'number' },
    ],
  },
  documents: {
    label: 'Văn bản pháp luật',
    icon: 'fa-solid fa-file-lines',
    category: 'section',
    dataDriven: true,
    defaultData: { title: 'Văn Bản Pháp Quy Mới', description: 'Cập nhật liên tục các quyết định chỉ đạo của Thủ tướng Chính phủ, các thông tư chỉ thị của Bộ Công an về công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng.', btnText: 'Tra cứu thư viện văn bản', btnLink: '/documents', maxItems: 3 },
    fields: [
      { key: 'title', label: 'Tiêu đề', type: 'text' },
      { key: 'description', label: 'Mô tả', type: 'textarea' },
      { key: 'btnText', label: 'Nút — nhãn', type: 'text' },
      { key: 'btnLink', label: 'Nút — liên kết', type: 'url' },
      { key: 'maxItems', label: 'Số văn bản hiển thị', type: 'number' },
    ],
  },
  support_form: {
    label: 'Biểu mẫu hỗ trợ',
    icon: 'fa-solid fa-hand-holding-heart',
    category: 'section',
    defaultData: {
      title: 'Đăng Ký Tư Vấn & Hỗ Trợ Tái Hòa Nhập',
      subtitle: 'Điền thông tin để cán bộ chuyên môn liên hệ tư vấn miễn phí trong vòng 24 giờ.',
      hotline: '0903.480.985',
      email: 'contact@conduonghuongthien.com.vn',
    },
    fields: [
      { key: 'title', label: 'Tiêu đề', type: 'text' },
      { key: 'subtitle', label: 'Mô tả', type: 'textarea' },
      { key: 'hotline', label: 'Hotline', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
    ],
  },
  links: {
    label: 'Liên kết hữu ích',
    icon: 'fa-solid fa-link',
    category: 'section',
    defaultData: {
      title: 'Liên Kết Hữu Ích',
      subtitle: 'Cổng thông tin liên quan',
      links: [
        { icon: '🏛', label: 'Bộ Công an', url: 'https://bocongan.gov.vn' },
        { icon: '💻', label: 'Cổng Dịch vụ công', url: 'https://dichvucong.gov.vn' },
        { icon: '🏦', label: 'Ngân hàng CSXH', url: 'https://vbsp.org.vn' },
        { icon: '⚖', label: 'Bộ LĐ-TB&XH', url: 'https://molisa.gov.vn' },
        { icon: '📰', label: 'Báo CAND', url: 'https://cand.com.vn' },
      ],
    },
    fields: [
      { key: 'title', label: 'Tiêu đề', type: 'text' },
      { key: 'subtitle', label: 'Nhãn nhỏ (eyebrow)', type: 'text' },
      { key: 'links', label: 'Danh sách liên kết (JSON)', type: 'textarea', help: 'Mảng {icon, label, url}' },
    ],
  },

  // ─── Content blocks (new) ─────────────────────────────────────────────────
  heading: {
    label: 'Tiêu đề',
    icon: 'fa-solid fa-heading',
    category: 'content',
    defaultData: { text: 'Tiêu đề mục', subtitle: '', align: 'center' },
    fields: [
      { key: 'text', label: 'Tiêu đề', type: 'text' },
      { key: 'subtitle', label: 'Phụ đề', type: 'text' },
      { key: 'align', label: 'Căn lề', type: 'select', options: [
        { value: 'left', label: 'Trái' },
        { value: 'center', label: 'Giữa' },
        { value: 'right', label: 'Phải' },
      ] },
    ],
  },
  richtext: {
    label: 'Nội dung văn bản',
    icon: 'fa-solid fa-align-left',
    category: 'content',
    defaultData: { html: '<p>Nhập nội dung tại đây…</p>' },
    fields: [
      { key: 'html', label: 'Nội dung', type: 'richtext' },
    ],
  },
  image: {
    label: 'Hình ảnh',
    icon: 'fa-solid fa-image',
    category: 'content',
    defaultData: { url: '', alt: '', caption: '' },
    fields: [
      { key: 'url', label: 'Ảnh', type: 'image' },
      { key: 'alt', label: 'Mô tả ảnh (alt)', type: 'text' },
      { key: 'caption', label: 'Chú thích', type: 'text' },
    ],
  },
  cta: {
    label: 'Kêu gọi hành động',
    icon: 'fa-solid fa-bullhorn',
    category: 'content',
    defaultData: { title: 'Tiêu đề kêu gọi', description: '', btnText: 'Tìm hiểu thêm', btnLink: '/', bgVariant: 'green' },
    fields: [
      { key: 'title', label: 'Tiêu đề', type: 'text' },
      { key: 'description', label: 'Mô tả', type: 'textarea' },
      { key: 'btnText', label: 'Nút — nhãn', type: 'text' },
      { key: 'btnLink', label: 'Nút — liên kết', type: 'url' },
      { key: 'bgVariant', label: 'Màu nền', type: 'select', options: BG_VARIANT_OPTIONS },
    ],
  },
  gallery: {
    label: 'Thư viện ảnh',
    icon: 'fa-solid fa-images',
    category: 'content',
    defaultData: { title: 'Thư viện ảnh', items: [] },
    fields: [
      { key: 'title', label: 'Tiêu đề', type: 'text' },
      { key: 'items', label: 'Danh sách ảnh (JSON)', type: 'textarea', help: 'Mảng {url, caption}' },
    ],
  },
  contact_form: {
    label: 'Biểu mẫu liên hệ',
    icon: 'fa-solid fa-envelope',
    category: 'content',
    defaultData: { title: 'Đăng ký nhận trợ giúp' },
    fields: [
      { key: 'title', label: 'Tiêu đề biểu mẫu', type: 'text' },
    ],
  },
}

/** Ordered block types (for stable palette listing). */
export const BLOCK_TYPES = Object.keys(BLOCK_REGISTRY)

/** True when `type` is a known registry key. Used for server-side validation. */
export function isValidBlockType(type: unknown): type is string {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(BLOCK_REGISTRY, type)
}

/** Fresh copy of a block type's default data (safe to mutate). */
export function getDefaultData(type: string): Record<string, any> {
  const def = BLOCK_REGISTRY[type]
  if (!def) return {}
  return JSON.parse(JSON.stringify(def.defaultData))
}

/** Registry entries grouped by palette category, preserving declaration order. */
export function blocksByCategory(): Record<'section' | 'content', Array<{ type: string } & BlockDefinition>> {
  const grouped: Record<'section' | 'content', Array<{ type: string } & BlockDefinition>> = { section: [], content: [] }
  for (const type of BLOCK_TYPES) {
    const def = BLOCK_REGISTRY[type]
    grouped[def.category].push({ type, ...def })
  }
  return grouped
}
