import { finitePositive, MAX_PAGE } from '../../utils/query-number'
import { getDb } from '../../utils/db'
import { articles, users, categories } from '../../db/schema'
import { eq, like, desc, count, inArray, and } from 'drizzle-orm'

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
      conditions.push(eq(articles.type, type))
    }
    if (categoryIds) {
      const onlyId = categoryIds.length === 1 ? categoryIds[0] : undefined
      conditions.push(onlyId !== undefined ? eq(articles.categoryId, onlyId) : inArray(articles.categoryId, categoryIds))
    }

    const whereClause = and(...conditions)

    const items = await db
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
        thumbnailUrl: articles.thumbnailUrl,
        publishedAt:  articles.publishedAt,
        createdAt:    articles.createdAt,
        authorName:   users.username,
      })
      .from(articles)
      .leftJoin(users, eq(articles.authorId, users.id))
      .leftJoin(categories, eq(articles.categoryId, categories.id))
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
