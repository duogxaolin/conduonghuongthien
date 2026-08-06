/**
 * Change your own password.
 *
 * Ungated by RBAC on purpose: the account is resolved from the session and
 * nothing outside it can be read or written. The alternative — routing self
 * password changes through `users.update` — means either handing an editor the
 * ability to rewrite every account, or having a SuperAdmin set the password and
 * therefore know it.
 */

import { eq, sql } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { users, activityLogs } from '../../../db/schema'
import { hashPassword, verifyPassword } from '../../../utils/auth'
import { passwordRejectionMessage } from '../../../utils/password-policy'
import { logInfo, logWarn, SECURITY_EVENTS } from '../../../utils/logger'
import { peekRateLimit, recordRateLimitHit, clearRateLimit, type RateLimitRule } from '../../../utils/rate-limit-store'
import { setSessionCookie } from '../../../utils/mfa/session'
import { getClientIp } from '../../../utils/client-ip'
import { rateLimitDeps } from '../../../utils/rate-limit-deps'

/** Holding a session is not licence to grind the current password. */
const RULE: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 }

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event).catch(() => ({}))
  const currentPassword = String(body?.currentPassword || '')
  const newPassword = String(body?.newPassword || '')

  if (!currentPassword || !newPassword) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.' })
  }

  const ip = getClientIp(event)
  const deps = rateLimitDeps()
  const bucket = `profile:password:user:${admin.id}`
  const state = await peekRateLimit(bucket, RULE, deps)
  if (state.blocked) {
    setResponseHeader(event, 'Retry-After', state.retryAfterSeconds)
    throw createError({ statusCode: 429, statusMessage: 'Quá nhiều lần nhập sai. Vui lòng thử lại sau 15 phút.' })
  }

  const db = getDb()
  // The middleware does not carry the hash, and must not.
  const [row] = await db
    .select({ passwordHash: users.passwordHash, username: users.username })
    .from(users)
    .where(eq(users.id, admin.id))
    .limit(1)
  if (!row) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    await recordRateLimitHit(bucket, RULE, deps)
    logWarn({ event: SECURITY_EVENTS.loginFailed, userId: admin.id, username: row.username, ip, reason: 'self_password_change_bad_current' })
    throw createError({ statusCode: 401, statusMessage: 'Mật khẩu hiện tại không đúng.' })
  }

  const problem = passwordRejectionMessage(newPassword, { username: row.username })
  if (problem) {
    throw createError({ statusCode: 400, statusMessage: problem })
  }

  // Rotating to the same value is not a rotation.
  if (await verifyPassword(newPassword, row.passwordHash)) {
    throw createError({ statusCode: 400, statusMessage: 'Mật khẩu mới phải khác mật khẩu hiện tại.' })
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      // Revoke every session minted under the old password.
      tokenVersion: sql`${users.tokenVersion} + 1` as unknown as number,
    })
    .where(eq(users.id, admin.id))

  await clearRateLimit(bucket, deps)

  // Re-read the bumped generation and re-issue this session's cookie, so the
  // caller is not logged out by their own successful change.
  const [fresh] = await db
    .select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, admin.id))
    .limit(1)
  setSessionCookie(event, {
    id: admin.id,
    username: row.username,
    email: admin.email ?? null,
    roleId: admin.roleId ?? null,
    roleName: admin.roleName ?? null,
    isSystem: admin.isSystem ?? null,
    tokenVersion: fresh?.tokenVersion ?? 0,
  })

  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'update',
    resource: 'profile_password',
    resourceId: admin.id,
    meta: { ip, userAgent: getRequestHeader(event, 'user-agent') || '' },
  })
  logInfo({ event: SECURITY_EVENTS.passwordChanged, userId: admin.id, username: row.username, ip, self: true })

  return { ok: true, message: 'Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị thu hồi.' }
})
