import { getDb } from '../../../utils/db'
import { roles, permissions } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'roles', 'read')

  const db = getDb()
  const roleList = await db.select().from(roles)
  const permList = await db.select().from(permissions)

  const rolesWithPerms = roleList.map(r => ({
    ...r,
    permissions: permList.filter(p => p.roleId === r.id)
  }))

  return { ok: true, roles: rolesWithPerms }
})
