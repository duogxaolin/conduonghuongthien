import { finitePositive, MAX_PAGE } from '../../../../utils/query-number'
import { getDb } from '../../../../utils/db'
import { articles, users, categories } from '../../../../db/schema'
import { eq, desc, count } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'read')

  const categoryId = Number(getRouterParam(event, 'id'))
  if (!categoryId) throw createError({ statusCode: 400, statusMessage: 'Invalid category ID' })

  const db = getDb()

  // Verify category exists
  const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1)
  if (!cat) {
    throw createError({ statusCode: 404, statusMessage: 'Danh mục không tồn tại.' })
  }

  const query = getQuery(event)
  const page = finitePositive(query.page, 1, MAX_PAGE)
  const perPage = Math.min(100, Math.max(10, Number(query.perPage || 20)))
  const offset = (page - 1) * perPage

  const items = await db
    .select({
      id:           articles.id,
      type:         articles.type,
      title:        articles.title,
      slug:         articles.slug,
      status:       articles.status,
      thumbnailUrl: articles.thumbnailUrl,
      publishedAt:  articles.publishedAt,
      createdAt:    articles.createdAt,
      authorName:   users.username,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .where(eq(articles.categoryId, categoryId))
    .orderBy(desc(articles.createdAt))
    .limit(perPage)
    .offset(offset)

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(articles)
    .where(eq(articles.categoryId, categoryId))

  return {
    ok: true,
    category: cat,
    items,
    pagination: {
      page,
      perPage,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / perPage),
    },
  }
})
