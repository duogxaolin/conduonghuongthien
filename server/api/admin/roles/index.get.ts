import { getDb } from '../../../utils/db'
import { roles, permissions } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'roles', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const db = getDb()
  const roleList = await db.select().from(roles)
  const permList = await db.select().from(permissions)

  const rolesWithPerms = roleList.map(r => ({
    ...r,
    permissions: permList.filter(p => p.roleId === r.id)
  }))

  return { ok: true, roles: rolesWithPerms }
})
