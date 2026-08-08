import { getDb } from '../../../utils/db'
import { users, roles } from '../../../db/schema'
import { eq, desc } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'users', 'read')

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
