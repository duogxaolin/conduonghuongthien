import { getRequestIP } from 'h3'
import { getDb } from '../../../utils/db'
import { users, roles, permissions, activityLogs } from '../../../db/schema'
import { verifyPassword, signToken } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

// Rate limiting: max 5 lần sai / 15 phút, theo IP thật + username.
// NOTE: in-memory and therefore per-worker under PM2 cluster mode. For a hard
// guarantee across workers, move this to a shared store (DB/Redis).
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>()
// Per-username lockout (independent of source IP) to stop distributed guessing.
const usernameAttempts = new Map<string, { count: number; lastAttempt: number }>()
const MAX_ATTEMPTS_PER_IP = 5
const MAX_ATTEMPTS_PER_USER = 15
const WINDOW_MS = 15 * 60 * 1000

function bump(store: Map<string, { count: number; lastAttempt: number }>, key: string, now: number) {
  const prev = store.get(key)
  const fresh = !prev || now - prev.lastAttempt >= WINDOW_MS
  store.set(key, { count: fresh ? 1 : prev!.count + 1, lastAttempt: now })
  if (store.size > 10_000) store.delete(store.keys().next().value as string)
}

function blocked(store: Map<string, { count: number; lastAttempt: number }>, key: string, limit: number, now: number) {
  const entry = store.get(key)
  return !!entry && entry.count >= limit && now - entry.lastAttempt < WINDOW_MS
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '').trim()

  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng nhập tài khoản và mật khẩu.' })
  }

  // Rate limit theo IP thật + username. `x-forwarded-for` là header do client gửi
  // nên giả mạo được — dùng peer IP mà máy chủ quan sát (xForwardedFor: false).
  const ip = getRequestIP(event, { xForwardedFor: false }) || 'unknown'
  const userKey = username.toLowerCase()
  const rateLimitKey = `${ip}:${userKey}`
  const now = Date.now()

  if (blocked(loginAttempts, rateLimitKey, MAX_ATTEMPTS_PER_IP, now) || blocked(usernameAttempts, userKey, MAX_ATTEMPTS_PER_USER, now)) {
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
    bump(loginAttempts, rateLimitKey, now)
    bump(usernameAttempts, userKey, now)
    throw createError({ statusCode: 401, statusMessage: 'Tài khoản hoặc mật khẩu không đúng.' })
  }

  // Tài khoản bị khóa: đếm như một lần thất bại để tránh dò trạng thái tài khoản.
  if (!user.isActive) {
    bump(loginAttempts, rateLimitKey, now)
    throw createError({ statusCode: 401, statusMessage: 'Tài khoản hoặc mật khẩu không đúng.' })
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    bump(loginAttempts, rateLimitKey, now)
    bump(usernameAttempts, userKey, now)
    throw createError({ statusCode: 401, statusMessage: 'Tài khoản hoặc mật khẩu không đúng.' })
  }

  // Reset rate limit khi đăng nhập thành công
  loginAttempts.delete(rateLimitKey)
  usernameAttempts.delete(userKey)

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

  // Cookie lifetime khớp đúng hạn của JWT (8 giờ). Trước đây cookie sống 7 ngày
  // trong khi token chỉ 8 giờ → người dùng giữ cookie đã hết hạn và bị 401 khó hiểu.
  setCookie(event, 'cdkt_admin', token, {
    httpOnly: true,
    secure:   isHttps,
    sameSite: 'lax',
    maxAge:   8 * 60 * 60,
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
