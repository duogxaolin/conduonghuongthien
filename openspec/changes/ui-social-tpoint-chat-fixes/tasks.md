# Tasks

## 1. Widget Mạng Xã Hội (SocialBubble)
- [x] 1.1 Gỡ bỏ toàn bộ hiệu ứng cũ (nhấp nhô float, vệt sáng kim loại, ping spans) trong `SocialBubble.client.vue`
- [x] 1.2 Triển khai hiệu ứng sóng tỏa thuần CSS `@keyframes zalo-pulse` (box-shadow) theo phong cách `tpoint.minhhieu.shop`
- [x] 1.3 Thiết kế chế độ Popup: Sửa nút launcher viên nang `rounded-full` không bị méo tròn; giới hạn chiều cao thân danh sách `max-h-[230px]` hiển thị vừa đủ 4 mục trên mobile, thanh cuộn mượt mà xem thêm, chiều cao card 323px không bao giờ tràn màn hình
- [x] 1.4 Thiết kế chế độ Floating: Mobile hiển thị viên nang nổi hợp nhất `[ 🟢 Hỗ trợ 24/7 ( 💬 ) ]` 133x42px; PC mặc định mở 6 kênh và có nút `✕` ở dưới cùng để thu gọn
- [x] 1.5 Chuẩn hóa vector SVG Zalo sang file chính thức `/assets/social/zalo.svg`
- [x] 1.6 Tự động ẩn widget khi mở menu drawer hoặc chatbot dialog trên mobile

## 2. Quản Trị Cấu Hình Mạng Xã Hội
- [x] 2.1 Chuyển khối "Hiển thị mạng xã hội" từ `general.vue` sang `social-links.vue`
- [x] 2.2 Tích hợp nút "Lưu kiểu hiển thị" độc lập kết nối `PUT /api/admin/settings/layout`
- [x] 2.3 Sửa preset Zalo trong `social-links.vue` sang `icon: '/assets/social/zalo.svg'` và `iconType: 'svg'`

## 3. Chatbot Auto-Scroll
- [x] 3.1 Cập nhật `scrollChatBottom` trong `ChatWidget.vue`: đưa `await nextTick()` lên đầu hàm và tăng ngưỡng bám đáy lên 80px
- [x] 3.2 Bổ sung watcher theo dõi `activeConversation.messages.length` và `isSubmitting` để tự động bám đáy khi có tin nhắn mới hoặc streaming
- [x] 3.3 Gọi `scrollChatBottom(true)` ngay khi người dùng nhấn gửi (`sendBotMessage` / `askBot`)
- [x] 3.4 Áp dụng cơ chế cuộn tương tự cho trang Trợ lý toàn màn hình `app/pages/assistant.vue`

## 4. Tối Ưu Giao Diện & Triệt Tiêu Tràn Trang Ngang
- [x] 4.1 Triệt tiêu 352px tràn trang ngang trên mobile cho `/admin/analytics` trong `AnalyticsLiveDashboard.client.vue`
- [x] 4.2 Triệt tiêu 300px tràn ngang trên Dashboard admin trong `app/pages/admin/index.vue`
- [x] 4.3 Tối ưu hiển thị tiêu đề bài viết 2 dòng trên tablet trong `admin/content/articles/index.vue`
- [x] 4.4 Căn chỉnh nút mũi tên slider trong `RoleModelsBlock.vue`
- [x] 4.5 Giảm đệm lề form liên hệ mobile từ `p-8` xuống `p-5` trong `ContactFormBlock.vue`
- [x] 4.6 Bổ sung avatar và nút đăng xuất trên topbar mobile admin; Việt hóa breadcrumb tiêu đề trang admin

## 5. Media Self-Heal
- [x] 5.1 Xây dựng service `media-self-heal.ts` và endpoint `self-heal.post.ts` check chéo và tự vá liên kết Cloudflare R2
- [x] 5.2 Bổ sung unit test và integration test cho tính năng tự vá ảnh R2
