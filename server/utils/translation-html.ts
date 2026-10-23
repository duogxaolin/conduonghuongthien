import { sanitizeHtml } from './sanitize-html'
import { decodePlainTextInput } from './decode-html-entities'

/**
 * Nội dung bản dịch bài viết được trang công khai hiển thị bằng `v-html`, y như
 * bài gốc — nhưng bài gốc được `sanitizeHtml` lúc ghi còn bản dịch thì không, ở
 * cả hai đường: biên tập viên sửa tay (`updateTranslation`) và AI dịch (worker
 * ghi `translatedChunks.join('')`). Một biên tập viên có quyền `news.update`, hoặc
 * một model bị dẫn dắt bởi chính nội dung bài đang dịch, cài được script chạy
 * trên trang của mọi người đọc.
 *
 * Mọi nơi ghi cột `content` của `article_translations` phải đi qua hàm này
 * (`tests/security-translation-html.test.ts` quét và chặn nơi nào bỏ sót). Chỉ
 * `content` là HTML. `title`/`excerpt` là văn bản thuần, hiện giờ hiển thị bằng
 * nội suy `{{ }}` nên Vue tự escape — nhưng đó là một tính chất của nơi hiển thị,
 * không phải của dữ liệu: chỉ cần một chỗ dùng `v-html`, JSON-LD hay email là
 * `<script>` trong tiêu đề thành lỗ hổng. Nên cũng gỡ thẻ HTML khỏi hai trường này
 * lúc ghi (phòng thủ chiều sâu).
 */

/** Dạng thẻ HTML: `<tag ...>`, `</tag>`, `<!-- -->`. `a < b` hay `5 <3` KHÔNG khớp (sau `<` phải là chữ cái, `/` hoặc `!`). */
const TAG_LIKE = /<\/?[a-zA-Z!][^>]*>/g

/** Gỡ thẻ HTML khỏi văn bản thuần; lặp tới khi hết để `<scr<script>ipt>` không tái tạo thẻ sau một lượt. */
export function stripMarkup(value: string): string {
  let current = value
  for (let i = 0; i < 10; i += 1) {
    const next = current.replace(TAG_LIKE, '')
    if (next === current) break
    current = next
  }
  return current
}

export function sanitizeTranslationFields<T extends { content?: string | null; title?: string | null; excerpt?: string | null }>(fields: T): T {
  const hasText = typeof fields.title === 'string' || typeof fields.excerpt === 'string'
  if (typeof fields.content !== 'string' && !hasText) return fields
  const out: T = { ...fields }
  if (typeof fields.content === 'string') out.content = sanitizeHtml(fields.content)
  // Decode entities FIRST, then strip: `&lt;b&gt;` must not survive as `<b>`.
  if (typeof fields.title === 'string') out.title = stripMarkup(decodePlainTextInput(fields.title))
  if (typeof fields.excerpt === 'string') out.excerpt = stripMarkup(decodePlainTextInput(fields.excerpt))
  return out
}
