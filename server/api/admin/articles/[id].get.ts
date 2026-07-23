import { getDb } from '../../../utils/db'
import { articles, users } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'news', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid article ID' })

  const db = getDb()
  const [article] = await db
    .select({
      id:           articles.id,
      type:         articles.type,
      category:     articles.category,
      categoryId:   articles.categoryId,
      title:        articles.title,
      slug:         articles.slug,
      excerpt:      articles.excerpt,
      content:      articles.content,
      status:       articles.status,
      thumbnailUrl: articles.thumbnailUrl,
      publishedAt:  articles.publishedAt,
      createdAt:    articles.createdAt,
      updatedAt:    articles.updatedAt,
      authorName:   users.username,
    })
    .from(articles)
    .leftJoin(users, eq(articles.authorId, users.id))
    .where(eq(articles.id, id))
    .limit(1)

  if (!article) {
    throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })
  }

  return { ok: true, article }
})
