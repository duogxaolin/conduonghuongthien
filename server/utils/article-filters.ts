/**
 * Bộ kiểm giá trị bộ lọc cho danh sách bài viết quản trị.
 *
 * Tách thành hàm thuần để kiểm được không cần máy chủ HTTP — cùng lý do
 * `resolveClientIp` trong `client-ip.ts` là hàm thuần: quyết định "giá trị này
 * có hợp lệ không" là phần dễ sai nhất và cũng là phần dễ kiểm nhất.
 */

/** Lỗi giá trị bộ lọc không hợp lệ. Handler dịch thành 400. */
export class ArticleFilterValidationError extends Error {}

/**
 * Bộ lọc theo người đăng bài, đã chuẩn hoá.
 *
 * `none` là một nhánh riêng chứ không phải `userId = null`: `articles.author_id`
 * là `INT NULL` với `ON DELETE SET NULL` (`server/db/init.ts:566`), nên bài viết
 * mất tác giả là trạng thái **sẽ xảy ra thật** khi một tài khoản bị xoá — không
 * phải giả định phòng xa. Gộp nó vào `all` thì đúng những bài đó là nhóm không
 * bao giờ lọc ra được, mà đó lại thường là nhóm cần soi.
 */
export type ArticleAuthorFilter =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'user'; userId: number }

/** Giá trị đại diện nhóm "không rõ tác giả" trên đường truyền query. */
export const AUTHOR_FILTER_NONE = 'none'

/**
 * Đọc tham số `authorId` từ query string.
 *
 * Giá trị lạ bị **từ chối**, không suy diễn — cùng quy tắc với bộ lọc `quick`
 * của kho kiến thức (`server/services/chatbot-knowledge.ts`). Suy diễn ở đây có
 * hậu quả thấy được: `Number('abc')` là `NaN`, và một điều kiện `NaN` lặng lẽ
 * trả về danh sách rỗng trong khi ô chọn trên giao diện vẫn ghi "Tất cả" — cán
 * bộ đọc ra "không có bài viết nào" thay vì "bộ lọc sai".
 *
 * Chấp nhận `undefined`/rỗng (không lọc) và `'none'`. Ngoài ra chỉ nhận số
 * nguyên dương viết dưới dạng thập phân thuần: `'1.5'`, `'0'`, `'-3'`, `' 1 '`,
 * `'1e3'`, `'0x2'` đều bị từ chối. Không kiểm người dùng đó có tồn tại hay
 * không — đó là việc của truy vấn, và một id không tồn tại trả về danh sách
 * rỗng là câu trả lời đúng, không phải lỗi.
 */
export function parseAuthorFilter(raw: unknown): ArticleAuthorFilter {
  if (raw === undefined || raw === null || raw === '') return { kind: 'all' }

  // Mảng đến từ query string lặp lại (`?authorId=1&authorId=2`) — mơ hồ, từ chối
  // thẳng thay vì lấy phần tử đầu và bỏ im phần còn lại.
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new ArticleFilterValidationError('authorId không hợp lệ')
  }

  const value = String(raw)
  if (value === AUTHOR_FILTER_NONE) return { kind: 'none' }

  // Chỉ chữ số, không dấu, không khoảng trắng, không ký hiệu khoa học.
  if (!/^[0-9]+$/.test(value)) {
    throw new ArticleFilterValidationError('authorId không hợp lệ')
  }

  const userId = Number(value)
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new ArticleFilterValidationError('authorId không hợp lệ')
  }

  return { kind: 'user', userId }
}
