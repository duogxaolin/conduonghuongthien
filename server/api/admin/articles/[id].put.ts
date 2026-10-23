import { getDb } from '../../../utils/db'
import { articles, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { sanitizeHtml } from '../../../utils/sanitize-html'
import { decodePlainTextInput } from '../../../utils/decode-html-entities'
import { and, eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'
import { articleActionScope } from '../../../services/articles'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid article ID' })

  const db = getDb()
  // Scoped to types the actor can read or update: any other id is the same 404 as
  // a missing one (no oracle for which ids exist); read-only still gets the 403 below.
  const [existingArticle] = await db.select().from(articles).where(and(eq(articles.id, id), articleActionScope(adminUser, ['read', 'update']))).limit(1)

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

  requireResourcePermission(adminUser, permResource, 'update')

  const body = await readBody(event).catch(() => ({}))
  const updateFields: Partial<typeof articles.$inferInsert> = {}

  // Plain-text fields: decode HTML entities (`Ng&agrave;y`). The editor loads them
  // already decoded ([id].get.ts), so re-saving an imported article cleans it.
  if (body.title !== undefined) updateFields.title = decodePlainTextInput(String(body.title))
  if (body.excerpt !== undefined) updateFields.excerpt = decodePlainTextInput(String(body.excerpt)) || null
  // Rich text is rendered with v-html on the public site — sanitize on write.
  if (body.content !== undefined) updateFields.content = sanitizeHtml(String(body.content))
  if (body.thumbnailUrl !== undefined) updateFields.thumbnailUrl = String(body.thumbnailUrl).trim() || null
  if (body.category !== undefined) updateFields.category = String(body.category).trim() || null
  if ('categoryId' in body) updateFields.categoryId = body.categoryId ? Number(body.categoryId) : null
  // Whether this article accepts public comments. Gated by the same type
  // permission checked above — deciding if a piece of content takes replies is
  // part of editing that content (design.md D13).
  if (body.commentsEnabled !== undefined) updateFields.commentsEnabled = Boolean(body.commentsEnabled)

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

  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    await tx.update(articles).set(updateFields).where(eq(articles.id, id))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'articles',
      resourceId: id,
      meta: { fieldsUpdated: Object.keys(updateFields) },
    })
  })

  return { ok: true }
})
