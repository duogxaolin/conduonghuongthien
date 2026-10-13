/**
 * Mẫu `LIKE` an toàn từ chuỗi do người dùng (hoặc model) gõ.
 *
 * `like(column, pattern)` của drizzle đã bind `pattern` thành tham số nên không có
 * SQL injection, nhưng `%` và `_` trong chuỗi vẫn là ký tự đại diện: truy vấn
 * `%` khớp mọi hàng, `_` khớp mọi ký tự đơn. Chuỗi do model truyền vào công cụ
 * chatbot (khách dẫn dắt được bằng prompt injection) phải coi như người dùng gõ.
 *
 * MySQL dùng `\` làm ký tự thoát mặc định.
 */

/** Độ dài tối đa của chuỗi tìm kiếm được bind — đủ cho một câu hỏi, chặn truy vấn khổng lồ. */
export const MAX_LIKE_QUERY_CHARS = 200

/** Biến `%`, `_` và `\` thành ký tự thường để chúng không làm LIKE khớp rộng ra. */
export function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/** `%…%` quanh chuỗi đã escape và đã cắt độ dài: "chứa chuỗi này". */
export function containsPattern(value: string): string {
  return `%${escapeLikeWildcards(value.slice(0, MAX_LIKE_QUERY_CHARS))}%`
}
