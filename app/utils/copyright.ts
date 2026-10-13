/**
 * Dòng bản quyền ở chân trang: thêm "© <năm>" chỉ khi chuỗi dịch CHƯA tự mang nó.
 *
 * Từ điển dự phòng tiếng Việt viết "Bản quyền thuộc về …" (không có ©), còn chuỗi trong CSDL (và các ngôn
 * ngữ khác) đã là "© 2026 Bản quyền …". Mẫu cũ luôn ghép cứng `© 2026 ` phía trước nên trang đã tải xong bản
 * dịch từ CSDL hiện "© 2026 © 2026 Bản quyền …" (thấy trên prod).
 */
export function withCopyrightPrefix(text: string, year: number | string = 2026): string {
  const value = (text ?? '').trim()
  if (/^(?:©|&copy;|\(c\)|copyright\b)/i.test(value)) return value
  return `© ${year} ${value}`.trim()
}
