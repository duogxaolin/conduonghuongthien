# D-FETCH: vì sao lô B (wave3 7.1) không dùng `useAdminList`

> Lô C (cuối tệp): 39 ép kiểu nữa, hai danh sách nữa dùng mã lượt thay `useAdminList`,
> `adminFetch` đọc thân lỗi JSON của yêu cầu tải tệp, và số còn lại cho lô D.
> Lô D (sau lô C): 25 ép kiểu nữa (148 → 123), hai danh sách phân loại dùng mã lượt, 12 lỗi
> tìm thấy, một hợp đồng máy chủ sửa (409), và số còn lại cho lô E.

Lô B bỏ 56 ép kiểu `$fetch` ở 7 tệp bằng `adminFetch<T>()` (kiểu suy từ handler qua
`Payload<…>`, `app/types/handler-payload.ts`), nhưng **không tệp nào** chuyển sang
`useAdminList` dù design D-FETCH ghi "content/articles/index.vue (… list state only)". Đây là
lý do, để lượt sau không chuyển nhầm rồi làm vỡ hành vi đã có test chốt.

## `useAdminList` giả định gì

`app/composables/useAdminList.ts` hợp với một danh sách phân trang, lọc, chỉ đọc:

- `items` là `shallowRef` **chỉ đọc** từ phía trang — composable thay cả mảng sau mỗi lượt tải;
- mỗi lượt (`reload`/`applyFilters`/`goToPage`) bật `loading` → trang hiện skeleton;
- không có lượt "tải lại thầm" (giữ hàng đang hiện, không bật `loading`);
- một lượt mới huỷ lượt cũ và chỉ lượt mới nhất được ghi (mã thế hệ).

## Từng tệp

| Tệp | Vì sao không dùng |
|---|---|
| `content/articles/index.vue` | Có **poll 2,5 s** khi dịch hàng loạt, mỗi nhịp làm mới bảng **thầm** — qua `useAdminList` mỗi nhịp sẽ bật `loading` và nháy skeleton. Hàng được **sửa tại chỗ** (cập nhật lạc quan `translatedLangs`, công tắc bình luận `art.commentsEnabled`) — trái với `items` chỉ đọc. Bộ chọn hàng loạt (`useBulkSelection`, `keepOnly`) bị `tests/admin-bulk-selection-ui.test.ts` ghim trong chính tệp. |
| `content/pages/[id].vue` | Trang chi tiết (trình dựng), không phải danh sách. |
| `admin/index.vue` | Bảng điều khiển: 4 ô thống kê + 4 lượt analytics, không phân trang. |
| `readers/[id].vue` | Trang chi tiết một người đọc. |
| `ArticleTranslationPanel.vue` | Thẻ theo ngôn ngữ, poll 2 s khi đang dịch, hàng lạc quan `translating` — không phân trang. |
| `users/index.vue` | Tải toàn bộ người dùng + vai trò cùng lúc, không phân trang. |
| `livestream/index.vue` | Một buổi phát + lịch sử chat của nó, không phải danh sách lọc. |

## Thay vào đó (danh sách bài viết)

Cái `useAdminList` giải quyết — lượt cũ về sau đè lượt mới — vẫn là lỗi thật ở danh sách bài
viết, nên được sửa tại chỗ: **mọi** lượt hỏi danh sách (tải theo bộ lọc/trang **và** làm mới
thầm) lấy một mã (`++listRequest`), chỉ lượt mới nhất được ghi; lượt thầm **không gửi** khi
đang tải (lượt tải đó mang hàng mới); mỗi lần ghi gọi `selection.keepOnly(visibleIds)`. Hai
đường dùng chung một hàm dựng truy vấn (`requestList`). Test FINDING:
`tests/admin-fetch-rollout-articles.test.ts` (đỏ trên `ea5b500` và `b061ecc`).

Bản sửa đầu (`ea30d85`) chỉ cấp mã cho lượt TẢI; kiểm chứng độc lập tìm ra ba lỗ còn lại
(hai lượt thầm đè nhau, lượt thầm gửi lúc đang tải còn hỏi trang cũ rồi làm trống bảng, lượt
thầm không thu hẹp lựa chọn) — đã đóng ở commit sau.

## Hướng gốc cho sau này

Để chuyển danh sách bài viết sang `useAdminList` mà không mất hành vi, composable cần thêm:

1. một kiểu **tải lại thầm** (`refresh({ silent: true })`): cùng mã thế hệ, không bật `loading`,
   bỏ qua khi một lượt thường đang chạy;
2. `items` **sửa được** từ trang (hoặc một API cập nhật một hàng), để cập nhật lạc quan và công
   tắc tại chỗ không phải thay cả mảng;
3. một móc "sau khi ghi" để trang gọi `selection.keepOnly(...)`.

Khi có ba thứ đó, `fetchArticles`/`fetchArticlesSilent`/`listRequest` trong trang là phần bỏ đi.

## Lô C (nhánh `wave3/7-1-fetch-casts-c`, base `9b4821a`)

Bỏ **39** ép kiểu (187 → 148 trong baseline), kiểu phản hồi suy từ handler qua `Payload<…>`:

| Nhóm | Tệp | Ép kiểu | Kiểu |
|---|---|---|---|
| Cài đặt | `settings/{email,tracking,media-storage,google-oauth,ip-bans,security,sitemap,data-retention}.vue` | 22 | `admin-settings-api.ts` (thêm) |
| Kho nội dung Chatbot | `chatbot/knowledge/index.vue`, `components/admin/ChatbotSmallTalkPanel.vue` | 11 | `admin-chatbot-api.ts` (mới) |
| Đăng nhập | `composables/useAdminAuth.ts`, `login.vue` ("Gửi mã") | 6 | `admin-auth-api.ts` (mới) |

**Hai danh sách thêm vào bảng "không dùng `useAdminList`"** — cùng lý do với danh sách bài viết:

| Tệp | Vì sao không dùng |
|---|---|
| `chatbot/knowledge/index.vue` | Công tắc "câu hỏi nhanh" **sửa hàng tại chỗ** (lạc quan, hoàn lại khi lỗi) — trái với `items` chỉ đọc; bộ chọn hàng loạt thu hẹp (`keepOnly`) sau mỗi lần ghi; `watch([topic, status, quick])` tải lại theo bộ lọc bị `tests/chatbot-knowledge-quick-question.test.ts` ghim (composable cố ý không có watcher). |
| `ChatbotSmallTalkPanel.vue` | Cùng bộ chọn hàng loạt + `keepOnly`; thao tác tải lại đúng trang hiện tại; nằm trong trang cha theo thẻ. |

Cả hai sửa đua tại chỗ đúng mẫu `listRequest`: mọi lượt tải lấy một mã, chỉ lượt mới nhất ghi
hàng/phân trang/lỗi/đang tải. Tám trang cài đặt không có danh sách phân trang (`ip-bans` tải cả
danh sách) nên không có gì để chuyển.

**`adminFetch` đọc thân lỗi JSON của yêu cầu không-JSON.** ofetch đọc thân phản hồi theo
`responseType` cả khi lỗi, nên một lượt tải tệp (`responseType: 'blob'`) bị từ chối bằng
`createError({ statusMessage })` có `data` là Blob chứa JSON — `errorMessage()` không đọc được, cán
bộ thấy câu dự phòng thay câu máy chủ ("Không thể tải tệp mẫu.", "Lỗi tải ZIP bài viết"). Nay
`adminFetch` đọc thân JSON đó vào `data` trước khi ném lại — cùng đối tượng `FetchError`, giữ
status/`cause`; thân không phải JSON (trang HTML của proxy) để nguyên
(`tests/admin-fetch-error-body.test.ts`).

**Ngoại lệ có tên: `GET /api/admin/auth/me`.** Handler dựng `user` từ `event.context.adminUser`,
mà h3 khai `any` (`H3EventContext extends Record<string, any>`); `Serialize` của Nitro **bỏ** mọi
khoá kiểu `any`, nên `Payload<typeof me>['user']` chỉ còn hai trường MFA — không `id`, `username`,
`permissions` (probe typecheck xác nhận). `AdminMeResponse` lấy kiểu từ `completeLogin` (cùng một đối
tượng, câu trả lời của đăng nhập); `tests/admin-auth-me-shape-behavior.test.ts` chốt hai câu trả
lời giống hệt từng trường. Gốc rễ là khai kiểu cho `event.context.adminUser` toàn máy chủ — ngoài
phạm vi D-FETCH.

**Lỗi tìm thấy (test FINDING đỏ trên `9b4821a`):** `GET /api/admin/settings/sitemap` không bao giờ
trả `updatedAt` (lọc `sitemap_xml` rồi tìm `sitemap_updated_at` trong chính kết quả) — "Lần lưu
cuối" mất mỗi lần tải lại; hai danh sách Chatbot không có lượt mới nhất; tải hỏng hiện cả lỗi lẫn
"Chưa có mục …"; "Xuất bản"/"Lưu trữ" mất mạng báo "Đã xảy ra lỗi." (nhánh `||` chết); "Tải file
mẫu" bị từ chối không hiện câu máy chủ (Blob, ở trên); sửa một mục trả lời thường nhật nhảy về
trang 1 (`closeEditor()` xoá `editing` trước khi đọc).

### Còn lại cho lô D

148 ép kiểu trong 76 tệp: 2 có tên trong `adminFetch.ts`; **90 phía quản trị trong 39 tệp**; 56
phía công khai trong 36 tệp (đợt khác — `ChatWidget`/`useChatbot`, `ArticleDetail`/`ArticleComments`
đang được tách). Phía quản trị nên làm trước: `content/categories/index.vue` (5) và
`content/content-types.vue` (5) — cùng miền, `tests/admin-slug-input.test.ts` đã nhận `adminFetch`;
`content/articles/[id].vue` (6), `SubmissionDetailModal.vue` (4), `languages/UniversalTab.vue` (4);
lượt đọc `/api/public/settings` ở `login.vue` (1, công khai — chọn cùng cách với phía công khai).
Số theo tệp: `tests/ratchets/fetch-casts.baseline.json`.

## Lô D (nhánh `wave3/7-1-fetch-casts-d`, base `fb4751c1`)

Bỏ **25** ép kiểu (148 → 123), kiểu phản hồi suy từ handler qua `Payload<…>`:

| Nhóm | Tệp | Ép kiểu | Kiểu |
|---|---|---|---|
| Phân loại | `content/categories/index.vue`, `content/content-types.vue` | 10 | `admin-taxonomy-api.ts` (mới) |
| Đơn đăng ký | `components/admin/SubmissionDetailModal.vue` | 4 | `admin-submissions-api.ts` (mới) |
| Ngôn ngữ | `components/admin/languages/UniversalTab.vue` | 4 | `admin-languages-api.ts` (mới) — thay hai kiểu viết tay |
| Bài viết | `content/articles/[id].vue` (chỉ gỡ ép kiểu, không tách, cấu hình TinyMCE giữ nguyên) | 6 | `admin-articles-api.ts` (thêm) |
| Đăng nhập | `login.vue` (lượt đọc `/api/public/settings`) | 1 | `admin-auth-api.ts` (thêm) |

**Hai danh sách thêm vào bảng "không dùng `useAdminList`"** — cùng mẫu mã lượt (`listRequest`):

| Tệp | Vì sao không dùng |
|---|---|
| `content/categories/index.vue` | Không phân trang: tải cả cây hai cấp, lọc `?type=` phía client; bộ chọn hàng loạt thu hẹp (`keepOnly`) sau mỗi lần ghi. |
| `content/content-types.vue` | Không phân trang; hai lượt tải độc lập (thể loại + danh mục cho cây xem trước), mỗi lượt một mã riêng. |

`/api/public/settings` ở trang đăng nhập đi qua `adminFetch<LoginPublicSettingsResponse>` — trang thuộc
phía quản trị, nên theo quy ước của phía quản trị; phía công khai (`default.vue`, `ArticleDetail`,
`in-bai`) chưa chọn cách. `layouts/admin.vue` đọc cùng endpoint nhưng **chưa** chuyển: chưa có test
hành vi mount được layout (767 dòng), và chuyển trước khi có test trái yêu cầu (1) của 7.1.

**Lỗi tìm thấy (test FINDING đỏ trên `fb4751c1`):**

- Danh mục + thể loại: tải lại cả danh sách sau mỗi lần ghi trong khi "Tạo … Mới" vẫn bấm được —
  lượt tải cũ về sau xoá hàng vừa tạo khỏi màn hình (cán bộ tạo lại → trùng, slug `-2`).
- Thể loại: đổi slug → máy chủ chuyển danh mục sang slug mới, trang chỉ tải lại thể loại → cây ghi
  "Chưa có danh mục nào" cho thể loại có danh mục. Nay tải lại cả hai.
- Thể loại: tải danh mục hỏng im lặng → mọi thể loại ghi "Chưa có danh mục nào". Nay
  `categoriesError` + `role="alert"` + "thử lại" (`admin-error-retry-ui` đã ghi tên).
- Chi tiết đơn: mở #12 (chậm), đóng, mở #13 — câu trả lời của #12 về sau hiện tên/nhật ký người dân
  A dưới "#13". Nay mỗi lượt tải một mã, đổi/đóng hồ sơ cấp mã mới.
- "Dịch toàn cục": thẻ thống kê bịa số ("108", "1121" trong template) khi chưa quét/quét hỏng, số 0
  thật đọc "Đang quét..."; vòng hỏi báo "đã hoàn tất" cả khi bị dừng hoặc hỏng; rời tab khi lượt đọc
  trạng thái còn bay để lại một vòng hỏi 2 s không gì dừng được.
- **Hợp đồng máy chủ:** `POST /api/admin/system/universal-translate` trả 200 `{ ok: false }` khi một
  lượt khác đang chạy, tab báo lời từ chối là thành công. Nay 409 + câu của dịch vụ
  (`tests/universal-translate-refusal-behavior.test.ts`); tab đọc lại trạng thái để hiện lượt đang chạy.
  Lượt huỷ (`…-cancel`) vẫn trả `{ ok: false }` khi không có gì chạy — tab hiện nó là thông tin.
- Trình soạn bài: "Thử lại" thành công nhưng dải lỗi còn; lỗi LƯU dùng chung dải với "Thử lại" (tải
  lại bài, mất chữ đang gõ) — nay `saveError` riêng, không nút tải lại; tải bài hỏng vẫn cho lưu
  biểu mẫu trống (PUT ghi đè bài thật, và xuất bản bài rỗng); đổi thể loại hai lần — danh mục của
  thể loại trước lấp ô "Danh mục". Nay một mã mỗi lượt.
- **Chặn ghi đè bài (sửa lại sau kiểm chứng độc lập, PROBE-A):** bản sửa đầu khoá lưu theo `errorMsg`,
  mà `fetchArticle` xoá `errorMsg` TRƯỚC khi chờ — nên khi "Thử lại" còn đang bay nút lưu bật lại và
  đúng PUT biểu mẫu trống đó vẫn đi (lượt tải ĐẦU cũng vậy: lúc chờ, nút đã bật). Nay khoá theo cờ
  dương `loaded`: bài mới luôn `true`; bài có id `false` từ đầu mỗi lượt tải (trước `await`) và chỉ
  `true` sau khi biểu mẫu đã điền xong từ câu trả lời. Hai lớp độc lập, mỗi lớp một test: nút
  "Cập Nhật Bài Viết" `:disabled="saving || !loaded"`, và `handleSave` tự trả về khi `!loaded` (một
  lượt bấm lọt qua nút vẫn không gửi PUT). Tóm lại: chỉ lưu được khi biểu mẫu đang giữ bài thật.
- "Dịch toàn cục" (cũng từ kiểm chứng độc lập): rời tab khi lượt hỏi của VÒNG HỎI (không chỉ lượt đọc
  lúc mở tab) còn bay mà trả "xong" — vẫn báo "hoàn tất" và gửi thêm hai GET. Nay callback kiểm
  `disposed` sau `await`.

**Hai lỗ test của lô C đã đóng:** `keepOnly` chạy thật ở kho kiến thức và kho trả lời thường nhật
(chọn hàng trang 1, sang trang 2 → thanh hàng loạt biến mất); `adminFetch` không đọc thân "giống JSON"
khai `text/plain` (đột biến bỏ phép kiểm content-type nay bị bắt); "Tải HTML zip" bị từ chối hiện câu
máy chủ ở mức trang. Sau kiểm chứng độc lập, mã lượt ở nhánh lỗi (`catch`/`finally`) của danh sách
thể loại, mã lượt danh mục của cây xem trước ("thử lại" rồi lưu: lượt cũ về sau, hoặc hỏng về sau)
và nhánh lỗi của chi tiết đơn (#12 hỏng về sau khi #13 đang tải) có test riêng.

Test: `tests/admin-fetch-rollout-{taxonomy,submission-detail,universal-translate,article-editor}.test.ts`,
`tests/universal-translate-refusal-behavior.test.ts`, thêm vào `admin-login-page-behavior`,
`admin-fetch-rollout-{chatbot-content,articles}`, `admin-fetch-error-body`.

### Còn lại cho lô E

123 ép kiểu trong 70 tệp: 2 có tên trong `adminFetch.ts`; **65 phía quản trị trong 33 tệp**; 56 phía
công khai trong 36 tệp. Phía quản trị còn nhiều nhất (3): `users/activity.vue`, `media/index.vue`,
`media-portal/index.vue`, `content/pages/index.vue`, `chatbot/knowledge/[id].vue`,
`articles/ArticleBoostStatsPanel.vue`, `articles/ArticleGlobalTranslateModal.vue`; cần cẩn thận:
`ai/AiServicesTab.vue` + `ai/*` (đang tách AiProvidersTab), `AnalyticsLiveDashboard.client.vue`
(script bị test trích bằng `Function()`), `useBulkSelection.ts` (harness biên dịch nó với danh sách tên
cố định, không có `adminFetch`), `layouts/admin.vue` (2, cần test mount layout trước). Danh sách đơn
đăng ký (`submissions/index.vue`, `$fetch` trần không ép kiểu) đọc mã nguồn thì tải lại theo bộ lọc
không có mã lượt — nghi đua như các danh sách trên, chưa có test chứng minh, chưa sửa ở lô này; `settings/backup.vue` → `useAdminList` và `roleId || 2`
chưa gặp trong phạm vi lô D.
