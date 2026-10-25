import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The Google Drive link of the backup (server/services/backup-drive-oauth.ts): the
 * refresh token every OAuth backup upload signs in with — whoever holds it reads and
 * writes the off-site copies of the whole database. Invariants:
 *   - linking and unlinking are SuperAdmin-only: an officer holding every
 *     `settings` flag cannot start the flow, cannot complete a callback, cannot
 *     disconnect — nothing is exchanged with Google and nothing is stored;
 *   - the authorize URL carries the client id and a state bound to an httpOnly
 *     cookie, never the client secret;
 *   - a callback stores nothing unless its state matches the cookie, the id_token
 *     was minted for OUR client (`aud`), and Google returned a refresh token;
 *   - the refresh token is stored encrypted; the status projection shows who is
 *     linked and nothing secret; the plaintext leaves only through
 *     `getUsableDriveLink`; a rotated key reads as `secret_unreadable`, not "not
 *     linked";
 *   - link + audit, and unlink + audit, commit together: a failed audit leaves the
 *     previous state, never a token nobody recorded;
 *   - re-linking replaces the token and the identity together (one row), and stamps
 *     who linked and when anew: the page never shows the new account with the old
 *     account's link time.
 *
 * Real h3 app: the real `admin-auth` middleware (SuperAdmin from the role row) in
 * front of the real `start`, `callback`, `status` and `disconnect` handlers, real
 * state signing, real AES-GCM envelope. Drizzle's SQL runs on SQLite
 * (`_sqlite-mysql-db.ts`, real transaction — `storeDriveLink`'s
 * `ON DUPLICATE KEY UPDATE` included). Only Google's token endpoint (`$fetch`) is
 * replaced.
 */

process.env.JWT_SECRET = 'backup-drive-link-behavior-secret-0123456789abcdef'
delete process.env.MFA_ENFORCEMENT
delete process.env.PUBLIC_BASE_URL
const KEY = randomBytes(32).toString('base64')
const ROTATED_KEY = randomBytes(32).toString('base64')

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs, backupDriveOauthConfig, backupDriveOauth } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs, backupDriveOauthConfig, backupDriveOauth])

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

/** Google's token endpoint. Each call is recorded; the answer is set per test. */
const exchanges: Array<{ url: string, body: URLSearchParams }> = []
let tokenResponse: Record<string, unknown> = {}
const globals = globalThis as unknown as Record<string, unknown>
globals.$fetch = async (url: string, options: { body: string }) => {
  exchanges.push({ url, body: new URLSearchParams(options.body) })
  return tokenResponse
}

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const h3 = await import('h3')
globals.sendRedirect = h3.sendRedirect
const adminAuth = (await import('../server/middleware/admin-auth')).default
const start = (await import('../server/api/admin/backup/drive/start.get')).default
const callback = (await import('../server/api/admin/backup/drive/callback.get')).default
const status = (await import('../server/api/admin/backup/drive/status.get')).default
const disconnect = (await import('../server/api/admin/backup/drive/disconnect.post')).default
const link = await import('../server/services/backup-drive-oauth')
const config = await import('../server/services/backup-drive-oauth-config')
const { GOOGLE_TOKEN_ENDPOINT } = await import('../server/utils/google-oauth/config')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/backup/drive/start', handler: start },
  { method: 'get', path: '/api/admin/backup/drive/callback', handler: callback },
  { method: 'get', path: '/api/admin/backup/drive/status', handler: status },
  { method: 'post', path: '/api/admin/backup/drive/disconnect', handler: disconnect },
], [adminAuth])
after(() => server.close())

const CLIENT_ID = '210987654321-drivebackupclient.apps.googleusercontent.com'
const CLIENT_SECRET = 'GOCSPX-drive-backup-secret-K4w2'
const REFRESH_TOKEN = '1//0g-refresh-token-for-the-backup-account-AbC123'
const OTHER_REFRESH_TOKEN = '1//0g-refresh-token-of-a-second-account-XyZ789'
type Account = { id: number, username: string, roleId: number, roleName: string }
const SUPERADMIN: Account = { id: 1, username: 'admin', roleId: 1, roleName: 'Quản trị hệ thống' }
const SECOND_SUPERADMIN: Account = { id: 2, username: 'admin2', roleId: 1, roleName: 'Quản trị hệ thống' }
const OFFICER: Account = { id: 5, username: 'officer', roleId: 3, roleName: 'Cấu hình toàn quyền' }
const VIEWER: Account = { id: 6, username: 'viewer', roleId: 4, roleName: 'Chỉ xem cấu hình' }

const sessionCookie = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: 'https://accounts.google.com', ...claims })}.signature`
}
/** `refreshToken: null` = Google answered without one. */
const googleAnswers = (claims: Record<string, unknown> = {}, refreshToken: string | null = REFRESH_TOKEN) => {
  tokenResponse = {
    id_token: idToken({ aud: CLIENT_ID, sub: '110000000000000000001', email: 'backup-owner@example.vn', ...claims }),
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  }
}

/** `start` as SuperAdmin: the state Google will echo, and the cookie bound to it. */
async function beginLink(account = SUPERADMIN) {
  const response = await server.request('GET', '/api/admin/backup/drive/start', { cookie: sessionCookie(account), redirect: 'manual' })
  const state = response.cookies.get('cdkt_drive_oauth_state')
  return { response, location: response.headers.get('location') ?? '', state: state?.value ?? null, rawCookie: state?.raw ?? '' }
}
async function completeLink(options: { account?: Account, state?: string | null, cookieState?: string | null, query?: string } = {}) {
  const begun = options.state === undefined || options.cookieState === undefined ? await beginLink() : null
  const state = options.state === undefined ? begun!.state : options.state
  const cookieState = options.cookieState === undefined ? begun!.state : options.cookieState
  const cookie = [sessionCookie(options.account ?? SUPERADMIN), cookieState ? `cdkt_drive_oauth_state=${encodeURIComponent(cookieState)}` : ''].filter(Boolean).join('; ')
  const query = options.query ?? `code=auth-code-1${state ? `&state=${encodeURIComponent(state)}` : ''}`
  const response = await server.request('GET', `/api/admin/backup/drive/callback?${query}`, { cookie, redirect: 'manual' })
  return { status: response.status, location: response.headers.get('location') ?? '', body: response.body }
}
const readStatus = (account = VIEWER) => server.request('GET', '/api/admin/backup/drive/status', { cookie: sessionCookie(account) })
const unlink = (account = SUPERADMIN) => server.request('POST', '/api/admin/backup/drive/disconnect', { cookie: sessionCookie(account) })

const linkRows = () => harness.rows(backupDriveOauth)
const rawLinkTable = () => JSON.stringify(harness.sqlite.prepare('SELECT * FROM backup_drive_oauth').all())
const rawAudit = () => JSON.stringify(harness.sqlite.prepare('SELECT * FROM activity_logs').all())
const linkAudits = () => harness.rows(activityLogs).filter(row => row.resource === 'backup_drive_oauth' && row.userId === SUPERADMIN.id && (row.meta as Record<string, unknown> | null)?.changedFields === undefined)
const ENVELOPE_KEYS = ['refreshTokenCiphertext', 'refreshTokenNonce', 'refreshTokenAuthTag', 'refreshTokenVersion', 'refreshTokenKeyId'] as const

beforeEach(async () => {
  harness.reset()
  exchanges.length = 0
  tokenResponse = {}
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
  await harness.db.insert(users).values([SUPERADMIN, SECOND_SUPERADMIN, OFFICER, VIEWER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await config.updateDriveOauthConfig(SUPERADMIN.id, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, isEnabled: true })
})

test('linking is SuperAdmin-only end to end: an officer with every settings flag can neither start nor complete it', async () => {
  // The officer's session is good: the 403s below are the SuperAdmin check.
  assert.equal((await readStatus(OFFICER)).status, 200)

  const started = await beginLink(OFFICER)
  assert.equal(started.response.status, 403)
  assert.equal(started.state, null, 'a refused start still issued a state cookie')

  googleAnswers()
  const { state } = await beginLink() // a genuine state, as if the officer had captured one
  const completed = await completeLink({ account: OFFICER, state, cookieState: state })
  assert.equal(completed.status, 403)
  assert.equal(exchanges.length, 0, 'the code was exchanged with Google for a refused caller')
  assert.deepEqual(linkRows(), [])
})

test('an officer cannot disconnect either: the link stays', async () => {
  googleAnswers()
  assert.match((await completeLink()).location, /drive_linked=1$/)
  const before = rawLinkTable()
  assert.equal((await unlink(OFFICER)).status, 403)
  assert.equal(rawLinkTable(), before)
})

test('start sends the client id to Google, never the secret, with a state bound to an httpOnly cookie', async () => {
  const { response, location, state, rawCookie } = await beginLink()
  assert.equal(response.status, 302)
  const url = new URL(location)
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID)
  assert.ok(!location.includes(CLIENT_SECRET), 'the client secret is in the authorize URL')
  assert.ok(state, 'no state cookie')
  assert.equal(url.searchParams.get('state'), state)
  assert.match(rawCookie, /HttpOnly/i)
  assert.match(rawCookie, /Path=\/api\/admin\/backup\/drive/)
})

test('start refuses before Google when the Drive client is not usable', async () => {
  await config.updateDriveOauthConfig(SUPERADMIN.id, { isEnabled: false })
  const { response, location, state } = await beginLink()
  assert.equal(response.status, 302)
  assert.equal(location, '/admin/settings/backup?drive_error=disabled')
  assert.equal(state, null)
})

test('a completed link stores the refresh token encrypted; status shows who, never the token', async () => {
  googleAnswers()
  const completed = await completeLink()
  assert.equal(completed.location, '/admin/settings/backup?drive_linked=1')

  // The exchange went to Google's fixed endpoint with the decrypted client secret.
  assert.equal(exchanges.length, 1)
  assert.equal(exchanges[0]!.url, GOOGLE_TOKEN_ENDPOINT)
  assert.equal(exchanges[0]!.body.get('client_id'), CLIENT_ID)
  assert.equal(exchanges[0]!.body.get('client_secret'), CLIENT_SECRET)
  assert.equal(exchanges[0]!.body.get('code'), 'auth-code-1')

  assert.equal(linkRows().length, 1)
  assert.ok(!rawLinkTable().includes(REFRESH_TOKEN), 'the refresh token is stored in plaintext')
  assert.ok(linkRows()[0]!.refreshTokenCiphertext)

  const response = await readStatus()
  assert.equal(response.status, 200)
  const projected = response.body.link as Record<string, unknown>
  assert.equal(projected.linked, true)
  assert.equal(projected.status, 'linked')
  assert.equal(projected.linkedEmail, 'backup-owner@example.vn')
  const wire = JSON.stringify(response.body)
  for (const material of [REFRESH_TOKEN, linkRows()[0]!.refreshTokenCiphertext, linkRows()[0]!.refreshTokenNonce, linkRows()[0]!.refreshTokenAuthTag]) {
    assert.ok(!wire.includes(String(material)), 'token material on the wire')
  }
  for (const key of ENVELOPE_KEYS) assert.ok(!(key in projected), `${key} in the projection`)

  assert.deepEqual(await link.getUsableDriveLink(), { ok: true, refreshToken: REFRESH_TOKEN })
})

test('a callback whose state does not match its cookie exchanges nothing and stores nothing', async () => {
  googleAnswers()
  const { state } = await beginLink()
  const { state: otherState } = await beginLink()
  for (const attempt of [
    { state, cookieState: otherState },
    { state, cookieState: null },
    { state: null, cookieState: state },
    { state: `${state}x`, cookieState: `${state}x` },
  ]) {
    const result = await completeLink(attempt)
    assert.equal(result.location, '/admin/settings/backup?drive_error=state_failed', JSON.stringify(attempt))
  }
  assert.equal(exchanges.length, 0)
  assert.deepEqual(linkRows(), [])
})

test('an id_token minted for another application is refused, and nothing is stored', async () => {
  googleAnswers({ aud: 'someone-elses-app.apps.googleusercontent.com' })
  assert.equal((await completeLink()).location, '/admin/settings/backup?drive_error=aud_mismatch')
  assert.deepEqual(linkRows(), [])
})

test('a token answer without a refresh token, or without a subject, stores nothing', async () => {
  googleAnswers({}, null)
  assert.equal((await completeLink()).location, '/admin/settings/backup?drive_error=exchange_failed')
  googleAnswers({ sub: undefined })
  assert.equal((await completeLink()).location, '/admin/settings/backup?drive_error=failed')
  assert.deepEqual(linkRows(), [])
})

test('link and audit commit together: if the audit cannot be written, no token is left behind', async () => {
  googleAnswers()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await completeLink()).location, '/admin/settings/backup?drive_error=store_failed')
  assert.deepEqual(linkRows(), [])
  assert.deepEqual(await link.getUsableDriveLink(), { ok: false, reason: 'not_linked' })
})

test('a re-link whose audit fails keeps the previous link exactly', async () => {
  googleAnswers()
  await completeLink()
  const before = rawLinkTable()
  googleAnswers({ sub: '110000000000000000002', email: 'second@example.vn' }, OTHER_REFRESH_TOKEN)
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await completeLink()).location, '/admin/settings/backup?drive_error=store_failed')
  assert.equal(rawLinkTable(), before)
})

test('the audit row names the linked account and the actor, never the token', async () => {
  googleAnswers()
  await completeLink()
  const audits = linkAudits()
  assert.equal(audits.length, 1)
  assert.equal(audits[0]!.action, 'update')
  assert.deepEqual(audits[0]!.meta, { linkedEmail: 'backup-owner@example.vn', linkedSub: '110000000000000000001' })
  assert.ok(!rawAudit().includes(REFRESH_TOKEN))
  assert.ok(!rawAudit().includes(String(linkRows()[0]!.refreshTokenCiphertext)))
  assert.equal(linkRows()[0]!.updatedBy, SUPERADMIN.id)
})

test('re-linking replaces the token and the identity together, in the one row', async () => {
  googleAnswers()
  await completeLink()
  const firstCiphertext = String(linkRows()[0]!.refreshTokenCiphertext)
  googleAnswers({ sub: '110000000000000000002', email: 'second@example.vn' }, OTHER_REFRESH_TOKEN)
  assert.match((await completeLink()).location, /drive_linked=1$/)

  assert.equal(linkRows().length, 1)
  assert.equal(linkRows()[0]!.linkedEmail, 'second@example.vn')
  assert.equal(linkRows()[0]!.linkedSub, '110000000000000000002')
  assert.ok(!rawLinkTable().includes(firstCiphertext), 'the first account\'s token envelope survived the re-link')
  assert.deepEqual(await link.getUsableDriveLink(), { ok: true, refreshToken: OTHER_REFRESH_TOKEN })
})

test('a re-link stamps who linked, which account and when anew — nothing of the first link is left on the row', async () => {
  googleAnswers()
  await completeLink()
  // The first account was linked long ago, by the first SuperAdmin.
  harness.sqlite.prepare('UPDATE backup_drive_oauth SET linked_at = ?').run('2026-01-01 00:00:00')
  const first = linkRows()[0]!

  googleAnswers({ sub: '110000000000000000002', email: 'second@example.vn' }, OTHER_REFRESH_TOKEN)
  const { state } = await beginLink(SECOND_SUPERADMIN)
  assert.match((await completeLink({ account: SECOND_SUPERADMIN, state, cookieState: state })).location, /drive_linked=1$/)

  const second = linkRows()[0]!
  assert.equal(second.linkedEmail, 'second@example.vn')
  assert.equal(second.linkedSub, '110000000000000000002')
  assert.equal(second.updatedBy, SECOND_SUPERADMIN.id, 'the row still names the first SuperAdmin as the one who linked')
  for (const key of ['refreshTokenCiphertext', 'refreshTokenNonce', 'refreshTokenAuthTag'] as const) {
    assert.notEqual(second[key], first[key], `${key} of the first link survived`)
  }
  // What the backup page shows next to the linked account.
  const projected = (await readStatus()).body.link as Record<string, unknown>
  assert.equal(projected.linkedEmail, 'second@example.vn')
  assert.ok(
    Math.abs(Date.parse(String(projected.linkedAt)) - Date.now()) < 120_000,
    `the second account is shown as linked since ${String(projected.linkedAt)} — the first account's link time`,
  )
})

test('a rotated key reads as secret_unreadable, not as "not linked"', async () => {
  googleAnswers()
  await completeLink()
  process.env.CHATBOT_ENCRYPTION_SECRET = ROTATED_KEY
  assert.deepEqual(await link.getUsableDriveLink(), { ok: false, reason: 'secret_unreadable' })
  const projected = (await readStatus()).body.link as Record<string, unknown>
  assert.equal(projected.status, 'secret_unreadable')
  assert.equal(projected.linked, false)
  assert.equal(projected.linkedEmail, 'backup-owner@example.vn', 'the officer is not told the link is gone')
})

test('disconnect drops the token and the metadata, audited against the actor', async () => {
  googleAnswers()
  await completeLink()
  assert.equal((await unlink()).status, 200)
  assert.deepEqual(linkRows(), [])
  assert.deepEqual(await link.getUsableDriveLink(), { ok: false, reason: 'not_linked' })
  const last = harness.rows(activityLogs).at(-1)!
  assert.equal(last.action, 'delete')
  assert.equal(last.resource, 'backup_drive_oauth')
  assert.equal(last.userId, SUPERADMIN.id)
  const projected = (await readStatus()).body.link as Record<string, unknown>
  assert.deepEqual(projected, { linked: false, linkedEmail: null, linkedSub: null, linkedAt: null, status: 'not_linked' })
})

test('disconnect is all-or-nothing: a failed audit keeps the link', async () => {
  googleAnswers()
  await completeLink()
  const before = rawLinkTable()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await unlink()).status, 500)
  assert.equal(rawLinkTable(), before)
  assert.deepEqual(await link.getUsableDriveLink(), { ok: true, refreshToken: REFRESH_TOKEN })
})
