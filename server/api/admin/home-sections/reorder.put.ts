import { getDb } from '../../../utils/db'
import { homeSections, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'home_sections', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const body = await readBody(event).catch(() => ({}))
  const orders = Array.isArray(body?.orders) ? body.orders : [] // [{ id: 1, displayOrder: 1 }, ...]

  if (orders.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Danh sách sắp xếp không hợp lệ.' })
  }

  const db = getDb()

  for (const item of orders) {
    if (item.id && typeof item.displayOrder === 'number') {
      await db.update(homeSections)
        .set({ displayOrder: item.displayOrder, updatedAt: new Date(), updatedBy: adminUser.id })
        .where(eq(homeSections.id, Number(item.id)))
    }
  }

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'home_sections',
    meta: { action: 'reorder', count: orders.length },
  })

  return { ok: true }
})
