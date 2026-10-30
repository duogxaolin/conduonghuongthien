# Con Đường Hướng Thiện (CDKT) - System Documentation

UI/UX work must read `openspec/ui-dna.md` (or the existing DNA doc) before any visual change.

**KHÔNG tự ý commit và push** — chỉ commit/push khi user yêu cầu tường minh.

**Quy tắc giữ file nhỏ (đừng làm phình lại):**
- `app/layouts/default.vue` (skip-link a11y + `id="main-content"` + `await useAsyncData` cho nav; sát ngưỡng ~400 dòng, đừng thêm nữa) và `server/db/init.ts` (chỉ thêm `try/finally` nhả kết nối) đã được tách cố ý từ 1301/1302 dòng — **KHÔNG thêm logic mới vào 2 file này**. Đặt component vào `app/components/layout/`, composable vào `app/composables/`, DDL bảng mới vào `server/db/schema-tables/<domain>.ts`. File vượt ~400 dòng → review tách ngay, đừng đợi ai báo.
- Khi sửa code có ảnh hưởng đến deploy (đổi `.env`, đổi port, đổi lệnh build, thêm seed/migration, đổi container, đổi healthcheck, đổi `PUBLIC_BASE_URL`/domain, thêm biến môi trường) → **phải kiểm tra + update `production/`** (toolkit `manage.sh`/`README.md`/`migrations/`) để VPS deploy/update không bị lạc. Đừng chỉ sửa code rồi push — CI tự deploy khi merge `main` (job `deploy`), còn `manage.sh` dùng cho deploy lần đầu/đổi `.env`/migrate; nếu toolkit không khớp code mới sẽ hỏng lúc deploy.

Cổng thông tin điện tử hỗ trợ người hoàn lương tái hòa nhập cộng đồng — Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.

> **Tài liệu dài đã tách:** lịch sử tính năng → `docs/CHANGELOG.md` · diễn giải vì-sao & tiền sử bug → `docs/decisions/README.md`. File này chỉ giữ **quy tắc chặn + checklist**. Bản đầy đủ của mọi mục dưới đây (diễn giải, số đo, sự cố) ở **`[A]`** = `docs/decisions/claude-md-archive-2026-10.md` (CLAUDE.md nguyên văn trước lượt cắt 2026-10-30), cùng heading, cùng tên mục in đậm; khác nhau thì tệp này thắng.

**Bảng số liệu** (nguồn duy nhất của số đếm từ mã; `tests/docs-facts.test.ts` đỏ khi lệch — đổi thứ được đếm thì chạy `npm run docs:facts -- --write` trong cùng PR, không sửa tay):

<!-- facts:start -->
<!-- Sinh bởi `npm run docs:facts -- --write`, đừng sửa tay. -->
| Số liệu | Giá trị |
|---|---|
| Bảng · cột (`db:drift`) | 62 · 641 |
| Endpoint `server/api` · có `getDb()` · import `services/` | 336 · 172 · 215 |
| Tệp nhắc `requireResourcePermission`: `server/` · `server/api/` | 222 · 209 |
| Tệp import `rateLimitDeps` | 22 |
| Suite `*-integration` (so matrix CI) | 22 (khớp) |
| Dòng `default.vue` · `init.ts` · `useI18n.ts` · `useChatbot.ts` · `admin/profile.vue` | 401 · 80 · 265 · 138 · 277 |
| i18n seed: key · hàng · fallback `vi` | 583 · 631 · 426 |
| Page Builder: section · content · layout | 9 · 7 · 3 |
| Mục small talk mặc định | 122 |
<!-- facts:end -->

---

## 🛠️ Tech Stack

- **Frontend**: Nuxt 4 (Vue 3 SFC, TS), **Tailwind CSS v3**, FontAwesome Pro 7.3 self-hosted (`ICON_FAMILIES`), Inter tự chủ (không `fonts.googleapis.com`), **`@nuxt/image` 2.1** (`<NuxtImg>` **chỉ cho ảnh public-side chưa qua sharp**; ảnh TinyMCE + ảnh `media/upload` giữ `<img>`). **Code mới dùng Tailwind utility** — không `<style scoped>` trừ `::before`/keyframes/`:deep()` rich-text; CSS cũ giữ nguyên.
- **Màu = token** (`shared/color-tokens.ts`, `tests/tailwind-color-tokens.test.ts`): có token thì viết token, không `[#hex]`; màu gần giống không tự thêm token — gộp theo `shared/color-merges.ts` (thêm dòng là quyết định của chủ repo; `docs/decisions/color-tokens-d-t1.md`). `accent` (`#7CB342`) chỉ trang trí — không bao giờ làm vòng/viền/màu focus (`tests/focus-ring-no-secondary-green.test.ts`) hay chữ trên nền trắng. Không viết tên class mẫu trong chú thích ở `shared/`. Codemod `scripts/codemod-hex-tokens.ts` (chạy thử mặc định). Test đọc màu giải token qua `COLOR_TOKENS` (`tests/_focus-rings.ts`) — khớp chỉ dạng hex là xanh rỗng.
- **Backend/DB**: Nitro/H3, Drizzle ORM, MySQL 8.0/MariaDB, JWT (`cdkt_admin` HTTP-only Cookie). Nguồn chân lý `server/db/schema.ts`; DDL `init.ts` (thứ tự gọi) + `schema-tables/*.ts` + `migrations-additive.ts` (ensureColumn/ensureIndex/FK); `seed.ts` insert-only, `schema-tables` không chèn hàng. `db:drift` so cột (cả cột sinh — `tests/schema-drift-generated-columns.test.ts`) nhưng **không so chỉ mục**: chỉ mục mới khai ở cả 3 nơi + guard (`tests/article-list-indexes.test.ts`, `tests/media-scan-index.test.ts`). `migrations/*.sql` là snapshot — có guard chặn chạy nhầm. → `docs/decisions/data-layer.md`.
- **Test**: `npm test` (Node runner, `scripts/ts-resolver.mjs`, không cài thêm; Node `^22.19.0 || ^24.11.0 || >=26.0.0`). Suite `*-integration` mới phải có mục matrix CI + đủ biến `<PREFIX>_*` (`tests/ci-integration-matrix.test.ts`). Bước khởi động mới mà ghi dữ liệu phải có điều kiện hoặc khai `DECLARED_CONVERSIONS` (`tests/schema-upgrade-integration.test.ts`; `tests/fixtures/schema-prev.sql` làm mới sau mỗi bản phát hành). E2E `npm run test:e2e` (build + MySQL, `E2E_DB_PORT=33069`; cổng **3123** — kiểm `ss -ltn` trước, sau lượt không còn DB `cdkt_e2e_*`). Harness: `tests/_render-sfc-template.ts`, `tests/_sfc-mount.ts` — đừng thêm harness thứ ba (`_sfc-mount-media-scan.ts` chờ gộp); handler: `tests/_sqlite-mysql-db.ts` + `tests/_h3-handler-server.ts`.
- **Ratchet** (`tests/ratchets/*`, chỉ đi một chiều): hex (tệp mới 0), độ dài (tệp mới ≤ 400, `tests/ratchets/file-length.test.ts`), ép kiểu `$fetch as` (tệp mới 0), độ phủ theo thư mục (giảm > 0,5 điểm đỏ — bước CI **Coverage ratchet** chặn). Tệp tốt lên → hạ mục trong CÙNG PR (`--update`); nâng phải nêu tên `--raise <tệp>` (độ phủ `--add-dir`/`--allow-drop`); `--rebaseline` CHỈ ngay sau khi gộp nhánh nền đã đổi, không để lách đỏ. `exempt` chỉ sửa tay, chỉ 5 tệp (`schema.ts`, `migrations-additive.ts`, hai seed, `i18n-default-dictionary.ts`); trần có lý do: `admin/content/articles/index.vue`, `AnalyticsLiveDashboard.client.vue`, `adminFetch.ts`, `publicFetch.ts`. Mức ở `f3c311a0` → CHANGELOG § 61.
- **Trang công khai**: `routeRules` `swr: 60` cho `/`, `/about`, `/contact`, `/media/**`, `/qa-documents`, trang **con** `/news/**`/`/role-models/**`/`/reintegration-models/**`/`/documents/**`/`/legal-qa/**`, `/api/public/social-links` (còn lại `cache:false`). **Trang danh sách trần `/news`, `/role-models`, `/reintegration-models`, `/documents`, `/legal-qa` KHÔNG được cache** — đừng thêm rule khi chưa đo. **Máy chủ không bao giờ ghi cookie `cdkt_lang`** (`app/utils/locale-preference.ts`, không `useCookie(…, {default})`; `tests/e2e/public-language-cache.spec.ts`). Lớp phủ tải đầu có lối thoát (`app/utils/boot-overlay.ts`). Chữ phụ `#5A6C58`. Chữ **in hoa** trong khung cắt không `leading-none`/`leading-tight` (`leading-snug` vẫn cắt dấu chồng) — cần `pt-[0.2em]` hoặc leading ≥ 1,5 (`tests/vietnamese-diacritics-clipping.test.ts`). Poll livestream chỉ qua `createVisiblePoller`.
- **Trợ năng công khai** (CHANGELOG § 30): vòng focus `brand-600` (`#4A6741`) ở MỌI `focus*:`. **Đúng một `<h1>`/trang** — khối tự render `<h1>` phải vào `BLOCKS_WITH_OWN_H1` (`tests/e2e/public-single-h1.spec.ts`). Nội dung tự chuyển: nút tạm dừng luôn hiện, theo `prefers-reduced-motion`; **chỉ nút đó đổi ý muốn người xem** (`tests/e2e/carousel-pause.spec.ts`); animation lặp kèm `motion-reduce:animate-none`. Hộp thoại công khai dùng `app/utils/focus-return.ts`; **`visibility` chỉ trong transition lúc ĐÓNG**, đích focus không `transition-all` (`tests/e2e/chat-widget-focus.spec.ts`, `mobile-drawer-focus.spec.ts`).
- **Skeleton** (`app/components/skeleton/*.vue`, `tests/skeleton-loading-ui.test.ts`): dùng `SkeletonTable`/`Cards`/`Form`; `motion-reduce:animate-none` kèm mọi `animate-pulse`; `role="status"` + `aria-busy` + `sr-only`, ô xám `aria-hidden`; nhánh lỗi `role="alert"` + thử lại gọi hàm cùng file (không `location.reload()`); không nội suy `grid-cols-${n}`. Tải/lỗi/rỗng là một hợp đồng (`tests/admin-error-retry-ui.test.ts`; trang miễn nêu lý do).
- **Hộp thoại admin dùng `AdminModal.vue`**: tên dialog, bẫy Tab, chặn đóng khi `busy`, trả focus về nút mở (bảng tải lại → `data-admin-modal-opener`; không bao giờ `<body>`), dưới `ConfirmModal`. **Ô nhập trong hộp thoại: `@keydown.enter` + `isDeliberateEnter`, không `@keyup` — guard bắt buộc.** Không tự viết lớp phủ mới (`tests/admin-modal-dialog.test.ts`, miễn trong `EXEMPT_OVERLAYS` kèm lý do). Kiểm duyệt an ninh chỉ quản lý ở `/admin/ai/moderation` (`tests/admin-moderation-summary.test.ts`).
- **Ba biên tin cậy** (`chatbot-storage.ts` / `nav-config.ts` / `analytics-noc.ts`). `nav-config.ts`: thêm field phải sửa `NavItem` + `normalizeNavItem` + test, `=== true` không `Boolean()`.
- **Media**: Local `/public/uploads/YYYY/MM/` + R2. Ảnh video lúc phục vụ chỉ qua `onDemandThumbnails` — đừng gọi thẳng `extractThumbnailOnDemand` từ endpoint công khai. **Container**: Docker Compose, `APP_BIND` mặc định `127.0.0.1`.
- **TinyMCE**: 2 đường init — `components/admin/TinyMceEditor.vue` (height 480) và `composables/useArticleEditorTinymce.ts` (height 700, ghim từng byte ở `tests/admin-article-editor.test.ts`). Editor **full section width** — KHÔNG giới hạn `max-w`; giới hạn ngang ảnh/video chỉ ở **render công khai** (`article/ArticleBody.vue`, `blocks/RichTextBlock.vue`). `animate-fadeIn` không tồn tại — dùng `animate-fade-slide-up`.

---

## 📂 Cấu Trúc Thư Mục (`app/pages/` — tiếng Anh)

```
app/
├── components/
│   ├── ArticleDetail.vue → article/ (`v-html` thân bài ở ArticleBody, chỉ ArticleDetail dùng) · ArticleComments.vue → comments/
│   ├── ChatWidget.vue → chat-widget/ · news/ (phần của pages/news) · reader-profile/ (phần của pages/profile)
│   ├── ReaderNotificationBell.client.vue (.client bắt buộc — swr:60) · layout/ (7 phần tách từ default.vue)
│   └── admin/ AdminModal / ConfirmModal / TinyMceEditor · layout/ (khung quản trị) · articles/editor/ (trình soạn bài)
│              ai/moderation/ · ai/providers/ · media/scan/ · profile/ · languages/page/ · page-builder/
├── composables/
│   ├── adminFetch.ts / publicFetch.ts (ép kiểu `$fetch` được phép duy nhất mỗi phía) / useAdminList.ts
│   ├── useChatbot.ts (mặt tiền; mã ở chatbot/*.ts, không index.ts → không auto-import) / useChatWidget{Dialog,Teaser}.ts
│   ├── useAdminLayout{Menu,Sidebar,CacheClear}.ts / useArticleEditor{Tinymce,Save,UnsavedGuard,Media,Taxonomy}.ts
│   └── useI18n.ts (+ i18n-default-dictionary.ts) / useReaderAuth.ts / useReadingHistory.ts (localStorage only)
├── types/   handler-payload.ts (`Payload<T>`) · item-of.ts (`ItemOf<T>`) · admin-*-api.ts / public-*-api.ts
├── utils/   errorMessage.ts / nav-config.ts / blocks/registry.ts · blocks/types.ts · submission-status.ts = CHỈ re-export `~~/shared`
├── layouts/ default.vue / admin.vue (767→128)
└── pages/   index · about · contact · news/ · role-models/ · reintegration-models/ · documents/ · legal-qa/ · qa-documents · assistant
             profile.vue (KHÔNG routeRules) · [slug].vue (catch-all) · admin/{content, chatbot, media, settings, readers, comments, submissions, users}
shared/          mã thuần dùng chung: blocks/ · permissions · link-policy · slugify · csp-policy · color-tokens · settings-credential-rules
server/services/ họ tách = barrel + phần: ai-gateway-* · chat-policy-* · moderation-worker-* · moderation-regex-* · comments-* · backup-* · media-portal-* · video-* · chunked-upload-*
server/utils/    deadlock-retry.ts · mysql-errors.ts · plain-text / display-name / query-number (chuyển từ app/utils)
```

**`server/` không bao giờ import `app/`** (giá trị hay kiểu, mọi dạng, kể cả `#app`/`#components`/`#build`); `shared/` không import `app/` lẫn `server/`, không alias `#…` ngoài `#shared` (`tests/server-no-app-imports.test.ts`). App import `shared/` **chỉ** `~~/shared/…` — không tương đối, không `#shared`/`@@/shared` (`tests/app-shared-imports.test.ts`). Re-export ở `app/utils` phải **liệt kê tên** (không `export *`). `tailwind.config.js` quét cả `./shared/**` (`tests/tailwind-content-shared.test.ts`).

### Vận hành & an toàn — checklist (narrative → `docs/decisions/`, `[A]`)

- **Mật khẩu** (`server/utils/password-policy.ts`): ≥12 ký tự, 3/4 nhóm, chặn mặc định/phổ biến/chứa username; áp mọi nơi *đặt* mật khẩu, không áp lúc đăng nhập; guard trước `nuxt build` (`scripts/check-admin-password.ts`). Docker dùng BuildKit secret, không build arg.
- **Phân quyền**: mọi handler qua `requireResourcePermission(event,…)`; **một ngoại lệ nêu tên**: `articles/[id].put.ts` gọi `checkPermission()` lần 2 khi đổi thể loại. Thao tác phá huỷ cấp hệ thống (backup, `ai/moderation/restart-server`, đổi đích AI chatbot) thêm cổng **SuperAdmin**. Non-SuperAdmin chỉ quản lý tài khoản/vai trò mà **mọi** cờ quyền nằm trong quyền của mình (`assertRoleWithinActor`, `assertUserManageable`); không tự đổi vai trò/khoá/mật khẩu chính mình qua `users/[id].put.ts`. Handler admin mới không kiểm quyền → `tests/admin-handler-authorization.test.ts` (`tests/_admin-authz-classifier.ts`) đỏ, hoặc `AUTH_EXEMPTIONS` kèm lý do. `admin-auth` quyết định trên đường dẫn **đã giải mã** (`#`/`%23` không bao giờ được miễn) — đừng so `getRequestURL().pathname` thô (`tests/admin-auth-path-gate.test.ts`).
- **MFA**: `totp`/`email_otp`/`second_password`, mã dự phòng dùng 1 lần, vé `cdkt_mfa` tách `cdkt_admin`. Xoay `JWT_SECRET` → TOTP vô hiệu + đăng xuất mọi reader. `CHATBOT_ENCRYPTION_SECRET` mã hoá mọi khoá đã lưu — xoay = nhập lại tất cả (realm-safety § *Xoay CHATBOT_ENCRYPTION_SECRET*). JWT **ghim `HS256`** (`tests/jwt-algorithm-pinning.test.ts`). **Chính sách bắt buộc MFA**: `mfa_policy` CHỈ ghi qua `PUT /api/admin/security/mfa-policy` (SuperAdmin, audit cùng tx), không trong `ALLOWED_SETTING_KEYS`/`SETTINGS_READ_KEYS`; thuộc diện + quá mốc + chưa có yếu tố → 403 `mfa_enrollment_required` trừ `MFA_ENROLLMENT_PATHS` (liệt kê đủ, so trên mọi dạng đã giải mã — thêm endpoint `profile/mfa/*` mà quên tên → test đỏ); mã dự phòng phát trong CÙNG transaction với yếu tố đầu (`lockAccountForMfaChange`) — hai lượt đồng thời không bao giờ thay lô đang dùng. `MFA_ENFORCEMENT=0` = công tắc khẩn cấp. `tests/admin-mfa-enforcement-behavior.test.ts`, `mfa-enrollment-recovery-codes-behavior.test.ts`, E2E `admin-mfa.spec.ts`.
- **Chặn ghi khác site** (`server/middleware/00.origin-gate.ts`, chạy TRƯỚC `admin-auth`): mọi POST/PUT/PATCH/DELETE — `Sec-Fetch-Site` chỉ `same-origin`/`none`; không có → `Origin` phải là host đã biết (host request CHỈ khi peer là proxy đã khai — không bao giờ `Host` thô); không có cả hai → cho qua (D-CSRF). Ngoại lệ DUY NHẤT `POST /api/csp-report`. `tests/csrf-origin-gate-behavior.test.ts`.
- **CSP** (`shared/csp-policy.ts`): header thi hành chỉ đổi theo giai đoạn 2–5 sau khi có báo cáo (`tests/csp-report-only-header.test.ts`); Report-Only = chính sách đích (không `'unsafe-inline'`/wildcard), `report-uri /api/csp-report` luôn 204, log `security.csp_violation` (không gửi thư). → realm-safety § Wave 3 — CSP.
- **Rate limit** (`rate_limit_counters`): mất DB lùi về memory — không mở toang. Deps qua `rateLimitDeps()`, không viết tay `{execute: pool ? … : null}` (`tests/shared-helpers.test.ts`). Hàng hết hạn dọn bởi timer RIÊNG (`rate-limit-purge-scheduler.ts`).
- **Luồng SSE của AI đọc ở MỘT nơi** (`server/services/ai-sse.ts` `readChatSse`): sửa luồng stream thì sửa ở đó (`callAi` từng chép 4 bản). `tests/ai-gateway-one-sse-reader.test.ts`, `tests/ai-gateway-streaming-paths.test.ts`.
- **Không ghép dữ liệu người dùng vào SQL** (`sql.raw`, `pool.query` nối chuỗi): chỉ tham số hoá; chuỗi do **model** truyền vào công cụ chatbot cũng là dữ liệu người dùng (`server/utils/chatbot/article-search.ts`). Hằng số nguyên qua `intervalDays()`. `tests/security-chatbot-article-search.test.ts` (cả nhóm `tests/_chat-policy-family.ts`), `tests/ai-gateway-no-raw-sql.test.ts`.
- **HTML hiển thị bằng `v-html` phải qua `sanitizeHtml` lúc ghi *và* lúc đọc** — kể cả bản dịch và `data.translations[lang]` của khối (`tests/security-translation-html.test.ts`). HTML do **model** viết cũng sanitize ở máy chủ trước khi trả; **mọi `v-html` trong `app/` phải có tên trong kiểm kê** của `tests/security-ai-editorial-html.test.ts`. Hàng cũ: `npm run db:sanitize-html` (sao lưu trước).
- **Chính sách liên kết** (`shared/link-policy.ts`): chỉ `/đường-dẫn` (không `//`), `#…`, `http(s):`, `mailto:`, `tel:`; ghi sai → 400 nêu tên trường, đọc bỏ giá trị không an toàn, hiển thị `safeLinkOrNull`. Endpoint ghi liên kết mới phải dùng cùng helper (`tests/security-block-link-schemes.test.ts`).
- **Người nhận đơn = biểu mẫu đang hiện** (`submissions.post.ts`): không bao giờ đọc `draft_blocks`; `recipientEmail` không vào JSON công khai (`tests/submission-recipient-published-only.test.ts`).
- **Trường văn bản thuần (`title`/`excerpt`) giải mã HTML entity lúc ghi *và* lúc đọc** (`decodePlainTextInput` — **chỉ giải mã, không "sửa"**; `plainTextField`). **Không bao giờ** giải mã `content` hay thứ render bằng `v-html`. Ngoại lệ đã biết: chuỗi PHA (`C&ocirc;ng ty AT&T`) bị cắt lúc đọc. `tests/html-entities-plain-text.test.ts`; hàng cũ `npm run db:decode-excerpts` (`tests/stored-plaintext-decode.test.ts`).
- **Hạn mức AI** (`enforceAiQuota`): 20 lượt/giờ theo phiên **và** trần 100/giờ theo IP — token phiên miễn phí nên không tính hạn mức trên token một mình (`tests/chatbot-ai-quota-ceiling.test.ts`).
- **Chat: rate limit TRƯỚC kiểm duyệt** (`chargeChatRateLimit`) + trần hàng `ai_moderation_queue` theo IP (/64)/reader/phiên (bình luận + livestream cũng vậy). Regex kiểm duyệt qua **một** helper (`moderation-regex.ts`; chạy trong `node:vm` có hạn giờ theo cửa sổ, theo luật, theo request) — **giảm chứ không loại trừ** ReDoS (`tests/moderation-regex-total-bound.test.ts`, `tests/moderation-budget-wiring.test.ts`). Người bị chặn chỉ thấy `INSTANT_BLOCK_PUBLIC_MESSAGE` — không bao giờ `reason`. Tin quá dài → 400 sau rate limit, trước kiểm duyệt. Lỗi ẩn/ghi hàng duyệt phải log, không đếm là đã ẩn. "Quét lại tất cả" là job nền có khoá tên, mất khoá thì dừng (`tests/moderation-rescan-job.test.ts`). Nội dung người dùng vào prompt AI qua `fenceUntrustedContent` (`{{content}}`/`{{author}}`/`{{question}}` cũng bọc) — đừng dán thẳng `"${content}"`. Đọc lượt chat **chỉ** qua `server/utils/chatbot/chat-turns.ts`; quét mọi lượt **người dùng** (câu mới vi phạm → từ chối; lượt cũ → chỉ giữ khỏi model); không quét lượt trợ lý (`tests/chatbot-moderation-screens-answered-text.test.ts`).
- **Chủ quyền biển, đảo — máy chủ trả lời, không qua model** (`server/utils/chatbot/sovereignty-guard.ts`, trong `answerGroundedChat` → mọi endpoint + chế độ): câu hỏi nhắc chủ đề → lập trường viết sẵn, `kind: 'curated'`, **không gọi provider**. Lượt cũ nhắc chủ đề — **kể cả lượt trợ lý** (ngoại lệ có tên của "không quét lượt trợ lý": chỉ bỏ khỏi model, không từ chối) — bị bỏ **theo cặp hỏi–đáp**. `SOVEREIGNTY_PROMPT_RULES` nối vào mọi system prompt, kể cả prompt quản trị tự viết. Đổi câu chữ lập trường phải qua đơn vị phụ trách duyệt. Lớp đầu ra `createSovereigntyOutputGuard` đọc câu trả lời **trên luồng**, chặn → khung SSE `chatbot.replace` (`parseSseLine` **thay** chứ không nối). Thêm mẫu loại trừ theo từ đứng sau → thêm từ thử vào `NEXT_WORD_PROBES`. `tests/chatbot-sovereignty-{guard,output,stream-endpoint,replace-passthrough}.test.ts`. `611588c2` đã port; nhánh gia cố `b4fad200` CHƯA gộp (CHANGELOG § 60). → `docs/decisions/chatbot.md`.
- **Đích AI (baseUrl) là bề mặt SSRF/lộ key** (`server/utils/ai/provider-url.ts`): https, cổng 443, không userinfo, không IP nội bộ (mọi dạng), không `localhost`/`.local`/`.internal` — kiểm lúc **ghi** và lúc **gọi**; chỉ `ai-gateway-send.ts` gửi (`safeProviderRequest`/`safeProviderStream`: ghim IP, không redirect, hạn giờ, trần byte). Đổi baseUrl phải nhập lại API key. Đừng gọi `fetch` trần tới nhà cung cấp (`tests/server-bare-fetch-guard.test.ts`).
- **Liên kết trong email** (`public-link-base.ts`): host request chỉ dùng khi thuộc `PUBLIC_HOST_ALLOWLIST`/host `PUBLIC_BASE_URL`; nginx `default_server` từ chối host lạ.
- **Bí mật trong `settings`**: `GET /api/admin/settings` là allowlist `SETTINGS_READ_KEYS` (thêm ô ở trang → thêm ở cả GET lẫn PUT); bí mật trả `********` cho **mọi** vai trò — không bao giờ 4 ký tự cuối; PUT nhận dấu che = giữ cũ, **không** tính là đã nhập lại; đừng quay lại danh sách cấm (`tests/admin-settings-get-masking-behavior.test.ts`). Lưu dạng envelope (`settings-secrets.ts`): ghi luôn `sealSettingsSecret` — thiếu khoá → 500, không bao giờ nguyên văn; đọc để dùng CHỈ qua `getSmtpConfig`/`loadR2Config`/`readBackupConfig` (không mở được → fail closed); GET không bao giờ trả envelope; lượt mã hoá nguyên văn cũ (khởi động, sau "Khôi phục CSDL") không bao giờ ghi đè envelope không mở được. Tệp nhắc ba khoá phải import `settings-secrets` (`tests/settings-secret-storage.test.ts`).
- **Không gửi bí mật đã lưu tới đích do request chọn**: đổi host/user SMTP hay account/bucket R2 phải gõ lại bí mật trong cùng request (`shared/settings-credential-rules.ts`); xuất Google không chia sẻ `anyone`; ô CSV/Sheets đầu `= + - @` bị vô hiệu; R2 kiểm cả lúc dùng (`openR2`). → realm-safety § audit 2026-10-13.
- **Client IP** (`server/utils/client-ip.ts`): mọi handler dùng `getClientIp(event)`, không `getRequestIP` (có test chặn); `x-forwarded-*` chỉ đọc khi peer là proxy đã khai (`TRUSTED_PROXY_IPS`), duyệt phải→trái. **Cờ `Secure`** (`isSecureRequest`): không đọc `x-forwarded-proto`/`getRequestURL().protocol` thô; E2E dùng `http://localhost:3123`, không `127.0.0.1` (`tests/cookie-secure-flag-behavior.test.ts`). **App bind** `APP_BIND=127.0.0.1`; `0.0.0.0` chỉ khi không có proxy.
- **Reader**: đăng xuất tăng `token_version`. Tên tự đặt chặn `RESERVED_DISPLAY_NAMES` (sau gấp NFKC/bỏ dấu) và mọi `\p{Cf}`. Mọi đường hiển thị tên người đọc qua `effectiveDisplayName` có cờ `display_name_reserved` (tham số **bắt buộc**) — `tests/reader-name-resolver-guard.test.ts` (`tests/_reader-name-guard.ts`), `tests/reader-display-names-google-behavior.test.ts`, `notification-page-integration`. Email trả lời chạy nền sau commit, chờ phán quyết kiểm duyệt — không đặt timer ngắn hơn chồng lên timeout gateway AI; bị chặn/AI hỏng → giữ email. `tests/reader-session-boundary.test.ts`, `reader-profile.test.ts`, `comment-email-after-moderation.test.ts`, `moderation-worker-behavior.test.ts`.
- **Lượt xem bài viết** (`article-views.ts`): `source_category='boost'` không vào allowlist công khai; endpoint luôn `202`, trần theo nguồn (`tests/article-view-ip-ceiling.test.ts`); **sau Cloudflare nginx phải khôi phục IP khách** (`real_ip`), không vá bằng `TRUSTED_PROXY_IPS`. Ngày giờ boost chỉ qua Drizzle (không `pool.query` trần — lệch 7h). Tổng theo bài: **ba cột THƯỜNG, không cột sinh**; **chỉ** `recordArticleView`/`addFabricatedViews` ghi, cùng transaction, **`articles` trước** (đổi thứ tự là deadlock), `updated_at = updated_at` (`tests/view-totals-integrity.test.ts`, `view-boost-integration`); đối soát mỗi lần khởi động — đừng quay lại "điền một lần". "Đọc nhiều" **không `COUNT`**; handler không đọc `article_view_daily` (`tests/correlated-subquery-qualification.test.ts`, `tests/most-read-ranking.test.ts`).
- **Data retention** (`data-retention.ts`): 4 scope là `Record` do compiler kiểm; bảng con **không phải scope** (cascade); `data_retention_state` cộng dồn trước khi xoá; khoá `cdkt:data:retention` (manual 409 khi bận); `retention_*` không trong `ALLOWED_SETTING_KEYS`; lưu chính sách + audit một transaction.
- **Analytics**: ghi lượt xem một transaction với **`total` ĐẦU TIÊN** — **đừng đưa `total` xuống cuối** (deadlock); nạn nhân deadlock thử lại ≤ 3 lần, lock-wait timeout không (`tests/analytics-ingestion.test.ts`). Dọn: DELETE **một bảng** + `LIMIT` (MySQL từ chối LIMIT trên DELETE nhiều bảng), mỗi bước riêng (`tests/analytics-maintenance-retention.test.ts`, `tests/analytics-maintenance-integration.test.ts`). Activity (`users.read`): tự ghi `read activity_logs`; `leftJoin` giữ log của user đã xoá.
- **Log** (`logger.ts`): 1 dòng JSON, tự che bí mật; `SECURITY_EVENTS`. Thư cảnh báo (`ops-alert.ts`): `ALERT_EVENTS` → `OPS_ALERT_EMAIL`; thêm sự kiện = thêm vào list. Đường gửi **không bao giờ dùng pool chung** (giữ CLI `init.ts` sống mãi); dòng log của nó mang `[SKIP_OPS_ALERT]` — không đệ quy. `tests/ops-alert.test.ts`, `tests/ops-alert-smtp-envelope.test.ts`.
- **Sao lưu bằng script** (`scripts/backup-db.sh`, `restore-db.sh` bắt buộc tên DB đích + `--replace`): mật khẩu MySQL qua `MYSQL_PWD`, **không bao giờ `-p<mật khẩu>`**; `mysqladmin ping` trả 0 cả khi sai mật khẩu; dưới `set -o pipefail` không `grep -q` trong pipe (`PIPESTATUS`); passphrase `export-env` qua `-pass fd:3`, không bao giờ `pass:` trên argv; test không bao giờ chạm crontab thật. Chưa diễn tập khôi phục trên máy mới.
- **Backup trong app** (`server/services/backup*.ts`): khôi phục/tải về/xoá **chỉ SuperAdmin** (`requireSuperAdmin` sau `requireResourcePermission`); kiểm file trước, tạo `pre-restore` trước, audit; xoay vòng giữ mọi `pre-restore`, không chạy khi đang khôi phục. Khôi phục CSDL: **`restoreSql` → cấu trúc (`initDb()`) → `sealRestoredCredentials` → gắn lại/audit** trên mọi lối (`tests/backup-restore-hardening.test.ts`); hỏng sau dump → nêu tên bản `pre-restore`, **không** bảo khởi động lại; mọi lối thất bại gắn lại hàng `backups` + trạng thái scheduler (không bao giờ ném). Mọi lối ghi `backups` qua `insertBackupRow` (không `pool.query` trần với `Date`). Dump **bỏ cột sinh** (`EXTRA IN ('STORED GENERATED','VIRTUAL GENERATED')`, không `LIKE '%GENERATED%'`) — **đừng thêm cột sinh**. Dọn mồ côi **không bao giờ** xoá `pre-restore`, không xoá gì khi khoá khôi phục bị giữ/không hỏi được. `tests/backup-dump-integration.test.ts`, `backup-orphan-archives`, `init-db-connection-release`.
  - **Scheduler**: `BACKUP_SCHEDULER` `0/false/off/no` mới tắt; kết quả khe ở `backup_scheduler_state` (**không** thêm vào `ALLOWED_SETTING_KEYS`) — **đừng suy từ hàng `backups`**; khoá bận không phải lượt; quyết định theo THỜI GIAN, không đếm tick; sửa lịch/bật lại công tắc không bao giờ chạy bù; đổi lịch thì sửa bảng ở `tests/backup-scheduler-due.test.ts`.
  - **Archive**: ghi `<tên>.partial`, nhận tên thật trong transaction; thư mục chỉ qua `backupsDir()` (`tests/backup-dir-isolation.test.ts`), `CDKT_BACKUPS_DIR` chỉ test/dev; dọn rác chỉ khớp đúng tên `runBackup` sinh — không bao giờ đụng `.upload-*.partial`/tệp của `scripts/backup*.sh`, đừng nới thành `cdkt-*.partial`; tải về `sendStream`, không `readFile` (`tests/backup-access.test.ts`). "Đang khôi phục?" chỉ hỏi qua `refuseIfRestoreInProgress` (không hỏi được → VẪN từ chối); mock một phần dùng `tests/_restore-refusal-stubs.ts`.
- **RAM**: compose mặc định **không giới hạn** (`${APP_MEM_LIMIT:-0}`); không đề xuất CPU; `MEDIA_UPLOAD_ENABLED` chỉ khi RAM ≥ 4000 MB.
- **Log app vào journald**: compose `logging: driver: journald` chỉ `tag` (journald **từ chối** `max-size`/`max-file`); thiếu journald → `ensure_log_driver` (giống **từng chữ** ở `scripts/deploy-remote.sh` và `production/` — test so) ghi override `# cdkt-log-fallback`; override không mang dấu không bao giờ bị sửa. Đừng quay lại một khối `options` chung cho hai driver.
- **CI/Deploy** (`.github/workflows/ci.yml`, `scripts/deploy-remote.sh` → `CI-CD.md`, `production/README.md`): **merge vào `main` là tự build image + deploy production**; chỉ đổi `\.md$|^docs/|^openspec/` từ commit đang chạy → bỏ deploy (mốc so **không phải `github.event.before`** — `tests/ci-docs-only-skip.test.ts`; không dùng `push: paths-ignore`). Typecheck và `npm audit --omit=dev --audit-level=high` là bước **chặn** (không `continue-on-error`; `tests/ops-scripts.test.ts`); kiểm `gh run list` trước khi tin CI xanh; bước tải FFmpeg/Chromium có `timeout-minutes` (`tests/ci-ffmpeg-install.test.ts`); `cancel-in-progress` chỉ cho `pull_request`. Deploy: dump CSDL TRƯỚC compose/`.env`/container (vào `.deploy-db-backups/`, không phải `./backups`; hỏng → dừng), rồi `up -d --no-recreate mysql` + `up -d --no-deps app` — không bao giờ `up -d app` trơn (`tests/deploy-remote-behavior.test.ts`, `tests/ops-scripts-sandbox.test.ts`); smoke hỏng thì đỏ **không tự lùi**; `cdkt-rollback/app` không bao giờ bị gỡ. Biến mới phải liệt kê trong `environment:` của compose (không `env_file`); `APP_VERSION`/`HEALTHCHECK_PING_URL` không vào compose. Dockerfile **không** `chown -R` trên `/app` (`tests/dockerfile-layers.test.ts`). App `TZ=Asia/Ho_Chi_Minh`, mysql UTC. Quyết định đã chốt D2 (không cổng duyệt tay) + D-CI — đừng đề xuất lại.

---

### Quy ước tầng dữ liệu (áp cho mã MỚI, không sửa endpoint cũ)

**Bắt buộc viết trong `server/services/**` khi:** (1) ghi hàng + `activity_logs` (phải 1 transaction), (2) nhiều lệnh ghi phải cùng thành công, (3) ≥2 nơi gọi, (4) quy tắc nghiệp vụ không diễn đạt bằng query. **Truy vấn thẳng đủ khi**: chỉ đọc hoặc ghi 1 hàng không audit và không nơi nào khác cần lại.

**Không tự ép kiểu kết quả truy vấn**: `db.insert()`/`pool.query()` trả **mảng** — destructure; `affectedRows` chỉ qua `readAffectedRows()`/`affectedRowsOrZero()`. Không `as {affectedRows}` / `as unknown as {insertId}`.

**Đường ghi audit — 4 điều đã trả giá:**
1. `tx.insert(activityLogs)` trong khối transaction — không `db.insert` trên pool.
2. Xoá-rồi-log không bọc là sai phổ biến nhất (FK + JSON) — đã kiểm bằng driver thật.
3. Ngoại lệ phải nêu tên trong test: `profile/mfa/confirm.post.ts` (và `recovery-codes`, `auth/logout`, `boost.post.ts`) cố ý không bọc vì `setSessionCookie()` giữa 2 ghi — rollback không thu hồi cookie. `tests/reader-audit-atomicity.test.ts` khoá.
4. `tests/reader-audit-atomicity.test.ts` chặn `AUDITED_MUTATION_ENDPOINTS` + `AUDITED_SERVICES`, quét **cả thư mục** `server/api/admin/**` và `server/services/`, bắt cả `db.insert(activityLogs)` trên pool **sau** khi transaction đã đóng. Audit trên pool có chủ đích → `SERVICE_POOL_AUDIT_EXEMPTIONS` kèm lý do. `meta` ghi dạng object, không `JSON.stringify`.
5. `deleteArticleById`/`setArticleStatus` (`services/articles.ts`) **chủ đích KHÔNG bọc** — guard `known exclusions are named` ở cùng test trên khoá trạng thái này, bọc lại sẽ fail test. Đó là known-exclusion được guard, **không phải gap chưa đóng**.

**TDZ:** `const id = await db.transaction(…)` — không đọc `id` trong chính callback (ReferenceError lúc chạy). Chặn bằng `tests/transaction-tdz.test.ts` + `tests/e2e/admin-write-paths.spec.ts`. **Trong transaction không chạm POOL** (`getDb()`/`getPool()` — pool 10 kết nối, treo cả app): `tests/transaction-pool-read-guard.test.ts`.

**Deadlock & khoá (bài học R6):** sửa tranh chấp **KHÔNG đổi phạm vi/thứ tự khoá** (không thêm `FOR UPDATE`/`FOR SHARE`, không khoá theo danh sách id) — mọi hồi quy của bốn vòng kiểm R6 đến từ đó; đo cả người viết không liên quan. Nạn nhân deadlock → `withDeadlockRetry` (`server/utils/deadlock-retry.ts`: chỉ 1213, ≤ 3 lần, bọc **ngoài** transaction — `tests/deadlock-retry.test.ts`). Mã lỗi MySQL đọc qua `server/utils/mysql-errors.ts` (đi theo `cause`; một định nghĩa — `tests/mysql-error-predicates.test.ts`). Hình dạng câu lệnh chặn/xoá tài khoản ghim ở `tests/reader-moderation-behavior.test.ts`. → `docs/test-coverage-baseline-2026-10.md` § Lát R6.

**Chuyển trạng thái có cạnh tranh** (`submission-workflow.ts`): kiểm + `UPDATE … WHERE id=? AND status=<cũ>` + đếm `affectedRows` **trong** transaction, người thua nhận 409 — không đọc trạng thái ngoài tx rồi update theo id; không hàng nào đổi → không audit (`tests/chatbot-knowledge-audit-atomicity.test.ts`).

**Đầu vào:** query string số qua `finitePositive()`, không `Math.max(1, Number(...))` (`tests/query-number.test.ts`); ô tìm vào LIKE phải thoát `%`/`_` (`likeContains`). Endpoint MỚI đọc thân/query qua `server/utils/request-body.ts` (`readValidated`/`readValidatedQuery`, 400 nêu tên trường, không lộ lỗi zod) — không `readBody` trần, không `.catch(…)` trên ba hàm này, không `readValidatedBody`/`getValidatedQuery` của h3; `tests/request-body-baseline.test.ts`: tệp đã chuyển phải xoá mục ngay, danh sách chỉ giảm.

**`slugify` một bản duy nhất** (`shared/slugify.ts`; `tests/slugify.test.ts` bắt bản chép — bản chép thiếu cắt gạch treo → `-tin-nong-`). Không backfill slug dị dạng. **`validateIdTokenClaims` có test** (`aud` là thứ duy nhất chặn token phát cho app khác; `picture` không lọt vào return).

**Media R2** (`media-sync*.ts`, `media-repoint.ts`): upload → Head → **một tx** (đổi hàng + thay URL ở 27 cột đích + audit) → **rồi mới** xoá local; thay video dọn qua outbox `media_asset_cleanup` (không xoá trước commit); đường ghi/xoá local không đi theo symlink ra ngoài `public/uploads`. Đổi domain: regex không `(?i:…)`, domain mới phải qua `mediaHostProblem` (`shared/media-hosts.ts`); `tests/media-repoint.test.ts`, `tests/media-hosts-policy.test.ts`, `tests/media-repoint-integration.test.ts`. Quét thư mục: trùng khoá R2 → `conflict`; ghi hàng hỏng mà không chứng minh được → GIỮ object; `repairLegacyMediaUrls` không viết cứng `cdn1.delify.vn`, tên mơ hồ → giữ liên kết (`tests/legacy-media-urls.test.ts`).

**Job media và lượt khôi phục không bao giờ ghi cùng lúc** (`services/pre-job-backup.ts`): mỗi phía giữ khoá mình TRƯỚC rồi hỏi khoá kia; tên khoá job chỉ viết ở `MEDIA_JOB_LOCK` (`backup-restore.ts` không được viết tên khoá; `tests/media-job-locks.test.ts`); job gặp khôi phục → `abortJobIfRestoreInProgress` ĐẦU TIÊN trong `catch` → 409 (`tests/restore-media-job-exclusion.test.ts`, `tests/media-jobs-restore-abort.test.ts`).

**Default seed một lần** (`server/db/seed-groups.ts`): dấu `seed.<nhóm>.v<N>.done`; v1 + bảng đã có hàng → CHỈ ghi dấu (thiếu = cán bộ đã xoá). Thêm default = bộ `v2` CHỈ gồm hàng mới (không sửa bộ đã phát hành); mọi biến đổi lúc ghi phải nằm trong `toInsert`. `seed.*` không qua API (`tests/seed-markers-settings-read.test.ts`); định dạng dấu ghim NGUYÊN VĂN (`tests/seed-markers-integration.test.ts`). Lượt chuyển danh mục video khoá theo FK cũ, không bao giờ theo giá trị id (`tests/media-category-migration-integration.test.ts`).

**Đọc công khai hỏng → 503 + `no-store`** (`reportPublicReadFailure()`) — không trả 200 `{ok:false}` rỗng (SWR sẽ cache "danh sách trống"); `server/plugins/error-no-store.ts` ép `no-store` mọi phản hồi ≥ 500. Ngày ở admin/xuất tệp = ngày lịch VN (`vn-day-range.ts`), không theo TZ tiến trình. Analytics giờ UTC qua `utc-query.ts` trên pool chung (không mở pool mỗi lượt). → `docs/decisions/data-layer.md`.

### Xử lý lỗi & gọi API phía giao diện

`catch (err: unknown)` + `errorMessage(err, fallback)` (`app/utils/errorMessage.ts`), không `any`, không trả chuỗi rỗng; lỗi `$fetch` chỉ hiện câu máy chủ soạn — `message`/`statusMessage` do ofetch sinh không bao giờ tới người dùng (`tests/error-message.test.ts`); `errorStatus()` tách 401 khỏi 403.

- **`adminFetch<T>()` / `publicFetch<T>()`** là hai phép ép kiểu `$fetch` được phép duy nhất; **không thêm `$fetch as` mới** (ratchet `fetch-casts`). `T` là khẳng định **không được kiểm** → luôn suy từ handler: `Payload<typeof handler>` (`app/types/handler-payload.ts`), `ItemOf<T>` (`app/types/item-of.ts`) — mỗi kiểu MỘT định nghĩa (`tests/handler-payload-single-definition.test.ts`, `tests/item-of-single-definition.test.ts`). `publicFetch` là `$fetch` trần, không chuyển header (bất biến cache SWR) — trang công khai không dùng `adminFetch`. → `docs/decisions/fetch-rollout-d-fetch.md`.
- **Danh sách admin**: `useAdminList` (`tests/admin-list.test.ts`, `tests/admin-list-pilot-pages.test.ts`) — lượt mới huỷ lượt cũ **và** so mã thế hệ; `load` trả `null` = lỗi; **không** watcher trên filters (mỗi lượt ghi audit); trang chuyển → `ADMIN_LIST_PAGES`. Danh sách không hợp `useAdminList` dùng mã lượt — **chỉ lượt mới nhất được ghi**. Khối lỗi + "Thử lại" + skeleton nằm **trong trang**; cổng phủ nhận "trang có fetch" qua `tests/_admin-fetch-call.ts` — đừng quay về regex chỉ có `$fetch`.

### Tệp lớn đã tách (và 2 tệp cố ý KHÔNG tách)

Chi tiết từng lượt → `docs/decisions/refactor-large-files.md`, CHANGELOG § 41–43, 52, 54, 59.

- **Luật tách phía app (D-SPLIT):** phần tách **chỉ hiển thị** (props vào, emit ra, không tự fetch); luồng ghi vào composable nhận `toast`/`confirm` từ trang; trang/cha giữ state + tải + mọi nhánh lỗi `role="alert"` + "Thử lại" + skeleton; test hành vi mount thật viết **trước**, xanh trên bản gốc; guard đọc cả họ tệp qua `tests/_component-family.ts`. Component trong `components/<thư mục>/` mang tiền tố thư mục — tên trần không phân giải.
- **Module máy chủ đã tách = barrel liệt kê tên** (không `export *`; nơi gọi và `mock.module` trỏ đường cũ; tệp con không nạp barrel — `tests/service-split-boundaries.test.ts`). Phần tách của tệp `server/utils/**` không đặt trong `server/utils` (`tests/server-utils-unique-exports.test.ts`). Họ + helper guard: `backup` (`tests/_backup-service-family.ts`, `tests/backup-service-api.test.ts`), `moderation-worker` (`tests/_moderation-worker-family.ts`; `workerStats` miễn luật "một chủ" đúng 4 tệp), `chat-policy` (`tests/_chat-policy-family.ts`), `ai-gateway` + `callAi` 608 → 186 (tệp phẳng, không thư mục con — `tests/_ai-gateway-family.ts`, `tests/ai-gateway-callai-behavior.test.ts`, `tests/ai-gateway-seams-behavior.test.ts`), `moderation-regex`, `comments`, `media-portal`, `video-processing`, `chunked-upload`.
- **Trang/component** (trước → `wc -l` ở `f3c311a0`): `layouts/admin.vue` 767 → 128 (`tests/admin-layout.test.ts`); `admin/ai/moderation.vue` 1155 → 400 (`tests/_moderation-page-parts.ts`); `media/scan.vue` 908 → 228; `languages/index.vue` 756 → 310 (`tests/admin-languages-page.test.ts`); `content/pages/[id].vue` 795 → 394 (`tests/admin-page-builder.test.ts`, `tests/admin-split-pages-source.test.ts`); `content/articles/[id].vue` 773 → 274; `AiProvidersTab.vue` 1018 → 246; `ArticleDetail.vue` 730 → 354 (`tests/article-detail-page.test.ts`); `ArticleComments.vue` 732 → 327 (`tests/article-comments-thread.test.ts`); `news/index.vue` 724 → 350; `pages/profile.vue` 741 → 391 (`tests/public-split-pages-source.test.ts`); `ChatWidget.vue` 620 → 400 (`tests/chat-widget-behavior.test.ts`; bộ đếm request đang bay chỉ ở `chatbot/send.ts`); `default.vue`, `admin/profile.vue`, `useChatbot.ts`, `init.ts` → bảng số liệu (`tests/_layout-parts.ts`, `tests/admin-{moderation,media-scan,profile}-page.test.ts`). `production/manage.sh` 1793 → 99 + `production/lib/*.sh`: lib **chỉ khai hàm**, thêm lib → `EXPECTED_MANAGE_LIBS` (`tests/_manage-sh-source.ts`).
- **Cố ý KHÔNG tách** (trần có lý do): `AnalyticsLiveDashboard.client.vue` (chỉ tách 2 hàm thuần `analytics-noc.ts`; test chạy script qua `Function()`), `admin/content/articles/index.vue` (`admin-bulk-selection-ui` ghim `selection.*` trong template).

### Hạn chế đã biết

- **i18n**: mọi ngôn ngữ kể cả `vi` fetch DB (`server/api/public/translations/[code].get.ts`); `i18n-default-dictionary.ts` chỉ là fallback; admin giữ hardcoded. Mở rộng thêm trang public là feature work, **không phải nợ kỹ thuật** — không ghi vào audit debt.
- **Typecheck sạch (0 lỗi) và là cổng chặn CI**. Ghim TS ^5 (7.x thiếu `lib/tsc.js`). `globalThis.useRuntimeConfig` cần `server/plugins/runtime-config-global.ts`. `as unknown as` không dùng để đọc hình dạng — khai báo phản chiếu.
- **Test**: kiểm văn bản mã nguồn chứng minh cấu trúc, không chứng minh hành vi (`docs/decisions/test-strategy.md`). Bất biến an ninh có test **chạy thật**: `tests/admin-auth-middleware.test.ts`, `tests/permissions-behavior.test.ts`, `tests/chatbot-honeypot-behavior.test.ts`, `tests/article-write-sanitize-behavior.test.ts`, `tests/user-management-escalation-behavior.test.ts`, `tests/admin-password-change-behavior.test.ts`, `tests/article-id-oracle-behavior.test.ts` (tra bài trong `articleActionScope`: đọc — loại được xem; ghi — được xem **hoặc** được làm thao tác đó), `tests/article-translation-read-scope-behavior.test.ts` (`requireReadableArticle`), `reader-notifications-scope-behavior`, `uploads-route-confinement-behavior`, `public-translation-sanitize-behavior`. Số đo: unit **7787 test, 7733 pass, 0 fail, 54 skip** (`f3c311a0`, `TZ=Asia/Ho_Chi_Minh`, 2026-10-30; skip = integration khi thiếu MySQL); E2E lần cuối 116/116 (`9ee740b`); integration lần cuối 22/22 (`wave2/integration`), chưa chạy lại trên Đợt 3 → CHANGELOG § 61. `globalTimeout` 600 s — thêm lô spec thì nâng; server E2E không bao giờ đụng `./backups`.
- **Lint/Format**: `npm run lint` (0 error, warning cố ý không đỏ CI) + `npm run format`. KHÔNG auto-format toàn codebase — sẽ đè diff lớn, chỉ format file chạm.

### Nợ kỹ thuật đã đóng (đừng báo lại)

Audit 2026-09 ghi 3 nợ, **tất cả đã đóng 2026-10-05** — stale info, đây là trạng thái thật:
1. **`default.vue` 1301 → 401 dòng** ✅ `f125e09` (7 component `layout/Default*.vue` + 5 composable). **Đừng báo "default.vue phình 1200+"**.
2. **`init.ts` 1302 → 73 dòng** ✅ `61fff49` (7 `schema-tables/*.ts`). **Đừng báo "init.ts phình"**.
3. **`any` 20 vết → 0 trong production** ✅ `ca4f52e` (`UnknownError`/`CaughtError`/`Nullable<T>`/`HttpEventLike`); ~145 dòng `any` còn lại ở `tests/` là mock cố ý. **Đừng báo "còn ~20 vết any ở SFC"**.

Hai hạn chế **có chủ đích, không phải nợ** (đừng đề xuất fix diện rộng):
- **i18n** — 30+ file public đã dùng `t()`, tất cả lang kể cả `vi` fetch DB (hardcoded chỉ fallback). Mở rộng thêm trang là feature work.
- **Endpoint cũ gọi `getDb()` thẳng** (số: bảng số liệu) — quy ước CLAUDE.md "áp cho mã MỚI, không sửa endpoint cũ". Refactor diện rộng endpoint đang chạy ổn định rủi ro > lợi. Endpoint mới viết trong `server/services/**`.

Phân biệt khi đề xuất sửa: (a) **gap chưa đóng** → fix, (b) **guarded exception** (test guard chặn) → KHÔNG fix, test sẽ đỏ, (c) **nợ đã đóng** → đừng reopen, (d) **hạn chế có chủ đích** → thiết lập ROI trước khi động.

---

### Kiến trúc Page Builder

- **Registry** `shared/blocks/registry.ts` (app qua `~/utils/blocks/registry`), renderer `app/components/PageRenderer.vue` → `app/components/blocks/*.vue`; kiểu cây `BlockNode`/`BuilderNode` một định nghĩa (`shared/blocks/types.ts`). Hero: giá trị bằng `OLD_HERO_DEFAULTS` (đừng sửa) = chưa cấu hình.
- **DB** `pages` + `page_blocks`; API admin `server/api/admin/pages/**` (resource `pages`), public `pages/[slug].get.ts`. Trang hệ thống `home/about/contact`: `isSystem=true` (khóa slug, không xóa).
- **Mặc định cần nhớ**: RBAC `readers`/`comments` mặc định không cấp; `comments_enabled` mặc định TẮT; upload magic-byte (2 allowlist phải khớp — `.ico` nhận, `.svg` không); `public/favicon.ico` phải vắng. Danh mục tính năng → `docs/CHANGELOG.md`.

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

Docker thiếu bí mật → dừng (chủ đích). Build: `npm run db:init && npm run db:seed` · `npm test && npm run db:drift` · `npm run build`; container: `docker compose up --build -d`.

### 2. `production/` — toolkit quản trị VPS (aaPanel)

**Đây là cách deploy chính trên production** (CI build image + push GHCR rồi **tự SSH deploy**; `manage.sh` cho deploy lần đầu, đổi `.env`/port/domain, import SQL, hoặc khi CI deploy hỏng).

```
production/
├─ manage.sh           # cửa vào (menu / tham số) — nạp lib/ bên cạnh; đừng chép riêng manage.sh
├─ lib/                # mã của manage.sh (*.sh ≤ 400 dòng) — phải nằm cạnh manage.sh; đừng chmod +x
├─ README.md           # hướng dẫn luồng đầy đủ (nguồn duy nhất)
└─ migrations/          # .sql INSERT-only, script hỏi import (.imported-* = đã import)
```

`cd /www/wwwroot/conduonghuongthien/production && ./manage.sh` (1=Deploy · 2=Update · 3=Migrate). Update dùng `up -d --no-recreate mysql` + `up -d --no-deps app`, không `up -d` trơn. Trên VPS `.env` do `manage.sh` sinh (mode 600), đừng gõ tay.

### 3. Bảo trì định kỳ (cron — nay tuỳ chọn)

Dọn retention và gộp analytics tự chạy trong tiến trình ở production; giữ cron song song an toàn (khoá `cdkt:data:retention` / `cdkt:analytics:maintenance`):

```bash
0 3 * * * cd /duong/dan/CDKT && npm run analytics:maintenance >> /var/log/cdkt-analytics.log 2>&1
```

`ANALYTICS_SCHEDULER`/`RETENTION_SCHEDULER`/`BACKUP_SCHEDULER` mặc định bật ở prod, tắt ở dev. So ngày theo **giờ địa phương** (UTC+7), CI chạy `TZ=Asia/Ho_Chi_Minh` — UTC so sai bỏ lượt mỗi đêm.

---

## 🛡️ Tài Khoản Mặc Định

- **URL**: `http://localhost:3000/admin` · **Tài khoản**: `admin` · **Mật khẩu**: `ADMIN_PASSWORD` lúc seed (không còn default, trống → exit 1). Đổi mật khẩu ngay sau lần đầu.

---

## 🗣️ Quy Tắc Giao Tiếp & Làm Việc

- **Xưng hô**: Always address the user as **"anh yêu"** in every reply.
- **Ngôn ngữ**: Always **think/reason in English**, but always **reply to the user in Vietnamese**.
- **Truy xuất dữ liệu**: Always use the **MCP context-engine (`codebase-retrieval`)** to retrieve codebase data. Do **NOT** use gitnexus or grep for codebase exploration and search.
