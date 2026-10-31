/**
 * Ngày lịch Việt Nam cho các bộ lọc "Từ ngày / Đến ngày" của trang quản trị.
 *
 * `<input type="date">` gửi `YYYY-MM-DD` — một NGÀY LỊCH mà cán bộ đọc theo giờ
 * Việt Nam, không phải một thời điểm. Ba lỗi cùng một gốc đã gặp:
 *  - `new Date('2026-10-14')` là 00:00 **UTC** = 07:00 giờ VN → mất 7 giờ đầu ngày;
 *  - `setHours(23, 59, 59, 999)` và `new Date('…T00:00:00')` (không múi giờ) tính
 *    theo múi giờ **của tiến trình** → kết quả đổi theo `TZ` của container;
 *  - `to=YYYY-MM-DD` đọc thành 00:00 của chính ngày đó → ngày cuối bị loại hẳn.
 *
 * Ở đây cả hai đầu khoảng là thời điểm tuyệt đối, không phụ thuộc `TZ`:
 * `[ngày đầu 00:00 +07:00, ngày SAU ngày cuối 00:00 +07:00)` — đầu cuối là MỞ, nên
 * so bằng `lt`, không `lte` (không còn mốc 23:59:59.999 bỏ sót phần lẻ của giây).
 *
 * Asia/Ho_Chi_Minh là UTC+7 quanh năm (không có giờ mùa hè), nên một độ lệch cố
 * định là chính xác.
 *
 * Thời điểm trả về là `Date`; Drizzle đổi nó sang chuỗi UTC cho cả cột
 * TIMESTAMP (`activity_logs.created_at`, `ai_usage_logs.created_at`) lẫn DATETIME
 * ghi bằng `UTC_TIMESTAMP()` (`chat_sessions.started_at`). Với DATETIME đó là so
 * đúng với cách cột được ghi. Với TIMESTAMP, MySQL đọc chuỗi theo `time_zone` của
 * PHIÊN — đúng khi phiên chạy UTC, như cấu hình hiện tại (`time_zone=SYSTEM=UTC`,
 * xem chú thích service `mysql` trong `docker-compose.yml`). Đổi múi giờ phiên MySQL
 * thì các mốc ở đây (và mọi `Date` Drizzle gửi cho cột TIMESTAMP) lệch theo.
 */

export const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 00:00 giờ Việt Nam của ngày `YYYY-MM-DD`, dưới dạng thời điểm tuyệt đối; `null`
 * cho mọi thứ khác (kể cả ngày không tồn tại như 2026-02-30). Nơi gọi tự quyết
 * `null` nghĩa là "bỏ qua" hay "400".
 */
export function vietnamDayStart(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  // Round-trip: Date.UTC cuộn 02-30 thành 03-02 thay vì báo lỗi.
  if (new Date(utcMidnight).toISOString().slice(0, 10) !== match[0]) return null
  return new Date(utcMidnight - VIETNAM_OFFSET_MS)
}

/** Mốc đầu cuối (MỞ) cho ngày cuối `YYYY-MM-DD`: 00:00 giờ VN của ngày hôm SAU. `null` nếu không phải ngày hợp lệ. */
export function vietnamDayEndExclusive(value: unknown): Date | null {
  const start = vietnamDayStart(value)
  return start ? new Date(start.getTime() + DAY_MS) : null
}

/**
 * 00:00 giờ Việt Nam của ngày (theo lịch VN) chứa thời điểm `at` — không phụ thuộc
 * `TZ` của tiến trình (cùng lý do như trên).
 */
export function vietnamDayStartOf(at: Date): Date {
  return new Date(Math.floor((at.getTime() + VIETNAM_OFFSET_MS) / DAY_MS) * DAY_MS - VIETNAM_OFFSET_MS)
}

/**
 * `YYYY-MM-DD` của ngày theo lịch VN chứa thời điểm `at` — không phụ thuộc `TZ` của
 * tiến trình. Bốn đường xuất bài (HTML, ZIP, CSV, Google Docs) từng in "Ngày" bằng
 * `getFullYear/getMonth/getDate` theo `TZ` tiến trình: tiến trình UTC (đường PM2) in bài
 * đăng 03:00 ngày 29 (giờ VN) thành ngày 28 (FINDING-R6-17).
 */
export function vietnamDateString(at: Date): string {
  const time = at.getTime()
  // Một cột ngày giữ `0000-00-00` (MySQL không bật NO_ZERO_DATE) đọc ra Invalid Date: trả
  // chuỗi rỗng — `toISOString()` ném RangeError và làm hỏng CẢ lượt xuất (verifier L1).
  if (Number.isNaN(time)) return ''
  return new Date(time + VIETNAM_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 00:00 giờ Việt Nam ngày 1 của tháng (theo lịch VN) chứa thời điểm `at`.
 *
 * `new Date(now.getFullYear(), now.getMonth(), 1)` từng được dùng cho "tháng này" của
 * hạn mức AI: nó theo `TZ` của tiến trình. Image Docker đặt `Asia/Ho_Chi_Minh`, đường
 * PM2 (`ecosystem.config.cjs`) thì không — với tiến trình chạy UTC, từ 00:00 tới 07:00
 * ngày 1 (giờ VN) "tháng này" vẫn là tháng trước, và cả tháng trước bị tính vào hạn
 * mức tháng mới.
 */
export function vietnamMonthStart(at: Date): Date {
  const local = new Date(at.getTime() + VIETNAM_OFFSET_MS)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - VIETNAM_OFFSET_MS)
}
