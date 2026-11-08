import { requireResourcePermission } from '../../../utils/permissions'
import { findRoleById } from '../../../services/admin-roles-queries'
import { deleteRoleWithAudit, findUsersWithRole } from '../../../services/admin-role-delete'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'roles', 'delete')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid role ID' })

  const role = await findRoleById(id)

  if (!role) {
    throw createError({ statusCode: 404, statusMessage: 'Vai trò không tồn tại.' })
  }
  if (role.isSystem) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể xóa vai trò hệ thống.' })
  }

  // Check if users are assigned to this role
  const usersWithRole = await findUsersWithRole(id)
  if (usersWithRole.length > 0) {
    throw createError({ statusCode: 400, statusMessage: 'Vẫn còn tài khoản gán cho vai trò này. Hãy gán lại trước khi xóa.' })
  }

  // The row and its audit line commit together, or neither does (one transaction, in the service).
  await deleteRoleWithAudit(adminUser, id)

  return { ok: true }
})
