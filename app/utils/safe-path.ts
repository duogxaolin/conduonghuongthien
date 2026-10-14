/**
 * Chuẩn hoá một đường dẫn nội bộ lấy từ nguồn không tin cậy (query string, v.v.)
 * trước khi đặt vào `href`/`router.push`.
 *
 * Vì sao cần: `back=/news` đi vào `href="/${back}"` thành `//news`, và
 * `back=/evil.example` thành `//evil.example` — một network-path reference mà
 * trình duyệt hiểu là liên kết sang tên miền khác ngay dưới tên miền chính thức.
 *
 * Quy tắc (chỉ chấp nhận path tuyệt đối cùng origin, một dấu `/` đầu):
 *  - giá trị phải là chuỗi (mảng query lấy phần tử đầu; còn lại → dự phòng);
 *  - không có ký tự điều khiển — trình duyệt tự xoá tab/CR/LF khi phân tích URL,
 *    nên `/\t/evil.com` thực chất là `//evil.com`; từ chối thay vì làm sạch;
 *  - bắt đầu bằng đúng một `/`, không `//`, không `\` (trình duyệt coi `\` như `/`);
 *  - bản giải mã phần trăm cũng phải qua cùng phép thử (`/%2Fevil.com`,
 *    `/%5Cevil.com`); giải mã lỗi (`%E0%A4%A`) → dự phòng;
 *  - độ dài giới hạn.
 * Không có scheme vì chuỗi đã bắt đầu bằng `/`.
 */
export const SAFE_PATH_MAX_LENGTH = 512

// eslint-disable-next-line no-control-regex -- chủ đích bắt ký tự điều khiển
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/u

function isSafeShape(path: string): boolean {
  if (CONTROL_CHARS.test(path)) return false
  if (path.includes('\\')) return false
  if (path.startsWith('//')) return false
  if (!path.startsWith('/')) return false
  return true
}

/** Đường dẫn nội bộ an toàn, hoặc `fallback` (do nơi gọi tin cậy cung cấp). */
export function safeInternalPath(value: unknown, fallback = '/'): string {
  const candidate = Array.isArray(value) ? value[0] : value
  if (typeof candidate !== 'string') return fallback
  const path = candidate.trim()
  if (!path || path.length > SAFE_PATH_MAX_LENGTH) return fallback
  if (!isSafeShape(path)) return fallback

  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return fallback
  }
  if (!isSafeShape(decoded)) return fallback

  return path
}
