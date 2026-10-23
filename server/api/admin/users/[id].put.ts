import { getDb } from '../../../utils/db'
import { users, roles, activityLogs } from '../../../db/schema'
import { hashPassword } from '../../../utils/auth'
import { assertRoleAssignable, assertRoleWithinActor, requireResourcePermission } from '../../../utils/permissions'
import { passwordRejectionMessage } from '../../../utils/password-policy'
import { isValidEmail } from '../../../utils/submission-recipient'
import { assertUserManageable, loadRolePermissions } from '../../../services/users'
import { eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'users', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })

  const body = await readBody(event).catch(() => ({}))
  const db = getDb()

  const [existingUser] = await db
    .select({ id: users.id, username: users.username, roleId: users.roleId, isSystem: roles.isSystem })
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
  // Every field below is a way to take the account over (password, email) or
  // away (role, lock), so the account's CURRENT role must already be within the
  // actor's rights — not only the role it is being moved to.
  await assertUserManageable(adminUser, existingUser.roleId)

  // Your own account is edited from /admin/profile, which asks for the current
  // password. Here, a hijacked session could otherwise re-password itself,
  // re-role itself, or lock itself out (setUserActive refuses that last one too).
  // The edit form always resends `roleId`/`isActive`, so only an actual change counts.
  const isSelf = adminUser.id === id
  const hasPassword = body.password !== undefined && String(body.password) !== ''
  const changesRole = body.roleId !== undefined && Number(body.roleId) !== existingUser.roleId
  if (isSelf && (changesRole || body.isActive === false || hasPassword)) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể đổi vai trò, khoá hoặc đặt lại mật khẩu cho chính tài khoản của bạn tại đây. Đổi mật khẩu ở trang Hồ sơ.' })
  }

  const updateData: Partial<typeof users.$inferInsert> = {}

  if (body.email !== undefined) {
    const email = String(body.email).trim()
    if (email && !isValidEmail(email)) {
      throw createError({ statusCode: 400, statusMessage: 'Email không hợp lệ' })
    }
    updateData.email = email || null
  }
  if (body.roleId !== undefined) {
    const targetRoleId = Number(body.roleId)
    const [targetRole] = await db.select({ isSystem: roles.isSystem }).from(roles).where(eq(roles.id, targetRoleId)).limit(1)
    if (!targetRole) throw createError({ statusCode: 400, statusMessage: 'Vai trò không tồn tại.' })
    // Only a superadmin may move a user into a system (superadmin) role.
    assertRoleAssignable(adminUser, targetRole.isSystem)
    assertRoleWithinActor(adminUser, await loadRolePermissions(targetRoleId), 'Không thể gán vai trò có quyền cao hơn quyền của bạn.')
    updateData.roleId = targetRoleId
  }
  if (body.isActive !== undefined) {
    // `Boolean("false")` is true: a string here used to unlock the account.
    if (typeof body.isActive !== 'boolean') {
      throw createError({ statusCode: 400, statusMessage: 'isActive phải là true hoặc false.' })
    }
    updateData.isActive = body.isActive
  }
  if (hasPassword) {
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

  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    await tx.update(users).set(updateData).where(eq(users.id, id))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'users',
      resourceId: id,
      meta: { fieldsUpdated: Object.keys(updateData) },
    })
  })

  return { ok: true }
})
