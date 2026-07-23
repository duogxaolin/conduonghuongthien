import { getDb } from '../../../utils/db'
import { articles, users } from '../../../db/schema'
import { eq, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Invalid slug' })

  try {
    const db = getDb()
    const [article] = await db
      .select({
        id:           articles.id,
        type:         articles.type,
        category:     articles.category,
        title:        articles.title,
        slug:         articles.slug,
        excerpt:      articles.excerpt,
        content:      articles.content,
        thumbnailUrl: articles.thumbnailUrl,
        publishedAt:  articles.publishedAt,
        createdAt:    articles.createdAt,
        authorName:   users.username,
      })
      .from(articles)
      .leftJoin(users, eq(articles.authorId, users.id))
      .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
      .limit(1)

    if (!article) {
      throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại hoặc chưa xuất bản.' })
    }

    return { ok: true, article }
  } catch (err: any) {
    if (err?.statusCode === 404) throw err
    throw createError({ statusCode: 500, statusMessage: 'Lỗi máy chủ' })
  }
})
