# Design: Kiến Trúc Widget MXH, Chatbot Auto-Scroll & Responsive Mobile

## Quyết Định Kiến Trúc

### D1: Widget MXH — Chuẩn Sóng Pulse `tpoint.minhhieu.shop` & Giới Hạn 4 Mục Mobile
- **Hiệu ứng sóng tỏa**: Dùng thuần CSS `@keyframes zalo-pulse` trên thuộc tính `box-shadow` (0px → 15px với độ mờ dần 0.7 → 0), không chèn thêm thẻ DOM rườm rà.
- **Kích thước Mobile Popup**:
  - Thân danh sách cố định: `max-h-[230px]` (tương đương chính xác 4 mục: *Facebook, YouTube, Zalo, TikTok*).
  - Mục 5 (*Telegram*) và mục 6 (*Instagram*) nằm dưới nếp gấp, kích hoạt thanh cuộn mảnh màu xanh C11 (`social-scroll-list`).
  - Chiều cao toàn bộ card: 323px (cách mép trên màn hình điện thoại >200px an toàn).
  - Header và Footer giữ `shrink-0`, đảm bảo tiêu đề và nút đóng `✕` luôn hiển thị trọn vẹn 100%.
- **Chế độ Floating (Nút tròn rời)**:
  - Mobile: Hiển thị viên nang nổi hợp nhất (Unified Floating Capsule) `[ 🟢 Hỗ trợ 24/7 ( 💬 ) ]` kích thước `133px × 42px`, đặt tại `right-3.5 bottom-[calc(84px+env(safe-area-inset-bottom,0px))]`. Khi chạm mở bung 6 kênh kèm nút `[ ✕ Thu gọn ]`.
  - Desktop: Mặc định mở 6 kênh bên trái màn hình (`left-6 bottom-6`), có nút tròn `✕` ở dưới cùng danh sách để người dùng có thể thu gọn bất cứ lúc nào.

### D2: Hợp Nhất Cấu Hình MXH về `/admin/settings/social-links`
- Cắt bỏ khối "Hiển thị mạng xã hội" khỏi `/admin/settings/general.vue`.
- Đặt khối cấu hình này vào đầu trang `/admin/settings/social-links.vue`, tích hợp API `PUT /api/admin/settings/layout` độc lập để lưu và đồng bộ tức thì sang `useLayoutConfig()`.

### D3: Chuẩn Hóa Vector SVG Chính Thức Cho Zalo
- Cập nhật preset trong `admin/settings/social-links.vue` sang `icon: '/assets/social/zalo.svg'` và `iconType: 'svg'`.
- Trên widget công khai: Tải trực tiếp tệp `/assets/social/zalo.svg`, loại bỏ các chuỗi SVG nội suy thô ráp.

### D4: Cơ Chế Tự Động Cuộn Khung Chat (Chatbot Auto-Scroll)
- Đưa `await nextTick()` lên trước các phép tính toán vị trí để đảm bảo chiều cao DOM được đo đạc sau khi Vue cập nhật tin nhắn mới.
- Bắt buộc cuộn sát đáy (`force = true`) ngay khi người dùng nhấn gửi (`sendBotMessage` / `askBot`).
- Kích hoạt 2 watcher:
  - `watch(activeConversation.messages.length)`: Cuộn ngay khi có thêm tin nhắn.
  - `watch(isSubmitting)`: Cuộn ngay khi bot bắt đầu phản hồi/hiển thị trạng thái suy nghĩ.

### D5: Triệt Tiêu Tràn Trang Ngang (Horizontal Overflow)
- `AnalyticsLiveDashboard.client.vue`: Đặt `relative` cho container bọc biểu đồ 700px và `absolute left-0 top-0` cho bảng dữ liệu trợ năng `div.sr-only`, đưa `scrollWidth` trang thống kê trên mobile về đúng 375px (không còn tràn 352px).
- `app/pages/admin/index.vue`: Bổ sung `min-w-0 max-w-full overflow-hidden` cho các thẻ thống kê tổng quan và SVG biểu đồ.
