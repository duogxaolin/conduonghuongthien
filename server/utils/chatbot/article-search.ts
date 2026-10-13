import { and, desc, eq, like, or, sql, type SQL } from 'drizzle-orm'
import { articles } from '../../db/schema'
import { containsPattern, escapeLikeWildcards } from '../sql-like'

/**
 * Truy vấn tìm bài viết cho công cụ `search_c11_articles` của chatbot.
 *
 * Chuỗi tìm kiếm do **model** truyền vào, mà khách truy cập dẫn dắt được model
 * bằng nội dung câu hỏi (prompt injection) — tức là không cần đăng nhập vẫn điều
 * khiển được từng ký tự của nó. Bản cũ ghép chuỗi này thẳng vào `sql.raw(...)` của
 * mệnh đề ORDER BY sau khi chỉ loại `"` và `\`: dấu `'` đi qua, nên
 * `x' OR SLEEP(5) -- ` thoát khỏi chuỗi LIKE và chạy như SQL.
 *
 * Mọi giá trị từ người dùng giờ chỉ đi vào **tham số** (`?`) của câu lệnh, không
 * bao giờ vào chuỗi SQL. Phần duy nhất còn đi qua `sql.raw` là hằng số trọng số
 * (10/3/30) viết cứng trong tệp này.
 */

const STOP_WORDS = new Set(['cho', 'tôi', 'hỏi', 'với', 'được', 'không', 'nào', 'các', 'của', 'là', 'gì', 'thế', 'ở', 'đó', 'có', 'thì', 'xin'])

/** Điểm liên quan: tiêu đề khớp từ khoá, trích dẫn khớp từ khoá, tiêu đề chứa nguyên cụm. */
const SCORE_TITLE = 10
const SCORE_EXCERPT = 3
const SCORE_EXACT_TITLE = 30

/** Từ khoá chỉ gồm chữ và số: mọi ký tự khác (kể cả `'`, `%`, `_`) thành khoảng trắng. */
export function articleSearchKeywords(rawQuery: string): string[] {
  return rawQuery
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 2 && !STOP_WORDS.has(word))
}

// Giữ tên cũ cho nơi đã import; một bản duy nhất nằm ở `server/utils/sql-like.ts`.
export { escapeLikeWildcards }
const contains = containsPattern

/** Hằng số trọng số — luôn là số nguyên viết cứng, không bao giờ là dữ liệu người dùng. */
const weight = (points: 3 | 10 | 30): SQL => sql.raw(String(points))

const scoreIf = (column: typeof articles.title | typeof articles.excerpt, pattern: string, points: 3 | 10 | 30): SQL =>
  sql`(CASE WHEN LOWER(${column}) LIKE ${pattern} THEN ${weight(points)} ELSE 0 END)`

export type ArticleSearchPlan = {
  where: SQL
  orderBy: SQL[]
}

/**
 * Điều kiện lọc + thứ tự sắp xếp cho một lượt tìm bài viết đã xuất bản.
 * Trả về cấu trúc, không chạm DB — nên kiểm được bằng cách biên dịch sang SQL.
 */
export function buildArticleSearch(rawQuery: string, type: string | null): ArticleSearchPlan {
  const query = rawQuery.trim()
  const conditions: SQL[] = [eq(articles.status, 'published')]
  if (type) conditions.push(eq(articles.type, type))

  const keywords = articleSearchKeywords(query)
  if (keywords.length > 0) {
    conditions.push(or(
      ...keywords.flatMap(keyword => [
        like(articles.title, contains(keyword)),
        like(articles.excerpt, contains(keyword)),
        like(articles.content, contains(keyword)),
      ]),
    )!)

    const parts: SQL[] = [
      ...keywords.map(keyword => scoreIf(articles.title, contains(keyword), SCORE_TITLE)),
      ...keywords.map(keyword => scoreIf(articles.excerpt, contains(keyword), SCORE_EXCERPT)),
      scoreIf(articles.title, contains(query.toLowerCase()), SCORE_EXACT_TITLE),
    ]
    const relevance = sql`(${sql.join(parts, sql` + `)})`
    return { where: and(...conditions)!, orderBy: [sql`${relevance} DESC`, desc(articles.publishedAt)] }
  }

  if (query) {
    conditions.push(or(
      like(articles.title, contains(query)),
      like(articles.excerpt, contains(query)),
      like(articles.content, contains(query)),
    )!)
  }
  return { where: and(...conditions)!, orderBy: [desc(articles.publishedAt)] }
}
