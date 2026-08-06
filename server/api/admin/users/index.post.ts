import { getDb } from '../../../utils/db'
import { passwordRejectionMessage } from '../../../utils/password-policy'
import { users, roles, activityLogs } from '../../../db/schema'
import { hashPassword } from '../../../utils/auth'
import { assertRoleAssignable, requireResourcePermission } from '../../../utils/permissions'
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
  if (email) {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!EMAIL_RE.test(email)) {
      throw createError({ statusCode: 400, statusMessage: 'Email không hợp lệ' })
    }
  }

  const db = getDb()

  // Only a superadmin may create a user directly inside a system (superadmin) role.
  const [targetRole] = await db.select({ isSystem: roles.isSystem }).from(roles).where(eq(roles.id, roleId)).limit(1)
  if (!targetRole) throw createError({ statusCode: 400, statusMessage: 'Vai trò không tồn tại.' })
  assertRoleAssignable(adminUser, targetRole.isSystem)

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
    if ((err as { code?: string })?.code === 'ER_DUP_ENTRY') {
      throw createError({ statusCode: 400, statusMessage: 'Tên đăng nhập hoặc Email đã tồn tại.' })
    }
    throw createError({ statusCode: 500, statusMessage: (err instanceof Error ? err.message : undefined) || 'Lỗi hệ thống' })
  }
})
