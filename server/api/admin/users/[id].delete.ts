import { getDb } from '../../../utils/db'
import { users, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'users', 'delete', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })

  if (id === adminUser.id) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa chính tài khoản của bạn.' })
  }

  const db = getDb()
  await db.delete(users).where(eq(users.id, id))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'delete',
    resource: 'users',
    resourceId: id,
  })

  return { ok: true }
})
