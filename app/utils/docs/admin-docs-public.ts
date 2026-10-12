import type { AdminDoc } from './types'

/**
 * Category: public — 8 docs about public-facing pages and features.
 */
export const PUBLIC_DOCS: AdminDoc[] = [
  {
    slug: 'trang-chu-blocks',
    title: 'Trang chủ & Khối block',
    category: 'public',
    icon: 'fa-solid fa-house',
    summary: 'Cách trang chủ hoạt động — blocks hiển thị hero, tin mới, tấm gương, mô hình tái hòa nhập.',
    description: 'Trang chủ là trang đầu tiên người dùng thấy. Nội dung được xây bằng Page Builder với các khối: hero banner (ảnh bìa + tiêu đề), khối tin mới nhất (lấy bài viết mới), khối tấm gương hoàn lương, khối mô hình tái hòa nhập, khối thống kê, đồng hồ đếm ngược, CTA. Trang chủ là trang hệ thống (isSystem=true, slug "home" khóa). routeRules swr:60 cho trang chủ.',
    workflow: [
      { title: 'Vào quản lý trang', detail: 'Mở /admin/content/pages', link: '/admin/content/pages' },
      { title: 'Chỉnh trang home', detail: 'Tìm trang "home" (isSystem), bấm chỉnh sửa.' },
      { title: 'Kéo/thay đổi khối', detail: 'Dùng Page Builder để thêm/xóa/sửa khối (hero, news-list, role-models, stats...).' },
      { title: 'Cấu hình khối', detail: 'Bấm vào khối để chỉnh nội dung, ảnh, link.' },
      { title: 'Lưu', detail: 'Bấm "Lưu trang". SWR 60s nên thay đổi áp dụng trong 1 phút.' },
    ],
    mermaid: `flowchart TD
    A[Trang chủ] --> B[Hero Banner]
    A --> C[Khối tin mới]
    A --> D[Khối tấm gương]
    A --> E[Khối tái hòa nhập]
    A --> F[Khối thống kê]
    A --> G[CTA / Footer]
    B --> H[Page Builder]
    C --> H
    D --> H
    E --> H
    F --> H
    G --> H
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D,E,F,G process
    class H output`,
    links: [
      { label: 'Quản lý trang', href: '/admin/content/pages' },
    ],
    aliases: ['home page', 'trang đầu', 'blocks trang chủ', 'hero banner', 'khối trang chủ'],
    keywords: ['trang chu', 'home', 'block', 'khoi', 'hero', 'page builder', 'swr'],
    questions: ['Làm sao đổi ảnh bìa trang chủ?', 'Làm sao đổi khối trên trang chủ?', 'Tại sao trang chủ không cập nhật?'],
    screenshot: '/assets/docs/trang-chu-blocks.png',
  },
  {
    slug: 'ban-tin',
    title: 'Bản tin',
    category: 'public',
    icon: 'fa-solid fa-newspaper',
    summary: 'Trang danh sách bản tin công khai — lưới bài viết theo chuyên mục, phân trang.',
    description: 'Trang bản tin (/news) hiển thị tất cả bài viết đã xuất bản dưới dạng lưới. Người đọc có thể lọc theo chuyên mục, tìm kiếm. Mỗi bài viết hiển thị ảnh bìa, tiêu đề, tóm tắt, ngày đăng. Phân trang tự động. routeRules swr:60 cho danh sách. Bài viết có thể xem chi tiết tại /news/[slug].',
    workflow: [
      { title: 'Tạo bài viết', detail: 'Mở /admin/content/articles và tạo bài mới.', link: '/admin/content/articles' },
      { title: 'Chọn chuyên mục', detail: 'Gán bài vào chuyên mục để hiển thị ở /news/[category].' },
      { title: 'Xuất bản', detail: 'Đặt trạng thái "xuất bản" để bài hiển thị công khai.' },
      { title: 'Kiểm tra trang công khai', detail: 'Vào /news để xem bài xuất hiện. SWR 60s.' },
    ],
    mermaid: `flowchart LR
    A[Admin tạo bài] --> B[Chọn chuyên mục]
    B --> C[Xuất bản]
    C --> D[/news - danh sách]
    C --> E[/news/slug - chi tiết]
    D --> F[SWR 60s]
    E --> F
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,F process
    class D,E output`,
    links: [
      { label: 'Trang bản tin công khai', href: '/news' },
      { label: 'Quản lý bài viết', href: '/admin/content/articles' },
    ],
    aliases: ['news list', 'danh sách bản tin', 'trang tin', 'trang news', 'public news'],
    keywords: ['ban tin', 'news', 'danh sach', 'bai viet cong khai', 'xuat ban'],
    questions: ['Tại sao bài viết không có trên trang tin?', 'Làm sao đổi chuyên mục bài viết?', 'Trang tin ở đâu?'],
    screenshot: '/assets/docs/ban-tin.png',
  },
  {
    slug: 'tam-guong',
    title: 'Tấm gương hoàn lương',
    category: 'public',
    icon: 'fa-solid fa-person-rays',
    summary: 'Trang tấm gương — hồ sơ những người hoàn lương tái hòa nhập cộng đồng.',
    description: 'Trang tấm gương (/role-models) hiển thị hồ sơ những người đã hoàn lương và tái hòa nhập cộng đồng thành công. Mỗi hồ sơ có ảnh, tên, câu chuyện, nghề nghiệp. Admin quản lý qua bài viết gắn chuyên mục "tấm gương". Giúp lan tỏa thông điệp hướng thiện và tạo niềm tin cho cộng đồng.',
    workflow: [
      { title: 'Tạo bài viết tấm gương', detail: 'Mở /admin/content/articles và tạo bài mới.', link: '/admin/content/articles' },
      { title: 'Chọn chuyên mục tấm gương', detail: 'Gán vào chuyên mục "tấm gương hoàn lương".' },
      { title: 'Thêm thông tin', detail: 'Nhập tên, ảnh, câu chuyện, nghề nghiệp của người hoàn lương.' },
      { title: 'Xuất bản', detail: 'Đặt trạng thái "xuất bản" để hiển thị ở /role-models.' },
    ],
    mermaid: `flowchart LR
    A[Admin tạo bài] --> B[Chuyên mục tấm gương]
    B --> C[Nhập thông tin]
    C --> D[Xuất bản]
    D --> E[/role-models công khai]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D process
    class E output`,
    links: [
      { label: 'Trang tấm gương', href: '/role-models' },
      { label: 'Quản lý bài viết', href: '/admin/content/articles' },
    ],
    aliases: ['role models', 'tấm gương', 'hoàn lương', 'hồ sơ hoàn lương', 'gương sáng'],
    keywords: ['tam guong', 'role model', 'hoan luong', 'tai hoa nhap', 'guong sang'],
    questions: ['Làm sao thêm tấm gương mới?', 'Tấm gương hiển thị ở đâu?', 'Làm sao đổi ảnh tấm gương?'],
    screenshot: '/assets/docs/tam-guong.png',
  },
  {
    slug: 'mo-hinh-tai-hoa-nhap',
    title: 'Mô hình tái hòa nhập',
    category: 'public',
    icon: 'fa-solid fa-people-group',
    summary: 'Trang mô hình tái hòa nhập — các mô hình cộng đồng hỗ trợ người hoàn lương.',
    description: 'Trang mô hình tái hòa nhập (/reintegration-models) hiển thị các mô hình cộng đồng giúp người hoàn lương tái hòa nhập. Mỗi mô hình có tên, mô tả, địa chỉ áp dụng, kết quả. Admin quản lý qua bài viết gắn chuyên mục "mô hình tái hòa nhập". Giúp người đọc tham khảo và liên hệ hỗ trợ.',
    workflow: [
      { title: 'Tạo bài viết mô hình', detail: 'Mở /admin/content/articles và tạo bài mới.', link: '/admin/content/articles' },
      { title: 'Chọn chuyên mục', detail: 'Gán vào chuyên mục "mô hình tái hòa nhập".' },
      { title: 'Nhập thông tin mô hình', detail: 'Mô tả, địa chỉ, kết quả, ảnh minh họa.' },
      { title: 'Xuất bản', detail: 'Đặt trạng thái "xuất bản" để hiển thị ở /reintegration-models.' },
    ],
    mermaid: `flowchart LR
    A[Admin tạo bài] --> B[Chuyên mục mô hình]
    B --> C[Nhập thông tin]
    C --> D[Xuất bản]
    D --> E[/reintegration-models công khai]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D process
    class E output`,
    links: [
      { label: 'Trang mô hình', href: '/reintegration-models' },
      { label: 'Quản lý bài viết', href: '/admin/content/articles' },
    ],
    aliases: ['reintegration models', 'mô hình cộng đồng', 'tái hòa nhập cộng đồng', 'mô hình hỗ trợ'],
    keywords: ['mo hinh', 'reintegration', 'tai hoa nhap', 'cong dong', 'ho tro'],
    questions: ['Làm sao thêm mô hình mới?', 'Mô hình tái hòa nhập ở đâu?', 'Làm sao sửa mô hình?'],
    screenshot: '/assets/docs/mo-hinh-tai-hoa-nhap.png',
  },
  {
    slug: 'van-ban-phap-luat',
    title: 'Văn bản pháp luật',
    category: 'public',
    icon: 'fa-solid fa-gavel',
    summary: 'Trang văn bản pháp luật — tài liệu pháp lý liên quan tái hòa nhập cộng đồng.',
    description: 'Trang văn bản pháp luật (/documents và /legal-qa) hiển thị tài liệu pháp lý liên quan đến tái hòa nhập cộng đồng. Admin quản lý qua bài viết gắn chuyên mục "văn bản pháp luật" hoặc "hỏi đáp pháp luật". Người đọc có thể tra cứu theo loại văn bản, lĩnh vực.',
    workflow: [
      { title: 'Tạo bài viết pháp luật', detail: 'Mở /admin/content/articles và tạo bài mới.', link: '/admin/content/articles' },
      { title: 'Chọn chuyên mục', detail: 'Gán vào chuyên mục "văn bản pháp luật" hoặc "hỏi đáp pháp luật".' },
      { title: 'Nhập nội dung', detail: 'Số văn bản, cơ quan ban hành, nội dung, lĩnh vực.' },
      { title: 'Xuất bản', detail: 'Đặt trạng thái "xuất bản" để hiển thị ở /documents.' },
    ],
    mermaid: `flowchart LR
    A[Admin tạo bài] --> B[Chuyên mục pháp luật]
    B --> C[Nhập nội dung]
    C --> D[Xuất bản]
    D --> E[/documents công khai]
    D --> F[/legal-qa công khai]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D process
    class E,F output`,
    links: [
      { label: 'Văn bản pháp luật', href: '/documents' },
      { label: 'Hỏi đáp pháp luật', href: '/legal-qa' },
      { label: 'Quản lý bài viết', href: '/admin/content/articles' },
    ],
    aliases: ['legal documents', 'văn bản quy phạm', 'pháp luật', 'hỏi đáp pháp luật', 'tra cứu văn bản'],
    keywords: ['van ban', 'phap luat', 'legal', 'document', 'quy pham', 'hoi dap'],
    questions: ['Làm sao thêm văn bản pháp luật?', 'Văn bản pháp luật ở đâu?', 'Làm sao tra cứu văn bản?'],
    screenshot: '/assets/docs/van-ban-phap-luat.png',
  },
  {
    slug: 'media-portal-cong-khai',
    title: 'Media cổng công khai',
    category: 'public',
    icon: 'fa-solid fa-images',
    summary: 'Thư viện media hiển thị công khai — ảnh hoạt động, video cộng đồng.',
    description: 'Trang media công khai (/media) hiển thị album ảnh và video hoạt động của cơ quan. Admin tải lên qua thư viện media admin, chọn ảnh hiển thị công khai. Hỗ trợ ảnh (qua sharp resize + R2 CDN) và video. NuxtImg sinh WebP + responsive srcset cho ảnh public-side.',
    workflow: [
      { title: 'Tải lên media', detail: 'Mở /admin/media và tải lên ảnh/video.', link: '/admin/media' },
      { title: 'Đánh dấu công khai', detail: 'Chọn ảnh cần hiển thị ở trang /media công khai.' },
      { title: 'Tạo album (tùy chọn)', detail: 'Gom ảnh theo chủ đề hoạt động.' },
      { title: 'Kiểm tra', detail: 'Vào /media để xem danh sách công khai.' },
    ],
    mermaid: `flowchart LR
    A[Admin upload] --> B[Sharp + R2]
    B --> C[Thư viện admin]
    C --> D{Công khai?}
    D -->|Có| E[/media công khai]
    D -->|Không| F[Chỉ admin]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C process
    class D decision
    class E,F output`,
    links: [
      { label: 'Thư viện Media', href: '/admin/media' },
      { label: 'Trang media công khai', href: '/media' },
    ],
    aliases: ['public media', 'thư viện ảnh công khai', 'album portal', 'media gallery'],
    keywords: ['media', 'cong khai', 'public', 'album', 'anh', 'video', 'thu vien'],
    questions: ['Làm sao hiển thị ảnh ở trang media?', 'Tại sao ảnh không hiện công khai?', 'Media công khai ở đâu?'],
    screenshot: '/assets/docs/media-portal-cong-khai.png',
  },
  {
    slug: 'tim-kiem',
    title: 'Tìm kiếm',
    category: 'public',
    icon: 'fa-solid fa-magnifying-glass',
    summary: 'Trang tìm kiếm công khai — người đọc tìm bài viết theo từ khóa.',
    description: 'Trang tìm kiếm (/search) cho phép người đọc tìm bài viết theo từ khóa. Tìm kiếm全文 trên tiêu đề, mô tả và nội dung bài viết đã xuất bản. Hiển thị kết quả dạng list với snippet. Hỗ trợ tìm kiếm theo chuyên mục và ngày đăng. lazy:true cho fetch.',
    workflow: [
      { title: 'Người dùng nhập từ khóa', detail: 'Gõ từ khóa vào ô tìm kiếm ở header hoặc /search.' },
      { title: 'Hệ thống tìm kiếm', detail: 'Tìm trong bài viết đã xuất bản (tiêu đề, mô tả, nội dung).' },
      { title: 'Hiển thị kết quả', detail: 'List kết quả với snippet, ảnh bìa, ngày đăng.' },
      { title: 'Lọc (tùy chọn)', detail: 'Lọc theo chuyên mục, ngày đăng.' },
    ],
    mermaid: `flowchart LR
    A[Người dùng] --> B[Nhập từ khóa]
    B --> C[Tìm bài viết]
    C --> D{Có kết quả?}
    D -->|Có| E[Hiển thị list]
    D -->|Không| F[Không tìm thấy]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C process
    class D decision
    class E,F output`,
    links: [
      { label: 'Trang tìm kiếm', href: '/search' },
    ],
    aliases: ['search', 'tìm bài viết', 'tra cứu bài', 'public search', 'ông tìm kiếm'],
    keywords: ['tim kiem', 'search', 'tu khoa', 'tra cuu', 'bai viet'],
    questions: ['Tại sao không tìm thấy bài viết?', 'Tìm kiếm ở đâu?', 'Làm sao tìm theo chuyên mục?'],
    screenshot: '/assets/docs/tim-kiem.png',
  },
  {
    slug: 'lien-he',
    title: 'Liên hệ',
    category: 'public',
    icon: 'fa-solid fa-address-book',
    summary: 'Trang liên hệ — thông tin cơ quan, form liên hệ, địa chỉ, hotline.',
    description: 'Trang liên hệ (/contact) hiển thị thông tin liên hệ của cơ quan: địa chỉ, hotline, email, Facebook. Có form liên hệ để người đọc gửi câu hỏi/thư góp ý. Thông tin liên hệ được cấu hình ở cài đặt chung (site_name, hotline, email, address, facebook_url).',
    workflow: [
      { title: 'Cấu hình thông tin liên hệ', detail: 'Mở /admin/settings/general và chỉnh hotline, email, địa chỉ.', link: '/admin/settings/general' },
      { title: 'Kiểm tra trang liên hệ', detail: 'Vào /contact để xem thông tin hiển thị công khai.' },
      { title: 'Form liên hệ', detail: 'Người đọc điền form, email gửi tới hòm thư cơ quan.' },
    ],
    mermaid: `flowchart LR
    A[Admin cấu hình] --> B[Hotline + Email + Địa chỉ]
    B --> C[/contact công khai]
    C --> D[Form liên hệ]
    D --> E[Email cơ quan]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,D process
    class C,E output`,
    links: [
      { label: 'Cài đặt chung', href: '/admin/settings/general' },
      { label: 'Trang liên hệ', href: '/contact' },
    ],
    aliases: ['contact', 'liên hệ cơ quan', 'form liên hệ', 'thông tin liên hệ', 'hotline'],
    keywords: ['lien he', 'contact', 'hotline', 'email', 'dia chi', 'form'],
    questions: ['Làm sao đổi hotline?', 'Tại sao form liên hệ không gửi?', 'Thông tin liên hệ ở đâu?'],
    screenshot: '/assets/docs/lien-he.png',
  },
]
