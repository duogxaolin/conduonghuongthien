# Con Đường Hướng Thiện (CDKT) - System Documentation & Changelog

UI/UX work must read `openspec/ui-dna.md` (or the existing DNA doc) before any visual change.

Cổng thông tin điện tử hỗ trợ người hoàn lương tái hòa nhập cộng đồng — Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.

---

## 🛠️ Công Nghệ Sử Dụng (Tech Stack)

- **Frontend**: Nuxt 4 (Vue 3 SFC, TypeScript, Composition API), **Tailwind CSS v4** (via `@tailwindcss/vite`), FontAwesome 6 Pro (local self-hosted).
- **CSS Rule**: **Tất cả code mới phải dùng Tailwind CSS v4 utility classes.** Không viết `<style scoped>` hay CSS tùy chỉnh cho component/page mới. CSS cũ (pre-Tailwind) vẫn giữ nguyên, không xóa — sẽ migrate dần sau.
- **Backend / API**: Nuxt Server Engine (Nitro / H3), Drizzle ORM, MySQL 8.0 / MariaDB, JWT Auth (`cdkt_admin` HTTP-only Cookie).
- **Database**: MySQL 8.0 (Auto DDL init script `server/db/init.ts` và Auto Seed script `server/db/seed.ts`).
- **Media Engine**: Dual-mode Storage (Local server `/public/uploads/YYYY/MM/` & Cloudflare R2 Cloud Storage với AWS S3 SDK & Sharp image optimization).
- **Containerization & Deploy**: Docker, Docker Compose, aaPanel Node.js/PM2 preset.

---

## 📂 Cấu Trúc Thư Mục Trang Web (English Directory Rules)

Toàn bộ thư mục và tập tin giao diện trong `app/pages/` tuân thủ quy tắc đặt tên chuẩn bằng **tiếng Anh**:

```
app/
├── components/
│   ├── SectionBar.vue           # Thanh tiêu đề Section hỗ trợ FontAwesome
│   ├── ToastContainer.vue        # Container hiển thị Toast thông báo toàn hệ thống
│   └── admin/
│       └── MediaLibraryModal.vue # Modal chọn tệp từ Thư viện Media
├── composables/
│   ├── useAdminAuth.ts          # State quản lý xác thực Admin & SSR Cookie forwarding
│   ├── useI18n.ts               # Bộ từ điển Đa ngôn ngữ (VN / EN)
│   └── useToast.ts              # System Toast Notification reactive composable
├── layouts/
│   ├── default.vue              # Layout giao diện Public (Header, Navigation, Footer, Toast)
│   └── admin.vue                # Layout giao diện Admin Panel (Sidebar, Topbar, Toast)
└── pages/
    ├── index.vue                # Trang chủ (Render dynamic các Block từ MySQL)
    ├── about.vue                # Trang Giới thiệu (Cục C11 Bộ Công an)
    ├── contact.vue              # Trang Liên hệ & Đăng ký tư vấn
    ├── news/                    # Tin tức & Bản tin
    │   ├── index.vue
    │   ├── local-news.vue
    │   ├── activity-news.vue
    │   ├── featured-news.vue
    │   └── [id].vue
    ├── reintegration-models/    # Mô hình tái hòa nhập cộng đồng
    │   ├── index.vue
    │   └── [id].vue
    ├── role-models/             # Tấm gương hoàn lương tiêu biểu
    │   ├── index.vue
    │   └── [id].vue
    ├── documents/               # Văn bản quy phạm pháp luật
    │   └── index.vue
    ├── legal-qa/                # Giải đáp pháp luật & Hỏi đáp
    │   └── index.vue
    └── admin/                   # Hệ thống Quản trị Admin Panel
        ├── index.vue            # Dashboard Tổng quan
        ├── login.vue            # Trang Đăng nhập Admin
        ├── content/
        │   ├── home.vue         # WordPress Gutenberg Style Home Block Editor
        │   └── articles/        # Quản lý Bài viết & Tin tức (CRUD)
        ├── media/               # Quản lý Thư viện Media Upload (Local / R2)
        ├── settings/            # Cài đặt chung & Cấu hình Cloudflare R2
        ├── submissions/         # Quản lý Đơn đăng ký tư vấn 24/7
        └── users/               # Quản lý Người dùng Admin & Phân quyền Roles
```

---

## 🔑 Các Tính Năng Đã Hoàn Thành (Work Accomplished)

### 1. Giao diện Người dùng (Public Website)
- **Top Bar & Header**: Hotline (`📞 0903.480.985`), Chuyển đổi ngôn ngữ (`[VN] [EN]`), Điều chỉnh cỡ chữ (`A-`, `A`, `A+`), Nút Hỗ trợ 24/7.
- **Dynamic Home Sections**: Trang chủ tự động tải và hiển thị thứ tự các khối Block (Banner, Tin tức, Tấm gương, Mô hình, Văn bản...) từ MySQL Database.
- **Trợ lý AI Chatbot**: Widget trò chuyện tư vấn hỗ trợ 24/7 trực tuyến.
- **Chuẩn hóa Icon FontAwesome 6**: Tích hợp vector icons đồng bộ trên toàn bộ giao diện public.

### 2. Hệ thống Quản trị Admin Panel (`/admin`)
- **Phân quyền RBAC (Role-Based Access Control)**:
  - Admin có thể tạo các Vai trò (Roles) và thiết lập Ma trận quyền chi tiết (`Create`, `Read`, `Update`, `Delete`) trên từng tài nguyên (`users`, `roles`, `news`, `home_sections`, `media`, `settings`, `submissions`, `documents`, `faq`...).
- **Quản lý Người dùng (User Management - `/admin/users`)**:
  - Modal Chỉnh sửa tài khoản full tính năng: Đổi Email, Đổi Mật khẩu (bcrypt hash), Đổi Vai trò (Role), Khóa / Mở khóa trạng thái tài khoản.
- **WordPress Gutenberg Style Home Editor (`/admin/content/home`)**:
  - Danh sách Block kéo-thả trực quan kèm nút di chuyển `▲ / ▼` và bật/tắt hiển thị `Hiển thị / Đã ẩn`.
  - Drawer Modal Tùy biến Block chia thành 3 Tab:
    1. **Nội dung & Văn bản**: Tiêu đề chính, Subtitle, Đoạn mô tả, Nút bấm CTA, Số lượng bài hiển thị.
    2. **Giao diện & Layout**: Chọn Màu nền (Trắng, Xám nhạt, Xanh lá đậm), Chọn Bố cục (Grid 3 Cột, Grid 4 Cột, Card Nổi), Chọn Ảnh nền trực tiếp từ **Thư viện Media**.
    3. **Live Preview**: Xem trước hình ảnh thực tế của Block ngay trong trình chỉnh sửa.
- **Thư viện Media (`/admin/media`)**:
  - Tải lên hình ảnh với tự động tối ưu dung lượng (Sharp image engine), hỗ trợ cả lưu trữ trên máy chủ cục bộ (`/public/uploads/`) và Cloudflare R2 (S3-compatible).
  - Tích hợp `MediaLibraryModal.vue` giúp chọn ảnh nhanh khi viết bài hoặc sửa Block trang chủ.
- **Hệ thống Toast Notification Toàn Website (`useToast.ts` & `ToastContainer.vue`)**:
  - Thay thế 100% lệnh `alert()` trình duyệt bằng các hộp thông báo Toast Glassmorphic hiện đại, có icon FontAwesome vector và thanh đếm ngược tự động ẩn.
- **Bảo mật Phiên làm việc (Session Persistence)**:
  - Khắc phục triệt me lỗi mất session khi F5 nhờ cơ chế linh hoạt HTTP/HTTPS Cookie (`lax` SameSite) và tự động chuyển tiếp Request Header trong Nuxt SSR (`useRequestHeaders(['cookie'])`).

### 3. Khởi tạo Cơ sở dữ liệu & Docker
- **MySQL Database Auto-Init (`server/db/init.ts`)**: Tự động kết nối server MySQL, tạo database `cdkt_admin` và toàn bộ 8 bảng dữ liệu nếu chưa tồn tại.
- **Database Seed (`server/db/seed.ts`)**: Tự động tạo tài khoản SuperAdmin mặc định (`admin` / `Admin@123456`), các vai trò, bảng phân quyền và dữ liệu thiết lập ban đầu.
- **Docker Compose**: Đóng gói môi trường containerized hoàn chỉnh gồm 2 service `cdkt_mysql` (MySQL 8.0) và `cdkt_app` (Nuxt 4 app) chạy trên cổng `3000`.

---

## 🚀 Hướng Dẫn Deploy (aaPanel / Server)

### 1. Tạo tập tin `.env` trên Server
```env
PORT=3000
NODE_ENV=production

# MySQL Database Connection
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=cdkt_admin

# JWT Secret Key
JWT_SECRET=cdkt_secret_key_change_me_123456

# AI Chatbot Config
AI_API_KEY=sk-xxxx
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

### 2. Khởi tạo Database & Chạy Build
```bash
# Khởi tạo bảng và nạp dữ liệu mặc định (Chỉ làm 1 lần)
npx tsx server/db/init.ts && npx tsx server/db/seed.ts

# Build bản sản xuất
npm run build
```

### 3. Chạy Docker Compose (Hoặc PM2 trên aaPanel)
```bash
docker compose up --build -d
```

---

## 🛡️ Tài Khoản Đăng Nhập Mặc Định

- **URL Admin**: `http://localhost:3000/admin` (hoặc `https://domain-cua-ban.com/admin`)
- **Tài khoản**: `admin`
- **Mật khẩu**: `Admin@123456`

When asked about the codebase, project structure, or to find code, always use the context-engine MCP tool (codebase-retrieval) in the root workspace first before reading individual files. Use `codebase-retrieval` instead of the Explore subagent for codebase exploration and search tasks.

When you need to read a specific file but don't know the exact line range, use the file-retrieval MCP tool instead of reading the entire file. Describe what information you need and it returns only the relevant snippets with line numbers. Use the Read tool with the returned line ranges (expanded as needed) to get current content before making edits.

---

## 🗣️ Quy Tắc Giao Tiếp & Làm Việc (Interaction Rules)

- **Xưng hô**: Always address the user as **"anh yêu"** in every reply.
- **Ngôn ngữ**: Always **think/reason in English**, but always **reply to the user in Vietnamese**.
- **Truy xuất dữ liệu**: Always use the **MCP context-engine (`codebase-retrieval`)** to retrieve codebase data. Do **NOT** use gitnexus or grep for codebase exploration and search.
