import { getDb } from '../../../utils/db'
import { roles, users, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'roles', 'delete', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid role ID' })

  const db = getDb()
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1)

  if (!role) {
    throw createError({ statusCode: 404, statusMessage: 'Vai trò không tồn tại.' })
  }
  if (role.isSystem) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa vai trò hệ thống.' })
  }

  // Check if users are assigned to this role
  const usersWithRole = await db.select().from(users).where(eq(users.roleId, id)).limit(1)
  if (usersWithRole.length > 0) {
    throw createError({ statusCode: 400, statusMessage: 'Vẫn còn tài khoản gán cho vai trò này. Hãy gán lại trước khi xóa.' })
  }

  await db.delete(roles).where(eq(roles.id, id))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'delete',
    resource: 'roles',
    resourceId: id,
  })

  return { ok: true }
})
