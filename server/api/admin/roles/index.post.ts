import { getDb } from '../../../utils/db'
import { roles, permissions, activityLogs } from '../../../db/schema'
import { assertAssignablePermissions, requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'roles', 'create')

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name || '').trim()
  const description = String(body?.description || '').trim() || null
  const permsInput = Array.isArray(body?.permissions) ? body.permissions : []

  if (!name || name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Tên vai trò phải từ 2 ký tự trở lên.' })
  }

  const db = getDb()

  const [res] = await db.insert(roles).values({
    name,
    description,
    isSystem: false,
  })

  const newRoleId = res.insertId

  if (permsInput.length > 0) {
    // Reject invalid resources and block granting permissions the actor lacks.
    assertAssignablePermissions(adminUser, permsInput)
    const permValues = permsInput.map((p: any) => ({
      roleId: newRoleId,
      resource: String(p.resource),
      canCreate: Boolean(p.canCreate),
      canRead: Boolean(p.canRead),
      canUpdate: Boolean(p.canUpdate),
      canDelete: Boolean(p.canDelete),
    }))
    await db.insert(permissions).values(permValues)
  }

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'create',
    resource: 'roles',
    resourceId: newRoleId,
    meta: { name },
  })

  return { ok: true, id: newRoleId }
})
