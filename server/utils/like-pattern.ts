/**
 * Escape ký tự wildcard của SQL LIKE (`%` `_` `\`) trong chuỗi do người dùng
 * nhập trước khi nhét vào `like(cột, '%...%')`.
 *
 * `%` và `_` là ký tự đặc biệt trong LIKE: `%` khớp bất kỳ chuỗi nào, `_` khớp
 * đúng một ký tự. Một người dùng gõ `_` trong ô tìm kiếm đang yêu cầu "một
 * ký tự bất kỳ ở đây", không phải "ký tự gạch dưới". Trên kho media của cổng
 * thì hậu quả nhỏ; trên kho câu hỏi pháp lý thì `_` khớp sai vào hàng khác và
 * trả kết quả không liên quan — đọc ra là cổng đang đoán bừa.
 *
 * Phương thức escape mặc định của MySQL là backslash (`\`), nên cả `\` cũng
 * phải thoát để không bị đọc thành escape sequence.
 *
 * Một bản dùng chung cho toàn bộ `like()` trong dự án — cùng khuôn với
 * `finitePositive`: không chép helper này ở mỗi endpoint, vì bản sao thứ hai
 * là chỗ thứ hai để quên escape một ký tự.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, (ch) => `\\${ch}`)
}

/**
 * Bọc chuỗi đã escape thành pattern `%...%` (contains) sẵn sàng传 vào `like()`.
 */
export function likeContains(input: string): string {
  return `%${escapeLikePattern(input)}%`
}
