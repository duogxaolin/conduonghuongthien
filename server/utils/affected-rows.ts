/**
 * Đọc `affectedRows` từ một kết quả truy vấn — một hàm, một chỗ.
 *
 * Đây là **cùng họ lỗi với `insertId`** đã ghi trong CLAUDE.md, và nó đã lộ ra
 * một lần thật ở `sessions/bulk-delete.post.ts`: `pool.query()` trả về một
 * **mảng** `[header, fields]`, nên `result.affectedRows` đọc trên giá trị chưa
 * destructure ra `undefined` — **âm thầm**. `Number(undefined ?? 0)` là `0`, tức
 * là một lượt xoá thành công báo về "đã xoá 0 bản ghi", và cán bộ đi bấm xoá lần
 * nữa trên những hàng đã biến mất.
 *
 * Cái làm lỗi này vô hình là `as { affectedRows?: number }`: nó **khẳng định**
 * hình dạng chứ không **kiểm** hình dạng, nên cách đọc sai vẫn qua `typecheck`,
 * qua fake pool (một stub trả về đúng hình dạng người viết tin là đúng), và qua
 * mọi test soi văn bản mã nguồn. Sáu chỗ trong dự án từng viết phép ép kiểu đó,
 * mỗi chỗ một bản.
 *
 * Hàm này nhận **cả hai** hình dạng nên nơi gọi không phải nhớ mình đang cầm cái
 * nào: một `ResultSetHeader` đã destructure, hay cả mảng `pool.query()` trả về.
 * Không đọc được thì trả `null`, **không** trả `0` — hai thứ đó khác nhau: `0` là
 * "không có hàng nào khớp", còn `null` là "không biết", và nơi gọi phải tự quyết
 * định xem trường hợp sau là im lặng chấp nhận hay là một lỗi.
 */
export function readAffectedRows(result: unknown): number | null {
  const header = Array.isArray(result) ? result[0] : result
  if (!header || typeof header !== 'object') return null
  const value = (header as { affectedRows?: unknown }).affectedRows
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  return null
}

/**
 * Như trên, nhưng `null` đọc thành `0`.
 *
 * Dùng cho các vòng dọn theo lô, nơi con số chỉ để cộng dồn và để so với kích cỡ
 * lô: ở đó `0` và "không biết" dẫn tới **cùng một quyết định** (dừng vòng lặp),
 * nên phân biệt chúng chỉ thêm một nhánh không ai đi. Đừng dùng khi con số được
 * **báo lại cho người dùng** — ở đó `0` là một lời khẳng định.
 */
export function affectedRowsOrZero(result: unknown): number {
  return readAffectedRows(result) ?? 0
}
