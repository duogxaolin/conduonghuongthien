import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `POST /api/admin/auth/mfa/send-code` (server/api/admin/auth/mfa/send-code.post.ts)
 * — mail a login code in the middle of an MFA challenge.
 *
 * The admin gate skips this path (there is no session yet), so the challenge
 * ticket is the only thing authorising it, and without its own limit it would be
 * a mail-sending endpoint for anyone holding a stolen password. Pinned:
 *   - only a valid, explicitly `mfa-challenge` ticket works — no ticket, a session
 *     token, a reader token or a forged one is a 401 and sends nothing;
 *   - the ticket dies with the account's sessions (`tokenVersion` moved) and with
 *     the account (deactivated);
 *   - the code goes to the address on the account, never one in the request;
 *   - three codes per account per 10 minutes, then 429 with `Retry-After`.
 *
 * Real h3 app with the real `admin-auth` middleware in front (to show the path
 * really is reachable without a session), real `verifyMfaChallenge`,
 * `loadSessionUser`, `getFactor`, `issueEmailCode` and bcrypt; Drizzle's SQL on
 * SQLite (`_sqlite-mysql-db.ts`); the limiter on its memory backend, fresh per
 * test. Only the SMTP transport is replaced.
 */

process.env.JWT_SECRET = 'admin-mfa-send-code-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs])

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })
let memory = new Map<string, { count: number, expiresAt: number }>()
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({ execute: null, memory }) } })
const mails: Array<{ to: string, subject: string, text: string }> = []
let smtpDown = false
mock.module('../server/utils/mailer', {
  namedExports: {
    sendMail: async (mail: { to: string, subject: string, text: string }) => {
      if (smtpDown) throw new Error('smtp unreachable')
      mails.push(mail)
    },
    isConfigured: async () => true,
  },
})

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const jwt = (await import('jsonwebtoken')).default
const adminAuth = (await import('../server/middleware/admin-auth')).default
const sendCode = (await import('../server/api/admin/auth/mfa/send-code.post')).default
const { signMfaChallenge, signToken, signReaderToken, verifyPassword } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'post', path: '/api/admin/auth/mfa/send-code', handler: sendCode }], [adminAuth])
after(() => server.close())

const EDITOR = { id: 7, username: 'editor', email: 'editor@example.vn' }
const OTHER = { id: 8, username: 'other', email: 'other@example.vn' }
const challengeFor = (account: { id: number, username: string }, tokenVersion = 0) =>
  `cdkt_mfa=${signMfaChallenge({ userId: account.id, username: account.username, tokenVersion })}`
const send = (cookie?: string, body?: unknown) => server.request('POST', '/api/admin/auth/mfa/send-code', { cookie, body })

beforeEach(async () => {
  harness.reset()
  memory = new Map()
  mails.length = 0
  smtpDown = false
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values({ id: 3, name: 'Biên tập viên', isSystem: false })
  await harness.db.insert(users).values([
    { id: EDITOR.id, username: EDITOR.username, email: EDITOR.email, passwordHash: 'x', roleId: 3 },
    { id: OTHER.id, username: OTHER.username, email: OTHER.email, passwordHash: 'x', roleId: 3 },
  ])
  await harness.db.insert(userMfaFactors).values([
    { id: 70, userId: EDITOR.id, factorType: 'email_otp', state: 'active' },
    { id: 80, userId: OTHER.id, factorType: 'email_otp', state: 'active' },
  ])
})

test('a valid challenge ticket and no session: one code, mailed to the address on the account', async () => {
  const response = await send(challengeFor(EDITOR), { email: 'attacker@evil.example', to: 'attacker@evil.example' })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true, sent: true })
  assert.equal(mails.length, 1)
  assert.equal(mails[0]!.to, EDITOR.email, 'the code went somewhere other than the account\'s own address')
})

test('only the hash of the mailed code is stored, and it is the mailed code that verifies', async () => {
  await send(challengeFor(EDITOR))
  const code = /Mã xác thực: (\d{6})/.exec(mails[0]!.text)?.[1]
  assert.ok(code, 'no six-digit code in the mail')
  const factor = harness.rows(userMfaFactors).find(row => row.id === 70)!
  assert.ok(typeof factor.pendingCodeHash === 'string' && factor.pendingCodeHash !== code)
  assert.equal(await verifyPassword(code, factor.pendingCodeHash as string), true)
  assert.ok((factor.pendingCodeExpiresAt as Date).getTime() > Date.now())
})

test('no ticket, or anything that is not an mfa-challenge ticket, is a 401 and sends nothing', async () => {
  const sessionToken = signToken({ userId: EDITOR.id, username: EDITOR.username, roleId: 3, roleName: 'Biên tập viên', tokenVersion: 0 })
  const forged = jwt.sign({ userId: EDITOR.id, username: EDITOR.username, tokenVersion: 0, stage: 'mfa-challenge' }, 'some-other-secret-0123456789abcdef')
  const candidates: Array<[string, string | undefined]> = [
    ['no cookie', undefined],
    ['garbage', 'cdkt_mfa=not-a-jwt'],
    ['a session token in the challenge cookie', `cdkt_mfa=${sessionToken}`],
    ['a session cookie and no challenge', `cdkt_admin=${sessionToken}`],
    ['a reader token', `cdkt_mfa=${signReaderToken({ readerId: EDITOR.id, tokenVersion: 0 })}`],
    ['a challenge signed with another key', `cdkt_mfa=${forged}`],
  ]
  for (const [label, cookie] of candidates) {
    const response = await send(cookie)
    assert.equal(response.status, 401, label)
    assert.equal(response.cookies.get('cdkt_mfa')?.value, '', `${label}: the challenge cookie was not cleared`)
  }
  assert.equal(mails.length, 0)
})

test('the ticket dies with the account\'s sessions: a moved tokenVersion is a 401 and no mail', async () => {
  const ticket = challengeFor(EDITOR, 0)
  harness.sqlite.prepare('UPDATE users SET token_version = 1 WHERE id = ?').run(EDITOR.id)
  const response = await send(ticket)
  assert.equal(response.status, 401)
  assert.equal(mails.length, 0)
})

test('a deactivated account, or a ticket naming one account with another\'s id, sends nothing', async () => {
  harness.sqlite.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(EDITOR.id)
  assert.equal((await send(challengeFor(EDITOR))).status, 401)
  assert.equal((await send(challengeFor({ id: EDITOR.id, username: OTHER.username }))).status, 401)
  assert.equal(mails.length, 0)
})

test('three codes per account per ten minutes, then 429 with Retry-After — per account', async () => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal((await send(challengeFor(EDITOR))).status, 200, `send ${attempt}`)
  }
  const limited = await send(challengeFor(EDITOR))
  assert.equal(limited.status, 429)
  const retryAfter = Number(limited.headers.get('retry-after'))
  assert.ok(retryAfter > 9 * 60 && retryAfter <= 10 * 60, `Retry-After ${retryAfter}s is not the 10-minute window`)
  assert.equal(mails.length, 3, 'a code was mailed past the limit')

  assert.equal((await send(challengeFor(OTHER))).status, 200, 'another account was limited by Editor\'s sends')
})

test('an account without an ACTIVE email factor gets a 400 and no mail', async () => {
  harness.sqlite.prepare('UPDATE user_mfa_factors SET state = ? WHERE id = ?').run('pending', 70)
  assert.equal((await send(challengeFor(EDITOR))).status, 400)
  harness.sqlite.prepare('DELETE FROM user_mfa_factors WHERE id = ?').run(70)
  assert.equal((await send(challengeFor(EDITOR))).status, 400)
  assert.equal(mails.length, 0)
})

test('an SMTP failure is reported as a failure, not as "sent"', async () => {
  smtpDown = true
  const response = await send(challengeFor(EDITOR))
  assert.equal(response.status, 503)
  assert.notEqual(response.body.sent, true)
})
