import type { Pool } from 'mysql2/promise'
import { getPool } from './db'

/**
 * Truy vấn SQL thuần **theo giờ UTC** trên pool dùng chung của ứng dụng.
 *
 * Vì sao cần: pool dùng chung (`server/utils/db.ts`) khai `timezone: '+07:00'`,
 * còn mọi bảng analytics lưu mốc thời gian theo **UTC** (`bucket_start`,
 * `day`, …). mysql2 dùng `timezone` của kết nối ở **hai** chỗ: khi chuyển tham số
 * `Date` thành chuỗi SQL, và khi đọc cột DATE/DATETIME/TIMESTAMP ra `Date`. Đổi
 * thẳng `analytics-noc`/`analytics-reporting` sang pool dùng chung là lệch 7 giờ
 * cả lúc ghi lẫn lúc đọc — đúng cái bẫy "lệch 7h" đã trả giá ở `started_at`.
 *
 * Trước đây hai service đó tránh bẫy bằng cách **mở một pool mới mỗi lượt gọi**
 * (`timezone: '+00:00'`) rồi đóng ngay — hai lần bắt tay TCP + xác thực MySQL cho
 * mỗi lượt bảng điều khiển hỏi lại (15 giây một lần). Adapter này giữ nguyên ngữ
 * nghĩa UTC mà không cần pool riêng:
 *  - tham số `Date` được chính adapter đổi sang chuỗi UTC `YYYY-MM-DD HH:MM:SS.mmm`
 *    (mysql2 **không** cho đổi múi giờ định dạng tham số theo từng truy vấn —
 *    `format()` luôn đọc `config.timezone` của kết nối);
 *  - kết quả đọc với `timezone: '+00:00'` **theo từng truy vấn** — mysql2 tôn trọng
 *    tuỳ chọn này khi dựng parser, và khoá bộ đệm parser có kèm múi giờ nên
 *    parser dựng cho `+07:00` không bị dùng lại.
 *
 * Không đổi phiên `time_zone` của MySQL: `NOW()`/`CURRENT_TIMESTAMP` phía máy chủ
 * giữ nguyên như mọi truy vấn khác trên pool.
 */
export const UTC_QUERY_TIMEZONE = '+00:00'

export type UtcQueryConnection = Pick<Pool, 'query'>

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** Chuỗi DATETIME UTC — cùng dạng mysql2 tự sinh cho `Date` khi kết nối là `+00:00`. */
export function utcDateTimeParam(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error('invalid date parameter')
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} `
    + `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.${pad(value.getUTCMilliseconds(), 3)}`
}

/** Một tham số vị trí của mysql2 (`?`) — cùng kiểu phần tử mảng mà `QueryValues` nhận. */
type PositionalValue = NonNullable<unknown> | null | undefined

function utcQueryValue(value: unknown): PositionalValue {
  if (value instanceof Date) return utcDateTimeParam(value)
  if (Array.isArray(value)) return value.map(utcQueryValue)
  return value
}

/** Đổi mọi `Date` (kể cả trong mảng lồng cho `IN (?)`) sang chuỗi UTC. */
export function utcQueryValues(values: readonly unknown[]): PositionalValue[] {
  return values.map(utcQueryValue)
}

/**
 * Bọc một pool/kết nối mysql2 để mọi lượt `query(sql, values)` chạy theo UTC.
 * Chỉ hỗ trợ dạng gọi `query(sql: string, values?: unknown[])` — dạng duy nhất
 * mà các service analytics dùng; dạng khác bị từ chối thay vì âm thầm chạy theo
 * +07:00.
 */
export function utcQueryConnection(pool: Pick<Pool, 'query'>): UtcQueryConnection {
  const query = (sql: unknown, values?: unknown) => {
    if (typeof sql !== 'string' || (values !== undefined && !Array.isArray(values))) {
      throw new TypeError('utcQueryConnection.query expects (sql: string, values?: unknown[])')
    }
    return pool.query({ sql, timezone: UTC_QUERY_TIMEZONE }, utcQueryValues(values ?? []))
  }
  return { query } as UtcQueryConnection
}

/** Adapter UTC trên pool dùng chung của tiến trình — không mở kết nối mới. */
export function sharedUtcQueryConnection(): UtcQueryConnection {
  const pool = getPool()
  if (!pool) throw new Error('database pool is unavailable')
  return utcQueryConnection(pool)
}
