import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'
import bcrypt from 'bcryptjs'

/**
 * `POST /api/admin/profile/mfa/disable` (server/api/admin/profile/mfa/disable.post.ts)
 * — turn one of your own second factors off.
 *
 * A borrowed session must not be able to strip the factor protecting the account,
 * so the invariants are:
 *   - the current password is re-proved FIRST: a wrong one changes nothing at all
 *     (row, secret, recovery codes, sessions), and the re-proof is the rate-limited
 *     one (`mfa/reauth.ts`);
 *   - a correct one DELETES the row, so "disabled" cannot drift from "secret still
 *     in the database" — and only that factor of only this account;
 *   - with no factor left, the recovery codes go too (material with no purpose);
 *   - every other session of the account ends; the one that asked gets a fresh
 *     cookie and carries on.
 *
 * Real h3 app: the real `admin-auth` middleware, then the real handler, with the
 * real `reauth`, `mfa/factors` and `mfa/session` helpers behind it. Drizzle's SQL
 * runs on SQLite (`_sqlite-mysql-db.ts`); the limiter is `rate-limit-store` on its
 * memory backend, fresh per test.
 *
 * Not pinned: audit-and-delete atomicity — the handler re-issues the session cookie
 * between its writes (named in `tests/reader-audit-atomicity.test.ts`).
 */

process.env.JWT_SECRET = 'admin-mfa-disable-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, userRecoveryCodes, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, userRecoveryCodes, activityLogs])

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
const adminAuth = (await import('../server/middleware/admin-auth')).default
const disable = (await import('../server/api/admin/profile/mfa/disable.post')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'post', path: '/api/admin/profile/mfa/disable', handler: disable },
  { method: 'get', path: '/api/admin/news', handler: h3.defineEventHandler(event => ({ userId: (event.context.adminUser as { id: number }).id })) },
], [adminAuth])
after(() => server.close())

const PASSWORD = 'Editor-current-password-1'
const HASH = await bcrypt.hash(PASSWORD, 4)
const EDITOR = { id: 7, username: 'editor', roleId: 3, roleName: 'Biên tập viên' }
const OTHER = { id: 8, username: 'other', roleId: 3, roleName: 'Biên tập viên' }

const cookieFor = (account: typeof EDITOR, tokenVersion = 0) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion })}`
const disableFactor = (body: unknown, cookie = cookieFor(EDITOR)) =>
  server.request('POST', '/api/admin/profile/mfa/disable', { cookie, body })

const factorRows = () => harness.rows(userMfaFactors).map(row => ({ userId: row.userId, factorType: row.factorType, secret: row.secretCiphertext }))
const snapshot = () => ({
  factors: factorRows(),
  codes: harness.rows(userRecoveryCodes).map(row => row.userId),
  tokenVersions: harness.rows(users).map(row => row.tokenVersion),
  audit: harness.rows(activityLogs).length,
})

beforeEach(async () => {
  harness.reset()
  memory = new Map()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values({ id: 3, name: EDITOR.roleName, isSystem: false })
  await harness.db.insert(permissions).values({ roleId: 3, resource: 'news', canRead: true })
  await harness.db.insert(users).values([
    { id: EDITOR.id, username: EDITOR.username, email: 'editor@example.vn', passwordHash: HASH, roleId: 3 },
    { id: OTHER.id, username: OTHER.username, email: 'other@example.vn', passwordHash: HASH, roleId: 3 },
  ])
  await harness.db.insert(userMfaFactors).values([
    { userId: EDITOR.id, factorType: 'totp', state: 'active', secretCiphertext: 'sealed-editor-totp', secretNonce: 'n', secretAuthTag: 't', secretVersion: 1, secretKeyId: 'k' },
    { userId: OTHER.id, factorType: 'totp', state: 'active', secretCiphertext: 'sealed-other-totp' },
  ])
  await harness.db.insert(userRecoveryCodes).values([
    { userId: EDITOR.id, codeHash: 'h1', batchId: 'b1' },
    { userId: EDITOR.id, codeHash: 'h2', batchId: 'b1' },
    { userId: OTHER.id, codeHash: 'h3', batchId: 'b2' },
  ])
})

test('a wrong current password changes nothing: factor, secret, codes, sessions all stay', async () => {
  const before = snapshot()
  const response = await disableFactor({ factorType: 'totp', currentPassword: 'a-guess' })
  assert.equal(response.status, 401)
  assert.deepEqual(snapshot(), before)
  assert.equal(response.cookies.has('cdkt_admin'), false, 'a refused request must not re-issue the session')
})

test('a missing current password is refused the same way', async () => {
  const before = snapshot()
  assert.equal((await disableFactor({ factorType: 'totp' })).status, 400)
  assert.deepEqual(snapshot(), before)
})

test('the re-proof is the rate-limited one: after five guesses the right password is refused too', async () => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal((await disableFactor({ factorType: 'totp', currentPassword: `guess-${attempt}` })).status, 401)
  }
  const before = snapshot()
  assert.equal((await disableFactor({ factorType: 'totp', currentPassword: PASSWORD })).status, 429)
  assert.deepEqual(snapshot(), before)
})

test('the right password deletes the row and its secret — only that factor, only this account', async () => {
  await harness.db.insert(userMfaFactors).values({ userId: EDITOR.id, factorType: 'email_otp', state: 'active' })
  const response = await disableFactor({ factorType: 'totp', currentPassword: PASSWORD })
  assert.equal(response.status, 200)
  assert.equal(response.body.factorType, 'totp')
  assert.deepEqual(factorRows(), [
    { userId: OTHER.id, factorType: 'totp', secret: 'sealed-other-totp' },
    { userId: EDITOR.id, factorType: 'email_otp', secret: null },
  ])
  const rawDump = JSON.stringify(harness.sqlite.prepare('SELECT * FROM user_mfa_factors').all())
  assert.ok(!rawDump.includes('sealed-editor-totp'), 'the disabled factor\'s secret is still in the table')
})

test('with no factor left the recovery codes go too; with one left they stay', async () => {
  await harness.db.insert(userMfaFactors).values({ userId: EDITOR.id, factorType: 'second_password', state: 'active', passwordHash: 'x' })
  await disableFactor({ factorType: 'totp', currentPassword: PASSWORD })
  assert.deepEqual(harness.rows(userRecoveryCodes).map(row => row.userId).sort(), [EDITOR.id, EDITOR.id, OTHER.id], 'codes dropped while a factor remained')

  const response = await disableFactor({ factorType: 'second_password', currentPassword: PASSWORD }, cookieFor(EDITOR, 1))
  assert.equal(response.status, 200)
  assert.deepEqual(harness.rows(userRecoveryCodes).map(row => row.userId), [OTHER.id], 'codes outlived the last factor (or another account\'s went too)')
})

test('every other session ends; the one that asked gets a fresh cookie that works', async () => {
  const otherDevice = cookieFor(EDITOR)
  const otherAccount = cookieFor(OTHER)
  const response = await disableFactor({ factorType: 'totp', currentPassword: PASSWORD })
  assert.equal(response.status, 200)

  assert.equal((await server.request('GET', '/api/admin/news', { cookie: otherDevice })).status, 401, 'another session of the account survived')
  const fresh = response.cookies.get('cdkt_admin')
  assert.ok(fresh?.value, 'the acting session was not re-issued')
  assert.equal((await server.request('GET', '/api/admin/news', { cookie: `cdkt_admin=${fresh.value}` })).status, 200)
  assert.equal((await server.request('GET', '/api/admin/news', { cookie: otherAccount })).status, 200, 'another account was signed out')
})

test('the change is audited against the account, factor named, enabled false', async () => {
  await disableFactor({ factorType: 'totp', currentPassword: PASSWORD })
  const rows = harness.rows(activityLogs)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.userId, EDITOR.id)
  assert.equal(rows[0]!.resource, 'profile_mfa')
  const meta = rows[0]!.meta as Record<string, unknown>
  assert.equal(meta.factorType, 'totp')
  assert.equal(meta.enabled, false)
})

test('an unknown factor type is a 400 and a factor that is not enabled is a 404 — neither writes', async () => {
  const before = snapshot()
  for (const factorType of ['', 'sms', 'TOTP', 'recovery_code']) {
    assert.equal((await disableFactor({ factorType, currentPassword: PASSWORD })).status, 400, factorType)
  }
  assert.equal((await disableFactor({ factorType: 'email_otp', currentPassword: PASSWORD })).status, 404)
  assert.deepEqual(snapshot(), before)
})

test('without a session the gate refuses before the handler runs', async () => {
  const before = snapshot()
  assert.equal((await server.request('POST', '/api/admin/profile/mfa/disable', { body: { factorType: 'totp', currentPassword: PASSWORD } })).status, 401)
  assert.deepEqual(snapshot(), before)
})
