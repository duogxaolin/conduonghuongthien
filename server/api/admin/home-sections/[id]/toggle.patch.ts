import { getDb } from '../../../../utils/db'
import { homeSections, activityLogs } from '../../../../db/schema'
import { checkPermission } from '../../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'home_sections', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid section ID' })

  const db = getDb()
  const [section] = await db.select().from(homeSections).where(eq(homeSections.id, id)).limit(1)

  if (!section) {
    throw createError({ statusCode: 404, statusMessage: 'Section không tồn tại.' })
  }

  const newVisibility = !section.isVisible

  await db.update(homeSections)
    .set({
      isVisible: newVisibility,
      updatedAt: new Date(),
      updatedBy: adminUser.id,
    })
    .where(eq(homeSections.id, id))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'home_sections',
    resourceId: id,
    meta: { isVisible: newVisibility },
  })

  return { ok: true, isVisible: newVisibility }
})
