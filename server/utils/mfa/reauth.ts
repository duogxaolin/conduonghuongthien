/**
 * Re-prove the current password before changing authentication material.
 *
 * Holding a live session is not enough to enroll or disable a factor: a session
 * can be a borrowed laptop or a stolen cookie, and either would otherwise be
 * able to add a factor the real owner cannot satisfy, or strip the one protecting
 * the account.
 */
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { users } from '../../db/schema'
import { verifyPassword } from '../auth'
import { logWarn, SECURITY_EVENTS } from '../logger'
import { peekRateLimit, recordRateLimitHit, clearRateLimit, type RateLimitRule } from '../rate-limit-store'
import { rateLimitDeps } from '../rate-limit-deps'

const RULE: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 }

/**
 * Throws 401/429 unless the supplied password matches the caller's own. Returns
 * the account's username and hash, both of which callers need afterwards (the
 * policy check takes the username; the second-tier password must differ from
 * the login one).
 */
export async function requireCurrentPassword(
  event: H3Event,
  userId: number,
  supplied: string,
): Promise<{ username: string; passwordHash: string }> {
  if (!supplied) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng nhập mật khẩu hiện tại để xác nhận.' })
  }

  const deps = rateLimitDeps()
  const bucket = `profile:reauth:user:${userId}`
  const state = await peekRateLimit(bucket, RULE, deps)
  if (state.blocked) {
    setResponseHeader(event, 'Retry-After', state.retryAfterSeconds)
    throw createError({ statusCode: 429, statusMessage: 'Quá nhiều lần nhập sai. Vui lòng thử lại sau 15 phút.' })
  }

  const db = getDb()
  const [row] = await db
    .select({ username: users.username, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  if (!(await verifyPassword(supplied, row.passwordHash))) {
    await recordRateLimitHit(bucket, RULE, deps)
    logWarn({ event: SECURITY_EVENTS.loginFailed, userId, username: row.username, reason: 'profile_reauth_failed' })
    throw createError({ statusCode: 401, statusMessage: 'Mật khẩu hiện tại không đúng.' })
  }

  await clearRateLimit(bucket, deps)
  return row
}
