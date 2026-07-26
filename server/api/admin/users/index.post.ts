import { getDb } from '../../../utils/db'
import { passwordRejectionMessage } from '../../../utils/password-policy'
import { users, roles, activityLogs } from '../../../db/schema'
import { checkPermission, hashPassword } from '../../../utils/auth'
import { assertRoleAssignable } from '../../../utils/permissions'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'users', 'create', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

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
    const [result] = await db.insert(users).values({
      username,
      email,
      passwordHash,
      roleId,
      isActive: true,
    })

    const newUserId = result.insertId

    await db.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'create',
      resource: 'users',
      resourceId: newUserId,
      meta: { username, roleId },
    })

    return { ok: true, id: newUserId }
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') {
      throw createError({ statusCode: 400, statusMessage: 'Tên đăng nhập hoặc Email đã tồn tại.' })
    }
    throw createError({ statusCode: 500, statusMessage: err?.message || 'Lỗi hệ thống' })
  }
})
