import { finitePositive, MAX_PAGE } from '../../../utils/query-number'
import { getDb } from '../../../utils/db'
import { articles, users, categories } from '../../../db/schema'
import { ArticleFilterValidationError, parseAuthorFilter } from '../../../utils/article-filters'
import { likeContains } from '../../../utils/like-pattern'
import { eq, like, desc, sql, count, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import { articleReadScope } from '../../../services/articles'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  const query = getQuery(event)
  const page = finitePositive(query.page, 1, MAX_PAGE)
  // finitePositive before the floor of 10: `?perPage=abc` was NaN through both clamps (LIMIT NaN,
  // a 500) and `?perPage=12.5` a LIMIT MySQL refuses (FINDING-R7-8).
  const perPage = Math.max(10, finitePositive(query.perPage || 20, 20, 100))
  const offset = (page - 1) * perPage
  const search = String(query.search || '').trim()
  const typeFilter = String(query.type || '').trim()
  const statusFilter = String(query.status || '').trim()
  const categoryIdFilter = query.categoryId ? Number(query.categoryId) : null
  const translationFilter = String(query.translation || '').trim()

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

  const conditions = [articleReadScope(adminUser, typeFilter)]
  if (search) {
    // The text as typed: `_` and `%` are not wildcards (FINDING-R7-7, as R6-8 for readers).
    conditions.push(like(articles.title, likeContains(search)))
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
  if (translationFilter.startsWith('missing_')) {
    const lang = translationFilter.slice(8)
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM \`article_translations\` \`t\` WHERE \`t\`.\`article_id\` = \`articles\`.\`id\` AND \`t\`.\`lang_code\` = ${lang})`)
  } else if (translationFilter.startsWith('has_')) {
    const lang = translationFilter.slice(4)
    conditions.push(sql`EXISTS (SELECT 1 FROM \`article_translations\` \`t\` WHERE \`t\`.\`article_id\` = \`articles\`.\`id\` AND \`t\`.\`lang_code\` = ${lang})`)
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
       * Total displayed views (real + fabricated) per row — the maintained column
       * (wave2 design D6), equal to the sum of the article's `article_view_daily`
       * rows. It replaced a correlated subquery per row; the real/fabricated split
       * is in the per-article stats modal (`getArticleViewStats`), not here.
       */
      viewTotal:    articles.viewTotal,
      translatedLangs: sql<string>`(
        SELECT COALESCE(GROUP_CONCAT(DISTINCT CONCAT(\`t\`.\`lang_code\`, ':', \`t\`.\`status\`) SEPARATOR ','), '')
        FROM \`article_translations\` \`t\`
        WHERE \`t\`.\`article_id\` = \`articles\`.\`id\`
      )`,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .leftJoin(parentCategories, eq(categories.parentId, parentCategories.id))
    .where(whereClause)
    // `id` breaks ties: articles imported in one second share `created_at`, and MySQL returns tied
    // rows in any order — two pages could share or skip one (FINDING-R7-9, as R6-9).
    .orderBy(desc(articles.createdAt), desc(articles.id))
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
