import { finitePositive, MAX_PAGE } from '../../utils/query-number'
import { getDb } from '../../utils/db'
import { reportPublicReadFailure } from '../../utils/public-read-failure'
import { withPlainTextFields } from '../../utils/decode-html-entities'
import { containsPattern, MAX_LIKE_QUERY_CHARS } from '../../utils/sql-like'
import { articles, users, categories, articleTranslations } from '../../db/schema'
import { eq, like, desc, count, inArray, and, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const page = finitePositive(query.page, 1, MAX_PAGE)
    const limit = finitePositive(query.limit, 10, 50)
    const offset = (page - 1) * limit
    const search = String(query.search || '').trim().slice(0, MAX_LIKE_QUERY_CHARS)
    const type = String(query.type || '').trim()
    const categorySlug = String(query.categorySlug || '').trim()
    const categoryIdParam = Number(query.categoryId || 0)
    // `sort=views` — xếp theo tổng lượt xem hiển thị (thật + ảo), cho khối "Đọc
    // nhiều" của trang danh mục. Giá trị lạ đọc thành "mới nhất" thay vì đoán hộ.
    const sortByViews = String(query.sort || '').trim() === 'views'
    const cookieLang = getCookie(event, 'cdkt_lang')?.trim().toLowerCase() || ''
    const lang = (typeof query.lang === 'string' ? query.lang.trim().toLowerCase() : '') || cookieLang
    const db = getDb()

    // Resolve category filter → set of category IDs (root includes its children).
    let categoryIds: number[] | null = null
    if (categorySlug || categoryIdParam) {
      const [target] = await db
        .select({ id: categories.id, parentId: categories.parentId })
        .from(categories)
        .where(categorySlug ? eq(categories.slug, categorySlug) : eq(categories.id, categoryIdParam))
        .limit(1)

      if (!target) {
        // Unknown category → empty result, not an error.
        return {
          ok: true,
          articles: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        }
      }

      if (target.parentId === null) {
        // Root category: include the root and all its children.
        const children = await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.parentId, target.id))
        categoryIds = [target.id, ...children.map((c) => c.id)]
      } else {
        categoryIds = [target.id]
      }
    }

    const conditions = [eq(articles.status, 'published')]
    if (search) {
      // `%`/`_` khách gõ là chữ thường, không phải ký tự đại diện.
      conditions.push(like(articles.title, containsPattern(search)))
    }
    if (type) {
      if (type === 'reintegration_model' || type === 'reintegration') {
        conditions.push(inArray(articles.type, ['reintegration', 'reintegration_model']))
      } else {
        conditions.push(eq(articles.type, type))
      }
    }
    if (categoryIds) {
      const onlyId = categoryIds.length === 1 ? categoryIds[0] : undefined
      conditions.push(onlyId !== undefined ? eq(articles.categoryId, onlyId) : inArray(articles.categoryId, categoryIds))
    }

    const whereClause = and(...conditions)

    /**
     * Cột tổng lượt xem — chỉ chọn khi `sort=views` (khối "Đọc nhiều"); danh sách
     * thường không hiện nó.
     *
     * Đọc `articles.view_total` (wave2 design D6): cột sinh STORED = thật + ảo,
     * được `server/services/article-views.ts` giữ bằng tổng các hàng
     * `article_view_daily` trong cùng transaction. Trước đây đây là một truy vấn
     * con cộng hàng theo ngày cho MỌI bài đã xuất bản của thể loại, mỗi lượt tải.
     * Chỉ trả tổng gộp — như trước — không bao giờ trả phần thật/ảo riêng.
     */
    const viewTotalColumn = { viewTotal: articles.viewTotal }

    const itemsQuery = db
      .select({
        id:           articles.id,
        type:         articles.type,
        category:     articles.category,
        categoryId:   articles.categoryId,
        categoryName: categories.name,
        categorySlug: categories.slug,
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
        authorName:   users.username,
        ...(sortByViews ? viewTotalColumn : {}),
      })
      .from(articles)
      .leftJoin(users, eq(articles.authorId, users.id))
      .leftJoin(categories, eq(articles.categoryId, categories.id))

    if (lang && lang !== 'vi') {
      itemsQuery.leftJoin(
        articleTranslations,
        and(
          eq(articleTranslations.articleId, articles.id),
          eq(articleTranslations.langCode, lang),
          inArray(articleTranslations.status, ['published', 'ai_draft', 'reviewed']),
        ),
      )
    }

    const items = await itemsQuery
      .where(whereClause)
      .orderBy(...(sortByViews
        ? // Sắp theo tổng lượt xem rồi mới đến ngày đăng — đề phòng một bài cùng
          // số lượt xem thì thứ tự ổn định theo thời gian thay vì tuỳ ý. Cột của
          // bảng, không phải alias: MySQL dùng được `articles_status_type_views_idx`.
          [desc(articles.viewTotal), desc(articles.publishedAt), desc(articles.createdAt)]
        : [desc(articles.publishedAt), desc(articles.createdAt)]))
      .limit(limit)
      .offset(offset)

    if (sortByViews) {
      /**
       * "Đọc nhiều" là một bảng xếp hạng top-N (khối 6 bài), không phải danh sách
       * phân trang: không chạy `COUNT(*)` (wave2 design D6). `total` vì thế đếm
       * số bài TỚI HẾT trang này (`offset + số bài trả về`) — đúng khi đã hết bảng
       * xếp hạng, là CẬN DƯỚI khi trang đầy. Ai cần tổng thật thì gọi không kèm
       * `sort=views`. Khoá bằng tests/most-read-ranking.test.ts.
       */
      const seen = offset + items.length
      return {
        ok: true,
        articles: items.map(article => withPlainTextFields({ ...article, viewTotal: Number(article.viewTotal ?? 0) })),
        pagination: { page, limit, total: seen, totalPages: Math.ceil(seen / limit) },
      }
    }

    const [{ total } = { total: 0 }] = await db
      .select({ total: count() })
      .from(articles)
      .where(whereClause)

    return {
      ok: true,
      articles: items.map(withPlainTextFields),
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit)
      }
    }
  } catch (error) {
    reportPublicReadFailure(event, 'public.articles_list_failed', error)
    return { ok: false, articles: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } }
  }
})
