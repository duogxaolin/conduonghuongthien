import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `GET /api/admin/profile/mfa` (server/api/admin/profile/mfa/index.get.ts) — the
 * factor state the profile page draws.
 *
 * A factor row holds a TOTP ciphertext, a bcrypt hash and a pending e-mail code hash.
 * The invariants:
 *   - the response is an allowlist: none of that material — of any factor — reaches
 *     the client, and each factor carries only its type, state, usability and dates;
 *   - it describes the caller's own account only: another account's factors and
 *     recovery codes never show up, nor are they counted;
 *   - an active TOTP whose secret no longer opens (a rotated `JWT_SECRET`) is shown
 *     as active but NOT usable — that is how the rotation becomes visible;
 *   - the recovery-code count is this account's unused codes;
 *   - `lockoutRisk` is raised exactly when a factor is active and nothing could get
 *     the owner past it after losing the device (no codes, no usable e-mail code).
 *
 * Real h3 app: the real `admin-auth` middleware in front of the real handler, the real
 * `mfa/factors` helpers (with the real TOTP envelope under the test's JWT_SECRET) and
 * the real mailer's "is SMTP configured" check. Drizzle's SQL runs on SQLite
 * (`_sqlite-mysql-db.ts`).
 */

process.env.JWT_SECRET = 'admin-mfa-status-behavior-test-secret-0123456789'
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

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const mfaStatus = (await import('../server/api/admin/profile/mfa/index.get')).default
const { sealTotpSecret } = await import('../server/utils/mfa/crypto')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([{ method: 'get', path: '/api/admin/profile/mfa', handler: mfaStatus }], [adminAuth])
after(() => server.close())

const EDITOR = { id: 7, username: 'editor', roleId: 3, roleName: 'Biên tập viên' }
const OTHER = { id: 8, username: 'other', roleId: 3, roleName: 'Biên tập viên' }
const cookieFor = (account: typeof EDITOR) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const status = async (account = EDITOR) => {
  const response = await server.request('GET', '/api/admin/profile/mfa', { cookie: cookieFor(account) })
  assert.equal(response.status, 200)
  return response.body as { factors: Array<Record<string, unknown>>, recoveryCodesRemaining: number, recoveryCodesEnabled: boolean, lockoutRisk: boolean, email: string | null }
}
const factor = (body: Awaited<ReturnType<typeof status>>, type: string) => body.factors.find(entry => entry.factorType === type)!

const SECOND_PASSWORD_HASH = '$2a$10$secondTierPasswordHashMaterialXXXXXXXXXXXXXXXXXXXXXXXXX'
const PENDING_CODE_HASH = '$2a$10$pendingEmailCodeHashMaterialYYYYYYYYYYYYYYYYYYYYYYYYYYY'

function sealedTotp(userId: number, overrides: Record<string, unknown> = {}) {
  const sealed = sealTotpSecret('JBSWY3DPEHPK3PXP')
  return {
    userId, factorType: 'totp' as const, state: 'active' as const,
    secretCiphertext: sealed.ciphertext, secretNonce: sealed.nonce, secretAuthTag: sealed.authTag,
    secretVersion: sealed.version, secretKeyId: sealed.keyId, ...overrides,
  }
}

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values({ id: 3, name: EDITOR.roleName, isSystem: false })
  await harness.db.insert(permissions).values({ roleId: 3, resource: 'news', canRead: true })
  await harness.db.insert(users).values([
    { id: EDITOR.id, username: EDITOR.username, email: 'editor@example.vn', passwordHash: 'login-hash-editor', roleId: 3 },
    { id: OTHER.id, username: OTHER.username, email: 'other@example.vn', passwordHash: 'login-hash-other', roleId: 3 },
  ])
})

test('the response is an allowlist: no ciphertext, nonce, tag, key id, bcrypt hash or pending code hash', async () => {
  await harness.db.insert(userMfaFactors).values([
    sealedTotp(EDITOR.id),
    { userId: EDITOR.id, factorType: 'second_password', state: 'active', passwordHash: SECOND_PASSWORD_HASH },
    { userId: EDITOR.id, factorType: 'email_otp', state: 'active', pendingCodeHash: PENDING_CODE_HASH, pendingCodeExpiresAt: new Date(Date.now() + 60_000) },
  ])
  const body = await status()
  const wire = JSON.stringify(body)
  const [totpRow] = harness.rows(userMfaFactors).filter(row => row.factorType === 'totp')
  for (const material of [totpRow!.secretCiphertext, totpRow!.secretNonce, totpRow!.secretAuthTag, totpRow!.secretKeyId, SECOND_PASSWORD_HASH, PENDING_CODE_HASH, 'login-hash-editor']) {
    assert.ok(!wire.includes(String(material)), `factor material on the wire: ${String(material).slice(0, 12)}…`)
  }
  for (const entry of body.factors) {
    assert.deepEqual(Object.keys(entry).sort(), ['enrolledAt', 'factorType', 'lastUsedAt', 'state', 'usable'], String(entry.factorType))
  }
  assert.deepEqual(body.factors.map(entry => [entry.factorType, entry.state, entry.usable]), [
    ['totp', 'active', true], ['email_otp', 'active', true], ['second_password', 'active', true],
  ])
})

test('it describes the caller only: another account\'s factors and codes are neither shown nor counted', async () => {
  await harness.db.insert(userMfaFactors).values([sealedTotp(OTHER.id), { userId: OTHER.id, factorType: 'email_otp', state: 'active' }])
  await harness.db.insert(userRecoveryCodes).values([
    { userId: OTHER.id, codeHash: 'h1', batchId: 'b' },
    { userId: OTHER.id, codeHash: 'h2', batchId: 'b' },
  ])
  const body = await status()
  assert.deepEqual(body.factors.map(entry => [entry.factorType, entry.state, entry.usable]), [
    ['totp', 'disabled', false], ['email_otp', 'disabled', false], ['second_password', 'disabled', false],
  ])
  assert.equal(body.recoveryCodesRemaining, 0)
  assert.equal(body.recoveryCodesEnabled, false)
  assert.equal(body.email, 'editor@example.vn')
})

test('an active TOTP whose secret no longer opens is shown active but not usable', async () => {
  await harness.db.insert(userMfaFactors).values(sealedTotp(EDITOR.id, { secretKeyId: 'key-before-rotation' }))
  const totp = factor(await status(), 'totp')
  assert.equal(totp.state, 'active')
  assert.equal(totp.usable, false)
})

test('a pending enrolment is pending and not usable', async () => {
  await harness.db.insert(userMfaFactors).values(sealedTotp(EDITOR.id, { state: 'pending' }))
  const totp = factor(await status(), 'totp')
  assert.equal(totp.state, 'pending')
  assert.equal(totp.usable, false)
})

test('the recovery-code count is this account\'s unused codes', async () => {
  await harness.db.insert(userRecoveryCodes).values([
    { userId: EDITOR.id, codeHash: 'h1', batchId: 'b' },
    { userId: EDITOR.id, codeHash: 'h2', batchId: 'b' },
    { userId: EDITOR.id, codeHash: 'h3', batchId: 'b', usedAt: new Date('2026-10-01T00:00:00Z') },
    { userId: OTHER.id, codeHash: 'h4', batchId: 'c' },
  ])
  const body = await status()
  assert.equal(body.recoveryCodesRemaining, 2)
  assert.equal(body.recoveryCodesEnabled, true)
})

test('lockoutRisk: raised exactly when a factor is active and neither codes nor a usable e-mail code remain', async () => {
  assert.equal((await status()).lockoutRisk, false, 'nothing active: nothing to be locked out of')

  await harness.db.insert(userMfaFactors).values(sealedTotp(EDITOR.id))
  assert.equal((await status()).lockoutRisk, true, 'an authenticator app and no way back')

  await harness.db.insert(userRecoveryCodes).values({ userId: EDITOR.id, codeHash: 'h1', batchId: 'b' })
  assert.equal((await status()).lockoutRisk, false, 'a recovery code is a way back')

  harness.sqlite.prepare('DELETE FROM user_recovery_codes').run()
  await harness.db.insert(userMfaFactors).values({ userId: EDITOR.id, factorType: 'email_otp', state: 'active' })
  assert.equal((await status()).lockoutRisk, false, 'a usable e-mail code is a way back')

  harness.sqlite.prepare('UPDATE user_mfa_factors SET state = \'pending\' WHERE factor_type = \'email_otp\'').run()
  assert.equal((await status()).lockoutRisk, true, 'a pending e-mail factor is not a way back')
})

test('without a session the gate refuses', async () => {
  assert.equal((await server.request('GET', '/api/admin/profile/mfa')).status, 401)
})
