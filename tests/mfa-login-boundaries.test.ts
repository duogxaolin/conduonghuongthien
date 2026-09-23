import assert from 'node:assert/strict'
import { beforeEach, mock, test } from 'node:test'

let availability = { active: false, usable: [] as string[] }
let recoveries = 0
let accepted = false
let completed = 0
let challenges = 0
let attempts = 0
const user = { id: 10, username: 'admin', isActive: true, tokenVersion: 0 }
const session = {
  CHALLENGE_COOKIE: 'mfa', clearChallengeCookie() {},
  setChallengeCookie() { challenges++ },
  async completeLogin() { completed++; return { ok: true, user } },
  async loadSessionUser() { return user },
}
const verify = async () => { attempts++; return accepted ? { ok: true, method: 'recovery_code' } : { ok: false, reason: 'mismatch' } }
mock.module('../server/utils/mfa/factors', { namedExports: {
  factorAvailability: async () => availability,
  countUnusedRecoveryCodes: async () => recoveries,
  attemptTotp: verify, attemptEmailCode: verify, attemptSecondPassword: verify, attemptRecoveryCode: verify,
} })
mock.module('../server/utils/mfa/session', { namedExports: session })
mock.module('../server/utils/auth', { namedExports: {
  verifyPassword: async () => true,
  verifyMfaChallenge: () => ({ userId: 10, username: 'admin', tokenVersion: 0 }),
} })
mock.module('../server/utils/db', { namedExports: { getDb: () => ({ select: () => ({ from: () => ({
  leftJoin: () => ({ where: () => ({ limit: async () => [user] }) }),
}) }) }) } })
mock.module('../server/utils/logger', { namedExports: { logInfo() {}, logWarn() {}, SECURITY_EVENTS: {} } })
mock.module('../server/utils/rate-limit-store', { namedExports: {
  peekRateLimit: async () => ({ blocked: false }),
  recordRateLimitHit: async () => ({ blocked: false }), clearRateLimit: async () => {},
} })
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({}) } })
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '127.0.0.1' } })
Object.assign(globalThis, {
  defineEventHandler: (handler: unknown) => handler,
  readBody: async (event: any) => event.body,
  createError: (options: any) => Object.assign(new Error(options.statusMessage), options),
  getCookie: () => 'ticket', setResponseHeader() {},
})
const login = (await import('../server/api/admin/auth/login.post')).default as any
const verifyMfa = (await import('../server/api/admin/auth/mfa/verify.post')).default as any
const loginEvent = { body: { username: 'admin', password: 'password' } }
const challengeEvent = (method: string) => ({ body: { method, code: '123456' } })

beforeEach(() => {
  availability = { active: false, usable: [] }
  recoveries = 0
  accepted = false
  completed = challenges = attempts = 0
})

test('password-only login still works for accounts that have no active factors', async () => {
  assert.equal((await login(loginEvent)).ok, true)
  assert.equal(completed, 1)
  assert.equal(challenges, 0)
})
test('unreadable active factors with recovery codes issue a recovery-only challenge', async () => {
  availability.active = true
  recoveries = 2
  assert.deepEqual(await login(loginEvent), { ok: true, mfaRequired: true, methods: [], recoveryCodesAvailable: true })
  assert.equal(completed, 0)
  assert.equal(challenges, 1)
})
test('unreadable active factors without recovery fail closed with a support message', async () => {
  availability.active = true
  await assert.rejects(login(loginEvent), { statusCode: 503 })
  assert.equal(completed, 0)
  assert.equal(challenges, 0)
})
test('usable alternative factors remain offered when TOTP is unreadable', async () => {
  availability = { active: true, usable: ['email_otp'] }
  assert.deepEqual((await login(loginEvent)).methods, ['email_otp'])
  assert.equal(completed, 0)
})
test('challenge verification never bypasses an unreadable factor', async () => {
  availability.active = true
  await assert.rejects(verifyMfa(challengeEvent('totp')), { statusCode: 400 })
  assert.equal(completed, 0)
  assert.equal(attempts, 0)
})
test('recovery-only challenge requires a valid recovery code', async () => {
  availability.active = true
  await assert.rejects(verifyMfa(challengeEvent('recovery_code')), { statusCode: 401 })
  assert.equal(completed, 0)
  accepted = true
  assert.equal((await verifyMfa(challengeEvent('recovery_code'))).ok, true)
  assert.equal(completed, 1)
  assert.equal(attempts, 2)
})
test('removing factors mid-challenge requires a new password login', async () => {
  await assert.rejects(verifyMfa(challengeEvent('recovery_code')), { statusCode: 401 })
  assert.equal(completed, 0)
  assert.equal(attempts, 0)
})
test('valid alternative factor completes a challenge normally', async () => {
  availability = { active: true, usable: ['email_otp'] }
  accepted = true
  assert.equal((await verifyMfa(challengeEvent('email_otp'))).ok, true)
  assert.equal(completed, 1)
})
