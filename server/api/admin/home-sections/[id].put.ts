import { getDb } from '../../../utils/db'
import { homeSections, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'home_sections', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid section ID' })

  const body = await readBody(event).catch(() => ({}))
  const config = body?.config

  if (!config || typeof config !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Cấu hình section không hợp lệ.' })
  }

  const db = getDb()

  await db.update(homeSections)
    .set({
      config,
      updatedAt: new Date(),
      updatedBy: adminUser.id,
    })
    .where(eq(homeSections.id, id))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'home_sections',
    resourceId: id,
    meta: { config },
  })

  return { ok: true }
})
