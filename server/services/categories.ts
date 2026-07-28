/**
 * Category deletion, shared by the single-row and bulk routes.
 *
 * The two guards here are relational, which is why the bulk route must call this
 * per row rather than issuing one `DELETE ... WHERE id IN (...)`: a set-based
 * delete would either fail the whole lot or, worse, orphan articles.
 */
import { createError } from 'h3'
import { count, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articles, categories } from '../db/schema'
import { requireResourcePermission, type ActorLike } from '../utils/permissions'

/**
 * Delete one category.
 *
 * Refuses while it still has child categories or articles, with the same
 * messages the single-row route has always returned — an operator who sees
 * "còn 3 bài viết" in a bulk report gets the same instruction as before.
 */
export async function deleteCategoryById(actor: ActorLike, id: number): Promise<void> {
  requireResourcePermission(actor, 'categories', 'delete')

  const db = getDb()
  const [existing] = await db.select().from(categories).where(eq(categories.id, id)).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Danh mục không tồn tại.' })

  const [{ childCount } = { childCount: 0 }] = await db
    .select({ childCount: count() })
    .from(categories)
    .where(eq(categories.parentId, id))
  if (Number(childCount) > 0) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa danh mục đang có danh mục con. Hãy xóa danh mục con trước.' })
  }

  const [{ articleCount } = { articleCount: 0 }] = await db
    .select({ articleCount: count() })
    .from(articles)
    .where(eq(articles.categoryId, id))
  if (Number(articleCount) > 0) {
    throw createError({ statusCode: 400, statusMessage: `Không thể xóa danh mục đang có ${articleCount} bài viết. Hãy chuyển bài viết sang danh mục khác trước.` })
  }

  await db.delete(categories).where(eq(categories.id, id))
}
