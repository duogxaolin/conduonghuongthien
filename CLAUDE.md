# Con Đường Hướng Thiện (CDKT) - System Documentation

UI/UX work must read `openspec/ui-dna.md` (or the existing DNA doc) before any visual change.

**KHÔNG tự ý commit và push** — chỉ commit/push khi user yêu cầu tường minh.

**Quy tắc giữ file nhỏ (đừng làm phình lại):**
- `app/layouts/default.vue` (hiện 401 — skip-link a11y + `id="main-content"` + `await useAsyncData` cho nav; đã nhỉnh hơn ngưỡng ~400 dòng, đừng thêm nữa) và `server/db/init.ts` (hiện 73) đã được tách cố ý từ 1301/1302 dòng — **KHÔNG thêm logic mới vào 2 file này**. Đặt component vào `app/components/layout/`, composable vào `app/composables/`, DDL bảng mới vào `server/db/schema-tables/<domain>.ts`. File vượt ~400 dòng → review tách ngay, đừng đợi ai báo.
- Khi sửa code có ảnh hưởng đến deploy (đổi `.env`, đổi port, đổi lệnh build, thêm seed/migration, đổi container, đổi healthcheck, đổi `PUBLIC_BASE_URL`/domain, thêm biến môi trường) → **phải kiểm tra + update `production/`** (toolkit `manage.sh`/`README.md`/`migrations/`) để VPS deploy/update không bị lạc. Đừng chỉ sửa code rồi push — CI tự deploy khi merge `main` (job `deploy`), còn `manage.sh` dùng cho deploy lần đầu/đổi `.env`/migrate; nếu toolkit không khớp code mới sẽ hỏng lúc deploy.

Cổng thông tin điện tử hỗ trợ người hoàn lương tái hòa nhập cộng đồng — Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.

> **Tài liệu dài đã tách:** lịch sử tính năng → `docs/CHANGELOG.md` · diễn giải vì-sao & tiền sử bug → `docs/decisions/README.md` (chatbot, data-layer, reader-features, realm-safety). File này chỉ giữ **quy tắc chặn + checklist**.

---

## 🛠️ Tech Stack

- **Frontend**: Nuxt 4 (Vue 3 SFC, TS, Composition API), **Tailwind CSS v3** (`@nuxtjs/tailwindcss`), FontAwesome Pro 7.3 (self-hosted), **`@nuxt/image` 2.1** (IPX provider tái dùng `sharp` đã có — `<NuxtImg>` sinh WebP + responsive srcset; **chỉ áp cho ảnh public-side chưa qua sharp** — ảnh rich-text TinyMCE + ảnh đã qua `media/upload` sharp+R2 giữ `<img>` thường). **Tất cả code mới dùng Tailwind utility** — không `<style scoped>` trừ `::before`/keyframes/`:deep()` rich-text. CSS cũ giữ nguyên.
- **Backend**: Nitro/H3, Drizzle ORM, MySQL 8.0/MariaDB, JWT (`cdkt_admin` HTTP-only Cookie).
- **DB — 62 bảng**: nguồn chân lý `server/db/schema.ts`; DDL khởi động `server/db/init.ts` (73 dòng, chỉ giữ thứ tự gọi — 7 file `schema-tables/*.ts` theo domain: `core`/`content`/`governance`/`chatbot`/`analytics`/`readers-media`/`ai-i18n`) + `server/db/migrations-additive.ts` (ensureColumn/ensureIndex/FK cho DB đã có dữ liệu). `init.ts` re-export `migrations-additive` để 4 suite test không đổi import path. `seed.ts` insert-only. → chi tiết `docs/decisions/data-layer.md`.
- **Test**: `npm test` (Node runner, `scripts/ts-resolver.mjs`, không cài thêm). Node `^22.19.0 || ^24.11.0 || >=26.0.0`. Mười bảy suite `*-integration` nối MySQL thật (matrix CI 17 job, mỗi suite một DB `cdkt_*_<runId>`). E2E: `npm run test:e2e` (cần build + MySQL, `E2E_DB_PORT=33069` cho dev docker; cổng cố định **3123** — kiểm `ss -ltn` trước: một lượt bị cắt ngang từng để lại server mồ côi giữ 3123 và lượt sau đỏ sai lý do; sau lượt chạy kiểm không còn DB `cdkt_e2e_*`). Render template SFC trong test: `tests/_render-sfc-template.ts`.
- **Schema tooling**: `npm run db:drift` so `schema.ts` ↔ `init.ts + schema-tables/*.ts + migrations-additive.ts` (tên + kiểu + NULL, 635 cột/62 bảng). `npm run db:generate` sinh diff SQL. `migrations/*.sql` là snapshot mysqldump — có guard chặn chạy nhầm.
- **Webfont & Icon**: Inter tự chủ (`public/assets/fonts/`, `nuxt.config.ts` tự phát hiện, không còn `fonts.googleapis.com` trong `.output/`). FontAwesome nạp `solid` + `regular` + `brands` (`ICON_FAMILIES` trong `nuxt.config.ts`).
- **Hiệu năng trang công khai** — 3 thứ đi cùng nhau: `routeRules` `swr: 60` (SWR 60s) cho `/`, `/about`, `/contact`, `/media` + `/media/**`, `/qa-documents`, các trang **con** `/news/**`/`/role-models/**`/`/reintegration-models/**`/`/documents/**`/`/legal-qa/**` + `/api/public/social-links` (`/admin/**`, `/in-bai/**`, `/api/**` còn lại `cache:false` tường minh), `lazy:true` ở ~30 fetch công khai, `<NuxtLoadingIndicator>` ở `default.vue`. **Trang danh sách trần `/news`, `/role-models`, `/reintegration-models`, `/documents`, `/legal-qa` KHÔNG được cache** (đo trên build 2026-10-14: trả 200 nhưng không header `s-maxage`) — đừng thêm rule cho chúng khi chưa đo. Trang cache phát lại cho mọi khách: **máy chủ không bao giờ ghi cookie `cdkt_lang`** (chỉ đọc header `cookie` qua `app/utils/locale-preference.ts`, không `useCookie(…, {default})`; HTML cache luôn tiếng Việt, đổi ngôn ngữ sau hydrate — `tests/e2e/public-language-cache.spec.ts`); lớp phủ tải đầu có lối thoát (failsafe 4s, `<noscript>`, gỡ ở `app:error`/`vue:error` — `app/utils/boot-overlay.ts`). Vòng focus `#4A6741` (không `#7CB342`, 2.5:1), chữ phụ `#5A6C58`.
- **Skeleton** (`app/components/skeleton/*.vue`, `tests/skeleton-loading-ui.test.ts`): `SkeletonTable`/`SkeletonCards`/`SkeletonForm` dùng chung; inline chỉ khi hình dạng duy nhất. `motion-reduce:animate-none` kèm mọi `animate-pulse` (4 nhịp trạng thái được miễn, ghi trong test). Container `role="status"` + `aria-busy="true"` + `sr-only`; ô xám `aria-hidden="true"`; nhánh lỗi mang `role="alert"` + nút thử lại gọi hàm cùng file (không `location.reload()`). Lớp cột viết thẳng chữ, không nội suy `grid-cols-${n}`. Tải/lỗi/rỗng là một hợp đồng (mẫu `NewsCategoryList.vue:14-34`, `tests/admin-error-retry-ui.test.ts` chặn 50 trang có error/retry + 5 trang miễn nêu lý do).
- **Ba biên tin cậy** đã tách khỏi component (`chatbot-storage.ts` / `nav-config.ts` / `analytics-noc.ts` — ranh giới "kiểm được không cần mount"). `nav-config.ts`: allowlist `openNewTab` — thêm field phải sửa `NavItem` + `normalizeNavItem` + test, `=== true` không `Boolean()`. → `docs/decisions/data-layer.md` + `reader-features.md`.
- **Media**: Local `/public/uploads/YYYY/MM/` + R2 (S3 SDK + Sharp). **Container**: Docker Compose, `APP_BIND` mặc định `127.0.0.1`.
- **TinyMCE admin editor**: 2 đường init — component `app/components/admin/TinyMceEditor.vue` (PageBuilder + bản dịch, default height 480) và inline `tinymce.init` trong `[id].vue` (bài viết, height 700). Editor **full section width** — KHÔNG giới hạn `max-w`; `content_style` có `img/iframe/video { max-width:100% }`. Giới hạn chiều ngang ảnh/video chỉ áp ở **render công khai** (`ArticleDetail.vue` + `blocks/RichTextBlock.vue`, `.article-body :deep(img)`). `animate-fadeIn` không tồn tại trong tailwind config — dùng `animate-fade-slide-up`.

---

## 📂 Cấu Trúc Thư Mục (`app/pages/` — tiếng Anh)

```
app/
├── components/
│   ├── SectionBar.vue / ToastContainer.vue / ArticleDetail.vue
│   ├── ChatWidget.vue / NewsCategoryList.vue / ArticleComments.vue
│   ├── ReaderAvatar.vue / ReaderNotificationBell.client.vue (.client bắt buộc — swr:60)
│   ├── admin/MediaLibraryModal.vue / TinyMceEditor.vue / ConfirmModal.vue
│   └── layout/ (7 component tách từ default.vue: DefaultTopBar/Header/MobileDrawer/DesktopNav/SearchDropdown/Footer/BottomNav)
├── utils/
│   ├── formatDate.ts / blocks/registry.ts / blocks/types.ts (BlockNode/BuilderNode)
│   ├── chatbot-storage.ts / nav-config.ts / analytics-noc.ts
│   └── submission-status.ts
│   (plain-text.ts / display-name.ts / query-number.ts đã chuyển sang `server/utils/`)
├── composables/
│   ├── useAdminAuth.ts / useChatbot.ts (+ useChatbotTypewriter.ts)
│   ├── useI18n.ts (+ i18n-default-dictionary.ts; 581 key trong seed, 424 fallback hardcoded vi; mọi lang kể cả vi fetch DB) / useReaderAuth.ts
│   ├── useReaderNotifications.ts / useReadingHistory.ts (localStorage only) / useToast.ts
│   └── useAnalyticsNocTable.ts
├── layouts/default.vue (1301→401, tách 7 component layout/ + 5 composable + skip-link a11y) / admin.vue
└── pages/
    ├── index.vue / about.vue / contact.vue
    ├── news/ / reintegration-models/ / role-models/ / documents/ / legal-qa/
    ├── qa-documents.vue / assistant.vue / profile.vue (KHÔNG routeRules)
    ├── [slug].vue (catch-all block)
    └── admin/
        ├── index.vue / login.vue / profile.vue
        ├── content/{articles/, categories/, navigation/, pages/, content-types.vue}
        ├── chatbot/{knowledge/, small-talk/, sessions/, settings.vue}
        ├── media/ / settings/{data-retention.vue, google-oauth.vue, ip-bans.vue}
        ├── readers/ / comments/ / submissions/ / users/activity.vue
```

Chi tiết Page Builder → § Kiến trúc Page Builder bên dưới. Lịch sử tính năng → `docs/CHANGELOG.md`.

### Vận hành & an toàn — checklist (narrative → `docs/decisions/`)

- **Mật khẩu** (`server/utils/password-policy.ts`, `scripts/check-admin-password.ts`): ≥12 ký tự, 3/4 nhóm, chặn mặc định/phổ biến/chứa username. Áp mọi nơi *đặt* mật khẩu, không áp lúc đăng nhập. Guard chạy trước `nuxt build` trong `npm run build`; sai → exit 1; thiếu → cảnh báo. Docker dùng BuildKit secret, không build arg.
- **Phân quyền**: mọi handler qua `requireResourcePermission(event,…)`. **Một ngoại lệ nêu tên**: `articles/[id].put.ts` gọi `checkPermission()` lần 2 khi đổi thể loại. 218 tệp `server/` dùng helper (206 dưới `server/api/`, đo 2026-10-14). Thao tác phá huỷ cấp hệ thống (khôi phục/tải/xoá backup, cấu hình Drive + `backup_keep_count`, `ai/moderation/restart-server`, đổi đích AI của chatbot) thêm cổng **SuperAdmin**. Quản lý user: non-SuperAdmin chỉ gán vai trò / sửa / khoá / xoá tài khoản mà **mọi** cờ quyền (kể cả publish/archive/test) của vai trò nằm trong quyền của mình (`assertRoleWithinActor`, `assertUserManageable` ở `services/users.ts`), và chỉ sửa ma trận quyền của vai trò mà quyền HIỆN TẠI nằm trong quyền mình (`roles/[id].put.ts`); tự đổi vai trò/khoá/đặt lại mật khẩu chính mình qua `users/[id].put.ts` bị chặn (đổi mật khẩu ở `/admin/profile`). Handler admin mới không kiểm quyền → `tests/admin-handler-authorization.test.ts` (phân loại bằng AST, `tests/_admin-authz-classifier.ts`) đỏ (hoặc thêm vào `AUTH_EXEMPTIONS` kèm lý do). Middleware `admin-auth` quyết định trên đường dẫn **đã giải mã** (`classifyAdminRequest`; chỉ cắt `?`, đường dẫn có `#`/`%23` không bao giờ được miễn) — đừng quay lại so `getRequestURL().pathname` thô (`tests/admin-auth-path-gate.test.ts`).
- **MFA & `/admin/profile`** (`server/utils/mfa/factors.ts`): 3 yếu tố độc lập `totp`/`email_otp`/`second_password` (pending→active), mã dự phòng bcrypt dùng 1 lần. Vé MFA `cdkt_mfa` 5 phút tách vé session `cdkt_admin`; chặn bằng claim `stage`. **Runbook xoay `JWT_SECRET`**: HKDF `cdkt-mfa-totp:v1` → TOTP vô hiệu, lùi về yếu tố khác/mã dự phòng, log `mfa.totp_secret_unreadable`. Xoay cũng đăng xuất toàn bộ reader (HKDF `cdkt-reader-session:v1`, vô hại). `CHATBOT_ENCRYPTION_SECRET` bảo vệ cả API key AI (`v1`) lẫn Google OAuth secret (`cdkt-google-oauth-secret:v1`). JWT ký/kiểm **ghim `HS256`** (`server/utils/auth.ts`, `tests/jwt-algorithm-pinning.test.ts`). → `docs/decisions/realm-safety.md`.
- **Rate limit** (`server/utils/rate-limit-store.ts`, `rate-limit-deps.ts`): bảng `rate_limit_counters`, mất DB lùi về memory — không mở toang. Login bước 2 giới hạn theo tài khoản (10/15 phút). Lấy deps qua `rateLimitDeps()`, không viết tay `{execute: pool ? … : null}` (19 file đã dùng helper). → `tests/shared-helpers.test.ts`.
- **Luồng SSE của AI đọc ở MỘT nơi** (`server/services/ai-sse.ts` `readChatSse`, làm sạch "suy nghĩ" ở `ai-text-cleaner.ts`): `callAi` từng chép vòng lặp này 4 lần và mỗi lần sửa một bản lại quên bản khác (lỗi "0 kết quả", rồi câu trả lời bị lặp đôi khi model trả lời thẳng). Sửa luồng stream thì sửa ở đó. `tests/ai-gateway-streaming-paths.test.ts` chạy `callAi` thật với `fetch` giả.
- **Không ghép dữ liệu người dùng vào SQL** (`sql.raw`, `pool.query` nối chuỗi): chỉ tham số hoá. Chuỗi do **model** truyền vào công cụ chatbot cũng là dữ liệu người dùng (prompt injection) — lỗ hổng SQLi `search_c11_articles` đã đóng bằng `server/utils/chatbot/article-search.ts`. Hằng số số nguyên bắt buộc dùng `intervalDays()` (`server/utils/sql-literals.ts`). `tests/security-chatbot-article-search.test.ts` biên dịch truy vấn sang SQL MySQL và chặn `sql.raw` trong `chat-policy.ts`.
- **HTML hiển thị bằng `v-html` phải qua `sanitizeHtml` lúc ghi *và* lúc đọc** — kể cả bản dịch. Mọi nơi ghi `article_translations.content` đi qua `sanitizeHtml`/`sanitizeTranslationFields`; `sanitizeBlockData` đi vào `data.translations[lang]`; hai endpoint công khai (`articles/[slug]`, `pages/[slug]`) lọc lại để xử lý dữ liệu cũ. `tests/security-translation-html.test.ts` quét và chặn nơi ghi bỏ sót. HTML do **model** viết (AI biên tập) cũng sanitize ở máy chủ trước khi trả; **mọi `v-html` trong `app/` phải có tên trong kiểm kê** của `tests/security-ai-editorial-html.test.ts` kèm nguồn đã lọc. Hàng đã lưu trước bản vá: `npm run db:sanitize-html` (xem trước) / `-- --apply` (ghi) — `server/services/stored-html-sanitize.ts`, chạy lại được, sao lưu DB trước.
- **Trường văn bản thuần (`title`/`excerpt`) giải mã HTML entity lúc ghi *và* lúc đọc** (`server/utils/decode-html-entities.ts` — đủ bảng HTML 4 + ă/đ/ĩ/ũ, một lượt): sapo nhập từ CMS cũ chứa `Ng&agrave;y`, Vue in nguyên văn. Ghi (tạo/sửa bài, bản dịch — giải mã **trước** `stripMarkup`): `decodePlainTextInput`, **chỉ giải mã, không "sửa"**. Đọc (`articles.get`, `articles/[slug]`, `related`, `search`, chatbot `search_c11_articles`, admin `[id].get` để trình soạn hiện chữ đọc được): `plainTextField`/`withPlainTextFields` — thêm sửa entity bị cắt cụt cuối chuỗi, **chỉ khi chuỗi đang ở dạng mã hoá** (mọi `&` khác là entity đầy đủ) để `Phòng R&D`/`Q&A` không thành `R…` — ngoại lệ đã biết: chuỗi PHA (có entity đầy đủ VÀ kết thúc bằng `&chữ` thật, vd. `C&ocirc;ng ty AT&T`) vẫn bị cắt thành `AT…` lúc đọc (dev 0 hàng; lời giải gốc là backfill một lần rồi bỏ phép đoán lúc đọc). Giải mã chạy cả lúc ghi lẫn lúc đọc, nên chữ entity viết nguyên văn (`&amp;agrave;`) đi hết vòng sẽ thành `à`. **Không bao giờ** giải mã `content` hay thứ render bằng `v-html`. Trang danh sách còn `cleanExcerpt` (`app/utils/article-excerpt.ts`) giải mã lần nữa phía client — thừa, chỉ khác với chữ entity viết nguyên văn. `tests/html-entities-plain-text.test.ts`.
- **Hạn mức AI** (`enforceAiQuota`, `chat-policy.ts`): 20 lượt/giờ theo phiên **và** trần 100 lượt/giờ theo IP (`AI_IP_CEILING_RULE`). Token phiên (`/api/public/chatbot/session`) cấp không giới hạn và không tốn gì — hạn mức tính trên token một mình sẽ bị reset bằng cách xin token mới. `tests/chatbot-ai-quota-ceiling.test.ts`.
- **Chat: rate limit TRƯỚC kiểm duyệt** (`chargeChatRateLimit`, tính một lần/request) + trần hàng `ai_moderation_queue` 20/giờ theo IP (/64, `ip-bucket.ts`)/reader/phiên (`MODERATION_QUEUE_CAP`); bình luận + chat livestream cũng vậy (`capQueuePerSource`). Regex kiểm duyệt qua **một** helper (`moderation-regex.ts`: parser từ chối mẫu lùi vô hạn lúc lưu; lúc chạy cửa sổ 2000 ký tự, > 200 ms → tắt luật 10 phút) — **giảm chứ không loại trừ** ReDoS. Tin chat > min(10000, `maxInputChars`‖2000) ký tự → 400, sau rate limit, trước kiểm duyệt. Lỗi ẩn/ghi hàng duyệt phải log, không đếm là đã ẩn. "Quét lại tất cả" là job nền (`moderation-rescan-job.ts`, khoá tên, 202/409, lô có trần). Nội dung người dùng vào prompt AI kiểm duyệt qua `fenceUntrustedContent` (`server/utils/ai/untrusted-content.ts`: thẻ hậu tố ngẫu nhiên mỗi lượt, đặt **sau** phần yêu cầu; biến `{{content}}`/`{{author}}` cũng bọc) — đừng dán thẳng `"${content}"` vào prompt. Đọc một lượt chat (kiểm duyệt, trả lời, lưu) **chỉ** qua `server/utils/chatbot/chat-turns.ts` (`chatTurnText`: `content` trước `text`, NFKC); hai endpoint chat kiểm hình dạng lịch sử trước (`chatHistoryShapeOk`: ≤ 30 lượt, ≤ 30 000 ký tự, không lượt rỗng, lượt cuối của người dùng) rồi quét mọi lượt **người dùng**: câu mới vi phạm → từ chối + ghi hàng chờ; lượt cũ vi phạm → chỉ giữ lại khỏi model (`matchInstantRule` không ghi hàng chờ + `withoutUserTurns`), câu mới vẫn được trả lời (từ chối vì lượt cũ làm kẹt cả cuộc trò chuyện); không quét lượt trợ lý (câu trả lời đúng có thể chứa từ khoá → từ chối oan) (`tests/chatbot-moderation-screens-answered-text.test.ts`).
- **Đích AI (baseUrl) là bề mặt SSRF/lộ key** (`server/utils/ai/provider-url.ts`): https, cổng 443, không userinfo, không IP nội bộ/loopback/link-local (kể cả dạng thập phân/hex/IPv6), không `localhost`/`.local`/`.internal` — kiểm lúc **ghi** (provider, cài đặt chatbot) và lúc **gọi** (mọi đường trong `ai-gateway.ts`, kể cả stream/tool qua `safeProviderStream`: ghim IP đã phân giải, không redirect, hạn giờ + trần byte). Đổi baseUrl phải nhập lại API key; đổi đích chatbot (baseUrl/allowedHosts) chỉ SuperAdmin. Đừng gọi `fetch` trần tới nhà cung cấp.
- **Liên kết trong email** (`server/utils/public-link-base.ts`): host request chỉ dùng khi nằm trong `PUBLIC_HOST_ALLOWLIST` hoặc là host của `PUBLIC_BASE_URL`, còn lại lùi về `PUBLIC_BASE_URL`; trống cả hai → hành vi cũ + log `security.link_host_unchecked`. OAuth redirect vẫn suy từ request (Google tự kiểm redirect URI). nginx: site `default_server` từ chối host lạ + `X-Forwarded-Host $host` (`CI-CD.md`).
- **Không gửi bí mật đã lưu tới đích do request chọn**: đổi host/port/user/secure SMTP hay account/bucket R2 (ảnh, video) phải gõ lại bí mật trong cùng request (luật chung `shared/settings-credential-rules.ts` cho trang + máy chủ; SMTP chỉ cổng 25/465/587/2525); test-email/test-r2 với bí mật trống/che → dùng cấu hình đã lưu, chỉ trả lỗi đã phân loại; xuất Google chỉ tải ảnh media của chính site, không chia sẻ `anyone`; ô CSV/Sheets đầu `= + - @` bị vô hiệu (`spreadsheet-cell.ts`). Account/bucket R2 kiểm cả lúc dùng (`openR2`, `R2ConfigInvalidError` 400). → `docs/decisions/realm-safety.md` § audit 2026-10-13.
- **Client IP sau proxy** (`server/utils/client-ip.ts`, `TRUSTED_PROXY_IPS` + `NUXT_TRUSTED_PROXY_IPS`): mọi handler dùng `getClientIp(event)`, không `getRequestIP` trực tiếp (có test chặn). Chỉ đọc `x-forwarded-*` khi peer là proxy đã khai; duyệt phải→trái. Mặc định chỉ tin loopback; hỗ trợ CIDR IPv4, IPv6 từ chối. `resolveClientIp` thuần, có `spoofAttempt`.
- **App bind loopback** (`docker-compose.yml`, `APP_BIND=127.0.0.1`): nginx proxy về loopback; `0.0.0.0` chỉ khi không có proxy.
- **Lượt xem bài viết** (`server/services/article-views.ts`): `real_views` vs `fabricated_views` + `source_category='boost'` (không trong allowlist công khai). Đếm từ browser sau mount (`ArticleDetail.vue`), nuốt lỗi. Chống F5 10 phút (`VIEW_DEDUPE_WINDOW_SECONDS`) qua `rate_limit_counters` (`deriveDailyVisitorToken`, `getClientIp`). Endpoint luôn `202`. Boost `instant`/`gradual` (tick 60s, lock `cdkt:articles:view-boost`, `computeBoostDue` theo thời gian tuyệt đối), audit `boost` trong cùng transaction, `started_at/ends_at` chỉ qua Drizzle (không `pool.query` trần — lệch 7h). Modal tách 3 ô, nguồn truy cập loại `boost`. Không backfill, không scope retention. → `docs/decisions/data-layer.md`.
- **Data retention** (`server/services/data-retention.ts`, `/admin/settings/data-retention`): 4 scopes `activity_logs`/`submissions`/`chat_sessions`/`reader_accounts` (`RETENTION_SCOPES`/`SCOPE_SETTINGS` là `Record` do compiler kiểm). Mỗi bảng già theo cột riêng (`TABLE_COLUMNS`): `created_at` vs `last_seen_at` vs `last_message_at`; `chat_messages`/`article_comments`/`reader_notifications`/`submission_events` **không phải scope** (cascade). Hai điều kiện độc lập (tuổi + cap), tuổi trước, cap đo 1 lần. `data_retention_state` cộng dồn trước khi xoá. Scheduler trong tiến trình (tick 15p, `isRunDue` thuần, `RETENTION_SCHEDULER=1|0`, hoãn 60s, `unref`), khoá `cdkt:data:retention` (timeout 0). 3 đường vào: scheduler / cron `{ignoreSchedule:true}` / manual `{force:true}` (409 nếu khoá). Thứ tự ưu tiên DB→env→default, mỗi ô khai nguồn; `retention_*` không trong `ALLOWED_SETTING_KEYS`; `saveRetentionPolicy` kiểm hết trước khi ghi. → `docs/decisions/data-layer.md`.
- **Activity toàn hệ thống** (`/admin/users/activity`, quyền `users.read`): tự ghi `read activity_logs` kèm filter; `leftJoin` giữ log của user đã xoá; endpoint `retention.get.ts` chỉ đọc, không gọi dọn.
- **Log** (`server/utils/logger.ts`): 1 dòng JSON, tự che bí mật; `SECURITY_EVENTS` cho cảnh báo.
- **Sao lưu** (`scripts/backup-db.sh`): dump→verify→xoay vòng; bản hỏng bị xoá. Cron media gồm cả volume `uploads_data` (`cdkt-uploads-*`, khuôn `uploads/` như backup trong app); `scripts/restore-db.sh` (kiểm gzip + dump `cdkt-prerestore-*` trước khi ghi, bắt buộc tên DB đích + `--replace`). Mật khẩu MySQL qua `MYSQL_PWD`, **không bao giờ `-p<mật khẩu>`** (lộ trong `ps`); `mysqladmin ping` trả 0 cả khi sai mật khẩu — healthcheck không kiểm xác thực. Script dưới `set -o pipefail` không dùng `grep -q` trong pipe (SIGPIPE → sai kết quả; dùng `PIPESTATUS`). Chưa có lần diễn tập khôi phục trên máy mới.
- **Backup trong app** (`server/services/backup*.ts`): khôi phục/tải về/xoá backup **chỉ SuperAdmin** (`requireSuperAdmin` sau `requireResourcePermission`); khôi phục kiểm file trước khi ghi/chạy (mục tar đọc header trong Node — `TarHeaderScanner`; giải nén > 15 GiB bị từ chối → archive lớn dùng `scripts/restore-media.sh`), tạo `pre-restore` trước, audit thành công/thất bại. Xoay vòng luôn giữ bản mới nhất mỗi họ (sql/uploads/media) và mọi `pre-restore`, không chạy khi đang khôi phục (`holdRestoreTarget`). `backups.trigger` VARCHAR(32) (`BACKUP_TRIGGERS`). Dump ghim `sql_mode='NO_AUTO_VALUE_ON_ZERO'`; định dạng 2 ghi ngày giờ nguyên văn + `time_zone '+00:00'` + snapshot nhất quán; dump cũ bị gắn cờ lệch 7 giờ. → `docs/decisions/realm-safety.md`.
- **RAM** (`npm run check:resources`): compose dùng `${MYSQL_MEM_LIMIT:-0}`/`${APP_MEM_LIMIT:-0}` — mặc định **không giới hạn**, chỉ có trần khi đặt biến; không đề xuất CPU. Tải video (`MEDIA_UPLOAD_ENABLED`) chỉ bật khi RAM ≥ 4000 MB (`manage.sh` Deploy tự kiểm).
- **CI** (`.github/workflows/ci.yml`): push chỉ trên `main` (không `["**"]`), typecheck là bước **chặn** trong job `unit-tests` (không `continue-on-error`, `exit $status`; `tests/ops-scripts.test.ts` canh cả hai). **Job `deploy` đang BẬT (`if: true`): merge vào `main` là tự build image + SSH lên VPS ngay** — bản vá/tính năng đã lên production khi CI xanh. 2026-10-14 → 2026-10-23 mọi job Actions không khởi động ("recent account payments have failed or your spending limit needs to be increased") — đã chạy lại từ 2026-10-23; vẫn kiểm `gh run list` trước khi tin CI đã xanh. Bước cài FFmpeg (chỉ ở job `unit-tests` + `build`; 17 job integration không cần): chỉ bước **tải** có trần thời gian, lần thử hai đổi mirror `azure.archive.ubuntu.com` → `archive.ubuntu.com` **trong `/etc/apt/apt-mirrors.txt`** (runner ubuntu-24.04 khai `URIs: mirror+file:` — sửa sources.list thôi không đổi gì); `Install Chromium` (apt của Playwright) cũng có `timeout-minutes` — mirror Azure chập chờn từng làm bước FFmpeg mất 20 phút và cắt job dù test xanh (`tests/ci-ffmpeg-install.test.ts`). Đọc job cancelled / hạn mức phút Actions (repo **đã chuyển private**, kiểm 2026-10-22 — hạn mức phút nay áp dụng) → `CI-CD.md` + realm-safety § CI. Job `changes` quyết định: PR nháp bỏ qua, PR thường chạy bộ nhẹ, Integration chỉ chạy khi PR đụng backend/DB/CI hoặc trên `main`/chạy tay (→ `CI-CD.md`). `cancel-in-progress` chỉ đúng cho `pull_request` — lượt `main` xếp hàng, deploy đang chạy không bao giờ bị cắt. Deploy **gửi `docker-compose.yml` của đúng commit** lên VPS (kiểm SHA-256 + `config -q`, hỏng thì không chạm container — `CI-CD.md`) rồi `up -d --no-recreate mysql` + `up -d --no-deps app` — không bao giờ `up -d app` trơn; `manage.sh` Update làm y hệt (tự `git checkout -- docker-compose.yml` trước `git pull`). Biến mới cho app phải liệt kê trong `environment:` của compose (không có `env_file`). Bước `npm audit --omit=dev --audit-level=high` là **chặn**: `dependencies` chỉ còn gói runtime (nuxt/vue/tailwind… ở `devDependencies`, `.output` tự chứa), image runtime cài bằng `npm ci --omit=dev --ignore-scripts` (`postinstall` là `nuxt prepare`). Container app chạy `TZ=Asia/Ho_Chi_Minh` (Dockerfile + compose), mysql giữ UTC.

---

### Quy ước tầng dữ liệu (áp cho mã MỚI, không sửa 172 endpoint cũ)

Hiện 331 endpoint: 172 `getDb()` thẳng, 205 có import `services/**` (một số endpoint dùng cả hai).

**Bắt buộc viết trong `server/services/**` khi:** (1) ghi hàng + `activity_logs` (phải 1 transaction), (2) nhiều lệnh ghi phải cùng thành công, (3) ≥2 nơi gọi, (4) quy tắc nghiệp vụ không diễn đạt bằng query.

**Không tự ép kiểu kết quả truy vấn**: `db.insert()`/`pool.query()` trả **mảng** — destructure; `affectedRows` chỉ qua `readAffectedRows()`/`affectedRowsOrZero()`. Không `as {affectedRows}` / `as unknown as {insertId}`.

**Truy vấn thẳng đủ khi**: chỉ đọc hoặc ghi 1 hàng không audit và không nơi nào khác cần lại.

**Đường ghi audit — 4 điều đã trả giá:**
1. `tx.insert(activityLogs)` trong khối transaction — không `db.insert` trên pool.
2. Xoá-rồi-log không bọc là sai phổ biến nhất (FK + JSON) — đã kiểm bằng driver thật.
3. Ngoại lệ phải nêu tên trong test: `profile/mfa/confirm.post.ts` (và `recovery-codes`, `auth/logout`, `boost.post.ts`) cố ý không bọc vì `setSessionCookie()` giữa 2 ghi — rollback không thu hồi cookie. `tests/reader-audit-atomicity.test.ts` khoá.
4. `tests/reader-audit-atomicity.test.ts` chặn 17 admin endpoint (danh sách `AUDITED_MUTATION_ENDPOINTS`) + 9 service (`AUDITED_SERVICES`); guard quét **cả thư mục** `server/api/admin/**` và `server/services/` (không liệt kê đường dẫn) và bắt cả `db.insert(activityLogs)` trên pool **sau** khi transaction đã đóng — có chữ `db.transaction(` trong tệp chưa đủ (lỗ này để lọt 4 nơi tới 2026-10-22). Ghi audit trên pool có chủ đích → `SERVICE_POOL_AUDIT_EXEMPTIONS` kèm lý do. `deleteMediaById` chỉ bọc 2 ghi DB, không bọc xoá tệp.
5. `deleteArticleById`/`setArticleStatus` (`services/articles.ts`) **chủ đích KHÔNG bọc** — guard `known exclusions are named` ở cùng test trên khoá trạng thái này, bọc lại sẽ fail test. Đó là known-exclusion được guard, **không phải gap chưa đóng**.

**TDZ:** `const id = await db.transaction(…)` — không đọc `id` trong chính callback (ReferenceError lúc chạy). Đã trả giá 4 endpoint 500. Chặn bằng `tests/transaction-tdz.test.ts` + `tests/e2e/admin-write-paths.spec.ts`.

**Query string số:** qua `finitePositive()` (`server/utils/query-number.ts`), không `Math.max(1, Number(...))` (NaN→null, Infinity→500). → `tests/query-number.test.ts`.

**`slugify` một bản duy nhất** (bản chép thiếu cắt gạch treo → `-tin-nong-`). Không backfill slug dị dạng. → `docs/decisions/data-layer.md`.

**`validateIdTokenClaims` có test** (`aud` là thứ duy nhất chặn token phát cho app khác; `picture` không lọt vào return). → `docs/decisions/data-layer.md`.

**Chuyển trạng thái có cạnh tranh** (đơn, `submission-workflow.ts`): kiểm + `UPDATE … WHERE id=? AND status=<cũ>` + đếm `affectedRows` **trong** transaction, người thua nhận 409 — không đọc trạng thái ngoài tx rồi update theo id. Publish/archive/xoá kho chatbot (`chatbot-knowledge.ts`) ghi hàng + audit cùng tx (`tests/chatbot-knowledge-audit-atomicity.test.ts`).

**Đồng bộ media lên R2** (`media-sync*.ts`): mỗi mục upload → Head kiểm → **một tx** (đổi hàng `media` có điều kiện + thay URL ở 27 cột đích, khớp tới ranh giới cuối URL — `media-sync-url-match.ts` + audit) → **rồi mới** xoá bản local. Worker giữ khoá tên suốt lượt + mã thế hệ; "Sửa URL" có bước sửa lượt bị cắt ngang. Thay file video: dọn cây cũ qua outbox `media_asset_cleanup` trong cùng tx (không xoá trước commit); `deleteR2Tree` theo ranh giới thư mục.

**Đọc công khai hỏng → 503 + `no-store`** qua `reportPublicReadFailure()` (`server/utils/public-read-failure.ts`, log ổn định) — không trả 200 `{ok:false}` rỗng (trang SWR sẽ cache "danh sách trống"); block hiển thị `BlockLoadError.vue` + thử lại; trang SSR → 503 qua `useSsrFailureStatus` (bài không có → 404, `resolveDetailFetch`), và `server/plugins/error-no-store.ts` ép `no-store` cho mọi phản hồi ≥ 500 (bộ bọc swr của Nitro ghi `s-maxage` cả lên trang lỗi). Lọc ngày ở admin = ngày lịch VN (`server/utils/vn-day-range.ts`; giả định phiên MySQL ở UTC). Tìm kiếm: `COUNT` thật mỗi nguồn + LIKE thoát `%`/`_` (`server/utils/search-paging.ts`). Truy vấn analytics bằng giờ UTC qua `server/utils/utc-query.ts` trên pool chung (không mở pool mỗi lượt); giới hạn page-view dùng store chung. Danh sách bài công khai: URL là nguồn chân lý, khoá `useAsyncData` suy từ query (`usePublicArticleList.ts`, `ModelArticlesListPage.vue` dùng chung cho role-models/reintegration-models).

Chi tiết & kiểm chứng âm tính → `docs/decisions/data-layer.md`.

### Xử lý lỗi tầng giao diện

`catch (err: unknown)` + `errorMessage(err, fallback)` (`app/utils/errorMessage.ts`), không `any`. Không trả chuỗi rỗng. Lỗi `$fetch` chỉ hiện câu máy chủ soạn (`data.statusMessage`/`data.message`) — `message`/`statusMessage` do ofetch sinh không bao giờ tới người dùng (`tests/error-message.test.ts`). `errorStatus()` tách riêng (401 mời đăng nhập lại vs 403 đang đăng nhập). Server 9 khối xử lý tại chỗ.

### Tệp lớn đã tách (và 1 tệp cố ý KHÔNG tách)

- `server/db/init.ts` (1302 → 73 dòng): 7 file `schema-tables/*.ts` theo domain giữ 62 `CREATE TABLE`; `init.ts` chỉ còn thứ tự gọi (ràng buộc FK thật). `db:drift` đọc cả 9 tệp như một nguồn DDL duy nhất (635 cột/62 bảng).
- `app/layouts/default.vue` (1301 → 401, `wc -l` 2026-10-14): tách 7 component `app/components/layout/Default*.vue` + 5 composable (`useLayoutNav`/`useSiteSettings`/`useLiveSearch`/`useReaderMenu`/`useMobileMenu`) + skip-link a11y + `id="main-content"`; guard test ghép nguồn qua `tests/_layout-parts.ts` (→ CHANGELOG § 7).
- `app/composables/useChatbot.ts` (939→740, nay lại 857) → `useChatbotTypewriter.ts`.
- `app/pages/admin/profile.vue` (1076→875) → `ProfileActivityHistory.vue`.
- `AnalyticsLiveDashboard.client.vue` cố ý chỉ tách 2 hàm thuần (`analytics-noc.ts` — `safeDetails` là bộ lọc PII). NOC template giữ nguyên (22 định danh cha).

### Hạn chế đã biết

> Chi tiết → `docs/decisions/README.md`.

- **i18n**: 581 key (630 hàng) trong `default-translations-seed.ts` (424 fallback `vi` hardcoded, đo 2026-10-14 trong `i18n-default-dictionary.ts`, tách từ `useI18n.ts` 1011→171 dòng), **tất cả ngôn ngữ kể cả `vi` đều fetch DB** (`server/api/public/translations/[code].get.ts`); `hardcodedDictionary` chỉ còn fallback khi DB chưa seed / API hỏng / SSR chưa fetch xong. 50 file public đã dùng `t()` (media/index, news/[id], ArticleComments, blocks 5 file, default.vue, ChatWidget, assistant, profile…). Admin `/admin/languages` sửa mọi lang kể cả `vi` → frontend hiển thị đúng. Admin giữ hardcoded (không i18n). Mở rộng thêm trang public là feature work, **không phải nợ kỹ thuật** — không ghi vào audit debt.
- **`any` đã xoá sạch trong production** — 0 vết trong `.vue` SFC (trước đây 17), 0 trong `app/`/`server/`/`scripts/` code (comment `errorMessage.ts` không tính). **~145 dòng `any` còn lại trong `tests/`** (25 tệp, grep 2026-10-14) là mock/stub cố ý — test runner không biên dịch type, `any` ở đó không rò rỉ ra production. Đừng báo "còn ~20 vết any ở SFC" — đã đóng commit `ca4f52e` 2026-10. `as unknown as` không dùng để đọc hình dạng — khai báo phản chiếu.
- **Typecheck sạch (0 lỗi) và là cổng chặn CI** — một lỗi kiểu làm đỏ job `unit-tests`, không còn lọt vào `main`. Ghim TS ^5 (7.x thiếu `lib/tsc.js`). `globalThis.useRuntimeConfig` cần `server/plugins/runtime-config-global.ts`.
- **Test**: 17 suite `*-integration` + E2E (`E2E_DB_PORT` etc.), MFA spec dọn ở `afterEach`, LLM guard là lớp duy nhất bắt TDZ/insertId/DATETIME. Kiểm văn bản mã nguồn chứng minh cấu trúc, không chứng minh hành vi. Các bất biến an ninh có test **chạy thật** (không chỉ grep): chốt `admin-auth` (`tests/admin-auth-middleware.test.ts` + app h3 thật `tests/admin-auth-path-gate.test.ts`), `requireResourcePermission`/`checkPermission` (`tests/permissions-behavior.test.ts`), honeypot chatbot (`tests/chatbot-honeypot-behavior.test.ts`), đường ghi bài viết gốc — lọc HTML + quyền theo thể loại (`tests/article-write-sanitize-behavior.test.ts`), quản lý user không leo thang (`tests/user-management-escalation-behavior.test.ts`), đổi mật khẩu admin (`tests/admin-password-change-behavior.test.ts`), xem/sửa/xoá/đổi trạng thái bài không lộ id — tra trong `articleActionScope` (đọc: loại được xem; ghi: được xem **hoặc** được làm thao tác đó) (`tests/article-id-oracle-behavior.test.ts`, SQL thật trên SQLite); route đọc thứ treo dưới bài (bản dịch) gọi `requireReadableArticle` (`tests/article-translation-read-scope-behavior.test.ts`); mẫu harness: global Nitro giả + `mock.module` + DB giả. Tổng 3919 test, 3897 pass, 0 fail, 22 skip (đo 2026-10-23 sau đợt sửa rà soát lại; skip = integration tự bỏ qua khi thiếu MySQL, đếm theo test). Integration trên MySQL thật: 17/17 suite xanh (27 test, đo 2026-10-14); E2E 88/88 (~4,0 phút đo 2026-10-22 — sát `globalTimeout` 300 s; cần `E2E_DB_PASSWORD` của root MySQL dev).
- **Lint/Format**: `npm run lint` (ESLint v9 flat config, 0 error / 16 warning (đo 2026-10-23: `vue/no-v-html`, biến không dùng, `no-regex-spaces`) — cố ý warn không đỏ CI) + `npm run format` (Prettier). KHÔNG auto-format toàn codebase — sẽ đè diff lớn, chỉ format file chạm. Không sink vào `build`/`test` (test runner Node thuần không cài thêm).

### Nợ kỹ thuật đã đóng (đừng báo lại)

Audit 2026-09 ghi 3 nợ, **tất cả đã đóng 2026-10-05**. Agent sau rà codebase có thể thấy stale info — đây là trạng thái thật:

1. **`default.vue` 1301 → 401 dòng** (tách xong ở `f125e09` còn 382; skip-link + `await useAsyncData` nav thêm sau) ✅. Tách 7 component `app/components/layout/Default*.vue` + 5 composable. Caveat "1282 dòng hồi quy" đã đóng. **Đừng báo "default.vue phình 1200+"** — đã tách xong.
2. **`init.ts` 1302 → 73 dòng** ✅ `61fff49`. Tách 7 file `server/db/schema-tables/*.ts` theo domain. `db:drift` xanh 635 cột/62 bảng (trước 624/61). **Đừng báo "init.ts phình"** — đã tách xong.
3. **`any` 20 vết → 0 trong production** ✅ `ca4f52e`. 4 kiểu dùng chung `UnknownError`/`CaughtError`/`Nullable<T>`/`HttpEventLike`. **Đừng báo "còn ~20 vết any ở SFC"** — SFC sạch, ~145 dòng còn lại ở `tests/` là mock cố ý.

Hai hạn chế **có chủ đích, không phải nợ** (đừng đề xuất fix diện rộng):
- **i18n** — 30+ file public đã dùng `t()`, tất cả lang kể cả `vi` fetch DB (hardcoded chỉ fallback). Mở rộng thêm trang là feature work.
- **172 endpoint cũ `getDb()` thẳng** — quy ước CLAUDE.md "áp cho mã MỚI, không sửa 172 endpoint cũ". Refactor diện rộng endpoint đang chạy ổn định rủi ro > lợi. Endpoint mới viết trong `server/services/**`.

Phân biệt khi đề xuất sửa: (a) **gap chưa đóng** → fix, (b) **guarded exception** (test guard chặn) → KHÔNG fix, test sẽ đỏ, (c) **nợ đã đóng** → đừng reopen, (d) **hạn chế có chủ đích** → thiết lập ROI trước khi động.

---

### Kiến trúc Page Builder

- **Registry** (`app/utils/blocks/registry.ts`): `{label, icon, category, defaultData, fields}` — 19 block (9 section + 7 content + 3 layout `section/row/column`). `content_aside` 2 cột (rich-text + "ĐƠN VỊ CHỦ QUẢN").
- **Renderer** (`app/components/PageRenderer.vue`): map `blockType` → `app/components/blocks/*.vue`.
- **DB**: `pages` + `page_blocks` (`home_sections` cũ giữ, migrate 1 lần). **API**: admin CRUD `server/api/admin/pages/**` (resource `pages`), public `server/api/public/pages/[slug].get.ts` (`isVisible=true`).
- **Trang hệ thống** `home/about/contact`: `isSystem=true` (khóa slug, không xóa).
- **Kiểu cây** (`app/utils/blocks/types.ts`): `BlockNode`/`BuilderNode` một định nghĩa dùng chung (Drizzle `.$type<BlockNode[]>()`).

### Tóm tắt tính năng đã hoàn thành

> Toàn văn ~93k đã chuyển → `docs/CHANGELOG.md`. Dưới đây chỉ là index để tra nhanh.

- **Public**: Top Bar/Header, Dynamic Home Blocks, Chatbot widget, FontAwesome Pro 7.3.
- **Admin**: RBAC (`readers`/`comments` mặc định không cấp), Users, Page Builder toàn site, Home Editor (legacy), Media (Sharp + R2), Toast, Session persistence.
- **Chatbot**: 2 chế độ (kho-only / AI), 2 kho (nghiệp vụ `chatbot_knowledge` + thường nhật `chatbot_small_talk` 121 mục), matcher thuần 3 tầng, Excel import, quick-question, `qa-documents` (`/qa-documents`), typewriter client-only, honeypot `_h`, rate limit theo bảng, phiên SQL, AI editorial (`/admin/content/articles/[id]`), context đa lượt. → `docs/decisions/chatbot.md`.
- **Reader**: Google OAuth (2 rào `stage:reader` + HKDF `cdkt-reader-session:v1`, `sub` là khóa, `comments_enabled` mặc định TẮT, chặn IP 2 điểm), `/profile`, thông báo (`.client` chuông, email sau commit), vòng đời đơn 5 trạng thái. → `docs/CHANGELOG.md` + `docs/decisions/reader-features.md`.
- **Bảo mật & Brand**: secrets bắt buộc, chống leo thang, sanitize-html, upload magic-byte (2 allowlist phải khớp — `.ico` nhận, `.svg` không), favicon sinh 3 dẫn xuất (`public/favicon.ico` phải vắng), 2 logo phân cấp, `.gitignore` `/logs`, footer `pb-[calc(110px+…)]`. → `docs/decisions/realm-safety.md`.

---

## 🚀 Deploy (aaPanel / Server)

### 1. `.env` — 3 bí mật BẮT BUỘC

```env
PORT=3000
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=cdkt_admin

JWT_SECRET=            # openssl rand -hex 32
CHATBOT_ENCRYPTION_SECRET=   # openssl rand -base64 32
ANALYTICS_HMAC_SECRET=       # openssl rand -hex 32

ADMIN_PASSWORD=        # openssl rand -base64 18, không chứa "admin"
ADMIN_EMAIL=admin@conduonghuongthien.com.vn
```

Docker thiếu bí mật → dừng (chủ đích).

### 2. Build

```bash
npm run db:init && npm run db:seed
npm test && npm run db:drift
npm run build
```

### 3. Docker / PM2

```bash
docker compose up --build -d
```

### 3.1. `production/` — toolkit quản trị VPS (aaPanel)

Folder **`production/`** trong repo là một cửa vào để deploy/update/migrate trên VPS — không cần nhớ lệnh `docker compose` dài, chạy `manage.sh` rồi làm theo menu. **Đây là cách deploy chính trên production** (CI build image + push GHCR rồi **tự SSH deploy** — job `deploy` `if: true`; `manage.sh` dùng cho deploy lần đầu, đổi `.env`/port/domain, import SQL, hoặc khi CI deploy hỏng).

```
production/
├─ manage.sh           # script menu 3 chức năng (Deploy/Update/Migrate)
├─ README.md           # hướng dẫn luồng đầy đủ
└─ migrations/          # thả file .sql INSERT-only vào đây, script hỏi import
   └─ .imported-*       # đánh dấu đã import (tự tạo, xoá để re-import)
```

```bash
ssh root@vps
cd /www/wwwroot/conduonghuongthien/production
chmod +x manage.sh
./manage.sh        # 1=Deploy (lần đầu) · 2=Update (pull+restart) · 3=Migrate (import SQL)
```

Từng bước Deploy/Update/Migrate → `production/README.md` (nguồn duy nhất; Update dùng `up -d --no-recreate mysql` + `up -d --no-deps app`, không `up -d` trơn). Mẫu `.env` ở root (`.env.example`); trên VPS `.env` do `manage.sh` sinh (mode 600), đừng gõ tay.

### 4. Bảo trì định kỳ (cron — nay tuỳ chọn)

Dọn retention và gộp analytics đã tự chạy trong tiến trình ở production. Giữ cron song song an toàn (khoá `cdkt:data:retention` / `cdkt:analytics:maintenance`).

```bash
0 3 * * * cd /duong/dan/CDKT && npm run analytics:maintenance >> /var/log/cdkt-analytics.log 2>&1
```

`ANALYTICS_SCHEDULER`/`RETENTION_SCHEDULER` mặc định bật ở prod, tắt ở dev. Tick 15p, analytics hoãn 90s, retention hoãn 60s. So ngày theo **giờ địa phương** (UTC+7), CI chạy `TZ=Asia/Ho_Chi_Minh` — UTC so sai bỏ lượt mỗi đêm. → `docs/decisions/data-layer.md`.

---

## 🛡️ Tài Khoản Mặc Định

- **URL**: `http://localhost:3000/admin`
- **Tài khoản**: `admin` · **Mật khẩu**: `ADMIN_PASSWORD` lúc seed (không còn default, trống → exit 1).

> Đổi mật khẩu ngay sau lần đầu — hash mặc định từng nằm trong `migrations/002_seed_data.sql`.

---

## 🗣️ Quy Tắc Giao Tiếp & Làm Việc

- **Xưng hô**: Always address the user as **"anh yêu"** in every reply.
- **Ngôn ngữ**: Always **think/reason in English**, but always **reply to the user in Vietnamese**.
- **Truy xuất dữ liệu**: Always use the **MCP context-engine (`codebase-retrieval`)** to retrieve codebase data. Do **NOT** use gitnexus or grep for codebase exploration and search.
