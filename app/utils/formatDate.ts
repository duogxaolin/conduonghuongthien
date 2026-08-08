/**
 * Format a date string to Vietnamese format (dd/MM/yyyy).
 * Uses manual parsing to avoid timezone/locale mismatch between SSR and client.
 */
export const formatDateVN = (dateStr: string | null | undefined): string => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year = d.getUTCFullYear()
  return `${day}/${month}/${year}`
}

/**
 * Dấu thời gian dạng ngày + giờ theo giờ địa phương, cho màn hình quản trị.
 *
 * KHÁC `formatDateVN` một cách có chủ đích: hàm kia đọc bằng `getUTC*` để HTML
 * dựng ở máy chủ và ở trình duyệt ra cùng một chuỗi — đúng cho ngày đăng bài
 * hiển thị công khai. Ở đây thì ngược lại: một dòng nhật ký kiểm toán phải đọc
 * theo giờ của người đang ngồi trước máy, vì câu hỏi họ đang trả lời là "lúc
 * mấy giờ thì việc này xảy ra". Chỉ dùng trong `/admin/**`, nơi mọi thứ đều
 * dựng phía trình duyệt nên không có chuyện SSR lệch client.
 *
 * Giá trị không phân tích được thì trả lại nguyên văn thay vì "Invalid Date" —
 * chuỗi gốc ít ra còn nói được điều gì đó cho người đang đọc log.
 */
export function formatDateTimeVN(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN')
}
