/**
 * Thay lần xuất hiện ĐẦU TIÊN của `search` trong `text` bằng `replacement`, cả
 * hai hiểu theo NGUYÊN VĂN.
 *
 * `String.prototype.replace(string, string)` không nguyên văn ở vế thay thế:
 * `$&`, `` $` ``, `$'` và `$$` là mẫu đặc biệt. Gợi ý sửa của trợ lý AI (một câu
 * có "giá $&nbsp;…", một công thức, một đoạn mã) đi vào vế đó sẽ bị chèn lại cả
 * đoạn gốc / phần trước / phần sau của bài viết thay vì đúng chữ AI đề xuất.
 * Trả `null` khi không tìm thấy, để nơi gọi báo lỗi thay vì âm thầm không đổi gì.
 */
export function replaceFirstLiteral(text: string, search: string, replacement: string): string | null {
  if (!search) return null
  const index = text.indexOf(search)
  if (index === -1) return null
  return text.slice(0, index) + replacement + text.slice(index + search.length)
}
