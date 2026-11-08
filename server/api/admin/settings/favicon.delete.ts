import { resetFaviconWithAudit } from '../../../services/admin-settings-favicon'
import { clearFaviconSettingCache } from '../../../utils/favicon-setting'
import { requireResourcePermission } from '../../../utils/permissions'

/**
 * Trả favicon về bộ mặc định đi kèm mã nguồn.
 *
 * Nằm ở tệp riêng, không phải một export thứ hai trong `favicon.post.ts`: Nitro
 * định tuyến theo **tên tệp** và chỉ lấy default export, nên một handler thứ hai
 * xuất khẩu từ tệp kia sẽ không bao giờ được gọi — nó trông như đã nối vào mà chưa
 * bao giờ chạy. Đúng lớp lỗi mà cả việc favicon này ra đời để dứt điểm.
 *
 * **Xoá cả hai khoá thay vì ghi đường dẫn mặc định vào chúng.** Một hàng trỏ tới
 * `/favicon-32.png` và một hàng vắng mặt cho ra cùng một icon, nhưng hàng có mặt
 * khiến trang cài đặt hiện ra như "đã cấu hình" trong khi cổng đang dùng bộ mặc
 * định. `loadFaviconSetting` đã lùi về mặc định khi không có hàng, nên vắng mặt là
 * cách diễn đạt đúng — và nó cũng là cách `favicon_ico_url` trở lại `null` để tuyến
 * `/favicon.ico` dùng `favicon-default.ico`.
 *
 * **Không xoá tệp đã sinh trên đĩa.** Chúng nằm dưới `public/uploads/favicon/` và
 * mang dấu thời gian trong tên nên không chắn đường gì; còn một trình duyệt đang
 * đệm hay một liên kết đã phát ra ngoài mà thành 404 thì tệ hơn vài chục KB nằm
 * lại. Cùng lý do dự án không backfill slug đã phát hành.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  // Both deletes and the audit row commit together, or none (in the service).
  await resetFaviconWithAudit(adminUser)

  // Sau khi commit: trạng thái ngoài CSDL không tham gia được vào tính nguyên tử
  // của CSDL, nên nó đợi kết quả thay vì đoán trước.
  clearFaviconSettingCache()

  return { ok: true }
})
