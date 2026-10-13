import { sanitizeHtml } from './sanitize-html'

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
 * `content` là HTML; `title`/`excerpt` hiển thị bằng nội suy `{{ }}` nên được
 * Vue tự escape.
 */
export function sanitizeTranslationFields<T extends { content?: string | null }>(fields: T): T {
  if (typeof fields.content !== 'string') return fields
  return { ...fields, content: sanitizeHtml(fields.content) }
}
