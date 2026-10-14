/**
 * Hai hàm phân trang dùng chung cho các trang danh sách công khai
 * (`/news`, `/documents`, `/role-models`, `/reintegration-models`, `/media`).
 *
 * Trước đây mỗi trang chép lại `pageRange` (5 bản) và tự đọc `?page=` theo một
 * kiểu riêng — có bản `Math.max(1, Math.floor(Number(x) || 1))`, có bản kiểm
 * `Number.isFinite`. Hai bản chép của cùng một quy tắc là chỗ để chúng lệch nhau.
 *
 * Hàm thuần, import tương đối được — `tests/pagination.test.ts` kiểm trực tiếp.
 */

/**
 * Đọc số trang từ query string của URL (người đọc sửa được, nên phải phòng thủ).
 *
 * `?page=abc` / `?page=-3` / `?page=Infinity` / `?page=` đều về trang 1; mảng
 * (`?page=2&page=5`) lấy phần tử đầu; số thập phân làm tròn xuống. Không bao giờ
 * trả `NaN` — `NaN` lọt vào query gửi máy chủ thành `?page=NaN`.
 */
export function parsePageParam(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === null || raw === undefined || raw === '') return 1
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.floor(parsed)
}

/**
 * Dãy số trang hiển thị trên thanh phân trang.
 *
 * ≤ 7 trang: hiện hết. Nhiều hơn: trang đầu, trang cuối, trang hiện tại và hai
 * trang kề; chỗ đứt quãng giữa hai số không liền nhau do template vẽ dấu `…`.
 * Trang hiện tại nằm ngoài [1, total] (dữ liệu máy chủ lạ) không làm vỡ dãy —
 * các số ngoài biên bị loại.
 */
export function pageRange(current: number, total: number): number[] {
  const last = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1)
  const cur = Number.isFinite(current) ? Math.floor(current) : 1
  const pages = new Set([1, last, cur - 1, cur, cur + 1])
  return [...pages].filter(page => page >= 1 && page <= last).sort((a, b) => a - b)
}
