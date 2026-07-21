import { getDb } from '../../../utils/db'
import { articles, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/([^0-9a-z-\s])/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  const body = await readBody(event).catch(() => ({}))
  const type = String(body?.type || 'news').trim()
  const title = String(body?.title || '').trim()
  const excerpt = String(body?.excerpt || '').trim() || null
  const content = String(body?.content || '')
  const status = String(body?.status || 'draft').trim()
  const thumbnailUrl = String(body?.thumbnailUrl || '').trim() || null

  // Map resource permission by article type
  const resourceMap: Record<string, string> = {
    news: 'news',
    role_model: 'role_models',
    reintegration: 'reintegration',
    document: 'documents',
    faq: 'faq',
  }
  const permResource = resourceMap[type] || 'news'

  if (!checkPermission(adminUser.permissions, permResource, 'create', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  if (!title || title.length < 3) {
    throw createError({ statusCode: 400, statusMessage: 'Tiêu đề bài viết quá ngắn.' })
  }

  const baseSlug = slugify(title)
  const uniqueSlug = `${baseSlug}-${Date.now().toString(36)}`
  const publishedAt = status === 'published' ? new Date() : null

  const db = getDb()

  const [res] = await db.insert(articles).values({
    type,
    title,
    slug: uniqueSlug,
    excerpt,
    content,
    status,
    thumbnailUrl,
    authorId: adminUser.id,
    publishedAt,
  })

  const newArticleId = res.insertId

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'create',
    resource: 'articles',
    resourceId: newArticleId,
    meta: { title, type, status },
  })

  return { ok: true, id: newArticleId, slug: uniqueSlug }
})
