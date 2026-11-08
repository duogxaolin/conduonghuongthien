/**
 * Queries of `GET /api/public/articles/:slug/related` (`articles/[slug]/related.get.ts`), moved
 * out of the handler verbatim: the anchor lookup, the related-article list and the two flat reads
 * the topic chips are rolled up from — the same statements, in the same order (the last two still
 * started together).
 *
 * The handler keeps the empty answer for a missing slug or anchor, the roll-up
 * (`rollUpRelatedTopics`), the response, and `reportPublicReadFailure()` (503 + `no-store`)
 * around these calls.
 */
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articles, articleTranslations, categories } from '../db/schema'

/**
 * Bốn thẻ khớp đúng lưới 2 cột của khung xương phía client (2 hàng chẵn). Là
 * hằng số chứ không phải tham số truy vấn: không nơi gọi nào cần một con số
 * khác, và một tham số không ai truyền chỉ là thêm một đường vào phải kiểm.
 */
const RELATED_ARTICLE_LIMIT = 4

/** The article being read — published only — or undefined. */
export async function findRelatedAnchor(slug: string) {
  const db = getDb()

  // Bài đang đọc là điểm neo. `status='published'` ở đây cũng quan trọng như ở
  // truy vấn dưới: một bản nháp không được dùng làm mỏ neo để lộ ra chủ đề và
  // các bài lân cận của nó.
  const [current] = await db
    .select({ id: articles.id, type: articles.type, categoryId: articles.categoryId })
    .from(articles)
    .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
    .limit(1)

  return current
}

/** Up to four published articles of the anchor's type, its own category first, never itself. */
export async function listRelatedArticles(
  current: { id: number, type: string, categoryId: number | null },
  lang: string,
) {
  const db = getDb()

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

  const relatedQuery = db
    .select({
      id:           articles.id,
      title:        lang && lang !== 'vi'
        ? sql<string>`COALESCE(NULLIF(${articleTranslations.title}, ''), ${articles.title})`
        : articles.title,
      slug:         articles.slug,
      excerpt:      lang && lang !== 'vi'
        ? sql<string>`COALESCE(NULLIF(${articleTranslations.excerpt}, ''), ${articles.excerpt})`
        : articles.excerpt,
      thumbnailUrl: articles.thumbnailUrl,
      publishedAt:  articles.publishedAt,
      createdAt:    articles.createdAt,
      categoryName: categories.name,
      categorySlug: categories.slug,
    })
    .from(articles)
    .leftJoin(categories, eq(articles.categoryId, categories.id))

  if (lang && lang !== 'vi') {
    relatedQuery.leftJoin(
      articleTranslations,
      and(
        eq(articleTranslations.articleId, articles.id),
        eq(articleTranslations.langCode, lang),
        inArray(articleTranslations.status, ['published', 'ai_draft', 'reviewed']),
      ),
    )
  }

  const relatedRows = await relatedQuery
    .where(
      and(
        eq(articles.status, 'published'),
        eq(articles.type, current.type),
        ne(articles.id, current.id),
      ),
    )
    .orderBy(...order)
    .limit(RELATED_ARTICLE_LIMIT)

  return relatedRows
}

/**
 * The categories of `type` and the published-article count per category — the two flat reads
 * the handler rolls the topic chips up from, started together as before.
 */
export async function listRelatedTopicRows(type: string) {
  const db = getDb()

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
      .where(eq(categories.type, type))
      .orderBy(asc(categories.displayOrder), asc(categories.id)),
    db
      .select({ categoryId: articles.categoryId, total: count() })
      .from(articles)
      .where(and(eq(articles.status, 'published'), eq(articles.type, type)))
      .groupBy(articles.categoryId),
  ])

  return { categoryRows, countRows }
}
