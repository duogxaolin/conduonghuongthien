import { getDb } from '../../../utils/db'
import { articles, users, media } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq, like, desc, sql, count } from 'drizzle-orm'

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

  const db = getDb()

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

  const whereClause = conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined

  const items = await db
    .select({
      id:           articles.id,
      type:         articles.type,
      title:        articles.title,
      slug:         articles.slug,
      excerpt:      articles.excerpt,
      status:       articles.status,
      thumbnailUrl: articles.thumbnailUrl,
      publishedAt:  articles.publishedAt,
      createdAt:    articles.createdAt,
      updatedAt:    articles.updatedAt,
      authorName:   users.username,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .where(whereClause)
    .orderBy(desc(articles.createdAt))
    .limit(perPage)
    .offset(offset)

  const [{ total }] = await db
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
