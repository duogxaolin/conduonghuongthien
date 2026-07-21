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

  if (!checkPermission(adminUser.permissions, permResource, 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const body = await readBody(event).catch(() => ({}))
  const updateFields: any = {}

  if (body.title !== undefined) updateFields.title = String(body.title).trim()
  if (body.excerpt !== undefined) updateFields.excerpt = String(body.excerpt).trim() || null
  if (body.content !== undefined) updateFields.content = String(body.content)
  if (body.thumbnailUrl !== undefined) updateFields.thumbnailUrl = String(body.thumbnailUrl).trim() || null
  if (body.type !== undefined) updateFields.type = String(body.type).trim()

  if (body.status !== undefined) {
    const newStatus = String(body.status).trim()
    updateFields.status = newStatus
    if (newStatus === 'published' && !existingArticle.publishedAt) {
      updateFields.publishedAt = new Date()
    }
  }

  await db.update(articles).set(updateFields).where(eq(articles.id, id))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'articles',
    resourceId: id,
    meta: { fieldsUpdated: Object.keys(updateFields) },
  })

  return { ok: true }
})
