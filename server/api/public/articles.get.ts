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

    // `reintegration` và `reintegration_model` là cùng một thể loại, lưu dưới hai tên.
    const storedTypes = !type
      ? null
      : type === 'reintegration_model' || type === 'reintegration'
        ? ['reintegration', 'reintegration_model']
        : [type]

    const conditions = [eq(articles.status, 'published')]
    if (search) {
      // `%`/`_` khách gõ là chữ thường, không phải ký tự đại diện.
      conditions.push(like(articles.title, containsPattern(search)))
    }
    if (categoryIds) {
      const onlyId = categoryIds.length === 1 ? categoryIds[0] : undefined
      conditions.push(onlyId !== undefined ? eq(articles.categoryId, onlyId) : inArray(articles.categoryId, categoryIds))
    }
    const whereFor = (types: string[] | null) => and(
      ...conditions,
      ...(types ? [types.length === 1 ? eq(articles.type, types[0]!) : inArray(articles.type, types)] : []),
    )
    const whereClause = whereFor(storedTypes)

    const listFields = {
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
    }

    const withTranslation = Boolean(lang && lang !== 'vi')
    const translationJoin = and(
      eq(articleTranslations.articleId, articles.id),
      eq(articleTranslations.langCode, lang),
      inArray(articleTranslations.status, ['published', 'ai_draft', 'reviewed']),
    )
    // Một truy vấn mới mỗi lần gọi — builder của Drizzle đổi tại chỗ khi nối thêm.
    const selectList = () => {
      const query = db.select(listFields).from(articles)
        .leftJoin(users, eq(articles.authorId, users.id))
        .leftJoin(categories, eq(articles.categoryId, categories.id))
      if (withTranslation) query.leftJoin(articleTranslations, translationJoin)
      return query
    }
    const selectRanked = () => {
      const query = db.select({ ...listFields, viewTotal: articles.viewTotal }).from(articles)
        .leftJoin(users, eq(articles.authorId, users.id))
        .leftJoin(categories, eq(articles.categoryId, categories.id))
      if (withTranslation) query.leftJoin(articleTranslations, translationJoin)
      return query
    }

    if (sortByViews) {
      /**
       * "Đọc nhiều" đọc `articles.view_total` (wave2 design D6) — tổng thật + ảo do
       * `server/services/article-views.ts` giữ bằng tổng hàng `article_view_daily`.
       * Trước đây là một truy vấn con cộng hàng theo ngày cho MỌI bài của thể loại,
       * mỗi lượt tải. Chỉ trả tổng gộp — như trước — không bao giờ trả phần thật/ảo.
       *
       * Sắp theo tổng rồi tới ngày đăng (hoà thì thứ tự ổn định theo thời gian),
       * bằng cột của bảng: `articles_status_type_views_idx (status, type,
       * view_total, published_at, created_at)` trả thẳng hàng theo thứ tự đó cho
       * MỘT `type`. Với `type IN (…)` MySQL không đọc theo thứ tự index được
       * (filesort trên mọi bài của các thể loại) — nên một thể loại nhiều tên lưu
       * đọc riêng từng tên, mỗi lượt lấy `offset + limit` hàng đầu theo index, rồi
       * trộn và cắt trang ở đây. Khoá bằng tests/most-read-ranking.test.ts.
       */
      const byViews = [desc(articles.viewTotal), desc(articles.publishedAt), desc(articles.createdAt)]
      type Ranked = Awaited<ReturnType<typeof selectRanked>>[number]
      let items: Ranked[]
      if (storedTypes && storedTypes.length > 1) {
        const perType = await Promise.all(storedTypes.map(storedType =>
          selectRanked().where(whereFor([storedType])).orderBy(...byViews).limit(offset + limit)))
        const time = (value: Date | string | null) => (value == null ? Number.NEGATIVE_INFINITY : new Date(value).getTime())
        items = perType.flat()
          // Cùng thứ tự với ORDER BY ở trên; NULL xếp cuối như DESC của MySQL.
          .sort((a: Ranked, b: Ranked) => (b.viewTotal - a.viewTotal)
            || (time(b.publishedAt) - time(a.publishedAt))
            || (time(b.createdAt) - time(a.createdAt)))
          .slice(offset, offset + limit)
      } else {
        items = await selectRanked().where(whereClause).orderBy(...byViews).limit(limit).offset(offset)
      }

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
        articles: items.map(withPlainTextFields),
        pagination: { page, limit, total: seen, totalPages: Math.ceil(seen / limit) },
      }
    }

    const items = await selectList()
      .where(whereClause)
      .orderBy(desc(articles.publishedAt), desc(articles.createdAt))
      .limit(limit)
      .offset(offset)

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
