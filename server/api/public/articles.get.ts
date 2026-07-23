import { getDb } from '../../utils/db'
import { articles, users } from '../../db/schema'
import { eq, like, desc, sql, count } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const page = Math.max(1, Number(query.page || 1))
    const limit = Math.min(50, Math.max(1, Number(query.limit || 10)))
    const offset = (page - 1) * limit
    const search = String(query.search || '').trim()
    const type = String(query.type || '').trim()

    const db = getDb()

    const conditions = [eq(articles.status, 'published')]
    if (search) {
      conditions.push(like(articles.title, `%${search}%`))
    }
    if (type) {
      conditions.push(eq(articles.type, type))
    }

    const whereClause = sql`${sql.join(conditions, sql` AND `)}`

    const items = await db
      .select({
        id:           articles.id,
        type:         articles.type,
        category:     articles.category,
        title:        articles.title,
        slug:         articles.slug,
        excerpt:      articles.excerpt,
        thumbnailUrl: articles.thumbnailUrl,
        publishedAt:  articles.publishedAt,
        createdAt:    articles.createdAt,
        authorName:   users.username,
      })
      .from(articles)
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(whereClause)
      .orderBy(desc(articles.publishedAt), desc(articles.createdAt))
      .limit(limit)
      .offset(offset)

    const [{ total }] = await db
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
  } catch (err: any) {
    return { ok: false, articles: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } }
  }
})
