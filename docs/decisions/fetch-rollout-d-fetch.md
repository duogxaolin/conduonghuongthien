# D-FETCH: vì sao lô B (wave3 7.1) không dùng `useAdminList`

> Lô C (cuối tệp): 39 ép kiểu nữa, hai danh sách nữa dùng mã lượt thay `useAdminList`,
> `adminFetch` đọc thân lỗi JSON của yêu cầu tải tệp, và số còn lại cho lô D.
> Lô D (sau lô C): 25 ép kiểu nữa (148 → 123), hai danh sách phân loại dùng mã lượt, 12 lỗi
> tìm thấy, một hợp đồng máy chủ sửa (409), và số còn lại cho lô E.
> Lô E (cuối tệp): 21 ép kiểu nữa (123 → 102) ở 7 tệp, ba danh sách nữa dùng mã lượt, 16 lỗi
> tìm thấy (24 test FINDING đỏ trên `88073004`), 25 đột biến, và số còn lại cho lô F; sau kiểm chứng
> độc lập: "Dịch toàn bộ" GIỮ trần 100 bài/ngôn ngữ + hỏi xác nhận, 3 hồi quy sửa, 17 đột biến mới.

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
*(Cập nhật 2026-10-29, lô tách admin layout: test mount nay có — `tests/admin-layout.test.ts`,
`ADMIN_LAYOUT_FILE=<tệp>` chạy cùng bộ test trên bản trước/sau; ép kiểu của "Xoá cache" dời sang
`useAdminLayoutCacheClear` thành `adminFetch<Payload<handler>>`; còn đúng 1 — lượt đọc `layout_config` này.)*

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
cố định, không có `adminFetch`), `layouts/admin.vue` (2, cần test mount layout trước — nay 1 và
test mount đã có, xem cập nhật ở trên). Danh sách đơn
đăng ký (`submissions/index.vue`, `$fetch` trần không ép kiểu) đọc mã nguồn thì tải lại theo bộ lọc
không có mã lượt — nghi đua như các danh sách trên, chưa có test chứng minh, chưa sửa ở lô này; `settings/backup.vue` → `useAdminList` và `roleId || 2`
chưa gặp trong phạm vi lô D.

## Lô E (nhánh `wave3/7-1-fetch-casts-e`, base `88073004`)

Bỏ **21** ép kiểu (123 → 102), kiểu phản hồi suy từ handler qua `Payload<…>`:

| Nhóm | Tệp | Ép kiểu | Kiểu |
|---|---|---|---|
| Nhật ký | `users/activity.vue` | 3 | `admin-users-api.ts` (thêm `AdminActivityLogsResponse`) — thay `LogItem` viết tay |
| Kho kiến thức | `chatbot/knowledge/[id].vue` | 3 | `admin-chatbot-api.ts` (thêm `AdminKnowledgeCreateResponse`) |
| Bài viết | `articles/ArticleBoostStatsPanel.vue`, `articles/ArticleGlobalTranslateModal.vue` | 6 | `admin-articles-api.ts` (thêm boost/huỷ boost) — thay `GlobalStats` viết tay |
| Trang | `content/pages/index.vue` | 3 | `admin-pages-api.ts` (thêm danh sách/tạo/xoá) |
| Thư viện ảnh | `media/index.vue` | 3 | `admin-media-api.ts` (mới) — thay `StorageSize` viết tay |
| Thư viện video | `media-portal/index.vue` | 3 | `admin-media-portal-api.ts` (thêm `MediaDeleteResponse`) |

Kiểu viết tay bị thay **lộ một lỗi**: `LogItem.createdAt: string`, handler nói `string | null` —
`new Date(null)` là ngày 1/1/1970 hợp lệ, nên hàng không có thời điểm in ra năm 1970.

**Ba danh sách thêm vào bảng "không dùng `useAdminList`"** — cùng mẫu mã lượt (`listRequest`):

| Tệp | Vì sao không dùng |
|---|---|
| `users/activity.vue` | Hợp với `useAdminList` về hình dạng (phân trang, lọc, chỉ đọc), nhưng `tests/admin-activity-logs.test.ts` ghim năm ref `filterX` và dạng `{ to: filterTo.value }` trong mã nguồn — chuyển là viết lại guard đó. Ứng viên đầu tiên khi guard được chuyển sang test hành vi. |
| `media/index.vue` | Bộ chọn hàng loạt thu hẹp (`keepOnly`) sau mỗi lần ghi, như thể loại/danh mục; tệp ở đúng trần 456 dòng. Hỏi lại trang cuối (một lần) viết tại chỗ theo quy tắc của `useAdminList`. |
| `media-portal/index.vue` | Bộ lọc và trang sống trong URL (`router.replace`), `useAdminList` không ghi URL; `admin-media-portal-ui.test.ts` ghim `loadError`/`fetchMedia`/`items.length === 0`. Hỏi lại trang cuối viết tại chỗ. |

**Lỗi tìm thấy (test FINDING đỏ trên `88073004`, bằng chứng chạy trên tệp gốc trong thư mục proof):**

- Nhật ký: tải hỏng hiện cả cảnh báo lẫn "Không có bản ghi nào khớp điều kiện lọc." (cảnh báo nằm
  ngoài chuỗi tải/lỗi/rỗng); không có lượt mới nhất — lọc theo tài khoản rồi "Xoá lọc", câu trả lời cũ
  về sau hiện nhật ký một người dưới bộ lọc đã xoá (cả nhánh lỗi và `finally`); hàng không có thời
  điểm in 1/1/1970.
- Kho kiến thức: "Xuất bản"/"Lưu trữ" mất mạng báo "Đã xảy ra lỗi." — nhánh `|| (…)` chết, đúng
  lỗi lô C tìm ở trang danh sách; lỗi LƯU/xuất bản/kiểm bắt buộc dùng chung dải "thử lại" của lượt
  tải — bấm vào tải lại mục, đè chữ đang gõ (nay `actionError` riêng, không nút tải lại); tải mục hỏng
  vẫn hiện biểu mẫu trống lưu được, "Xuất bản" theo trạng thái mặc định `draft` — PUT đè mục thật
  (nay cờ dương `loaded`, như trình soạn bài lô D; biểu mẫu chỉ hiện khi đang giữ mục).
- Thống kê lượt xem: mở Bài 3 (chậm), đóng, mở Bài 4 — số liệu và lượt tăng dần của Bài 3 hiện dưới
  tên Bài 4 (cả nhánh lỗi và `finally`).
- "Dịch toàn bộ": chỉ đọc trang đầu 100 bài thiếu (trần của endpoint danh sách) mà vẫn báo xong khi
  màn hình ghi "Thiếu 120 bài" — bản đầu của lô E đọc mọi trang; **sau kiểm chứng độc lập, trần 100
  bài/ngôn ngữ mỗi lượt bấm được GIỮ** (xem "Sửa sau kiểm chứng độc lập" bên dưới) và thông báo nói
  thật "en: 100/120 … bấm lại"; ngôn ngữ sau hỏng thì báo "không thể bắt đầu" dù ngôn ngữ trước đã xếp, không emit
  `started` (trang không theo dõi, bấm lại xếp trùng) — nay báo số đã xếp và emit; mở lại sau lượt đọc
  thống kê hỏng hiện số của lần mở trước với nút "Bắt đầu" bật.
- Thư viện ảnh: không có lượt mới nhất (tìm rồi lọc video — kết quả tìm hiện dưới bộ lọc video); xoá ô
  cuối của trang cuối hiện "Chưa có file nào. Hãy tải lên file đầu tiên!".
- Thư viện video: danh sách và cấu hình tải lên chung một `Promise.all` — cấu hình hỏng thay danh sách
  đã tải bằng "Không tải được danh sách video." (và cấu hình đọc lại mỗi lần lọc/sang trang; nay đọc
  một lần, riêng); nút trang không ghi trang vào URL dù tài liệu của trang hứa "sống qua F5"; không có
  lượt mới nhất; xoá video cuối của trang cuối hiện "Chưa có video nào" mà nút trang nằm trong nhánh dữ
  liệu nên kẹt (dịch vụ không kẹp trang).
- Danh sách trang (`content/pages/index.vue`): không có lỗi — lượt tải là nơi ghi hàng duy nhất, mọi
  thao tác tải lại đều ẩn danh sách trong lúc chờ.

**Đột biến: 25/25 bị bắt** (mỗi cái làm ≥ 1 test đỏ, hoàn nguyên bằng `git checkout --`): bỏ kiểm mã
lượt ở `try`/`catch`/`finally` của nhật ký, panel thống kê, thư viện ảnh, thư viện video (12); khôi
phục nhánh `||` chết (1); `v-else-if="loaded"` → `v-else` (1); "thử lại" cho cả lỗi thao tác (1); đọc
một trang (1); bỏ `emit('started')` khi hỏng giữa chừng (1); bỏ xoá số cũ khi mở lại (1); tắt hỏi lại
trang cuối ở hai thư viện (2); bỏ `syncQuery()` của nút trang (1); cấu hình hỏng ghi `loadError` (1);
bỏ chặn `null` của `formatWhen` (1); bỏ `trim()` tiêu đề trang mới (1); bỏ `keepOnly` của danh sách
trang (1). Nhật ký từng vòng: `mutations/r1…r6.*` trong thư mục proof.

Không thuộc họ component nào của `tests/_component-family.ts` (không tệp nào đã tách). DOM trạng thái
BÌNH THƯỜNG của cả 7 tệp giống hệt trước/sau (mount thật, `html()`; panel/modal so ở trạng thái đang
mở), trừ một placeholder `<!--v-if-->` của nhật ký (khối lỗi rời nay nằm trong chuỗi). Mọi bản sửa
FINDING ở trên CỐ Ý đổi trạng thái lỗi/đua của nó: nhật ký lỗi không còn trạng thái rỗng (đã chụp
DOM); trình soạn kiến thức tải hỏng không còn biểu mẫu, lỗi thao tác không còn "thử lại"; modal mở
lại sau lỗi không còn số cũ; thư viện video giữ danh sách khi cấu hình hỏng; hai thư viện hiện trang
cuối thay vì trạng thái rỗng — mỗi thay đổi có test FINDING của nó, không chụp DOM riêng.
E2E: `tests/e2e/media-portal.spec.ts` (spec duy nhất đi qua một trang của lô này) 5/5 trên bản build
lô E; các trang còn lại không có spec E2E.

### Sửa sau kiểm chứng độc lập (verify "Đạt kèm sửa", bằng chứng `cdht-wave3-fetch-e-verify/`)

**Quyết định chi phí "Dịch toàn bộ" (HIGH).** Bản đầu đọc mọi trang: trên CSDL tạm 1.123 bài × 5 ngôn
ngữ, một lượt bấm xếp 5.615 bản dịch AI (base 500), không hỏi. Ngân sách AI hằng tháng (`checkBudget`)
chỉ chặn khi đã đặt — 0 là không giới hạn. Quyết định (thiên về an toàn chi phí): **giữ trần 100 bài/ngôn
ngữ mỗi lượt bấm như base** (`PER_CLICK`, không phân trang), và:
- hỏi trước (`useConfirm`, `ConfirmModal` đè lên `AdminModal` như `ScanThumbnailsModal` đã làm): "Xếp lịch
  dịch tối đa X bài sang Y ngôn ngữ (en: 100/120, …)? Mỗi bài là các lượt gọi AI có tính phí…" — số lấy
  từ thống kê đang hiện (cận trên); từ chối thì không đọc danh sách, không gửi gì;
- còn bài thì báo "Đã xếp … (en: 100/120). Còn bài chưa xếp — bấm lại sau khi lượt dịch đang chạy xong để
  xếp tiếp", không báo xong; vẫn emit `started`; hai sửa còn lại của hộp (báo phần đã xếp khi hỏng giữa
  chừng, không số cũ khi mở lại) giữ nguyên;
- rời trang thì dừng vòng lặp (`disposed` sau mỗi `await`) — không POST cho trang đã rời.
"Bấm lại" xếp bài KẾ vì bài đã dịch có hàng dịch và rời bộ lọc `missing_xx`; nhưng hàng chỉ được tạo khi
worker xử lý tới bài đó (tuần tự), nên bấm lại khi lượt trước CÒN CHẠY sẽ liệt kê lại các bài chưa tới
lượt — thông báo vì thế nói "sau khi lượt dịch đang chạy xong" (gốc ở máy chủ, xem việc còn mở).

**Các sửa khác:**
- Thư viện video (MEDIUM, hồi quy của lô E): câu trả lời muộn sau khi rời trang gọi `syncQuery()` → URL
  của trang KẾ thành `…?page=2`, rồi tải thêm. Nay `onBeforeUnmount` cấp mã mới + chặn lượt mới
  (`disposed`); lượt xoá trả về sau khi rời trang không tải lại. Thư viện ảnh cùng mẫu (chỉ `disposed`:
  mọi lượt tiếp đều qua `fetchMedia`).
- Trình soạn kiến thức (hồi quy): lưu/xuất bản thành công mà lượt đọc lại hỏng thì biểu mẫu biến mất. Nay
  lượt đọc ĐẦU điền biểu mẫu (hỏng thì không có biểu mẫu); khi biểu mẫu đã giữ mục, lượt đọc (đọc lại sau
  ghi, hoặc "thử lại" của nó) chỉ làm mới trạng thái — không thay chữ đang gõ; xuất bản/lưu trữ lấy trạng
  thái từ câu trả lời của chính nó.
- Thư viện video (hồi quy): cấu hình tải lên hỏng thoáng qua ẩn "Tải video lên" tới F5 — nay đọc lại cùng
  lượt tải kế khi còn thiếu (đã có thì không đọc lại).
- Ghim các đột biến sống của verifier: E07 (đọc lại sau ghi hỏng), E10/E11 (lỗi thao tác cũ được xoá khi
  lưu/xuất bản lại thành công), E26 (trang quá cuối hỏi trang 3/3, không trang 1), E29 (toast lỗi tải thư
  viện ảnh), E33 (lọc ở trang 2 hỏi trang 1). E20–E22 (phân trang "Dịch toàn bộ") hết đối tượng vì đã bỏ
  phân trang.

Test đỏ trước khi sửa (trên `07474e17`): 8 + 2 (xoá sau khi rời trang); **17/17 đột biến mới bị bắt**
(`mutations/v1…v5.*` trong thư mục proof). Không chụp DOM riêng: trạng thái bình thường không đổi, các
thay đổi là hộp xác nhận mới và trạng thái lỗi/đua, mỗi cái có test.

### Chưa sửa ở lô E (ngoài phạm vi phía khách quản trị — cần quyết định hoặc đợt máy chủ)

- `server/services/article-translation-bulk.ts`: "Dịch toàn bộ" nhiều ngôn ngữ gọi
  `bulkTriggerTranslation` một lần mỗi ngôn ngữ, các lượt chạy nền song song và cùng ghi một
  `bulkTaskState` — tiến độ của banner là của lượt nào ghi sau.
- **Cần quyết định — hàng `failed` không bao giờ được xếp lại:** `translation-stats.get.ts` đếm bản dịch
  `status != 'failed'` là đã dịch, còn bộ lọc `missing_xx` loại mọi bài có bất kỳ hàng dịch nào (kể cả
  `failed`) — bài dịch hỏng hiện "Thiếu" trong thống kê nhưng "Dịch toàn bộ" không bao giờ xếp lại nó (ghim
  bằng test KNOWN, không sửa máy chủ ở lô này).
- `article-translation-bulk.ts`: hàng dịch chỉ được tạo khi worker tới bài đó, và lượt chạy chỉ bỏ qua
  bài `translating`/`published` — bấm "Dịch toàn bộ" lại khi lượt trước còn chạy liệt kê lại các bài chưa
  tới lượt, và bài đã dịch xong ở trạng thái `ai_draft` bị dịch lần nữa (chi phí gấp đôi). Hộp chỉ dặn
  "bấm lại sau khi lượt đang chạy xong"; chặn tận gốc cần máy chủ (tạo hàng `translating` khi xếp, hoặc từ
  chối khi đang có lượt chạy như `universal-translate` lô D).
- `server/api/admin/media/index.get.ts`: tìm kiếm `like(%…%)` không thoát `%`/`_` (dịch vụ thư viện
  video đã dùng `likeContains`).
- Panel thống kê: "Huỷ lượt tăng" không có cờ đang gửi — bấm hai lần gửi hai DELETE, lần hai báo lỗi 404.
- Thư viện ảnh: "Thử lại" luôn tải trang 1, không phải trang vừa hỏng.

### Còn lại cho lô F

102 ép kiểu trong 63 tệp: 2 có tên trong `adminFetch.ts`; **44 phía quản trị trong 26 tệp**; 56 phía
công khai trong 36 tệp. Phía quản trị: `ai/AiServicesTab.vue` (3) + `ai/{AiDashboardTab,AiModerationTab}.vue`
(2), `ai/index.vue` (2), `analytics.vue` (2), `navigation/{mobile,navbar}.vue` (2+2), `users/roles.vue` (2),
`media-portal/external.vue` (2), `ContentTypePicker.vue`, `ProfileActivityHistory.vue`,
`ArticleQuickViewModal.vue`, `ScanThumbnailsModal.vue`, `useUpload.ts` (2 mỗi tệp), và mười tệp 1 ép kiểu.
Vẫn cần cẩn thận như lô D ghi: `AnalyticsLiveDashboard.client.vue` (3, `Function()`), `useBulkSelection.ts`
(harness tên cố định), `layouts/admin.vue` (nay 1 — lượt đọc `layout_config`; test mount đã có:
`tests/admin-layout.test.ts`, lô tách admin layout 2026-10-29). Danh sách đơn đăng ký
(đua nghi ngờ) và `settings/backup.vue` vẫn chưa đụng.
