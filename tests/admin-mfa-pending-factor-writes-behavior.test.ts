import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The pending-factor writes of the MFA enrollment endpoints that no other suite runs:
 *
 * `POST /api/admin/profile/mfa/confirm` (confirm.post.ts) drops the caller's pending row when the
 * enrollment window lapsed, when its stored TOTP secret will not open, or when the emailed code was
 * missed too often — and counts a wrong emailed code. Each statement is guarded by the pending row
 * exactly as the handler read it ("pending snapshot"): a concurrent re-enrollment that replaced the
 * secret / code in between makes it match nothing, so the newer enrollment survives.
 *
 * `POST /api/admin/profile/mfa/enroll` (enroll.post.ts) inserts the pending row on a first
 * enrollment and replaces OUR pending row on a re-enrollment — never an active one (409).
 *
 * Real h3 app and real handlers; Drizzle's SQL on SQLite (`_sqlite-mysql-db.ts`). Pins behaviour, so
 * it holds whether those statements live in the handler or in a service.
 */

process.env.JWT_SECRET = 'admin-mfa-pending-factor-writes-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { users, settings, userMfaFactors, userRecoveryCodes, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([users, settings, userMfaFactors, userRecoveryCodes, activityLogs])

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

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const h3 = await import('h3')
const confirm = (await import('../server/api/admin/profile/mfa/confirm.post')).default
const enroll = (await import('../server/api/admin/profile/mfa/enroll.post')).default
const { hashPassword } = await import('../server/utils/auth')
const { hashOneTimeCode, EMAIL_CODE_MAX_ATTEMPTS } = await import('../server/utils/mfa/codes')
const policy = await import('../server/utils/mfa/policy')

const ADMIN = { id: 7, username: 'editor', email: 'editor@example.vn', roleId: 3, roleName: 'Biên tập viên', isSystem: false, isSuperAdmin: false, permissions: [] }
const asAdmin = h3.defineEventHandler((event) => { event.context.adminUser = ADMIN })
const server = await startHandlerServer([
  { method: 'post', path: '/confirm', handler: confirm },
  { method: 'post', path: '/enroll', handler: enroll },
], [asAdmin])
after(() => server.close())

const PASSWORD = 'Editor-current-password-1'
const PASSWORD_HASH = await hashPassword(PASSWORD)
const EMAIL_CODE = '123456'
const EMAIL_CODE_HASH = await hashOneTimeCode(EMAIL_CODE)
const minutes = (n: number) => new Date(Date.now() + n * 60_000)

const factorRows = () => harness.rows(userMfaFactors).map(row => ({
  id: row.id, userId: row.userId, factorType: row.factorType, state: row.state,
  secret: row.secretCiphertext, codeHash: row.pendingCodeHash, attempts: row.pendingCodeAttempts,
}))

async function plantPending(values: Record<string, unknown>) {
  await harness.db.insert(userMfaFactors).values({ id: 40, userId: ADMIN.id, state: 'pending', pendingExpiresAt: minutes(10), ...values } as never)
}

beforeEach(async () => {
  harness.reset()
  memory = new Map()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(users).values({ id: ADMIN.id, username: ADMIN.username, email: ADMIN.email, passwordHash: PASSWORD_HASH, roleId: 3, tokenVersion: 2 })
  // Another account's pending factor: never touched by this account's requests.
  await harness.db.insert(userMfaFactors).values({ id: 90, userId: 8, factorType: 'totp', state: 'pending', secretCiphertext: 'other-account', pendingExpiresAt: minutes(-60) })
})

// ── confirm: dropping the pending row ───────────────────────────────────────────

test('confirm: a lapsed enrollment window drops our pending row (and only it), answers 400, writes nothing else', async () => {
  await plantPending({ factorType: 'totp', secretCiphertext: 'sealed-secret', pendingExpiresAt: minutes(-1) })
  const response = await server.request('POST', '/confirm', { body: { factorType: 'totp', code: '000000' } })
  assert.equal(response.status, 400)
  assert.match(String(response.body.statusMessage), /hết hiệu lực/)
  assert.deepEqual(factorRows().map(row => row.id), [90], 'our lapsed pending row is gone; the other account’s stays')
  assert.equal(harness.rows(activityLogs).length, 0)
  assert.equal(response.cookies.has('cdkt_admin'), false)
  assert.equal(harness.rows(users)[0]!.tokenVersion, 2)
  assert.ok(harness.statements.some(sql => /^delete from `user_mfa_factors` where/.test(sql)), 'the drop is one DELETE')
})

test('confirm: the drop is guarded by the pending snapshot — a re-enrollment landing in between survives', async () => {
  await plantPending({ factorType: 'totp', secretCiphertext: 'sealed-secret', pendingExpiresAt: minutes(-1) })
  harness.beforeNext(/^delete from `user_mfa_factors`/, () => {
    harness.sqlite.exec("UPDATE user_mfa_factors SET secret_ciphertext = 'newer-secret' WHERE id = 40")
  })
  const response = await server.request('POST', '/confirm', { body: { factorType: 'totp', code: '000000' } })
  assert.equal(response.status, 400)
  assert.deepEqual(factorRows().find(row => row.id === 40)?.secret, 'newer-secret', 'the newer pending enrollment was deleted')
})

test('confirm: a stored TOTP secret that will not open drops the pending row and answers 500', async () => {
  await plantPending({ factorType: 'totp', secretCiphertext: 'not-a-sealed-secret', secretNonce: 'n', secretAuthTag: 't', secretVersion: 1, secretKeyId: 'k' })
  const response = await server.request('POST', '/confirm', { body: { factorType: 'totp', code: '123456' } })
  assert.equal(response.status, 500)
  assert.match(String(response.body.statusMessage), /Không đọc được secret/)
  assert.deepEqual(factorRows().map(row => row.id), [90])
  assert.equal(harness.rows(activityLogs).length, 0)
})

test('confirm: an emailed code missed too often drops the pending row', async () => {
  await plantPending({ factorType: 'email_otp', pendingCodeHash: EMAIL_CODE_HASH, pendingCodeExpiresAt: minutes(5), pendingCodeAttempts: EMAIL_CODE_MAX_ATTEMPTS })
  const response = await server.request('POST', '/confirm', { body: { factorType: 'email_otp', code: EMAIL_CODE } })
  assert.equal(response.status, 400)
  assert.match(String(response.body.statusMessage), /quá nhiều lần/)
  assert.deepEqual(factorRows().map(row => row.id), [90])
})

// ── confirm: counting a wrong emailed code ──────────────────────────────────────

test('confirm: a wrong emailed code counts one attempt and leaves the factor pending', async () => {
  await plantPending({ factorType: 'email_otp', pendingCodeHash: EMAIL_CODE_HASH, pendingCodeExpiresAt: minutes(5), pendingCodeAttempts: 1 })
  const response = await server.request('POST', '/confirm', { body: { factorType: 'email_otp', code: '654321' } })
  assert.equal(response.status, 400)
  assert.match(String(response.body.statusMessage), /không đúng/)
  const row = factorRows().find(candidate => candidate.id === 40)!
  assert.equal(row.state, 'pending')
  assert.equal(row.attempts, 2)
  assert.equal(harness.rows(activityLogs).length, 0)
})

test('confirm: the attempt counter never passes the ceiling, and follows the snapshot', async () => {
  await plantPending({ factorType: 'email_otp', pendingCodeHash: EMAIL_CODE_HASH, pendingCodeExpiresAt: minutes(5), pendingCodeAttempts: EMAIL_CODE_MAX_ATTEMPTS - 1 })
  // Another request reaches the ceiling between our read and our write.
  harness.beforeNext(/^update `user_mfa_factors`/, () => {
    harness.sqlite.exec(`UPDATE user_mfa_factors SET pending_code_attempts = ${EMAIL_CODE_MAX_ATTEMPTS} WHERE id = 40`)
  })
  assert.equal((await server.request('POST', '/confirm', { body: { factorType: 'email_otp', code: '654321' } })).status, 400)
  assert.equal(factorRows().find(row => row.id === 40)!.attempts, EMAIL_CODE_MAX_ATTEMPTS)

  // A new code issued in between (new hash): the stale miss is not counted against it.
  harness.sqlite.exec('UPDATE user_mfa_factors SET pending_code_attempts = 0 WHERE id = 40')
  harness.beforeNext(/^update `user_mfa_factors`/, () => {
    harness.sqlite.exec("UPDATE user_mfa_factors SET pending_code_hash = 'newer-code-hash' WHERE id = 40")
  })
  assert.equal((await server.request('POST', '/confirm', { body: { factorType: 'email_otp', code: '654321' } })).status, 400)
  const row = factorRows().find(candidate => candidate.id === 40)!
  assert.equal(row.attempts, 0)
  assert.equal(row.codeHash, 'newer-code-hash')
})

// ── enroll: storing the pending row ─────────────────────────────────────────────

test('enroll: a first second-tier password inserts one pending row, hashed, for this account only', async () => {
  const response = await server.request('POST', '/enroll', { body: { factorType: 'second_password', currentPassword: PASSWORD, secondPassword: 'Mat-khau-cap-2-rat-dai!' } })
  assert.equal(response.status, 200)
  assert.equal(response.body.factorType, 'second_password')
  const rows = harness.rows(userMfaFactors).filter(row => row.userId === ADMIN.id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.state, 'pending')
  assert.match(String(rows[0]!.passwordHash), /^\$2[aby]\$/, 'stored as a bcrypt hash')
  assert.ok(rows[0]!.pendingExpiresAt instanceof Date && rows[0]!.pendingExpiresAt.getTime() > Date.now())
  assert.equal(harness.rows(activityLogs).length, 0)
})

test('enroll: a re-enrollment replaces OUR pending row in place', async () => {
  await plantPending({ factorType: 'second_password', passwordHash: 'old-pending-hash' })
  const response = await server.request('POST', '/enroll', { body: { factorType: 'second_password', currentPassword: PASSWORD, secondPassword: 'Mat-khau-cap-2-rat-dai!' } })
  assert.equal(response.status, 200)
  const rows = harness.rows(userMfaFactors).filter(row => row.userId === ADMIN.id)
  assert.deepEqual(rows.map(row => [row.id, row.state]), [[40, 'pending']])
  assert.notEqual(rows[0]!.passwordHash, 'old-pending-hash')
})

test('enroll: a re-enrollment never downgrades a factor activated in between (409)', async () => {
  await plantPending({ factorType: 'second_password', passwordHash: 'old-pending-hash' })
  harness.beforeNext(/^update `user_mfa_factors`/, () => {
    harness.sqlite.exec("UPDATE user_mfa_factors SET state = 'active' WHERE id = 40")
  })
  const response = await server.request('POST', '/enroll', { body: { factorType: 'second_password', currentPassword: PASSWORD, secondPassword: 'Mat-khau-cap-2-rat-dai!' } })
  assert.equal(response.status, 409)
  const row = harness.rows(userMfaFactors).find(candidate => candidate.id === 40)!
  assert.equal(row.state, 'active')
  assert.equal(row.passwordHash, 'old-pending-hash')
})
