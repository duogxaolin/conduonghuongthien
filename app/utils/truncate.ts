/**
 * Cắt ngắn tiêu đề văn bản theo số ký tự tối đa để không bao giờ làm vỡ bố cục giao diện.
 * Áp dụng đồng bộ cho tất cả các khối trên trang chủ và trang danh mục, mọi ngôn ngữ (vi, en,...).
 *
 * - Cắt sạch tại ranh giới từ (khoảng trắng) để không chém đôi từ ngữ.
 * - Tự động thêm dấu ba chấm `…` ở cuối chuỗi bị cắt.
 * - Giữ nguyên vẹn nếu chuỗi ngắn hơn hoặc bằng `maxChars`.
 */
export function truncateTitle(title: string | null | undefined, maxChars: number = 70): string {
  const str = String(title || '').trim()
  if (!str || str.length <= maxChars) return str

  const sub = str.slice(0, maxChars)
  const lastSpace = sub.lastIndexOf(' ')
  // Nếu tìm thấy khoảng trắng ở nửa sau của chuỗi cắt, ngắt tại đó để bảo toàn từ
  const clean = lastSpace > maxChars * 0.65 ? sub.slice(0, lastSpace) : sub
  return clean.trimEnd() + '…'
}
