// ─── Block Registry ──────────────────────────────────────────────────────────
// Single source of truth for the page builder. Keyed by blockType. Consumed by:
//   (a) the admin builder (palette grouping + edit-drawer field generation),
//   (b) server-side validation (isValidBlockType),
//   (c) seeding / freshly-added blocks (getDefaultData),
//   (d) the public PageRenderer (blockType → renderer component mapping lives there).
// Section blocks reproduce the existing homepage sections (design preserved);
// content blocks are new, for about/contact/custom pages.

import type { BlockData } from './types'

export type EditorFieldType =
  | 'text' | 'textarea' | 'richtext' | 'number' | 'select' | 'image' | 'toggle' | 'url'
  | 'array' | 'category'

export interface EditorField {
  key: string
  label: string
  type: EditorFieldType
  options?: Array<{ value: string; label: string }>
  help?: string
  placeholder?: string
  /** For type: 'array' — column schema for each repeated item. */
  itemSchema?: Array<{
    key: string
    label: string
    type: 'text' | 'url' | 'image' | 'textarea' | 'select' | 'toggle'
    /** For column type 'select' — the static option list. */
    options?: Array<{ value: string; label: string }>
  }>
  /** For type: 'category' — content type whose categories populate the dropdown. */
  categoryType?: string
}

export interface BlockDefinition {
  label: string
  icon: string
  category: 'section' | 'content' | 'layout'
  defaultData: BlockData
  fields: EditorField[]
  /** true for blocks that fetch articles at render time (news, role_models, …) */
  dataDriven?: boolean
  /** true for layout container nodes (section/row/column) that hold `children`. */
  isContainer?: boolean
  /** Default colSpan (1–12) for `column` containers; ignored by other types. */
  defaultColSpan?: number
}

// ─── Layout grid constants ────────────────────────────────────────────────────
/** The row grid is always 12 columns wide. */
export const GRID_COLUMNS = 12
export const MIN_COL_SPAN = 1
export const MAX_COL_SPAN = 12
/** A brand-new column spans the full row by default (editor then narrows it). */
export const DEFAULT_COL_SPAN = 12

/** Clamp any incoming colSpan to a valid integer in [1, 12]. */
export function clampColSpan(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_COL_SPAN
  return Math.min(MAX_COL_SPAN, Math.max(MIN_COL_SPAN, n))
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
    fields: [
      { key: 'stats', label: 'Danh sách số liệu', type: 'array', itemSchema: [
        { key: 'icon', label: 'Icon (FontAwesome)', type: 'text' },
        { key: 'value', label: 'Giá trị', type: 'text' },
        { key: 'label', label: 'Nhãn', type: 'text' },
      ] },
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
      { key: 'categorySlug', label: 'Lọc theo danh mục', type: 'category', categoryType: 'news', help: 'Để trống = tất cả tin' },
      { key: 'maxItems', label: 'Số bài hiển thị', type: 'number' },
    ],
  },
  role_models: {
    label: 'Tấm gương tiêu biểu',
    icon: 'fa-solid fa-award',
    category: 'section',
    dataDriven: true,
    defaultData: { title: 'Tấm Gương Sáng Điển Hình', subtitle: 'Hành trình hướng thiện', description: 'Những câu chuyện nghị lực phi thường vượt qua lầm lỡ, xây dựng cuộc sống ấm no và giúp đỡ đồng đội', categorySlug: '', maxItems: 4 },
    fields: [
      { key: 'title', label: 'Tiêu đề', type: 'text' },
      { key: 'subtitle', label: 'Nhãn nhỏ (eyebrow)', type: 'text' },
      { key: 'description', label: 'Mô tả', type: 'textarea' },
      { key: 'categorySlug', label: 'Lọc theo danh mục', type: 'category', categoryType: 'role_model' },
      { key: 'maxItems', label: 'Số mục hiển thị', type: 'number' },
    ],
  },
  reintegration: {
    label: 'Mô hình tái hòa nhập',
    icon: 'fa-solid fa-people-roof',
    category: 'section',
    dataDriven: true,
    defaultData: { title: 'Mô Hình Tái Hòa Nhập Cộng Đồng', subtitle: 'Mô hình hỗ trợ', description: 'Hệ thống giải pháp và cơ sở hỗ trợ sinh kế bền vững do Nhà nước và các địa phương tổ chức', categorySlug: '', maxItems: 4 },
    fields: [
      { key: 'title', label: 'Tiêu đề', type: 'text' },
      { key: 'subtitle', label: 'Nhãn nhỏ (eyebrow)', type: 'text' },
      { key: 'description', label: 'Mô tả', type: 'textarea' },
      { key: 'categorySlug', label: 'Lọc theo danh mục', type: 'category', categoryType: 'reintegration' },
      { key: 'maxItems', label: 'Số mục hiển thị', type: 'number' },
    ],
  },
  documents: {
    label: 'Văn bản pháp luật',
    icon: 'fa-solid fa-file-lines',
    category: 'section',
    dataDriven: true,
    defaultData: { title: 'Văn Bản Pháp Quy Mới', description: 'Cập nhật liên tục các quyết định chỉ đạo của Thủ tướng Chính phủ, các thông tư chỉ thị của Bộ Công an về công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng.', btnText: 'Tra cứu thư viện văn bản', btnLink: '/documents', categorySlug: '', maxItems: 3 },
    fields: [
      { key: 'title', label: 'Tiêu đề', type: 'text' },
      { key: 'description', label: 'Mô tả', type: 'textarea' },
      { key: 'btnText', label: 'Nút — nhãn', type: 'text' },
      { key: 'btnLink', label: 'Nút — liên kết', type: 'url' },
      { key: 'categorySlug', label: 'Lọc theo danh mục', type: 'category', categoryType: 'document' },
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
      { key: 'links', label: 'Danh sách liên kết', type: 'array', itemSchema: [
        { key: 'icon', label: 'Icon / Emoji', type: 'text' },
        { key: 'label', label: 'Tên liên kết', type: 'text' },
        { key: 'url', label: 'Đường dẫn', type: 'url' },
      ] },
    ],
  },
  quote: {
    label: 'Trích dẫn (Parallax)',
    icon: 'fa-solid fa-quote-right',
    category: 'section',
    defaultData: {
      quote: 'Mỗi con người lầm lỡ đều xứng đáng có một cơ hội thứ hai để hướng thiện. Sự chung tay, đồng hành của gia đình và toàn xã hội chính là ánh dương thắp sáng nẻo về lương thiện.',
      cite: '— Đề án Tái hòa nhập cộng đồng, C11 Bộ Công an',
      bgImage: '/assets/hero_banner.jpg',
    },
    fields: [
      { key: 'quote', label: 'Nội dung trích dẫn', type: 'textarea' },
      { key: 'cite', label: 'Nguồn / tác giả', type: 'text' },
      { key: 'bgImage', label: 'Ảnh nền', type: 'image' },
    ],
  },

  // ─── Content blocks (new) ─────────────────────────────────────────────────
  heading: {
    label: 'Tiêu đề',
    icon: 'fa-solid fa-heading',
    category: 'content',
    defaultData: { text: 'Tiêu đề mục', subtitle: '', align: 'center', variant: 'default', bgImage: '' },
    fields: [
      { key: 'text', label: 'Tiêu đề', type: 'text' },
      { key: 'subtitle', label: 'Phụ đề', type: 'text' },
      { key: 'variant', label: 'Kiểu hiển thị', type: 'select', options: [
        { value: 'default', label: 'Tiêu đề mục (nền trắng)' },
        { value: 'banner', label: 'Banner lớn (nền xanh + ảnh)' },
      ] },
      { key: 'bgImage', label: 'Ảnh nền (khi chọn Banner)', type: 'image', help: 'Chỉ áp dụng cho kiểu Banner' },
      { key: 'align', label: 'Căn lề (kiểu Tiêu đề mục)', type: 'select', options: [
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
      { key: 'items', label: 'Danh sách ảnh', type: 'array', itemSchema: [
        { key: 'url', label: 'Ảnh', type: 'image' },
        { key: 'caption', label: 'Chú thích', type: 'text' },
      ] },
    ],
  },
  content_aside: {
    label: 'Nội dung + Cột thông tin',
    icon: 'fa-solid fa-table-columns',
    category: 'content',
    defaultData: {
      title: 'Ban Biên tập',
      icon: 'fa-solid fa-building-columns',
      bodyHtml: '<h3>Tiêu đề mục</h3><p>Nội dung giới thiệu…</p>',
      asideLabel: 'ĐƠN VỊ CHỦ QUẢN',
      asideTitle: 'Tên đơn vị chủ quản',
      asideSubtitle: 'Bộ Công an',
      asideNote: '',
      highlightLabel: 'Hotline liên hệ trực tiếp:',
      highlightValue: '0903.480.985',
    },
    fields: [
      { key: 'title', label: 'Tiêu đề khối (thanh icon)', type: 'text', help: 'Để trống để ẩn thanh tiêu đề' },
      { key: 'icon', label: 'Icon thanh tiêu đề (FontAwesome)', type: 'text' },
      { key: 'bodyHtml', label: 'Nội dung cột trái', type: 'richtext', help: 'Dùng <h3>, <p>, <ul><li> — kiểu hiển thị tự áp dụng' },
      { key: 'asideLabel', label: 'Cột phải — nhãn nhỏ', type: 'text' },
      { key: 'asideTitle', label: 'Cột phải — tiêu đề', type: 'text' },
      { key: 'asideSubtitle', label: 'Cột phải — dòng phụ (in đậm)', type: 'text' },
      { key: 'asideNote', label: 'Cột phải — ghi chú', type: 'textarea' },
      { key: 'highlightLabel', label: 'Cột phải — nhãn nổi bật', type: 'text' },
      { key: 'highlightValue', label: 'Cột phải — giá trị nổi bật (xanh lớn)', type: 'text' },
    ],
  },
  contact_form: {
    label: 'Biểu mẫu liên hệ',
    icon: 'fa-solid fa-envelope',
    category: 'content',
    defaultData: {
      title: 'Đăng ký nhận trợ giúp',
      recipientEmail: '',
      // Default fields reproduce the legacy four-field layout so existing pages
      // are visually unchanged. map targets the fixed submissions columns.
      fields: [
        { id: 'f_name', label: 'Họ và tên', type: 'text', required: true, placeholder: 'Nguyễn Văn A', map: 'name', optionsText: '' },
        { id: 'f_phone', label: 'Số điện thoại', type: 'tel', required: true, placeholder: '09xx xxx xxx', map: 'phone', optionsText: '' },
        { id: 'f_city', label: 'Tỉnh / Thành phố', type: 'text', required: true, placeholder: 'Hà Nội', map: 'address', optionsText: '' },
        { id: 'f_message', label: 'Nội dung cần hỗ trợ', type: 'textarea', required: true, placeholder: 'Mô tả ngắn gọn vấn đề bạn cần được tư vấn...', map: 'message', optionsText: '' },
      ],
      showInfo: false, infoTitle: '', infoRows: [], noteTitle: '', noteText: '',
    },
    fields: [
      { key: 'title', label: 'Tiêu đề biểu mẫu', type: 'text' },
      { key: 'recipientEmail', label: 'Email nhận thông báo', type: 'text', help: 'Địa chỉ nhận email khi có đơn mới (cần cấu hình SMTP). Để trống = chỉ lưu vào hệ thống.' },
      { key: 'fields', label: 'Các trường biểu mẫu', type: 'array', itemSchema: [
        { key: 'label', label: 'Nhãn hiển thị', type: 'text' },
        { key: 'type', label: 'Kiểu trường', type: 'select', options: [
          { value: 'text', label: 'Văn bản (text)' },
          { value: 'email', label: 'Email' },
          { value: 'tel', label: 'Điện thoại (tel)' },
          { value: 'number', label: 'Số (number)' },
          { value: 'textarea', label: 'Đoạn văn (textarea)' },
          { value: 'select', label: 'Chọn (select)' },
        ] },
        { key: 'required', label: 'Bắt buộc', type: 'toggle' },
        { key: 'placeholder', label: 'Gợi ý (placeholder)', type: 'text' },
        { key: 'map', label: 'Ánh xạ cột dữ liệu', type: 'select', options: [
          { value: 'none', label: 'Không (lưu vào answers)' },
          { value: 'name', label: 'Họ tên → full_name' },
          { value: 'phone', label: 'Điện thoại → phone' },
          { value: 'email', label: 'Email → email' },
          { value: 'address', label: 'Địa chỉ → address' },
          { value: 'message', label: 'Nội dung → message' },
        ] },
        { key: 'optionsText', label: 'Tùy chọn (mỗi dòng 1 mục — chỉ cho kiểu select)', type: 'textarea' },
      ] },
      { key: 'showInfo', label: 'Bố cục 2 cột (hiện cột thông tin)', type: 'toggle' },
      { key: 'infoTitle', label: 'Cột thông tin — tiêu đề', type: 'text', help: 'Chỉ hiện khi bật bố cục 2 cột' },
      { key: 'infoRows', label: 'Cột thông tin — các dòng', type: 'array', itemSchema: [
        { key: 'label', label: 'Nhãn (in đậm)', type: 'text' },
        { key: 'value', label: 'Giá trị', type: 'text' },
      ] },
      { key: 'noteTitle', label: 'Ghi chú — tiêu đề', type: 'text' },
      { key: 'noteText', label: 'Ghi chú — nội dung', type: 'textarea' },
    ],
  },

  // ─── Layout container blocks (Flatsome-style nested grid) ─────────────────
  // Containers hold `children` on the NODE (not inside `data`). `section` is a
  // full-width band, `row` a 12-column grid, `column` spans 1–12 of that grid.
  section: {
    label: 'Section (Dải nội dung)',
    icon: 'fa-solid fa-square-full',
    category: 'layout',
    isContainer: true,
    defaultData: { bgVariant: 'white', paddingY: 'md' },
    fields: [
      { key: 'bgVariant', label: 'Màu nền', type: 'select', options: BG_VARIANT_OPTIONS },
      { key: 'paddingY', label: 'Khoảng đệm dọc', type: 'select', options: [
        { value: 'none', label: 'Không' },
        { value: 'sm', label: 'Nhỏ' },
        { value: 'md', label: 'Vừa' },
        { value: 'lg', label: 'Lớn' },
      ] },
    ],
  },
  row: {
    label: 'Row (Hàng lưới)',
    icon: 'fa-solid fa-table-columns',
    category: 'layout',
    isContainer: true,
    defaultData: { gap: 'md', align: 'stretch' },
    fields: [
      { key: 'gap', label: 'Khoảng cách cột', type: 'select', options: [
        { value: 'none', label: 'Không' },
        { value: 'sm', label: 'Nhỏ' },
        { value: 'md', label: 'Vừa' },
        { value: 'lg', label: 'Lớn' },
      ] },
      { key: 'align', label: 'Căn dọc', type: 'select', options: [
        { value: 'start', label: 'Trên' },
        { value: 'center', label: 'Giữa' },
        { value: 'stretch', label: 'Kéo giãn' },
      ] },
    ],
  },
  column: {
    label: 'Column (Cột)',
    icon: 'fa-solid fa-grip-lines-vertical',
    category: 'layout',
    isContainer: true,
    defaultColSpan: DEFAULT_COL_SPAN,
    defaultData: {},
    fields: [],
  },
}

/** Ordered block types (for stable palette listing). */
export const BLOCK_TYPES = Object.keys(BLOCK_REGISTRY)

/** True when `type` is a known registry key. Used for server-side validation. */
export function isValidBlockType(type: unknown): type is string {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(BLOCK_REGISTRY, type)
}

/** The three layout container node types, in palette order. */
export const CONTAINER_TYPES = ['section', 'row', 'column'] as const

/** True when `type` is a layout container (section/row/column) that holds children. */
export function isContainerType(type: unknown): type is string {
  return typeof type === 'string' && BLOCK_REGISTRY[type]?.isContainer === true
}

/** Fresh copy of a block type's default data (safe to mutate). */
export function getDefaultData(type: string): BlockData {
  const def = BLOCK_REGISTRY[type]
  if (!def) return {}
  return JSON.parse(JSON.stringify(def.defaultData))
}

/** Registry entries grouped by palette category, preserving declaration order. */
export function blocksByCategory(): Record<'section' | 'content' | 'layout', Array<{ type: string } & BlockDefinition>> {
  const grouped: Record<'section' | 'content' | 'layout', Array<{ type: string } & BlockDefinition>> = { section: [], content: [], layout: [] }
  for (const type of BLOCK_TYPES) {
    const def = BLOCK_REGISTRY[type]
    if (!def) continue
    grouped[def.category].push({ ...def, type })
  }
  return grouped
}
