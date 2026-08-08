/**
 * Phép kiểm ký tự điều khiển cho văn bản thuần do người dùng gõ.
 *
 * Module **lá** — không import gì, nên nó kiểm được không cần CSDL và không tạo
 * phụ thuộc vòng giữa các service. `comments.ts` và `submission-workflow.ts` đều
 * dùng nó; hai bản của cùng một danh sách là hai chỗ để bỏ sót một ký tự, và
 * chúng chỉ được đối chiếu **sau khi** đã lọt một cái.
 */

/**
 * Ký tự điều khiển bị từ chối. `\n` (U+000A), `\t` (U+0009) và `\r` (U+000D) **được
 * phép** — ngắt dòng là nội dung thật, và CRLF được chuẩn hoá về LF trước đó.
 *
 * Viết bằng escape, không bao giờ bằng byte thật: một ký tự điều khiển nằm nguyên
 * văn trong mã nguồn thì vô hình trong mọi trình soạn thảo, nên một lần dọn dẹp sau
 * này có thể xoá nó đi mà không ai thấy gì thay đổi.
 */
// eslint-disable-next-line no-control-regex
export const FORBIDDEN_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

export function hasForbiddenControlChars(value: string): boolean {
  return FORBIDDEN_CONTROL_CHARS.test(value)
}
