import { getDb } from '../../../utils/db'
import { contentTypes, categories, articles } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq, count } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'categories', 'delete', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid content type ID' })

  const db = getDb()

  const [existing] = await db.select().from(contentTypes).where(eq(contentTypes.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Thể loại không tồn tại.' })
  }

  // Guard: system types back the fixed public pages and cannot be removed
  if (existing.isSystem) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa thể loại hệ thống.' })
  }

  // Guard: reject if categories still reference this type
  const [{ catCount }] = await db
    .select({ catCount: count() })
    .from(categories)
    .where(eq(categories.type, existing.slug))
  if (Number(catCount) > 0) {
    throw createError({ statusCode: 400, statusMessage: `Không thể xóa thể loại đang có ${catCount} danh mục. Hãy xóa danh mục trước.` })
  }

  // Guard: reject if articles still reference this type
  const [{ artCount }] = await db
    .select({ artCount: count() })
    .from(articles)
    .where(eq(articles.type, existing.slug))
  if (Number(artCount) > 0) {
    throw createError({ statusCode: 400, statusMessage: `Không thể xóa thể loại đang có ${artCount} bài viết. Hãy chuyển bài viết sang thể loại khác trước.` })
  }

  await db.delete(contentTypes).where(eq(contentTypes.id, id))

  return { ok: true }
})
