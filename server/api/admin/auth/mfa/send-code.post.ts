/**
 * Mail a login code during a live challenge.
 *
 * Unauthenticated by session (admin-auth.ts skips this path) and authorised only
 * by the challenge ticket, so it carries its own rate limit: without one it would
 * be a mail-sending endpoint reachable by anyone holding a stolen password.
 */

import { verifyMfaChallenge } from '../../../../utils/auth'
import { logWarn } from '../../../../utils/logger'
import { recordRateLimitHit, peekRateLimit, type RateLimitRule } from '../../../../utils/rate-limit-store'
import { CHALLENGE_COOKIE, clearChallengeCookie, loadSessionUser } from '../../../../utils/mfa/session'
import { getFactor } from '../../../../utils/mfa/factors'
import { issueEmailCode } from '../../../../utils/mfa/email-code'
import { getClientIp } from '../../../../utils/client-ip'
import { rateLimitDeps } from '../../../../utils/rate-limit-deps'

/** Tight: a legitimate caller needs one code, maybe two if the first is slow. */
const SEND_RULE: RateLimitRule = { limit: 3, windowSeconds: 10 * 60 }

export default defineEventHandler(async (event) => {
  const ip = getClientIp(event)

  const ticket = getCookie(event, CHALLENGE_COOKIE)
  const challenge = ticket ? verifyMfaChallenge(ticket) : null
  if (!challenge) {
    clearChallengeCookie(event)
    throw createError({ statusCode: 401, statusMessage: 'Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại.' })
  }

  const deps = rateLimitDeps()
  const bucket = `mfa:sendcode:user:${challenge.userId}`
  const state = await peekRateLimit(bucket, SEND_RULE, deps)
  if (state.blocked) {
    logWarn({ event: 'auth.mfa_send_code_rate_limited', userId: challenge.userId, ip, attempts: state.count })
    setResponseHeader(event, 'Retry-After', state.retryAfterSeconds)
    throw createError({ statusCode: 429, statusMessage: 'Đã gửi quá nhiều mã. Vui lòng thử lại sau ít phút.' })
  }

  const user = await loadSessionUser(challenge.username)
  if (!user || !user.isActive || user.id !== challenge.userId || (user.tokenVersion ?? 0) !== challenge.tokenVersion) {
    clearChallengeCookie(event)
    throw createError({ statusCode: 401, statusMessage: 'Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại.' })
  }

  const factor = await getFactor(user.id, 'email_otp')
  if (!factor || factor.state !== 'active') {
    throw createError({ statusCode: 400, statusMessage: 'Tài khoản chưa bật phương thức mã gửi về email.' })
  }

  await recordRateLimitHit(bucket, SEND_RULE, deps)

  const issued = await issueEmailCode({
    factorId: factor.id,
    email: user.email,
    username: user.username,
    purpose: 'login',
  })
  if (!issued.ok) {
    logWarn({ event: 'auth.mfa_send_code_failed', userId: user.id, ip, reason: issued.reason })
    throw createError({ statusCode: 503, statusMessage: 'Không gửi được mã xác thực. Vui lòng dùng phương thức khác hoặc liên hệ quản trị viên.' })
  }

  return { ok: true, sent: true }
})
