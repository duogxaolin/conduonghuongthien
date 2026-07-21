import { getDb } from '../../../utils/db'
import { users, roles } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'users', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const db = getDb()

  const userList = await db
    .select({
      id:          users.id,
      username:    users.username,
      email:       users.email,
      isActive:    users.isActive,
      roleId:      users.roleId,
      roleName:    roles.name,
      createdAt:   users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .orderBy(desc(users.createdAt))

  return { ok: true, users: userList }
})
