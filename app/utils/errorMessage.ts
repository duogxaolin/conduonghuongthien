/**
 * Đọc thông báo lỗi từ một giá trị bị `catch`.
 *
 * `catch (err: any)` từng xuất hiện **111 lần** trong dự án, và 103 trong số đó
 * đọc đúng một đường: `err?.data?.statusMessage`. Đó là hình dạng `$fetch` của
 * Nitro ném ra khi máy chủ trả `createError({ statusMessage })`.
 *
 * Vấn đề không phải là dài dòng mà là `any` **tắt trình kiểm kiểu ở đúng chỗ
 * hay sai nhất**. Trong một khối `catch`, giá trị bắt được có thể là bất cứ thứ
 * gì — một `FetchError`, một `TypeError` do lỗi lập trình ngay trong khối
 * `try`, hay một chuỗi ai đó `throw` ra. Với `any`, `err.data.statusMessage`
 * (không có `?.`) biên dịch trót lọt rồi **ném thêm một lỗi thứ hai ngay trong
 * trình xử lý lỗi**, che mất lỗi gốc. Đó là kiểu hỏng khó truy nhất: thứ người
 * dùng thấy không liên quan gì tới thứ thật sự đã sai.
 *
 * `unknown` buộc phải thu hẹp kiểu trước khi đọc; hàm này làm việc đó đúng một
 * lần, ở một chỗ.
 *
 * Thứ tự ưu tiên phản chiếu mức độ hữu ích với người đọc thông báo:
 *   1. `data.statusMessage` — câu tiếng Việt do chính máy chủ soạn cho người dùng
 *   2. `statusMessage` — lỗi H3 chưa đi qua `$fetch`
 *   3. `message` — lỗi JavaScript thường
 *   4. `fallback` — không có gì đọc được thì vẫn phải nói được điều gì đó
 *
 * KHÔNG bao giờ trả về chuỗi rỗng: một hộp thoại lỗi trống rỗng đọc ra là giao
 * diện bị hỏng, chứ không phải là thao tác đã thất bại.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error

  if (error && typeof error === 'object') {
    const shaped = error as {
      data?: { statusMessage?: unknown; message?: unknown }
      statusMessage?: unknown
      message?: unknown
    }
    for (const candidate of [
      shaped.data?.statusMessage,
      shaped.data?.message,
      shaped.statusMessage,
      shaped.message,
    ]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
  }

  return fallback
}

/**
 * Mã trạng thái HTTP của một lỗi đã bắt, hoặc `null` nếu không phải lỗi HTTP.
 *
 * Tách riêng vì việc phân biệt 401 với 403 là một **quyết định hành vi**, không
 * phải chuyện hiển thị: 401 nghĩa là vé đã hết hiệu lực nên phải mời đăng nhập
 * lại, còn 403 nghĩa là người dùng vẫn đang đăng nhập nhưng bị chặn — mời họ
 * đăng nhập lại là mời một lượt sẽ thành công mà không đổi được gì.
 */
export function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const shaped = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } }
  for (const candidate of [shaped.statusCode, shaped.status, shaped.response?.status]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
  return null
}

/**
 * Lượt fetch này có phải bị **chính mình huỷ** không.
 *
 * Một `AbortController` bị `abort()` sẽ ném ra như bất kỳ lỗi nào khác, nhưng
 * nó **không phải hỏng** — nó là kết quả mong muốn khi người dùng đổi bộ lọc
 * trước lúc lượt cũ về. Đối xử với nó như lỗi sẽ hiện một thông báo đỏ cho một
 * thao tác đã thành công, và tệ hơn: thông báo đó thuộc về lượt fetch **cũ**,
 * nên nó đè lên kết quả của lượt mới vừa hiện ra.
 */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  return name === 'AbortError' || name === 'CanceledError'
}
