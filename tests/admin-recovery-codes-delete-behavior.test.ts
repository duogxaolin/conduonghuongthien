import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'
import bcrypt from 'bcryptjs'

/**
 * `DELETE /api/admin/profile/mfa/recovery-codes`
 * (server/api/admin/profile/mfa/recovery-codes.delete.ts) — turn recovery codes off.
 *
 * Recovery codes are the last way back into an account whose device is lost, so a
 * borrowed session must not be able to burn them quietly. Invariants:
 *   - the current password is re-proved first: a wrong or missing one deletes
 *     nothing, and the re-proof is the rate-limited one (five misses, then even the
 *     right password gets 429);
 *   - the right one deletes every code of THIS account — used and unused — and no
 *     other account's;
 *   - the deletion and its audit row commit together: if the audit cannot be
 *     written, every code is still there;
 *   - the answer says plainly whether a way back remains (a usable e-mail code) or
 *     the account is now one lost device away from lock-out.
 *
 * Real h3 app: the real `admin-auth` middleware, the real handler, the real
 * `reauth` (bcrypt) and `mfa/factors` helpers. Drizzle's SQL runs on SQLite
 * (`_sqlite-mysql-db.ts`, real transaction); the limiter is `rate-limit-store` on
 * its memory backend, fresh per test.
 */

process.env.JWT_SECRET = 'admin-recovery-codes-delete-test-secret-0123456789'
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
const adminAuth = (await import('../server/middleware/admin-auth')).default
const deleteCodes = (await import('../server/api/admin/profile/mfa/recovery-codes.delete')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'delete', path: '/api/admin/profile/mfa/recovery-codes', handler: deleteCodes }], [adminAuth])
after(() => server.close())

const PASSWORD = 'Editor-current-password-1'
const HASH = await bcrypt.hash(PASSWORD, 4)
const EDITOR = { id: 7, username: 'editor', roleId: 3, roleName: 'Biên tập viên' }
const OTHER = { id: 8, username: 'other', roleId: 3, roleName: 'Biên tập viên' }
const cookieFor = (account: typeof EDITOR) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const clearCodes = (body: unknown, account = EDITOR) =>
  server.request('DELETE', '/api/admin/profile/mfa/recovery-codes', { cookie: cookieFor(account), body })

const codeOwners = () => harness.rows(userRecoveryCodes).map(row => row.userId).sort()
const snapshot = () => ({ codes: harness.rows(userRecoveryCodes).map(row => `${row.userId}:${row.codeHash}`), audit: harness.rows(activityLogs).length })

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
  await harness.db.insert(userMfaFactors).values({ userId: EDITOR.id, factorType: 'second_password', state: 'active', passwordHash: 'x' })
  await harness.db.insert(userRecoveryCodes).values([
    { userId: EDITOR.id, codeHash: 'e1', batchId: 'b-editor' },
    { userId: EDITOR.id, codeHash: 'e2', batchId: 'b-editor' },
    { userId: EDITOR.id, codeHash: 'e3', batchId: 'b-editor', usedAt: new Date('2026-10-01T00:00:00Z') },
    { userId: OTHER.id, codeHash: 'o1', batchId: 'b-other' },
    { userId: OTHER.id, codeHash: 'o2', batchId: 'b-other' },
  ])
})

test('a wrong current password deletes nothing and writes no audit', async () => {
  const before = snapshot()
  assert.equal((await clearCodes({ currentPassword: 'a-guess' })).status, 401)
  assert.deepEqual(snapshot(), before)
})

test('a missing current password is refused the same way', async () => {
  const before = snapshot()
  assert.equal((await clearCodes({})).status, 400)
  assert.equal((await clearCodes(undefined)).status, 400)
  assert.deepEqual(snapshot(), before)
})

test('the re-proof is the rate-limited one: after five guesses the right password is refused too', async () => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal((await clearCodes({ currentPassword: `guess-${attempt}` })).status, 401)
  }
  const before = snapshot()
  const response = await clearCodes({ currentPassword: PASSWORD })
  assert.equal(response.status, 429)
  assert.ok(Number(response.headers.get('retry-after')) > 0)
  assert.deepEqual(snapshot(), before)
})

test('the right password deletes every code of this account — used ones too — and nobody else\'s', async () => {
  const response = await clearCodes({ currentPassword: PASSWORD })
  assert.equal(response.status, 200)
  assert.deepEqual(codeOwners(), [OTHER.id, OTHER.id])
})

test('the deletion is audited against the account', async () => {
  await clearCodes({ currentPassword: PASSWORD })
  const rows = harness.rows(activityLogs)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.userId, EDITOR.id)
  assert.equal(rows[0]!.resource, 'profile_recovery_codes')
  assert.equal(rows[0]!.resourceId, EDITOR.id)
  assert.equal((rows[0]!.meta as Record<string, unknown>).cleared, true)
})

test('if the audit row cannot be written, every code is still there', async () => {
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await clearCodes({ currentPassword: PASSWORD })).status, 500)
  assert.deepEqual(snapshot(), before)
})

test('the answer names the lock-out case: no usable e-mail code left means no way back', async () => {
  const response = await clearCodes({ currentPassword: PASSWORD })
  assert.equal(response.body.lockoutRisk, true)
  assert.match(String(response.body.message), /KHÔNG còn đường dự phòng/)
})

test('with a usable e-mail code the answer says that is the remaining way back', async () => {
  await harness.db.insert(userMfaFactors).values({ userId: EDITOR.id, factorType: 'email_otp', state: 'active' })
  const response = await clearCodes({ currentPassword: PASSWORD })
  assert.equal(response.body.lockoutRisk, false)
  assert.match(String(response.body.message), /email là đường dự phòng còn lại/)
})

test('without a session the gate refuses before the handler runs', async () => {
  const before = snapshot()
  assert.equal((await server.request('DELETE', '/api/admin/profile/mfa/recovery-codes', { body: { currentPassword: PASSWORD } })).status, 401)
  assert.deepEqual(snapshot(), before)
})
