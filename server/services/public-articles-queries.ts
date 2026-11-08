/**
 * Queries of the public article endpoints — the list (`articles.get.ts`), one article
 * (`articles/[slug].get.ts`) and the anchor lookup of a view (`articles/[slug]/view.post.ts`,
 * shared by `comments/index.post.ts`) — moved out of the handlers verbatim: the same
 * statements, in the same order.
 *
 * The handlers keep everything else: reading the query and the `cdkt_lang` cookie, the page
 * clamps, the 404 / 500 mapping and `reportPublicReadFailure()` (503 + `no-store`) around these
 * calls, `withPlainTextFields` / `plainTextField`, `sanitizeHtml` on a translation read, and the
 * shape of every response.
 */
import { and, count, desc, eq, inArray, like, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { containsPattern } from '../utils/sql-like'
import { articles, articleTranslations, categories, users } from '../db/schema'

/** What `GET /api/public/articles` asks for, after its own parsing and clamping. */
export interface PublicArticleListParams {
  sortByViews: boolean
  limit: number
  offset: number
  search: string
  type: string
  categorySlug: string
  categoryIdParam: number
  lang: string
}

/**
 * One page of the public list. `unknown-category`: the category filter names nothing (an empty
 * page, not an error); `ranked`: `sort=views`, no COUNT; `list`: newest first, with the COUNT.
 */
export async function queryPublicArticleList(params: PublicArticleListParams) {
  const { sortByViews, limit, offset, search, type, categorySlug, categoryIdParam, lang } = params
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
      return { kind: 'unknown-category' as const }
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

    // "Đọc nhiều" là một bảng xếp hạng top-N (khối 6 bài), không phải danh sách phân
    // trang: không chạy `COUNT(*)` (wave2 design D6) — `total` do handler suy ra.
    return { kind: 'ranked' as const, items }
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

  return { kind: 'list' as const, items, total }
}

/** `GET /api/public/articles/:slug`: the published article with that slug, or undefined. */
export async function findPublishedArticleBySlug(slug: string) {
  const db = getDb()
  const [found] = await db
    .select({
      id:           articles.id,
      type:         articles.type,
      category:     articles.category,
      categoryId:   articles.categoryId,
      categoryName: categories.name,
      categorySlug: categories.slug,
      title:        articles.title,
      slug:         articles.slug,
      excerpt:      articles.excerpt,
      content:      articles.content,
      thumbnailUrl: articles.thumbnailUrl,
      publishedAt:  articles.publishedAt,
      createdAt:    articles.createdAt,
      authorName:   users.username,
      // Displayed total (real + fabricated), read from the maintained column
      // (wave2 design D6) instead of summing `article_view_daily` per request.
      // Never the real/fabricated split.
      viewTotal:    articles.viewTotal,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
    .limit(1)
  return found
}

/** The article's translation in `lang` that a reader may be shown (published, AI draft or reviewed). */
export async function findReadableArticleTranslation(articleId: number, lang: string) {
  const db = getDb()
  const [translation] = await db
    .select({
      title:   articleTranslations.title,
      excerpt: articleTranslations.excerpt,
      content: articleTranslations.content,
      status:  articleTranslations.status,
    })
    .from(articleTranslations)
    .where(and(
      eq(articleTranslations.articleId, articleId),
      eq(articleTranslations.langCode, lang),
      inArray(articleTranslations.status, ['published', 'ai_draft', 'reviewed']),
    ))
    .limit(1)
  return translation
}

/** Languages the article has a PUBLISHED translation in. */
export async function listPublishedTranslationLangs(articleId: number) {
  const db = getDb()
  const availableRows = await db
    .select({ langCode: articleTranslations.langCode })
    .from(articleTranslations)
    .where(and(
      eq(articleTranslations.articleId, articleId),
      eq(articleTranslations.status, 'published'),
    ))
  return availableRows
}

/** The id of the published article with that slug (a view's anchor, a comment's target), or undefined. */
export async function findPublishedArticleIdBySlug(slug: string) {
  const db = getDb()
  const [article] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
    .limit(1)
  return article
}
