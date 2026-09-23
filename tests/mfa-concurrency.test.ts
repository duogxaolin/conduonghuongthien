/** Exercise real factor functions and their Drizzle predicates against SQL.
 * SQLite supplies deterministic concurrent snapshots; MySQL integration remains
 * in mfa-email-code-integration.test.ts. Crypto is stubbed to pause verification.
 */
import assert from 'node:assert/strict'
import { beforeEach, mock, test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, getTableName, SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { userMfaFactors, userRecoveryCodes } from '../server/db/schema'

const sqlite = new DatabaseSync(':memory:')
const dialect = new MySqlDialect()
for (const table of [userMfaFactors, userRecoveryCodes]) {
  const columns = Object.values(getTableColumns(table)).map(c => `\`${c.name}\``).join(', ')
  sqlite.exec(`CREATE TABLE ${getTableName(table)} (${columns})`)
}
let beforeVerify: () => Promise<void> = async () => {}
let beforeWrite: (() => void) | undefined
let forceZero = false
let decrypts = true
let sent = 0
let generated = 0
let beforeMail = () => {}
const date = (value: unknown) => value instanceof Date ? value.toISOString().replace('T', ' ').replace('Z', '') : value
function encode(column: any, value: unknown) { return value === null ? null : date(column.mapToDriverValue(value)) }
function selectRows(table: any, where: SQL, projection?: any) {
  const query = dialect.sqlToQuery(where)
  const rows = sqlite.prepare(`SELECT * FROM ${getTableName(table)} WHERE ${query.sql}`).all(...query.params as any[])
  if (projection?.total) return [{ total: rows.length }]
  return rows.map(row => Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]: any) => [
    key, row[column.name] === null ? null : column.mapFromDriverValue(row[column.name]),
  ])))
}
const db = {
  select(projection?: any) { return { from(table: any) { return { where(where: SQL) {
    // Snapshot immediately, before either concurrent verifier gets to update.
    const rows = selectRows(table, where, projection)
    return { limit: async () => rows, then: (resolve: any) => Promise.resolve(rows).then(resolve) }
  } } } } },
  update(table: any) { return { set(values: any) { return { async where(where: SQL) {
    beforeWrite?.()
    if (forceZero) return [{ affectedRows: 0 }, []]
    const columns = getTableColumns(table)
    const params: any[] = []
    const assignments = Object.entries(values).map(([key, value]) => {
      if (value instanceof SQL) {
        const q = dialect.sqlToQuery(value)
        params.push(...q.params)
        return `\`${columns[key].name}\` = ${q.sql}`
      }
      params.push(encode(columns[key], value))
      return `\`${columns[key].name}\` = ?`
    })
    const q = dialect.sqlToQuery(where)
    const result = sqlite.prepare(`UPDATE ${getTableName(table)} SET ${assignments.join(', ')} WHERE ${q.sql}`)
      .run(...params, ...q.params as any[])
    return [{ affectedRows: Number(result.changes) }, []]
  } } } } },
}
mock.module('../server/utils/db', { namedExports: { getDb: () => db } })
mock.module('../server/utils/auth', { namedExports: { verifyPassword: async () => true, hashPassword: async () => 'password-hash' } })
mock.module('../server/utils/mfa/reauth', { namedExports: { requireCurrentPassword: async () => ({ username: 'admin' }) } })
mock.module('../server/utils/logger', { namedExports: { logError: () => {}, logInfo: () => {}, SECURITY_EVENTS: {} } })
mock.module('../server/utils/mfa/session', { namedExports: { setSessionCookie: () => { throw new Error('unexpected session issuance') } } })
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '127.0.0.1' } })
mock.module('../server/utils/mfa/crypto', { namedExports: {
  unsealTotpSecret: () => decrypts ? { ok: true, secret: 'secret' } : { ok: false, reason: 'key-mismatch' },
  sealTotpSecret: () => ({ ciphertext: 'new-sealed', nonce: 'nonce', authTag: 'tag', version: 1, keyId: 'key' }),
} })
mock.module('../server/utils/mfa/totp', { namedExports: {
  verifyTotp: (_secret: string, submitted: string) => ({ ok: true, step: Number(submitted) }),
  generateTotpSecret: () => 'secret', otpauthUri: () => 'otpauth://test',
} })
mock.module('../server/utils/mfa/codes', { namedExports: {
  EMAIL_CODE_MAX_ATTEMPTS: 5,
  EMAIL_CODE_TTL_MS: 600000,
  ENROLLMENT_TTL_MS: 900000,
  isExpired: (expires: Date | null) => !expires || expires.getTime() <= Date.now(),
  normalizeRecoveryCode: (code: string) => code.replace(/-/g, '').toUpperCase(),
  verifyOneTimeCode: async (code: string, hash: string) => { await beforeVerify(); return hash === `hash:${code}` },
  generateEmailCode: () => String(++generated),
  hashOneTimeCode: async (code: string) => { await beforeVerify(); return `hash:${code}` },
} })
mock.module('../server/utils/mailer', { namedExports: { sendMail: async () => { beforeMail(); sent++ }, isConfigured: async () => true } })
const { attemptTotp, attemptEmailCode, attemptRecoveryCode, factorAvailability } = await import('../server/utils/mfa/factors')
const { issueEmailCode } = await import('../server/utils/mfa/email-code')
Object.assign(globalThis, {
  defineEventHandler: (handler: unknown) => handler,
  readBody: async (event: any) => event.body,
  createError: (options: any) => Object.assign(new Error(options.statusMessage), options),
})
const confirmEnrollment = (await import('../server/api/admin/profile/mfa/confirm.post')).default as any
const startEnrollment = (await import('../server/api/admin/profile/mfa/enroll.post')).default as any

function plant(type = 'email_otp', overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    id: 1, userId: 10, factorType: type, state: 'active', secretCiphertext: 'sealed',
    pendingCodeHash: 'hash:123456', pendingCodeExpiresAt: new Date(Date.now() + 600000),
    pendingCodeAttempts: 0, ...overrides,
  }
  const columns = getTableColumns(userMfaFactors) as any
  sqlite.prepare(`INSERT INTO user_mfa_factors (${Object.keys(values).map(k => columns[k].name).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`)
    .run(...Object.entries(values).map(([k, v]) => encode(columns[k], v)) as any[])
}
function snapshot() { return sqlite.prepare('SELECT * FROM user_mfa_factors').get()! }
function rendezvous(parties = 2) {
  let arrivals = 0
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  return async () => { if (++arrivals === parties) release(); await waiting }
}
beforeEach(() => {
  sqlite.exec('DELETE FROM user_mfa_factors; DELETE FROM user_recovery_codes')
  beforeVerify = async () => {}
  beforeWrite = undefined
  forceZero = false
  decrypts = true
  sent = 0
  generated = 0
  beforeMail = () => {}
})

test('unreadable TOTP remains active, while usable alternatives remain available', async () => {
  plant('totp')
  decrypts = false
  assert.deepEqual(await factorAvailability(10), { active: true, usable: [] })
  plant('email_otp', { id: 2 })
  assert.deepEqual(await factorAvailability(10), { active: true, usable: ['email_otp'] })
  assert.deepEqual(await factorAvailability(99), { active: false, usable: [] })
})

test('two TOTP requests that read the same step cannot both spend it', async () => {
  plant('totp', { lastAcceptedStep: 99 })
  const results = await Promise.all([attemptTotp(10, '100'), attemptTotp(10, '100')])
  assert.equal(results.filter(r => r.ok).length, 1)
  assert.equal(snapshot().last_accepted_step, 100)
})

test('two email submissions on the same snapshot have exactly one winner', async () => {
  plant()
  beforeVerify = rendezvous()
  const results = await Promise.all([attemptEmailCode(10, '123456'), attemptEmailCode(10, '123456')])
  assert.equal(results.filter(r => r.ok).length, 1)
  assert.equal(snapshot().pending_code_hash, null)
})

test('two recovery submissions on the same snapshot have exactly one winner', async () => {
  sqlite.prepare('INSERT INTO user_recovery_codes (id,user_id,code_hash) VALUES (1,10,?)').run('hash:ABCDE23456')
  beforeVerify = rendezvous()
  const results = await Promise.all([attemptRecoveryCode(10, 'ABCDE-23456'), attemptRecoveryCode(10, 'ABCDE-23456')])
  assert.equal(results.filter(r => r.ok).length, 1)
})

test('zero affected rows never authenticates TOTP, email, or recovery', async () => {
  plant('totp')
  plant('email_otp', { id: 2 })
  sqlite.prepare('INSERT INTO user_recovery_codes (id,user_id,code_hash) VALUES (1,10,?)').run('hash:ABCDE23456')
  forceZero = true
  assert.equal((await attemptTotp(10, '100')).ok, false)
  assert.equal((await attemptEmailCode(10, '123456')).ok, false)
  assert.equal((await attemptRecoveryCode(10, 'ABCDE-23456')).ok, false)
})

test('stale success, wrong code, expired cleanup, and exhausted cleanup preserve a newer issuance', async () => {
  for (const scenario of ['success', 'wrong', 'expired', 'exhausted']) {
    sqlite.exec('DELETE FROM user_mfa_factors')
    plant('email_otp', scenario === 'expired' ? { pendingCodeExpiresAt: new Date(0) }
      : scenario === 'exhausted' ? { pendingCodeAttempts: 5 } : {})
    beforeWrite = () => {
      sqlite.prepare('UPDATE user_mfa_factors SET pending_code_hash = ?, pending_code_attempts = 0').run('hash:654321')
    }
    assert.equal((await attemptEmailCode(10, scenario === 'wrong' ? '000000' : '123456')).ok, false)
    assert.equal(snapshot().pending_code_hash, 'hash:654321', scenario)
    assert.equal(snapshot().pending_code_attempts, 0, scenario)
  }
})

test('concurrent misses are capped and a verification delayed past the ceiling fails', async () => {
  plant('email_otp', { pendingCodeAttempts: 4 })
  beforeVerify = rendezvous()
  await Promise.all([attemptEmailCode(10, '000000'), attemptEmailCode(10, '000000')])
  assert.equal(snapshot().pending_code_attempts, 5)
  sqlite.exec('UPDATE user_mfa_factors SET pending_code_attempts = 4')
  beforeVerify = async () => { sqlite.exec('UPDATE user_mfa_factors SET pending_code_attempts = 5') }
  assert.equal((await attemptEmailCode(10, '123456')).ok, false)
})

test('concurrent senders cannot overwrite the same generation and both report sent', async () => {
  plant()
  beforeVerify = rendezvous()
  const request = { factorId: 1, email: 'test@example.com', username: 'test', purpose: 'login' as const }
  const results = await Promise.all([issueEmailCode(request), issueEmailCode(request)])
  assert.equal(results.filter(r => r.ok).length, 1)
  assert.equal(sent, 1)
})

test('a removed factor cannot receive an email code', async () => {
  assert.deepEqual(await issueEmailCode({ factorId: 1, email: 'test@example.com', username: 'test', purpose: 'login' }), { ok: false, reason: 'no-factor' })
  assert.equal(sent, 0)
})

test('enrollment cannot activate a replaced, exhausted or concurrently activated email factor', async () => {
  for (const mutation of [
    "pending_code_hash = 'hash:654321'",
    'pending_code_attempts = 5',
    "state = 'active'",
  ]) {
    sqlite.exec('DELETE FROM user_mfa_factors')
    plant('email_otp', { state: 'pending', pendingExpiresAt: new Date(Date.now() + 600000) })
    beforeWrite = () => { sqlite.exec(`UPDATE user_mfa_factors SET ${mutation}`) }
    await assert.rejects(confirmEnrollment({
      context: { adminUser: { id: 10 } }, body: { factorType: 'email_otp', code: '123456' },
    }), { statusCode: 409 })
    assert.notEqual(snapshot().pending_code_hash, null, 'losing confirmation must not spend the code')
  }
})

test('a stale enrollment cannot downgrade a concurrently activated factor', async () => {
  plant('totp', { state: 'pending' })
  beforeWrite = () => { sqlite.exec("UPDATE user_mfa_factors SET state = 'active'") }
  await assert.rejects(startEnrollment({
    context: { adminUser: { id: 10 } }, body: { factorType: 'totp', currentPassword: 'password' },
  }), { statusCode: 409 })
  assert.equal(snapshot().state, 'active')
  assert.equal(snapshot().secret_ciphertext, 'sealed')
})

test('an SMTP failure after concurrent confirmation cannot delete the active email factor', async () => {
  plant('email_otp', { state: 'pending' })
  beforeMail = () => {
    sqlite.exec("UPDATE user_mfa_factors SET state = 'active'")
    throw new Error('SMTP connection dropped after delivery')
  }
  await assert.rejects(startEnrollment({
    context: { adminUser: { id: 10, email: 'test@example.com' } },
    body: { factorType: 'email_otp', currentPassword: 'password' },
  }), { statusCode: 503 })
  assert.equal(snapshot().state, 'active')
})
