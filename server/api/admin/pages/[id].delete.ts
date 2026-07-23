import { getDb } from '../../../utils/db'
import { pages, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'delete', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const db = getDb()
  const [existing] = await db.select().from(pages).where(eq(pages.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })
  }

  // System pages (home/about/contact) back fixed public routes and cannot be deleted.
  if (existing.isSystem) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa trang hệ thống.' })
  }

  // page_blocks cascade on FK ON DELETE CASCADE.
  await db.delete(pages).where(eq(pages.id, id))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'delete',
    resource: 'pages',
    meta: { id, slug: existing.slug },
  })

  return { ok: true }
})
