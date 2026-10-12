import type { AdminDoc } from './types'

/**
 * Category: content — 6 docs about content management articles, pages, categories, media, menu, content types.
 */
export const CONTENT_DOCS: AdminDoc[] = [
  {
    slug: 'bai-viet-ban-tin',
    title: 'Bài viết & Bản tin',
    category: 'content',
    icon: 'fa-solid fa-newspaper',
    summary: 'Tạo, soạn thảo, xuất bản và quản lý bài viết trên cổng thông tin.',
    description: 'Bài viết là nội dung chính của cổng thông tin. Admin soạn thảo bài viết qua trình TinyMCE, chọn chuyên mục, ảnh bìa, trạng thái xuất bản và lập lịch đăng. Bài viết đã xuất bản hiển thị công khai ở trang danh sách bản tin và trang chi tiết. Hỗ trợ tăng lượt xem tự nhiên (real views) và boost views theo thời gian tuyệt đối.',
    workflow: [
      { title: 'Vào trang danh sách bài viết', detail: 'Mở /admin/content/articles để xem tất cả bài viết.', link: '/admin/content/articles' },
      { title: 'Tạo bài mới', detail: 'Bấm nút "Tạo bài viết mới" để mở trang soạn thảo.' },
      { title: 'Nhập tiêu đề & ảnh bìa', detail: 'Tiêu đề tự sinh slug, có thể chỉnh sửa. Ảnh bìa chọn từ thư viện media.' },
      { title: 'Soạn nội dung', detail: 'Dùng TinyMCE editor (height 700) ở full section width. Hỗ trợ ảnh, iframe, video.' },
      { title: 'Chọn chuyên mục & trạng thái', detail: 'Chọn chuyên mục, gắn thẻ, đặt trạng thái (bản nháp / chờ duyệt / xuất bản).' },
      { title: 'Lưu & xuất bản', detail: 'Bấm "Lưu" để lưu nháp, hoặc "Xuất bản" để hiển thị công khai.' },
    ],
    mermaid: `flowchart LR
    A[Trang danh sách] --> B[Soạn thảo]
    B --> C[Tiêu đề + Ảnh bìa]
    C --> D[TinyMCE Editor]
    D --> E[Chọn chuyên mục]
    E --> F[Lưu nháp]
    E --> G[Xuất bản]
    G --> H[Công khai]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D,E,F,G process
    class H output`,
    links: [
      { label: 'Danh sách bài viết', href: '/admin/content/articles' },
      { label: 'Quản lý chuyên mục', href: '/admin/content/categories' },
      { label: 'Thư viện Media', href: '/admin/media' },
    ],
    aliases: ['xuất bản bài viết', 'đăng bài', 'đăng tin', 'soạn bài', 'viết bài', 'tạo bài viết'],
    keywords: ['bai viet', 'ban tin', 'xuat ban', 'dang bai', 'soan bai', 'tin tuc', 'bài viết', 'bản tin'],
    questions: ['Làm sao đăng bài mới?', 'Làm sao xuất bản bài viết?', 'Tại sao bài viết không hiển thị?', 'Làm sao đổi chuyên mục bài viết?'],
    screenshot: '/assets/docs/bai-viet-ban-tin.png',
  },
  {
    slug: 'quan-ly-trang',
    title: 'Quản lý Trang',
    category: 'content',
    icon: 'fa-solid fa-file-lines',
    summary: 'Tạo và quản lý trang tĩnh bằng Page Builder (khối block kéo-thả).',
    description: 'Trang tĩnh (pages) khác bài viết ở chỗ nội dung được xây bằng Page Builder — trình kéo-thả 19 loại khối (section, row, column, hero, rich-text, image, video, news-list, role-models, reintegration-models, stats, CTA, FAQ, quote, contact-form, accordion, tabs, content-aside, divider, spacer). Trang hệ thống (home, about, contact) có isSystem=true — khóa slug, không xóa. Trang có isVisible để ẩn/hiện công khai.',
    workflow: [
      { title: 'Vào quản lý trang', detail: 'Mở /admin/content/pages', link: '/admin/content/pages' },
      { title: 'Tạo trang mới', detail: 'Bấm "Tạo trang mới", nhập tiêu đề và slug.' },
      { title: 'Kéo khối vào canvas', detail: 'Chọn khối từ sidebar (section, content, layout) và kéo vào canvas.' },
      { title: 'Cấu hình khối', detail: 'Bấm vào khối để chỉnh nội dung, ảnh, link qua panel phải.' },
      { title: 'Ẩn/hiện trang', detail: 'Bật/tắt isVisible để quản lý hiển thị công khai.' },
      { title: 'Lưu & xem trước', detail: 'Bấm "Lưu trang" để lưu. Trang có isVisible=true hiển thị ở route /[slug].' },
    ],
    mermaid: `flowchart TD
    A[Danh sách trang] --> B[Tạo trang mới]
    B --> C[Nhập tiêu đề + slug]
    C --> D[Page Builder]
    D --> E[Kéo khối block]
    E --> F[Cấu hình khối]
    F --> G[Lưu trang]
    G --> H{isVisible?}
    H -->|Có| I[Công khai: /slug]
    H -->|Không| J[Ẩn]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D,E,F,G process
    class H decision
    class I,J output`,
    links: [
      { label: 'Quản lý trang', href: '/admin/content/pages' },
      { label: 'Quản lý menu', href: '/admin/content/navigation' },
    ],
    aliases: ['page builder', 'xây dựng trang', 'tạo trang', 'tạo page', 'tuỳ chỉnh trang'],
    keywords: ['trang', 'page', 'page builder', 'block', 'khoi block', 'isVisible'],
    questions: ['Làm sao tạo trang mới?', 'Làm sao dùng Page Builder?', 'Tại sao trang không hiển thị?', 'Làm sao ẩn trang?'],
    screenshot: '/assets/docs/quan-ly-trang.png',
  },
  {
    slug: 'danh-muc',
    title: 'Danh mục chuyên mục',
    category: 'content',
    icon: 'fa-solid fa-folder-tree',
    summary: 'Quản lý cây chuyên mục bài viết — phân loại nội dung theo nhóm.',
    description: 'Danh mục (category) là cách phân nhóm bài viết. Mỗi danh mục có tên, slug, mô tả, và có thể có danh mục cha (hierarchical). Bài viết thuộc một danh mục sẽ hiển thị ở route /news/[category-slug]. Danh mục giúp người чит duyệt bài theo chủ đề và giúp admin lọc bài viết.',
    workflow: [
      { title: 'Vào quản lý danh mục', detail: 'Mở /admin/content/categories', link: '/admin/content/categories' },
      { title: 'Tạo danh mục mới', detail: 'Bấm "Tạo danh mục", nhập tên, slug tự sinh.' },
      { title: 'Chọn danh mục cha', detail: 'Có thể chọn danh mục cha để tạo cây phân cấp.' },
      { title: 'Nhập mô tả', detail: 'Mô tả hiển thị ở trang danh mục công khai.' },
      { title: 'Lưu', detail: 'Bấm "Lưu" để tạo danh mục. Bài viết có thể chọn danh mục này khi soạn thảo.' },
    ],
    mermaid: `flowchart LR
    A[Danh sách danh mục] --> B[Tạo danh mục]
    B --> C[Tên + Slug]
    C --> D{Có cha?}
    D -->|Có| E[Chọn danh mục cha]
    D -->|Không| F[Danh mục gốc]
    E --> G[Lưu]
    F --> G
    G --> H[Bài viết gán danh mục]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,E,F,G process
    class D decision
    class H output`,
    links: [
      { label: 'Quản lý danh mục', href: '/admin/content/categories' },
      { label: 'Soạn bài viết', href: '/admin/content/articles' },
    ],
    aliases: ['category', 'chuyên mục', 'phân loại bài viết', 'nhóm bài viết'],
    keywords: ['danh muc', 'category', 'chuyen muc', 'phan loai', 'nhom bai'],
    questions: ['Làm sao tạo danh mục mới?', 'Làm sao phân cấp danh mục?', 'Danh mục ở đâu?'],
    screenshot: '/assets/docs/danh-muc.png',
  },
  {
    slug: 'thu-vien-media',
    title: 'Thư viện Media',
    category: 'content',
    icon: 'fa-solid fa-photo-film',
    summary: 'Tải lên, quản lý và nhúng ảnh/video vào bài viết và trang.',
    description: 'Thư viện Media là kho tập tin ảnh và video của cổng. Admin tải lên file (ảnh qua sharp tối ưu + resize, video giữ nguyên). File lưu local /public/uploads/YYYY/MM/ và đồng bộ lên R2 (S3 SDK). Khi soạn thảo bài viết, admin có thể mở MediaLibraryModal để chọn ảnh đã up chèn vào nội dung. Hỗ trợ magic-byte verification (2 allowlist phải khớp), .ico nhận, .svg không nhận.',
    workflow: [
      { title: 'Vào thư viện media', detail: 'Mở /admin/media', link: '/admin/media' },
      { title: 'Tải lên file', detail: 'Kéo-thả file hoặc bấm "Upload". Ảnh tự qua sharp để tối ưu kích thước.' },
      { title: 'Quản lý file', detail: 'Xem, tìm kiếm, xóa file đã tải lên.' },
      { title: 'Chọn ảnh khi soạn thảo', detail: 'Trong bài viết/trang, bấm "Thư viện" để mở Modal chọn ảnh.' },
      { title: 'Đồng bộ R2', detail: 'File tự động đồng bộ lên R2 (S3) để phục vụ qua CDN.' },
    ],
    mermaid: `flowchart LR
    A[Thư viện Media] --> B[Tải lên file]
    B --> C{Loại file?}
    C -->|Ảnh| D[Sharp resize + optimize]
    C -->|Video| E[Giữ nguyên]
    D --> F[Lưu local /uploads/YYYY/MM]
    E --> F
    F --> G[Đồng bộ R2]
    G --> H[CDN URL]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,D,E,G process
    class C decision
    class F data
    class H output`,
    links: [
      { label: 'Thư viện Media', href: '/admin/media' },
      { label: 'Cấu hình lưu trữ R2', href: '/admin/settings/media-storage' },
    ],
    aliases: ['media library', 'upload ảnh', 'tải ảnh', 'thư viện ảnh', 'quản lý file'],
    keywords: ['media', 'thu vien', 'upload', 'anh', 'video', 'tai len', 'hinh anh'],
    questions: ['Làm sao tải ảnh lên?', 'Làm sao chèn ảnh vào bài viết?', 'Ảnh lưu ở đâu?', 'Tại sao không tải được .svg?'],
    screenshot: '/assets/docs/thu-vien-media.png',
  },
  {
    slug: 'menu-navbar',
    title: 'Menu & Thanh điều hướng',
    category: 'content',
    icon: 'fa-solid fa-bars',
    summary: 'Cấu hình menu điều hướng công khai — menu desktop, mobile, dropdown.',
    description: 'Menu điều hướng (navbar) là cấu hình trong admin cho phép thêm/sửa/xóa mục menu, kéo sắp thứ tự, gắn link tới trang/bài viết/URL ngoài, bật/tắt openNewTab. Menu hiển thị trên header desktop và drawer mobile. Nav config là allowlist `openNewTab` — thêm field phải sửa NavItem + normalizeNavItem + test. Có 2 cấp: menu cha và mục con (dropdown).',
    workflow: [
      { title: 'Vào quản lý menu', detail: 'Mở /admin/content/navigation', link: '/admin/content/navigation' },
      { title: 'Thêm mục menu', detail: 'Bấm "Thêm mục", nhập nhãn, chọn link (trang, bài viết, URL tự nhập).' },
      { title: 'Sắp xếp thứ tự', detail: 'Kéo-thả để đổi thứ tự menu.' },
      { title: 'Tạo dropdown', detail: 'Thêm mục con dưới mục cha để tạo dropdown desktop.' },
      { title: 'Bật openNewTab', detail: 'Cho mục liên kết ngoài, bật openNewTab để mở tab mới.' },
      { title: 'Lưu', detail: 'Bấm "Lưu menu". Thay đổi áp dụng ngay cho trang công khai.' },
    ],
    mermaid: `flowchart TD
    A[Quản lý menu] --> B[Thêm mục]
    B --> C[Nhập nhãn + link]
    C --> D{Có mục con?}
    D -->|Có| E[Thêm dropdown con]
    D -->|Không| F[Mục đơn]
    E --> G[Sắp xếp thứ tự]
    F --> G
    G --> H[Lưu menu]
    H --> I[Áp dụng trang công khai]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,E,F,G,H process
    class D decision
    class I output`,
    links: [
      { label: 'Quản lý menu', href: '/admin/content/navigation' },
    ],
    aliases: ['navbar', 'menu điều hướng', 'navigation', 'menu công khai', 'menu desktop'],
    keywords: ['menu', 'navbar', 'navigation', 'dieu huong', 'dropdown', 'open new tab'],
    questions: ['Làm sao thêm mục menu?', 'Làm sao tạo dropdown?', 'Làm sao đổi thứ tự menu?', 'Menu mở tab mới ở đâu?'],
    screenshot: '/assets/docs/menu-navbar.png',
  },
  {
    slug: 'the-loai-noi-dung',
    title: 'Thể loại nội dung',
    category: 'content',
    icon: 'fa-solid fa-shapes',
    summary: 'Cấu hình thể loại nội dung (content types) để mở rộng loại bài viết.',
    description: 'Thể loại nội dung (content types) cho phép tạo các loại bài viết với cấu hình trường riêng. Mặc định có bài viết thường (article). Admin có thể thêm loại mới (video, tài liệu, hỏi đáp) với trường tùy chỉnh. Giúp phân biệt nội dung và quy trình xuất bản theo loại.',
    workflow: [
      { title: 'Vào thể loại nội dung', detail: 'Mở /admin/content/content-types', link: '/admin/content/content-types' },
      { title: 'Tạo thể loại mới', detail: 'Bấm "Tạo mới", nhập tên và slug.' },
      { title: 'Cấu hình trường', detail: 'Thêm trường tùy chỉnh (text, textarea, image, select).' },
      { title: 'Lưu', detail: 'Bấm "Lưu". Thể loại mới xuất hiện khi tạo bài viết.' },
    ],
    mermaid: `flowchart LR
    A[Thể loại nội dung] --> B[Tạo mới]
    B --> C[Tên + Slug]
    C --> D[Thêm trường]
    D --> E[Lưu]
    E --> F[Bài viết theo loại]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D,E process
    class F output`,
    links: [
      { label: 'Thể loại nội dung', href: '/admin/content/content-types' },
      { label: 'Bài viết', href: '/admin/content/articles' },
    ],
    aliases: ['content type', 'loại nội dung', 'kiểu bài viết', 'custom post type'],
    keywords: ['the loai', 'content type', 'loai noi dung', 'kieu bai'],
    questions: ['Làm sao tạo loại bài viết mới?', 'Thể loại nội dung là gì?'],
    screenshot: '/assets/docs/the-loai-noi-dung.png',
  },
]
