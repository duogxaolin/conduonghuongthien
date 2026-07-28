/**
 * Page deletion, shared by the single-row and bulk routes.
 */
import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, pages } from '../db/schema'
import { requireResourcePermission, type ActorLike } from '../utils/permissions'

/**
 * Delete one page.
 *
 * System pages (home/about/contact) back fixed public routes, so removing one
 * would 404 a URL the site links to. `page_blocks` rows go with it through the
 * FK's ON DELETE CASCADE.
 */
export async function deletePageById(actor: ActorLike, id: number): Promise<void> {
  requireResourcePermission(actor, 'pages', 'delete')

  const db = getDb()
  const [existing] = await db.select().from(pages).where(eq(pages.id, id)).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })

  if (existing.isSystem) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa trang hệ thống.' })
  }

  await db.delete(pages).where(eq(pages.id, id))
  await db.insert(activityLogs).values({
    userId: actor.id,
    action: 'delete',
    resource: 'pages',
    meta: { id, slug: existing.slug },
  })
}
