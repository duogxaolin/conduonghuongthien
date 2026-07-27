import { getDb } from '../../../utils/db'
import { categories, articles } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq, count } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'categories', 'delete', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid category ID' })

  const db = getDb()

  // Check if category exists
  const [existing] = await db.select().from(categories).where(eq(categories.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Danh mục không tồn tại.' })
  }

  // Guard: reject if has children
  const [{ childCount } = { childCount: 0 }] = await db
    .select({ childCount: count() })
    .from(categories)
    .where(eq(categories.parentId, id))

  if (Number(childCount) > 0) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa danh mục đang có danh mục con. Hãy xóa danh mục con trước.' })
  }

  // Guard: reject if has articles
  const [{ articleCount } = { articleCount: 0 }] = await db
    .select({ articleCount: count() })
    .from(articles)
    .where(eq(articles.categoryId, id))

  if (Number(articleCount) > 0) {
    throw createError({ statusCode: 400, statusMessage: `Không thể xóa danh mục đang có ${articleCount} bài viết. Hãy chuyển bài viết sang danh mục khác trước.` })
  }

  await db.delete(categories).where(eq(categories.id, id))

  return { ok: true }
})
