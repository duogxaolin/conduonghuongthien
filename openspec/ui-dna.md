# DNA giao diện CDKT

Nguyên tắc rút ra từ cổng thông tin tiếng Việt, trang quản trị, biểu mẫu, hộp thoại xác nhận và bảng media hiện hữu. Các phần bổ sung cần hòa vào sản phẩm hiện tại.

## Màu sắc và bề mặt

- Xanh chủ đạo công khai `#4A6741`, đậm `#385130`, sáng `#618557`; xanh phụ `#7CB342`. Nền nhẹ `#F8FAF7`, nội dung chính `#1E251C`, nội dung phụ `#4A5545`, đường viền `#E2E8DF`.
- Quản trị dùng tiêu đề `#122815`, chữ phụ `#667768`, nút chính xanh `#2c6e33` hoặc `#4A6741` theo nhóm trang hiện hữu, thẻ trắng và viền `#e2ece3`. Giữ bảng màu của trang đang sửa; không thêm một bộ màu cạnh tranh.
- Đỏ thể hiện thao tác nguy hiểm và lỗi; vàng cho cảnh báo. Trạng thái luôn kèm chữ hoặc biểu tượng có nhãn, không chỉ có màu.
- Tên token (`shared/color-tokens.ts`, 22 token; viết token thay `[#hex]`): xanh `brand-950` `#122815`, `brand-900` `#1e4620`, `brand-800` `#385130` (xanh đậm công khai), `brand-700` `#2c6e33`, `brand-600` `#4A6741` (xanh chủ đạo, màu vòng focus), `brand-300` `#8ed694` (xanh nhạt quản trị: chữ trên nền xanh đậm, viền/nền nhẹ); `accent` `#7CB342` (xanh phụ — chỉ trang trí, 2.5:1 trên trắng: không làm vòng/viền focus, tránh làm chữ trên nền trắng; vài chỗ cũ còn vi phạm, chưa có test chặn); chữ `ink-strong` `#172516` (tiêu đề đậm nhất), `ink` `#1E251C` (nội dung chính), `ink-admin` `#2c3e2e` (chữ thân trang quản trị), `ink-secondary` `#4A5545` (nội dung phụ), `ink-soft` `#5A6C58` (chữ phụ công khai, ≥ 4.5:1 trên mọi nền sáng đang dùng), `ink-muted` `#667768` (chữ phụ quản trị), `ink-faint` `#8a9a8c` (gợi ý, chữ mờ); viền `line` `#e2ece3`, `line-strong` `#c8d6c9`; nền `surface` `#F8FAF7`, `surface-tint` `#f0f7f1`; lỗi `danger` `#d12420`, `danger-soft` `#b04a4a` (chữ lỗi dịu), `danger-bg` `#ffebe9` (nền khung lỗi); cảnh báo `warn-ink` `#8a6412` (chữ cảnh báo). Màu gần trùng một token chỉ gộp vào token đó qua bảng `shared/color-merges.ts` đã được duyệt (D-T1), không gộp tay.
- Thẻ quản trị bo 12px, nút và ô nhập 8px, hộp thoại 16px. Nút nổi (floating launcher) dùng dạng viên thuốc (pill) bo tròn, mặc định đóng để không che chắn nội dung trang. Bóng đổ nhẹ; tránh trang trí che lấp dữ liệu và thao tác.

## Chữ và khoảng cách

- Inter tự lưu trữ, dự phòng phông hệ thống sans-serif; cỡ gốc 16px, chiều cao dòng 1.6. Tiêu đề quản trị khoảng 20–21px, đậm; nội dung và biểu mẫu thường 14–16px, nhãn phụ 12–14px.
- Nhịp khoảng cách 4px: khoảng cách các điều khiển 8–12px, đệm thẻ 16–24px, khoảng cách nhóm 20–24px. Trang công khai có vùng nội dung cơ sở 1240px, tự động mở rộng theo bậc lên 1400px ở màn hình 1536px và trần tối đa 1536px ở màn hình lớn 1920px+ (2K/4K) để chống lọt thỏm; khoảng cách section 48px trên điện thoại và 80px ở màn hình lớn.
- Nội dung tiếng Việt ngắn, cụ thể; nhãn nút nói hành động thực tế: “Lưu”, “Tải lên”, “Thử lại”, “Hủy”. Lỗi nêu điều người dùng có thể sửa, không lộ thông tin máy chủ.

## Tương tác và khả năng tiếp cận

- Mỗi biểu mẫu có nhãn gắn với điều khiển, lỗi hiển thị gần trường liên quan, trạng thái đang lưu và ngăn gửi lặp. Điều khiển phải dùng được bằng bàn phím, có focus nhìn thấy rõ bằng viền/ring xanh.
- Hộp thoại có tên truy cập, vai trò dialog, trạng thái modal; quản lý focus trong hộp và trả focus về nút mở khi đóng. Escape để hủy, thao tác nguy hiểm cần xác nhận có nội dung cụ thể.
- Mọi khu vực tải dữ liệu có trạng thái tải, rỗng và lỗi riêng. Lỗi mang `role="alert"`, có nút thử lại đúng yêu cầu đã lỗi. Khung tải có thông báo cho trình đọc màn hình và tôn trọng giảm chuyển động.
- Icon trang trí ẩn khỏi trình đọc màn hình; nút chỉ có icon phải có tên truy cập. Trạng thái xử lý dài dùng thông báo tiến trình có nghĩa, không chỉ một spinner vô hạn.

## Bố cục và giới hạn

- Thiết kế từ màn hình nhỏ: nhóm điều khiển xếp dọc trước rồi mới thành hàng/cột. Nội dung dài ngắt dòng; bảng dữ liệu rộng cuộn ngang trong vùng của bảng, không kéo rộng toàn trang. Dùng thẻ trên điện thoại khi bảng quá khó đọc.
- Bám hệ thống Tailwind CSS v3 hiện hữu; không thêm thư viện giao diện hay CSS tùy chỉnh cho các kiểu đã biểu diễn được bằng utility. Giữ CSS cũ khi chưa có nhiệm vụ thay thế.
- Không đưa chi tiết triển khai, đường dẫn lưu trữ, tên job nội bộ hoặc thông báo lỗi thô vào trải nghiệm người dùng. Không thêm hiệu ứng, gradient, dashboard hoặc các biến thể thành phần chưa có nhu cầu thực tế.
