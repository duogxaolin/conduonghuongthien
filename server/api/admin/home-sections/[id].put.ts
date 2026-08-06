import { getDb } from '../../../utils/db'
import { homeSections, activityLogs } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'home_sections', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid section ID' })

  const body = await readBody(event).catch(() => ({}))
  const config = body?.config

  if (!config || typeof config !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Cấu hình section không hợp lệ.' })
  }

  const db = getDb()

  const updateData: any = {
    config,
    updatedAt: new Date(),
    updatedBy: adminUser.id,
  }
  if (body.title) {
    updateData.title = String(body.title)
  }

  await db.update(homeSections)
    .set(updateData)
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
