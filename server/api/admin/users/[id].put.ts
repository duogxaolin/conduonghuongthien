import { getDb } from '../../../utils/db'
import { users, activityLogs } from '../../../db/schema'
import { checkPermission, hashPassword } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'users', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })

  const body = await readBody(event).catch(() => ({}))
  const db = getDb()

  const [existingUser] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!existingUser) {
    throw createError({ statusCode: 404, statusMessage: 'Người dùng không tồn tại' })
  }

  const updateData: Partial<typeof users.$inferInsert> = {}

  if (body.email !== undefined) updateData.email = String(body.email).trim() || null
  if (body.roleId !== undefined) updateData.roleId = Number(body.roleId)
  if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive)
  if (body.password && String(body.password).trim().length >= 6) {
    updateData.passwordHash = await hashPassword(String(body.password).trim())
  }

  await db.update(users).set(updateData).where(eq(users.id, id))

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'users',
    resourceId: id,
    meta: { fieldsUpdated: Object.keys(updateData) },
  })

  return { ok: true }
})
