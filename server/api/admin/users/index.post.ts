import { getDb } from '../../../utils/db'
import { passwordRejectionMessage } from '../../../utils/password-policy'
import { users, roles, activityLogs } from '../../../db/schema'
import { hashPassword } from '../../../utils/auth'
import { assertRoleAssignable, assertRoleWithinActor, requireResourcePermission } from '../../../utils/permissions'
import { loadRolePermissions } from '../../../services/users'
import { isValidEmail } from '../../../utils/submission-recipient'
import { isDuplicateEntry } from '../../../utils/mysql-errors'
import { logError } from '../../../utils/logger'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'users', 'create')

  const body = await readBody(event).catch(() => ({}))
  const username = String(body?.username || '').trim()
  const email = String(body?.email || '').trim() || null
  const password = String(body?.password || '').trim()
  const roleId = Number(body?.roleId)

  if (!username || username.length < 3) {
    throw createError({ statusCode: 400, statusMessage: 'Tên đăng nhập phải ít nhất 3 ký tự.' })
  }
  const passwordProblem = passwordRejectionMessage(password, { username })
  if (passwordProblem) {
    throw createError({ statusCode: 400, statusMessage: passwordProblem })
  }
  if (!roleId) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng chọn Vai trò (Role).' })
  }
  if (email && !isValidEmail(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Email không hợp lệ' })
  }

  const db = getDb()

  // Only a superadmin may create a user directly inside a system (superadmin) role.
  const [targetRole] = await db.select({ isSystem: roles.isSystem }).from(roles).where(eq(roles.id, roleId)).limit(1)
  if (!targetRole) throw createError({ statusCode: 400, statusMessage: 'Vai trò không tồn tại.' })
  assertRoleAssignable(adminUser, targetRole.isSystem)
  // …and nobody may create an account with more rights than their own.
  assertRoleWithinActor(adminUser, await loadRolePermissions(roleId), 'Không thể gán vai trò có quyền cao hơn quyền của bạn.')

  const passwordHash = await hashPassword(password)

  try {
    /**
     * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
     *
     * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
     * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
     * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
     * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
     * commit độc lập trên pool.
     */
    const newUserId = await db.transaction(async (tx) => {
      const [result] = await tx.insert(users).values({
        username,
        email,
        passwordHash,
        roleId,
        isActive: true,
      })

      const created = result.insertId

      await tx.insert(activityLogs).values({
        userId: adminUser.id,
        action: 'create',
        resource: 'users',
        resourceId: created,
        meta: { username, roleId },
      })

      return created
    })

    return { ok: true, id: newUserId }
  } catch (err: unknown) {
    // Down the `cause` chain: Drizzle wraps the driver's error, so the top-level `code` read here
    // before was never ER_DUP_ENTRY — an existing username fell to the branch below (FINDING-R7-10).
    if (isDuplicateEntry(err)) {
      throw createError({ statusCode: 400, statusMessage: 'Tên đăng nhập hoặc Email đã tồn tại.' })
    }
    // Never the error's own message: Drizzle's is "Failed query: <SQL> params: …" — the new
    // account's e-mail and password hash, shown to the officer as a toast (FINDING-R7-10). The
    // driver's message (no parameters) goes to the log.
    const driver = err instanceof Error && err.cause instanceof Error ? err.cause : err
    logError({ event: 'admin_users.create_failed', error: driver instanceof Error ? driver.message : String(driver) })
    throw createError({ statusCode: 500, statusMessage: 'Lỗi hệ thống' })
  }
})
