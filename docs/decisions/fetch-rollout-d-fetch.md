# D-FETCH: vì sao lô B (wave3 7.1) không dùng `useAdminList`

> Lô C (cuối tệp): 39 ép kiểu nữa, hai danh sách nữa dùng mã lượt thay `useAdminList`,
> `adminFetch` đọc thân lỗi JSON của yêu cầu tải tệp, và số còn lại cho lô D.

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
