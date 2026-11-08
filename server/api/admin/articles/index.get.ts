import { finitePositive, MAX_PAGE } from '../../../utils/query-number'
import { articles } from '../../../db/schema'
import { ArticleFilterValidationError, parseAuthorFilter } from '../../../utils/article-filters'
import { likeContains } from '../../../utils/like-pattern'
import { eq, like, sql, isNull } from 'drizzle-orm'
import { articleReadScope } from '../../../services/articles'
import { listAdminArticlesPage } from '../../../services/admin-articles-queries'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  const query = getQuery(event)
  const page = finitePositive(query.page, 1, MAX_PAGE)
  // finitePositive before the floor of 10: `?perPage=abc` was NaN through both clamps (Drizzle then
  // drops LIMIT/OFFSET — every row) and `?perPage=12.5` a LIMIT MySQL refuses, a 500 (FINDING-R7-8).
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

  // The page (view totals from the maintained `articles.view_total`, newest first, id breaking
  // ties), then the count under the same clause — services/admin-articles-queries.ts.
  const { items, total } = await listAdminArticlesPage(whereClause, perPage, offset)

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
