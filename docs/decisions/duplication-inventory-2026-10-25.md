# Kiểm kê code trùng lặp — 2026-10-25 (Wave 3, task 7.4, D-DUP)

Một lượt `jscpd` trên `app/`, `server/`, `shared/`, `scripts/` ở commit `3d69836` (đỉnh tích hợp Wave 2). Mỗi cặp jscpd báo đã được mở và so lại bằng tay trên mã nguồn, rồi xếp vào một trong ba phán quyết:

- **thật** — đáng refactor; kèm kế hoạch một dòng và rủi ro;
- **có chủ đích** — giữ nguyên, kèm lý do (thường là một guard test ghim cấu trúc, hoặc hai bản cố ý khác nhau);
- **dương tính giả** — trông giống nhưng không có logic nào bị chép.

> File này ghi **kết quả kiểm kê và lý do từng phán quyết**. Nó không mở việc nào; danh sách cuối file là đầu vào để tạo việc.

---

## Cách chạy

- **Công cụ:** `jscpd@5.4.1`, phát hành 2026-10-09 (16 ngày trước lượt chạy). Bản mới nhất `5.4.2` (2026-10-20) bị bỏ vì chưa đủ hai tuần. Dòng 5.x là bản viết lại bằng Rust: `npx` tải một nhị phân tự chứa (`jscpd-linux-x64-gnu`) vào cache npm. **Không** thêm gói nào vào `package.json` hay lockfile.
- **Lệnh** (chạy từ gốc repo; thư mục `--output` là thư mục tạm, báo cáo JSON không commit):

  ```bash
  npx jscpd@5.4.1 --min-lines 15 --reporters json \
    --output <thư-mục-tạm>/jscpd/ \
    --ignore "**/node_modules/**,**/.nuxt/**,**/.output/**,**/public/**,**/tests/**" \
    app server shared scripts
  ```

- **Danh sách loại trừ, đúng nguyên văn:** `**/node_modules/**`, `**/.nuxt/**`, `**/.output/**`, `**/public/**`, `**/tests/**`.
  - `public/` (TinyMCE tự host, ảnh) và `tests/` không nằm dưới bốn thư mục được quét, nên hai mục đó không đổi kết quả. Vẫn ghi ra cho tường minh.
  - jscpd tôn trọng `.gitignore` theo mặc định, nên `.nuxt`, `.output`, `node_modules` vốn đã bị loại.
  - **Không loại dữ liệu seed.** Đã chạy một lượt không loại gì thêm: không cặp nào chạm `server/data/*-seed.ts` hay `server/db/seed*.ts`, và kết quả trùng khít lượt chính thức.
- **Tham số mặc định đáng biết** (in bằng `--debug`): `min_tokens` 50, `mode` `mild`, `max_size` 1 MB, mọi định dạng.
- **Cách đọc "exact".** Cả 71 cặp đều báo `kind: exact`. Nhưng chế độ `mild` bỏ qua chú thích, và vẫn báo "exact" cho cặp chỉ khác nhau một chuỗi literal: #50 khác nhau đúng chữ `'update'` / `'read'`. Vì vậy phán quyết dưới đây dựa trên so tay từng cặp, không dựa vào nhãn của jscpd.

## Tổng từ báo cáo JSON

| Chỉ số (`statistics.total`) | Giá trị |
|---|---|
| `percentage` (dòng trùng / tổng dòng) | **0,81 %** (0,8142834481907749) |
| `percentageTokens` | 0,78 % |
| `clones` | **71** |
| `duplicatedLines` | **1 386** |
| `duplicatedTokens` | 8 466 |
| `lines` / `tokens` / `sources` | 170 211 / 1 081 794 / 1 165 |

Theo định dạng: `typescript` 46 cặp / 932 dòng; `html` (template SFC) 24 / 438; `bash` 1 / 16; `vue`, `css`, `javascript` 0.

**Mẫu số đếm SFC hai lần.** Tổng 170 211 là tổng các dòng theo định dạng. Trong đó có:
- dòng `vue` 46 942 — cả tệp `.vue`;
- các khối bên trong chính những tệp đó, đếm lại dưới `html` (20 381), `css` (844) và `typescript`.

Các tệp `.ts` thật dưới bốn thư mục chỉ có 89 095 dòng (`git ls-files`). Vậy khoảng 10 900 trong 100 034 dòng `typescript` là khối `<script>` của SFC. Bỏ dòng `vue` khỏi mẫu số thì tỉ lệ ≈ 1 386 / 123 269 ≈ **1,12 %**. Đây là ước lượng; con số chính thức để trích vẫn là 0,81 % của jscpd. Số cặp và số dòng trùng không bị ảnh hưởng.

---

## Bảng tổng hợp (nhóm theo tổng dòng jscpd báo)

Cặp giống nhau một cách tầm thường được gộp thành một nhóm. Mã nhóm: **T** = thật, **C** = có chủ đích, **G** = dương tính giả. Ưu tiên chỉ áp cho nhóm thật.

Cột "Dòng" cộng trường `lines` của từng cặp (tổng 1 694). Con số `duplicatedLines` = 1 386 của jscpd đếm mỗi dòng một lần, nên nhỏ hơn: một số cặp dùng chung một đoạn (#7/#8, #18/#19, #20/#21, #23/#24, #63/#64).

| Nhóm | Cặp jscpd | Dòng | Phán quyết | Ưu tiên |
|---|---|---|---|---|
| T10 Trang danh sách bài công khai | #6–#9, #11–#14, #39, #40 | 298 | thật | trung bình |
| T2 `slugifyLocal` + form CRUD danh mục | #28–#31 | 177 | thật | trung bình |
| C2 Khối tải/lỗi/thử lại trang admin | #25, #27, #32, #33, #35–#38 | 144 | có chủ đích | — |
| G1 Khung đầu handler | #46–#48, #51, #56, #57 | 115 | dương tính giả | — |
| T4 Ba handler lưu menu điều hướng | #60, #61 | 106 | thật | trung bình–cao |
| T23 Khối/trang công khai tải lại sau SWR | #20, #21, #23, #24 | 104 | thật | thấp |
| T9 Chat: widget và trang `/assistant` | #2–#5 | 78 | thật | trung bình–thấp |
| T6 Danh sách nhật ký admin | #43–#45 | 59 | thật | trung bình |
| T8 Mở đầu sửa bản dịch bài | #63, #64 | 46 | thật | trung bình |
| T7 Xuất bài + bộ lọc danh sách | #52, #53 | 41 | thật | trung bình |
| T20 Skeleton tài liệu admin | #18, #19 | 38 | thật | thấp |
| T11 `loadActive()` livestream | #10 | 35 | thật | thấp–trung bình |
| T19 Ô ảnh trong `MediaLibraryModal` | #15 | 28 | thật | thấp |
| T1 Luật đích SMTP | #71 | 20 (thật ra ~45) | thật | **cao** |
| T3 `stripTags` của hai bộ chuyển HTML | #69 | 21 | thật (mang lỗi) | **cao** |
| T5 Câu nạp tài khoản đăng nhập | #54 | 16 | thật | trung bình |
| T12 `LayoutConfig` client ↔ server | #22 | 19 | thật | thấp–trung bình |
| T13 `LANGUAGE_NAMES` | #49 | 16 | thật | thấp |
| T14 `shortAgent()` | #16 | 21 | thật | thấp |
| T15 Cột sự kiện đơn | #68 | 19 | thật | thấp |
| T16 Upload Drive hai chế độ | #65 | 21 | thật | thấp |
| T17 Mô tả tệp local trong stream | #67 | 20 | thật | thấp |
| T18 `unique*Slug` | #70 | 17 | thật | thấp |
| T21 Kiểu chi tiết bài (trang in) | #1 | 24 | thật | thấp |
| T22 Kiểu `Comment` admin | #26 | 25 | thật | thấp |
| T24 Cột chọn đơn đăng ký | #62 | 22 | thật | thấp |
| C1 Hai đường init TinyMCE | #17 | 16 | có chủ đích | — |
| C3 Tìm kiếm tài liệu ↔ retrieval chatbot | #41 | 16 | có chủ đích | — |
| C4 `app_state()` hai script khôi phục | #42 | 16 | có chủ đích | — |
| C5 Cấp lại phiên sau đổi MFA | #58 | 19 | có chủ đích | — |
| C6 Danh sách khoá đọc ↔ ghi settings | #59 | 23 | có chủ đích | — |
| C7 Cột chọn media admin ↔ công khai | #66 | 20 | có chủ đích | — |
| C8 Tra bài theo phạm vi quyền | #50 | 16 | có chủ đích | — |
| C9 Kiểm thân request cấu hình OAuth | #55 | 18 | có chủ đích | — |
| C10 `ScanJobStatus` phản chiếu | #34 | 20 | có chủ đích | — |

Đếm: 24 nhóm thật (48 cặp), 10 nhóm có chủ đích (17 cặp), 1 nhóm dương tính giả (6 cặp) = 71 cặp.

---

## Nhóm thật

### T1 — Luật đích SMTP chép từ `shared/` (#71) — ưu tiên cao

- **Ở đâu:** `server/utils/smtp-test-config.ts:32-51` ↔ `shared/settings-credential-rules.ts:61-80`.
- **Thật ra rộng hơn jscpd báo.** `smtp-test-config.ts` dòng 1–56 chép lại gần như toàn bộ phần SMTP của tệp shared: `SMTP_ALLOWED_PORTS`, `effectiveSmtpPort`, `isAllowedSmtpPort`, `SMTP_PORT_NOT_ALLOWED_MESSAGE`, `isTruthy`, `SmtpTarget`, `smtpTargetOf`, `sameSmtpTarget`. `MASKED_SMTP_PASSWORD` cũng trùng giá trị `MASKED_SECRET`. Chú thích khác nhau nên jscpd chỉ thấy 20 dòng.
- **Vì sao đáng sửa:** đầu tệp `shared/settings-credential-rules.ts` nói nó là nguồn **duy nhất**, chạy ở cả hai phía. Danh sách cổng là chốt chống dùng ô "cổng" để dò cổng nội bộ. Hai bản có thể lệch: thêm cổng ở một nơi thì nút "gửi thử" và nút "lưu" quyết khác nhau.
- **Kế hoạch:** `smtp-test-config.ts` import và re-export các tên trên từ `shared/`, chỉ giữ phần riêng của nút gửi thử (`classifySmtpError`, `resolveSmtpTestConfig`…).
- **Rủi ro:** thấp. `tests/settings-credential-rules.test.ts` và `tests/settings-secret-storage.test.ts` import `smtp-test-config.ts`, nên giữ nguyên tên export.

### T2 — `slugifyLocal` ×3 và form CRUD danh mục (#28–#31) — ưu tiên trung bình

- **Ở đâu:**
  - `app/pages/admin/content/categories/index.vue:44-86` ↔ `app/pages/admin/content/content-types.vue:30-74` (#29);
  - `content-types.vue:29-50` ↔ `app/pages/admin/media-portal/categories.vue:52-72` (#31);
  - phần form/nút cuối modal: #28 (`categories/index.vue:457-551` ↔ `content-types.vue:578-591`) và #30 (`content-types.vue:571-587` ↔ `media-portal/categories.vue:318-334`).
- **#28 là ảo giác phạm vi.** jscpd báo 95 dòng ở phía `categories`, nhưng phía `content-types` chỉ 14 dòng: phần khớp thật là nút Hủy/Lưu cuối modal, giống #30.
- **Lỗi đã biết trong bản chép.** Cả ba `slugifyLocal` thiếu dòng `.replace(/^-+|-+$/g, '')` của `slugify` trong `server/utils/slug.ts`. Đó đúng là bản chép thiếu cắt gạch treo (`-tin-nong-`) mà CLAUDE.md cấm.
  - Hậu quả hiện nay chỉ ở giao diện: ô slug nhận `tin-nong-` là hợp lệ. Máy chủ chạy lại `slugify` qua `unique*Slug()` nên slug lưu vẫn đúng.
  - `tests/slugify.test.ts` chỉ quét khai báo `function slugify`, nên bản chép dạng `const slugifyLocal = (…) =>` lọt qua.
- **Kế hoạch:** đưa `slugify` thuần sang `shared/` (`server/utils/slug.ts` re-export; các hàm `unique*Slug` ở lại máy chủ vì cần DB). Ba trang import nó. Mở rộng `tests/slugify.test.ts` để bắt cả bản chép dạng arrow.
- **Rủi ro:** `categories/index.vue` và `content-types.vue` tự làm sạch slug **mỗi lần gõ** (`watch(() => form.slug, …)` + `slugError`). `media-portal/categories.vue` chỉ sinh slug từ tên. Dùng thẳng bản cắt gạch treo trong watch thì cán bộ không gõ nổi dấu `-` ở cuối giữa chừng. Cần cắt lúc lưu/blur, hoặc tách bản "khi đang gõ" khỏi bản "khi lưu". Phần markup form/nút cuối modal thì để sau, giá trị thấp.

### T3 — `stripTags` + `headingLevel` của hai bộ chuyển HTML (#69) — ưu tiên cao, mang lỗi

- **Ở đâu:** `server/utils/html-to-docs.ts:76-96` ↔ `server/utils/html-to-markdown.ts:27-47`. Giống hệt nhau, và `html-to-docs.ts` tự nói nó "tái dùng pattern" của tệp kia.
- **Lỗi đi theo bản chép.**
  - Các dòng "giải mã" entity là no-op: `.replace(/&/g, '&')`, `.replace(/</g, '<')`… Mã nguồn không còn chữ `amp;` nào (`grep -c` = 0 ở cả hai tệp).
  - Sau đó `.replace(/&[a-z]+;/g, '')` **xoá** mọi entity có tên.
  - Đã chạy thật: `htmlToMarkdown('<h2>Phòng R&amp;D</h2><h3>Ng&agrave;y 1 &lt;tháng&gt;</h3>…')` cho ra `## Phòng RD` và `### Ngy 1 tháng`.
  - Ảnh hưởng: tiêu đề, mã nội dòng, khối mã khi xuất Markdown; ô bảng khi xuất Google Docs. Nội dung nhập từ CMS cũ chứa đúng loại entity này (`Ng&agrave;y`, theo CLAUDE.md).
- **Kế hoạch:** một hàm `htmlFragmentToText()` trong `server/utils/`, giải mã bằng `server/utils/decode-html-entities.ts` sau khi bỏ thẻ. Hai bộ chuyển cùng import.
- **Rủi ro:** thấp, nhưng là **đổi hành vi** (sửa lỗi), nên làm thành PR sửa lỗi có test đỏ-trước: `R&amp;D`, `Ng&agrave;y`, `&lt;`. `html-to-markdown.ts` chưa từng được nạp (0 %), `html-to-docs.ts` phủ 46 %.

### T4 — Ba handler lưu menu điều hướng (#60, #61) — ưu tiên trung bình–cao

- **Ở đâu:**
  - `server/api/admin/settings/navigation.put.ts:6-80` ↔ `settings/navigation/navbar.put.ts:6-81` (#60): 52 dòng mã khác nhau đúng tên khoá `nav_menu` / `nav_menu_navbar`;
  - `navigation.put.ts:50-80` ↔ `navigation/mobile.put.ts:62-92` (#61): đuôi `sanitizeMenu` + thân handler + transaction.
- **Vì sao đáng sửa:** bộ lọc liên kết (`assertSafeLink`, trần độ dài, trần số mục) là chốt an ninh và đang có hai bản, thêm một bản nửa chừng. `navigation.put.ts`/`navigation.get.ts` là đường cũ: không trang nào gọi, nhưng `navbar.get.ts` vẫn lùi về `nav_menu`.
- **Kế hoạch:** tách `sanitizeNavMenu` và phần "ghi một khoá settings + audit trong một tx" ra `server/utils/nav-menu-input.ts` (hoặc một service), ba route mỏng đi. Có bỏ cặp route cũ hay không là quyết định riêng.
- **Rủi ro:**
  - `tests/security-block-link-schemes.test.ts` chạy thật cả ba handler, nên giữ được hành vi.
  - `tests/reader-audit-atomicity.test.ts` và `tests/request-body-baseline.test.ts` liệt kê ba đường dẫn và soi văn bản: tx + `tx.insert(activityLogs)` + `readBody` phải còn nhìn thấy được ở đó, hoặc sửa danh sách cùng PR.
  - Ghi chú: hai bản menu ngang (`navigation.put.ts`, `navbar.put.ts`) dùng `Boolean(m.openNewTab)`, trong khi quy tắc của `nav-config.ts` phía client là `=== true`. `mobile.put.ts` không có trường này. Khi gộp nên chốt một quy tắc.

### T5 — Câu nạp tài khoản lúc đăng nhập (#54) — ưu tiên trung bình

- **Ở đâu:** `server/api/admin/auth/login.post.ts:95-110` ↔ `server/utils/mfa/session.ts:130-145`.
- **Chuyện gì:** `login.post.ts` viết lại nguyên văn câu truy vấn của `loadSessionUser(username)`. Hàm đó đã được export, và `auth/mfa/send-code.post.ts`, `auth/mfa/verify.post.ts` đang dùng. Thêm một cột (cờ mới của vai trò) ở một bên thì bước 1 và bước hoàn tất MFA đọc tài khoản khác nhau.
- **Kế hoạch:** `login.post.ts` gọi `loadSessionUser(username)`.
- **Rủi ro:** thấp. Các test chạy `login.post.ts` (`mfa-login-boundaries`, `cms-core-auth-media`, `logging`, `rate-limit-store`) có thể cần mock `mfa/session` thêm một export.

### T6 — Danh sách nhật ký admin (#43, #44, #45) — ưu tiên trung bình

- **Ở đâu:**
  - `server/api/admin/activity-logs/index.get.ts:24-44` ↔ `chatbot/sessions/index.get.ts:22-42` (#43): `parseDay` + hằng phân trang;
  - `activity-logs/index.get.ts:74-93` ↔ `chatbot/sessions/index.get.ts:49-71` (#44): kiểm `page`/`pageSize`, khoảng `from`/`to`;
  - `activity-logs/index.get.ts:146-163` ↔ `profile/history.get.ts:128-145` (#45): `readMeta` + ánh xạ hàng nhật ký.
- **Kế hoạch:** đưa `parseDay` vào `server/utils/vn-day-range.ts` (ví dụ `parseVnDayParam`), đưa bước kiểm phân trang chặt (400, không kẹp) thành helper cạnh `query-number.ts`, và ánh xạ hàng + `readMeta` thành một helper đọc nhật ký.
- **Rủi ro:** thấp. `tests/admin-activity-logs.test.ts`, `tests/chatbot-live-sessions.test.ts` và `tests/_admin-date-filters-probe.ts` chạm các route này. `profile/history.get.ts` là R1, chưa nạp, nên viết test trước (top 15 của 5.1).

### T7 — Xuất bài và bộ lọc danh sách bài (#52, #53) — ưu tiên trung bình

- **Ở đâu:**
  - `server/api/admin/articles/export-batch.get.ts:102-125` ↔ `articles/export-google.post.ts:48-72` (#52): chọn bài theo `ids`, lọc từng bài bằng `requireResourcePermission(…articleResource(type), 'read')`, 403 khi không còn bài nào;
  - `articles/export-csv.get.ts:53-69` ↔ `articles/index.get.ts:16-36` (#53): đọc các bộ lọc `search`/`type`/`status`/`categoryId`/`translation`/`authorId`.
- **Vì sao đáng sửa:** bộ lọc quyền theo bài nằm hai nơi. Bộ lọc danh sách nằm hai nơi, trong khi ý định là "xuất đúng cái đang thấy".
- **Kế hoạch:** `loadExportableArticles(actor, ids, columns)` và `parseArticleListFilters(query)` trong `server/services/articles.ts`.
- **Rủi ro:** trung bình. `export-batch.get.ts` và `export-google.post.ts` chưa nạp, cần test trước. `tests/article-export-csv-injection.test.ts` và `tests/article-export-google*.test.ts` đọc các tệp này.

### T8 — Mở đầu sửa bản dịch bài (#63, #64) — ưu tiên trung bình

- **Ở đâu:** `server/services/article-translations.ts:225-247` ↔ `:282-304` ↔ `:431-453`.
- **Chuyện gì:** cùng 23 dòng lặp ba lần: nạp bài (404) → kiểm quyền `update` theo loại bài → mở tx → nạp bản dịch (404).
- **Kế hoạch:** helper nội bộ `withEditableTranslation(actor, articleId, langCode, fn)`.
- **Rủi ro:** service chỉ phủ 23,8 %, nên viết test hành vi trước. Trong tệp có `db.transaction(`, và `tests/reader-audit-atomicity.test.ts` soát nó (`AUDITED_SERVICES`), nên giữ `tx.insert(activityLogs)` trong callback.

### T9 — Chat: widget và trang `/assistant` (#2–#5) — ưu tiên trung bình–thấp

- **Ở đâu:** `app/components/ChatWidget.vue` ↔ `app/pages/assistant.vue`:
  - `113-132` ↔ `152-171`: bong bóng tin nhắn;
  - `339-354` ↔ `327-342`: destructure `useChatbot()`;
  - `453-476` ↔ `387-405`: cuộn theo đáy;
  - `584-601` ↔ `443-459`: `askBot`, `retryMessage`.
- **Kế hoạch:** `ChatMessageBubble.vue` + composable `useChatSurface()` (ghim đáy, hỏi, gửi lại).
- **Rủi ro:** cao hơn cỡ của nó. Sáu test lặp qua **cả hai** bề mặt và soi văn bản từng tệp: `chatbot-follow-ups`, `chatbot-mobile-smoothness`, `chatbot-typing-playback`, `chatbot-slow-wait`, `form-a11y`, `public-qa-documents-page`. Tổng cộng 11 test đọc `ChatWidget.vue` và 8 test đọc `assistant.vue`. Phải trỏ lại các guard đó trong cùng PR.

### T10 — Trang danh sách bài công khai (#6–#9, #11–#14, #39, #40) — ưu tiên trung bình

- **Ở đâu:**
  - `app/components/ContentTypeListSection.vue` ↔ `app/pages/news/index.vue`: hero 171-187 ↔ 16-32 (#6); ô tìm 193-214 ↔ 38-59 (#7, #8 chồng lên #7); **pills danh mục + banner tìm + skeleton + lỗi + rỗng** 226-364 ↔ 76-235 (#9, 139 dòng — clone lớn nhất).
  - `ModelArticlesListPage.vue` ↔ `NewsCategoryList.vue` 135-150 ↔ 80-94 (khối lỗi, #11); ↔ `news/index.vue`: thẻ bài nổi bật 209-224 ↔ 270-285 (#12), phân trang 344-362 ↔ 413-432 (#13).
  - `NewsCategoryList.vue:195-212` ↔ `content-type/ContentTypeSidebar.vue:38-54`: danh sách "đọc nhiều" (#14).
  - `pages/legal-qa/index.vue` ↔ `pages/qa-documents.vue` 93-110 ↔ 122-139 (khối lỗi, #39); ↔ `pages/search.vue` 218-233 ↔ 268-283 (phân trang, #40).
- **Chuyện gì:** đầu `ContentTypeListSection.vue` ghi rõ nó lấy UI của `/news` làm mẫu. Từ đó hai bản sống song song (724 và 525 dòng).
- **Kế hoạch:** hai bước.
  1. Tách `PublicPagination.vue` và `MostReadList.vue`: nhỏ, nhiều nơi dùng.
  2. `news/index.vue` dùng lại `ContentTypeListSection` (`typeSlug="news"`), hoặc cả hai dùng một vỏ `ArticleListShell`.
- **Rủi ro:**
  - `tests/skeleton-loading-ui.test.ts` liệt kê các tệp này theo đường dẫn. Guard `motion-reduce` theo từng thẻ sẽ đi cùng markup, nhưng danh sách tệp phải sửa.
  - `public-keyboard-a11y`, `focus-ring-contrast`, `content-type-sidebar`, `model-article-variants` đọc mã nguồn.
  - Trang có SWR 60 s: so HTML SSR trước/sau.

### T11 — `loadActive()` của livestream (#10) — ưu tiên thấp–trung bình

- **Ở đâu:** `app/components/LiveHero.vue:191-225` ↔ `app/components/LiveTickerBar.vue:91-112`. 21 dòng mã giống hệt, chỉ chú thích khác.
- **Chuyện gì:** cùng lời gọi `/api/public/livestream/active` (`retry: 0`, `timeout: 4000`) và cùng phép kiểm "YouTube mà không có `embedUrl` thì coi như không phát". Sửa phép kiểm đó phải sửa hai nơi.
- **Kế hoạch:** hàm thuần `fetchActiveLivestream()` trong `app/utils/` (test được không cần mount) hoặc composable `useActiveLivestream()`.
- **Rủi ro:** `tests/live-status-polling.test.ts` đọc cả hai tệp (poller theo `visibilitychange`), cùng `no-server-side-timers`.

### T12 — `LayoutConfig` client ↔ server (#22) — ưu tiên thấp–trung bình

- **Ở đâu:** `app/composables/useLayoutConfig.ts:7-25` ↔ `server/services/layout-settings.ts:9-27`.
- **Chuyện gì:** kiểu, giá trị mặc định, tập giá trị hợp lệ và biên 320–1920 nằm hai nơi. Bên client có `parseConfig` dễ dãi, bên server có `validateLayoutConfig` chặt.
- **Kế hoạch:** kiểu + mặc định + tập giá trị + biên sang `shared/layout-config.ts` (tiền lệ `shared/settings-credential-rules.ts`). Giữ hai bộ đọc vì chúng cố ý khác: đọc thì dễ dãi, ghi thì chặt.
- **Rủi ro:** thấp. Cả hai tệp chưa nạp, nên thêm test nhỏ.

### T13–T24 — trùng nhỏ, ưu tiên thấp

| Nhóm | Ở đâu | Kế hoạch một dòng | Rủi ro |
|---|---|---|---|
| T13 `LANGUAGE_NAMES` (#49) | `server/api/admin/ai/translate-ui.post.ts:7-22` ↔ `ai/translate.post.ts:13-28` (bảng tên ngôn ngữ giống hệt) | `server/utils/ai/language-names.ts` | thấp |
| T14 `shortAgent()` (#16) | `app/components/admin/ProfileActivityHistory.vue:112-132` ↔ `app/pages/admin/users/activity.vue:189-208` | hàm thuần trong `app/utils/` + test đơn vị | thấp |
| T15 Cột sự kiện đơn (#68) | `server/services/submission-workflow.ts:72-90` ↔ `:365-381` | hằng `submissionEventColumns` dùng chung trong tệp | thấp; có suite `submission-workflow-integration` |
| T16 Upload Drive hai chế độ (#65) | `server/services/backup-drive.ts:170-190` ↔ `:202-213` | `uploadWithDriveClient(drive, …)` cho cả Service Account lẫn OAuth | service chưa nạp, cần test trước |
| T17 Mô tả tệp local (#67) | `server/services/media-portal-stream.ts:170-189` ↔ `:269-289` | `localPassthrough(filePath)` | thấp; `media-processing`/`service-split-boundaries` đọc tệp |
| T18 `unique*Slug` (#70) | `server/utils/slug.ts:36-52` ↔ `:61-83`, cùng khuôn với `uniqueContentTypeSlug` (chú thích trong tệp tự nhận "cùng khuôn") | một hàm chung nhận cột slug | kiểu Drizzle giữa các bảng; `media-unique-slug`, `slugify` test |
| T19 Ô ảnh (#15) | `app/components/admin/MediaLibraryModal.vue:219-246` ↔ `:259-285` (thư viện và vừa tải lên, khác một lớp viền) | component con `MediaPickerTile` | thấp; ba test đọc tệp nhưng không ghim ô ảnh |
| T20 Skeleton tài liệu (#18, #19) | `app/components/admin/docs/skeletons/SkeletonAdminArticleEdit.vue:18-36` ↔ `SkeletonAdminArticlesList.vue`, `SkeletonAdminDashboard.vue` cùng dòng | `SkeletonAdminSidebar.vue` | thấp |
| T21 Kiểu chi tiết bài (#1) | `app/components/ArticleDetail.vue:399-422` ↔ `app/pages/in-bai/[slug].vue:119-143` | đưa `ArticleDetailResponse` vào `app/utils/public-types.ts` (tệp có sẵn cho đúng việc này) | thấp |
| T22 Kiểu `Comment` (#26) | `app/pages/admin/comments/index.vue:4-28` ↔ `app/pages/admin/readers/[id].vue:4-28` | đưa vào `~/types/admin-api` | thấp. Docblock hai tệp **khác** nhau; jscpd bỏ chú thích nên tưởng khớp 25 dòng |
| T23 Tải lại sau SWR (#20, #21, #23, #24) | `app/components/blocks/DocumentsBlock.vue:152-177` ↔ `NewsBlock.vue:110-135`, `ReintegrationBlock.vue:84-109`; `app/pages/about.vue:45-70` ↔ `contact.vue:45-70`, `index.vue:49-74` | composable `usePublicBlockArticles(type)` và `useBuilderPage(slug)` | guard soi văn bản **từng tệp**: `public-block-load-error-ui` đòi mẫu `onMounted(… void refresh())` trong mỗi tệp, `ssr-failure-response` đòi `useSsrFailureStatus(() => <tên>Async…)`. Phải chuyển guard sang test hành vi cùng PR (vùng của D-TESTS, task 7.2) |
| T24 Cột chọn đơn (#62) | `server/api/admin/submissions/[id]/index.get.ts:32-53` ↔ `submissions/index.get.ts:54-75` (cùng danh sách cột + `leftJoin(users)`) | hằng `submissionColumns` dùng chung | thấp |

---

## Nhóm có chủ đích

| Nhóm | Ở đâu | Vì sao giữ |
|---|---|---|
| C1 Hai đường init TinyMCE (#17) | `app/components/admin/TinyMceEditor.vue:28-43` ↔ `app/pages/admin/content/articles/[id].vue:386-401` | CLAUDE.md gọi tên hai đường init (component cho PageBuilder/bản dịch, inline cho trang bài). Phần chép là bộ nạp script tự host; giữ hai đường là quyết định đã ghi. |
| C2 Khối tải/lỗi/thử lại trang admin (#25, #27, #32, #33, #35–#38) | `admin/comments/index.vue` ↔ `admin/readers/index.vue`; `content/categories/index.vue` ↔ `media-portal/categories.vue`; `navigation/mobile.vue` ↔ `navbar.vue`; `settings/{data-retention,media-portal,email,general,media-storage,tracking}.vue` | `tests/admin-error-retry-ui.test.ts` ghim trong **từng tệp**: ref lỗi, nhánh `v-else-if`, `role="alert"`, và hàm thử lại **khai báo trong chính tệp đó**. `tests/skeleton-loading-ui.test.ts` ghim skeleton theo view. Tách ra component chung thì guard đỏ — loại (b) "guarded exception" của CLAUDE.md. #32 có thêm hai nút "Khôi phục mặc định/Lưu" ở đầu trang: nhỏ, không đáng tách riêng. |
| C3 Tìm tài liệu ↔ retrieval chatbot (#41) | `app/utils/docs/search.ts:15-30` ↔ `server/utils/chatbot/retrieval.ts:33-46` | Đầu `docs/search.ts` ghi rõ: ba hàm chuỗi thuần được **chép, không import**, vì `retrieval.ts` kéo kiểu Drizzle/DB vào bundle client; "khi có nơi dùng thứ ba thì tách ra shared". Chưa có nơi thứ ba. |
| C4 `app_state()` hai script khôi phục (#42) | `scripts/restore-db.sh:149-164` ↔ `scripts/restore-media.sh:146-161` | Script vận hành chạy độc lập trên VPS, `scripts/` không có thư viện `source` chung. Chữ ký `fail` của hai script đã khác nhau (`fail precondition '…' 2` và `fail '…' 2`). `ops-restore-hardening`/`ops-scripts-sandbox` chạy từng script nguyên trạng. |
| C5 Cấp lại phiên sau đổi MFA (#58) | `server/api/admin/profile/mfa/confirm.post.ts:142-160` ↔ `profile/mfa/recovery-codes.post.ts:41-57` | Hai tệp là ngoại lệ có tên trong CLAUDE.md và `tests/reader-audit-atomicity.test.ts`: cố ý không bọc tx vì `setSessionCookie()` nằm giữa hai lượt ghi. Gom `revokeSessions` + `setSessionCookie` + audit thành helper sẽ dời đúng thứ guard đang soi ra khỏi hai tệp được nêu tên. |
| C6 Khoá đọc ↔ ghi settings (#59) | `server/api/admin/settings/index.get.ts:25-47` (`SETTINGS_READ_KEYS`) ↔ `settings/index.put.ts:18-42` (`ALLOWED_SETTING_KEYS`) | Danh sách đọc và danh sách ghi, hiện giống hệt nhau. `tests/admin-settings-get-masking-behavior.test.ts` phân tích `ALLOWED_SETTING_KEYS` từ mã nguồn và đòi hai tập bằng nhau, nên trôi lệch đã bị chặn. Gộp được, nhưng phải sửa guard cùng lúc. |
| C7 Cột media admin ↔ công khai (#66) | `server/services/media-portal-admin-read.ts:42-61` ↔ `media-portal-public.ts:31-55` | Hai allowlist cột riêng. Dựng chung một "cột cơ sở" thì một lần thêm cột cho admin (`storagePath`, `processingError`, `status`) có thể lọt ra đường công khai. |
| C8 Tra bài theo phạm vi quyền (#50) | `server/api/admin/articles/[id]/boost.post.ts:19-34` ↔ `[id]/stats.get.ts:16-31` | Khác nhau đúng chữ `articleActionScope(actor, 'update')` / `'read'`. Mỗi route tự nêu thao tác của mình để id ngoài phạm vi trả 404 như id không tồn tại (`tests/article-id-oracle-behavior.test.ts`). |
| C9 Kiểm thân request cấu hình OAuth (#55) | `server/api/admin/backup/drive/config.put.ts:19-36` ↔ `settings/google-oauth/index.patch.ts:15-31` | Hai cấu hình cố ý tách: Drive của backup và đăng nhập người đọc (`backup-drive-oauth-config.ts`: "hoàn toàn tách biệt"). Danh sách trường khác (`defaultCommentsEnabled`), backup thêm `requireSuperAdmin`. Phần giống chỉ là sáu dòng "thân phải là object, không có trường lạ". |
| C10 `ScanJobStatus` phản chiếu (#34) | `app/pages/admin/media/scan.vue:20-39` ↔ `server/services/media-scan.ts:55-81` | Quy ước của dự án: khai báo phản chiếu kiểu response ở trang thay vì ép kiểu. Có rủi ro trôi lệch; nếu muốn bỏ thì chỗ đúng là `shared/`. |

## Dương tính giả

| Nhóm | Ở đâu | Vì sao |
|---|---|---|
| G1 Khung đầu handler (#46, #47, #48, #51, #56, #57) | `ai/pricing/[model].delete.ts` ↔ `[model].put.ts`; `ai/pricing/bulk-delete.post.ts` ↔ `index.post.ts`; `ai/providers/[id].put.ts` ↔ `ai/services/[id].put.ts`; `articles/[id]/translations/[lang].get.ts` ↔ `[lang]/progress.get.ts`; `languages/ai-translate-chunk.post.ts` ↔ `ai-translate-key.post.ts`; `pages/[id]/blocks/[blockId].delete.ts` ↔ `[blockId].put.ts` | Giống nhau ở import, `requireResourcePermission(adminUser, …)`, đọc id/thân, các câu 400. Đó là khung bắt buộc của mọi route; mỗi route nêu resource/action của riêng nó. Phần logic sau khung khác nhau. #51 còn có lời gọi `requireReadableArticle` mà `tests/article-translation-read-scope-behavior.test.ts` đòi ở **mỗi** route đọc. |

---

## Chú thích bị chép (rà tay, chỉ trong lúc xem các cặp)

Chế độ `mild` bỏ qua chú thích, nên jscpd không đếm những khối này. Ghi lại để quyết riêng; không khối nào là lỗi:

- **"Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào. Viết rời, câu audit có cách hỏng riêng…"** (~7 dòng) chép nguyên văn trong **16** handler admin, cộng **5** biến thể tiếng Anh ("commit together, or neither does"). Nội dung là quy tắc đã có ở CLAUDE.md, mục *Đường ghi audit*. Có thể rút thành một dòng trỏ về đó.
- **"`error.value` lúc mount = lượt SSR hỏng … bộ đệm SWR 60 giây"** ở 7 tệp công khai (`about.vue`, `contact.vue`, `index.vue`, `[slug].vue` và ba khối `DocumentsBlock`/`NewsBlock`/`ReintegrationBlock`). "API trả 503 khi CSDL hỏng…" ở 4 khối. Đi cùng nhóm T23.
- **Docblock `parseDay`** ("Rejects rather than clamping…") ở 3 handler: `activity-logs/index.get.ts`, `chatbot/sessions/index.get.ts`, `profile/history.get.ts`. Sẽ đi theo T6 khi hàm dời về `vn-day-range.ts`.
- **"Writes activity_logs (with)in the same transaction"** ở 8 handler AI. Ngắn, mô tả đúng từng tệp, không cần làm gì.

---

## Việc tiếp theo

Một dòng cho mỗi nhóm trùng **thật**, xếp theo ưu tiên. File này không mở việc nào.

1. ~~**T1 (cao):** `server/utils/smtp-test-config.ts` re-export luật SMTP từ `shared/settings-credential-rules.ts` thay vì giữ bản chép (cổng cho phép, đích SMTP, dấu che).~~ **Đã xong** (nhánh `wave3/fix-striptags-slugify`): import + re-export, `isTruthy` export từ `shared/`; guard trong `tests/settings-credential-rules.test.ts`.
2. ~~**T3 (cao, sửa lỗi):** một helper `htmlFragmentToText()` dùng `decode-html-entities.ts` cho `html-to-markdown.ts` và `html-to-docs.ts`; test đỏ-trước với `R&amp;D`, `Ng&agrave;y`, `&lt;`.~~ **Đã xong** (nhánh `wave3/fix-striptags-slugify`): `server/utils/html-fragment-text.ts` (+ `headingLevel`), escape theo định dạng ra; `tests/html-export-entities.test.ts`.
3. **T4 (trung bình–cao):** tách bộ lọc menu + "ghi một khoá settings + audit" dùng chung cho `navigation.put.ts`, `navigation/navbar.put.ts`, `navigation/mobile.put.ts`; quyết riêng việc bỏ cặp route `navigation.{get,put}.ts` cũ; chốt `=== true` cho `openNewTab`.
4. ~~**T2 (trung bình):** đưa `slugify` thuần sang `shared/`, ba trang admin bỏ `slugifyLocal` (cắt gạch treo lúc lưu/blur, không lúc gõ), mở rộng `tests/slugify.test.ts` bắt bản chép dạng arrow.~~ **Đã xong phần `slugify`** (nhánh `wave3/fix-striptags-slugify`): `shared/slugify.ts` (`slugify` + `slugifyDraft`), `tests/admin-slug-input.test.ts`. Phần markup form/nút cuối modal (#28, #30) vẫn để sau.
5. **T5 (trung bình):** `auth/login.post.ts` gọi `loadSessionUser()` thay vì câu truy vấn chép.
6. **T6 (trung bình):** `parseDay` → `vn-day-range.ts`, helper phân trang chặt, helper ánh xạ hàng nhật ký cho `activity-logs`, `chatbot/sessions`, `profile/history`.
7. **T7 (trung bình):** `loadExportableArticles()` + `parseArticleListFilters()` trong `services/articles.ts` cho bốn route xuất/danh sách.
8. **T8 (trung bình):** helper `withEditableTranslation()` trong `article-translations.ts`, sau khi có test hành vi.
9. **T10 (trung bình):** `PublicPagination.vue` + `MostReadList.vue`, rồi cho `news/index.vue` dùng lại `ContentTypeListSection`.
10. **T9 (trung bình–thấp):** `ChatMessageBubble.vue` + `useChatSurface()` cho `ChatWidget.vue` và `assistant.vue`, trỏ lại sáu guard lặp hai bề mặt.
11. **T11 (thấp–trung bình):** `fetchActiveLivestream()` dùng chung cho `LiveHero.vue` và `LiveTickerBar.vue`.
12. **T12 (thấp–trung bình):** `shared/layout-config.ts` cho kiểu, mặc định, tập giá trị và biên của cấu hình layout.
13. **T23 (thấp):** `usePublicBlockArticles()` + `useBuilderPage()`, kèm chuyển guard soi văn bản từng tệp sang test hành vi (gắn với 7.2).
14. **T13 (thấp):** `server/utils/ai/language-names.ts` cho hai route dịch AI.
15. **T14 (thấp):** `shortAgent()` vào `app/utils/` + test.
16. **T15 (thấp):** hằng cột sự kiện dùng chung trong `submission-workflow.ts`.
17. **T16 (thấp):** `uploadWithDriveClient()` trong `backup-drive.ts`, sau khi có test.
18. **T17 (thấp):** `localPassthrough()` trong `media-portal-stream.ts`.
19. **T18 (thấp):** gộp ba hàm `unique*Slug` trong `slug.ts`.
20. **T19 (thấp):** component con `MediaPickerTile` trong `MediaLibraryModal.vue`.
21. **T20 (thấp):** `SkeletonAdminSidebar.vue` cho ba skeleton tài liệu admin.
22. **T21 (thấp):** `ArticleDetailResponse` vào `app/utils/public-types.ts`.
23. **T22 (thấp):** kiểu `Comment` admin vào `~/types/admin-api`.
24. **T24 (thấp):** hằng cột chọn đơn đăng ký dùng chung cho hai route đọc đơn.
