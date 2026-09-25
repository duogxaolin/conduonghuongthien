import { finitePositive, MAX_PAGE } from '../../utils/query-number'
import { getDb } from '../../utils/db'
import { articles, users, categories, articleTranslations } from '../../db/schema'
import { eq, like, desc, count, inArray, and, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const page = finitePositive(query.page, 1, MAX_PAGE)
    const limit = finitePositive(query.limit, 10, 50)
    const offset = (page - 1) * limit
    const search = String(query.search || '').trim()
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
      conditions.push(like(articles.title, `%${search}%`))
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
     * Cột tổng lượt xem — chỉ chọn khi `sort=views` (khối "Đọc nhiều"). Mọi lượt
     * liệt kê thường không phải trả giá một truy vấn con mỗi hàng cho một cột
     * không ai đọc.
     *
     * Correlated subquery viết TÊN BẢNG THẲNG RA — xem cảnh báo ở
     * `articles/[slug].get.ts` và tests/correlated-subquery-qualification.test.ts:
     * Drizzle chỉ gắn tiền tố tên bảng khi truy vấn bao ngoài CÓ JOIN, nên dạng
     * nội suy `${...}` trong truy vấn con là đúng NHỜ phép join ở trên, và xoá
     * join đi là bộ đếm lặng lẽ báo 0 cho mọi bài mà không gì đỏ.
     *
     * `.as('view_total')` không phải trang trí: MySQL giải `ORDER BY view_total`
     * qua alias của SELECT, mà Drizzle chỉ phát alias khi được bảo tường minh.
     */
    const viewTotalColumn = {
      viewTotal: sql<number>`(
        SELECT COALESCE(SUM(\`v\`.\`real_views\` + \`v\`.\`fabricated_views\`), 0)
        FROM \`article_view_daily\` \`v\`
        WHERE \`v\`.\`article_id\` = \`articles\`.\`id\`
      )`.as('view_total'),
    }

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
          // số lượt xem thì thứ tự ổn định theo thời gian thay vì tuỳ ý.
          [desc(sql`view_total`), desc(articles.publishedAt), desc(articles.createdAt)]
        : [desc(articles.publishedAt), desc(articles.createdAt)]))
      .limit(limit)
      .offset(offset)

    const [{ total } = { total: 0 }] = await db
      .select({ total: count() })
      .from(articles)
      .where(whereClause)

    return {
      ok: true,
      articles: items,
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit)
      }
    }
  } catch {
    return { ok: false, articles: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } }
  }
})
