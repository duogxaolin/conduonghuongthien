import { getDb } from '../../../utils/db'
import { articles, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid article ID' })

  const db = getDb()
  const [existingArticle] = await db.select().from(articles).where(eq(articles.id, id)).limit(1)

  if (!existingArticle) {
    throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })
  }

  const resourceMap: Record<string, string> = {
    news: 'news',
    role_model: 'role_models',
    reintegration: 'reintegration',
    document: 'documents',
    faq: 'faq',
  }
  const permResource = resourceMap[existingArticle.type] || 'news'

  if (!checkPermission(adminUser.permissions, permResource, 'delete', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  await db.delete(articles).where(eq(articles.id, id))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'delete',
    resource: 'articles',
    resourceId: id,
    meta: { title: existingArticle.title },
  })

  return { ok: true }
})
