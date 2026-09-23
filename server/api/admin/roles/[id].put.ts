import { getDb } from '../../../utils/db'
import { roles, permissions, activityLogs } from '../../../db/schema'
import { assertAssignablePermissions, requireResourcePermission } from '../../../utils/permissions'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'roles', 'update')

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

  const updateFields: Partial<{ name: string, description: string | null }> = {}
  if (body.name) updateFields.name = String(body.name).trim()
  if (body.description !== undefined) updateFields.description = String(body.description).trim() || null

  let permValues: Array<typeof permissions.$inferInsert> | undefined
  if (body.permissions !== undefined) {
    // A system role's permission matrix may only be edited by a superadmin.
    if (existingRole.isSystem && adminUser.isSuperAdmin !== true) {
      throw createError({ statusCode: 403, statusMessage: 'Chỉ SuperAdmin mới được sửa quyền của vai trò hệ thống.' })
    }
    // Reject invalid resources and block granting permissions the actor lacks.
    permValues = assertAssignablePermissions(adminUser, body.permissions).map(p => ({ ...p, roleId: id }))
  }

  // Validate first, then commit role metadata, grants and audit together.
  await db.transaction(async (tx) => {
    if (Object.keys(updateFields).length > 0) {
      await tx.update(roles).set(updateFields).where(eq(roles.id, id))
    }
    if (permValues !== undefined) {
      await tx.delete(permissions).where(eq(permissions.roleId, id))
      if (permValues.length > 0) await tx.insert(permissions).values(permValues)
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'roles',
      resourceId: id,
    })
  })

  return { ok: true }
})
