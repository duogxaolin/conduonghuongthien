import { getDb } from '../../../utils/db'
import { roles, permissions, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'roles', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid role ID' })

  const body = await readBody(event).catch(() => ({}))
  const db = getDb()

  const [existingRole] = await db.select().from(roles).where(eq(roles.id, id)).limit(1)
  if (!existingRole) {
    throw createError({ statusCode: 404, statusMessage: 'Vai trò không tồn tại.' })
  }

  if (body.name && existingRole.isSystem && body.name !== existingRole.name) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể đổi tên vai trò hệ thống.' })
  }

  const updateFields: any = {}
  if (body.name) updateFields.name = String(body.name).trim()
  if (body.description !== undefined) updateFields.description = String(body.description).trim() || null

  if (Object.keys(updateFields).length > 0) {
    await db.update(roles).set(updateFields).where(eq(roles.id, id))
  }

  if (Array.isArray(body.permissions)) {
    await db.delete(permissions).where(eq(permissions.roleId, id))
    if (body.permissions.length > 0) {
      const permValues = body.permissions.map((p: any) => ({
        roleId: id,
        resource: String(p.resource),
        canCreate: Boolean(p.canCreate),
        canRead: Boolean(p.canRead),
        canUpdate: Boolean(p.canUpdate),
        canDelete: Boolean(p.canDelete),
      }))
      await db.insert(permissions).values(permValues)
    }
  }

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'roles',
    resourceId: id,
  })

  return { ok: true }
})
