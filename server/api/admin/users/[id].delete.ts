import { getDb } from '../../../utils/db'
import { users, roles, activityLogs } from '../../../db/schema'
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

  const [existingUser] = await db
    .select({ id: users.id, isSystem: roles.isSystem })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1)

  if (existingUser?.isSystem) {
    throw createError({ statusCode: 403, statusMessage: 'Không thể xóa tài khoản hệ thống SuperAdmin.' })
  }

  await db.delete(users).where(eq(users.id, id))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'delete',
    resource: 'users',
    resourceId: id,
  })

  return { ok: true }
})
