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

- **Frontend**: Nuxt 4 (Vue 3 SFC, TS, Composition API), **Tailwind CSS v3** (`@nuxtjs/tailwindcss`), FontAwesome 6 Pro (self-hosted), **`@nuxt/image` 2.1** (IPX provider tái dùng `sharp` đã có — `<NuxtImg>` sinh WebP + responsive srcset; **chỉ áp cho ảnh public-side chưa qua sharp** — ảnh rich-text TinyMCE + ảnh đã qua `media/upload` sharp+R2 giữ `<img>` thường). **Tất cả code mới dùng Tailwind utility** — không `<style scoped>` trừ `::before`/keyframes/`:deep()` rich-text. CSS cũ giữ nguyên.
- **Backend**: Nitro/H3, Drizzle ORM, MySQL 8.0/MariaDB, JWT (`cdkt_admin` HTTP-only Cookie).
- **DB — 62 bảng**: nguồn chân lý `server/db/schema.ts`; DDL khởi động `server/db/init.ts` (73 dòng, chỉ giữ thứ tự gọi — 7 file `schema-tables/*.ts` theo domain: `core`/`content`/`governance`/`chatbot`/`analytics`/`readers-media`/`ai-i18n`) + `server/db/migrations-additive.ts` (ensureColumn/ensureIndex/FK cho DB đã có dữ liệu). `init.ts` re-export `migrations-additive` để 4 suite test không đổi import path. `seed.ts` insert-only. → chi tiết `docs/decisions/data-layer.md`.
- **Test**: `npm test` (Node runner, `scripts/ts-resolver.mjs`, không cài thêm). Node `^22.19.0 || ^24.11.0 || >=26.0.0`. Mười bốn suite `*-integration` nối MySQL thật (chạy trong CI). E2E: `npm run test:e2e` (cần build + MySQL, `E2E_DB_PORT=33069` cho dev docker).
- **Schema tooling**: `npm run db:drift` so `schema.ts` ↔ `init.ts + schema-tables/*.ts + migrations-additive.ts` (tên + kiểu + NULL, 635 cột/62 bảng). `npm run db:generate` sinh diff SQL. `migrations/*.sql` là snapshot mysqldump — có guard chặn chạy nhầm.
- **Webfont & Icon**: Inter tự chủ (`public/assets/fonts/`, `nuxt.config.ts` tự phát hiện, không còn `fonts.googleapis.com` trong `.output/`). FontAwesome chỉ `solid` + `regular` (`ICON_FAMILIES` trong `nuxt.config.ts`).
- **Hiệu năng trang công khai** — 3 thứ đi cùng nhau: `routeRules` `swr: 60` (SWR 60s) cho `/`, `/about`, `/contact`, `/media`, `/qa-documents` + 4 nhánh list (`/news`/`/role-models`/`/reintegration-models`/`/documents`/`/legal-qa`) + `/api/public/social-links` (`/admin/**` và `/api/**` còn lại `cache:false` tường minh), `lazy:true` ở ~30 fetch công khai, `<NuxtLoadingIndicator>` ở `default.vue`.
- **Skeleton** (`app/components/skeleton/*.vue`, `tests/skeleton-loading-ui.test.ts`): `SkeletonTable`/`SkeletonCards`/`SkeletonForm` dùng chung; inline chỉ khi hình dạng duy nhất. `motion-reduce:animate-none` kèm mọi `animate-pulse` (4 nhịp trạng thái được miễn, ghi trong test). Container `role="status"` + `aria-busy="true"` + `sr-only`; ô xám `aria-hidden="true"`; nhánh lỗi mang `role="alert"` + nút thử lại gọi hàm cùng file (không `location.reload()`). Lớp cột viết thẳng chữ, không nội suy `grid-cols-${n}`. Tải/lỗi/rỗng là một hợp đồng (mẫu `NewsCategoryList.vue:14-34`, `tests/admin-error-retry-ui.test.ts` chặn 50 trang có error/retry + 5 trang miễn nêu lý do).
- **Ba biên tin cậy** đã tách khỏi component (`chatbot-storage.ts` / `nav-config.ts` / `analytics-noc.ts` — ranh giới "kiểm được không cần mount"). `nav-config.ts`: allowlist `openNewTab` — thêm field phải sửa `NavItem` + `normalizeNavItem` + test, `=== true` không `Boolean()`. → `docs/decisions/data-layer.md` + `reader-features.md`.
- **Media**: Local `/public/uploads/YYYY/MM/` + R2 (S3 SDK + Sharp). **Container**: Docker Compose, `APP_BIND` mặc định `127.0.0.1`.
- **TinyMCE admin editor**: 2 đường init — component `app/components/admin/TinyMceEditor.vue` (PageBuilder + bản dịch, default height 480) và inline `tinymce.init` trong `[id].vue` (bài viết, height 700). Editor **full section width** — KHÔNG giới hạn `max-w`, để soạn thoải mái. `content_style` có `img/iframe/video { max-width:100% }` để preview khớp render công khai. Giới hạn chiều ngang chỉ áp ở **render công khai** (`ArticleDetail.vue` + `app/components/blocks/RichTextBlock.vue`: `.article-body :deep(img), :deep(video) { max-width:100%; height:auto }`) — không áp admin editor. `animate-fadeIn` không tồn tại trong tailwind config — dùng `animate-fade-slide-up`.

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
│   ├── useI18n.ts (567 keys trong seed, 405 fallback hardcoded vi; mọi lang kể cả vi fetch DB) / useReaderAuth.ts
│   ├── useReaderNotifications.ts / useReadingHistory.ts (localStorage only) / useToast.ts
│   └── useAnalyticsNocTable.ts
├── layouts/default.vue (1301→385, tách 7 component layout/ + 5 composable + skip-link a11y) / admin.vue
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
- **Phân quyền**: mọi handler qua `requireResourcePermission(event,…)`. **Một ngoại lệ nêu tên**: `articles/[id].put.ts` gọi `checkPermission()` lần 2 khi đổi thể loại. 202 tệp dùng helper.
- **MFA & `/admin/profile`** (`server/utils/mfa/factors.ts`): 3 yếu tố độc lập `totp`/`email_otp`/`second_password` (pending→active), mã dự phòng bcrypt dùng 1 lần. Vé MFA `cdkt_mfa` 5 phút tách vé session `cdkt_admin`; chặn bằng claim `stage`. **Runbook xoay `JWT_SECRET`**: HKDF `cdkt-mfa-totp:v1` → TOTP vô hiệu, lùi về yếu tố khác/mã dự phòng, log `mfa.totp_secret_unreadable`. Xoay cũng đăng xuất toàn bộ reader (HKDF `cdkt-reader-session:v1`, vô hại). `CHATBOT_ENCRYPTION_SECRET` bảo vệ cả API key AI (`v1`) lẫn Google OAuth secret (`cdkt-google-oauth-secret:v1`). → `docs/decisions/realm-safety.md`.
- **Rate limit** (`server/utils/rate-limit-store.ts`, `rate-limit-deps.ts`): bảng `rate_limit_counters`, mất DB lùi về memory — không mở toang. Login bước 2 giới hạn theo tài khoản (10/15 phút). Lấy deps qua `rateLimitDeps()`, không viết tay `{execute: pool ? … : null}` (19 file đã dùng helper). → `tests/shared-helpers.test.ts`.
- **Luồng SSE của AI đọc ở MỘT nơi** (`server/services/ai-sse.ts` `readChatSse`, làm sạch "suy nghĩ" ở `ai-text-cleaner.ts`): `callAi` từng chép vòng lặp này 4 lần và mỗi lần sửa một bản lại quên bản khác (lỗi "0 kết quả", rồi câu trả lời bị lặp đôi khi model trả lời thẳng). Sửa luồng stream thì sửa ở đó. `tests/ai-gateway-streaming-paths.test.ts` chạy `callAi` thật với `fetch` giả.
- **Không ghép dữ liệu người dùng vào SQL** (`sql.raw`, `pool.query` nối chuỗi): chỉ tham số hoá. Chuỗi do **model** truyền vào công cụ chatbot cũng là dữ liệu người dùng (prompt injection) — lỗ hổng SQLi `search_c11_articles` đã đóng bằng `server/utils/chatbot/article-search.ts`. Hằng số số nguyên bắt buộc dùng `intervalDays()` (`server/utils/sql-literals.ts`). `tests/security-chatbot-article-search.test.ts` biên dịch truy vấn sang SQL MySQL và chặn `sql.raw` trong `chat-policy.ts`.
- **HTML hiển thị bằng `v-html` phải qua `sanitizeHtml` lúc ghi *và* lúc đọc** — kể cả bản dịch. Mọi nơi ghi `article_translations.content` đi qua `sanitizeHtml`/`sanitizeTranslationFields`; `sanitizeBlockData` đi vào `data.translations[lang]`; hai endpoint công khai (`articles/[slug]`, `pages/[slug]`) lọc lại để xử lý dữ liệu cũ. `tests/security-translation-html.test.ts` quét và chặn nơi ghi bỏ sót. Hàng đã lưu trước bản vá: `npm run db:sanitize-html` (xem trước) / `-- --apply` (ghi) — `server/services/stored-html-sanitize.ts`, chạy lại được, sao lưu DB trước.
- **Hạn mức AI** (`enforceAiQuota`, `chat-policy.ts`): 20 lượt/giờ theo phiên **và** trần 100 lượt/giờ theo IP (`AI_IP_CEILING_RULE`). Token phiên (`/api/public/chatbot/session`) cấp không giới hạn và không tốn gì — hạn mức tính trên token một mình sẽ bị reset bằng cách xin token mới. `tests/chatbot-ai-quota-ceiling.test.ts`.
- **Client IP sau proxy** (`server/utils/client-ip.ts`, `TRUSTED_PROXY_IPS` + `NUXT_TRUSTED_PROXY_IPS`): mọi handler dùng `getClientIp(event)`, không `getRequestIP` trực tiếp (có test chặn). Chỉ đọc `x-forwarded-*` khi peer là proxy đã khai; duyệt phải→trái. Mặc định chỉ tin loopback; hỗ trợ CIDR IPv4, IPv6 từ chối. `resolveClientIp` thuần, có `spoofAttempt`.
- **App bind loopback** (`docker-compose.yml`, `APP_BIND=127.0.0.1`): nginx proxy về loopback; `0.0.0.0` chỉ khi không có proxy.
- **Lượt xem bài viết** (`server/services/article-views.ts`): `real_views` vs `fabricated_views` + `source_category='boost'` (không trong allowlist công khai). Đếm từ browser sau mount (`ArticleDetail.vue`), nuốt lỗi. Chống F5 30 phút qua `rate_limit_counters` (`deriveDailyVisitorToken`, `getClientIp`). Endpoint luôn `202`. Boost `instant`/`gradual` (tick 60s, lock `cdkt:articles:view-boost`, `computeBoostDue` theo thời gian tuyệt đối), audit `boost` trong cùng transaction, `started_at/ends_at` chỉ qua Drizzle (không `pool.query` trần — lệch 7h). Modal tách 3 ô, nguồn truy cập loại `boost`. Không backfill, không scope retention. → `docs/decisions/data-layer.md`.
- **Data retention** (`server/services/data-retention.ts`, `/admin/settings/data-retention`): 4 scopes `activity_logs`/`submissions`/`chat_sessions`/`reader_accounts` (`RETENTION_SCOPES`/`SCOPE_SETTINGS` là `Record` do compiler kiểm). Mỗi bảng già theo cột riêng (`TABLE_COLUMNS`): `created_at` vs `last_seen_at` vs `last_message_at`; `chat_messages`/`article_comments`/`reader_notifications`/`submission_events` **không phải scope** (cascade). Hai điều kiện độc lập (tuổi + cap), tuổi trước, cap đo 1 lần. `data_retention_state` cộng dồn trước khi xoá. Scheduler trong tiến trình (tick 15p, `isRunDue` thuần, `RETENTION_SCHEDULER=1|0`, hoãn 60s, `unref`), khoá `cdkt:data:retention` (timeout 0). 3 đường vào: scheduler / cron `{ignoreSchedule:true}` / manual `{force:true}` (409 nếu khoá). Thứ tự ưu tiên DB→env→default, mỗi ô khai nguồn; `retention_*` không trong `ALLOWED_SETTING_KEYS`; `saveRetentionPolicy` kiểm hết trước khi ghi. → `docs/decisions/data-layer.md`.
- **Activity toàn hệ thống** (`/admin/users/activity`, quyền `users.read`): tự ghi `read activity_logs` kèm filter; `leftJoin` giữ log của user đã xoá; endpoint `retention.get.ts` chỉ đọc, không gọi dọn.
- **Log** (`server/utils/logger.ts`): 1 dòng JSON, tự che bí mật; `SECURITY_EVENTS` cho cảnh báo.
- **Sao lưu** (`scripts/backup-db.sh`): dump→verify→xoay vòng; bản hỏng bị xoá.
- **RAM** (`npm run check:resources`): `MYSQL_MEM_LIMIT`/`APP_MEM_LIMIT` mặc định `1g/1g`; không đề xuất CPU.
- **CI** (`.github/workflows/ci.yml`): push chỉ trên `main` (không `["**"]`), typecheck là bước **chặn** trong job `unit-tests` (không `continue-on-error`, `exit $status`; `tests/ops-scripts.test.ts` canh cả hai). **Job `deploy` đang BẬT (`if: true`): merge vào `main` là tự build image + SSH lên VPS ngay** — bản vá/tính năng đã lên production khi CI xanh. Đọc job cancelled: `runner:""` + `steps_run:0` = chưa cấp máy.

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
4. `tests/reader-audit-atomicity.test.ts` chặn 17 admin endpoint (danh sách `AUDITED_MUTATION_ENDPOINTS`) + 7 service (`AUDITED_SERVICES`); guard quét **cả thư mục** `server/api/admin/**` và `server/services/` (không liệt kê đường dẫn). `deleteMediaById` chỉ bọc 2 ghi DB, không bọc xoá tệp.
5. `deleteArticleById`/`setArticleStatus` (`services/articles.ts`) **chủ đích KHÔNG bọc** — guard `known exclusions are named` ở cùng test trên khoá trạng thái này, bọc lại sẽ fail test. Đó là known-exclusion được guard, **không phải gap chưa đóng**.

**TDZ:** `const id = await db.transaction(…)` — không đọc `id` trong chính callback (ReferenceError lúc chạy). Đã trả giá 4 endpoint 500. Chặn bằng `tests/transaction-tdz.test.ts` + `tests/e2e/admin-write-paths.spec.ts`.

**Query string số:** qua `finitePositive()` (`server/utils/query-number.ts`), không `Math.max(1, Number(...))` (NaN→null, Infinity→500). → `tests/query-number.test.ts`.

**`slugify` một bản duy nhất** (bản chép thiếu cắt gạch treo → `-tin-nong-`). Không backfill slug dị dạng. → `docs/decisions/data-layer.md`.

**`validateIdTokenClaims` có test** (`aud` là thứ duy nhất chặn token phát cho app khác; `picture` không lọt vào return). → `docs/decisions/data-layer.md`.

Chi tiết & kiểm chứng âm tính → `docs/decisions/data-layer.md`.

### Xử lý lỗi tầng giao diện

`catch (err: unknown)` + `errorMessage(err, fallback)` (`app/utils/errorMessage.ts`), không `any`. Không trả chuỗi rỗng. `errorStatus()` tách riêng (401 mời đăng nhập lại vs 403 đang đăng nhập). Server 9 khối xử lý tại chỗ.

### Tệp lớn đã tách (và 1 tệp cố ý KHÔNG tách)

- `server/db/init.ts` (1302 → 73 dòng): 7 file `schema-tables/*.ts` theo domain giữ 62 `CREATE TABLE`; `init.ts` chỉ còn thứ tự gọi (ràng buộc FK thật). `init.ts` re-export `migrations-additive` cho 4 suite test không đổi import path. `db:drift` đọc cả 9 tệp như một nguồn DDL duy nhất (635 cột/62 bảng).
- `app/layouts/default.vue` (1301 → 385): tách 7 component `app/components/layout/Default*.vue` + 5 composable (`useLayoutNav`/`useSiteSettings`/`useLiveSearch`/`useReaderMenu`/`useMobileMenu`) + skip-link a11y + `id="main-content"`. 10 test guard đọc source text được viết lại cross-file (`tests/_layout-parts.ts` ghép 8 file). Khắc phục hydration crash từ việc tách. Caveat cũ "1282 dòng hồi quy" đã đóng.
- `app/composables/useChatbot.ts` (939→740) → `useChatbotTypewriter.ts`.
- `app/pages/admin/profile.vue` (1076→875) → `ProfileActivityHistory.vue`.
- `AnalyticsLiveDashboard.client.vue` cố ý chỉ tách 2 hàm thuần (`analytics-noc.ts` — `safeDetails` là bộ lọc PII). NOC template giữ nguyên (22 định danh cha).

### Hạn chế đã biết

> Chi tiết → `docs/decisions/README.md`.

- **i18n**: 567 keys trong `default-translations-seed.ts` (405 fallback hardcoded trong `useI18n.ts`), **tất cả ngôn ngữ kể cả `vi` đều fetch DB** (`server/api/public/translations/[code].get.ts`); `hardcodedDictionary` chỉ còn fallback khi DB chưa seed / API hỏng / SSR chưa fetch xong. 50 file public đã dùng `t()` (media/index, news/[id], ArticleComments, blocks 5 file, default.vue, ChatWidget, assistant, profile…). Admin `/admin/languages` sửa mọi lang kể cả `vi` → frontend hiển thị đúng. Admin giữ hardcoded (không i18n). Mở rộng thêm trang public là feature work, **không phải nợ kỹ thuật** — không ghi vào audit debt.
- **`any` đã xoá sạch trong production** — 0 vết trong `.vue` SFC (trước đây 17), 0 trong `app/`/`server/`/`scripts/` code (comment `errorMessage.ts` không tính). **154 vết `any` còn lại trong `tests/`** (22 file) là mock/stub cố ý — test runner không biên dịch type, `any` ở đó không rò rỉ ra production. Đừng báo "còn ~20 vết any ở SFC" — đã đóng commit `ca4f52e` 2026-10. `as unknown as` không dùng để đọc hình dạng — khai báo phản chiếu.
- **Typecheck sạch (0 lỗi) và là cổng chặn CI** — một lỗi kiểu làm đỏ job `unit-tests`, không còn lọt vào `main`. Ghim TS ^5 (7.x thiếu `lib/tsc.js`). `globalThis.useRuntimeConfig` cần `server/plugins/runtime-config-global.ts`.
- **Test**: 14 suite `*-integration` + E2E (`E2E_DB_PORT` etc.), MFA spec dọn ở `afterEach`, LLM guard là lớp duy nhất bắt TDZ/insertId/DATETIME. Kiểm văn bản mã nguồn chứng minh cấu trúc, không chứng minh hành vi. Tổng 2438 test, 0 fail khi CI sạch (14 skip = 14 integration cần MySQL).
- **Lint/Format**: `npm run lint` (ESLint v9 flat config, 0 error / 250 warning (phần lớn: `any` trong `tests/` và biến không dùng) — cố ý warn không đỏ CI) + `npm run format` (Prettier). KHÔNG auto-format toàn codebase — sẽ đè diff lớn, chỉ format file chạm. Không sink vào `build`/`test` (test runner Node thuần không cài thêm).

### Nợ kỹ thuật đã đóng (đừng báo lại)

Audit 2026-09 ghi 3 nợ, **tất cả đã đóng 2026-10-05**. Agent sau rà codebase có thể thấy stale info — đây là trạng thái thật:

1. **`default.vue` 1301 → 382 dòng** ✅ `f125e09`. Tách 7 component `app/components/layout/Default*.vue` + 5 composable. Caveat "1282 dòng hồi quy" đã đóng. **Đừng báo "default.vue phình 1200+"** — đã tách xong.
2. **`init.ts` 1302 → 73 dòng** ✅ `61fff49`. Tách 7 file `server/db/schema-tables/*.ts` theo domain. `db:drift` xanh 635 cột/62 bảng (trước 624/61). **Đừng báo "init.ts phình"** — đã tách xong.
3. **`any` 20 vết → 0 trong production** ✅ `ca4f52e`. 4 kiểu dùng chung `UnknownError`/`CaughtError`/`Nullable<T>`/`HttpEventLike`. **Đừng báo "còn ~20 vết any ở SFC"** — SFC sạch, 154 vết còn lại ở `tests/` là mock cố ý.

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

- **Public**: Top Bar/Header, Dynamic Home Blocks, Chatbot widget, FontAwesome 6.
- **Admin**: RBAC (`readers`/`comments` mặc định không cấp), Users, Page Builder toàn site, Home Editor (legacy), Media (Sharp + R2), Toast, Session persistence.
- **Chatbot**: 2 chế độ (kho-only / AI), 2 kho (nghiệp vụ `chatbot_knowledge` + thường nhật `chatbot_small_talk` 121 mục), matcher thuần 3 tầng, Excel import, quick-question, `qa-documents` (`/qa-documents`), typewriter client-only, honeypot `_h`, rate limit theo bảng, phiên SQL, AI editorial (`/admin/content/articles/[id]`), context đa lượt. → `docs/decisions/chatbot.md`.
- **Reader**: Google OAuth (2 rào `stage:reader` + HKDF `cdkt-reader-session:v1`, redirect suy từ request, `sub` là khóa, avatar tại chỗ, bình luận văn bản thuần 1 cấp, `comments_enabled` mặc định TẮT, 401/403 handling, chặn IP 2 điểm, audit transaction). `/profile` (custom_display_name, localStorage `cdkt_reader_history_v1`, claim-chats HMAC). Thông báo (`reader_notifications`, `.client` chuông, email sau commit, redirect 301 `/nguoi-doc→/profile` etc.). Vòng đời đơn (`submission_status` 5 trạng thái, `submission_events`, 4 lớp lỗi email). → `docs/CHANGELOG.md` + `docs/decisions/reader-features.md`.
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

- **Deploy (1)**: 6 bước — chọn nguồn SQL (existing DB/docker fresh) → sinh DB password + 3 bí mật app tự động → đặt `PUBLIC_BASE_URL` → tạo `.env` ở root repo → build + khởi động container `cdkt_app` + `cdkt_mysql`.
- **Update (2)**: hiển thị trạng thái cũ → `git pull origin main` → sửa port/domain nếu cần → `docker compose pull && up -d` → đợi healthcheck → hỏi migrate nếu có file SQL mới.
- **Migrate (3)**: quét `production/migrations/*.sql`, hiển thị `đã import`/`chưa`, cảnh báo file có `DROP TABLE`, import qua `docker exec -i cdkt_mysql mysql … < file.sql`, đếm bài viết trước/sau.

**Lưu ý**: README nói `.env.template` nhưng file thực không tồn tại — mẫu `.env` thật ở root repo (`.env.example`). Trên VPS, `.env` do `manage.sh` sinh ra, đừng gõ tay.

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
