---
name: responsive-audit-2026-09-08
description: "Kết quảaudit responsive toàn cổng CDKT 2026-09-08 — overflowX=0 trên 14 trang × 4 viewport, không vấn đề nghiêm trọng; danh sách nút <44px đã biết"
metadata: 
  node_type: memory
  type: project
  originSessionId: c3306b65-d2cf-4b07-bc21-6ae6dbef3640
  modified: 2026-09-08T10:36:45.218Z
---

Audit responsive toàn bộ trang công khai CDKT (dev-browser, container port 3000, build có fix giật commit 23afaac) ngày 2026-09-08.

**Không phát hiện vấn đề nghiêm trọng:**
- `overflowReal = 0` (scrollWidth ≤ clientWidth) trên **14 trang × 4 viewport** (375/768/1024/1440). Không trang nào tràn ngang thật.
- Không heading h1/h2 nào bị sticky header che (topbar 41px + header 66px mobile/tablet, 132px desktop → stickyTop 107/173px; mọi heading top > stickyTop).
- Mobile menu drawer mở đúng (`overflowReal` vẫn 0, các link rộng 302px — đủ cảm ứng), overlay tối, không vỡ.
- ChatWidget: desktop 1024 = 499×730 panel nổi phải; tablet 768 = 442×653; mobile 375 = full-screen 375×740. `ovR=0` cả ba — không tràn.
- Trang `/profile` (chưa đăng nhập) hiển thị đúng 16 phần tử visible, khối mời đăng nhập.
- `/admin/login` responsive sạch, input 271–356px × 50px (touch target tốt); `/admin` redirect đúng về login.
- Footer, hero đều không vỡ.

**Nút < 40px (WCAG 2.5.5 touch-target):**
- **Đã nâng cấp ngày 2026-09-15**:
  - Nút search Topbar `default.vue`: nâng từ 38×38px lên 44×44px (`w-11 h-11`), đạt chuẩn WCAG AAA.
  - Các nút ChatWidget header: trên mobile đã nâng từ 32×32px (`w-8 h-8`) lên 40×40px (`w-10 h-10`), nút back `w-10 h-10` đủ diện tích cảm ứng; trên desktop giữ gọn gàng.
- Nút VN/EN đổi ngôn ngữ: giữ nguyên theo yêu cầu tạm bỏ qua đa ngôn ngữ.

**Lưu ý cỡ chữ A-/A/A+:** Đã chính thức bỏ khỏi tài liệu hệ thống và cập nhật câu trả lời của Trợ lý ảo chuyển sang hướng dẫn người dùng sử dụng tính năng Zoom của trình duyệt (Ctrl + / Ctrl - hoặc cài đặt cỡ chữ hệ thống).

**Đã dứt điểm trước đó (commit 23afaac):** layout shift 130px khi cuộn (bỏ `pt-[100px] md:pt-[130px]` thừa ở `<main>` vì header đã sticky), thêm `lazy: true` cho NewsCategoryList + 4 block trang chủ.

Nếu cần tái audit: container port 3000 đang chạy build mới; `npm test` baseline 1473 pass / 9 fail (9 fail cũ: Windows bash-exec, integration skip, audit/slugify drift — không liên quan UI).
