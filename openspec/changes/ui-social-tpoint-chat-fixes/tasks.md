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

## 6. Thiết Kế Lại Bảng Dữ Liệu Admin Thành Dạng Thẻ Trên Mobile
- [x] 6.1 `admin/readers`: Thẻ người đọc (avatar, tên, email, trạng thái hoạt động/chặn, số bình luận, nút xem chi tiết)
- [x] 6.2 `admin/chatbot/knowledge`: Thẻ kho kiến thức (câu hỏi, chủ đề, trạng thái xuất bản, bật/tắt câu hỏi nhanh, nút sửa/xóa)
- [x] 6.3 `admin/content/pages`: Thẻ trang tĩnh (tiêu đề, đường dẫn slug, số block nội dung, nhãn hệ thống, nút sửa/xóa)
- [x] 6.4 `admin/content/content-types`: Thẻ thể loại bài viết (icon, tên, slug, số danh mục/bài viết, nút sửa/xóa)
- [x] 6.5 `admin/settings/ip-bans`: Thẻ chặn IP (địa chỉ IP/CIDR, lý do, người thêm, nút bỏ chặn)
- [x] 6.6 `admin/settings/backup`: Thẻ sao lưu (tên tệp, dung lượng, trạng thái Drive, nút tải về/khôi phục/xóa)
- [x] 6.7 `admin/users/activity`: Thẻ nhật ký hoạt động (tài khoản, hoạt động, thời điểm, địa chỉ IP, thiết bị, xác thực MFA)
- [x] 6.8 `admin/languages`: Thẻ từ điển dịch UI và thẻ thống kê tỷ lệ hoàn thiện theo ngôn ngữ
- [x] 6.9 `admin/analytics`: Thẻ bảng xếp hạng drill-down chi tiết

## 7. Khắc Phục Lỗi i18n Bài Viết & Dịch Bài Liên Quan
- [x] 7.1 Gỡ bỏ `default: () => ({ ok: false, article: null })` gây nghẽn hydration của Nuxt trong `ArticleDetail.vue`
- [x] 7.2 Bổ sung `getCachedData` và `onMounted` tự động tải lại bài viết khi cache lệch ngôn ngữ
- [x] 7.3 Hỗ trợ tham số `lang` và dịch bài viết liên quan trong `server/api/public/articles/[slug]/related.get.ts`
