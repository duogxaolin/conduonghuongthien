/**
 * Page preview definitions — 6 skeleton layouts with clickable hotspots.
 *
 * Each hotspot maps to a real doc slug (validated by the guard test).
 * The DocsPreviewSkeleton component switches template by `layout` prop.
 */

export type PreviewHotspot = {
  id: string
  label: string
  hint: string
  docSlug: string
  anchor?: string
  /** Grid area within the skeleton layout */
  area: string
}

export type PagePreview = {
  slug: string
  title: string
  description: string
  layout: 'home' | 'article-detail' | 'news-list' | 'admin-dashboard' | 'admin-articles-list' | 'admin-article-edit'
  hotspots: PreviewHotspot[]
}

export const DOC_PREVIEWS: PagePreview[] = [
  {
    slug: 'trang-chu',
    title: 'Trang chủ',
    description: 'Trang đầu tiên người dùng thấy — topbar, hero banner, blocks bài viết, tấm gương, mô hình tái hòa nhập, thống kê và footer.',
    layout: 'home',
    hotspots: [
      { id: 'topbar', label: 'Thanh trên (Top Bar)', hint: 'Hotline, mạng xã hội, ngôn ngữ', docSlug: 'menu-navbar', area: 'top' },
      { id: 'header', label: 'Header & Menu', hint: 'Logo, menu điều hướng', docSlug: 'menu-navbar', area: 'header' },
      { id: 'hero', label: 'Hero Banner', hint: 'Ảnh bìa trang chủ', docSlug: 'trang-chu-blocks', anchor: 'hero', area: 'hero' },
      { id: 'news', label: 'Khối bản tin', hint: 'Bài viết mới nhất', docSlug: 'ban-tin', area: 'news' },
      { id: 'role-models', label: 'Tấm gương hoàn lương', hint: 'Profiles tấm gương', docSlug: 'tam-guong', area: 'role-models' },
      { id: 'reintegration', label: 'Mô hình tái hòa nhập', hint: 'Mô hình cộng đồng', docSlug: 'mo-hinh-tai-hoa-nhap', area: 'reintegration' },
      { id: 'stats', label: 'Thống kê', hint: 'Số liệu portal', docSlug: 'thong-ke-truy-cap', area: 'stats' },
      { id: 'footer', label: 'Footer', hint: 'Liên hệ, liên kết', docSlug: 'lien-he', area: 'footer' },
    ],
  },
  {
    slug: 'bai-viet-chi-tiet',
    title: 'Bài viết chi tiết',
    description: 'Trang hiển thị một bài viết đầy đủ — breadcrumb, ảnh bìa, nội dung rich-text, bình luận và sidebar.',
    layout: 'article-detail',
    hotspots: [
      { id: 'breadcrumb', label: 'Breadcrumb', hint: 'Đường dẫn điều hướng', docSlug: 'bai-viet-ban-tin', area: 'top' },
      { id: 'title', label: 'Tiêu đề & Meta', hint: 'Tiêu đề, ngày đăng, tác giả', docSlug: 'bai-viet-ban-tin', area: 'title' },
      { id: 'cover', label: 'Ảnh bìa', hint: 'Hình đại diện bài viết', docSlug: 'thu-vien-media', area: 'cover' },
      { id: 'content', label: 'Nội dung rich-text', hint: 'Body bài viết (TinyMCE)', docSlug: 'bai-viet-ban-tin', anchor: 'content', area: 'content' },
      { id: 'share', label: 'Chia sẻ mạng xã hội', hint: 'Nút chia sẻ Facebook, Zalo', docSlug: 'mang-xa-hoi', area: 'share' },
      { id: 'comments', label: 'Bình luận', hint: 'Bình luận người đọc', docSlug: 'nguoi-doc-binh-luan', area: 'comments' },
      { id: 'related', label: 'Bài viết liên quan', hint: 'Danh sách bài cùng chuyên mục', docSlug: 'ban-tin', area: 'related' },
    ],
  },
  {
    slug: 'ban-tin-list',
    title: 'Danh sách bản tin',
    description: 'Trang danh sách bài viết theo chuyên mục — bộ lọc, lưới bài viết, phân trang.',
    layout: 'news-list',
    hotspots: [
      { id: 'category-bar', label: 'Thanh chuyên mục', hint: 'Lọc theo danh mục', docSlug: 'danh-muc', area: 'top' },
      { id: 'article-grid', label: 'Lưới bài viết', hint: 'Danh sách bài viết', docSlug: 'ban-tin', area: 'grid' },
      { id: 'search', label: 'Tìm kiếm', hint: 'Ô tìm kiếm bài viết', docSlug: 'tim-kiem', area: 'search' },
      { id: 'pagination', label: 'Phân trang', hint: 'Chuyển trang', docSlug: 'ban-tin', area: 'pagination' },
    ],
  },
  {
    slug: 'admin-dashboard',
    title: 'Bảng điều khiển Admin',
    description: 'Trang chủ admin — thống kê nhanh, biểu đồ truy cập, thao tác nhanh.',
    layout: 'admin-dashboard',
    hotspots: [
      { id: 'sidebar', label: 'Sidebar menu', hint: 'Menu điều hướng admin', docSlug: 'menu-navbar', area: 'sidebar' },
      { id: 'stats-cards', label: 'Thẻ thống kê', hint: 'Số liệu tổng quan', docSlug: 'thong-ke-truy-cap', area: 'stats' },
      { id: 'traffic-chart', label: 'Biểu đồ truy cập', hint: 'Xu hướng truy cập', docSlug: 'thong-ke-truy-cap', anchor: 'traffic', area: 'chart' },
      { id: 'recent', label: 'Bài viết gần đây', hint: 'Bài vừa đăng', docSlug: 'bai-viet-ban-tin', area: 'recent' },
      { id: 'quick-actions', label: 'Thao tác nhanh', hint: 'Tạo bài viết, trang', docSlug: 'bai-viet-ban-tin', area: 'quick' },
    ],
  },
  {
    slug: 'admin-bai-viet-list',
    title: 'Danh sách bài viết (Admin)',
    description: 'Trang quản lý bài viết trong admin — bảng bài viết, bộ lọc, thao tác hàng loạt.',
    layout: 'admin-articles-list',
    hotspots: [
      { id: 'sidebar', label: 'Sidebar menu', hint: 'Menu admin', docSlug: 'menu-navbar', area: 'sidebar' },
      { id: 'filter-bar', label: 'Bộ lọc', hint: 'Lọc theo trạng thái, chuyên mục', docSlug: 'danh-muc', area: 'filter' },
      { id: 'table', label: 'Bảng bài viết', hint: 'Danh sách bài viết', docSlug: 'bai-viet-ban-tin', area: 'table' },
      { id: 'bulk', label: 'Thao tác hàng loạt', hint: 'Xuất, xóa nhiều bài', docSlug: 'bai-viet-ban-tin', area: 'bulk' },
      { id: 'create', label: 'Tạo bài mới', hint: 'Nút thêm bài viết', docSlug: 'bai-viet-ban-tin', area: 'create' },
    ],
  },
  {
    slug: 'admin-bai-viet-edit',
    title: 'Soạn thảo bài viết (Admin)',
    description: 'Trang soạn/sửa bài viết — tiêu đề, ảnh bìa, TinyMCE editor, cài đặt xuất bản.',
    layout: 'admin-article-edit',
    hotspots: [
      { id: 'sidebar', label: 'Sidebar menu', hint: 'Menu admin', docSlug: 'menu-navbar', area: 'sidebar' },
      { id: 'title-input', label: 'Tiêu đề bài viết', hint: 'Nhập tiêu đề', docSlug: 'bai-viet-ban-tin', area: 'title' },
      { id: 'cover-image', label: 'Ảnh bìa', hint: 'Chọn ảnh từ thư viện', docSlug: 'thu-vien-media', area: 'cover' },
      { id: 'editor', label: 'Trình soạn thảo', hint: 'TinyMCE rich-text editor', docSlug: 'bai-viet-ban-tin', anchor: 'editor', area: 'editor' },
      { id: 'category-select', label: 'Chuyên mục', hint: 'Chọn danh mục bài viết', docSlug: 'danh-muc', area: 'category' },
      { id: 'publish', label: 'Xuất bản', hint: 'Trạng thái & lên lịch', docSlug: 'bai-viet-ban-tin', anchor: 'publish', area: 'publish' },
    ],
  },
]
