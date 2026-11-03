import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * Google OAuth configuration for reader sign-in (server/services/google-oauth-settings.ts),
 * the only place that decrypts the client secret.
 *
 * Invariants pinned, end to end through the real settings endpoints (behind the real
 * `admin-auth` gate) and the service's own exports:
 *   - the secret is stored encrypted, never as plaintext, and nothing secret goes on
 *     the wire — not the plaintext, not the ciphertext/nonce/tag; only `••••<last 4>`;
 *   - the plaintext leaves only through `getUsableOAuthConfig`, and only when the
 *     switch is on; every other state fails closed with its own reason — a rotated
 *     key reads as `secret_unreadable`, never as "not configured";
 *   - a patch is validated in full before anything is written, and switching on
 *     without both credentials is refused;
 *   - every change writes an audit row that names fields and never quotes the secret,
 *     in the same transaction as the change: if the audit fails, nothing changed;
 *   - clearing drops the whole envelope, forces the switch off and keeps the client id.
 *
 * Drizzle's SQL runs on SQLite (`_sqlite-mysql-db.ts`, real transaction); the
 * envelope is the real AES-GCM codec under a random test key.
 */

process.env.JWT_SECRET = 'google-oauth-settings-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT
delete process.env.PUBLIC_BASE_URL
const KEY = randomBytes(32).toString('base64')
const ROTATED_KEY = randomBytes(32).toString('base64')

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs, googleOauthSettings } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs, googleOauthSettings])

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
const getSettings = (await import('../server/api/admin/settings/google-oauth/index.get')).default
const patchSettings = (await import('../server/api/admin/settings/google-oauth/index.patch')).default
const clearSecret = (await import('../server/api/admin/settings/google-oauth/clear-secret.post')).default
const service = await import('../server/services/google-oauth-settings')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/settings/google-oauth', handler: getSettings },
  { method: 'patch', path: '/api/admin/settings/google-oauth', handler: patchSettings },
  { method: 'post', path: '/api/admin/settings/google-oauth/clear-secret', handler: clearSecret },
], [adminAuth])
after(() => server.close())

const CLIENT_ID = '123456789012-abcdefghijklmnop.apps.googleusercontent.com'
const CLIENT_SECRET = 'GOCSPX-behaviour-test-secret-9Z7Q'
const OFFICER = { id: 5, username: 'officer', roleId: 3, roleName: 'Cấu hình' }
const READER_ONLY = { id: 6, username: 'viewer', roleId: 4, roleName: 'Chỉ xem cấu hình' }

const cookieFor = (account: typeof OFFICER) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const patch = (body: unknown, account = OFFICER) => server.request('PATCH', '/api/admin/settings/google-oauth', { cookie: cookieFor(account), body })
const readSettings = (account = OFFICER) => server.request('GET', '/api/admin/settings/google-oauth', { cookie: cookieFor(account) })
const clear = (account = OFFICER) => server.request('POST', '/api/admin/settings/google-oauth/clear-secret', { cookie: cookieFor(account) })

const row = () => harness.rows(googleOauthSettings)[0] ?? null
const rawRow = () => JSON.stringify(harness.sqlite.prepare('SELECT * FROM google_oauth_settings').all())
const rawAudit = () => JSON.stringify(harness.sqlite.prepare('SELECT * FROM activity_logs').all())
const auditRows = () => harness.rows(activityLogs)
const ENVELOPE_COLUMNS = ['clientSecretCiphertext', 'clientSecretNonce', 'clientSecretAuthTag', 'clientSecretVersion', 'clientSecretKeyId', 'clientSecretLastFour'] as const
const configSnapshot = () => {
  const current = row()
  return current ? { clientId: current.clientId, isEnabled: current.isEnabled, ...Object.fromEntries(ENVELOPE_COLUMNS.map(key => [key, current[key]])) } : null
}

/** Every string a response must never contain once a secret is stored. */
function secretMaterial(): string[] {
  const current = row()!
  return [CLIENT_SECRET, String(current.clientSecretCiphertext), String(current.clientSecretNonce), String(current.clientSecretAuthTag)]
}
function assertNoSecretOnTheWire(body: unknown, label: string) {
  const wire = JSON.stringify(body)
  for (const material of secretMaterial()) assert.ok(!wire.includes(material), `${label}: secret material on the wire`)
}

beforeEach(async () => {
  harness.reset()
  process.env.CHATBOT_ENCRYPTION_SECRET = KEY
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([
    { id: 3, name: OFFICER.roleName, isSystem: false },
    { id: 4, name: READER_ONLY.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: 3, resource: 'settings', canRead: true, canUpdate: true },
    { roleId: 4, resource: 'settings', canRead: true },
  ])
  await harness.db.insert(users).values([OFFICER, READER_ONLY].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
})

test('the secret is stored encrypted and never travels back: only the last four characters do', async () => {
  const saved = await patch({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  assert.equal(saved.status, 200)
  assert.ok(!rawRow().includes(CLIENT_SECRET), 'the plaintext secret is in the table')
  assert.ok(row()!.clientSecretCiphertext, 'no envelope was stored')

  const read = await readSettings()
  for (const [label, response] of [['PATCH', saved], ['GET', read]] as const) {
    assertNoSecretOnTheWire(response.body, label)
    const projected = response.body.settings as Record<string, unknown>
    assert.equal(projected.clientSecretMasked, '••••9Z7Q', label)
    assert.equal(projected.clientSecretStatus, 'configured', label)
    for (const key of ENVELOPE_COLUMNS) assert.ok(!(key in projected), `${label}: ${key} in the projection`)
  }
})

test('the plaintext leaves only through getUsableOAuthConfig, and only while the switch is on', async () => {
  await patch({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  assert.deepEqual(await service.getUsableOAuthConfig(), { ok: false, reason: 'disabled' })

  await patch({ isEnabled: true })
  const usable = await service.getUsableOAuthConfig()
  assert.equal(usable.ok, true)
  assert.equal(usable.ok && usable.clientSecret, CLIENT_SECRET)
  assert.equal(usable.ok && usable.clientId, CLIENT_ID)
})

test('a rotated encryption key fails closed as secret_unreadable — not as "not configured"', async () => {
  await patch({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  await patch({ isEnabled: true })
  process.env.CHATBOT_ENCRYPTION_SECRET = ROTATED_KEY

  assert.deepEqual(await service.getUsableOAuthConfig(), { ok: false, reason: 'secret_unreadable' })
  const projected = (await readSettings()).body.settings as Record<string, unknown>
  assert.equal(projected.clientSecretStatus, 'secret_unreadable')
  assert.equal(projected.hasClientSecret, false)
  assert.ok((projected.missing as string[]).includes('clientSecretUnreadable'))
  assert.ok(!(projected.missing as string[]).includes('clientSecret'), 'reported as never configured')
})

test('a patch is validated in full before anything is written', async () => {
  await patch({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  const before = configSnapshot()
  const auditBefore = auditRows().length
  const refused: unknown[] = [
    { clientId: 'a-new-good-id.apps.googleusercontent.com', clientSecret: 'has a space' },
    { clientId: 'a-new-good-id.apps.googleusercontent.com', clientSecret: '   ' },
    { clientId: 'a-new-good-id.apps.googleusercontent.com', clientSecret: 'x'.repeat(513) },
    { clientId: 'id with space', clientSecret: 'GOCSPX-another-secret-1111' },
    { clientId: 'a-new-good-id.apps.googleusercontent.com', isEnabled: 'yes' },
    { clientId: 'a-new-good-id.apps.googleusercontent.com', redirectUri: 'https://evil.example/cb' },
  ]
  for (const body of refused) {
    const status = (await patch(body)).status
    assert.deepEqual(configSnapshot(), before, `${JSON.stringify(body)} left a half-applied credential pair`)
    assert.equal(auditRows().length, auditBefore, `${JSON.stringify(body)} wrote an audit row`)
    assert.equal(status, 400, JSON.stringify(body))
  }
})

test('switching on without both credentials is refused and writes nothing', async () => {
  await readSettings() // creates the empty row
  assert.equal((await patch({ isEnabled: true })).status, 400)
  assert.equal((await patch({ clientId: CLIENT_ID, isEnabled: true })).status, 400)
  assert.equal(row()!.isEnabled, false)
  assert.equal(row()!.clientId, null)
  assert.equal(auditRows().length, 0)
})

test('every change is audited by field name; the secret value is never in the audit trail', async () => {
  await patch({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  const rows = auditRows()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.userId, OFFICER.id)
  assert.equal(rows[0]!.resource, 'google_oauth_settings')
  const meta = rows[0]!.meta as Record<string, unknown>
  assert.deepEqual(meta.changedFields, ['clientId', 'clientSecret'])
  assert.equal(meta.secretReplaced, true)
  assert.ok(!rawAudit().includes(CLIENT_SECRET), 'the secret is quoted in activity_logs')
  assert.ok(!rawAudit().includes(String(row()!.clientSecretCiphertext)), 'the ciphertext is quoted in activity_logs')
})

test('if the audit row cannot be written, the change does not happen', async () => {
  await patch({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  const before = configSnapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await patch({ clientSecret: 'GOCSPX-replacement-secret-0000', isEnabled: true })).status, 500)
  assert.deepEqual(configSnapshot(), before)
  assert.deepEqual(await service.getUsableOAuthConfig(), { ok: false, reason: 'disabled' })
})

test('clearing drops the whole envelope, forces the switch off, keeps the client id, and is audited', async () => {
  await patch({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  await patch({ isEnabled: true })
  const response = await clear()
  assert.equal(response.status, 200)
  const current = row()!
  for (const key of ENVELOPE_COLUMNS) assert.equal(current[key], null, key)
  assert.equal(current.isEnabled, false)
  assert.equal(current.clientId, CLIENT_ID)
  assert.deepEqual(await service.getUsableOAuthConfig(), { ok: false, reason: 'disabled' })
  const projected = response.body.settings as Record<string, unknown>
  assert.equal(projected.clientSecretStatus, 'not_configured')
  assert.equal(projected.clientSecretMasked, null)
  const last = auditRows().at(-1)!
  assert.equal((last.meta as Record<string, unknown>).secretCleared, true)
})

test('clearing is all-or-nothing too: a failed audit leaves the secret and the switch as they were', async () => {
  await patch({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  await patch({ isEnabled: true })
  const before = configSnapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await clear()).status, 500)
  assert.deepEqual(configSnapshot(), before)
})

test('reading needs settings.read, changing needs settings.update — a read-only role writes nothing', async () => {
  await patch({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  const before = configSnapshot()
  assert.equal((await readSettings(READER_ONLY)).status, 200)
  assert.equal((await patch({ clientId: 'other-id.apps.googleusercontent.com' }, READER_ONLY)).status, 403)
  assert.equal((await clear(READER_ONLY)).status, 403)
  assert.deepEqual(configSnapshot(), before)
  assert.equal((await server.request('GET', '/api/admin/settings/google-oauth')).status, 401)
})

test('the comments default falls back to closed when the settings cannot be read', async () => {
  await readSettings()
  harness.sqlite.prepare('UPDATE google_oauth_settings SET default_comments_enabled = 1').run()
  assert.equal(await service.defaultCommentsEnabled(), true)
  harness.failNext(/from `google_oauth_settings`/)
  assert.equal(await service.defaultCommentsEnabled(), false)
})
