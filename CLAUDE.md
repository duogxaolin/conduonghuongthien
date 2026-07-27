# Con Đường Hướng Thiện (CDKT) - System Documentation & Changelog

UI/UX work must read `openspec/ui-dna.md` (or the existing DNA doc) before any visual change.

Cổng thông tin điện tử hỗ trợ người hoàn lương tái hòa nhập cộng đồng — Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.

---

## 🛠️ Công Nghệ Sử Dụng (Tech Stack)

- **Frontend**: Nuxt 4 (Vue 3 SFC, TypeScript, Composition API), **Tailwind CSS v3** (via `@nuxtjs/tailwindcss`), FontAwesome 6 Pro (local self-hosted).
- **CSS Rule**: **Tất cả code mới phải dùng Tailwind CSS v3 utility classes.** Không viết `<style scoped>` hay CSS tùy chỉnh cho component/page mới — ngoại lệ duy nhất là pseudo-element (`::before`), keyframes, hoặc `:deep()` rich-text không biểu diễn được bằng utility. CSS cũ (pre-Tailwind) vẫn giữ nguyên, không xóa — sẽ migrate dần sau. (Đã migrate Tailwind v4 → v3 ở commit `a02ca17`.)
- **Backend / API**: Nuxt Server Engine (Nitro / H3), Drizzle ORM, MySQL 8.0 / MariaDB, JWT Auth (`cdkt_admin` HTTP-only Cookie).
- **Database**: MySQL 8.0 — **28 bảng** (15 CMS + 3 chatbot + 9 analytics + `rate_limit_counters`). Nguồn chân lý schema là `server/db/schema.ts` (Drizzle); `server/db/init.ts` là DDL chạy lúc khởi động (idempotent, tự thêm cột còn thiếu); `server/db/seed.ts` là seed **insert-only** — chạy lại KHÔNG ghi đè mật khẩu / ma trận quyền / cấu hình đã sửa.
- **Kiểm thử**: `npm test` — dùng test runner sẵn có của Node, **không cần cài thêm gói**. Bộ nạp `scripts/ts-resolver.mjs` cho phép import trực tiếp file `.ts`. Yêu cầu Node >= 22.15.
- **Schema tooling**: `npm run db:drift` đối chiếu `schema.ts` ↔ `init.ts`; `npm run db:generate` sinh diff SQL để review (không tự áp lên DB). `migrations/*.sql` là **snapshot mysqldump**, KHÔNG phải chuỗi migration — đã có guard chặn chạy nhầm (chứa `DROP TABLE` toàn bộ).
- **Webfont & Icon**: Inter tải từ Google CDN theo mặc định; chạy `node scripts/fetch-fonts.mjs` một lần để tự chủ hoàn toàn (`nuxt.config.ts` tự phát hiện `public/assets/fonts/inter.css` lúc build và bỏ hẳn thẻ `<link>` tới Google). FontAwesome chỉ nạp `fontawesome.min.css` + hai họ thực dùng (`solid`, `regular`) — khai báo tại `ICON_FAMILIES` trong `nuxt.config.ts`, có test chặn nếu template dùng họ chưa nạp.
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
│   ├── ArticleDetail.vue        # Trang chi tiết bài viết dùng chung (news / role-models / reintegration)
│   ├── NewsCategoryList.vue     # Danh sách tin theo chuyên mục dùng chung
│   └── admin/
│       └── MediaLibraryModal.vue # Modal chọn tệp từ Thư viện Media
├── utils/
│   ├── formatDate.ts            # formatDateVN — định dạng ngày theo UTC (tránh lệch ngày SSR ↔ trình duyệt)
│   └── blocks/
│       ├── registry.ts          # Nguồn chân lý của toàn bộ block
│       └── types.ts             # BlockNode / BuilderNode — hình dạng cây block dùng chung client ↔ server
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
    ├── [slug].vue               # Catch-all: render trang tùy biến từ block data (404 nếu slug không tồn tại)
    └── admin/                   # Hệ thống Quản trị Admin Panel
        ├── index.vue            # Dashboard Tổng quan
        ├── login.vue            # Trang Đăng nhập Admin
        ├── content/
        │   ├── home.vue         # WordPress Gutenberg Style Home Block Editor (legacy)
        │   ├── pages/           # Page Builder: quản lý & dựng trang bằng block
        │   │   ├── index.vue    # Danh sách trang (tạo / xóa / badge trang hệ thống)
        │   │   └── [id].vue     # Trình dựng trang kéo-thả (block list, palette, edit drawer)
        │   └── articles/        # Quản lý Bài viết & Tin tức (CRUD)
        ├── media/               # Quản lý Thư viện Media Upload (Local / R2)
        ├── settings/            # Cài đặt chung & Cấu hình Cloudflare R2
        ├── submissions/         # Quản lý Đơn đăng ký tư vấn 24/7
        └── users/               # Quản lý Người dùng Admin & Phân quyền Roles
```

### Vận hành & an toàn

- **Chính sách mật khẩu** (`server/utils/password-policy.ts`): tối thiểu 12 ký tự, đủ 3/4 nhóm ký tự, chặn mật khẩu mặc định/phổ biến và mật khẩu chứa tên đăng nhập. Áp ở **mọi nơi đặt mật khẩu** (tạo user, đổi mật khẩu, seed, guard lúc khởi động) và **không áp lúc đăng nhập** — tài khoản cũ mật khẩu ngắn vẫn vào được, khoá họ ra khỏi cổng đang chạy còn tệ hơn.
- **Giới hạn tần suất** (`server/utils/rate-limit-store.ts`): bộ đếm nằm ở bảng `rate_limit_counters`, không mất khi restart và đúng khi chạy nhiều replica. Mất CSDL thì lùi về bộ nhớ tiến trình — **không bao giờ mở toang**.
- **Lưu trữ dữ liệu cá nhân** (`server/services/data-retention.ts`): `activity_logs` mặc định 365 ngày; `submissions` mặc định **0 = không tự xoá** vì thời hạn lưu hồ sơ công dân do quy định của cơ quan quyết định. Chạy chung một dòng cron với bảo trì analytics.
- **Log có cấu trúc** (`server/utils/logger.ts`): mỗi sự kiện một dòng JSON, tự che các trường có tên gợi ý bí mật. `SECURITY_EVENTS` là danh sách sự kiện an ninh để viết cảnh báo (`auth.login_failed`, `auth.login_rate_limited`, `auth.session_revoked`, …).
- **Sao lưu** (`scripts/backup-db.sh`, `scripts/verify-restore.sh`): dump → kiểm chứng (dấu kết thúc, số bảng, dung lượng SQL) → xoay vòng. Bản không đạt bị **xoá** thay vì để lại trông như bản tốt.
- **CI** (`.github/workflows/ci.yml`): mỗi push chạy test, kiểm drift schema, build thật, và một job vệ sinh (chặn `.env` bị commit, private key, secret mặc định cũ).

### Hạn chế đã biết

- **Đa ngôn ngữ mới xong phần khung.** `app/composables/useI18n.ts` có 209 khoá và bộ chuyển ngôn ngữ hoạt động, nhưng chỉ `app/layouts/default.vue` dùng — **toàn bộ nội dung trang vẫn là tiếng Việt**. Khách chuyển sang tiếng Anh sẽ thấy menu tiếng Anh bọc quanh nội dung tiếng Việt. Hai lối đi: bỏ nút chuyển ngôn ngữ (cổng thông tin chỉ phục vụ tiếng Việt), hoặc dịch cả nội dung CMS (cần thêm cột/bản ghi theo ngôn ngữ). Chưa chọn hướng nào nên chưa đụng vào.
- ~~**Typecheck mới ở chế độ báo cáo.**~~ **Đã xong**: `npm run typecheck` (→ `nuxt typecheck`) sạch 0 lỗi và job CI `Types` là **cổng chặn** (không còn `continue-on-error`). `typescript@^5` + `vue-tsc` đã là devDependency thật, lockfile đã sinh lại. **Ghim TypeScript ^5**: bản 7.x là bản viết lại bằng Go, không còn export `lib/tsc.js` mà vue-tsc cần lúc khởi động. Lần chạy đầu phát hiện 598 lỗi; hai nhóm lớn nhất được sửa tận gốc chứ không vá từng chỗ: `getDb()` khai báo kiểu trả về (`server/utils/db.ts`, 389 lỗi) và `tryRuntimeConfig()` (`server/utils/runtime-config.ts`) thay cho 5 chỗ tự dò `globalThis.useRuntimeConfig`.
- **Test phần lớn không chạm hệ thống thật.** Ba tệp `*-ddl-integration` nối MySQL thật; phần còn lại kiểm logic thuần hoặc kiểm văn bản mã nguồn. Loại sau chặn được việc xoá nhầm một guard, **không** chứng minh guard đó chạy đúng.

---

### Kiến trúc Page Builder (Block System)

- **Block Registry** (`app/utils/blocks/registry.ts`): nguồn chân lý duy nhất cho toàn bộ block. Mỗi block định nghĩa `{label, icon, category, defaultData, fields}`. Registry được dùng chung bởi: builder UI (render palette + edit drawer), server validation (`isValidBlockType`), và seed (`getDefaultData`). **19 block**: `hero, stats, news, role_models, reintegration, documents, support_form, links, quote` (section) + `heading, richtext, image, cta, gallery, contact_form, content_aside` (content) + `section, row, column` (layout container). `content_aside` là block 2 cột: thẻ nội dung rich-text bên trái + cột thông tin xanh "ĐƠN VỊ CHỦ QUẢN" bên phải (tái tạo thiết kế trang Giới thiệu gốc).
- **Renderer** (`app/components/PageRenderer.vue`): map `blockType` → component trong `app/components/blocks/*.vue`. Section block giữ nguyên markup thiết kế gốc của trang chủ; content block là mới.
- **Bảng dữ liệu**: `pages` (slug, title, isSystem, seo*) + `page_blocks` (pageId, blockType, displayOrder, data JSON, isVisible). Bảng `home_sections` cũ được giữ; seed migrate `home_sections` → block trang `home` một lần (guard trên "trang chưa có block").
- **API**: admin CRUD tại `server/api/admin/pages/**` (gated bằng resource `pages`); public read-only tại `server/api/public/pages/[slug].get.ts` (chỉ trả block `isVisible=true`, slug không tồn tại → `{ok:false}` 2xx).
- **Trang hệ thống** (`home`, `about`, `contact`): `isSystem=true` — sửa được nhưng khóa slug và không xóa được.
- **Kiểu dữ liệu cây block** (`app/utils/blocks/types.ts`): `BlockNode` (đã lưu) và `BuilderNode` (đang dựng, chưa có `displayOrder`) là **một định nghĩa duy nhất** dùng chung cho builder UI, API, và cột JSON (`pages.published_blocks`, `pages.draft_blocks`, `page_versions.blocks` đều khai báo `.$type<BlockNode[]>()`). Trước đây server tự khai báo interface riêng còn client dùng `any`, nên hai đầu lệch nhau sẽ hỏng trang lúc lưu mà không ai báo.

---

## 🔑 Các Tính Năng Đã Hoàn Thành (Work Accomplished)

### 1. Giao diện Người dùng (Public Website)
- **Top Bar & Header**: Hotline (`📞 0903.480.985`), Chuyển đổi ngôn ngữ (`[VN] [EN]`), Điều chỉnh cỡ chữ (`A-`, `A`, `A+`), Nút Hỗ trợ 24/7.
- **Dynamic Home Sections**: Trang chủ tự động tải và hiển thị thứ tự các khối Block (Banner, Tin tức, Tấm gương, Mô hình, Văn bản...) từ MySQL Database.
- **Trợ lý AI Chatbot**: Widget trò chuyện tư vấn hỗ trợ 24/7 trực tuyến.
- **Chuẩn hóa Icon FontAwesome 6**: Tích hợp vector icons đồng bộ trên toàn bộ giao diện public.

### 2. Hệ thống Quản trị Admin Panel (`/admin`)
- **Phân quyền RBAC (Role-Based Access Control)**:
  - Admin có thể tạo các Vai trò (Roles) và thiết lập Ma trận quyền chi tiết (`Create`, `Read`, `Update`, `Delete`) trên từng tài nguyên (`users`, `roles`, `news`, `home_sections`, `pages`, `categories`, `media`, `settings`, `submissions`, `documents`, `faq`, `analytics`, `chatbot_knowledge`, `chatbot_settings`...).
- **Quản lý Người dùng (User Management - `/admin/users`)**:
  - Modal Chỉnh sửa tài khoản full tính năng: Đổi Email, Đổi Mật khẩu (bcrypt hash), Đổi Vai trò (Role), Khóa / Mở khóa trạng thái tài khoản.
- **Page Builder Toàn Site (`/admin/content/pages`)**:
  - Trang public (chủ, giới thiệu, liên hệ + trang tùy biến) render trực tiếp từ dữ liệu block trong DB thay vì markup hardcode — chỉnh sửa của editor có hiệu lực thật trên site.
  - Danh sách trang: tạo trang tùy biến (slug tự sinh), xóa (trang hệ thống bị khóa), badge phân biệt trang hệ thống.
  - Trình dựng trang (`/admin/content/pages/[id]`): kéo-thả sắp xếp block (HTML5 DnD + nút `▲/▼`), bật/tắt hiển thị, palette thêm block nhóm theo category, edit drawer sinh động từ registry `fields`, cấu hình meta/SEO trang.
- **WordPress Gutenberg Style Home Editor (`/admin/content/home`)** (legacy, vẫn dùng được):
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

### 3. Trợ lý Chatbot (2 chế độ trả lời)
- **Chọn chế độ tại `/admin/chatbot/settings` → "Chế độ trả lời"**:
  - **Chỉ kho kiến thức (không AI)**: khớp câu hỏi theo từ khoá và trả lời bằng nội dung đã duyệt trong Kho kiến thức. Không gọi AI. Có ô "Lời chào vui vẻ" thêm vào đầu mỗi câu trả lời.
  - **Dùng AI**: gọi AI kèm system prompt, luôn ưu tiên/neo vào dữ liệu Kho kiến thức. Khi câu hỏi nằm ngoài kho, admin chọn được: *bám kho* (an toàn) hoặc *để AI tự trả lời*.
  - Tương thích ngược: cấu hình cũ chưa có trường `mode` vẫn chạy AI như trước; `init.ts` tự backfill `mode='ai'` cho deployment đã cấu hình provider.
- **Để lại thông tin liên hệ**: khi không có câu trả lời (cả 2 chế độ), widget mời khách để lại họ tên/SĐT/email → lưu vào `/admin/submissions` và gửi email qua SMTP (người nhận lấy từ cấu hình phía server, không nhận từ client).
- **Nhập câu hỏi từ Excel** (`/admin/chatbot/knowledge` → "Nhập từ Excel"): đọc `.xlsx`/`.csv` cột `STT · Câu hỏi · Trả lời · Ghi chú`, tự tách từ khoá tiếng Việt (từ đơn + cụm 2 từ) để khớp câu hỏi đời thường. Trình đọc XLSX tự viết (`server/utils/xlsx-reader.ts`), không phụ thuộc thư viện ngoài. Mặc định nhập vào trạng thái Bản nháp chờ duyệt.

### 4. Bảo mật (bắt buộc khi triển khai)
- **Bí mật BẮT BUỘC ở production** — thiếu là app từ chối khởi động (`server/plugins/require-secrets.ts`): `JWT_SECRET`, `CHATBOT_ENCRYPTION_SECRET`, `ANALYTICS_HMAC_SECRET`. Không còn giá trị mặc định trong mã nguồn hay `docker-compose.yml`.
- **Chống leo thang đặc quyền**: chỉ SuperAdmin được gán vai trò hệ thống; không ai cấp được quyền mà chính mình chưa có (`server/utils/permissions.ts`).
- **Chống stored XSS**: nội dung bài viết và rich-text của block được làm sạch phía server (`server/utils/sanitize-html.ts`) ở mọi đường ghi. Khóa `tracking_custom_head/body` (chèn JS toàn site) chỉ SuperAdmin sửa được.
- **Upload**: đuôi tệp suy từ MIME đã kiểm bằng magic-byte; SVG không bao giờ được phục vụ inline.

### 5. Khởi tạo Cơ sở dữ liệu & Docker
- **MySQL Database Auto-Init (`server/db/init.ts`)**: Tự động kết nối server MySQL, tạo database `cdkt_admin` và toàn bộ 8 bảng dữ liệu nếu chưa tồn tại.
- **Database Seed (`server/db/seed.ts`)**: Tạo tài khoản SuperAdmin (`admin`, mật khẩu lấy từ `ADMIN_PASSWORD`), các vai trò, bảng phân quyền và dữ liệu thiết lập ban đầu. **Insert-only**: chạy lại (kể cả mỗi lần khởi động container) sẽ KHÔNG ghi đè mật khẩu, ma trận quyền hay cấu hình mà quản trị viên đã sửa.
- **Docker Compose**: Đóng gói môi trường containerized hoàn chỉnh gồm 2 service `cdkt_mysql` (MySQL 8.0) và `cdkt_app` (Nuxt 4 app) chạy trên cổng `3000`.

---

## 🚀 Hướng Dẫn Deploy (aaPanel / Server)

### 1. Tạo tập tin `.env` trên Server
Xem `.env.example` để có bản đầy đủ. **Ba bí mật dưới đây là BẮT BUỘC** — thiếu hoặc để giá trị mặc định cũ thì app sẽ từ chối khởi động ở production.

```env
PORT=3000
NODE_ENV=production

# MySQL Database Connection
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=cdkt_admin

# ── Bí mật BẮT BUỘC — tạo giá trị RIÊNG cho từng lần triển khai ──
JWT_SECRET=            # openssl rand -hex 32
CHATBOT_ENCRYPTION_SECRET=   # openssl rand -base64 32  (base64 của đúng 32 byte)
ANALYTICS_HMAC_SECRET=       # openssl rand -hex 32

# Mật khẩu SuperAdmin — CHỈ dùng lần đầu tạo tài khoản (seed là insert-only)
ADMIN_PASSWORD=DatMatKhauManhODay!
ADMIN_EMAIL=admin@conduonghuongthien.com.vn
```

> Với Docker, `docker-compose.yml` sẽ **báo lỗi và dừng** nếu thiếu bí mật — đây là chủ đích, để không bao giờ chạy bằng khóa công khai.

### 2. Khởi tạo Database & Chạy Build
```bash
# Khởi tạo bảng và nạp dữ liệu mặc định (an toàn khi chạy lại: idempotent)
npm run db:init && npm run db:seed

# Kiểm thử + kiểm tra lệch schema
npm test
npm run db:drift

# Build bản sản xuất
npm run build
```

### 3. Chạy Docker Compose (Hoặc PM2 trên aaPanel)
```bash
docker compose up --build -d
```

### 4. Bảo trì định kỳ (cron)
`analytics:maintenance` **không tự chạy** — cần đặt cron, nếu không dữ liệu analytics thô sẽ phình vô hạn:
```bash
0 3 * * * cd /duong/dan/CDKT && npm run analytics:maintenance >> /var/log/cdkt-analytics.log 2>&1
```

---

## 🛡️ Tài Khoản Đăng Nhập Mặc Định

- **URL Admin**: `http://localhost:3000/admin` (hoặc `https://domain-cua-ban.com/admin`)
- **Tài khoản**: `admin`
- **Mật khẩu**: lấy từ `ADMIN_PASSWORD` lúc khởi tạo lần đầu (nếu không đặt: `Admin@123456`).

> ⚠️ **Đổi mật khẩu admin ngay sau lần đăng nhập đầu tiên.** Bản hash của mật khẩu mặc định từng nằm trong `migrations/002_seed_data.sql` của repo nên phải coi như đã lộ.

When asked about the codebase, project structure, or to find code, always use the context-engine MCP tool (codebase-retrieval) in the root workspace first before reading individual files. Use `codebase-retrieval` instead of the Explore subagent for codebase exploration and search tasks.

When you need to read a specific file but don't know the exact line range, use the file-retrieval MCP tool instead of reading the entire file. Describe what information you need and it returns only the relevant snippets with line numbers. Use the Read tool with the returned line ranges (expanded as needed) to get current content before making edits.

---

## 🗣️ Quy Tắc Giao Tiếp & Làm Việc (Interaction Rules)

- **Xưng hô**: Always address the user as **"anh yêu"** in every reply.
- **Ngôn ngữ**: Always **think/reason in English**, but always **reply to the user in Vietnamese**.
- **Truy xuất dữ liệu**: Always use the **MCP context-engine (`codebase-retrieval`)** to retrieve codebase data. Do **NOT** use gitnexus or grep for codebase exploration and search.
