/**
 * Tra bài viết công khai cho chatbot — MỘT đường cho cả hai nơi dùng.
 *
 * Tách khỏi `chat-policy-provider.ts` khi tệp đó vượt 400 dòng (ratchet file-length):
 * phần này là đọc-dữ-liệu thuần, không giữ trạng thái nào của lượt gọi, nên cắt ra không
 * phải "chia để đối phó" mà là đúng ranh giới đã có (cùng lý do `article-search.ts` và
 * `media-search.ts` đã tách từ trước).
 *
 * Hai nơi dùng: công cụ `search_c11_articles` (model tự gọi) và khối nạp sẵn trong
 * `callProvider`. Một hàm, không hai bản — nếu tách làm hai, bản này sẽ có ảnh bìa/URL
 * khác bản kia và cùng một câu hỏi cho hai câu trả lời khác nhau.
 */
import { articles } from '../db/schema'
import { getDb } from '../utils/db'
import { buildArticleSearch } from '../utils/chatbot/article-search'
import { decodeHtmlEntities, plainTextField } from '../utils/decode-html-entities'

/** URL của kho lưu theo loại bài — dùng chung cho tool và khối nạp sẵn. */
export const ARTICLE_ARCHIVE_URL: Record<string, string> = {
  reintegration: '/news/reintegration-models',
  role_model: '/news/role-models',
  news: '/news',
  document: '/documents',
  faq: '/legal-qa',
}

/**
 * Ảnh bìa mặc định của cổng (`services/articles-thumbnail-scan.ts` đồng bộ 492 bài
 * về đúng đường dẫn này). Nó KHÔNG phải ảnh của bài: đưa nó cho model thì câu trả
 * lời nhúng `![Ảnh minh họa](/assets/default_cover_light.png)` — ảnh vỡ — và người
 * đọc thấy một khung ảnh trống không thuộc về bài nào. Với tool, "không có ảnh bìa"
 * phải là `null`, giống hệt bài chưa đặt ảnh.
 */
export const DEFAULT_COVER_URL = '/assets/default_cover_light.png'

export interface ArticleHit {
  /**
   * `articles.id`. The citizen never sees it; the model uses it as a stable handle when
   * the same article comes back twice in one turn. Dropping it from the projection is
   * invisible to any assertion that only reads title/url — one refactor did drop it, so
   * `tests/chat-policy-seams-behavior.test.ts` now pins it.
   */
  id: number
  title: string
  type: string
  url: string
  /** Sapo đã giải mã entity; `null` khi bài không có sapo. */
  summary: string | null
  snippet: string
  coverImage: string | null
  categoryArchiveUrl: string
}

/**
 * Tra bài viết công khai theo cùng một đường cho cả hai nơi dùng: công cụ
 * `search_c11_articles` (model tự gọi) và khối nạp sẵn trong prompt
 * (`prefetchedArticles`, xem `callProvider`). Một hàm, không hai bản — nếu tách làm
 * hai, bản này sẽ có ảnh bìa/URL khác bản kia và cùng một câu hỏi cho hai câu trả lời
 * khác nhau.
 *
 * Không bao giờ ném: truy vấn hỏng chỉ có nghĩa là lượt này không có bài nào.
 */
export async function searchArticles(rawQuery: string, type: string | null, limit: number): Promise<ArticleHit[]> {
  const query = rawQuery.trim()
  if (!query) return []
  try {
    // Toàn bộ điều kiện và thứ tự sắp xếp do `buildArticleSearch` dựng — chuỗi
    // tìm kiếm chỉ đi vào tham số của câu lệnh (xem article-search.ts).
    const search = buildArticleSearch(query, type)
    const rows = await getDb().select({
      id: articles.id,
      title: articles.title,
      type: articles.type,
      slug: articles.slug,
      excerpt: articles.excerpt,
      content: articles.content,
      thumbnailUrl: articles.thumbnailUrl,
    }).from(articles)
      .where(search.where)
      .orderBy(...search.orderBy)
      .limit(limit)

    return rows.map((r) => {
      // Stored HTML (and imported excerpts) carry entities such as `Ng&agrave;y`: decode
      // after stripping tags, so the model reads — and echoes — real Vietnamese.
      const plainContent = decodeHtmlEntities((r.content || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
      const summary = plainTextField(r.excerpt)
      const snippet = plainContent ? plainContent.slice(0, 350) + (plainContent.length > 350 ? '...' : '') : (summary || '')
      return {
        id: r.id,
        title: plainTextField(r.title) ?? '',
        type: r.type,
        url: `/news/${r.slug}`,
        summary,
        snippet,
        coverImage: r.thumbnailUrl && r.thumbnailUrl !== DEFAULT_COVER_URL ? r.thumbnailUrl : null,
        categoryArchiveUrl: ARTICLE_ARCHIVE_URL[r.type] || '/news',
      }
    })
  } catch {
    return []
  }
}

