/**
 * Content-type deletion, shared by the single-row and bulk routes.
 *
 * Note the resource: content types are governed by the `categories` grant, not a
 * grant of their own. That is how the existing single-row route behaves, and
 * changing it here would silently widen or narrow who can delete them.
 */
import { createError } from 'h3'
import { count, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articles, categories, contentTypes } from '../db/schema'
import { requireResourcePermission, type ActorLike } from '../utils/permissions'

/**
 * Delete one content type.
 *
 * Three guards, all preserved verbatim from the single-row route: system types
 * back fixed public pages, and a type still referenced by categories or articles
 * would leave those rows pointing at a slug that no longer exists.
 */
export async function deleteContentTypeById(actor: ActorLike, id: number): Promise<void> {
  requireResourcePermission(actor, 'categories', 'delete')

  const db = getDb()
  const [existing] = await db.select().from(contentTypes).where(eq(contentTypes.id, id)).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Thể loại không tồn tại.' })

  if (existing.isSystem) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa thể loại hệ thống.' })
  }

  const [{ catCount } = { catCount: 0 }] = await db
    .select({ catCount: count() })
    .from(categories)
    .where(eq(categories.type, existing.slug))
  if (Number(catCount) > 0) {
    throw createError({ statusCode: 400, statusMessage: `Không thể xóa thể loại đang có ${catCount} danh mục. Hãy xóa danh mục trước.` })
  }

  const [{ artCount } = { artCount: 0 }] = await db
    .select({ artCount: count() })
    .from(articles)
    .where(eq(articles.type, existing.slug))
  if (Number(artCount) > 0) {
    throw createError({ statusCode: 400, statusMessage: `Không thể xóa thể loại đang có ${artCount} bài viết. Hãy chuyển bài viết sang thể loại khác trước.` })
  }

  await db.delete(contentTypes).where(eq(contentTypes.id, id))
}
