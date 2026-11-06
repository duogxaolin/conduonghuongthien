/**
 * Đường dẫn của request theo cách ROUTER hiểu, để các plugin `render:html` (tracking, og-image, favicon) quyết định
 * "đây có phải /admin hay /api không" trên cùng một dạng với router — không phải trên `event.path` thô.
 *
 * Vì sao: `event.path` mang cả query/fragment (`/admin?x=1`) và đúng như khách gõ (`/ADMIN`, `/%61dmin`, `//admin`),
 * trong khi vue-router mặc định không phân biệt hoa thường và giải mã %. So thô thì `/ADMIN` dựng trang quản trị
 * (admin điều hướng phía client sau lượt tải đầu) mà mã theo dõi vẫn bị chèn và ở lại suốt phiên (verifier 2026-11-06).
 *
 * Chuỗi hỏng (`%E0%A4%A`) không giải mã được thì giữ nguyên dạng đã bỏ query, chữ thường.
 */
export function routePath(rawPath: string | undefined | null): string {
  const withoutQuery = (rawPath || '').split(/[?#]/)[0] ?? ''
  let decoded = withoutQuery
  try {
    decoded = decodeURIComponent(withoutQuery)
  } catch {
    // giữ nguyên
  }
  return decoded.toLowerCase().replace(/\/{2,}/g, '/')
}
