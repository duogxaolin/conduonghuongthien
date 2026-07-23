import { getDb } from '../../../../../utils/db'
import { pages, pageBlocks, activityLogs } from '../../../../../db/schema'
import { checkPermission } from '../../../../../utils/auth'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const pageId = Number(getRouterParam(event, 'id'))
  if (!pageId) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const body = await readBody(event).catch(() => ({}))
  const orders = Array.isArray(body?.orders) ? body.orders : [] // [{ id, displayOrder }, ...]
  if (orders.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Danh sách sắp xếp không hợp lệ.' })
  }

  const db = getDb()
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1)
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })
  }

  await db.transaction(async (tx) => {
    for (const item of orders) {
      if (item.id && typeof item.displayOrder === 'number') {
        // Scope the update to this page so a block from another page can't be moved.
        await tx.update(pageBlocks)
          .set({ displayOrder: item.displayOrder, updatedBy: adminUser.id })
          .where(and(eq(pageBlocks.id, Number(item.id)), eq(pageBlocks.pageId, pageId)))
      }
    }
  })

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'pages',
    meta: { pageId, action: 'reorder', count: orders.length },
  })

  return { ok: true }
})
