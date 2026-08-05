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
 */
import { and, asc, count, desc, eq, ne, sql } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { articles, categories } from '../../../../db/schema'
import { getDb } from '../../../../utils/db'
import { rollUpRelatedTopics } from '../../../../utils/related-topics'

/**
 * Bốn thẻ khớp đúng lưới 2 cột của khung xương phía client (2 hàng chẵn). Là
 * hằng số chứ không phải tham số truy vấn: không nơi gọi nào cần một con số
 * khác, và một tham số không ai truyền chỉ là thêm một đường vào phải kiểm.
 */
const RELATED_ARTICLE_LIMIT = 4
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

  try {
    const db = getDb()

    // Bài đang đọc là điểm neo. `status='published'` ở đây cũng quan trọng như ở
    // truy vấn dưới: một bản nháp không được dùng làm mỏ neo để lộ ra chủ đề và
    // các bài lân cận của nó.
    const [current] = await db
      .select({ id: articles.id, type: articles.type, categoryId: articles.categoryId })
      .from(articles)
      .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
      .limit(1)

    if (!current) return empty()

    /**
     * Cùng danh mục lên trước, sau đó lấp tiếp bằng bài cùng thể loại — một
     * truy vấn, không phải hai lượt rồi ghép ở JS.
     *
     * Nhánh `categoryId === null` **phải** bỏ hẳn mệnh đề CASE, không được thay
     * bằng một hằng số: `ORDER BY 1` trong MySQL là "sắp theo cột thứ nhất của
     * SELECT", tức là sắp theo `id` — một lượt sắp xếp sai hoàn toàn mà không có
     * lỗi nào.
     */
    const sameCategoryFirst = current.categoryId === null
      ? []
      : [sql`CASE WHEN ${articles.categoryId} = ${current.categoryId} THEN 0 ELSE 1 END`]
    const order = [...sameCategoryFirst, desc(articles.publishedAt), desc(articles.createdAt)]

    const relatedRows = await db
      .select({
        id:           articles.id,
        title:        articles.title,
        slug:         articles.slug,
        excerpt:      articles.excerpt,
        thumbnailUrl: articles.thumbnailUrl,
        publishedAt:  articles.publishedAt,
        createdAt:    articles.createdAt,
        categoryName: categories.name,
        categorySlug: categories.slug,
      })
      .from(articles)
      .leftJoin(categories, eq(articles.categoryId, categories.id))
      .where(
        and(
          eq(articles.status, 'published'),
          // Cùng thể loại: một câu chuyện tấm gương nằm dưới nhãn "bài viết liên
          // quan" của một bản tin là nói sai về thứ nó là.
          eq(articles.type, current.type),
          // Bài đang đọc không bao giờ là bài liên quan của chính nó.
          ne(articles.id, current.id),
        ),
      )
      .orderBy(...order)
      .limit(RELATED_ARTICLE_LIMIT)

    /**
     * Chủ đề liên quan, đếm bằng **đúng phép đếm mà cú bấm sẽ hiện ra**.
     *
     * `/api/public/articles?categorySlug=` gộp danh mục con vào danh mục gốc,
     * nên một con số chỉ đếm bài gán trực tiếp sẽ báo ít hơn danh sách mà chip
     * đó mở ra. Gộp ở JS (hai truy vấn phẳng) thay vì self-join: rẻ hơn, và
     * tránh luôn chuyện ONLY_FULL_GROUP_BY với cột dùng để sắp thứ tự.
     */
    const [categoryRows, countRows] = await Promise.all([
      db
        .select({
          id:           categories.id,
          name:         categories.name,
          slug:         categories.slug,
          parentId:     categories.parentId,
          displayOrder: categories.displayOrder,
        })
        .from(categories)
        .where(eq(categories.type, current.type))
        .orderBy(asc(categories.displayOrder), asc(categories.id)),
      db
        .select({ categoryId: articles.categoryId, total: count() })
        .from(articles)
        .where(and(eq(articles.status, 'published'), eq(articles.type, current.type)))
        .groupBy(articles.categoryId),
    ])

    const directTotals = new Map<number, number>()
    for (const row of countRows) {
      if (row.categoryId !== null) directTotals.set(row.categoryId, Number(row.total))
    }

    // Phần gộp và xếp thứ tự nằm ở `rollUpRelatedTopics` — hàm thuần, kiểm được
    // bằng bảng danh mục dựng tay thay vì phải có CSDL. Đây là phần sai được
    // trong im lặng, nên nó là phần cần kiểm bằng hành vi chứ không bằng văn bản.
    const topics = rollUpRelatedTopics(categoryRows, directTotals, current.categoryId, RELATED_TOPIC_LIMIT)

    return { ok: true as const, articles: relatedRows, topics }
  } catch {
    // Phân biệt được với "không có gì liên quan": phía client biến `ok: false`
    // thành nhánh lỗi có nút thử lại, còn danh sách rỗng thì ẩn cả khối đi.
    return { ok: false as const, articles: [], topics: [] }
  }
})
