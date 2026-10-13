import { sql, type SQL } from 'drizzle-orm'

/**
 * Số ngày dùng làm hằng số trong `INTERVAL n DAY`.
 *
 * MySQL không nhận `?` ở mọi vị trí số, nên chỗ này dựng `sql.raw` — và chính vì
 * thế giá trị phải được **ép về số nguyên** trước, không tin kiểu của nơi gọi.
 * Một chuỗi lọt vào đây sẽ đi nguyên văn vào câu lệnh. Giá trị hôm nay đến từ
 * chính sách retention đã qua kiểm tra, nhưng ràng buộc đó nằm ở nơi khác và có
 * thể bị đổi mà không ai nhớ rằng đoạn này dựa vào nó.
 */
export function intervalDays(value: unknown): SQL {
  // `Number(null)`, `Number('')` and `Number([])` are all 0: only a number or a
  // non-empty numeric string counts as a day count, never "nothing".
  const isCandidate = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
  const days = isCandidate ? Number(value) : NaN
  if (!Number.isSafeInteger(days) || days < 0 || days > 36_500) {
    throw new RangeError(`intervalDays: not a whole number of days between 0 and 36500: ${String(value)}`)
  }
  return sql.raw(String(days))
}
