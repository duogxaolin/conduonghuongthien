# Con Đường Hướng Thiện (CDKT) - System Documentation & Changelog

UI/UX work must read `openspec/ui-dna.md` (or the existing DNA doc) before any visual change.

Cổng thông tin điện tử hỗ trợ người hoàn lương tái hòa nhập cộng đồng — Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.

---

## 🛠️ Công Nghệ Sử Dụng (Tech Stack)

- **Frontend**: Nuxt 4 (Vue 3 SFC, TypeScript, Composition API), **Tailwind CSS v3** (via `@nuxtjs/tailwindcss`), FontAwesome 6 Pro (local self-hosted).
- **CSS Rule**: **Tất cả code mới phải dùng Tailwind CSS v3 utility classes.** Không viết `<style scoped>` hay CSS tùy chỉnh cho component/page mới — ngoại lệ duy nhất là pseudo-element (`::before`), keyframes, hoặc `:deep()` rich-text không biểu diễn được bằng utility. CSS cũ (pre-Tailwind) vẫn giữ nguyên, không xóa — sẽ migrate dần sau. (Đã migrate Tailwind v4 → v3 ở commit `a02ca17`.)
- **Backend / API**: Nuxt Server Engine (Nitro / H3), Drizzle ORM, MySQL 8.0 / MariaDB, JWT Auth (`cdkt_admin` HTTP-only Cookie).
- **Database**: MySQL 8.0 — **36 bảng** (15 CMS + 4 chatbot: 3 cũ + `chatbot_small_talk` kho trả lời thường nhật + 2 phiên trò chuyện: `chat_sessions`, `chat_messages` + 9 analytics + `rate_limit_counters` + 2 MFA: `user_mfa_factors`, `user_recovery_codes` + `data_retention_state` sổ ghi lượt dọn dữ liệu + 2 lượt xem bài viết: `article_view_daily` đếm theo ngày/nguồn, `article_view_boost` lịch cộng dần lượt xem ảo). Nguồn chân lý schema là `server/db/schema.ts` (Drizzle); `server/db/init.ts` là DDL chạy lúc khởi động (idempotent, tự thêm cột còn thiếu); `server/db/seed.ts` là seed **insert-only** — chạy lại KHÔNG ghi đè mật khẩu / ma trận quyền / cấu hình đã sửa.
- **Kiểm thử**: `npm test` — dùng test runner sẵn có của Node, **không cần cài thêm gói**. Bộ nạp `scripts/ts-resolver.mjs` cho phép import trực tiếp file `.ts`. Yêu cầu Node >= 22.15.
- **Schema tooling**: `npm run db:drift` đối chiếu `schema.ts` ↔ `init.ts`; `npm run db:generate` sinh diff SQL để review (không tự áp lên DB). `migrations/*.sql` là **snapshot mysqldump**, KHÔNG phải chuỗi migration — đã có guard chặn chạy nhầm (chứa `DROP TABLE` toàn bộ).
- **Webfont & Icon**: Inter **đã tự chủ** — `public/assets/fonts/` chứa 7 tệp `.woff2` + `inter.css` do `node scripts/fetch-fonts.mjs` tải về, và `nuxt.config.ts` tự phát hiện tệp CSS đó lúc build rồi bỏ hẳn ba thẻ `<link>` tới Google (2 preconnect + 1 stylesheet). Kiểm chứng bằng cách grep `.output/` sau khi build: không còn tham chiếu `fonts.googleapis.com` nào. Xoá thư mục đó đi thì lần build sau tự quay lại dùng CDN — nhánh này là `existsSync` lúc build, không phải cấu hình. FontAwesome chỉ nạp `fontawesome.min.css` + hai họ thực dùng (`solid`, `regular`) — khai báo tại `ICON_FAMILIES` trong `nuxt.config.ts`, có test chặn nếu template dùng họ chưa nạp.
- **Hiệu năng trang công khai** — ba thay đổi ăn khớp nhau, đừng gỡ lẻ một cái:
  - **`routeRules` SWR 60 giây** (`nuxt.config.ts`) cho `/`, `/about`, `/contact` và bốn nhánh danh sách. Mỗi lượt xem trước đây dựng lại HTML từ đầu bằng cùng một truy vấn cho mọi khách. Đã rà `app/pages/`: **không trang công khai nào** đọc `useAdminAuth` hay cookie `cdkt_admin`, nên cache được an toàn — đó là điều kiện tiên quyết, không phải chi tiết. `/admin/**` và toàn bộ `/api/**` đặt `cache: false` **tường minh**; phục vụ lại một trang quản trị đã đăng nhập là phát nó cho người kế tiếp (cùng mối nguy mà `CI-CD.md` Bước 8 bắt tắt cache ở nginx).
  - **`lazy: true` ở 6 lượt fetch danh sách/chi tiết** (5 trang + `ArticleDetail.vue`). Các trang **đã có sẵn** khung xương `v-if="pending"`, nhưng `await useFetch` khiến router giữ nguyên trang cũ tới khi dữ liệu về, nên khung xương đó **không bao giờ được vẽ** — bấm một liên kết trông y hệt bấm hụt. `lazy` chỉ bỏ chặn phía client; **lượt dựng phía máy chủ vẫn chờ dữ liệu**, nên HTML đầu tiên và thẻ SEO không đổi.
  - **`<NuxtLoadingIndicator>`** ở `app/layouts/default.vue` là phản hồi tức thì cho cú bấm, phủ nốt khoảng thời gian mà khung xương chưa kịp có ý nghĩa.
  - Hệ quả kèm theo: `news/index.vue` có hai lượt fetch độc lập (danh mục + bài viết); bỏ `await` ở lượt đầu khiến chúng khởi động **cùng lúc** thay vì nối đuôi, nên thời gian chờ là lượt chậm hơn chứ không phải tổng hai lượt.
- **Khung xương lúc tải** (`app/components/skeleton/*.vue`, `tests/skeleton-loading-ui.test.ts`): mọi khung chờ đi qua ba thành phần dùng chung — `SkeletonTable` (`rows`/`cols`), `SkeletonCards` (`count` — lưới media 6 cột), `SkeletonForm` (`fields`/`hasAction`). Đi **inline** chỉ khi hình dạng là duy nhất trong toàn dự án (ma trận phân quyền, workspace 3 khung của Page Builder, hai trang cấu hình menu, khung block của trang công khai) — ba thành phần kia không mô tả nổi những hình đó, và ép chúng vào sẽ tạo ra một khung chờ có kích thước khác nội dung thật.
  - **Mỗi prop phải có một nơi gọi thật, không có prop dự phòng.** `SkeletonText` từng được viết ra rồi **xoá** vì không nơi nào gọi; `SkeletonCards` từng có `columns`/`media`/`mediaHeight`/`tone` và `SkeletonTable` từng có `hasHeader` — tất cả bị cắt vì không nơi gọi nào truyền. Một hình dạng khung chờ chỉ **biết là đúng** khi được đo trực tiếp trên nội dung nó thay thế; một biến thể đoán trước là một khung chờ chưa bao giờ được đối chiếu với thứ gì. Cần hình mới thì nó đến cùng nơi gọi thật của nó.
  - **`motion-reduce:animate-none` đi kèm mọi `animate-pulse`, không có ngoại lệ tuỳ hứng.** `prefers-reduced-motion` là thiết lập trợ năng cho người bị chóng mặt tiền đình / rối loạn tiền đình; một khung chờ nhấp nháy toàn màn hình là đúng loại chuyển động thiết lập đó tồn tại để tắt. Có test chặn theo **từng thẻ** (không phải từng tệp): một tệp có hai khung chờ mà chỉ một cái được gắn guard vẫn trượt.
  - **Bốn nhịp đập được miễn trừ, đã ghi danh sách trong test**: hai chỉ báo trực tuyến ở `app/layouts/default.vue`, nhịp khách đang xem ở `AnalyticsLiveDashboard.client.vue:412`, và chấm huy hiệu "Live" ở `app/pages/admin/index.vue`. Đây là **chỉ báo trạng thái**, không phải khung chờ: tắt chuyển động của chúng là xoá đúng tín hiệu duy nhất chúng mang, còn lại một chấm không nói lên điều gì. Thêm mục thứ năm phải sửa allowlist trong test kèm lý do — đó là chủ đích.
  - **Tải / lỗi / rỗng là MỘT hợp đồng, không phải ba nhánh tuỳ chọn.** Thiếu nhánh tải thì trang trông như đã tải xong nhưng trống rỗng; thiếu nhánh lỗi thì một lượt fetch hỏng cũng hiện y hệt "chưa có dữ liệu" và cán bộ đi tạo lại bản ghi đã có. Nút thử lại phải gọi lại **chính lượt fetch đã hỏng**, **không** tải lại trang. Mẫu chuẩn ở `app/components/NewsCategoryList.vue:14-34`. **Đã xong trên toàn bộ 26 trang admin** (`tests/admin-error-retry-ui.test.ts` chặn): mỗi trang có ref lỗi, nhánh lỗi thường trực mang `role="alert"`, và nút thử lại trỏ vào một hàm **có khai báo trong cùng tệp**. Không còn `location.reload()` ở đâu trong `app/pages/admin/**` — tải lại trang để chạy lại **một** request là ném đi state của mọi khung khác và mọi form chưa lưu trên trang.
    - **Nhánh lỗi phải mang `role="alert"`.** Không có nó, người dùng sáng mắt thấy một khối đỏ còn người dùng trình đọc màn hình **không được thông báo gì** — lượt fetch hỏng đọc ra y hệt một trang vừa tải xong và trống rỗng.
    - **Ô thống kê nhỏ cũng phải có nút thử lại.** Bốn khung analytics ở `/admin/index` từng chỉ hiện "Không thể tải dữ liệu" rồi đứng đó tới lần tải trang sau; giờ mỗi khung gọi lại đúng lượt fetch của nó (`loadLive`, `loadTraffic`, `loadBreakdowns`).
  - **Container mang `role="status"` + `aria-busy="true"` + một nhãn `sr-only` tiếng Việt; mọi ô xám bên trong mang `aria-hidden="true"`.** Không có phần này thì trình đọc màn hình đọc ra một chuỗi hộp rỗng vô nghĩa thay vì "đang tải danh sách người dùng".
  - **Lớp cột/chiều cao viết thẳng thành chữ trong template, không nội suy chuỗi** (`SkeletonCards`): Tailwind v3 quét **văn bản mã nguồn** lúc build, nên `grid-cols-${n}` không bao giờ được sinh ra CSS — lưới lặng lẽ co về một cột và **không có lỗi nào**.
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
│   ├── ChatWidget.vue           # Widget chatbot nổi (nút mở rộng ≥768px → /tro-ly)
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
│   ├── useChatbot.ts            # State + hành vi chatbot dùng chung widget ↔ /tro-ly (module-level)
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
    ├── tro-ly.vue               # Trợ lý AI toàn màn hình (sidebar cuộc hội thoại + khung chat)
    ├── [slug].vue               # Catch-all: render trang tùy biến từ block data (404 nếu slug không tồn tại)
    └── admin/                   # Hệ thống Quản trị Admin Panel
        ├── index.vue            # Dashboard Tổng quan
        ├── login.vue            # Trang Đăng nhập Admin (kèm bước xác thực hai bước)
        ├── profile.vue          # Tài khoản của tôi: đổi mật khẩu, yếu tố thứ hai, lịch sử
        ├── content/
        │   ├── home.vue         # WordPress Gutenberg Style Home Block Editor (legacy)
        │   ├── pages/           # Page Builder: quản lý & dựng trang bằng block
        │   │   ├── index.vue    # Danh sách trang (tạo / xóa / badge trang hệ thống)
        │   │   └── [id].vue     # Trình dựng trang kéo-thả (block list, palette, edit drawer)
        │   └── articles/        # Quản lý Bài viết & Tin tức (CRUD) + cột "Lượt xem" và modal thống kê/tăng lượt xem ảo
        ├── chatbot/             # Trợ lý AI Chatbot
        │   ├── knowledge/       # Kho kiến thức nghiệp vụ (duyệt nháp→published, bắt buộc nguồn)
        │   ├── small-talk/      # Kho trả lời thường nhật (quản lý được, không duyệt, 5 nhóm)
        │   ├── sessions/        # Phiên trò chuyện của khách: danh sách + nội dung, IP/trình duyệt, đối chiếu đơn đăng ký
        │   └── settings.vue     # Cấu hình provider AI, chế độ trả lời, công tắc small_talk
        ├── media/               # Quản lý Thư viện Media Upload (Local / R2)
        ├── settings/            # Cài đặt chung, SMTP, Cloudflare R2
        │   └── data-retention.vue # Tự động dọn dữ liệu: điều kiện, giờ chạy, số liệu đã dọn
        ├── submissions/         # Quản lý Đơn đăng ký tư vấn 24/7
        └── users/               # Quản lý Người dùng Admin & Phân quyền Roles
            └── activity.vue    # Lịch sử hoạt động TOÀN HỆ THỐNG (mọi tài khoản) + tình trạng dọn log
```

### Vận hành & an toàn

- **Chính sách mật khẩu** (`server/utils/password-policy.ts`): tối thiểu 12 ký tự, đủ 3/4 nhóm ký tự, chặn mật khẩu mặc định/phổ biến và mật khẩu chứa tên đăng nhập. Áp ở **mọi nơi đặt mật khẩu** (tạo user, đổi mật khẩu, seed, guard lúc khởi động) và **không áp lúc đăng nhập**
  - **Guard lúc build** (`scripts/check-admin-password.ts`, chạy trong `npm run build` trước `nuxt build`): hai chốt cũ (seed và boot) đều nằm **sau** khi build đã xong, nên một `ADMIN_PASSWORD` sai chỉ lộ ra sau khi đã trả tiền cho cả lần build. Guard đọc `ADMIN_PASSWORD` → `ADMIN_PASSWORD_FILE` → `.env` (đúng thứ tự ưu tiên lúc chạy), dùng chung `password-policy.ts`. **Sai → exit 1; không đặt → cảnh báo rồi cho qua** (CI và builder stage của Docker không có `.env`, và seed là insert-only nên deployment cũ không cần giữ mật khẩu trong `.env`). Trong Docker, giá trị vào bằng **BuildKit secret** (`docker-compose.yml` → `secrets.admin_password.environment`), không phải build arg — build arg bị ghi vĩnh viễn vào `docker history`. — tài khoản cũ mật khẩu ngắn vẫn vào được, khoá họ ra khỏi cổng đang chạy còn tệ hơn.
- **Xác thực hai bước & trang tài khoản** (`/admin/profile`): mỗi quản trị viên tự đổi mật khẩu, tự bật/tắt yếu tố thứ hai, và tự xem lịch sử đăng nhập/hoạt động của mình. Các endpoint `server/api/admin/profile/**` **không gắn `checkPermission`** — danh tính lấy từ phiên (`event.context.adminUser`), request không được nêu `userId`, nên không có gì để phân quyền. Ngoại lệ: SuperAdmin xem được lịch sử tài khoản khác (`?userId=`, ghi lại một dòng `read user_history` cho chính hành vi xem) và xoá được yếu tố của người khác khi họ bị khoá ngoài (`DELETE /api/admin/users/[id]/mfa`, **chỉ SuperAdmin**, không nhận quyền `users.update` thay thế).
  - **Ba yếu tố, bật tắt độc lập** (`server/utils/mfa/factors.ts`): `totp` (Google Authenticator, RFC 6238 tự viết trên `node:crypto`), `email_otp` (mã 6 số về địa chỉ **đã lưu trên tài khoản**, sống 10 phút, tối đa 5 lần thử), `second_password` (mật khẩu cấp 2, bcrypt, bắt buộc khác mật khẩu đăng nhập). Đăng ký là **tự nguyện** và mỗi lượt đi qua hai bước `pending` → `active`; chỉ `active` mới trả lời được thử thách đăng nhập, nên một lượt đăng ký không xác nhận được không thể khoá ai ra ngoài. Tắt yếu tố là **xoá hàng**, không phải gắn cờ — bí mật không nằm lại trên đĩa.
  - **Mã dự phòng** là tuỳ chọn, có nút bật/tắt riêng; hiện đúng một lần lúc sinh, lưu bcrypt, mỗi mã dùng một lần. Tắt hết yếu tố thì mã dự phòng chưa dùng bị xoá theo.
  - **Vé thử thách** (`stage: 'mfa-challenge'`, cookie `cdkt_mfa`, sống 5 phút) tách khỏi vé phiên (`stage: 'session'`, cookie `cdkt_admin`). Cùng khoá ký, nên `server/middleware/admin-auth.ts` chặn bằng **claim `stage`** chứ không bằng chữ ký. Vắng `stage` đọc là `'session'`: phiên đã phát hành trước khi có claim này vẫn sống qua lần deploy.
  - **⚠️ Runbook xoay `JWT_SECRET`**: khoá mã hoá secret TOTP **dẫn xuất từ `JWT_SECRET`** (HKDF-SHA256, nhãn `cdkt-mfa-totp:v1`). Xoay `JWT_SECRET` là **vô hiệu hoá toàn bộ secret TOTP đã lưu** — người dùng phải đăng ký lại ứng dụng xác thực. Hệ thống không sập: `usableFactorTypes` phát hiện secret không giải mã được, **bỏ `totp` ra khỏi danh sách yếu tố** để tài khoản lùi về yếu tố khác hoặc mã dự phòng, và ghi `mfa.totp_secret_unreadable` với `reason:"key-mismatch"` kèm hướng dẫn. Trước khi xoay: thông báo cho quản trị viên, đảm bảo mỗi người còn **ít nhất một yếu tố khác hoặc mã dự phòng**, và chuẩn bị `DELETE /api/admin/users/[id]/mfa` cho người chỉ có TOTP.
- **Giới hạn tần suất** (`server/utils/rate-limit-store.ts`): bộ đếm nằm ở bảng `rate_limit_counters`, không mất khi restart và đúng khi chạy nhiều replica. Mất CSDL thì lùi về bộ nhớ tiến trình — **không bao giờ mở toang**. Đăng nhập bước hai giới hạn **theo tài khoản** (10 lần / 15 phút, khoá vé đang dùng và cả vé mới xin) chứ không chỉ theo vé — giới hạn theo vé thì xin vé mới là thoát.
- **Địa chỉ khách sau reverse proxy** (`server/utils/client-ip.ts`, `TRUSTED_PROXY_IPS`): mọi handler dùng `getClientIp(event)`, **không** gọi `getRequestIP` trực tiếp (có test chặn). Trước đây 16 chỗ gọi `getRequestIP(event, { xForwardedFor: false })` — đúng khi app nhận request trực tiếp, vì `x-forwarded-for` là header client tự đặt được. Nhưng sau nginx thì peer IP của **mọi khách** là gateway của docker bridge: `clientKey()` trong `chat-policy.ts` băm một giá trị duy nhất cho cả internet nên **giới hạn chat 10 request/60 giây thành giới hạn toàn cục** (khách thứ 11 bị chặn vì 10 người lạ), và `activity_logs` / `submissions` ghi IP proxy — mất đúng trường khiến nhật ký kiểm toán có giá trị.
  - Bật `xForwardedFor: true` là đổi một lỗi đúng-sai lấy một lỗ bảo mật. Cách giải: **chỉ đọc chuỗi forwarded khi peer đúng là proxy mình đã khai**, và duyệt chuỗi **từ phải sang trái**, bỏ các hop cũng là proxy của mình. Địa chỉ đầu tiên không phải của mình là địa chỉ gần nhất mà client **không giả mạo được** — mọi giá trị bên trái nó đã được ghi vào trước khi hạ tầng của mình nhìn thấy request.
  - **Mặc định chỉ tin loopback.** Không suy diễn rằng dải private là đáng tin: trên máy chủ chạy container của người khác, thế là để container láng giềng giả mạo địa chỉ. Deployment có nginx **bắt buộc** khai proxy của mình. Loopback luôn được giữ lại vì healthcheck của container gọi qua `127.0.0.1`.
  - `resolveClientIp` là **hàm thuần** (peer + header + danh sách tin cậy → `{ ip, source, spoofAttempt }`) nên kiểm được không cần máy chủ HTTP. `spoofAttempt` bật khi có header forwarded nhưng người gửi **không** phải proxy của mình — hoặc cấu hình sai, hoặc là một lượt giả mạo; cả hai đều nên thấy trong log. Hỗ trợ CIDR IPv4; dải IPv6 **cố ý không hỗ trợ** (một mặt nạ IPv6 sai một nửa mà khớp quá rộng thì tệ hơn là buộc khai địa chỉ đầy đủ).
  - Cần **cả hai tên biến** `TRUSTED_PROXY_IPS` và `NUXT_TRUSTED_PROXY_IPS` trong compose: Nitro đọc tên có tiền tố `NUXT_` lúc chạy, tên trần dành cho script bảo trì chạy ngoài Nitro.
- **Cổng app bind loopback** (`docker-compose.yml`, `APP_BIND` mặc định `127.0.0.1`): trước đây publish ra `0.0.0.0:3000` nên sau khi dựng SSL trên nginx, cổng 3000 vẫn trả lời HTTP trần từ internet — chứng chỉ không có nghĩa gì nếu cổng nó bảo vệ cũng vào được mà không cần nó. Đặt nginx phía trước rồi proxy về `127.0.0.1:3000`. `APP_BIND=0.0.0.0` chỉ dùng khi **không** có proxy nào và TLS kết thúc ở chỗ khác.
- **Lượt xem bài viết** (`server/services/article-views.ts`, `/admin/content/articles`): con số này phải chịu được một câu hỏi mà bộ đếm tiếp thị không phải chịu — "số đó có thật không?". Cơ quan không trả lời bằng cái nhún vai được, nên phần thật giữ nguyên vẹn bằng **hai lớp tách độc lập**: `real_views` và `fabricated_views` là hai cột khác nhau, **và** mọi dòng ảo còn mang `source_category='boost'` — giá trị **không** nằm trong `SOURCE_CATEGORIES` công khai (có guard chạy lúc import: thêm `boost` vào allowlist là app từ chối khởi động). Một lớp đủ giữ `SUM(real_views)` đúng; hai lớp buộc một lần refactor phải phá hai thứ không liên quan cùng lúc mới làm hồ sơ mập mờ được.
  - **Đếm từ trình duyệt, không đếm ở SSR.** `/news/**`, `/role-models/**`, `/reintegration-models/**`, `/documents/**`, `/legal-qa/**` phục vụ qua `swr: 60`, nên người đọc thứ hai trở đi trong mỗi cửa sổ 60 giây **không chạm vào mã máy chủ nào**. Đếm phía máy chủ sẽ thiếu đúng bằng phần mà bộ nhớ đệm đang phát huy tác dụng — và con số thiếu đó trông vẫn hợp lý. Ping đi từ `ArticleDetail.vue` sau khi mount, mọi lỗi nuốt: một bộ đếm không có tư cách làm hỏng trang của khách.
  - **Chống bấm F5 do máy chủ lo, cửa sổ 30 phút** (`rate_limit_counters`, `limit: 1` nên `count === 1` chính là quyết định "lần đầu"). Khoá là `av:<articleId>:<32 hex đầu của visitor token>`; token do `deriveDailyVisitorToken` sinh nên **không lưu IP hay user agent**. Địa chỉ khách lấy qua `getClientIp(event)`, không bao giờ `getRequestIP` — sau nginx thì `getRequestIP` trả gateway docker cho **mọi** khách, gộp cả internet vào một ô đếm.
  - **Endpoint luôn trả `202`** ở mọi nhánh (đã ghi, trùng lặp, slug lạ, body hỏng, thiếu bí mật). Trạng thái thay đổi theo nhánh sẽ **lộ ra slug nào có thật**. **Không** gắn cổng vào `ANALYTICS_COLLECTION_ENABLED`: công tắc đó là quyết định riêng tư về việc đo hành vi khách, còn đây là thống kê biên tập của cổng về chính nội dung của mình — tắt thu thập rồi thấy mọi bài báo 0 vĩnh viễn mà không có gì giải thích là một ngõ cụt im lặng. Thiếu `ANALYTICS_HMAC_SECRET` thì **có** dừng đếm (không có token thì không khử trùng lặp được) nhưng ghi một dòng log `article_view.secret_unavailable`.
  - **Tăng lượt xem ảo** (`POST/DELETE /api/admin/articles/[id]/boost`, quyền `update` trên `articleResource(article.type)` — **không** thêm resource mới): `instant` cộng ngay, `gradual` tạo một lượt cộng dần do `server/services/view-boost-scheduler.ts` giao (tick 60 giây, khoá MySQL `cdkt:articles:view-boost` timeout `0`, `VIEW_BOOST_SCHEDULER=1|0`). `computeBoostDue` tính theo **thời gian đã trôi qua tuyệt đối**, không cộng dồn theo tick: tick trượt, tick dồn, hay khởi động lại sau khi `ends_at` đã qua đều ra cùng một đáp số, và không bao giờ vượt quá số đã duyệt. Mỗi bài chỉ cho **một** lượt `running`. **Mọi thao tác ghi `activity_logs`** (`action: 'boost'`, kèm mode/amount/minutes/title) **trên cùng đường ghi**, không phải lời gọi phụ hoạt-động-được-thì-tốt: một lượt tăng không truy được về người thực hiện là đúng thứ tính năng này không được phép sinh ra. Huỷ lượt **giữ nguyên phần đã cộng** — phần đó đã được duyệt lúc nó chạy, và hoàn tác sẽ làm tổng ảo thấp hơn tổng mà nhật ký kiểm toán nói là đã cộng.
    - **`started_at` / `ends_at` chỉ được đọc qua trình dựng truy vấn Drizzle, không bao giờ qua `pool.query` trần.** Hai cột này là DATETIME — kiểu **không mang múi giờ** — và hai nửa của Drizzle chỉ nghịch đảo nhau **theo cặp**: nó ghi bằng `toISOString()` (giờ treo tường UTC) rồi đọc bằng cách ép mysql2 sang chế độ chuỗi cho DATETIME và gắn lại `Z`. Một truy vấn trần bỏ qua chính cái ép chế độ chuỗi đó, nên bộ phân tích của mysql2 áp `timezone` của pool (`'+07:00'`) lên một giá trị Drizzle chưa hề mã hoá múi giờ vào: **mọi lượt bị lùi 7 giờ**, và lượt nào ngắn hơn 7 giờ thì ngay tick đầu tiên đã qua `ends_at` — cộng hết một lần rồi đóng sổ, tức là chế độ "cộng dần" **âm thầm thoái hoá thành cộng ngay**. Đổi sang `createAnalyticsPool()` (`'+00:00'`) chỉ dời chỗ lệch sang pool khác chứ không sửa được; trình dựng truy vấn là đường đọc **duy nhất đối xứng theo thiết kế**. `GET_LOCK`/`RELEASE_LOCK` vẫn dùng kết nối trần (khoá tên do *kết nối* giữ, không phải pool) — và cả hai câu lệnh đó không chạm tới ngày tháng. Có `tests/view-boost-integration.test.ts` chặn: nó nối MySQL thật, ghi rồi đọc lại một lượt 60 phút và bắt buộc tick đầu chỉ giao đúng phần tỉ lệ theo thời gian.
  - **Trang quản trị không bao giờ hiện mỗi tổng.** Modal thống kê luôn tách ba ô: tổng hiển thị / lượt xem thật / lượt xem ảo. Bảng nguồn truy cập chỉ tính lượt thật và **loại `boost` ra** — nó không phải một nguồn truy cập.
  - **Bắt đầu từ 0, không có backfill.** Không có dữ liệu lịch sử nào để suy ra lượt xem trước ngày triển khai, nên mọi bài viết cũ khởi điểm từ 0 và số liệu chỉ có ý nghĩa từ lúc bật. **Không** đăng ký với `data-retention.ts` (D14): hai bảng này không chứa địa chỉ, user agent hay bất cứ thứ gì định danh một người — `article_view_daily` là số đếm theo ngày, `article_view_boost` ghi hành động của chính cán bộ.
- **Lưu trữ dữ liệu cá nhân** (`server/services/data-retention.ts`): `activity_logs` mặc định 365 ngày; `submissions` mặc định **0 = không tự xoá** vì thời hạn lưu hồ sơ công dân do quy định của cơ quan quyết định; `chat_sessions` mặc định 90 ngày. Xem mục "Tự động dọn dữ liệu" ngay dưới đây — từ nay việc dọn **tự chạy trong tiến trình**, dòng cron chỉ còn là tuỳ chọn.
- **Tự động dọn dữ liệu** (`/admin/settings/data-retention`, quyền `settings.read` để xem / `settings.update` để sửa): cán bộ tự đặt điều kiện dọn cho **ba** bảng chứa dữ liệu cá nhân mà không cần vào máy chủ — `activity_logs`, `submissions`, `chat_sessions`.
  - **`RETENTION_SCOPES` và `SCOPE_SETTINGS` là một bảng do trình biên dịch kiểm, không phải chuỗi ternary.** Bản đầu viết `scope === 'activity_logs' ? … : …`, nghĩa là **mọi** scope khác đều đọc thành "submissions" — thêm scope thứ ba là gán khoá cấu hình của đơn đăng ký cho lịch sử chat, tức một cửa sổ dọn sửa sai bảng mà không có lỗi nào. `Record<RetentionScope, …>` buộc scope mới phải khai đủ khoá CSDL / biến môi trường / bounds trước khi biên dịch được.
  - **Mỗi bảng già theo cột riêng của nó** (`TABLE_COLUMNS` trong `data-retention.ts`): `activity_logs`/`submissions` dùng `created_at`; `chat_sessions` dùng **`last_message_at`** — bảng này **không có** `created_at`, và một hội thoại kết thúc khi tin cuối rơi vào chứ không khi nó mở ra. Cột sắp xếp cũng theo bảng: `chat_sessions.id` là **UUID** nên `ORDER BY id` là thứ tự từ điển, tức "cũ nhất trước" của cap sẽ đuổi một tập hội thoại tuỳ ý; nó xếp theo `last_message_at`.
  - **`chat_messages` cố ý KHÔNG phải một scope.** FK `chat_messages.session_id` có `ON DELETE CASCADE` nên tin nhắn đi theo phiên. Cho nó cửa sổ riêng là tạo ra hai lỗi mới: cửa sổ tuổi sẽ xoá tin nhắn trong khi hàng phiên còn sống và vẫn khai có N tin, còn cap số bản ghi sẽ **cắt ngang một hội thoại** — nửa còn lại là bằng chứng đọc ra nghĩa khác hẳn.
  - **Hai điều kiện độc lập, tắt riêng bằng `0`, chạy theo thứ tự cố định**: (1) **tuổi** — cột thời gian của bảng cũ hơn số ngày lưu, là giới hạn *chính sách*; (2) **số bản ghi tối đa** — xoá phần vượt, cũ nhất trước, là giới hạn *dung lượng*. Tuổi chạy trước để cái cap chỉ phải dọn phần một đợt cao điểm vừa thêm vào. Chỉ có cap thì một ngày bận sẽ xoá mất nhật ký của sáng nay; chỉ có tuổi thì không chặn nổi bảng đầy nhanh hơn cửa sổ lưu. Phần vượt cap được **đo một lần lúc bắt đầu**: đếm lại giữa các lô sẽ để bản ghi mới đến trong lúc chạy đẩy việc xoá lấn vào những dòng còn nằm trong cap khi lượt chạy bắt đầu. Nếu lượt xoá theo tuổi **đã đụng trần số lô** thì bỏ qua cap luôn — bảng đang co, đếm giữa lúc đó sẽ xoá quá cap.
  - **Sổ ghi `data_retention_state`** (bảng thứ 32, một dòng mỗi bảng bị dọn): `purged_total` là bộ đếm **cộng dồn** (`purged_total = purged_total + VALUES(purged_total)`), ghi **trước khi** bản ghi biến mất. Đây là lý do bảng này tồn tại: xoá xong rồi thì một lượt dọn thành công trông y hệt một lượt chưa bao giờ chạy. **Tổng đã qua = `purgedTotal` + số bản ghi đang lưu**, hiện trên cả trang này và trang lịch sử hoạt động. `last_run_at` là cách bộ đếm lịch biết hôm nay đã chạy rồi, nên restart không kéo theo dọn lại mỗi lần khởi động.
  - **Bộ đếm lịch trong tiến trình** (`server/services/retention-scheduler.ts` + `server/plugins/retention-scheduler.ts`): tick 15 phút, quyết định do hàm **thuần** `isRunDue(policy, now, lastRunAt)` đưa ra (tắt công tắc → `disabled`; chưa chạy lần nào → chạy ngay, không đợi đến giờ đã đặt, vì lượt đầu thường là lượt dọn tồn đọng nhiều năm; quá 36 giờ → `stale`, bù cho một đêm bị bỏ; đúng giờ và khác ngày với lượt trước → chạy). Mặc định **bật ở production, tắt ở dev** (`RETENTION_SCHEDULER=1|0`) — một lượt dọn im lặng khi đang xem dữ liệu seed là mất chính dữ liệu đang xem. Timer `unref()` và lượt đầu hoãn 60 giây (lúc boot CSDL có thể chưa nối được, init/seed còn đang chạy); lỗi trong tick bị **nuốt có chủ đích** thành `retention.scheduler_failed` — một unhandled rejection trong worker đổi một lượt dọn trượt thành một lần sập.
  - **Một khoá cho mọi đường vào**: khoá tên MySQL `cdkt:data:retention` với timeout `0` (không xếp hàng, ai không lấy được thì bỏ lượt). Nhờ đó bộ đếm lịch + dòng cron + nút "Dọn ngay" **không thể xoá trùng**, và giữ lại dòng cron cũ vẫn an toàn.
  - **Ba đường vào, ba mức bỏ qua khác nhau**: `runRetentionPass()` (bộ đếm lịch, kiểm đủ mọi thứ); `{ ignoreSchedule: true, trigger: 'cron' }` (cron — lịch của nó là dòng crontab nên `runHour` vô nghĩa, **nhưng vẫn tôn trọng công tắc**, nếu không thì công tắc là lời nói dối); `{ force: true, trigger: 'manual' }` (chỉ cho nút "Dọn ngay", vì người bấm đã tự quyết định điều mà công tắc mã hoá). Nút này là **POST + `confirm: true` + khoá**, và **cửa sổ dọn vẫn do cấu hình đã lưu quyết định** — người vận hành kích hoạt một lượt chạy, không truyền được cửa sổ vào như tham số. Lượt `force` bị từ chối chỉ có thể vì khoá đang bị giữ, nên trả **409** thay vì báo thành công với 0 bản ghi (đọc thành "không có gì để xoá" là sai).
  - **Thứ tự ưu tiên CSDL → biến môi trường → mặc định**, và **mỗi ô tự khai nguồn** (`database` / `environment` / `default`) ngay trên trang. Không có phần khai nguồn này thì sửa `.env` rồi không thấy gì thay đổi là một ngõ cụt im lặng. Khoá cấu hình (`retention_*`) **không nằm trong `ALLOWED_SETTING_KEYS`**: giá trị quyết định xoá gì phải đi qua endpoint riêng có kiểm tra, không phải qua form key/value tự do. `saveRetentionPolicy` **kiểm hết mọi trường trước khi ghi bất cứ gì** — một giờ chạy đã lưu kèm một cửa sổ bị từ chối sẽ thành xoá theo lịch không ai cấu hình. Mọi lần sửa ghi audit `update data_retention` kèm giá trị trước/sau: "ai đã rút ngắn thời hạn lưu nhật ký kiểm toán, từ bao nhiêu xuống bao nhiêu" đúng là câu hỏi bảng này phải trả lời được về chính nó.
- **Lịch sử hoạt động toàn hệ thống** (`/admin/users/activity`): hai trang lịch sử phục vụ hai mục đích khác nhau và **không thay thế nhau**. `/admin/profile` trả lời "tôi đã làm gì" — danh tính lấy từ phiên, không cần quyền RBAC nào, ai cũng tự soi được mình. Trang này trả lời "mọi người đã làm gì" — lọc theo tài khoản / hành động / đối tượng / khoảng ngày, nên **bắt buộc quyền `users.read`** (`requireResourcePermission`), là chính quyền đã cho xem danh sách tài khoản. Mỗi lượt xem **tự ghi một dòng** `read activity_logs` kèm bộ lọc đã dùng: một nhật ký quét được trong im lặng là công cụ theo dõi, không phải nhật ký kiểm toán. Truy vấn dùng `leftJoin` sang `users` để dòng log của tài khoản **đã bị xoá vẫn còn** — đó đúng là dấu vết cần giữ nhất. Chỉ ba khoá trong `meta` được lộ ra (`ip`, `userAgent`, `mfaMethod`), không trả cả cột JSON.
  - **Tình trạng dọn log hiện ngay trên trang** (`server/api/admin/activity-logs/retention.get.ts`): tổng số bản ghi, bản ghi cũ nhất, thời hạn lưu, và **số bản ghi quá hạn chưa bị xoá**. Endpoint này **chỉ đọc**, không bao giờ gọi `runDataRetention` — một lệnh xoá gọi được bằng GET sẽ mất dữ liệu kiểm toán chỉ vì ai đó bấm F5. `overdue > 0` là triệu chứng quan sát được của việc dọn dẹp **không diễn ra** — công tắc tự động đang tắt, chưa đặt điều kiện nào, hoặc một lượt chạy đang lỗi. Endpoint đọc **chính sách có hiệu lực** (`resolveRetentionPolicy`) chứ không đọc thẳng biến môi trường: nếu không, giá trị cán bộ vừa sửa trong form và con số trang này báo sẽ nói hai điều khác nhau. Số ngày lưu bằng 0 **và** cap bằng 0 là "sẽ không bao giờ xoá gì" (`purgeDisabled`) và trang nói rõ điều đó thay vì báo an toàn. Cấu hình đặt tại `/admin/settings/data-retention`.
- **Log có cấu trúc** (`server/utils/logger.ts`): mỗi sự kiện một dòng JSON, tự che các trường có tên gợi ý bí mật. `SECURITY_EVENTS` là danh sách sự kiện an ninh để viết cảnh báo (`auth.login_failed`, `auth.login_rate_limited`, `auth.session_revoked`, …).
- **Sao lưu** (`scripts/backup-db.sh`, `scripts/verify-restore.sh`): dump → kiểm chứng (dấu kết thúc, số bảng, dung lượng SQL) → xoay vòng. Bản không đạt bị **xoá** thay vì để lại trông như bản tốt.
- **Cấp phát RAM cho container** (`npm run check:resources` → `scripts/check-resources.sh`, chạy **trên máy chủ**): `MYSQL_MEM_LIMIT`/`APP_MEM_LIMIT` mặc định `1g/1g` chọn cho VPS 1–2 GB và **không tự lớn lên khi máy chủ được nâng cấp**. Đây không phải lỗi thấy được: MySQL đọc giới hạn **cgroup** chứ không đọc RAM máy chủ để tính InnoDB buffer pool, nên trên một VPS 8 GB nó chỉ đơn giản là chậm hơn mức đáng ra phải có, mãi mãi, mà không có gì báo. Chiều ngược lại cũng thật — nới trần trên máy còn chạy dự án khác thì OOM-killer hạ một container **khác**, nạn nhân không phải thủ phạm — nên script đếm cả container của hàng xóm trước khi đề xuất. Chỉ **đọc**: in ra hai dòng để dán vào `.env`, không sửa gì, không khởi động lại gì. Thoát `2` khi nên chỉnh, `0` khi trần đang hợp lý.
  - **Cố ý không đề xuất trần CPU.** Vượt RAM là bị giết nên phải có trần; vượt CPU chỉ là chờ tới lượt. Cả hai container đo được gần 0% lúc bình thường, nên một trần CPU chỉ làm chậm đúng những lượt cần nhanh nhất (khởi động, sao lưu, dọn dữ liệu) mà không đổi lại được gì.
- **CI** (`.github/workflows/ci.yml`): mỗi push chạy test, kiểm drift schema, build thật, và một job vệ sinh (chặn `.env` bị commit, private key, secret mặc định cũ).

### Hạn chế đã biết

- **Đa ngôn ngữ mới xong phần khung.** `app/composables/useI18n.ts` có 209 khoá và bộ chuyển ngôn ngữ hoạt động, nhưng chỉ `app/layouts/default.vue` dùng — **toàn bộ nội dung trang vẫn là tiếng Việt**. Khách chuyển sang tiếng Anh sẽ thấy menu tiếng Anh bọc quanh nội dung tiếng Việt. Hai lối đi: bỏ nút chuyển ngôn ngữ (cổng thông tin chỉ phục vụ tiếng Việt), hoặc dịch cả nội dung CMS (cần thêm cột/bản ghi theo ngôn ngữ). Chưa chọn hướng nào nên chưa đụng vào.
- ~~**Typecheck mới ở chế độ báo cáo.**~~ **Đã xong**: `npm run typecheck` (→ `nuxt typecheck`) sạch 0 lỗi và job CI `Types` là **cổng chặn** (không còn `continue-on-error`). `typescript@^5` + `vue-tsc` đã là devDependency thật, lockfile đã sinh lại. **Ghim TypeScript ^5**: bản 7.x là bản viết lại bằng Go, không còn export `lib/tsc.js` mà vue-tsc cần lúc khởi động. Lần chạy đầu phát hiện 598 lỗi; hai nhóm lớn nhất được sửa tận gốc chứ không vá từng chỗ: `getDb()` khai báo kiểu trả về (`server/utils/db.ts`, 389 lỗi) và `tryRuntimeConfig()` (`server/utils/runtime-config.ts`) thay cho 5 chỗ tự dò `globalThis.useRuntimeConfig`.
- **Test phần lớn không chạm hệ thống thật.** **Năm** tệp `*-integration` nối MySQL thật (`analytics-ddl-integration`, `chatbot-ddl-integration`, `mfa-email-code-integration`, `view-boost-integration`, `chat-retention-integration` — mỗi tệp một biến môi trường cổng riêng, tự tạo và tự xoá database dùng một lần); phần còn lại kiểm logic thuần hoặc kiểm văn bản mã nguồn. Loại sau chặn được việc xoá nhầm một guard, **không** chứng minh guard đó chạy đúng.
  - **Cả năm tệp nay chạy trong CI** (`.github/workflows/ci.yml` có service MySQL 8.0 + đủ năm bộ biến `*_DDL_*` / `*_INTEGRATION`). Trước đó chúng chỉ chạy khi ai đó nhớ bật cờ trên máy mình — tức là một suite bị **bỏ qua trong im lặng**: `npm test` vẫn xanh, và `# skipped 4` là dòng duy nhất nói lên điều đó. Nay có thêm bước **"Fail if an integration suite skipped"**: nó đối chiếu `tests/*-integration.test.ts` với danh sách công tắc đã khai, nên **thêm một tệp integration mà quên khai công tắc là CI đỏ** thay vì lặng lẽ báo SKIP.
  ```bash
  # Vòng đời mã OTP email (mã đúng / sai / hết hạn / hết lượt / gửi lại)
  MFA_DDL_INTEGRATION=1 MFA_DDL_PORT=3306 MFA_DDL_USER=root MFA_DDL_PASSWORD=... npm test

  # Lịch cộng dần lượt xem: started_at/ends_at đi qua MySQL rồi về không lệch múi giờ
  VIEW_BOOST_INTEGRATION=1 VIEW_BOOST_PORT=3306 VIEW_BOOST_USER=root VIEW_BOOST_PASSWORD=... npm test

  # Dọn phiên chat: già theo last_message_at, cascade sang chat_messages, cap xếp theo thời gian
  CHAT_RETENTION_INTEGRATION=1 CHAT_RETENTION_PORT=3306 CHAT_RETENTION_USER=root CHAT_RETENTION_PASSWORD=... npm test
  ```
  - **⚠️ Chạy tay thì đừng `source` cả tệp env của docker.** Làm vậy sẽ export luôn `CHATBOT_ENCRYPTION_SECRET`, và hai suite fail-closed (`chatbot-persistence-secrets`, `chatbot-startup-secret`) đọc biến đó thành "production đã có bí mật" rồi báo đỏ — hai lỗi giả không liên quan gì tới thay đổi đang làm. Chỉ export đúng các biến `*_INTEGRATION` / `*_PORT` / `*_USER` / `*_PASSWORD`.
- **Kiểm thử trình duyệt có framework — nhưng chưa phủ hết.** `@playwright/test 1.62.1` là devDependency; `npm run test:e2e` (cần `npm run build` trước) khởi một cổng dùng một lần với DB throwaway và chạy `tests/e2e/admin-retry.spec.ts` (Chromium). **Đã tự động hoá:** cú bấm "Thử lại" có thực sự phát lại request hay không — trên hai hình dạng trang đại diện (`data-retention.vue` dạng form và `submissions/index.vue` dạng bảng). **Vẫn chỉ kiểm bằng tay:** luồng bật TOTP, hiện mã dự phòng một lần, bước xác thực ở trang đăng nhập. Bốn mục `8.3–8.6` trong `openspec/changes/archive/2026-07-28-admin-self-service-security/tasks.md` để trống vì lý do này, không phải vì chưa làm.
  - **Phần kiểm được bằng văn bản mã nguồn thì đã kiểm** (`tests/admin-error-retry-ui.test.ts`, `tests/skeleton-loading-ui.test.ts`): các suite này `parse()` từng SFC bằng `@vue/compiler-sfc` và soi cây template — không mount component nào. Chúng chứng minh được **cấu trúc** (có nhánh lỗi, có `role="alert"`, nút thử lại trỏ vào một hàm khai báo trong cùng tệp, không còn `location.reload()`), **không** chứng minh được **hành vi** lúc chạy. Ranh giới đó là chủ đích, không phải thiếu sót: một khẳng định về văn bản mã nguồn không bao giờ nên được đọc thành khẳng định về thứ người dùng thấy.
  - **`npm run test:e2e` cần build trước và một MySQL đang chạy.** `tests/e2e/global-setup.ts` tạo DB throwaway, seed SuperAdmin, chờ server sẵn sàng — rồi teardown toàn bộ. Biến bắt buộc: `E2E_DB_PORT` (mặc định 3306), `E2E_DB_USER` (mặc định root), `E2E_DB_PASSWORD`. Trên máy dev dùng container docker: `E2E_DB_PORT=33069 E2E_DB_USER=root E2E_DB_PASSWORD=... npm run test:e2e`.

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
- **Hai kho tách biệt: kho nghiệp vụ và kho trả lời thường nhật.** Chatbot có hai nguồn trả lời độc lập ở tầng lược đồ, ranh giới do trình biên dịch giữ chứ không do ai phải nhớ:
  - **Kho nghiệp vụ** (`chatbot_knowledge`, không đổi): mỗi câu là phát ngôn pháp lý, có luồng duyệt nháp→published và bắt buộc có nguồn (`validatePublish`). Đây là kho **luôn được ưu tiên**.
  - **Kho trả lời thường nhật** (`chatbot_small_talk`, bảng thứ 31): dữ liệu **quản lý được** tại `/admin/chatbot/small-talk` — cán bộ sửa lời văn, bật/tắt, thêm mục mà không cần deploy. KHÔNG có luồng duyệt, KHÔNG bắt nguồn. Năm nhóm: `social` (xã giao), `identity` (danh tính & năng lực bot), `navigation` (điều hướng cổng), `support` (hỗ trợ cảm xúc — mọi câu phải điều hướng về Công an xã/phường hoặc hotline, không tư vấn tâm lý, không hứa kết quả), `portal_facts` (thường thức về chính cổng). Dataset mặc định ~121 mục ở `server/data/chatbot-small-talk-seed.ts`, nạp **insert-only** qua `seed.ts` (khoá trên câu hỏi đã chuẩn hoá) nên lời văn cán bộ đã sửa sống qua mọi lần khởi động lại. Số hotline luôn nội suy từ hằng `CHATBOT_HOTLINE`, không viết cứng.
  - **Matcher** (`server/utils/chatbot/small-talk.ts`) là **hàm thuần** `matchSmallTalk(entries, query)`: nhận mục đã nạp từ CSDL + câu hỏi, trả `{ id, category, answer } | null`. Ba tầng khớp theo độ đặc hiệu giảm dần: khớp chính xác câu đã chuẩn hoá → khớp chính xác một pattern → pattern xuất hiện trọn vẹn dưới dạng chuỗi token liên tiếp (pattern dài hơn thắng; hoà thì `displayOrder` rồi `id`). Từ ngắn dễ nhầm (≤4 ký tự không dấu như "duoc", "oi", "ok", "da") chỉ khớp khi **là toàn bộ tin nhắn**. Chốt độ dài nới rộng (≤120 ký tự / ≤20 token) chỉ là lưới an toàn cuối, không phải cơ chế khớp chính — nhờ đó câu đời thường dài như "cho tôi hỏi dùng dịch vụ này có mất phí không ạ" (11 từ) vẫn khớp được.
  - **Công tắc** `small_talk_enabled` (**mặc định bật**, cột vắng đọc là bật): chỉ nạp kho thường nhật khi kho nghiệp vụ **không khớp gì** và công tắc bật (kiểm công tắc TRƯỚC khi query, nên tắt thì không tốn round-trip). Ở chế độ AI cũng chặn trước khi gọi provider. `knowledgeGreeting` được prepend cho mọi nhóm TRỪ `social` (tránh chào hai lần). Loại phản hồi `kind: 'small_talk'`. Tắt công tắc → trả về đúng hành vi cũ (xin thông tin liên hệ). RBAC dùng chung resource `chatbot_knowledge` (không tạo resource mới).
  - **Điều kiện tiên quyết đã sửa:** ngưỡng khớp chuỗi con cho từ khoá một từ trong `retrieval.ts` nâng từ `>= 3` lên `>= 4`. Với ngưỡng 3, từ khoá "thủ" (không dấu `thu`) khớp token "thức" (`thuc`), nên câu đời thường khớp sai vào kho nghiệp vụ → `references` không rỗng → matcher thường nhật không bao giờ chạy. Âm tiết tiếng Việt không dấu phần lớn dài 2-3 ký tự nên ngưỡng 4 cắt đúng nhóm đó mà giữ khớp tiền tố có nghĩa ("giấy tờ" ↔ "giấy tờ tùy thân", 7 ký tự).
- **Để lại thông tin liên hệ**: khi không có câu trả lời (cả 2 chế độ), widget mời khách để lại họ tên/SĐT/email → lưu vào `/admin/submissions` và gửi email qua SMTP (người nhận lấy từ cấu hình phía server, không nhận từ client).
- **Nhập câu hỏi từ Excel** (`/admin/chatbot/knowledge` → "Nhập từ Excel"): đọc `.xlsx`/`.csv` cột `STT · Câu hỏi · Trả lời · Ghi chú`, tự tách từ khoá tiếng Việt (từ đơn + cụm 2 từ) để khớp câu hỏi đời thường. Trình đọc XLSX tự viết (`server/utils/xlsx-reader.ts`), không phụ thuộc thư viện ngoài. Mặc định nhập vào trạng thái Bản nháp chờ duyệt.
- **Câu hỏi nhanh quản trực tiếp trên danh sách** (`/admin/chatbot/knowledge`): cột "Câu hỏi nhanh" bật/tắt tại chỗ (PUT qua route sửa thường, nên vẫn chịu mọi quy tắc vòng đời và vẫn ghi audit), thanh hành động hàng loạt có "Đưa vào / Bỏ khỏi câu hỏi nhanh" (`bulk-quick-question.post.ts`, cần quyền `update`), và bộ lọc ba trạng thái `quick=`(rỗng)`|yes|no`. Giá trị lạ bị **từ chối** chứ không suy diễn — `quick=1` đọc thành "yes" sẽ hiện danh sách đã lọc trong khi ô chọn vẫn ghi "Tất cả". Cờ này **không tự xuất bản**: widget chỉ đọc `status='published' AND is_quick_question=1`, nên gắn cờ cho bản nháp chỉ là xếp lịch cho lúc nó được xuất bản.

- **Phiên trò chuyện: chữ ra từ từ, nhiều cuộc hội thoại, trang toàn màn hình, lưu SQL** — bốn thứ này ăn khớp nhau qua **một** composable `app/composables/useChatbot.ts`. Widget (`app/components/ChatWidget.vue`) và trang `/tro-ly` là hai bề mặt của cùng một state ở **cấp module**, không phải state theo từng lời gọi: khách bấm nút mở rộng giữa cuộc hội thoại phải rơi vào đúng cuộc đó, không phải một cuộc mới.
  - **"Chữ ra từ từ" là hiệu ứng phía client, không phải streaming truyền tải.** `/api/public/chatbot` đợi xong cả câu trả lời rồi phát **một** sự kiện SSE — nó luôn làm vậy, và đổi thành streaming token thật sẽ phải viết lại từng provider. `playTypewriter` tách chữ bằng `fullText.match(/\S+\s*/g)` — **giữ nguyên dấu phân cách** nên chuỗi ghép lại giống hệt từng byte; `split(' ')` sẽ gộp mất dòng mới và **âm thầm định dạng lại văn bản pháp luật** trên đường ra màn hình. Tôn trọng `prefers-reduced-motion` (hiện ngay). Trong lúc chạy, `isStreaming` **che nhãn loại trả lời, danh sách nguồn và biểu mẫu để lại liên hệ** — ba thứ này xuất hiện giữa lúc chữ đang chạy sẽ trông như câu trả lời đã xong khi nó chưa xong. `persist()` **bỏ qua** tin nhắn còn `isStreaming`: tải lại trang mà phục hồi một câu mới gõ được nửa thì không còn gì để gõ tiếp.
  - **Vé phiên do máy chủ cấp, không phải client tự ký** (`server/utils/chatbot/session-token.ts`, `POST /api/public/chatbot/session`): `<uuid>.<hmac>` với hmac là `HMAC-SHA256(ANALYTICS_HMAC_SECRET, uuid)` cắt còn 32 hex, so bằng `timingSafeEqual`. Trình duyệt **không thể** tự tính HMAC mà không giữ bí mật, và gửi bí mật xuống trình duyệt là làm chữ ký thành vô nghĩa — ai cũng ký được mọi thứ. Vé này là **khoá tương quan, không phải xác thực**: cổng chat không cần đăng nhập và sẽ không bao giờ cần. Chữ ký mua đúng một thứ — không ai chèn được tin nhắn vào một `sessionId` mà họ không được cấp, nên một bản ghi hội thoại không bị trộn tin của người khác và trang quản trị không bị gieo hội thoại giả. Bỏ header đi thì khách chỉ mất bản ghi **của chính họ**.
  - **Bẫy bot `_h`** (honeypot, nằm ngoài thứ tự tab): điền vào thì trả **200 kèm một câu trả lời hợp lý**, không bao giờ 400/403 — mã trạng thái khác sẽ chỉ cho con script biết đúng ô nào đã tố nó.
  - **Giới hạn tần suất đã chuyển sang bảng `rate_limit_counters`** (`chat-policy.ts` — `Map` trong tiến trình đã bị **xoá**): sống qua restart, đúng khi chạy nhiều replica, mất CSDL thì lùi về bộ nhớ tiến trình chứ không mở toang. Hạn mức AI **tính theo phiên** (20 lượt / 60 phút) và **trừ ngay trước mỗi lời gọi provider**, không trừ ở đầu handler: trừ trước sẽ tiêu hạn mức cho những câu trả lời lấy từ kho mà không hề gọi provider, rồi cắt một người chưa dùng gì. Hết hạn mức mà **đã có tham chiếu trong tay** thì lùi về câu trả lời đã duyệt — câu đã duyệt vẫn là câu trả lời; chỉ nhánh hỏi tự do mới trả `rate_limited`.
  - **Ghi CSDL được `await`, không bắn rồi bỏ** (`session-db.ts`): Nitro có thể dỡ context của request khi handler trả về, cắt một promise rời tay giữa lúc truy vấn. Hàm **tự nuốt lỗi của mình** (`chat_session.persist_failed`) nên `await` không thể làm hỏng câu trả lời — một bộ ghi log không có tư cách làm sập trang của khách. `ON DUPLICATE KEY UPDATE` **không chạm `started_at`**: một phiên bắt đầu đúng một lần. Số điện thoại / họ tên phát hiện được ghi bằng `COALESCE` nên tên nêu ở lượt 2 và số nêu ở lượt 5 **cùng sống**, chứ không xoá nhau.
  - **Trang quản trị `/admin/chatbot/sessions`** dùng chung quyền `chatbot_knowledge.read` — ai được đọc kho câu trả lời đã duyệt thì cũng được đọc câu hỏi khách đặt cho nó; tạo resource mới là buộc cấp lại quyền cho mọi vai trò đang có trước khi trang chạy được. **Mọi lượt xem tự ghi một dòng `activity_logs`** kèm bộ lọc: những hàng này chứa địa chỉ IP và có khi cả số điện thoại, và một nhật ký quét được trong im lặng là công cụ theo dõi. Trang chi tiết **đối chiếu số điện thoại với `submissions`** bằng 9 chữ số cuối (`REGEXP_REPLACE` + `RIGHT`) chứ không so chuỗi thô — biểu mẫu nhận cả `0903 480 985`, `+84903480985` và `0903480985` là cùng một số, nên so thẳng sẽ trượt gần hết ca thật. Đây là lý do việc phát hiện số điện thoại tồn tại: một người hỏi bot rồi sau đó gửi biểu mẫu là **một người với một vấn đề**, và cán bộ không thấy được cả hai nửa sẽ gọi lại hỏi đúng thứ họ đã gõ.
  - **Phát hiện liên hệ cố tình bảo thủ** (`contact-detect.ts`): chỉ nhận đầu số di động (`03/05/07/08/09`, đúng 10 số) — số cố định **cố ý loại ra**, và số căn cước / số nghị định không được ghi thành số liên hệ. Tên chỉ nhận khi có động từ giới thiệu tường minh ("tôi tên", "em là"); đoán tên theo chữ hoa sẽ sai liên tục trong tiếng Việt, và một cái tên sai gắn vào phiên còn tệ hơn không có tên. Tiểu từ cuối câu bị cắt (`ạ`, `nhé`, `ơi`, …) nhưng **"a" không dấu thì không** — "Nguyễn Văn A" là cách viết tên phổ biến nhất, cắt chữ "A" đó sẽ phá nhiều tên hơn số tiểu từ dọn được.
  - **Đã đăng ký với `data-retention.ts`** (`chat_sessions` là scope thứ ba, mặc định 90 ngày, cấu hình tại `/admin/settings/data-retention`). Hai bảng này chứa IP, user agent và có khi cả số điện thoại — đúng loại dữ liệu cần thời hạn lưu. Bảng già theo **`last_message_at`** chứ không phải `started_at` (bảng không có `created_at`), và cap sắp xếp theo cùng cột đó vì `id` là UUID. `chat_messages` **không** có cửa sổ riêng: FK `ON DELETE CASCADE` đã dọn nó theo phiên, còn một cửa sổ độc lập sẽ để lại tin nhắn mồ côi hoặc cắt ngang hội thoại. Chi tiết ở mục "Tự động dọn dữ liệu".

### 4. Bảo mật (bắt buộc khi triển khai)
- **Bí mật BẮT BUỘC ở production** — thiếu là app từ chối khởi động (`server/plugins/require-secrets.ts`): `JWT_SECRET`, `CHATBOT_ENCRYPTION_SECRET`, `ANALYTICS_HMAC_SECRET`. Không còn giá trị mặc định trong mã nguồn hay `docker-compose.yml`.
- **Chống leo thang đặc quyền**: chỉ SuperAdmin được gán vai trò hệ thống; không ai cấp được quyền mà chính mình chưa có (`server/utils/permissions.ts`).
- **Chống stored XSS**: nội dung bài viết và rich-text của block được làm sạch phía server (`server/utils/sanitize-html.ts`) ở mọi đường ghi. Khóa `tracking_custom_head/body` (chèn JS toàn site) chỉ SuperAdmin sửa được.
- **Upload**: đuôi tệp suy từ MIME đã kiểm bằng magic-byte; SVG không bao giờ được phục vụ inline.
- **Xác thực hai bước tự phục vụ** (`/admin/profile`): ba yếu tố bật tắt độc lập (ứng dụng xác thực / mã về email / mật khẩu cấp 2), mã dự phòng tuỳ chọn, break-glass chỉ SuperAdmin. Xem "Vận hành & an toàn" ở trên, **đặc biệt là runbook xoay `JWT_SECRET`** — xoay khoá này làm mọi secret TOTP đã lưu hết dùng được.

### 5. Khởi tạo Cơ sở dữ liệu & Docker
- **MySQL Database Auto-Init (`server/db/init.ts`)**: Tự động kết nối server MySQL, tạo database `cdkt_admin` và toàn bộ 36 bảng dữ liệu nếu chưa tồn tại (idempotent, tự thêm cột còn thiếu).
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
# Sinh bằng: openssl rand -base64 18
# KHÔNG được chứa chuỗi "admin" (tên tài khoản seed) — "Admin@..." sẽ bị từ chối.
ADMIN_PASSWORD=
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

### 4. Bảo trì định kỳ (cron — nay là tuỳ chọn)
**Dọn dữ liệu cá nhân** (`activity_logs`, `submissions`) đã **tự chạy trong tiến trình** ở production, cấu hình tại `/admin/settings/data-retention`. Không cần cron cho phần này nữa.

**Gộp analytics** (`analytics:maintenance`) thì **vẫn không tự chạy** — thiếu cron là dữ liệu analytics thô phình vô hạn:
```bash
0 3 * * * cd /duong/dan/CDKT && npm run analytics:maintenance >> /var/log/cdkt-analytics.log 2>&1
```
Dòng cron này cũng chạy luôn một lượt dọn dữ liệu. Giữ nó song song với bộ đếm lịch **an toàn** vì cả hai đi qua cùng một khoá `cdkt:data:retention`, và nó **tôn trọng công tắc tự động dọn**: tắt công tắc thì cron cũng không xoá gì.

---

## 🛡️ Tài Khoản Đăng Nhập Mặc Định

- **URL Admin**: `http://localhost:3000/admin` (hoặc `https://domain-cua-ban.com/admin`)
- **Tài khoản**: `admin`
- **Mật khẩu**: lấy từ `ADMIN_PASSWORD` lúc khởi tạo lần đầu. **Không còn giá trị mặc định** — để trống thì seed dừng (exit 1).

> ⚠️ **Đổi mật khẩu admin ngay sau lần đăng nhập đầu tiên.** Bản hash của mật khẩu mặc định từng nằm trong `migrations/002_seed_data.sql` của repo nên phải coi như đã lộ.

When asked about the codebase, project structure, or to find code, always use the context-engine MCP tool (codebase-retrieval) in the root workspace first before reading individual files. Use `codebase-retrieval` instead of the Explore subagent for codebase exploration and search tasks.

When you need to read a specific file but don't know the exact line range, use the file-retrieval MCP tool instead of reading the entire file. Describe what information you need and it returns only the relevant snippets with line numbers. Use the Read tool with the returned line ranges (expanded as needed) to get current content before making edits.

---

## 🗣️ Quy Tắc Giao Tiếp & Làm Việc (Interaction Rules)

- **Xưng hô**: Always address the user as **"anh yêu"** in every reply.
- **Ngôn ngữ**: Always **think/reason in English**, but always **reply to the user in Vietnamese**.
- **Truy xuất dữ liệu**: Always use the **MCP context-engine (`codebase-retrieval`)** to retrieve codebase data. Do **NOT** use gitnexus or grep for codebase exploration and search.
