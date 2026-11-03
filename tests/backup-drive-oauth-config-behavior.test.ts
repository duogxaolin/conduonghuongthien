import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The Drive OAuth client of the backup (server/services/backup-drive-oauth-config.ts):
 * the client id + client secret the Drive link and every OAuth backup upload sign
 * in with. It decides which Google application holds the keys to the off-site copy
 * of the whole database, so the invariants are:
 *   - only a SuperAdmin changes it — a role holding every `settings` flag gets 403
 *     on save and on clear, and nothing is written; `settings.read` may look;
 *   - the secret is stored encrypted, never as plaintext, and nothing secret goes on
 *     the wire — not the plaintext, not the ciphertext/nonce/tag; only `••••<last 4>`;
 *   - the plaintext leaves only through `getUsableDriveOauthConfig`, and only while
 *     the switch is on; a rotated key — or an envelope sealed for another feature
 *     (`backup-drive-oauth-crypto.ts`'s own context label) — reads as
 *     `secret_unreadable`, never as "not configured";
 *   - a save is validated in full before anything is written, and switching on
 *     without both credentials is refused;
 *   - every change writes an audit row naming fields, never quoting the secret, in
 *     the same transaction as the change: if the audit fails, nothing changed;
 *   - clearing drops the whole envelope, forces the switch off and keeps the id.
 *
 * Real h3 app: the real `admin-auth` middleware (which derives SuperAdmin from the
 * role row, never from the token) in front of the real `config.get`, `config.put`
 * and `clear-secret.post` handlers. Drizzle's SQL runs on SQLite
 * (`_sqlite-mysql-db.ts`, real transaction); the envelope is the real AES-GCM codec
 * under a random key generated per run.
 *
 * "Re-enter the secret when the target changes" (the SMTP/R2 rule,
 * `shared/settings-credential-rules.ts`) does not apply here: this secret is only
 * ever sent to Google's fixed token endpoint, never to a destination a request can
 * choose. Omitting `clientSecret` keeps the stored one, by design.
 */

process.env.JWT_SECRET = 'backup-drive-oauth-config-behavior-secret-0123456789'
delete process.env.MFA_ENFORCEMENT
delete process.env.PUBLIC_BASE_URL
const KEY = randomBytes(32).toString('base64')
const ROTATED_KEY = randomBytes(32).toString('base64')

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs, backupDriveOauthConfig } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs, backupDriveOauthConfig])

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
const getConfig = (await import('../server/api/admin/backup/drive/config.get')).default
const putConfig = (await import('../server/api/admin/backup/drive/config.put')).default
const clearSecret = (await import('../server/api/admin/backup/drive/clear-secret.post')).default
const service = await import('../server/services/backup-drive-oauth-config')
const { encryptGoogleOAuthSecret } = await import('../server/utils/google-oauth/crypto')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/backup/drive/config', handler: getConfig },
  { method: 'put', path: '/api/admin/backup/drive/config', handler: putConfig },
  { method: 'post', path: '/api/admin/backup/drive/clear-secret', handler: clearSecret },
], [adminAuth])
after(() => server.close())

const CLIENT_ID = '210987654321-drivebackupclient.apps.googleusercontent.com'
const CLIENT_SECRET = 'GOCSPX-drive-backup-secret-K4w2'
type Account = { id: number, username: string, roleId: number, roleName: string }
const SUPERADMIN: Account = { id: 1, username: 'admin', roleId: 1, roleName: 'Quản trị hệ thống' }
const OFFICER: Account = { id: 5, username: 'officer', roleId: 3, roleName: 'Cấu hình toàn quyền' }
const VIEWER: Account = { id: 6, username: 'viewer', roleId: 4, roleName: 'Chỉ xem cấu hình' }

const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const put = (body: unknown, account = SUPERADMIN) => server.request('PUT', '/api/admin/backup/drive/config', { cookie: cookieFor(account), body })
const read = (account = SUPERADMIN) => server.request('GET', '/api/admin/backup/drive/config', { cookie: cookieFor(account) })
const clear = (account = SUPERADMIN) => server.request('POST', '/api/admin/backup/drive/clear-secret', { cookie: cookieFor(account) })

const row = () => harness.rows(backupDriveOauthConfig)[0] ?? null
const rawRow = () => JSON.stringify(harness.sqlite.prepare('SELECT * FROM backup_drive_oauth_config').all())
const rawAudit = () => JSON.stringify(harness.sqlite.prepare('SELECT * FROM activity_logs').all())
const auditRows = () => harness.rows(activityLogs)
const ENVELOPE_COLUMNS = ['clientSecretCiphertext', 'clientSecretNonce', 'clientSecretAuthTag', 'clientSecretVersion', 'clientSecretKeyId', 'clientSecretLastFour'] as const
const configSnapshot = () => {
  const current = row()
  return current ? { clientId: current.clientId, isEnabled: current.isEnabled, ...Object.fromEntries(ENVELOPE_COLUMNS.map(key => [key, current[key]])) } : null
}

/** Every string a response must never contain once a secret is stored. */
function assertNoSecretOnTheWire(body: unknown, label: string) {
  const current = row()!
  const wire = JSON.stringify(body)
  for (const material of [CLIENT_SECRET, current.clientSecretCiphertext, current.clientSecretNonce, current.clientSecretAuthTag]) {
    assert.ok(material && !wire.includes(String(material)), `${label}: secret material on the wire`)
  }
}

beforeEach(async () => {
  harness.reset()
  process.env.CHATBOT_ENCRYPTION_SECRET = KEY
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([
    { id: 1, name: SUPERADMIN.roleName, isSystem: true },
    { id: 3, name: OFFICER.roleName, isSystem: false },
    { id: 4, name: VIEWER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: 3, resource: 'settings', canCreate: true, canRead: true, canUpdate: true, canDelete: true, canPublish: true, canArchive: true, canTest: true },
    { roleId: 4, resource: 'settings', canRead: true },
  ])
  await harness.db.insert(users).values([SUPERADMIN, OFFICER, VIEWER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
})

test('only a SuperAdmin changes the Drive client: every settings flag is not enough, and nothing is written', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  const before = configSnapshot()
  const auditBefore = auditRows().length
  // The officer's session is good (not stopped by the gate or the MFA policy): the
  // 403s below are the SuperAdmin check, nothing else.
  assert.equal((await read(OFFICER)).status, 200)

  assert.equal((await put({ clientId: 'attacker-app.apps.googleusercontent.com', clientSecret: 'GOCSPX-attacker-secret-0000' }, OFFICER)).status, 403)
  assert.equal((await put({ isEnabled: true }, OFFICER)).status, 403)
  assert.equal((await clear(OFFICER)).status, 403)
  assert.equal((await put({ clientSecret: 'GOCSPX-viewer-secret-1111' }, VIEWER)).status, 403)
  assert.equal((await server.request('PUT', '/api/admin/backup/drive/config', { body: { clientId: 'x' } })).status, 401)

  assert.deepEqual(configSnapshot(), before)
  assert.equal(auditRows().length, auditBefore)
})

test('reading needs settings.read only, and shows the masked secret — never the material', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  const response = await read(VIEWER)
  assert.equal(response.status, 200)
  assertNoSecretOnTheWire(response.body, 'GET as viewer')
  const projected = response.body.config as Record<string, unknown>
  assert.equal(projected.clientSecretMasked, '••••K4w2')
  assert.equal(projected.clientId, CLIENT_ID)
})

test('the secret is stored encrypted and never travels back: only the last four characters do', async () => {
  const saved = await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  assert.equal(saved.status, 200)
  assert.ok(!rawRow().includes(CLIENT_SECRET), 'the plaintext secret is in the table')
  assert.ok(row()!.clientSecretCiphertext, 'no envelope was stored')

  const cleared = await read()
  for (const [label, response] of [['PUT', saved], ['GET', cleared]] as const) {
    assertNoSecretOnTheWire(response.body, label)
    const projected = response.body.config as Record<string, unknown>
    assert.equal(projected.clientSecretStatus, 'configured', label)
    assert.equal(projected.hasClientSecret, true, label)
    for (const key of ENVELOPE_COLUMNS) assert.ok(!(key in projected), `${label}: ${key} in the projection`)
    assert.ok(!('clientSecret' in projected), `${label}: clientSecret in the projection`)
  }
})

test('the plaintext leaves only through getUsableDriveOauthConfig, and only while the switch is on', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  assert.deepEqual(await service.getUsableDriveOauthConfig(), { ok: false, reason: 'disabled' })

  assert.equal((await put({ isEnabled: true })).status, 200)
  assert.deepEqual(await service.getUsableDriveOauthConfig(), { ok: true, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
})

test('a rotated encryption key fails closed as secret_unreadable — not as "not configured"', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, isEnabled: true })
  process.env.CHATBOT_ENCRYPTION_SECRET = ROTATED_KEY

  assert.deepEqual(await service.getUsableDriveOauthConfig(), { ok: false, reason: 'secret_unreadable' })
  const projected = (await read()).body.config as Record<string, unknown>
  assert.equal(projected.clientSecretStatus, 'secret_unreadable')
  assert.equal(projected.hasClientSecret, false)
  assert.ok((projected.missing as string[]).includes('clientSecretUnreadable'))
  assert.ok(!(projected.missing as string[]).includes('clientSecret'), 'reported as never configured')
})

test('an envelope sealed for another feature does not open here: the context label keeps them apart', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, isEnabled: true })
  // Same key, same AES-GCM primitive — only the label differs (the reader sign-in's).
  const foreign = encryptGoogleOAuthSecret('GOCSPX-reader-signin-secret-7777')
  harness.sqlite.prepare(`UPDATE backup_drive_oauth_config SET client_secret_ciphertext = ?, client_secret_nonce = ?,
    client_secret_auth_tag = ?, client_secret_version = ?, client_secret_key_id = ?`)
    .run(foreign.ciphertext, foreign.nonce, foreign.authTag, foreign.version, foreign.keyId)

  assert.deepEqual(await service.getUsableDriveOauthConfig(), { ok: false, reason: 'secret_unreadable' })
  assert.equal(((await read()).body.config as Record<string, unknown>).clientSecretStatus, 'secret_unreadable')
})

test('a save is validated in full before anything is written', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  const before = configSnapshot()
  const auditBefore = auditRows().length
  const refused: unknown[] = [
    { clientId: 'a-new-good-id.apps.googleusercontent.com', clientSecret: 'has a space' },
    { clientId: 'a-new-good-id.apps.googleusercontent.com', clientSecret: '   ' },
    { clientId: 'a-new-good-id.apps.googleusercontent.com', clientSecret: 'x'.repeat(513) },
    { clientId: 'a-new-good-id.apps.googleusercontent.com', clientSecret: 42 },
    { clientId: 'id with space', clientSecret: 'GOCSPX-another-secret-1111' },
    { clientId: 'x'.repeat(256), clientSecret: 'GOCSPX-another-secret-1111' },
    { clientId: 'a-new-good-id.apps.googleusercontent.com', isEnabled: 'yes' },
    { clientId: 'a-new-good-id.apps.googleusercontent.com', redirectUri: 'https://evil.example/cb' },
    { clientId: 'a-new-good-id.apps.googleusercontent.com', clientSecretCiphertext: 'forged' },
    ['clientId'],
  ]
  for (const body of refused) {
    const status = (await put(body)).status
    assert.deepEqual(configSnapshot(), before, `${JSON.stringify(body)} left a half-applied credential pair`)
    assert.equal(auditRows().length, auditBefore, `${JSON.stringify(body)} wrote an audit row`)
    assert.equal(status, 400, JSON.stringify(body))
  }
})

test('switching on without both credentials is refused and writes nothing', async () => {
  await read() // creates the empty row
  assert.equal((await put({ isEnabled: true })).status, 400)
  assert.equal((await put({ clientId: CLIENT_ID, isEnabled: true })).status, 400)
  assert.equal((await put({ clientSecret: CLIENT_SECRET, isEnabled: true })).status, 400)
  assert.equal(row()!.isEnabled, false)
  assert.equal(row()!.clientId, null)
  assert.equal(row()!.clientSecretCiphertext, null)
  assert.equal(auditRows().length, 0)
})

test('a save without clientSecret keeps the stored envelope byte for byte', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  const envelope = Object.fromEntries(ENVELOPE_COLUMNS.map(key => [key, row()![key]]))
  assert.equal((await put({ isEnabled: true })).status, 200)
  assert.deepEqual(Object.fromEntries(ENVELOPE_COLUMNS.map(key => [key, row()![key]])), envelope)
})

test('every change is audited against the actor by field name; the secret is never in the audit trail', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  const rows = auditRows()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.userId, SUPERADMIN.id)
  assert.equal(rows[0]!.resource, 'backup_drive_oauth')
  const meta = rows[0]!.meta as Record<string, unknown>
  assert.deepEqual(meta.changedFields, ['clientId', 'clientSecret'])
  assert.equal(meta.secretReplaced, true)
  assert.ok(!rawAudit().includes(CLIENT_SECRET), 'the secret is quoted in activity_logs')
  assert.ok(!rawAudit().includes(String(row()!.clientSecretCiphertext)), 'the ciphertext is quoted in activity_logs')
  assert.equal(row()!.updatedBy, SUPERADMIN.id)
})

test('if the audit row cannot be written, the change does not happen', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
  const before = configSnapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await put({ clientSecret: 'GOCSPX-replacement-secret-0000', isEnabled: true })).status, 500)
  assert.deepEqual(configSnapshot(), before)
  assert.deepEqual(await service.getUsableDriveOauthConfig(), { ok: false, reason: 'disabled' })
})

test('clearing drops the whole envelope, forces the switch off, keeps the client id, and is audited', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, isEnabled: true })
  const response = await clear()
  assert.equal(response.status, 200)
  const current = row()!
  for (const key of ENVELOPE_COLUMNS) assert.equal(current[key], null, key)
  assert.equal(current.isEnabled, false)
  assert.equal(current.clientId, CLIENT_ID)
  assert.deepEqual(await service.getUsableDriveOauthConfig(), { ok: false, reason: 'disabled' })
  const projected = response.body.config as Record<string, unknown>
  assert.equal(projected.clientSecretStatus, 'not_configured')
  assert.equal(projected.clientSecretMasked, null)
  const last = auditRows().at(-1)!
  assert.equal(last.userId, SUPERADMIN.id)
  assert.equal((last.meta as Record<string, unknown>).secretCleared, true)
})

test('clearing is all-or-nothing too: a failed audit leaves the secret and the switch as they were', async () => {
  await put({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, isEnabled: true })
  const before = configSnapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await clear()).status, 500)
  assert.deepEqual(configSnapshot(), before)
  assert.equal((await service.getUsableDriveOauthConfig()).ok, true)
})
