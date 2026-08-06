import { getDb } from '../../../utils/db'
import { articles, users, categories, articleViewDaily } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { ArticleFilterValidationError, parseAuthorFilter } from '../../../utils/article-filters'
import { eq, like, desc, sql, count, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'news', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page || 1))
  const perPage = Math.min(100, Math.max(10, Number(query.perPage || 20)))
  const offset = (page - 1) * perPage
  const search = String(query.search || '').trim()
  const typeFilter = String(query.type || '').trim()
  const statusFilter = String(query.status || '').trim()
  const categoryIdFilter = query.categoryId ? Number(query.categoryId) : null

  /**
   * Bộ lọc theo người đăng bài. Giá trị lạ bị từ chối chứ không suy diễn — xem
   * `server/utils/article-filters.ts`.
   */
  let authorFilter
  try {
    authorFilter = parseAuthorFilter(query.authorId)
  } catch (err) {
    if (err instanceof ArticleFilterValidationError) {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }

  const db = getDb()
  const parentCategories = alias(categories, 'parentCategories')

  const conditions = []
  if (search) {
    conditions.push(like(articles.title, `%${search}%`))
  }
  if (typeFilter) {
    conditions.push(eq(articles.type, typeFilter))
  }
  if (statusFilter) {
    conditions.push(eq(articles.status, statusFilter))
  }
  if (categoryIdFilter) {
    conditions.push(eq(articles.categoryId, categoryIdFilter))
  }
  /**
   * Lọc trên `articles.author_id`, KHÔNG trên `users.username`: truy vấn đếm ở
   * dưới dùng chung `whereClause` nhưng `.from(articles)` không có join nào, nên
   * một điều kiện trỏ vào bảng `users` sẽ làm câu đếm hỏng — danh sách ra đúng mà
   * số trang thì sai. Cột này cũng đã có khoá ngoại `fk_articles_author`.
   */
  if (authorFilter.kind === 'user') {
    conditions.push(eq(articles.authorId, authorFilter.userId))
  } else if (authorFilter.kind === 'none') {
    conditions.push(isNull(articles.authorId))
  }

  const whereClause = conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined

  const items = await db
    .select({
      id:           articles.id,
      type:         articles.type,
      category:     articles.category,
      categoryId:       articles.categoryId,
      categoryName:     categories.name,
      categoryParentId: categories.parentId,
      parentCategoryName: parentCategories.name,
      title:        articles.title,
      slug:         articles.slug,
      excerpt:      articles.excerpt,
      status:       articles.status,
      thumbnailUrl: articles.thumbnailUrl,
      commentsEnabled: articles.commentsEnabled,
      publishedAt:  articles.publishedAt,
      createdAt:    articles.createdAt,
      updatedAt:    articles.updatedAt,
      authorName:   users.username,
      /**
       * Total displayed views (real + fabricated) per row.
       *
       * A correlated subquery rather than a fourth left join: `article_view_daily`
       * holds one row per day per source, so joining it would fan each article
       * out into many rows and `limit`/`offset` would then paginate view rows
       * instead of articles. Still one statement for the whole page — the
       * per-row fetch this replaces would be N+1 on a list that already joins
       * three tables. Articles with no views report 0, not null.
       *
       * ⚠️ Tên bảng viết THẲNG RA, không nội suy `${articleViewDaily.articleId}`.
       * Drizzle chỉ gắn tiền tố tên bảng khi truy vấn bao ngoài CÓ JOIN; không có
       * join thì nó phát ra tên cột trần, và trong một truy vấn con trên
       * `article_view_daily` thì `` \`id\` `` trần trỏ vào khoá chính của chính
       * bảng đó chứ không phải bài viết ở ngoài — tương quan lặng lẽ ngừng tương
       * quan, MySQL không báo gì, và mọi bài đều trả về 0. Ở đây hiện có join nên
       * dạng nội suy vẫn đúng; nó chỉ đúng NHỜ một phần khác của truy vấn, và xoá
       * join đi là hỏng bộ đếm mà không có gì đỏ. Xem
       * tests/correlated-subquery-qualification.test.ts.
       */
      viewTotal: sql<number>`(
        SELECT COALESCE(SUM(\`v\`.\`real_views\` + \`v\`.\`fabricated_views\`), 0)
        FROM \`article_view_daily\` \`v\`
        WHERE \`v\`.\`article_id\` = \`articles\`.\`id\`
      )`,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .leftJoin(parentCategories, eq(categories.parentId, parentCategories.id))
    .where(whereClause)
    .orderBy(desc(articles.createdAt))
    .limit(perPage)
    .offset(offset)

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(articles)
    .where(whereClause)

  return {
    ok: true,
    items,
    pagination: {
      page,
      perPage,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / perPage)
    }
  }
})
