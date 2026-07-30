# Con Đường Hướng Thiện (CDKT) - System Documentation & Changelog

UI/UX work must read `openspec/ui-dna.md` (or the existing DNA doc) before any visual change.

Cổng thông tin điện tử hỗ trợ người hoàn lương tái hòa nhập cộng đồng — Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.

---

## 🛠️ Công Nghệ Sử Dụng (Tech Stack)

- **Frontend**: Nuxt 4 (Vue 3 SFC, TypeScript, Composition API), **Tailwind CSS v3** (via `@nuxtjs/tailwindcss`), FontAwesome 6 Pro (local self-hosted).
- **CSS Rule**: **Tất cả code mới phải dùng Tailwind CSS v3 utility classes.** Không viết `<style scoped>` hay CSS tùy chỉnh cho component/page mới — ngoại lệ duy nhất là pseudo-element (`::before`), keyframes, hoặc `:deep()` rich-text không biểu diễn được bằng utility. CSS cũ (pre-Tailwind) vẫn giữ nguyên, không xóa — sẽ migrate dần sau. (Đã migrate Tailwind v4 → v3 ở commit `a02ca17`.)
- **Backend / API**: Nuxt Server Engine (Nitro / H3), Drizzle ORM, MySQL 8.0 / MariaDB, JWT Auth (`cdkt_admin` HTTP-only Cookie).
- **Database**: MySQL 8.0 — **32 bảng** (15 CMS + 4 chatbot: 3 cũ + `chatbot_small_talk` kho trả lời thường nhật + 9 analytics + `rate_limit_counters` + 2 MFA: `user_mfa_factors`, `user_recovery_codes` + `data_retention_state` sổ ghi lượt dọn dữ liệu). Nguồn chân lý schema là `server/db/schema.ts` (Drizzle); `server/db/init.ts` là DDL chạy lúc khởi động (idempotent, tự thêm cột còn thiếu); `server/db/seed.ts` là seed **insert-only** — chạy lại KHÔNG ghi đè mật khẩu / ma trận quyền / cấu hình đã sửa.
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
        ├── login.vue            # Trang Đăng nhập Admin (kèm bước xác thực hai bước)
        ├── profile.vue          # Tài khoản của tôi: đổi mật khẩu, yếu tố thứ hai, lịch sử
        ├── content/
        │   ├── home.vue         # WordPress Gutenberg Style Home Block Editor (legacy)
        │   ├── pages/           # Page Builder: quản lý & dựng trang bằng block
        │   │   ├── index.vue    # Danh sách trang (tạo / xóa / badge trang hệ thống)
        │   │   └── [id].vue     # Trình dựng trang kéo-thả (block list, palette, edit drawer)
        │   └── articles/        # Quản lý Bài viết & Tin tức (CRUD)
        ├── chatbot/             # Trợ lý AI Chatbot
        │   ├── knowledge/       # Kho kiến thức nghiệp vụ (duyệt nháp→published, bắt buộc nguồn)
        │   ├── small-talk/      # Kho trả lời thường nhật (quản lý được, không duyệt, 5 nhóm)
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
- **Lưu trữ dữ liệu cá nhân** (`server/services/data-retention.ts`): `activity_logs` mặc định 365 ngày; `submissions` mặc định **0 = không tự xoá** vì thời hạn lưu hồ sơ công dân do quy định của cơ quan quyết định. Xem mục "Tự động dọn dữ liệu" ngay dưới đây — từ nay việc dọn **tự chạy trong tiến trình**, dòng cron chỉ còn là tuỳ chọn.
- **Tự động dọn dữ liệu** (`/admin/settings/data-retention`, quyền `settings.read` để xem / `settings.update` để sửa): cán bộ tự đặt điều kiện dọn cho hai bảng chứa dữ liệu cá nhân mà không cần vào máy chủ.
  - **Hai điều kiện độc lập, tắt riêng bằng `0`, chạy theo thứ tự cố định**: (1) **tuổi** — `created_at` cũ hơn số ngày lưu, là giới hạn *chính sách*; (2) **số bản ghi tối đa** — xoá phần vượt, cũ nhất trước, là giới hạn *dung lượng*. Tuổi chạy trước để cái cap chỉ phải dọn phần một đợt cao điểm vừa thêm vào. Chỉ có cap thì một ngày bận sẽ xoá mất nhật ký của sáng nay; chỉ có tuổi thì không chặn nổi bảng đầy nhanh hơn cửa sổ lưu. Phần vượt cap được **đo một lần lúc bắt đầu**: đếm lại giữa các lô sẽ để bản ghi mới đến trong lúc chạy đẩy việc xoá lấn vào những dòng còn nằm trong cap khi lượt chạy bắt đầu. Nếu lượt xoá theo tuổi **đã đụng trần số lô** thì bỏ qua cap luôn — bảng đang co, đếm giữa lúc đó sẽ xoá quá cap.
  - **Sổ ghi `data_retention_state`** (bảng thứ 32, một dòng mỗi bảng bị dọn): `purged_total` là bộ đếm **cộng dồn** (`purged_total = purged_total + VALUES(purged_total)`), ghi **trước khi** bản ghi biến mất. Đây là lý do bảng này tồn tại: xoá xong rồi thì một lượt dọn thành công trông y hệt một lượt chưa bao giờ chạy. **Tổng đã qua = `purgedTotal` + số bản ghi đang lưu**, hiện trên cả trang này và trang lịch sử hoạt động. `last_run_at` là cách bộ đếm lịch biết hôm nay đã chạy rồi, nên restart không kéo theo dọn lại mỗi lần khởi động.
  - **Bộ đếm lịch trong tiến trình** (`server/services/retention-scheduler.ts` + `server/plugins/retention-scheduler.ts`): tick 15 phút, quyết định do hàm **thuần** `isRunDue(policy, now, lastRunAt)` đưa ra (tắt công tắc → `disabled`; chưa chạy lần nào → chạy ngay, không đợi đến giờ đã đặt, vì lượt đầu thường là lượt dọn tồn đọng nhiều năm; quá 36 giờ → `stale`, bù cho một đêm bị bỏ; đúng giờ và khác ngày với lượt trước → chạy). Mặc định **bật ở production, tắt ở dev** (`RETENTION_SCHEDULER=1|0`) — một lượt dọn im lặng khi đang xem dữ liệu seed là mất chính dữ liệu đang xem. Timer `unref()` và lượt đầu hoãn 60 giây (lúc boot CSDL có thể chưa nối được, init/seed còn đang chạy); lỗi trong tick bị **nuốt có chủ đích** thành `retention.scheduler_failed` — một unhandled rejection trong worker đổi một lượt dọn trượt thành một lần sập.
  - **Một khoá cho mọi đường vào**: khoá tên MySQL `cdkt:data:retention` với timeout `0` (không xếp hàng, ai không lấy được thì bỏ lượt). Nhờ đó bộ đếm lịch + dòng cron + nút "Dọn ngay" **không thể xoá trùng**, và giữ lại dòng cron cũ vẫn an toàn.
  - **Ba đường vào, ba mức bỏ qua khác nhau**: `runRetentionPass()` (bộ đếm lịch, kiểm đủ mọi thứ); `{ ignoreSchedule: true, trigger: 'cron' }` (cron — lịch của nó là dòng crontab nên `runHour` vô nghĩa, **nhưng vẫn tôn trọng công tắc**, nếu không thì công tắc là lời nói dối); `{ force: true, trigger: 'manual' }` (chỉ cho nút "Dọn ngay", vì người bấm đã tự quyết định điều mà công tắc mã hoá). Nút này là **POST + `confirm: true` + khoá**, và **cửa sổ dọn vẫn do cấu hình đã lưu quyết định** — người vận hành kích hoạt một lượt chạy, không truyền được cửa sổ vào như tham số. Lượt `force` bị từ chối chỉ có thể vì khoá đang bị giữ, nên trả **409** thay vì báo thành công với 0 bản ghi (đọc thành "không có gì để xoá" là sai).
  - **Thứ tự ưu tiên CSDL → biến môi trường → mặc định**, và **mỗi ô tự khai nguồn** (`database` / `environment` / `default`) ngay trên trang. Không có phần khai nguồn này thì sửa `.env` rồi không thấy gì thay đổi là một ngõ cụt im lặng. Khoá cấu hình (`retention_*`) **không nằm trong `ALLOWED_SETTING_KEYS`**: giá trị quyết định xoá gì phải đi qua endpoint riêng có kiểm tra, không phải qua form key/value tự do. `saveRetentionPolicy` **kiểm hết mọi trường trước khi ghi bất cứ gì** — một giờ chạy đã lưu kèm một cửa sổ bị từ chối sẽ thành xoá theo lịch không ai cấu hình. Mọi lần sửa ghi audit `update data_retention` kèm giá trị trước/sau: "ai đã rút ngắn thời hạn lưu nhật ký kiểm toán, từ bao nhiêu xuống bao nhiêu" đúng là câu hỏi bảng này phải trả lời được về chính nó.
- **Lịch sử hoạt động toàn hệ thống** (`/admin/users/activity`): hai trang lịch sử phục vụ hai mục đích khác nhau và **không thay thế nhau**. `/admin/profile` trả lời "tôi đã làm gì" — danh tính lấy từ phiên, không cần quyền RBAC nào, ai cũng tự soi được mình. Trang này trả lời "mọi người đã làm gì" — lọc theo tài khoản / hành động / đối tượng / khoảng ngày, nên **bắt buộc quyền `users.read`** (`requireResourcePermission`), là chính quyền đã cho xem danh sách tài khoản. Mỗi lượt xem **tự ghi một dòng** `read activity_logs` kèm bộ lọc đã dùng: một nhật ký quét được trong im lặng là công cụ theo dõi, không phải nhật ký kiểm toán. Truy vấn dùng `leftJoin` sang `users` để dòng log của tài khoản **đã bị xoá vẫn còn** — đó đúng là dấu vết cần giữ nhất. Chỉ ba khoá trong `meta` được lộ ra (`ip`, `userAgent`, `mfaMethod`), không trả cả cột JSON.
  - **Tình trạng dọn log hiện ngay trên trang** (`server/api/admin/activity-logs/retention.get.ts`): tổng số bản ghi, bản ghi cũ nhất, thời hạn lưu, và **số bản ghi quá hạn chưa bị xoá**. Endpoint này **chỉ đọc**, không bao giờ gọi `runDataRetention` — một lệnh xoá gọi được bằng GET sẽ mất dữ liệu kiểm toán chỉ vì ai đó bấm F5. `overdue > 0` là triệu chứng quan sát được của việc dọn dẹp **không diễn ra** — công tắc tự động đang tắt, chưa đặt điều kiện nào, hoặc một lượt chạy đang lỗi. Endpoint đọc **chính sách có hiệu lực** (`resolveRetentionPolicy`) chứ không đọc thẳng biến môi trường: nếu không, giá trị cán bộ vừa sửa trong form và con số trang này báo sẽ nói hai điều khác nhau. Số ngày lưu bằng 0 **và** cap bằng 0 là "sẽ không bao giờ xoá gì" (`purgeDisabled`) và trang nói rõ điều đó thay vì báo an toàn. Cấu hình đặt tại `/admin/settings/data-retention`.
- **Log có cấu trúc** (`server/utils/logger.ts`): mỗi sự kiện một dòng JSON, tự che các trường có tên gợi ý bí mật. `SECURITY_EVENTS` là danh sách sự kiện an ninh để viết cảnh báo (`auth.login_failed`, `auth.login_rate_limited`, `auth.session_revoked`, …).
- **Sao lưu** (`scripts/backup-db.sh`, `scripts/verify-restore.sh`): dump → kiểm chứng (dấu kết thúc, số bảng, dung lượng SQL) → xoay vòng. Bản không đạt bị **xoá** thay vì để lại trông như bản tốt.
- **CI** (`.github/workflows/ci.yml`): mỗi push chạy test, kiểm drift schema, build thật, và một job vệ sinh (chặn `.env` bị commit, private key, secret mặc định cũ).

### Hạn chế đã biết

- **Đa ngôn ngữ mới xong phần khung.** `app/composables/useI18n.ts` có 209 khoá và bộ chuyển ngôn ngữ hoạt động, nhưng chỉ `app/layouts/default.vue` dùng — **toàn bộ nội dung trang vẫn là tiếng Việt**. Khách chuyển sang tiếng Anh sẽ thấy menu tiếng Anh bọc quanh nội dung tiếng Việt. Hai lối đi: bỏ nút chuyển ngôn ngữ (cổng thông tin chỉ phục vụ tiếng Việt), hoặc dịch cả nội dung CMS (cần thêm cột/bản ghi theo ngôn ngữ). Chưa chọn hướng nào nên chưa đụng vào.
- ~~**Typecheck mới ở chế độ báo cáo.**~~ **Đã xong**: `npm run typecheck` (→ `nuxt typecheck`) sạch 0 lỗi và job CI `Types` là **cổng chặn** (không còn `continue-on-error`). `typescript@^5` + `vue-tsc` đã là devDependency thật, lockfile đã sinh lại. **Ghim TypeScript ^5**: bản 7.x là bản viết lại bằng Go, không còn export `lib/tsc.js` mà vue-tsc cần lúc khởi động. Lần chạy đầu phát hiện 598 lỗi; hai nhóm lớn nhất được sửa tận gốc chứ không vá từng chỗ: `getDb()` khai báo kiểu trả về (`server/utils/db.ts`, 389 lỗi) và `tryRuntimeConfig()` (`server/utils/runtime-config.ts`) thay cho 5 chỗ tự dò `globalThis.useRuntimeConfig`.
- **Test phần lớn không chạm hệ thống thật.** Bốn tệp `*-integration` nối MySQL thật (ba `*-ddl-integration` + `mfa-email-code-integration`, mỗi tệp một biến môi trường cổng riêng, tự tạo và tự xoá database dùng một lần); phần còn lại kiểm logic thuần hoặc kiểm văn bản mã nguồn. Loại sau chặn được việc xoá nhầm một guard, **không** chứng minh guard đó chạy đúng.
  ```bash
  # Vòng đời mã OTP email (mã đúng / sai / hết hạn / hết lượt / gửi lại)
  MFA_DDL_INTEGRATION=1 MFA_DDL_PORT=3306 MFA_DDL_USER=root MFA_DDL_PASSWORD=... npm test
  ```
- **Giao diện chưa có kiểm thử tự động.** `package.json` không có playwright/puppeteer/vitest, nên các mục cần chạy trình duyệt thật (luồng bật TOTP, hiện mã dự phòng một lần, bước xác thực ở trang đăng nhập, các trạng thái tải/rỗng/lỗi) chỉ kiểm bằng tay. Bốn mục `8.3–8.6` trong `openspec/changes/2026-07-28-admin-self-service-security/tasks.md` để trống vì lý do này, không phải vì chưa làm.

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

### 4. Bảo mật (bắt buộc khi triển khai)
- **Bí mật BẮT BUỘC ở production** — thiếu là app từ chối khởi động (`server/plugins/require-secrets.ts`): `JWT_SECRET`, `CHATBOT_ENCRYPTION_SECRET`, `ANALYTICS_HMAC_SECRET`. Không còn giá trị mặc định trong mã nguồn hay `docker-compose.yml`.
- **Chống leo thang đặc quyền**: chỉ SuperAdmin được gán vai trò hệ thống; không ai cấp được quyền mà chính mình chưa có (`server/utils/permissions.ts`).
- **Chống stored XSS**: nội dung bài viết và rich-text của block được làm sạch phía server (`server/utils/sanitize-html.ts`) ở mọi đường ghi. Khóa `tracking_custom_head/body` (chèn JS toàn site) chỉ SuperAdmin sửa được.
- **Upload**: đuôi tệp suy từ MIME đã kiểm bằng magic-byte; SVG không bao giờ được phục vụ inline.
- **Xác thực hai bước tự phục vụ** (`/admin/profile`): ba yếu tố bật tắt độc lập (ứng dụng xác thực / mã về email / mật khẩu cấp 2), mã dự phòng tuỳ chọn, break-glass chỉ SuperAdmin. Xem "Vận hành & an toàn" ở trên, **đặc biệt là runbook xoay `JWT_SECRET`** — xoay khoá này làm mọi secret TOTP đã lưu hết dùng được.

### 5. Khởi tạo Cơ sở dữ liệu & Docker
- **MySQL Database Auto-Init (`server/db/init.ts`)**: Tự động kết nối server MySQL, tạo database `cdkt_admin` và toàn bộ 32 bảng dữ liệu nếu chưa tồn tại (idempotent, tự thêm cột còn thiếu).
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
