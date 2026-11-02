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

/** Múi giờ của cổng — ngày đăng bài là ngày ở Việt Nam, đọc ở đâu cũng vậy. */
export const PORTAL_TIME_ZONE = 'Asia/Ho_Chi_Minh'

/**
 * Ngày theo ngôn ngữ đang chọn, LUÔN theo giờ Việt Nam — cho ngày dựng ở cả máy chủ lẫn
 * trình duyệt (trang chi tiết bài, trang in).
 *
 * `toLocaleDateString(locale, opts)` không có `timeZone` đọc theo múi giờ của MÁY: container
 * chạy `TZ=Asia/Ho_Chi_Minh`, trình duyệt ở múi giờ khác (máy dev đặt Europe/London) ra một
 * ngày khác cho mọi bài đăng từ 17:00 đến 23:59 UTC → "Hydration completed but contains
 * mismatches" và ngày nhảy sau khi tải (đo trên cdkt_app: bài 20:59Z, HTML "06/10/2026",
 * sau hydrate "05/10/2026"). Khác `formatDateVN` (ngày UTC, dạng cố định dd/MM/yyyy cho danh
 * sách): hàm này giữ định dạng theo `locale` của trang. Không phân tích được → ''.
 */
export function formatPortalDate(
  value: string | Date | null | undefined,
  locale: string,
  options: Omit<Intl.DateTimeFormatOptions, 'timeZone'>,
): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(locale, { ...options, timeZone: PORTAL_TIME_ZONE })
}

/**
 * "HH:mm dd/MM" theo giờ Việt Nam (Asia/Ho_Chi_Minh), bất kể múi giờ của máy dựng trang — cho một
 * thời điểm UTC đã lưu mà cán bộ cần đọc theo giờ ở đây (vd. lúc AI kiểm duyệt phán,
 * `AdminQueueAiVerdictNote`). Ghép từ `formatToParts` để dấu ngăn không đổi theo locale. Trống hoặc
 * không phân tích được → ''. (Bộ định dạng dựng mỗi lần gọi — vài nhãn mỗi trang — nên test đổi
 * múi giờ của máy giữa chừng kiểm được thật rằng kết quả không theo múi giờ máy.)
 */
export function formatTimeDayVN(value: string | Date | null | undefined): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('hour')}:${part('minute')} ${part('day')}/${part('month')}`
}
