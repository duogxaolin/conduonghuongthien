import { getDb } from '../../../utils/db'
import { articles, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { sanitizeHtml } from '../../../utils/sanitize-html'
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
  // Rich text is rendered with v-html on the public site — sanitize on write.
  if (body.content !== undefined) updateFields.content = sanitizeHtml(String(body.content))
  if (body.thumbnailUrl !== undefined) updateFields.thumbnailUrl = String(body.thumbnailUrl).trim() || null
  if (body.category !== undefined) updateFields.category = String(body.category).trim() || null
  if ('categoryId' in body) updateFields.categoryId = body.categoryId ? Number(body.categoryId) : null

  // If the type is changing, re-check permission against the new type
  if (body.type !== undefined) {
    const newType = String(body.type).trim()
    if (newType !== existingArticle.type) {
      const newPermResource = resourceMap[newType] || 'news'
      if (!checkPermission(adminUser.permissions, newPermResource, 'update', adminUser.isSuperAdmin)) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden: Không có quyền với thể loại mới này' })
      }
    }
    updateFields.type = newType
  }

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
