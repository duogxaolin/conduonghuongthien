import { requireResourcePermission } from '../../../utils/permissions'
import { listRolesWithGrants } from '../../../services/admin-roles-queries'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'roles', 'read')

  // `assigned`: how many accounts hold each role (a count, no identities — see the service).
  const { roleList, permList, assigned } = await listRolesWithGrants()

  const rolesWithPerms = roleList.map(r => ({
    ...r,
    permissions: permList.filter(p => p.roleId === r.id),
    userCount: assigned.find(row => row.roleId === r.id)?.total ?? 0,
  }))

  return { ok: true, roles: rolesWithPerms }
})
