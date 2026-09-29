# Proposal: Chuẩn hóa Widget Mạng Xã Hội, Chatbot Auto-Scroll và Tối ưu Responsive Mobile

## Why

1. **Widget Mạng xã hội (SocialBubble)**:
   - Trước đây widget MXH dùng các hiệu ứng tự chế (lắc lư, nhấp nhô, vệt sáng kim loại, ping spans) gây rối mắt và không khớp nhận diện Cổng thông tin C11.
   - Nút launcher bị méo thành hình elip dẹt do class `.zalo-pulse-btn` (`border-radius: 50%`) áp dụng lên thẻ viên nang.
   - Ở chế độ Bảng nổi (Popup), danh sách 6 kênh không bị giới hạn chiều cao, khiến card bung nở đến 667px và đẩy mất thanh tiêu đề xanh cùng nút đóng `✕` lên trên trần màn hình điện thoại.
   - Cấu hình hiển thị MXH bị đặt phân tán tại `/admin/settings/general` thay vì nằm tập trung ở `/admin/settings/social-links`.
   - Preset Zalo trong trang quản trị bị gán cứng FontAwesome `fa-solid fa-message` thay vì file SVG chính thức `/assets/social/zalo.svg`.

2. **Chatbot Auto-Scroll**:
   - Khi người dùng gửi câu hỏi, khung chat không tự động cuộn xuống dưới, khiến câu hỏi vừa gửi và biểu tượng 3 chấm suy nghĩ (typing indicator) bị che khuất dưới nếp gấp màn hình.
   - Hàm `scrollChatBottom` đo chiều cao `scrollHeight` trước khi `await nextTick()`, dẫn đến việc đo đạc trên DOM cũ.

3. **Tràn trang ngang & Bố cục Tablet/Admin**:
   - Trang `/admin/analytics` bị tràn trang ngang 352px trên mobile do container biểu đồ 700px và bảng dữ liệu trợ năng `div.sr-only`.
   - Dashboard admin tràn 300px do thẻ SVG không có `min-w-0 max-w-full`.
   - Danh sách bài viết trên tablet bị cắt cụt tiêu đề còn 1 dòng.

4. **Media Self-Heal**:
   - Tự động vá và phục hồi các liên kết ảnh Cloudflare R2 bị thiếu object (HeadObject 404).

## What Changes

- **Widget MXH (`SocialBubble.client.vue`)**:
  - Áp dụng hiệu ứng sóng tỏa thuần CSS `@keyframes zalo-pulse` (box-shadow 0→15px êm dịu) theo chuẩn `tpoint.minhhieu.shop`.
  - Chế độ Bảng nổi: Nút launcher dạng viên nang ngọc bích `rounded-full` chuẩn; thân danh sách giới hạn `max-h-[230px]` vừa khít 4 kênh đầu tiên, cuộn mượt mà để xem các kênh tiếp theo, card thu gọn còn 323px, bảo vệ 100% hiển thị thanh tiêu đề và nút đóng.
  - Chế độ Nút tròn rời: Mobile hiển thị viên nang hợp nhất `[ 🟢 Hỗ trợ 24/7 ( 💬 ) ]` 133x42px; PC mở mặc định 6 kênh và có nút `✕` thu gọn.
  - Sử dụng thống nhất file vector chính thức `/assets/social/zalo.svg`.
- **Trang Quản trị MXH (`admin/settings/social-links.vue`)**:
  - Chuyển khối cấu hình "Kiểu hiển thị mạng xã hội" từ `general.vue` sang `social-links.vue`, có nút lưu và xem trước.
  - Cập nhật preset Zalo sang định dạng SVG `/assets/social/zalo.svg`.
- **Chatbot (`ChatWidget.vue` & `assistant.vue`)**:
  - Đưa `await nextTick()` lên đầu hàm cuộn; bắt buộc cuộn đáy khi gửi tin; thêm 2 watcher theo dõi tin nhắn mới và trạng thái streaming.
- **Responsive & Admin**:
  - Triệt tiêu hoàn toàn tràn trang ngang trên `/admin/analytics` và `/admin`.
  - Tối ưu hiển thị 2 dòng tiêu đề bài viết trên tablet; thêm avatar và nút đăng xuất trên topbar mobile admin.
- **Media**:
  - Tích hợp công cụ check chéo và tự vá liên kết ảnh Cloudflare R2 (`server/services/media-self-heal.ts`).

## Capabilities

### New Capabilities
- `social-bubble-tpoint`: Widget mạng xã hội chuẩn sóng pulse tpoint, hỗ trợ 2 chế độ hiển thị linh hoạt (Popup 4 items scroll & Floating capsule), đáp ứng toàn diện mobile và desktop.
- `chatbot-auto-scroll`: Cơ chế tự động bám sát đáy khung chat khi gửi câu hỏi và streaming nội dung.
- `media-self-heal`: Công cụ tự động quét, đối chiếu và vá ảnh R2 từ nguồn local.

### Modified Capabilities
- `site-layout-config`: Cho phép quản trị viên điều chỉnh kiểu hiển thị mạng xã hội, độ rộng container và lưới bài viết.
- `admin-responsive`: Loại bỏ lỗi tràn ngang trên các trang thống kê và bảng điều khiển quản trị.
