/**
 * Hai phép biến đổi thuần của bảng NOC trong màn hình analytics.
 *
 * Rút khỏi `AnalyticsLiveDashboard.client.vue` (996 dòng) không phải để đếm
 * dòng, mà vì **`safeDetails` là một bộ lọc quyền riêng tư và nó đang không có
 * test nào**: nằm trong `<script setup>` của một SFC thì không nơi nào import
 * được, nên cách duy nhất để kiểm là mount cả bảng điều khiển. Một danh sách
 * chặn im lặng ngừng chặn trông y hệt một danh sách chặn đang chạy đúng.
 *
 * Phần còn lại của bảng NOC **cố ý ở nguyên chỗ cũ**: template của nó dùng 22
 * định danh của component cha (đồng hồ, trạng thái kết nối, bộ đếm poll dùng
 * chung với hai panel kia). Đẩy 22 thứ đó qua props/emit là **tăng** bề mặt
 * phức tạp để giảm số dòng — đổi một tệp dài lấy hai tệp buộc nhau chặt hơn.
 */

/** Mức độ nào đáng để cán bộ chú ý. Chấp nhận cả `warn` lẫn `warning` vì hai
 *  nguồn sự kiện dùng hai cách viết. */
export function isWarningOrError(severity: string): boolean {
  return /^(warning|warn|error|critical)$/i.test(severity)
}

/**
 * Chuỗi JSON của `details`, đã loại các khoá có thể mang dữ liệu định danh.
 *
 * Đây là **danh sách chặn theo tên khoá**, và giới hạn đó là chủ đích: bảng NOC
 * hiển thị chẩn đoán do nhiều nguồn ghi ra, nên không có lược đồ cố định để
 * duyệt theo danh sách cho phép. Chặn theo tên bắt được đúng nhóm trường mà một
 * người ghi log sẽ đặt tên như vậy (`visitorToken`, `clientIp`, `userEmail`) —
 * nó **không** bắt được một giá trị định danh nấp dưới một cái tên vô hại, và
 * cũng không nhằm làm thế. Tuyến phòng thủ thật là không ghi dữ liệu đó vào
 * `details` ngay từ đầu; cái này là lưới an toàn cuối.
 *
 * Rỗng sau khi lọc thì trả `—` chứ không phải `{}`: một cặp ngoặc trống nhìn
 * như dữ liệu bị mất, còn dấu gạch đọc ra là "không có gì để hiện".
 */
export function safeDetails(details: Record<string, number | boolean | string> | null): string {
  if (!details) return '—'
  const blocked = /(visitor|token|cookie|session|email|phone|address|ip|user|authorization)/i
  const safe = Object.fromEntries(Object.entries(details).filter(([key]) => !blocked.test(key)))
  return Object.keys(safe).length ? JSON.stringify(safe) : '—'
}
