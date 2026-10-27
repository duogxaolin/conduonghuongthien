# D-FETCH: vì sao lô B (wave3 7.1) không dùng `useAdminList`

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
