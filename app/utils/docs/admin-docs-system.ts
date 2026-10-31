import type { AdminDoc } from './types'

/**
 * Category: system — 14 docs about system administration, security, settings.
 * Split into this file + admin-docs-system-2.ts if this approaches 400 lines.
 */
export const SYSTEM_DOCS: AdminDoc[] = [
  {
    slug: 'nguoi-dung-phan-quyen',
    title: 'Người dùng & Phân quyền',
    category: 'system',
    icon: 'fa-solid fa-users-gear',
    summary: 'Quản lý tài khoản admin, vai trò, phân quyền RBAC theo resource.',
    description: 'Hệ thống phân quyền RBAC (Role-Based Access Control) cho phép tạo vai trò với quyền theo resource (read/write). Mỗi admin thuộc vai trò, có quyền trên resource cụ thể. Mọi handler qua requireResourcePermission(event, resource, action). resource: users, settings, readers, comments, articles, pages, media, chatbot. clients... Admin mặc định có tất cả quyền.',
    workflow: [
      { title: 'Vào quản lý người dùng', detail: 'Mở /admin/users', link: '/admin/users' },
      { title: 'Tạo thêm người dùng', detail: 'Hoặc gán người vào vai trò đã có.' },
      { title: 'Tạo vai trò mới', detail: 'Mở /admin/users/roles, tạo vai trò, gán quyền theo resource.', link: '/admin/users/roles' },
      { title: 'Gán người vào vai trò', detail: 'Chỉnh người dùng, gán vai trò phù hợp.' },
    ],
    mermaid: `flowchart TD
    A[Admin] --> B[Vai trò]
    B --> C[Phân quyền]
    C --> D[Resource: read/write]
    D --> E[users/settings/readers]
    D --> F[comments/articles/pages]
    D --> G[media/chatbot]
    E --> H[requireResourcePermission]
    F --> H
    G --> H
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D process
    class E,F,G data
    class H output`,
    links: [
      { label: 'Quản lý người dùng', href: '/admin/users' },
      { label: 'Vai trò & Phân quyền', href: '/admin/users/roles' },
    ],
    aliases: ['rbac', 'role based access', 'quản lý user', 'vai trò admin', 'phân quyền user'],
    keywords: ['nguoi dung', 'phan quyen', 'rbac', 'role', 'vai tro', 'quyen', 'permission', 'users'],
    questions: ['Làm sao tạo người dùng mới?', 'Làm sao phân quyền cho người dùng?', 'Vai trò là gì?', 'Làm sao cấp quyền đọc?'],
    screenshot: '/assets/docs/nguoi-dung-phan-quyen.png',
  },
  {
    slug: 'lich-su-hoat-dong',
    title: 'Lịch sử hoạt động',
    category: 'system',
    icon: 'fa-solid fa-clock-rotate-left',
    summary: 'Xem log hoạt động của mọi admin — thao tác tạo, sửa, xóa, đăng nhập.',
    description: 'Lịch sử hoạt động (activity_logs) ghi lại mọi thao tác admin: đăng nhập, tạo/sửa/xóa bài viết, trang, người dùng, cài đặt. Admin có quyền users.read xem được log của mọi người. leftJoin giữ log của user đã xóa. Log ghi trong cùng transaction với thao tác (audit trail).',
    workflow: [
      { title: 'Vào lịch sử hoạt động', detail: 'Mở /admin/users/activity', link: '/admin/users/activity' },
      { title: 'Lọc log', detail: 'Lọc theo người dùng, loại thao tác, khoảng thời gian.' },
      { title: 'Xem chi tiết', detail: 'Bấm vào log để xem thông tin chi tiết thao tác.' },
    ],
    mermaid: `flowchart LR
    A[Admin thao tác] --> B[Ghi activity_log]
    B --> C[Trong transaction]
    C --> D[Lịch sử hoạt động]
    D --> E[Admin xem]
    E --> F[Lọc theo user/thao tác]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,E,F process
    class D data`,
    links: [
      { label: 'Lịch sử hoạt động', href: '/admin/users/activity' },
    ],
    aliases: ['activity log', 'audit log', 'nhật ký hoạt động', 'log admin'],
    keywords: ['lich su', 'activity', 'log', 'audit', 'thao tac', 'nhat ky'],
    questions: ['Làm sao xem lịch sử?', 'Tại sao không thấy log?', 'Lịch sử hoạt động ở đâu?'],
    screenshot: '/assets/docs/lich-su-hoat-dong.png',
  },
  {
    slug: 'cau-hinh-email',
    title: 'Cấu hình Email (SMTP)',
    category: 'system',
    icon: 'fa-solid fa-envelope',
    summary: 'Cấu hình máy chủ SMTP để gửi email thông báo, đặt lại mật khẩu.',
    description: 'Cấu hình Email SMTP cho phép cổng gửi email tự động: thông báo đơn đăng ký, bình luận mới, đặt lại mật khẩu. Admin cấu hình host, port, username, password, địa chỉ gửi. Email gửi qua Nodemailer. Cần kiểm tra kết nối trước khi dùng.',
    workflow: [
      { title: 'Vào cấu hình email', detail: 'Mở /admin/settings/email', link: '/admin/settings/email' },
      { title: 'Nhập SMTP', detail: 'Host, port, username, password, from email.' },
      { title: 'Test gửi', detail: 'Bấm "Test" để gửi email thử.' },
      { title: 'Lưu', detail: 'Bấm "Lưu". Hệ thống dùng SMTP cho mọi email tự động.' },
    ],
    mermaid: `flowchart LR
    A[Cấu hình SMTP] --> B[Host + Port + Auth]
    B --> C[Test gửi]
    C --> D{OK?}
    D -->|Có| E[Lưu]
    D -->|Không| F[Báo lỗi]
    E --> G[Gửi email tự động]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,E process
    class D decision
    class F,G output`,
    links: [
      { label: 'Cấu hình Email', href: '/admin/settings/email' },
    ],
    aliases: ['smtp', 'email server', 'mail server', 'cấu hình mail', 'gửi email'],
    keywords: ['email', 'smtp', 'mail', 'server', 'nodemailer', 'host', 'port'],
    questions: ['Làm sao cấu hình email?', 'Tại sao không gửi được email?', 'SMTP ở đâu?'],
    screenshot: '/assets/docs/cau-hinh-email.png',
  },
  {
    slug: 'tracking-marketing',
    title: 'Tracking & Marketing',
    category: 'system',
    icon: 'fa-solid fa-chart-simple',
    summary: 'Cấu hình tracking pixels (Facebook Pixel, Google Analytics, Meta).',
    description: 'Tracking & Marketing cho phép tích hợp Facebook Pixel, Google Analytics, Meta Pixel để theo dõi lượt xem, sự kiện. Admin nhập pixel ID/script, hệ thống tự nhúng vào mọi trang công khai. Giúp đo lường hiệu quả marketing và hành vi người dùng.',
    workflow: [
      { title: 'Vào tracking', detail: 'Mở /admin/settings/tracking', link: '/admin/settings/tracking' },
      { title: 'Nhập pixel ID', detail: 'Facebook Pixel ID, Google Analytics ID.' },
      { title: 'Lưu', detail: 'Bấm "Lưu". Script tự nhúng vào trang công khai.' },
      { title: 'Kiểm tra', detail: 'Dùng Facebook Pixel Helper hoặc Google Tag Assistant để kiểm tra.' },
    ],
    mermaid: `flowchart LR
    A[Cài đặt tracking] --> B[Nhập Pixel ID]
    B --> C[Lưu]
    C --> D[Nhúng script trang công khai]
    D --> E[Theo dõi lượt xem/sự kiện]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D process
    class E output`,
    links: [
      { label: 'Tracking & Marketing', href: '/admin/settings/tracking' },
    ],
    aliases: ['facebook pixel', 'google analytics', 'marketing', 'tracking pixel', 'meta pixel'],
    keywords: ['tracking', 'marketing', 'pixel', 'analytics', 'facebook', 'google'],
    questions: ['Làm sao thêm Facebook Pixel?', 'Tại sao Google Analytics không chạy?', 'Tracking ở đâu?'],
    screenshot: '/assets/docs/tracking-marketing.png',
  },
  {
    slug: 'tu-dong-don-du-lieu',
    title: 'Tự động dọn dữ liệu',
    category: 'system',
    icon: 'fa-solid fa-broom',
    summary: 'Cấu hình dọn dữ liệu tự động theo tuổi và số lượng — 4 phạm vi.',
    description: 'Tự động dọn dữ liệu (data retention) cho phép cấu hình xóa dữ liệu cũ theo tuổi (ngày) và số lượng tối đa. 4 phạm vi: activity_logs, submissions, chat_sessions, reader_accounts. Mỗi bảng già theo cột riêng (created_at vs last_seen_at vs last_message_at). Scheduler chạy trong tiến trình (tick 15 phút), 2 điều kiện (tuổi + cap), dọn theo thứ tự ưu tiên.',
    workflow: [
      { title: 'Vào cài đặt retention', detail: 'Mở /admin/settings/data-retention', link: '/admin/settings/data-retention' },
      { title: 'Chọn phạm vi', detail: 'Cấu hình cho từng scope: activity_logs, submissions, chat_sessions, reader_accounts.' },
      { title: 'Đặt tuổi & cap', detail: 'Số ngày tối đa + số bản ghi tối đa.' },
      { title: 'Lưu', detail: 'Bấm "Lưu". Scheduler tự chạy tick 15 phút.' },
    ],
    mermaid: `flowchart TD
    A[Data Retention] --> B[4 scopes]
    B --> C[activity_logs]
    B --> D[submissions]
    B --> E[chat_sessions]
    B --> F[reader_accounts]
    C --> G[Tuổi + Cap]
    D --> G
    E --> G
    F --> G
    G --> H[Scheduler 15p]
    H --> I[Xóa dữ liệu cũ]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,G,H process
    class C,D,E,F data
    class I output`,
    links: [
      { label: 'Tự động dọn dữ liệu', href: '/admin/settings/data-retention' },
    ],
    aliases: ['data retention', 'dọn dẹp dữ liệu', 'xóa dữ liệu cũ', 'retention policy', 'auto cleanup'],
    keywords: ['don du lieu', 'retention', 'cleanup', 'xoa cu', 'retention policy', 'scheduler'],
    questions: ['Làm sao xóa log cũ?', 'Tự động dọn dữ liệu ở đâu?', 'Tại sao log không tự xóa?'],
    screenshot: '/assets/docs/tu-dong-don-du-lieu.png',
  },
  {
    slug: 'sitemap',
    title: 'Sitemap',
    category: 'system',
    icon: 'fa-solid fa-sitemap',
    summary: 'Tạo và quản lý sitemap.xml để SEO — danh sách URL công khai.',
    description: 'Sitemap (/sitemap.xml) là danh sách tất cả URL công khai để giúp công cụ tìm kiếm (Google, Bing) index. Hệ thống tự sinh sitemap từ bài viết đã xuất bản, trang, chuyên mục. Admin có thể cấu hình tần suất cập nhật và priority.',
    workflow: [
      { title: 'Vào cài đặt sitemap', detail: 'Mở /admin/settings/sitemap', link: '/admin/settings/sitemap' },
      { title: 'Cấu hình priority', detail: 'Đặt priority cho từng loại trang (home, article, category).' },
      { title: 'Tạo/làm mới', detail: 'Bấm "Tạo sitemap" để sinh lại.' },
      { title: 'Kiểm tra', detail: 'Vào /sitemap.xml để xem kết quả.' },
    ],
    mermaid: `flowchart LR
    A[Cài đặt sitemap] --> B[Cấu hình priority]
    B --> C[Tạo sitemap.xml]
    C --> D[/sitemap.xml]
    D --> E[Google Index]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C process
    class D,E output`,
    links: [
      { label: 'Sitemap', href: '/admin/settings/sitemap' },
      { label: 'Sitemap XML', href: '/sitemap.xml' },
    ],
    aliases: ['sitemap xml', 'seo sitemap', 'google sitemap', 'danh sách url'],
    keywords: ['sitemap', 'xml', 'seo', 'url', 'index', 'google', 'bing'],
    questions: ['Làm sao tạo sitemap?', 'Sitemap ở đâu?', 'Tại sao Google không index?'],
    screenshot: '/assets/docs/sitemap.png',
  },
  {
    slug: 'dang-nhap-google',
    title: 'Đăng nhập Google (OAuth)',
    category: 'system',
    icon: 'fa-solid fa-right-to-bracket',
    summary: 'Cấu hình Google OAuth cho người đọc và admin đăng nhập bằng Google.',
    description: 'Google OAuth cho phép người đọc đăng nhập bằng tài khoản Google để bình luận, gửi đơn. 2 rào bảo mật: stage:reader (MFA stage cho reader) và HKDF cdkt-reader-session:v1 (separate JWT). Redirect URI suy từ request host, PUBLIC_BASE_URL chỉ tham khảo. sub là khóa. Multi-domain: redirect URI + link email suy ra từ request host. Google OAuth secret mã hóa bằng CHATBOT_ENCRYPTION_SECRET.',
    workflow: [
      { title: 'Tạo Google OAuth Client', detail: 'Vào Google Cloud Console, tạo OAuth 2.0 Client ID.' },
      { title: 'Cấu hình redirect URI', detail: 'Thêm redirect URI cho domain (suy từ request host).' },
      { title: 'Vào cài đặt Google OAuth', detail: 'Mở /admin/settings/google-oauth', link: '/admin/settings/google-oauth' },
      { title: 'Nhập Client ID + Secret', detail: 'Secret mã hóa bằng CHATBOT_ENCRYPTION_SECRET.' },
      { title: 'Lưu & kiểm tra', detail: 'Bấm "Lưu", test đăng nhập Google ở trang công khai.' },
    ],
    mermaid: `flowchart LR
    A[Google Cloud Console] --> B[OAuth Client ID]
    B --> C[Redirect URI]
    C --> D[Admin cấu hình]
    D --> E[Client ID + Secret mã hóa]
    E --> F[Người đọc đăng nhập]
    F --> G[stage:reader + HKDF JWT]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D,E,F process
    class G output`,
    links: [
      { label: 'Đăng nhập Google', href: '/admin/settings/google-oauth' },
    ],
    aliases: ['google oauth', 'google sign in', 'đăng nhập google reader', 'oauth2 google'],
    keywords: ['google', 'oauth', 'dang nhap', 'sign in', 'client id', 'secret', 'reader'],
    questions: ['Làm sao bật đăng nhập Google?', 'Tại sao Google OAuth lỗi?', 'OAuth redirect ở đâu?'],
    screenshot: '/assets/docs/dang-nhap-google.png',
  },
  {
    slug: 'chan-dia-chi-ip',
    title: 'Chặn địa chỉ IP',
    category: 'system',
    icon: 'fa-solid fa-ban',
    summary: 'Chặn IP độc hại — ngăn truy cập từ địa chỉ IP cụ thể.',
    description: 'Chặn địa chỉ IP cho phép admin chặn IP độc hại, spam, bot. 2 điểm chặn: API và reader. Admin thêm IP/CIDR vào danh sách chặn. get-ClientIp(event) đọc IP sau proxy (TRUSTED_PROXY_IPS). Dải CIDR IPv4 từ /8 đến /32 (rộng hơn /8 bị từ chối khi lưu); IPv6 chỉ nhận địa chỉ đầy đủ, không nhận dải.',
    workflow: [
      { title: 'Vào chặn IP', detail: 'Mở /admin/settings/ip-bans', link: '/admin/settings/ip-bans' },
      { title: 'Thêm IP/CIDR', detail: 'Nhập địa chỉ IP hoặc CIDR IPv4 từ /8 đến /32 (vd: 192.168.1.0/24).' },
      { title: 'Lý do', detail: 'Nhập lý do chặn (audit trail).' },
      { title: 'Lưu', detail: 'Bấm "Thêm". IP bị chặn ngay từ request tiếp theo.' },
    ],
    mermaid: `flowchart LR
    A[Admin thêm IP] --> B[Danh sách chặn]
    B --> C[Request mới]
    C --> D{IP bị chặn?}
    D -->|Có| E[Từ chối 403]
    D -->|Không| F[Phục vụ]
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
      { label: 'Chặn địa chỉ IP', href: '/admin/settings/ip-bans' },
    ],
    aliases: ['ip ban', 'block ip', 'chặn ip', 'ipblock', 'blacklist ip'],
    keywords: ['chan', 'ip', 'ban', 'block', 'blacklist', 'cidr', 'proxy'],
    questions: ['Làm sao chặn IP?', 'Tại sao IP bị chặn?', 'Chặn IP ở đâu?'],
    screenshot: '/assets/docs/chan-dia-chi-ip.png',
  },
  {
    slug: 'ngon-ngu-ban-dich',
    title: 'Ngôn ngữ & Bản dịch',
    category: 'system',
    icon: 'fa-solid fa-language',
    summary: 'Quản lý ngôn ngữ và bản dịch — 567 keys, tất cả ngôn ngữ fetch DB.',
    description: 'Hệ thống i18n 567 keys trong seed, 405 fallback hardcoded vi. Tất cả ngôn ngữ kể cả vi fetch DB. Admin /admin/languages sửa mọi lang. 50+ file public đã dùng t(). hardcodedDictionary chỉ fallback khi DB chưa seed/SSR. useI18n composable quản lý ngôn ngữ hiện tại và lazy load bản dịch.',
    workflow: [
      { title: 'Vào quản lý ngôn ngữ', detail: 'Mở /admin/languages', link: '/admin/languages' },
      { title: 'Chọn ngôn ngữ', detail: 'Chọn ngôn ngữ cần dịch (vd: en, fr, zh).' },
      { title: 'Dịch keys', detail: 'Dịch từng key sang ngôn ngữ đã chọn.' },
      { title: 'Lưu', detail: 'Bấm "Lưu". Bản dịch áp dụng ngay cho trang công khai.' },
    ],
    mermaid: `flowchart LR
    A[Admin Languages] --> B[Chọn ngôn ngữ]
    B --> C[Dịch 567 keys]
    C --> D[Lưu DB]
    D --> E[Frontend fetch DB]
    E --> F[Hiển thị đúng lang]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,E process
    class D data
    class F output`,
    links: [
      { label: 'Ngôn ngữ & Bản dịch', href: '/admin/languages' },
    ],
    aliases: ['i18n', 'translations', 'đa ngôn ngữ', 'multilingual', 'bản dịch'],
    keywords: ['ngon ngu', 'ban dich', 'i18n', 'translation', 'language', 'multilingual'],
    questions: ['Làm sao thêm ngôn ngữ?', 'Tại sao bản dịch không hiện?', 'Ngôn ngữ ở đâu?'],
    screenshot: '/assets/docs/ngon-ngu-ban-dich.png',
  },
  {
    slug: 'mang-xa-hoi',
    title: 'Mạng xã hội',
    category: 'system',
    icon: 'fa-solid fa-share-nodes',
    summary: 'Cấu hình liên kết mạng xã hội — Facebook, YouTube, Zalo hiển thị ở footer.',
    description: 'Cấu hình mạng xã hội cho phép admin thêm link Facebook, YouTube, Zalo, TikTok hiển thị ở footer và top bar công khai. Mỗi link có label, icon, URL. openNewTab cho link ngoài. Nav config allowlist kiểm soát.',
    workflow: [
      { title: 'Vào mạng xã hội', detail: 'Mở /admin/settings/social-links', link: '/admin/settings/social-links' },
      { title: 'Thêm link', detail: 'Nhập label, URL cho từng mạng xã hội.' },
      { title: 'Bật openNewTab', detail: 'Link ngoài mở tab mới.' },
      { title: 'Lưu', detail: 'Bấm "Lưu". Link hiển thị ở footer/top bar công khai.' },
    ],
    mermaid: `flowchart LR
    A[Admin cấu hình] --> B[Facebook/YouTube/Zalo]
    B --> C[Lưu]
    C --> D[Footer công khai]
    C --> E[Top bar công khai]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C process
    class D,E output`,
    links: [
      { label: 'Mạng xã hội', href: '/admin/settings/social-links' },
    ],
    aliases: ['social links', 'facebook link', 'youtube link', 'mạng xã hội footer'],
    keywords: ['mang xa hoi', 'social', 'facebook', 'youtube', 'zalo', 'link'],
    questions: ['Làm sao thêm link Facebook?', 'Mạng xã hội ở đâu?', 'Tại sao icon không hiện?'],
    screenshot: '/assets/docs/mang-xa-hoi.png',
  },
  {
    slug: 'luu-tru-media-r2',
    title: 'Lưu trữ Media (R2)',
    category: 'system',
    icon: 'fa-solid fa-cloud-arrow-up',
    summary: 'Cấu hình Cloudflare R2 (S3 SDK) để lưu media trên CDN.',
    description: 'Lưu trữ Media R2 cho phép đồng bộ file media lên Cloudflare R2 (S3 SDK). File lưu local + R2, phục vụ qua CDN. Admin cấu hình R2 credentials (endpoint, access key, secret key, bucket). Sharp xử lý ảnh trước khi upload. Giảm tải server, tăng tốc tải ảnh.',
    workflow: [
      { title: 'Tạo R2 bucket', detail: 'Vào Cloudflare Dashboard, tạo R2 bucket.' },
      { title: 'Lấy credentials', detail: 'Tạo API token: endpoint, access key, secret key.' },
      { title: 'Vào cấu hình R2', detail: 'Mở /admin/settings/media-storage', link: '/admin/settings/media-storage' },
      { title: 'Nhập credentials', detail: 'Endpoint, access key, secret key, bucket name.' },
      { title: 'Lưu & kiểm tra', detail: 'Bấm "Lưu và Test" để upload thử file.' },
    ],
    mermaid: `flowchart LR
    A[Admin upload] --> B[Sharp optimize]
    B --> C[Lưu local /uploads]
    C --> D[Đồng bộ R2 S3]
    D --> E[CDN URL]
    E --> F[Trang công khai]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,D,E process
    class C data
    class F output`,
    links: [
      { label: 'Lưu trữ Media (R2)', href: '/admin/settings/media-storage' },
      { label: 'Thư viện Media', href: '/admin/media' },
    ],
    aliases: ['r2 storage', 'cloudflare r2', 's3 storage', 'cdn media', 'media storage'],
    keywords: ['luu tru', 'r2', 'cloudflare', 's3', 'cdn', 'media storage', 'bucket'],
    questions: ['Làm sao cấu hình R2?', 'Tại sao ảnh không lên CDN?', 'R2 ở đâu?'],
    screenshot: '/assets/docs/luu-tru-media-r2.png',
  },
  {
    slug: 'sao-luu-khoi-phuc',
    title: 'Sao lưu & Khôi phục',
    category: 'system',
    icon: 'fa-solid fa-floppy-disk',
    summary: 'Sao lưu database (mysqldump) và khôi phục — dump, verify, xoay vòng.',
    description: 'Sao lưu & Khôi phục (backup) cho phép admin sao lưu database ra file .sql. Script backup-db.sh: dump → verify → xoay vòng (giữ N bản gần nhất). Bản hỏng bị xóa tự động. Khôi phục bằng cách import file .sql. backup Google Drive 2 mode (OAuth + Service Account).',
    workflow: [
      { title: 'Vào sao lưu', detail: 'Mở /admin/settings/backup', link: '/admin/settings/backup' },
      { title: 'Sao lưu ngay', detail: 'Bấm "Sao lưu ngay" để tạo bản backup.' },
      { title: 'Xem danh sách backup', detail: 'Xem các bản backup đã tạo, kích thước, thời gian.' },
      { title: 'Khôi phục', detail: 'Chọn bản backup, bấm "Khôi phục" (cần xác nhận).' },
      { title: 'Backup Google Drive (tùy chọn)', detail: 'Cấu hình OAuth hoặc Service Account để backup lên Drive.' },
    ],
    mermaid: `flowchart LR
    A[Sao lưu] --> B[mysqldump]
    B --> C[Verify]
    C --> D{OK?}
    D -->|Có| E[Lưu + xoay vòng]
    D -->|Không| F[Xóa bản hỏng]
    E --> G[Google Drive]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,E process
    class D decision
    class F,G output`,
    links: [
      { label: 'Sao lưu & Khôi phục', href: '/admin/settings/backup' },
    ],
    aliases: ['backup', 'restore', 'sao lưu database', 'khôi phục database', 'database dump'],
    keywords: ['sao luu', 'khoi phuc', 'backup', 'restore', 'database', 'dump', 'drive'],
    questions: ['Backup ở đâu?', 'Làm sao khôi phục dữ liệu?', 'Tại sao backup lỗi?'],
    screenshot: '/assets/docs/sao-luu-khoi-phuc.png',
  },
  {
    slug: 'tai-khoan-ca-nhan',
    title: 'Tài khoản cá nhân',
    category: 'system',
    icon: 'fa-solid fa-user-gear',
    summary: 'Quản lý tài khoản cá nhân — đổi mật khẩu, MFA, mã dự phòng.',
    description: 'Tài khoản cá nhân (/admin/profile) cho phép admin đổi mật khẩu, bật MFA (3 yếu tố: totp, email_otp, second_password), xem mã dự phòng, xem lịch sử đăng nhập. MFA vé cdkt_mfa (5 phút) tách vé session cdkt_admin. Mã dự phòng bcrypt dùng 1 lần. Runbook xoay JWT_SECRET: HKDF cdkt-mfa-totp:v1 → TOTP vô hiệu, lùi yếu tố khác.',
    workflow: [
      { title: 'Vào tài khoản cá nhân', detail: 'Mở /admin/profile', link: '/admin/profile' },
      { title: 'Đổi mật khẩu', detail: 'Nhập mật khẩu cũ + mới (≥12 ký tự, 3/4 nhóm).' },
      { title: 'Bật MFA', detail: 'Chọn yếu tố: TOTP, Email OTP, Second Password.' },
      { title: 'Lưu mã dự phòng', detail: 'Lưu mã dự phòng (1 lần dùng) ở nơi an toàn.' },
      { title: 'Xem lịch sử', detail: 'Xem lịch sử đăng nhập và hoạt động gần đây.' },
    ],
    mermaid: `flowchart TD
    A[Profile] --> B[Đổi mật khẩu]
    A --> C[Bật MFA]
    C --> D[TOTP]
    C --> E[Email OTP]
    C --> F[Second Password]
    D --> G[Mã dự phòng]
    E --> G
    F --> G
    A --> H[Lịch sử đăng nhập]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,C,D,E,F,G,H process`,
    links: [
      { label: 'Tài khoản cá nhân', href: '/admin/profile' },
    ],
    aliases: ['profile', 'đổi mật khẩu admin', 'mfa admin', 'two factor admin', 'tài khoản của tôi'],
    keywords: ['tai khoan', 'profile', 'mat khau', 'mfa', 'totp', 'otp', 'recovery', 'two factor'],
    questions: ['Làm sao đổi mật khẩu?', 'Làm sao bật MFA?', 'Mã dự phòng ở đâu?', 'Tài khoản cá nhân ở đâu?'],
    screenshot: '/assets/docs/tai-khoan-ca-nhan.png',
  },
  {
    slug: 'thong-ke-truy-cap',
    title: 'Thống kê truy cập',
    category: 'system',
    icon: 'fa-solid fa-chart-line',
    summary: 'Xem thống kê truy cập cổng — lượt xem, khách duy nhất, trang phổ biến.',
    description: 'Thống kê truy cập (analytics) ghi lượt xem trang, khách duy nhất (daily), trang phổ biến, nguồn truy cập. Admin xem biểu đồ đường (xu hướng theo ngày), bảng top trang, top nguồn. NOC dashboard .client cho realtime. Scheduler gộp dữ liệu tick 15 phút, khóa cdkt:analytics:maintenance. So ngày theo giờ địa phương (UTC+7).',
    workflow: [
      { title: 'Vào thống kê', detail: 'Mở /admin (dashboard) hoặc trang analytics.', link: '/admin' },
      { title: 'Xem tổng quan', detail: 'Thẻ thống kê: tổng lượt xem, khách duy nhất, bài viết, bình luận.' },
      { title: 'Xem biểu đồ', detail: 'Biểu đồ đường xu hướng theo ngày (lượt xem + khách duy nhất).' },
      { title: 'Xem chi tiết', detail: 'Bảng top trang, top nguồn truy cập.' },
    ],
    mermaid: `flowchart LR
    A[Trang công khai] --> B[Ghi lượt xem]
    B --> C[analytics DB]
    C --> D[Scheduler 15p]
    D --> E[Gộp dữ liệu]
    E --> F[Dashboard admin]
    F --> G[Biểu đồ + Bảng]
    classDef input fill:#0d1f11,stroke:#1e4620,color:#f0f7f1,stroke-width:2px
    classDef process fill:#1e4620,stroke:#0d1f11,color:#f0f7f1,stroke-width:2px
    classDef output fill:#8ed694,stroke:#1e4620,color:#0d1f11,stroke-width:2px
    classDef decision fill:#e2ede3,stroke:#1e4620,color:#122815,stroke-width:2px
    classDef data fill:#f0f7f1,stroke:#2c6e33,color:#122815,stroke-width:2px
    class A input
    class B,D,E,F process
    class C data
    class G output`,
    links: [
      { label: 'Dashboard', href: '/admin' },
    ],
    aliases: ['analytics', 'thống kê', 'lượt xem', 'page views', 'traffic', 'dashboard'],
    keywords: ['thong ke', 'truy cap', 'analytics', 'luot xem', 'page view', 'traffic', 'dashboard'],
    questions: ['Tại sao thống kê không cập nhật?', 'Thống kê truy cập ở đâu?', 'Làm sao xem lượt xem bài viết?'],
    screenshot: '/assets/docs/thong-ke-truy-cap.png',
  },
]
