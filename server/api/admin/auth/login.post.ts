import { getRequestIP } from 'h3'
import { getDb } from '../../../utils/db'
import { users, roles, permissions, activityLogs } from '../../../db/schema'
import { verifyPassword, signToken } from '../../../utils/auth'
import { eq } from 'drizzle-orm'
import { getPool } from '../../../utils/db'
import { logInfo, logWarn, SECURITY_EVENTS } from '../../../utils/logger'
import {
  clearRateLimit,
  peekRateLimit,
  recordRateLimitHit,
  type RateLimitRule,
} from '../../../utils/rate-limit-store'

// Rate limiting: 5 lần sai / 15 phút theo IP thật + username, và 15 lần / 15 phút
// theo riêng username (chặn đoán phân tán từ nhiều IP).
//
// Bộ đếm nằm trong bảng MySQL dùng chung: khởi động lại container không còn xoá
// sạch khoá, và giới hạn vẫn đúng khi chạy nhiều worker/replica. Mất kết nối CSDL
// thì tự lùi về bộ nhớ tiến trình — đúng bằng hành vi cũ, không mở toang.
const IP_RULE: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 }
const USER_RULE: RateLimitRule = { limit: 15, windowSeconds: 15 * 60 }

function limiterDeps() {
  const pool = getPool()
  return { execute: pool ? ((sql: string, params: unknown[]) => pool.query(sql, params)) : null }
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
  const ipBucket = `login:ip:${ip}:${userKey}`
  const userBucket = `login:user:${userKey}`
  const deps = limiterDeps()

  const [ipState, userState] = await Promise.all([
    peekRateLimit(ipBucket, IP_RULE, deps),
    peekRateLimit(userBucket, USER_RULE, deps),
  ])
  if (ipState.blocked || userState.blocked) {
    logWarn({
      event: SECURITY_EVENTS.loginLocked,
      username: userKey,
      ip,
      scope: ipState.blocked ? 'source' : 'account',
      attempts: Math.max(ipState.count, userState.count),
      backend: ipState.backend,
    })
    setResponseHeader(event, 'Retry-After', Math.max(ipState.retryAfterSeconds, userState.retryAfterSeconds))
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
      tokenVersion: users.tokenVersion,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.username, username))
    .limit(1)

  if (!user) {
    await Promise.all([
      recordRateLimitHit(ipBucket, IP_RULE, deps),
      recordRateLimitHit(userBucket, USER_RULE, deps),
    ])
    // `reason` is for the operator only; all three branches answer identically.
    logWarn({ event: SECURITY_EVENTS.loginFailed, username: userKey, ip, reason: 'unknown_user' })
    throw createError({ statusCode: 401, statusMessage: 'Tài khoản hoặc mật khẩu không đúng.' })
  }

  // Tài khoản bị khóa: đếm như một lần thất bại để tránh dò trạng thái tài khoản.
  if (!user.isActive) {
    await Promise.all([
      recordRateLimitHit(ipBucket, IP_RULE, deps),
      recordRateLimitHit(userBucket, USER_RULE, deps),
    ])
    // `reason` is for the operator only; all three branches answer identically.
    logWarn({ event: SECURITY_EVENTS.loginFailed, username: userKey, ip, reason: 'account_disabled' })
    throw createError({ statusCode: 401, statusMessage: 'Tài khoản hoặc mật khẩu không đúng.' })
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    await Promise.all([
      recordRateLimitHit(ipBucket, IP_RULE, deps),
      recordRateLimitHit(userBucket, USER_RULE, deps),
    ])
    // `reason` is for the operator only; all three branches answer identically.
    logWarn({ event: SECURITY_EVENTS.loginFailed, username: userKey, ip, reason: 'bad_password' })
    throw createError({ statusCode: 401, statusMessage: 'Tài khoản hoặc mật khẩu không đúng.' })
  }

  // Reset rate limit khi đăng nhập thành công
  await Promise.all([clearRateLimit(ipBucket, deps), clearRateLimit(userBucket, deps)])
  logInfo({ event: SECURITY_EVENTS.loginSucceeded, username: user.username, userId: user.id, ip })

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
    tokenVersion: user.tokenVersion ?? 0,
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
