import { requireResourcePermission } from '../../../utils/permissions'
import { listAdminUsers } from '../../../services/admin-users-queries'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'users', 'read')

  const userList = await listAdminUsers()

  return { ok: true, users: userList }
})
