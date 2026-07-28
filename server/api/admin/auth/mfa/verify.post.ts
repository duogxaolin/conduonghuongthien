/**
 * Second half of the login: exchange a challenge ticket plus one satisfied
 * factor for a session.
 *
 * Reached without a session by design (admin-auth.ts skips this path), so the
 * challenge cookie is the only authority it accepts. Two limits apply: a
 * per-challenge attempt ceiling that burns the ticket, and a per-account window
 * that survives the attacker discarding the ticket and re-entering the password.
 */
import { getRequestIP } from 'h3'
import { verifyMfaChallenge } from '../../../../utils/auth'
import { getPool } from '../../../../utils/db'
import { logInfo, logWarn, SECURITY_EVENTS } from '../../../../utils/logger'
import {
  peekRateLimit,
  recordRateLimitHit,
  clearRateLimit,
  type RateLimitRule,
} from '../../../../utils/rate-limit-store'
import {
  CHALLENGE_COOKIE,
  clearChallengeCookie,
  completeLogin,
  loadSessionUser,
} from '../../../../utils/mfa/session'
import {
  attemptEmailCode,
  attemptRecoveryCode,
  attemptSecondPassword,
  attemptTotp,
  usableFactorTypes,
  type FactorType,
} from '../../../../utils/mfa/factors'

/** Sustained pressure on one account, across as many fresh tickets as they like. */
const ACCOUNT_RULE: RateLimitRule = { limit: 10, windowSeconds: 15 * 60 }

function limiterDeps() {
  const pool = getPool()
  return { execute: pool ? ((sql: string, params: unknown[]) => pool.query(sql, params)) : null }
}

type Method = FactorType | 'recovery_code'
const METHODS: Method[] = ['totp', 'email_otp', 'second_password', 'recovery_code']

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: false }) || 'unknown'

  const ticket = getCookie(event, CHALLENGE_COOKIE)
  const challenge = ticket ? verifyMfaChallenge(ticket) : null
  if (!challenge) {
    // Covers both "never had a ticket" and "ticket expired" — the caller has to
    // re-enter their password either way.
    clearChallengeCookie(event)
    throw createError({ statusCode: 401, statusMessage: 'Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const method = String(body?.method || '') as Method
  const code = String(body?.code || '').trim()
  if (!METHODS.includes(method) || !code) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng chọn phương thức và nhập mã xác thực.' })
  }

  const deps = limiterDeps()
  const accountBucket = `mfa:verify:user:${challenge.userId}`
  const accountState = await peekRateLimit(accountBucket, ACCOUNT_RULE, deps)
  if (accountState.blocked) {
    logWarn({
      event: SECURITY_EVENTS.mfaChallengeLocked,
      userId: challenge.userId,
      username: challenge.username,
      ip,
      scope: 'account',
      attempts: accountState.count,
      backend: accountState.backend,
    })
    clearChallengeCookie(event)
    setResponseHeader(event, 'Retry-After', accountState.retryAfterSeconds)
    throw createError({ statusCode: 429, statusMessage: 'Quá nhiều lần xác thực sai. Vui lòng thử lại sau 15 phút.' })
  }

  const user = await loadSessionUser(challenge.username)
  if (!user || !user.isActive || user.id !== challenge.userId) {
    clearChallengeCookie(event)
    throw createError({ statusCode: 401, statusMessage: 'Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại.' })
  }

  // The ticket is pinned to the session generation at password time: anything
  // that revoked sessions since (a password change, an enrollment elsewhere)
  // kills the challenge too.
  if ((user.tokenVersion ?? 0) !== challenge.tokenVersion) {
    clearChallengeCookie(event)
    throw createError({ statusCode: 401, statusMessage: 'Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại.' })
  }

  const usable = await usableFactorTypes(user.id)
  if (usable.length === 0) {
    // Every factor was disabled mid-challenge; the password alone is now enough.
    clearChallengeCookie(event)
    logInfo({ event: SECURITY_EVENTS.loginSucceeded, username: user.username, userId: user.id, ip, mfa: 'none_remaining' })
    return completeLogin(event, user, { ip })
  }

  // One satisfied factor is enough — several enabled factors are alternatives,
  // not a chain.
  if (method !== 'recovery_code' && !usable.includes(method)) {
    throw createError({ statusCode: 400, statusMessage: 'Phương thức xác thực này chưa được bật cho tài khoản.' })
  }

  const attempt = method === 'totp' ? await attemptTotp(user.id, code)
    : method === 'email_otp' ? await attemptEmailCode(user.id, code)
    : method === 'second_password' ? await attemptSecondPassword(user.id, code)
    : await attemptRecoveryCode(user.id, code)

  if (!attempt.ok) {
    const state = await recordRateLimitHit(accountBucket, ACCOUNT_RULE, deps)
    // `reason` is for the operator; the caller gets one message per outcome class.
    logWarn({
      event: SECURITY_EVENTS.mfaChallengeFailed,
      userId: user.id,
      username: user.username,
      ip,
      method,
      reason: attempt.reason,
      attempts: state.count,
    })
    if (state.blocked) {
      clearChallengeCookie(event)
      setResponseHeader(event, 'Retry-After', state.retryAfterSeconds)
      throw createError({ statusCode: 429, statusMessage: 'Quá nhiều lần xác thực sai. Vui lòng thử lại sau 15 phút.' })
    }
    if (attempt.reason === 'expired') {
      throw createError({ statusCode: 401, statusMessage: 'Mã đã hết hiệu lực. Vui lòng yêu cầu mã mới.' })
    }
    if (attempt.reason === 'attempts') {
      clearChallengeCookie(event)
      throw createError({ statusCode: 401, statusMessage: 'Mã đã bị vô hiệu do nhập sai quá nhiều lần. Vui lòng đăng nhập lại.' })
    }
    throw createError({ statusCode: 401, statusMessage: 'Mã xác thực không đúng.' })
  }

  await clearRateLimit(accountBucket, deps)
  clearChallengeCookie(event)

  if (attempt.method === 'recovery_code') {
    logWarn({
      event: SECURITY_EVENTS.mfaRecoveryCodeUsed,
      userId: user.id,
      username: user.username,
      ip,
    })
  }
  logInfo({
    event: SECURITY_EVENTS.loginSucceeded,
    username: user.username,
    userId: user.id,
    ip,
    mfa: attempt.method,
  })

  return completeLogin(event, user, { ip, method: attempt.method })
})
