/**
 * Đọc một số dương từ query string — `Number.isFinite` TRƯỚC khi kẹp biên.
 *
 * Thứ tự đó là toàn bộ lý do hàm này tồn tại. Viết
 * `Math.max(1, Number(query.page))` thì `?page=abc` cho ra `NaN`, và **kẹp biên
 * không cứu được**: mọi phép so sánh với `NaN` đều `false`, nên `Math.max` trả
 * lại chính `NaN`. Giá trị đó đi vào `offset()` và JSON hoá thành `page: null`
 * — endpoint trả về hàng nhưng **khai là không ở trang nào**. `?page=1e999`
 * (Infinity) lọt y hệt.
 *
 * Phát hiện được bằng cách **gọi thật endpoint sau khi build**, không phải bằng
 * đọc mã: một test soi văn bản mã nguồn không bao giờ thấy được hình dạng phản
 * hồi.
 *
 * Hàm này từng được chép **năm bản** giống hệt nhau trong `server/api/**`, và
 * bốn endpoint khác thì không có bản nào — chúng vẫn viết
 * `Math.max(1, Number(query.page || 1))`. Đó đúng là hình dạng một quy ước lan
 * ra không đều: những chỗ có helper thì đúng, những chỗ không có thì sai, và
 * không có gì chỉ ra chỗ nào là chỗ nào.
 */
export function finitePositive(raw: unknown, fallback: number, max: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(1, Math.floor(value)), max)
}

/** Trần mặc định cho số trang — đủ lớn để không ai chạm tới, đủ nhỏ để một
 *  `?page=99999999999` không thành một `OFFSET` mà MySQL phải nghĩ về. */
export const MAX_PAGE = 100_000
