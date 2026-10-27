# Chiến lược test — khi nào được kiểm văn bản mã nguồn

Wave 3 · 7.2 (`openspec/changes/wave3-long-term`, D-TESTS). Bản kiểm kê mọi test đọc văn bản mã nguồn, quy tắc khi nào cách kiểm đó đúng, danh sách chuyển sang test hành vi theo thứ tự ưu tiên, và ba lượt chuyển đầu tiên (an ninh).

> Người tiếp nhận muốn **hiểu tại sao**, không phải để tra cứu khi sửa mã. Khi sửa mã, đọc `CLAUDE.md`. Bảng dưới đây **sinh bằng script**, không sửa tay: sửa lớp ở `scripts/test-inventory-review.ts` rồi sinh lại.

---

## Tóm tắt

- **145 tệp test** khẳng định trên văn bản mã nguồn dưới `app/`, `server/`, `scripts/`, `shared/`: **796 khối** `it`/`test` phụ thuộc văn bản đó, trên tổng 2024 khối của chính các tệp này.
- Theo lớp đã duyệt: **hành vi (ứng viên chuyển)** 36 tệp / 214 khối, **cấu trúc** 108 tệp / 574 khối, **giòn** 1 tệp / 8 khối (khối giòn còn lại nằm rải trong các tệp lớp khác).
- Lượt tự động bị sửa tay ở 32 tệp và 156 khối. Mọi dòng đã được duyệt (`tệp chưa duyệt: 0`).
- Ngoài bảng:
  - 2 tệp đọc mã nguồn chỉ để chạy nó (`deploy-remote-behavior`, `security-block-link-schemes`);
  - 10 tệp chỉ đọc CI, compose, `nuxt.config.ts` hoặc `production/`;
  - 3 tệp có lời gọi đọc không suy được đường dẫn. Đã kiểm tay: đều là dump, tệp tải lên hay sandbox.
- **Ba bất biến an ninh đã chuyển sang test hành vi**. Mỗi test đỏ trên một bản cài đặt cố ý làm hỏng, và 7 khẳng định văn bản mà chúng thay trọn đã bị xoá:
  - phạm vi thông báo của bạn đọc (IDOR);
  - `/uploads/**` không thoát khỏi thư mục gốc và không vẽ SVG;
  - lọc HTML lúc đọc ở hai endpoint công khai.

## Khi nào kiểm văn bản là đúng — cấu trúc

`CLAUDE.md` nói thẳng: "Kiểm văn bản mã nguồn chứng minh cấu trúc, không chứng minh hành vi." Có những câu hỏi mà chỉ đọc mã mới trả lời được:

- **Kiểm kê qua nhiều tệp.** "Mọi handler admin kiểm quyền" (`admin-handler-authorization`), "không nơi nào khác ghi `article_translations.content`", "mọi `v-html` có tên trong danh sách". Chạy từng handler không chứng minh được rằng không có handler thứ 333 quên kiểm. Phải quét cây mã. Guard loại này phải tự kiểm tập quét không rỗng và không thu hẹp âm thầm. `service-split-boundaries` và `admin-error-retry-ui` làm đúng việc đó.
- **Ratchet và trần kích thước.** Số chỉ được giảm (`request-body-baseline`, `query-number`), tệp không vượt ~400 dòng.
- **Ranh giới import và luật AST.** `server/` không nạp `app/`, tệp con không nạp barrel của chính nhóm mình, TDZ trong transaction, ghi audit trên handle của transaction (`reader-audit-atomicity` — guard được `CLAUDE.md` gọi tên).
- **Hình dạng CI, deploy, compose** khi không chạy được ở máy test. Có sandbox thì ưu tiên sandbox: `deploy-remote-behavior` và `ops-scripts-sandbox` chạy script thật.
- **Hợp đồng template giao diện** (a11y, nhánh tải/lỗi/rỗng) khi chưa có DOM. Ưu tiên `tests/_render-sfc-template.ts` (dựng HTML thật). Những khối đã dựng thật không bị tính là đọc văn bản.

## Khi nào không — khẳng định về hành vi

Một câu khẳng định là **lời hứa về hành vi** khi nó nói điều gì xảy ra lúc chạy. Ví dụ: "id của người khác không đổi được gì", "không đường dẫn nào ra ngoài gốc", "bản dịch đã lưu được lọc khi phát ra". Kiểm lời hứa đó bằng cách tìm một chuỗi trong mã sai theo cả hai chiều:

- **Đỏ oan.** Gỡ phần `replace(/\.\./g, '')` khỏi route `/uploads/**` thì khẳng định văn bản cũ đỏ. Nhưng hành vi vẫn đúng: phép kiểm `startsWith(uploadsRoot + path.sep)` đã đủ chặn. Test hành vi mới vẫn xanh với chính lượt hỏng đó (lượt B dưới đây). Khẳng định cũ ghim một chi tiết dư thừa.
- **Xanh sai.** Khẳng định cũ cho endpoint đánh dấu đã đọc dò `/(query|body|payload)\s*[.[]\s*['"]?readerId/`. Lấy `readerId` bằng destructuring (`const { readerId = reader.id } = payload`) thì regex không bắt được (đã chạy: `false`). Lỗ IDOR lọt qua trong khi test xanh. Test hành vi mới đỏ ngay, vì nó kiểm kết quả: hàng của người khác vẫn chưa đọc.

Quy tắc:

- **Lời hứa về hành vi phải chạy mã.** Chạy handler hay service thật, với harness sẵn có: global Nitro giả + `mock.module` + DB giả (`tests/permissions-behavior.test.ts`), hoặc mệnh đề WHERE thật biên dịch bằng dialect MySQL rồi chạy trên `node:sqlite` (`tests/article-id-oracle-behavior.test.ts`).
- **Văn bản mã chỉ dùng cho cấu trúc.** Tiêu đề test phải nói nó chứng minh cấu trúc gì.

## Quy tắc xoá

- **Khẳng định giòn** (ghim câu chữ, hằng số, chú thích không mang bất biến) **chỉ được xoá khi một test hành vi thay thế vào cùng PR.** Xoá trơn thì mất luôn chút tín hiệu nó còn mang.
- **Khẳng định văn bản của một ứng viên hành vi** chỉ được xoá trong cùng PR với test hành vi thay **trọn** nó. Kèm bằng chứng đỏ-trước: test mới đỏ trên một bản cài đặt cố ý làm hỏng, rồi bản cài đặt được trả lại đúng từng byte (`git diff --exit-code`).
- **Khẳng định trùng với test chạy thật đã có** (`mfa-codes-endpoints` ↔ `mfa-*-behavior` và `admin-password-change-behavior`; `reader-session-boundary` ↔ `admin-auth-middleware`) không cần test mới. Đối chiếu từng khối, xoá ở PR riêng, và ghi tên khối đã xoá cùng test đang giữ nó.

## Công cụ kiểm kê

```bash
node --experimental-strip-types scripts/test-inventory.ts             # JSON ra stdout
node --experimental-strip-types scripts/test-inventory.ts --markdown  # bảng ở cuối tệp này
```

**Tệp:**

| Tệp | Vai trò |
|---|---|
| `scripts/test-inventory.ts` | CLI, lượt phân lớp tự động, áp bản duyệt, JSON/Markdown |
| `scripts/test-inventory-analyze.ts` | Reader, lời gọi đọc nguồn, nhiễm, khối |
| `scripts/test-inventory-bindings.ts` | Tên nhập từ `fs`/`child_process`/helper, bộ suy đường dẫn |
| `scripts/test-inventory-paths.ts` | Chuẩn hoá, tách nguồn/tệp khác, sandbox |
| `scripts/test-inventory-review.ts` | Lớp đã duyệt tay |

Mỗi tệp dưới 400 dòng. Không thêm dependency (dùng `typescript` đã có).

**Phát hiện gì:**

- Đọc tệp trực tiếp: `readFileSync`, `readFile` (cả `fs.`/`fs/promises`, `import('node:fs')` động, `.then(fs => …)`), `readdirSync`/`readdir`, `git show` qua `child_process`.
- Đọc qua hàm cục bộ có tham số chảy vào một lời gọi đọc (reader).
- Đọc qua helper `tests/_*.ts`: `_render-sfc-template`, `_layout-parts`, `_comments-service-source`, `_backup-service-family`, `_service-split-*`, `_seed-source`, `_admin-authz-classifier`.

**Suy đường dẫn.** Đường dẫn được suy tĩnh qua `new URL`, `path.join`, template, hằng và biến lặp.

- Đường dẫn dựng trên `mkdtemp`/`tmpdir` (kể cả qua `makeSandbox()`) là tệp tạm, không phải mã nguồn.
- Đọc ngoài bốn gốc chỉ ghi vào `otherReads`.

**Một khối phụ thuộc văn bản nguồn khi** thân nó dùng lời gọi đọc nguồn hoặc một symbol đã nhiễm. Nhiễm đi theo symbol của checker, không theo tên. Không tính là phụ thuộc:

- đối số dữ liệu của lời gọi ghi tệp (chép script vào sandbox);
- chuỗi `createHash(…)` (checksum);
- dựng/chạy mã đã đọc (`renderSfcTemplate`, `vm`, `new Function`, tiến trình nhận script). Những khối này đếm riêng là "chạy".

**Lượt tự động** áp các luật theo thứ tự. Luật đầu tiên khớp quyết định lớp:

1. Nhập `typescript` / helper AST → cấu trúc.
2. Đếm dòng → cấu trúc.
3. Tên tệp kiểu `-ui`, `layout`, `boundar`, `ci-`… → cấu trúc.
4. Quét thư mục + tiêu đề "every / no other / mọi" → cấu trúc.
5. Khẳng định chứa chú thích (`// `, `/*`, `<!--`) → giòn.
6. Từ khoá an ninh/dữ liệu ở tên tệp hay tiêu đề → hành vi.
7. Còn lại → cấu trúc.

Một tệp có khối hành vi thì lớp tệp là hành vi.

**Bản duyệt tay** đặt lớp cho cả tệp, sửa riêng từng khối theo tiêu đề, hoặc đánh dấu `executed`. Script in `staleReview` khi một mục duyệt (tệp hay tiêu đề khối) không còn khớp gì, và `CHƯA DUYỆT` cho tệp mới chưa có dòng.

**Giới hạn đã biết:**

- **Nhiễm thô.** Một biến nhiễm chỉ dùng để dựng sandbox vẫn làm khối "đọc văn bản". Bản duyệt sửa bằng `executed`. Đó là trường hợp của `deploy-remote-behavior` (script đưa vào `input`, nhưng bản cắt cụt đi qua tham số `options`) và năm khối của `admin-settings-get-masking-behavior` (danh sách khoá suy từ trang rồi chạy GET thật).
- Không theo giá trị qua thuộc tính đối tượng hay tham số hàm (trừ reader).
- Khối sinh trong vòng lặp đếm một lần.
- Tên gốc trần (`'app'`) trong một đường dẫn không dựng trên `mkdtemp` được coi là thư mục nguồn.
- Một khối của `ops-restore-hardening` vá **bản sao trong sandbox** của `restore-media.sh` theo chuỗi nguyên văn (`assert.notEqual(patched, original, '…update this test')`). Bản sao sandbox không bị tính là mã nguồn, nên khối này không có trong bảng.

**Test của chính công cụ:** `tests/test-inventory.test.ts`.

- Chạy script trên `tests/fixtures/test-inventory/` với ba test giả, mỗi lớp một test. Fixture gồm:
  - một khối không đọc gì;
  - một lần đọc qua helper;
  - một lần đọc sandbox;
  - một mã nguồn chép vào sandbox (không được tính);
  - một lần đọc ở cấp `describe`.
- Kiểm phát hiện, số khối, lớp tự động, tổng và tính ổn định.
- Đỏ-trước, ba lượt:
  1. Script chưa tồn tại: `Cannot find module …/scripts/test-inventory.ts`.
  2. Bộ dò chú thích bị vô hiệu: 2 test đỏ, `'structural' !== 'brittle'`.
  3. Bỏ luật "đối số ghi tệp không tính": 2 test đỏ, khối chép sandbox bị đếm.

  Sau mỗi lượt, tệp được trả lại và so `cmp` đúng từng byte.

## Ba lượt chuyển đầu tiên (an ninh)

Chọn từ danh sách ứng viên theo mức nghiêm trọng, sau khi loại các bất biến `CLAUDE.md` đã ghi là có test chạy thật:

- `admin-auth`;
- `requireResourcePermission`;
- honeypot;
- đường ghi bài viết gốc;
- quản lý user;
- đổi mật khẩu admin;
- id oracle bài viết;
- bản dịch treo dưới bài.

Cũng hoãn các ứng viên có thể đã được test chạy thật phủ một phần dù `CLAUDE.md` chưa ghi (MFA: `mfa-enrollment-recovery-codes-behavior`, `mfa-concurrency`, `mfa-login-boundaries`) cho tới khi đối chiếu từng khối.

Phủ chạy thật trước lượt chuyển (grep import/`mock.module` của handler trong `tests/`):

- Lượt 1 và 2: **không test nào chạy** các handler đó (`reader/notifications*`, `routes/uploads/[...path]`).
- Lượt 3: hai handler **đã chạy** trong test cho bất biến khác — `articles/[slug]` trong `html-entities-plain-text` và `article-view-ip-ceiling`, `pages/[slug]` trong `security-block-link-schemes` và `submission-recipient-published-only`. Nhưng không test nào kiểm lọc HTML lúc đọc; bất biến đó chỉ có khẳng định văn bản.

Đỏ-trước theo cùng một cách: sửa tạm tệp sản phẩm, chạy riêng tệp test mới, rồi `git checkout` và kiểm `git diff --exit-code` sạch.

### 1. Thông báo của bạn đọc chỉ là của chính họ (IDOR)

- **Bất biến:**
  - `GET /api/public/reader/notifications` và `POST …/notifications/read` lấy danh tính từ vé (`requireReader`), không bao giờ từ query/body;
  - `markRead`/`markAllRead` chặn UPDATE theo `reader_id`;
  - lượt từ chối không tốn hạn mức.
- **Khẳng định văn bản cũ.** `tests/reader-notifications.test.ts`, describe "reader-scoped queries are bounded by the ticket":
  - thân hàm phải chứa `readerNotifications.readerId`;
  - endpoint phải có `requireReader(event)` và không khớp regex `body.readerId`;
  - `await recordRateLimitHit` đứng sau chuỗi từ chối.
- **Test mới:** `tests/reader-notifications-scope-behavior.test.ts`, 6 khối.
  - Harness: endpoint và service thật. `getDb()` giả biên dịch WHERE bằng `MySqlDialect` rồi chạy SELECT/UPDATE trên bảng `reader_notifications` trong `node:sqlite`. `requireReader`, `recordRateLimitHit` và `rateLimitDeps` được giả bằng `mock.module`.
  - Kiểm: reader 7 gửi id của reader 8, kèm `readerId: 8` trong body/query, mà hàng của 8 vẫn chưa đọc; `all: true` chỉ đổi hàng của 7; không vé → 401 và không câu lệnh nào; body hỏng → 400 không tốn hạn mức; vượt hạn mức → 429 và không ghi.
- **Đỏ-trước** (mỗi lượt riêng):

  | Lượt hỏng | Khối đỏ |
  |---|---|
  | A — `markRead` chỉ lọc theo id | "mark read: ids that belong to another reader…" |
  | B — `markAllRead` (và `countUnread`, cùng dòng WHERE) chỉ lọc `is_read` | "mark all read…" + "list…" |
  | C — mark-all lấy `payload.readerId` | "mark all read…" |
  | D — danh sách lấy `query.readerId` | "list: a reader sees their own notifications only…" |
  | E — tính hạn mức ngay sau `requireReader` | "a refused request costs no allowance…" |
  | F — `const { readerId = reader.id } = payload` | "mark all read…" — regex cũ **không** bắt (`false`) |

- **Đã xoá** (3 khối, `tests/reader-notifications.test.ts`):
  - `markRead and markAllRead both filter on readerId`
  - `neither endpoint accepts a readerId from the request`
  - `the mark-read endpoint spends allowance after its refusals`

### 2. `/uploads/**` không thoát khỏi gốc và không vẽ SVG

- **Bất biến:**
  - không đường dẫn nào trong request đọc được tệp ngoài `<cwd>/public/uploads` (`.env` nằm ngay trên `public/`);
  - tệp ngoài danh sách loại an toàn (`.svg`, `.html`) được tải xuống (`application/octet-stream` + `Content-Disposition: attachment` + `nosniff`), không bao giờ được vẽ.
- **Khẳng định văn bản cũ.** `tests/cms-core-auth-media.test.ts`:
  - mã phải chứa `replace(/\.\./g, '')` và `startsWith(uploadsRoot + path.sep)`;
  - bảng `mimeMap` không chứa `svg`;
  - có `nosniff` và `attachment`.
- **Test mới:** `tests/uploads-route-confinement-behavior.test.ts`, 4 khối.
  - Harness: route thật, `process.cwd()` trỏ vào một cây tạm có `.env` và `public/secret.txt` ngay ngoài gốc. `sendStream` giả ghi lại đường dẫn của stream.
  - Kiểm: 14 đường dẫn độc hại đều trả 403/404 và không stream gì. Các đường dẫn gồm `../`, `....//`, đường dẫn tuyệt đối, `%2e%2e`, `\` và đường dẫn tuyệt đối tới chính `.env`. Ngoài ra thư mục/thiếu → 404, ảnh hợp lệ có đủ header, SVG/HTML bị buộc tải xuống.
- **Đỏ-trước:**

  | Lượt hỏng | Kết quả |
  |---|---|
  | A — bỏ phép kiểm chứa trong gốc | Đỏ: `"/etc/hostname" answered null`. Đường dẫn tuyệt đối được phục vụ. |
  | C — `.svg` → `image/svg+xml` | Đỏ: `legacy.svg is served with a renderable type` |
  | B — chỉ bỏ `replace(/\.\./g, '')` | **Xanh** — đúng như mong đợi: phép kiểm chứa đủ chặn; khẳng định cũ đã đỏ oan ở đây |

- **Đã xoá** (2 khối, `tests/cms-core-auth-media.test.ts`):
  - `uploaded files are never served as inline SVG`
  - `the uploads route still refuses to escape its root`

### 3. Lọc HTML lúc đọc ở hai endpoint công khai

- **Bất biến:** hàng ghi trước khi có lớp lọc lúc ghi vẫn nằm trong CSDL và đi thẳng vào `v-html`. Vì vậy:
  - `GET /api/public/articles/:slug?lang=…` phát `article_translations.content` đã qua `sanitizeHtml`;
  - `GET /api/public/pages/:slug?lang=…` phát `data` của khối, gộp với `data.translations[lang]`, đã qua `sanitizeBlockData` — ở cả cây đã xuất bản lẫn đường hàng phẳng cũ.
- **Khẳng định văn bản cũ.** `tests/security-translation-html.test.ts`:
  - mã phải chứa `sanitizeHtml(translation.content)` và không chứa `content: translation.content,`;
  - `data: sanitizeBlockData({ ...rawData, ...langOverrides })` xuất hiện đúng 2 lần.
- **Test mới:** `tests/public-translation-sanitize-behavior.test.ts`, 6 khối.
  - Harness: handler thật. `getDb()` giả trả hàng theo tên bảng (`getTableName`), mỗi lượt đọc nhận bản sao.
  - Kiểm: năm payload (`<script>`, `onerror`, `javascript:`, `<svg onload>`, `onclick`) ở bản dịch bài viết, ở khối cấp đầu, ở khối lồng trong `section`, và ở hàng phẳng; với `lang` trống, `vi`, `en`. Không payload nào còn trong JSON trả về. Markup hợp lệ giữ nguyên. Bản dịch không có nội dung thì lùi về bài gốc.
- **Đỏ-trước:**

  | Lượt hỏng | Khối đỏ |
  |---|---|
  | Bài viết phát `translation.content` nguyên văn | đúng khối "article: a stored translation…" |
  | Cây đã xuất bản gộp không qua `sanitizeBlockData` | đúng khối "page (published tree)…" |
  | Hàng phẳng gộp không qua `sanitizeBlockData` | đúng khối "page (legacy flat rows)…" |

- **Đã xoá** (2 khối, `tests/security-translation-html.test.ts`):
  - `the public article endpoint sanitizes a stored translation when serving it`
  - `the public page endpoint sanitizes the merged block data at read time`

  Hai kiểm kê đường ghi ("every write of translation content is sanitized", "no other server file writes…") giữ nguyên: đó là cấu trúc.

## Danh sách chuyển tiếp theo (ưu tiên)

An ninh trước, dữ liệu sau. Thứ tự trong mỗi nhóm: chưa có test chạy nào trước, rồi mức nghiêm trọng.

| # | Tệp (khối) | Bất biến | Khẳng định văn bản hiện tại | Test hành vi thay thế |
|--:|---|---|---|---|
| 1 | `chatbot-session-rate-limit` (1) | `POST /api/public/chatbot/session`: vượt trần → 429 + `Retry-After`; thiếu bí mật → 503; hạn mức tính trước khi cấp token | `session.post.ts` khớp `enforceSessionMintLimit(event)`, `statusCode: 429`, `Retry-After`, `statusCode: 503`; `indexOf('enforceSessionMintLimit') < indexOf('issueSessionToken(')` | Global Nitro giả + `mock.module` cho store hạn mức và cấu hình bí mật; gọi handler tới khi vượt trần, kiểm 429 + header và không token nào được cấp; bí mật trống → 503 |
| 2 | `password-policy` (5) | Tạo user, đổi mật khẩu user áp chính sách và thu hồi phiên; seed và khởi động production từ chối `ADMIN_PASSWORD` yếu | `users/index.post.ts` khớp `passwordRejectionMessage(password, { username })`, không còn `password.length < 6`; `users/[id].put.ts` khớp `passwordRejectionMessage(newPassword`, `username: users.username`, tăng `tokenVersion`; `seed.ts` khớp `passwordRejectionMessage(adminPassword` + `process.exit(1)`; `require-secrets.ts` nhắc `ADMIN_PASSWORD` + `passwordRejectionMessage` | Harness của `user-management-escalation-behavior` (DB giả + actor): mật khẩu yếu → 400, không ghi; đổi mật khẩu → `tokenVersion` tăng. Gọi plugin `require-secrets` với env production giả → ném lỗi |
| 3 | `client-ip` (3) | Khoá rate-limit chat, hàng audit của logout, quyết định proxy của OAuth redirect dùng IP đã phân giải, không dùng header thô | `chat-policy.ts` khớp `getClientIp(event)`, không có `xForwardedFor`; `logout.post.ts` khớp `ip: getClientIp(event)`, không `getRequestHeader(event, 'x-forwarded-for')`; `google-oauth/config.ts` khớp `isTrustedProxy(`, `xForwardedFor: false` | Event có `x-forwarded-for` giả mạo từ peer không tin cậy; bắt khoá rate-limit / hàng audit / host redirect, kiểm là IP peer |
| 4 | `rate-limit-store` (3), `logging` (3), `cms-core-auth-media` (khối login) | Login: mọi nhánh thất bại (kể cả tài khoản khoá) đều tính; trần theo nguồn (5) và theo tài khoản (15); `Retry-After`; ba thân 401 giống hệt; mọi nhánh có log | `login.post.ts`: đếm nhánh ghi hạn mức, khớp `IP_RULE … limit: 5`, `USER_RULE … limit: 15`, khoá `login:ip:${ip}:${userKey}` / `login:user:${userKey}`, `setResponseHeader(event, 'Retry-After'`; `SECURITY_EVENTS.loginFailed` ×3, `loginLocked`, `loginSucceeded`; tập thông điệp 401 trích từ mã có đúng 1 phần tử | Harness `login.post` của `mfa-login-boundaries`; chạy từng nhánh (sai mật khẩu, không có user, tài khoản khoá), so thân 401, đếm khoá rate-limit, bắt logger giả |
| 5 | `moderation-always-scan` (4) | Mọi nội dung không rỗng đều qua AI (không còn ngưỡng 5 ký tự); lớp tức thì vẫn còn và chạy trước | `moderation-worker.ts` không còn `content.length >= 5` hay `matchedKeywords.length > 0 \|\| content.length`, khớp `if (content.length > 0)`, còn `export async function fastPreModerate` | `mock.module` AI gateway + DB; gửi nội dung 1–4 ký tự không khớp từ khoá, kiểm AI được gọi; nội dung khớp luật tức thì bị chặn trước khi gọi AI |
| 6 | `livestream-chat` (1) | Mọi lý do từ chối (nội dung, không có phiên) trước lượt tiêu hạn mức; kiểm duyệt tức thì; INSERT sau cùng | trong thân `sendChatMessage`: `indexOf` của `validateChatContent(` < `activeSession(db)` < `recordRateLimitHit(` < … < `db.insert(livestreamMessages)` | Như lượt 1 ở trên: store giả ghi thứ tự; nội dung hỏng / không có phiên → từ chối, không tiêu hạn mức, không INSERT |
| 7 | `public-qa-documents-page` (7) | Endpoint chỉ phát hàng đã xuất bản, không lộ trường nội bộ, trần `perPage`, `page` không thành NaN, lỗi ≠ rỗng | handler khớp `eq(chatbotKnowledge.status, 'published')`, `serializePublicKnowledge`, không chứa tên trường nội bộ; `readInt(query.perPage, 20, 1, 50)`, `Number.isFinite(value)` | `node:sqlite` + `MySqlDialect` (harness `article-id-oracle`) với hàng nháp/đã xuất bản; `perPage=9999` → 50; `page=abc` → 1 |
| 8 | `article-related-content` (6) | Bài liên quan chỉ là bài đã xuất bản, không là chính nó, cùng loại; slug lạ → rỗng, không lỗi | `related.get.ts`: ≥ 3 mệnh đề lọc `published`, khớp `ne(articles.id, current.id)`, `eq(articles.type, current.type)`, `if (!current) return empty()`, không `createError` | Như #7, với bài nháp cùng loại và bài khác loại trong bảng |
| 9 | `security-ai-editorial-html` (1), `safe-path` (1) | Panel AI chỉ render trường đã lọc; `backPath` qua `safeInternalPath` (open redirect) | panel khớp `content: res.polishedContent \|\| ''`, không `polishedContent \|\| res.rawText`; handler khớp `polishedContent: sanitizeHtml(`. `in-bai/[slug].vue` khớp `safeInternalPath(route.query.back`, `:href="backPath"`, không `` `/${backPath}` `` | `renderSfcTemplate` với câu trả lời AI chứa `<script>`/`onerror`, và với `back=//evil.example` |
| 10 | `chatbot-knowledge-lifecycle-contract` (3), `admin-cache-clear` (4), `admin-activity-logs` (7) | Mỗi route chỉ cho đúng thao tác của nó; xoá cache cần `confirm: true`, chỉ nhóm `nitro/routes`, có audit; đọc log mọi tài khoản cần `users.read` và tự ghi log | route publish khớp `requireChatbotKnowledgePermission(event, 'publish')` + `transitionKnowledge(actor.id, id, 'published')`; cache-clear khớp `body?.confirm !== true` → `statusCode: 400`, `getKeys('nitro/routes')`; activity-logs khớp `requireResourcePermission(admin, 'users', 'read')`, `db.insert(activityLogs).values({`, `resource: 'activity_logs'` | Như `permissions-behavior`: actor thiếu đúng một cờ → 403 và không ghi; đủ cờ → ghi + audit; storage giả kiểm chỉ khoá `nitro/routes` bị xoá |

**Dữ liệu (sau nhóm an ninh):**

| Tệp (khối) | Bất biến | Khẳng định văn bản hiện tại | Test hành vi thay thế |
|---|---|---|---|
| `retention-policy` (7) | Lưu chính sách kiểm hết trước khi ghi; cron và scheduler chung một khoá | trong `saveRetentionPolicy`, `indexOf` của mọi bộ kiểm < lượt ghi đầu; scheduler khớp `withNamedLock(` + `cdkt:data:retention` | Gọi `saveRetentionPolicy` với ô thứ hai hỏng trên DB giả → không lượt ghi nào; hai lượt chạy song song với khoá giả → một lượt 409/bỏ qua |
| `articles-thumbnail-scan` (10), `media-self-heal` (12) | Dry-run không ghi; sửa trong một tx kèm audit; backup SQL trước; khoá tên; 409 khi bận | `if (!dryRun && uniqueFixIds.length > 0)`, `db.transaction(… UPDATE articles SET thumbnail_url`, `tx.insert(activityLogs)… 'articles_fix_thumbnails'`, `runBackup('sql', 'pre-fix-thumbnails'`; `if (opts.dryRun) continue`, `LOCK_NAME = MEDIA_JOB_LOCK.selfHeal` | DB/R2 giả và `runBackup` giả: dry-run → không UPDATE/upload; chạy thật → backup trước, UPDATE + audit trên cùng handle tx; khoá bận → 409 |
| `seed-upsert-no-overwrite` (3) | Seed không ghi đè hàng có sẵn khi khởi động lại | mọi `onDuplicateKeyUpdate` trong `seed.ts` gán một cột cho chính nó (≥ 10 lượt khớp); không `db.update(homeSections)` | Chạy seed trên DB giả bắt câu lệnh (hoặc `node:sqlite`) với hàng đã sửa → hàng không đổi |
| `stored-html-sanitize` (1), `stored-plaintext-decode` (1) | Mặc định chỉ xem trước; chỉ `--apply` mới ghi | service khớp `const apply = options.apply === true` + `if (apply)` ×2; script khớp `process.argv.includes('--apply')` | Chạy service với DB giả có/không `apply` → đếm lượt ghi; chạy script với service giả → cờ chuyển đúng |
| `comment-validation` (1) | `countImpact` trả đủ ba bộ đếm và tách theo tác giả | thân `countImpact` khớp `otherReaderReplies` và phép tách theo `adminUserId` (cạnh một bản chép logic trong test) | Chạy `countImpact` thật trên `node:sqlite` với bình luận của bạn đọc/admin/người khác; bỏ bản chép |
| `media-comments` (11) | Đếm/trả lời theo đúng định danh; audit không chứa slug/URL; mail gửi sau commit; chỉ mục đã xuất bản + bật bình luận | regex trên truy vấn (`isNull`, `leftJoin`, mệnh đề phạm vi); meta audit không có `slug:`/`url:`; `indexOf` gửi mail > `indexOf` transaction | `node:sqlite` cho truy vấn; tx giả ghi thứ tự commit ↔ gửi mail; bắt hàng audit |
| `reader-notifications` (2) | Bình luận và thông báo trả lời ghi trong một tx | thân `createComment` khớp `db.transaction(`, `createReplyNotification(`, `tx,` | DB giả có tx ném lỗi sau lượt ghi thông báo → không còn hàng nào |
| `analytics-maintenance` (1) | Gộp lại cùng một ngày không lỗi khoá chính | câu INSERT `analytics_daily_admin_users` mang `ON DUPLICATE KEY UPDATE` (test ghi rõ chọn văn bản vì lỗi chỉ hiện trên driver thật) | Suite integration `analytics-maintenance` chạy `aggregateDay` hai lần cho cùng ngày; hoặc pool giả bắt câu lệnh thật sự được gửi |
| `analytics-scheduler` (7), `data-retention` (2) | Chỉ đếm lượt `complete`; đóng pool; nuốt lỗi nhịp; dọn bộ đếm chạy bất kể công tắc retention; một khoá | khớp `status = 'complete'`, `pool.end()`, `analytics.scheduler_failed`; `rate-limit-purge-scheduler` không nhắc `autoEnabled`, khớp `withNamedLock(`, `LOCK_TIMEOUT_SECONDS = 0` | Timer/pool giả: nhịp ném lỗi không làm chết worker; pool được đóng; công tắc retention tắt vẫn dọn bộ đếm |
| `ops-scripts` (16) | Mật khẩu MySQL không lên danh sách tiến trình; bản dump hỏng bị xoá; chỉ đổi tên cuối sau khi kiểm | `backup-db.sh` khớp `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" docker exec -e MYSQL_PWD`, không `-p${MYSQL_ROOT_PASSWORD`; `rm -f -- "$PARTIAL"`; `indexOf` kiểm < đổi tên | `_ops-sandbox`: docker giả ghi argv/env → không có mật khẩu trong argv; dump giả hỏng → không còn tệp |

**Xoá sau khi đối chiếu, không viết test mới:**

- `reader-session-boundary` (3) — **đã đối chiếu**: `admin-auth-middleware` chạy thật cả ba rào ("no cookie, a garbage cookie and a token signed with another secret are all refused", "an MFA challenge ticket is not a session…", "a reader token cannot open the admin API"). Xoá được ngay.
- `ops-scripts-sandbox` (2, giòn) — hai khối đã chạy `backup-db.sh` thật; dòng cuối mỗi khối ghim chuỗi nguyên văn (`cdkt-backup-err.$$`, `PARTIAL="$TARGET.partial"`) mà khẳng định chạy thật ngay trên đã chứng minh. Phần thay đã có sẵn trong cùng khối.
- `mfa-codes-endpoints` (30) — **chưa đối chiếu từng khối**. Có thể trùng một phần: tiêu mã một lần ↔ `mfa-concurrency`; vé thử thách không mở route admin ↔ `admin-auth-middleware`; đổi mật khẩu ↔ `admin-password-change-behavior`. Đối chiếu, xoá phần trùng; khối nào chưa có thì vào danh sách trên.
- `cms-core-auth-media` (11) — tương tự, chưa đối chiếu từng khối.

## Bảng kiểm kê đầy đủ

Sinh bằng `--markdown` sau ba lượt chuyển ở trên. Mọi dòng đã duyệt tay.

**Cột:**

- **H · C · G**: số khối đọc nguồn theo lớp đã duyệt (hành vi · cấu trúc · giòn).
- **(+n chạy)**: số khối đọc mã nguồn chỉ để dựng/chạy nó.
- **Sửa tay**: `có` khi lớp của tệp khác lượt tự động; `n khối` khi n khối có lớp cuối khác lớp tự động của chúng.

<!-- Sinh bởi `node --experimental-strip-types scripts/test-inventory.ts --markdown`; lớp đã duyệt ở `scripts/test-inventory-review.ts`. -->

| Lớp (đã duyệt) | Tệp | Khối đọc nguồn |
|---|--:|--:|
| hành vi | 36 | 214 |
| giòn | 1 | 8 |
| cấu trúc | 108 | 574 |
| **Tổng** | **145** | **796** (trên 2024 khối của các tệp này) |

Lớp tệp sửa tay so với lượt tự động: 32; khối sửa tay: 156; tệp chưa duyệt: 0.

| Tệp test | Đọc nguồn | Khối nguồn / tổng | H · C · G | Tự động | Đã duyệt | Sửa tay | Ghi chú |
|---|---|--:|---|---|---|---|---|
| `tests/activity-log-labels.test.ts` | `app/pages/admin/users/activity.vue`, `server/` | 5/5 | 0 · 5 · 0 | cấu trúc | cấu trúc |  | Kiểm kê nhãn ↔ mọi lượt ghi activity_logs. |
| `tests/admin-activity-logs.test.ts` | `app/layouts/admin.vue`, `app/pages/admin/users/activity.vue`, `server/api/admin/activity-logs/index.get.ts` +1 | 9/9 | 7 · 2 · 0 | hành vi | hành vi | 7 khối | Quyền users.read, tự ghi lượt đọc, lọc/phân trang, leftJoin giữ log, allowlist meta — chạy được trên endpoint với DB giả. Hai khối giao diện là cấu trúc. |
| `tests/admin-bulk-selection-ui.test.ts` | `app/composables/useBulkSelection.ts`, `app/pages/admin/chatbot/knowledge/index.vue`, `app/pages/admin/content/articles/index.vue` +6 | 1/6 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Hợp đồng composable giao diện. |
| `tests/admin-cache-clear.test.ts` | `app/layouts/admin.vue`, `server/api/admin/cache-clear.post.ts` | 8/8 | 4 · 4 · 0 | hành vi | hành vi | 3 khối | Quyền settings.update, confirm:true, chỉ xoá nhóm nitro/routes, một hàng audit — chạy được. Vị trí nút/ngữ cảnh UI là cấu trúc. |
| `tests/admin-confirm-dialog.test.ts` | `app/components/admin/ConfirmModal.vue` | 2/10 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | A11y bàn phím của hộp xác nhận. |
| `tests/admin-docs.test.ts` | `app/pages/admin/docs/index.vue` | 1/18 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Chống lệch hydrate (không xáo lúc setup). |
| `tests/admin-error-retry-ui.test.ts` | `app/`, `app/components/admin/AnalyticsLiveDashboard.client.vue`, `app/components/admin/ChatbotSmallTalkPanel.vue` +55 | 7/7 | 0 · 7 · 0 | cấu trúc | cấu trúc |  | Kiểm kê guard nhánh lỗi/thử lại (50 trang + miễn trừ). |
| `tests/admin-handler-authorization.test.ts` | `server/api/admin/`, `server/api/admin/x.post.ts` | 6/7 | 0 · 6 · 0 | cấu trúc | cấu trúc |  | Luật AST: mọi handler admin kiểm quyền hoặc được miễn có tên. |
| `tests/admin-list-pilot-pages.test.ts` | `app/pages/admin/chatbot/sessions/index.vue`, `app/pages/admin/comments/index.vue`, `app/pages/admin/readers/index.vue` | 4/4 | 0 · 4 · 0 | hành vi | cấu trúc | có, 3 khối | Ratchet chuyển trang danh sách sang adminFetch/useAdminList; không phải bất biến an ninh/dữ liệu. |
| `tests/admin-media-portal-ui.test.ts` | `app/pages/admin/livestream/index.vue`, `app/pages/admin/media-portal/*.vue`, `app/pages/admin/media-portal/[id].vue` +2 | 11/12 | 0 · 11 · 0 | cấu trúc | cấu trúc |  | Hợp đồng template (tài nguyên RBAC phía UI, nhánh trạng thái, rel=noopener). |
| `tests/admin-mfa-enforcement-behavior.test.ts` | `server/api/admin/profile/mfa/` | 1/17 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Kiểm kê tệp dưới profile/mfa/ ↔ allowlist; phần hành vi đã chạy thật trong cùng tệp. |
| `tests/admin-modal-dialog.test.ts` | `app/`, `app/components/admin/AdminModal.vue`, `app/components/admin/ConfirmModal.vue` +6 | 11/30 | 0 · 11 · 0 | cấu trúc | cấu trúc |  | Kiểm kê hộp thoại admin + a11y; phần dựng thật đã dùng renderSfcTemplate. |
| `tests/admin-moderation-summary.test.ts` | `app/components/admin/ai/AiModerationTab.vue`, `app/pages/admin/ai/moderation.vue` | 2/7 (+1 chạy) | 0 · 2 · 0 | hành vi | cấu trúc | có, 2 khối | Hợp đồng template của tab (chỉ đọc, hai con số, role=alert); không phải bất biến máy chủ. |
| `tests/admin-settings-get-masking-behavior.test.ts` | `app/pages/admin/settings/*.vue`, `server/api/admin/settings/index.put.ts` | 3/8 (+5 chạy) | 0 · 3 · 0 | hành vi | cấu trúc | có, 8 khối | Đã chạy thật GET/PUT; văn bản trang chỉ dùng để suy danh sách khoá vào (executed). Còn lại: kiểm tính không rỗng của danh sách, media-portal.vue không chép Secret Key, allowlist một hằng số — cấu trúc. |
| `tests/ai-budget.test.ts` | `server/utils/ai-budget.ts` | 4/4 | 4 · 0 · 0 | cấu trúc | hành vi | có, 4 khối | Ngân sách AI (dịch vụ bị chặn khi hết, 0 = không giới hạn, cảnh báo 80 % mỗi ngày) chạy được qua ai-budget.ts — chặn lạm dụng chi phí. |
| `tests/analytics-live-api-contract.test.ts` | `server/api/admin/analytics/live.get.ts`, `server/api/admin/analytics/live/breakdown.get.ts`, `server/api/admin/analytics/noc.get.ts` | 1/4 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Kiểm kê: mọi route realtime gọi guard đọc analytics. |
| `tests/analytics-live-dashboard-ui.test.ts` | `app/components/admin/AnalyticsLiveDashboard.client.vue`, `app/pages/admin/analytics.vue` | 10/11 (+1 chạy) | 0 · 10 · 0 | cấu trúc | cấu trúc |  | Hợp đồng SFC dashboard; hàm thuần đã trích và chạy (Function). |
| `tests/analytics-live-sql-privacy.test.ts` | `server/services/analytics-reporting.ts` | 1/1 | 1 · 0 · 0 | hành vi | hành vi |  | Riêng tư: SQL realtime chỉ đọc bảng tổng hợp/NOC và có giới hạn — bắt SQL qua pool giả rồi kiểm. |
| `tests/analytics-maintenance.test.ts` | `server/services/analytics-maintenance.ts` | 1/6 | 1 · 0 · 0 | cấu trúc | hành vi | có, 1 khối | aggregateDay upsert (khoá chính day) — dữ liệu, chạy được bằng pool giả bắt SQL. |
| `tests/analytics-scheduler.test.ts` | `server/plugins/analytics-scheduler.ts`, `server/plugins/retention-scheduler.ts`, `server/services/analytics-scheduler.ts` | 8/24 | 7 · 1 · 0 | hành vi | hành vi | 7 khối | Scheduler (một khoá, chỉ đếm lượt xong, đóng pool, nuốt lỗi nhịp, unref, công tắc) — dữ liệu, chạy được với timer/pool giả. |
| `tests/app-shared-imports.test.ts` | `app/`, `app/pages/admin/users/roles.vue` | 2/8 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Ranh giới import app/ → shared/. |
| `tests/article-export-google.test.ts` | `server/api/admin/articles/export-google.post.ts`, `server/services/article-export-google.ts`, `server/utils/google-oauth/config.ts` +1 | 13/13 | 7 · 6 · 0 | hành vi | hành vi | 5 khối | Quyền đọc từng bài, lỗi bí mật/OAuth → 400, bỏ bài lỗi — chạy được với fetch giả. Tách tệp/cấu trúc gọi là cấu trúc. |
| `tests/article-list-indexes.test.ts` | `server/db/migrations-additive.ts`, `server/db/schema-tables/content.ts` | 2/3 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | DDL ↔ ensureIndex cùng cột. |
| `tests/article-related-content.test.ts` | `app/components/ArticleDetail.vue`, `server/api/public/articles/[slug]/related.get.ts` | 26/37 | 6 · 20 · 0 | cấu trúc | cấu trúc | 7 khối | Phần lớn là hợp đồng giao diện. Ngữ nghĩa truy vấn (chỉ bài đã xuất bản, không tự liệt kê, cùng thể loại, lỗi ≠ rỗng) là ứng viên dữ liệu — SQLite như article-id-oracle. |
| `tests/article-toc.test.ts` | `app/components/ArticleDetail.vue` | 1/20 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Template dùng HTML đã xử lý toc. |
| `tests/article-view-analytics.test.ts` | `server/api/public/articles/[slug]/view.post.ts` | 3/28 | 2 · 1 · 0 | cấu trúc | hành vi | có, 2 khối | Endpoint đếm lượt xem luôn 202, không theo công tắc analytics — chạy được. Không đọc IP trần: guard client-ip lo. |
| `tests/articles-thumbnail-scan.test.ts` | `server/api/admin/articles/scan-thumbnails.post.ts`, `server/services/articles-thumbnail-scan.ts`, `server/services/backup.ts` +1 | 13/13 | 10 · 2 · 1 | hành vi | hành vi | 6 khối | Quyền media.update, khoá tên, dry-run, tx + audit, backup trước, idempotent, 409/503 — chạy được với DB/R2 giả. |
| `tests/asset-pipeline.test.ts` | `app/`, `app/assets/css/main.css`, `scripts/fetch-fonts.mjs` +1 | 4/8 | 0 · 4 · 0 | cấu trúc | cấu trúc |  | Đường ống font/icon. |
| `tests/assistant-focus-ring-contrast.test.ts` | `app/pages/assistant.vue` | 1/1 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Tương phản vòng focus. |
| `tests/backup-access.test.ts` | `app/pages/admin/settings/backup.vue`, `server/api/admin/backup/` | 2/14 | 0 · 2 · 0 | hành vi | cấu trúc | có, 1 khối | Trang xoá theo id hàng (template) + kiểm kê handler không đọc trọn tệp; quyền SuperAdmin đã chạy thật trong cùng tệp. |
| `tests/backup-dir-isolation.test.ts` | `server/`, `server/services/backup.ts` | 1/4 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Kiểm kê: không mã nào tự dựng đường dẫn backups. |
| `tests/backup-offsite-ui.test.ts` | `app/components/admin/backup/BackupOffsiteBadge.vue`, `app/components/admin/backup/BackupSettingsPanel.vue`, `app/composables/useBackupSettings.ts` +3 | 5/14 (+3 chạy) | 0 · 5 · 0 | cấu trúc | cấu trúc |  | Hợp đồng giao diện; phần dựng thật đã chạy. |
| `tests/backup-restore-hardening.test.ts` | `app/pages/admin/settings/backup.vue`, `server/services/backup-restore.ts` | 1/37 | 0 · 1 · 0 | hành vi | cấu trúc | có, 1 khối | Trang khôi phục ↔ các pha máy chủ báo (đồng bộ nhãn). |
| `tests/backup-scheduler-due.test.ts` | `server/api/admin/settings/backup.get.ts`, `server/api/admin/settings/index.put.ts`, `server/plugins/backup-scheduler.ts` | 2/27 | 1 · 1 · 0 | hành vi | hành vi | 1 khối | Khoá trạng thái scheduler không ghi được qua API cài đặt — chạy được trên settings PUT. |
| `tests/backup-scheduler-notice-ui.test.ts` | `app/components/admin/backup/BackupSettingsPanel.vue`, `app/composables/useBackupSettings.ts`, `app/utils/backup-settings-payload.ts` | 1/4 (+2 chạy) | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Hợp đồng giao diện. |
| `tests/backup-settings-ui.test.ts` | `app/components/admin/backup/BackupSettingsPanel.vue`, `app/composables/useBackupSettings.ts` | 2/6 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Điều khiển SuperAdmin trên giao diện; máy chủ tự chặn (backup-access). |
| `tests/backup-trigger-length.test.ts` | `server/` | 1/2 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Kiểm kê trigger ↔ BACKUP_TRIGGERS. |
| `tests/carousel-motion-control.test.ts` | `app/components/LiveTickerBar.vue`, `app/components/blocks/RoleModelsBlock.vue` | 3/13 (+1 chạy) | 0 · 3 · 0 | cấu trúc | cấu trúc |  | A11y chuyển động. |
| `tests/category-route-decision.test.ts` | `app/pages/news/[category]/index.vue` | 1/5 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Hợp đồng nhánh lỗi/503 trong template. |
| `tests/chat-widget-dialog-a11y.test.ts` | `app/components/ChatWidget.vue` | 5/7 | 0 · 5 · 0 | cấu trúc | cấu trúc |  | A11y hộp chat. |
| `tests/chatbot-admin-settings-ui-contract.test.ts` | `app/layouts/admin.vue`, `app/pages/admin/chatbot/settings.vue`, `server/api/admin/chatbot/settings/index.patch.ts` +1 | 5/5 | 0 · 5 · 0 | cấu trúc | cấu trúc |  | Hợp đồng trang cài đặt chatbot (bí mật không vào DOM/PATCH là phía UI; máy chủ che riêng). |
| `tests/chatbot-follow-ups.test.ts` | `app/components/ChatFollowUps.vue`, `app/components/ChatWidget.vue`, `app/composables/useChatbot.ts` +2 | 2/17 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Hợp đồng gợi ý tiếp theo. |
| `tests/chatbot-import-newlines-template.test.ts` | `server/api/admin/chatbot/knowledge/template.get.ts` | 1/19 | 1 · 0 · 0 | cấu trúc | hành vi | có, 1 khối | Mẫu Excel: quyền tải, tiêu đề cột khớp bộ đọc, dòng tiếp nối — chạy endpoint rồi đọc lại bằng bộ nhập thật. |
| `tests/chatbot-knowledge-import-ui.test.ts` | `app/pages/admin/chatbot/knowledge/index.vue` | 9/9 | 0 · 9 · 0 | cấu trúc | cấu trúc |  | Hợp đồng giao diện nhập. |
| `tests/chatbot-knowledge-lifecycle-contract.test.ts` | `app/pages/admin/chatbot/knowledge/[id].vue`, `server/api/admin/chatbot/knowledge/[id].put.ts`, `server/api/admin/chatbot/knowledge/[id]/archive.post.ts` +3 | 4/4 | 3 · 1 · 0 | hành vi | hành vi | 1 khối | Mỗi route chỉ cho đúng thao tác của nó; create luôn là draft — chạy được trên handler. |
| `tests/chatbot-knowledge-quick-question.test.ts` | `app/pages/admin/chatbot/knowledge/index.vue` | 4/9 | 0 · 4 · 0 | cấu trúc | cấu trúc |  | Hợp đồng giao diện. |
| `tests/chatbot-live-sessions.test.ts` | `app/components/ChatWidget.vue`, `app/composables/useChatbot.ts`, `app/composables/useChatbotTypewriter.ts` +6 | 12/28 | 7 · 5 · 0 | hành vi | hành vi | 5 khối | Phiên chat: lỗi lưu không làm hỏng câu trả lời, upsert giữ started_at, liên hệ cộng dồn, endpoint admin cần quyền + audit, hạn mức AI theo phiên — chạy được. Typewriter/UI là cấu trúc; honeypot đã chạy thật (chatbot-honeypot-behavior). |
| `tests/chatbot-mobile-smoothness.test.ts` | `app/components/ChatMessageContent.vue`, `app/components/ChatWidget.vue`, `app/composables/useChatbot.ts` +2 | 7/16 | 0 · 7 · 0 | cấu trúc | cấu trúc |  | Hợp đồng giao diện mobile. |
| `tests/chatbot-provider-policies.test.ts` | `app/pages/admin/chatbot/settings.vue` | 1/17 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Điều khiển an toàn còn trên trang. |
| `tests/chatbot-public-widget.test.ts` | `app/components/ChatWidget.vue`, `app/composables/useChatbot.ts`, `app/utils/chatbot-storage.ts` | 8/8 | 0 · 8 · 0 | hành vi | cấu trúc | có, 1 khối | Hợp đồng widget; "không chứa bí mật" là quét văn bản giao diện (kiểm kê). |
| `tests/chatbot-session-rate-limit.test.ts` | `server/api/public/chatbot/session.post.ts` | 1/5 | 1 · 0 · 0 | hành vi | hành vi |  | POST /chatbot/session: 429 + Retry-After, 503 khi thiếu bí mật — chưa có test chạy endpoint. |
| `tests/chatbot-slow-wait.test.ts` | `app/components/ChatWidget.vue`, `app/pages/assistant.vue`, `server/api/public/chatbot/index.post.ts` | 2/11 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Heartbeat SSE + vùng trạng thái. |
| `tests/chatbot-small-talk-admin.test.ts` | `server/api/admin/chatbot/small-talk/`, `server/services/chatbot-small-talk.ts` | 2/12 | 1 · 1 · 0 | cấu trúc | hành vi | có, 1 khối | deleteSmallTalk từ chối hàng hệ thống, khoá trùng → lỗi kiểm tra — chạy được. |
| `tests/chatbot-small-talk-dataset.test.ts` | `server/data/chatbot-small-talk-seed.ts` | 1/10 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Một nguồn cho số hotline. |
| `tests/chatbot-small-talk-schema.test.ts` | `server/db/schema-tables/chatbot.ts`, `server/db/schema.ts` | 3/3 | 0 · 3 · 0 | hành vi | cấu trúc | có, 1 khối | schema.ts ↔ DDL (db:drift cùng việc). |
| `tests/chatbot-small-talk-ui-contract.test.ts` | `app/components/admin/ChatbotSmallTalkPanel.vue`, `app/layouts/admin.vue`, `app/pages/admin/chatbot/knowledge/index.vue` +2 | 7/7 | 0 · 7 · 0 | cấu trúc | cấu trúc |  | Hợp đồng giao diện. |
| `tests/chatbot-small-talk.test.ts` | `app/composables/useChatbot.ts`, `app/pages/admin/chatbot/settings.vue`, `app/utils/chatbot-storage.ts` | 1/18 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Trường small-talk có ở cả hai bề mặt. |
| `tests/chatbot-typing-playback.test.ts` | `app/components/ChatWidget.vue`, `app/composables/useChatbot.ts`, `app/pages/assistant.vue` +1 | 8/19 | 1 · 7 · 0 | cấu trúc | cấu trúc | 1 khối | Hợp đồng hiển thị. Endpoint nguồn trả đúng câu được hỏi là dữ liệu, chạy được. |
| `tests/ci-utc-hygiene-step.test.ts` | `server/utils/utc-query.ts` | 3/4 | 0 · 3 · 0 | cấu trúc | cấu trúc |  | Hình dạng bước CI. |
| `tests/client-ip.test.ts` | `server/`, `server/api/admin/auth/logout.post.ts`, `server/utils/chatbot/chat-policy.ts` +1 | 4/30 | 3 · 1 · 0 | hành vi | hành vi |  | Khoá rate-limit chat, audit logout, OAuth redirect phải dùng IP đã phân giải — chạy được với header giả mạo. Kiểm kê getRequestIP là cấu trúc. |
| `tests/cms-core-auth-media.test.ts` | `server/api/admin/auth/login.post.ts`, `server/api/admin/auth/logout.post.ts`, `server/api/admin/media/upload.post.ts` +7 | 11/14 | 11 · 0 · 0 | hành vi | hành vi |  | Đăng nhập/phiên/upload/form công khai — an ninh. Có thể trùng một phần test chạy thật đã có (admin-auth-middleware, admin-password-change-behavior, mfa-login-boundaries, cookie-secure-flag-behavior, submission-recipient-published-only), chưa đối chiếu từng khối. Hai khối /uploads đã chuyển (§ chuyển đổi). |
| `tests/cms-core-content.test.ts` | `app/pages/admin/content/pages/[id].vue`, `server/db/schema.ts`, `server/utils/page-versions.ts` +1 | 2/15 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Kiểu cây khối khai một lần. |
| `tests/comment-validation.test.ts` | `server/services/` | 1/30 | 1 · 0 · 0 | hành vi | hành vi |  | countImpact trả đủ ba bộ đếm và tách theo tác giả: hiện là bản chép logic + neo văn bản; thay bằng chạy countImpact trên DB giả. |
| `tests/content-type-sidebar.test.ts` | `app/components/ContentTypeListSection.vue`, `app/components/content-type/ContentTypeSidebar.vue` | 4/4 | 0 · 4 · 0 | cấu trúc | cấu trúc |  | Tách component + giới hạn kích thước. |
| `tests/cookie-secure-flag-behavior.test.ts` | `server/api/admin/backup/drive/start.get.ts`, `server/api/auth/google/start.get.ts`, `server/utils/mfa/session.ts` +1 | 1/7 | 0 · 1 · 0 | hành vi | cấu trúc | có, 1 khối | Kiểm kê bốn nơi gọi isSecureRequest; hành vi đã chạy thật trong cùng tệp. |
| `tests/correlated-subquery-qualification.test.ts` | `server/`, `server/api/public/articles.get.ts`, `server/api/public/reader/chats.get.ts` | 4/5 | 1 · 3 · 0 | cấu trúc | cấu trúc | 1 khối | Luật viết SQL (không dựa vào Drizzle tự thêm bảng, không gộp per-request). Tiêu đề cuộc chat lấy câu hỏi đầu là dữ liệu. |
| `tests/csrf-origin-gate-behavior.test.ts` | `server/middleware/` | 1/23 | 0 · 1 · 0 | hành vi | cấu trúc | có, 1 khối | Thứ tự middleware theo tên tệp (scanDir); hành vi cổng đã chạy thật. |
| `tests/data-retention.test.ts` | `scripts/analytics-maintenance.ts`, `server/plugins/retention-scheduler.ts`, `server/services/rate-limit-purge-scheduler.ts` | 2/34 | 2 · 0 · 0 | hành vi | hành vi |  | Dọn bộ đếm chạy bất kể công tắc, script đêm chạy cả retention — dữ liệu, chạy được bằng mock service. |
| `tests/default-permission-matrix.test.ts` | `server/db/seed.ts` | 1/3 (+2 chạy) | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Tự kiểm harness (ma trận đánh giá đổi theo nguồn); hai khối còn lại đã chạy khai báo seed. |
| `tests/dockerfile-layers.test.ts` | `scripts/deploy-remote.sh` | 1/4 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Hình dạng entrypoint/deploy. |
| `tests/favicon-settings.test.ts` | `app/pages/admin/settings/general.vue`, `server/api/admin/media/upload.post.ts`, `server/api/admin/settings/index.put.ts` +6 | 33/60 | 19 · 10 · 4 | hành vi | hành vi | 22 khối | Ghi/đọc favicon_url, escapeHtml, safeFaviconUrl, chặn thoát thư mục, nosniff, magic byte — chạy được. Câu chữ hướng dẫn là giòn; nối dây giao diện là cấu trúc. |
| `tests/focus-ring-contrast.test.ts` | `app/components/ContentTypeListSection.vue`, `app/components/blocks/BlockLoadError.vue`, `app/components/layout/DefaultDesktopNav.vue` +2 | 1/2 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Tương phản vòng focus. |
| `tests/focus-ring-no-secondary-green.test.ts` | `app/`, `app/components/ChatWidget.vue`, `app/components/SocialBubble.client.vue` +1 | 2/2 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Màu vòng focus. |
| `tests/form-a11y.test.ts` | `app/components/ChatWidget.vue`, `app/components/blocks/ContactFormBlock.vue`, `app/components/blocks/SupportFormBlock.vue` +1 | 4/16 (+6 chạy) | 0 · 4 · 0 | cấu trúc | cấu trúc |  | A11y biểu mẫu; phần dựng thật đã chạy. |
| `tests/hero-block-buttons.test.ts` | `app/components/blocks/HeroBlock.vue` | 1/11 (+9 chạy) | 0 · 1 · 0 | cấu trúc | cấu trúc |  | HeroBlock đọc qua resolver; chín khối còn lại đã dựng template thật. |
| `tests/legacy-media-urls.test.ts` | `server/db/migrations-additive.ts` | 1/9 | 0 · 1 · 0 | hành vi | cấu trúc | có, 1 khối | Nối dây lượt sửa vào bước khởi động. |
| `tests/live-chat-history-error.test.ts` | `app/components/LiveChat.vue` | 1/8 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Nhánh lỗi role=alert. |
| `tests/live-status-polling.test.ts` | `app/components/LiveHero.vue`, `app/components/LiveTickerBar.vue`, `app/utils/visible-poller.ts` +1 | 3/10 | 0 · 3 · 0 | cấu trúc | cấu trúc |  | Poll theo visibility, đọc qua cache. |
| `tests/livestream-chat.test.ts` | `server/services/livestream-chat.ts` | 1/38 | 1 · 0 · 0 | cấu trúc | hành vi | có, 1 khối | Mọi lý do từ chối trước lượt tiêu hạn mức, INSERT sau — đổi sang chạy service với store giả (cùng kiểu reader-notifications-scope-behavior). |
| `tests/logging.test.ts` | `server/api/`, `server/api/admin/auth/login.post.ts`, `server/api/submissions.post.ts` +2 | 4/13 | 3 · 1 · 0 | hành vi | hành vi | 2 khối | Đăng nhập ghi mọi thất bại/khoá/thành công, 401 giống hệt nhau, phiên bị thu hồi + form bị chặn có log — chạy được với logger giả. |
| `tests/main-logo-settings.test.ts` | `app/components/layout/DefaultBottomNav.vue`, `app/components/layout/DefaultDesktopNav.vue`, `app/components/layout/DefaultFooter.vue` +10 | 7/7 | 0 · 7 · 0 | cấu trúc | cấu trúc |  | Allowlist cài đặt + giao diện logo. |
| `tests/media-comments.test.ts` | `app/components/ArticleComments.vue`, `server/api/public/comments/[articleSlug].get.ts`, `server/api/public/comments/[id].delete.ts` +4 | 34/49 | 11 · 23 · 0 | hành vi | cấu trúc | có, 8 khối | Phần lớn ghim hình dạng truy vấn. Ứng viên: phạm vi đếm/trả lời, audit không chứa slug/URL, gửi mail sau commit, chỉ mục đã xuất bản + bật bình luận, escape email. |
| `tests/media-job-locks.test.ts` | `server/services/`, `server/services/backup-restore.ts`, `server/services/pre-job-backup.ts` | 3/3 | 0 · 3 · 0 | cấu trúc | cấu trúc |  | AST: khôi phục đọc đúng tập khoá job media. |
| `tests/media-portal-audit.test.ts` | `server/api/admin/livestream/`, `server/api/admin/media-portal/`, `server/services/` +6 | 6/7 | 0 · 6 · 0 | hành vi | cấu trúc | có, 4 khối | Kiểm kê tx + audit (cùng họ reader-audit-atomicity). |
| `tests/media-processing.test.ts` | `server/`, `server/plugins/analytics-scheduler.ts`, `server/plugins/media-processing-reaper.ts` +4 | 8/82 | 0 · 8 · 0 | cấu trúc | cấu trúc |  | Nối dây bộ đếm nhịp + kiểm kê đường ghi. |
| `tests/media-public-pages.test.ts` | `app/`, `app/components/LiveHero.vue`, `app/components/MediaDefaultHero.vue` +8 | 19/20 | 0 · 19 · 0 | cấu trúc | cấu trúc |  | Kiểm kê import thư viện video + hợp đồng trang. |
| `tests/media-scan-index.test.ts` | `server/db/migrations-additive.ts`, `server/db/schema-tables/core.ts` | 2/3 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | DDL ↔ ensureColumn/ensureIndex. |
| `tests/media-self-heal.test.ts` | `server/api/admin/media/self-heal.post.ts`, `server/services/backup.ts`, `server/services/media-self-heal.ts` +5 | 14/14 | 12 · 2 · 0 | hành vi | hành vi | 8 khối | Không xoá local, dry-run, khoá tên, backup trước, Head trước xoá, 409/400, quyền media.update — chạy được với R2/DB giả. |
| `tests/media-unique-slug.test.ts` | `server/utils/unique-media-slug.ts` | 2/12 | 0 · 2 · 0 | hành vi | cấu trúc | có, 2 khối | Ranh giới: module không tự lấy pool (ghi trong tx của nơi gọi). |
| `tests/media-youtube-parser.test.ts` | `app/`, `server/`, `server/utils/youtube-parser.ts` | 1/17 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Kiểm kê: host ảnh chỉ nêu ở parser. |
| `tests/mfa-codes-endpoints.test.ts` | `server/api/admin/auth/login.post.ts`, `server/api/admin/auth/mfa/send-code.post.ts`, `server/api/admin/auth/mfa/verify.post.ts` +14 | 32/43 | 30 · 2 · 0 | hành vi | hành vi | 2 khối | MFA/đổi mật khẩu/lịch sử — an ninh. Một phần có thể trùng test chạy thật (tiêu mã một lần ↔ mfa-concurrency; vé thử thách không mở route admin ↔ admin-auth-middleware; đổi mật khẩu ↔ admin-password-change-behavior), chưa đối chiếu từng khối: đối chiếu, xoá phần trùng, phần còn lại vào danh sách chuyển. |
| `tests/mobile-drawer-a11y.test.ts` | `app/components/layout/DefaultHeader.vue`, `app/components/layout/DefaultMobileDrawer.vue` | 6/26 (+5 chạy) | 0 · 6 · 0 | cấu trúc | cấu trúc |  | A11y ngăn kéo; phần dựng thật đã chạy. |
| `tests/moderation-always-scan.test.ts` | `server/services/moderation-worker.ts` | 4/6 | 4 · 0 · 0 | hành vi | hành vi |  | Kiểm duyệt chạy với mọi nội dung không rỗng (không còn ngưỡng 5 ký tự), lớp tức thì đi trước — chạy checkAndModerateContent với AI giả. |
| `tests/moderation-rescan-summary.test.ts` | `app/pages/admin/ai/moderation.vue` | 1/6 | 0 · 1 · 0 | hành vi | cấu trúc | có, 1 khối | role=status trong template. |
| `tests/nav-config-boundary.test.ts` | `app/components/layout/DefaultBottomNav.vue`, `app/components/layout/DefaultDesktopNav.vue`, `app/components/layout/DefaultFooter.vue` +6 | 2/23 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Bản dịch nhãn + kiểm kê target=_blank kèm rel. |
| `tests/news-most-read-language.test.ts` | `app/components/NewsCategoryList.vue` | 1/2 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Dùng loader chung. |
| `tests/no-server-side-timers.test.ts` | `app/components/ChatWidget.vue`, `app/components/LiveHero.vue`, `app/components/LiveTickerBar.vue` +1 | 2/2 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Timer chỉ phía client. |
| `tests/ops-alert.test.ts` | `server/`, `server/utils/ops-alert.ts` | 2/22 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Kiểm kê sự kiện cảnh báo + chống đệ quy log (vận hành). |
| `tests/ops-scripts-sandbox.test.ts` | `scripts/backup-db.sh` | 2/70 | 0 · 0 · 2 | cấu trúc | giòn | có, 2 khối | Hai khối đã chạy backup-db.sh thật trong sandbox; dòng cuối mỗi khối ghim chuỗi nguyên văn của script (không còn `cdkt-backup-err.$$`, `PARTIAL="$TARGET.partial"`) mà các khẳng định chạy thật ngay trên đã chứng minh — xoá được, phần thay đã có sẵn. |
| `tests/ops-scripts.test.ts` | `scripts/backup-db.sh`, `scripts/backup-media.sh`, `scripts/backup.sh` +14 | 31/76 | 16 · 15 · 0 | hành vi | hành vi | 4 khối | Script sao lưu/khôi phục: kiểm dump, xoá bản hỏng, mật khẩu không lên ps, .env 600 — chạy được trong _ops-sandbox. Hình dạng deploy/compose/locale là cấu trúc (deploy-remote-behavior đã chạy thật). |
| `tests/password-policy.test.ts` | `server/api/admin/users/[id].put.ts`, `server/api/admin/users/index.post.ts`, `server/db/seed.ts` +1 | 5/27 | 5 · 0 · 0 | hành vi | hành vi |  | Tạo user/đổi mật khẩu áp chính sách + thu hồi phiên, seed và khởi động production từ chối mật khẩu yếu — chạy được. |
| `tests/public-block-load-error-ui.test.ts` | `app/components/blocks/BlockLoadError.vue`, `app/components/blocks/DocumentsBlock.vue`, `app/components/blocks/NewsBlock.vue` +6 | 4/4 | 0 · 4 · 0 | cấu trúc | cấu trúc |  | Nhánh lỗi + thử lại của block. |
| `tests/public-detail-ssr-status.test.ts` | `app/components/ArticleDetail.vue`, `app/composables/useSsrFailureStatus.ts`, `app/pages/[slug].vue` +1 | 4/8 | 0 · 4 · 0 | cấu trúc | cấu trúc |  | Cùng quyết định cho nhánh lỗi và 503/404. |
| `tests/public-keyboard-a11y.test.ts` | `app/`, `app/components/SocialBubble.client.vue`, `app/components/layout/DefaultMobileDrawer.vue` +3 | 13/14 | 0 · 13 · 0 | cấu trúc | cấu trúc |  | A11y bàn phím. |
| `tests/public-pages-structure.test.ts` | `app/`, `app/components/ArticleDetail.vue`, `app/components/NewsCategoryList.vue` +18 | 19/19 | 0 · 19 · 0 | cấu trúc | cấu trúc |  | Cấu trúc trang công khai + giới hạn wrapper. |
| `tests/public-qa-documents-page.test.ts` | `app/components/ChatWidget.vue`, `app/components/layout/DefaultFooter.vue`, `app/composables/i18n-default-dictionary.ts` +4 | 19/20 | 7 · 12 · 0 | cấu trúc | cấu trúc | 7 khối | Trang là hợp đồng giao diện. Endpoint danh sách (chỉ hàng đã xuất bản, không lộ trường nội bộ, trần perPage) là ứng viên an ninh/dữ liệu. |
| `tests/public-render-fixes.test.ts` | `app/components/ArticleDetail.vue`, `app/components/PublicEmail.vue`, `app/components/blocks/ContentAsideBlock.vue` +4 | 2/8 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Kiểm kê PublicEmail + ẩn ảnh lỗi. |
| `tests/public-single-h1.test.ts` | `app/components/layout/DefaultHeader.vue`, `app/pages/[slug].vue`, `app/pages/about.vue` +2 | 2/3 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Một h1 mỗi trang. |
| `tests/query-number.test.ts` | `server/api/`, `server/utils/` | 2/7 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Ratchet: không còn Math.max(1, Number(…)), một finitePositive. |
| `tests/rate-limit-store.test.ts` | `server/api/admin/auth/login.post.ts`, `server/api/submissions.post.ts` | 4/18 | 3 · 1 · 0 | hành vi | hành vi | 1 khối | Login đếm mọi nhánh thất bại, trần theo nguồn và theo tài khoản, Retry-After — chạy được trên handler login (mfa-login-boundaries có harness). |
| `tests/reader-audit-atomicity.test.ts` | `server/api/admin/`, `server/api/admin/articles/[id].put.ts`, `server/api/admin/articles/index.post.ts` +44 | 21/22 | 0 · 21 · 0 | cấu trúc | cấu trúc |  | Luật AST tx + audit (guard CLAUDE.md). |
| `tests/reader-comments-ui.test.ts` | `app/components/ArticleComments.vue`, `app/components/ReaderAvatar.vue`, `app/components/layout/DefaultHeader.vue` +1 | 19/19 | 0 · 19 · 0 | cấu trúc | cấu trúc |  | Hợp đồng giao diện bình luận (không v-html là kiểm kê). |
| `tests/reader-display-names-google-behavior.test.ts` | `server/db/migrations-additive.ts` | 1/7 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Nối dây bước khởi động; hành vi đã chạy thật. |
| `tests/reader-name-resolver-guard.test.ts` | `server/` | 2/8 | 0 · 2 · 0 | cấu trúc | cấu trúc |  | Luật AST S5. |
| `tests/reader-notifications.test.ts` | `app/components/ArticleComments.vue`, `app/components/ReaderNotificationBell.client.vue`, `app/components/layout/DefaultBottomNav.vue` +10 | 15/28 | 2 · 13 · 0 | hành vi | cấu trúc | có | Phần còn lại là giao diện/neo hằng số. Ba khối phạm vi bạn đọc đã chuyển (§ chuyển đổi). Bình luận + thông báo trong một tx là ứng viên dữ liệu. |
| `tests/reader-profile-page.test.ts` | `app/pages/profile.vue` | 14/15 | 0 · 14 · 0 | hành vi | cấu trúc | có, 1 khối | Hợp đồng trang /profile (client-only, nhánh trạng thái, noindex). |
| `tests/reader-session-boundary.test.ts` | `server/middleware/admin-auth.ts` | 3/11 | 3 · 0 · 0 | cấu trúc | hành vi | có, 3 khối | Hai rào của admin-auth — đã đối chiếu: admin-auth-middleware chạy thật cả ba (token rác/ký bằng khoá khác bị từ chối, vé MFA không phải phiên, vé bạn đọc không mở API admin). Ứng viên XOÁ, không cần test mới. |
| `tests/replace-literal.test.ts` | `app/components/admin/articles/ArticleAIPanel.vue` | 1/3 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Dùng helper thay chuỗi nguyên văn. |
| `tests/request-body-baseline.test.ts` | `server/` | 4/5 | 0 · 4 · 0 | cấu trúc | cấu trúc |  | Ratchet AST đọc body. |
| `tests/retention-policy.test.ts` | `app/layouts/admin.vue`, `app/pages/admin/settings/data-retention.vue`, `server/api/admin/settings/index.put.ts` +8 | 10/27 | 7 · 3 · 0 | hành vi | hành vi | 3 khối | Lưu chính sách kiểm hết trước khi ghi, endpoint đọc không xoá, quyền + audit, chạy tay cần xác nhận/409, cron và scheduler chung khoá — chạy được. |
| `tests/runtime-image-sources.test.ts` | `scripts/`, `server/` | 1/4 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | AST: image chạy nạp được mọi import. |
| `tests/safe-path.test.ts` | `app/pages/in-bai/[slug].vue` | 1/5 | 1 · 0 · 0 | hành vi | hành vi |  | Open redirect: backPath qua safeInternalPath — dựng template in-bai/[slug].vue với backPath độc hại. |
| `tests/schema-upgrade-integration.test.ts` | `server/db/legacy-media-urls.ts`, `server/db/migrations-additive.ts`, `server/db/reader-name-backfill.ts` +7 | 4/7 (+1 chạy) | 0 · 4 · 0 | cấu trúc | cấu trúc |  | Kiểm kê bảng/khai báo cho suite nâng cấp. |
| `tests/security-ai-editorial-html.test.ts` | `app/`, `app/components/admin/articles/ArticleAIPanel.vue`, `server/api/admin/ai/editorial.post.ts` | 2/6 | 1 · 1 · 0 | hành vi | hành vi |  | Panel AI chỉ render trường đã lọc — dựng template với câu trả lời độc hại. Kiểm kê v-html là cấu trúc. |
| `tests/security-chatbot-article-search.test.ts` | `server/utils/chatbot/chat-policy.ts` | 2/12 | 0 · 2 · 0 | hành vi | cấu trúc | có, 2 khối | Đi qua helper duy nhất (buildArticleSearch, LIKE chung); helper đã chạy thật bằng SQL biên dịch. |
| `tests/security-rbac-escalation.test.ts` | `app/pages/admin/users/roles.vue` | 1/13 | 0 · 1 · 0 | hành vi | cấu trúc | có, 1 khối | Import catalogue qua alias Nuxt. |
| `tests/security-translation-html.test.ts` | `server/`, `server/services/article-translation-worker.ts`, `server/services/article-translations.ts` +1 | 4/12 | 2 · 2 · 0 | hành vi | hành vi |  | Lượt dọn một lần chỉ ghi nội dung đã lọc, đường sửa tay gỡ thẻ title/excerpt — chạy được. Hai kiểm kê đường ghi là cấu trúc. Hai khối lọc lúc đọc đã chuyển (§ chuyển đổi). |
| `tests/seed-upsert-no-overwrite.test.ts` | `server/db/seed.ts` | 3/3 | 3 · 0 · 0 | hành vi | hành vi |  | Seed không ghi đè hàng có sẵn — chạy seed trên DB giả bắt câu lệnh. |
| `tests/server-no-app-imports.test.ts` | `app/utils/blocks/registry.ts`, `app/utils/blocks/types.ts`, `app/utils/submission-status.ts` +5 | 5/11 | 0 · 5 · 0 | cấu trúc | cấu trúc |  | Ranh giới import server/shared ↛ app. |
| `tests/service-split-boundaries.test.ts` | `scripts/`, `server/`, `server/services/` +2 | 41/42 | 0 · 41 · 0 | cấu trúc | cấu trúc |  | Luật AST ranh giới tách service. |
| `tests/settings-credential-rules.test.ts` | `app/pages/admin/settings/email.vue`, `app/pages/admin/settings/media-portal.vue`, `app/pages/admin/settings/media-storage.vue` | 3/10 | 0 · 2 · 1 | hành vi | cấu trúc | có, 3 khối | Trang dùng chung luật với máy chủ (đồng bộ), lỗi hiện tại ô. Gợi ý mật khẩu là câu chữ. |
| `tests/settings-secret-storage.test.ts` | `server/`, `server/db/migrations-additive.ts` | 2/18 | 0 · 2 · 0 | hành vi | cấu trúc | có, 1 khối | Nối dây bước khởi động + kiểm kê nơi đọc bí mật; chuyển đổi đã chạy thật trong cùng tệp. |
| `tests/shared-helpers.test.ts` | `server/`, `server/plugins/runtime-config-global.ts`, `server/utils/rate-limit-deps.ts` +1 | 8/10 | 0 · 8 · 0 | hành vi | cấu trúc | có, 1 khối | Kiểm kê helper dùng chung (rateLimitDeps, runtimeConfig, câu từ chối). |
| `tests/single-flight.test.ts` | `app/composables/useI18n.ts` | 1/6 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Dùng singleFlight. |
| `tests/skeleton-loading-ui.test.ts` | `app/`, `app/components/ArticleComments.vue`, `app/components/ArticleDetail.vue` +70 | 7/7 | 0 · 7 · 0 | cấu trúc | cấu trúc |  | Kiểm kê skeleton + miễn trừ. |
| `tests/slugify.test.ts` | `server/api/`, `server/services/`, `server/utils/` | 1/7 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Một bản slugify. |
| `tests/ssr-failure-response.test.ts` | `app/composables/usePublicArticleList.ts`, `app/composables/usePublicMediaList.ts`, `app/composables/useSsrFailureStatus.ts` +4 | 4/7 | 0 · 4 · 0 | cấu trúc | cấu trúc |  | Cùng biểu thức cho nhánh lỗi và 503. |
| `tests/stored-html-sanitize.test.ts` | `scripts/sanitize-stored-html.ts`, `server/services/stored-html-sanitize.ts` | 1/5 | 1 · 0 · 0 | hành vi | hành vi |  | Mặc định chỉ xem trước, chỉ --apply mới ghi — chạy script với service giả. |
| `tests/stored-plaintext-decode.test.ts` | `scripts/decode-stored-excerpts.ts`, `server/services/stored-plaintext-decode.ts` | 1/10 | 1 · 0 · 0 | cấu trúc | hành vi | có, 1 khối | Như stored-html-sanitize: xem trước trừ khi --apply. |
| `tests/tailwind-content-shared.test.ts` | `shared/` | 3/3 | 0 · 3 · 0 | cấu trúc | cấu trúc |  | Glob content của Tailwind. |
| `tests/thumbnail-on-demand-bounds.test.ts` | `server/api/public/media/[shortId]/thumb.get.ts` | 1/5 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Đi qua bộ trích có giới hạn (helper đã chạy thật). |
| `tests/transaction-tdz.test.ts` | `server/api/`, `server/services/` | 2/8 | 0 · 2 · 0 | hành vi | cấu trúc | có, 2 khối | Quét TDZ (guard CLAUDE.md). |
| `tests/vietnamese-diacritics-clipping.test.ts` | `app/components/`, `app/components/LiveHero.vue`, `app/components/layout/DefaultHeader.vue` +2 | 3/3 | 0 · 3 · 0 | cấu trúc | cấu trúc |  | Leading chữ in hoa có dấu. |
| `tests/view-boost-scheduler.test.ts` | `server/services/view-boost-scheduler.ts` | 1/19 | 0 · 1 · 0 | cấu trúc | cấu trúc |  | Hàm thuần không đọc đồng hồ/DB. |
| `tests/view-totals-integrity.test.ts` | `server/`, `server/api/admin/articles/[id]/boost.post.ts`, `server/services/view-boost-scheduler.ts` | 2/7 | 0 · 2 · 0 | hành vi | cấu trúc | có, 1 khối | Kiểm kê: một nơi ghi tổng, hai đường boost qua một hàm. |

Đọc mã nguồn chỉ để dựng/chạy nó (render template, eval, chép vào sandbox) — không khẳng định trên văn bản, không vào bảng:

- `tests/deploy-remote-behavior.test.ts` — 33/33 khối chạy; `scripts/backup-db.sh`, `scripts/deploy-remote.sh`. Chạy thật deploy-remote.sh trong sandbox; văn bản script chỉ để dựng sandbox/checksum — phân tích nhiễm không tách được.
- `tests/security-block-link-schemes.test.ts` — 1/19 khối chạy; `app/components/blocks/HeroBlock.vue`, `app/components/blocks/LinksBlock.vue`, `shared/link-policy.ts`

Chỉ đọc tệp ngoài bốn gốc (không vào bảng):

- `tests/article-view-ip-ceiling.test.ts` — `CI-CD.md`, `production/README.md`
- `tests/ci-docs-only-skip.test.ts` — `.github/workflows/ci.yml`
- `tests/ci-ffmpeg-install.test.ts` — `.github/workflows/ci.yml`
- `tests/ci-integration-matrix.test.ts` — `.github/workflows/ci.yml`, `tests/`
- `tests/dependabot-config.test.ts` — `.github/dependabot.yml`, `CI-CD.md`
- `tests/health-endpoint.test.ts` — `nuxt.config.ts`
- `tests/ipx-cache-control.test.ts` — `nuxt.config.ts`
- `tests/livestream-plugins.test.ts` — `README.md`, `docker-compose.yml`
- `tests/media-hosts-policy.test.ts` — `nuxt.config.ts`
- `tests/ops-migrate-scanner.test.ts` — `production/manage.sh`

Có lời gọi đọc không suy được đường dẫn (duyệt tay, không vào bảng):

- `tests/backup-dump-integration.test.ts` — 1 lời gọi
- `tests/chunked-upload.test.ts` — 1 lời gọi
- `tests/ops-restore-hardening.test.ts` — 1 lời gọi
