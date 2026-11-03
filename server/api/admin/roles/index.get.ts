import { count } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { roles, permissions, users } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'roles', 'read')

  const db = getDb()
  const roleList = await db.select().from(roles)
  const permList = await db.select().from(permissions)
  // How many accounts hold each role — the same rows `[id].delete.ts` refuses on (any
  // `users.role_id`, locked accounts included), so the role editor can grey out "Xóa vai
  // trò" instead of offering a delete that is certain to fail. A count, no identities:
  // listing the accounts stays behind `users.read`. The DELETE still checks for itself.
  const assigned = await db.select({ roleId: users.roleId, total: count() }).from(users).groupBy(users.roleId)

  const rolesWithPerms = roleList.map(r => ({
    ...r,
    permissions: permList.filter(p => p.roleId === r.id),
    userCount: assigned.find(row => row.roleId === r.id)?.total ?? 0,
  }))

  return { ok: true, roles: rolesWithPerms }
})
