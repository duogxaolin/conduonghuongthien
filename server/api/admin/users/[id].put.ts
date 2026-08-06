import { getDb } from '../../../utils/db'
import { users, roles, activityLogs } from '../../../db/schema'
import { hashPassword } from '../../../utils/auth'
import { assertRoleAssignable, requireResourcePermission } from '../../../utils/permissions'
import { passwordRejectionMessage } from '../../../utils/password-policy'
import { eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'users', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })

  const body = await readBody(event).catch(() => ({}))
  const db = getDb()

  const [existingUser] = await db
    .select({ id: users.id, username: users.username, isSystem: roles.isSystem })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1)
  if (!existingUser) {
    throw createError({ statusCode: 404, statusMessage: 'Người dùng không tồn tại' })
  }

  if (existingUser.isSystem) {
    throw createError({ statusCode: 403, statusMessage: 'Không thể sửa tài khoản hệ thống SuperAdmin.' })
  }

  const updateData: Partial<typeof users.$inferInsert> = {}

  if (body.email !== undefined) updateData.email = String(body.email).trim() || null
  if (body.roleId !== undefined) {
    const targetRoleId = Number(body.roleId)
    const [targetRole] = await db.select({ isSystem: roles.isSystem }).from(roles).where(eq(roles.id, targetRoleId)).limit(1)
    if (!targetRole) throw createError({ statusCode: 400, statusMessage: 'Vai trò không tồn tại.' })
    // Only a superadmin may move a user into a system (superadmin) role.
    assertRoleAssignable(adminUser, targetRole.isSystem)
    updateData.roleId = targetRoleId
  }
  if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive)
  if (body.password !== undefined && String(body.password) !== '') {
    const newPassword = String(body.password)
    // Rejected outright rather than silently ignored: the old code skipped a
    // too-short password without a word, so the admin believed it had changed.
    const problem = passwordRejectionMessage(newPassword, { username: existingUser.username })
    if (problem) throw createError({ statusCode: 400, statusMessage: problem })
    updateData.passwordHash = await hashPassword(newPassword)
    // Changing a password must terminate that user's existing sessions,
    // otherwise a compromised session survives the very action taken to stop it.
    updateData.tokenVersion = sql`${users.tokenVersion} + 1` as unknown as number
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
