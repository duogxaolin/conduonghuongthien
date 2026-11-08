/**
 * Nội dung liên quan cho một bài viết: bài cùng chủ đề và danh sách chủ đề.
 *
 * Trang chi tiết kết thúc ngay sau phần thân bài, nên người đọc xong một bài
 * không có đường đi tiếp nào ngoài nút "quay lại danh sách". Endpoint này trả về
 * hai thứ khác nhau và cố ý đi cùng một lượt fetch: bài viết liên quan (câu trả
 * lời cho "đọc gì tiếp") và chủ đề liên quan (câu trả lời cho "còn gì trong
 * nhóm này").
 *
 * Slug lạ trả về danh sách rỗng chứ **không** `createError`: đây là khối phụ của
 * một trang đã tự xử lý 404 của chính nó, và một lỗi ở đây sẽ biến một bài viết
 * đọc được thành một trang lỗi. `ok: false` chỉ dành cho lượt truy vấn hỏng —
 * bề mặt phải phân biệt được "hỏng" với "không có gì liên quan".
 *
 * Các truy vấn (điểm neo, bài liên quan, hai lượt đọc phẳng cho chip chủ đề) nằm ở
 * `server/services/public-article-related-queries.ts`.
 */
import { defineEventHandler, getRouterParam, getQuery, getCookie } from 'h3'
import { reportPublicReadFailure } from '../../../../utils/public-read-failure'
import { withPlainTextFields } from '../../../../utils/decode-html-entities'
import { rollUpRelatedTopics } from '../../../../utils/related-topics'
import { findRelatedAnchor, listRelatedArticles, listRelatedTopicRows } from '../../../../services/public-article-related-queries'

/** Số chip chủ đề tối đa (số thẻ bài liên quan: `RELATED_ARTICLE_LIMIT` ở service). */
const RELATED_TOPIC_LIMIT = 12

/**
 * Hàm chứ không phải hằng số dùng chung: một object cấp module được trả về cho
 * mọi request là một mảng mà bất cứ ai cũng có thể đẩy phần tử vào, và lỗi đó sẽ
 * hiện ra dưới dạng nội dung liên quan của bài này rò sang bài khác.
 */
const empty = () => ({ ok: true as const, articles: [], topics: [] })


export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) return empty()

  const query = getQuery(event)
  const cookieLang = getCookie(event, 'cdkt_lang')?.trim().toLowerCase() || ''
  const lang = (typeof query.lang === 'string' ? query.lang.trim().toLowerCase() : '') || cookieLang
  try {
    const current = await findRelatedAnchor(slug)

    if (!current) return empty()

    const relatedRows = await listRelatedArticles(current, lang)
    const { categoryRows, countRows } = await listRelatedTopicRows(current.type)

    const directTotals = new Map<number, number>()
    for (const row of countRows) {
      if (row.categoryId !== null) directTotals.set(row.categoryId, Number(row.total))
    }

    // Phần gộp và xếp thứ tự nằm ở `rollUpRelatedTopics` — hàm thuần, kiểm được
    // bằng bảng danh mục dựng tay thay vì phải có CSDL. Đây là phần sai được
    // trong im lặng, nên nó là phần cần kiểm bằng hành vi chứ không bằng văn bản.
    const topics = rollUpRelatedTopics(categoryRows, directTotals, current.categoryId, RELATED_TOPIC_LIMIT)

    return { ok: true as const, articles: relatedRows.map(withPlainTextFields), topics }
  } catch (error) {
    // Phân biệt được với "không có gì liên quan": phía client biến `ok: false`
    // thành nhánh lỗi có nút thử lại, còn danh sách rỗng thì ẩn cả khối đi.
    // Kèm log + 503 (không phải 200): lượt hỏng phải để lại dấu vết cho người
    // vận hành và không được bộ đệm nào lưu như một phản hồi hợp lệ.
    reportPublicReadFailure(event, 'public.article_related_failed', error)
    return { ok: false as const, articles: [], topics: [] }
  }
})
