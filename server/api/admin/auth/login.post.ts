import { getDb } from '../../../utils/db'
import { users, roles, permissions, activityLogs } from '../../../db/schema'
import { verifyPassword, signToken } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

// Rate limiting: max 5 lần sai / 15 phút
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>()

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '').trim()

  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng nhập tài khoản và mật khẩu.' })
  }

  // Rate limit theo IP + username (composite key — ngăn credential stuffing)
  const ip = getRequestHeader(event, 'x-forwarded-for') || 'unknown'
  const rateLimitKey = `${ip}:${username.toLowerCase()}`
  const attempts = loginAttempts.get(rateLimitKey) || { count: 0, lastAttempt: 0 }
  const now = Date.now()

  if (attempts.count >= 5 && now - attempts.lastAttempt < 15 * 60 * 1000) {
    throw createError({ statusCode: 429, statusMessage: 'Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau 15 phút.' })
  }

  const db = getDb()

  // Tìm user
  const [user] = await db
    .select({
      id:           users.id,
      username:     users.username,
      email:        users.email,
      passwordHash: users.passwordHash,
      isActive:     users.isActive,
      roleId:       users.roleId,
      roleName:     roles.name,
      isSystem:     roles.isSystem,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.username, username))
    .limit(1)

  if (!user) {
    loginAttempts.set(rateLimitKey, { count: attempts.count + 1, lastAttempt: now })
    throw createError({ statusCode: 401, statusMessage: 'Tài khoản hoặc mật khẩu không đúng.' })
  }

  if (!user.isActive) {
    throw createError({ statusCode: 403, statusMessage: 'Tài khoản đã bị vô hiệu hóa.' })
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    loginAttempts.set(rateLimitKey, { count: attempts.count + 1, lastAttempt: now })
    throw createError({ statusCode: 401, statusMessage: 'Tài khoản hoặc mật khẩu không đúng.' })
  }

  // Reset rate limit khi đăng nhập thành công
  loginAttempts.delete(rateLimitKey)

  // Load permissions
  const userPermissions = await db
    .select()
    .from(permissions)
    .where(eq(permissions.roleId, user.roleId!))

  // Cập nhật last_login_at
  await db.update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id))

  // Log activity
  await db.insert(activityLogs).values({
    userId:   user.id,
    action:   'login',
    resource: 'auth',
    meta:     { ip, userAgent: getRequestHeader(event, 'user-agent') || '' },
  })

  // Tạo JWT
  const token = signToken({
    userId:   user.id,
    username: user.username,
    roleId:   user.roleId!,
    roleName: user.roleName!,
  })

  const isHttps = getRequestHeader(event, 'x-forwarded-proto') === 'https' || getRequestURL(event).protocol === 'https:'

  // Set httpOnly cookie (7 ngày)
  setCookie(event, 'cdkt_admin', token, {
    httpOnly: true,
    secure:   isHttps,
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60,
    path:     '/',
  })

  return {
    ok: true,
    user: {
      id:          user.id,
      username:    user.username,
      email:       user.email,
      roleName:    user.roleName,
      isSuperAdmin: user.isSystem === true,
      permissions: userPermissions,
    }
  }
})
