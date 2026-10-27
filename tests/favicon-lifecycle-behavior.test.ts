import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, beforeEach, mock } from 'node:test'
import sharp from 'sharp'

/**
 * The site favicon, end to end: `POST /api/admin/settings/favicon` (generate the
 * set from an uploaded image), `DELETE /api/admin/settings/favicon` (back to the
 * default) and `GET /favicon.ico` (server/routes/favicon.ico.ts, which serves a
 * file from disk chosen by a database setting).
 *
 * The invariants:
 *   - setting or resetting it takes `settings.update`; without it nothing is
 *     written to disk or to `settings`;
 *   - the upload is judged by its magic bytes — SVG/HTML are 415, nothing written;
 *     over 20 MB is 413;
 *   - a raster upload GENERATES the set (32 px PNG, 180 px PNG, ICO wrapping the
 *     32 px PNG) — a JPEG comes out as PNG and says so; an ICO is stored as given;
 *   - both setting keys and the audit line commit together: if the audit fails,
 *     the old icon is still the configured one;
 *   - `/favicon.ico` follows the change at once (the setting cache is cleared after
 *     commit), serves only `.ico` files from inside `public/`, with `nosniff`, and
 *     falls back to the default when the setting is missing, unsafe, not an ICO,
 *     points at a deleted file, or the database is down.
 *
 * Real h3 app with the real `admin-auth` middleware, real sharp, real files under
 * a temporary working directory; Drizzle's SQL on SQLite (`_sqlite-mysql-db.ts`,
 * real transaction).
 */

process.env.JWT_SECRET = 'favicon-lifecycle-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'cdkt-favicon-')))
const originalCwd = process.cwd()
process.chdir(workdir)

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

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const setFavicon = (await import('../server/api/admin/settings/favicon.post')).default
const resetFavicon = (await import('../server/api/admin/settings/favicon.delete')).default
const faviconRoute = (await import('../server/routes/favicon.ico')).default
const { clearFaviconSettingCache } = await import('../server/utils/favicon-setting')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'post', path: '/api/admin/settings/favicon', handler: setFavicon },
  { method: 'delete', path: '/api/admin/settings/favicon', handler: resetFavicon },
  { method: 'get', path: '/favicon.ico', handler: faviconRoute },
], [adminAuth])
after(async () => {
  await server.close()
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
})

type Account = { id: number, username: string, roleId: number, roleName: string }
const EDITOR: Account = { id: 4, username: 'giaodien', roleId: 3, roleName: 'Cấu hình giao diện' }
const READER: Account = { id: 5, username: 'xemcauhinh', roleId: 4, roleName: 'Xem cấu hình' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`

function upload(bytes: Buffer, type: string, name: string, account = EDITOR) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type }), name)
  return server.request('POST', '/api/admin/settings/favicon', { cookie: cookieFor(account), body: form })
}
const reset = (account = EDITOR) => server.request('DELETE', '/api/admin/settings/favicon', { cookie: cookieFor(account) })

/** GET /favicon.ico, body as bytes. */
async function favicon(): Promise<{ status: number, type: string | null, nosniff: string | null, bytes: Buffer }> {
  const { hostname, port } = new URL(server.origin)
  const response = await fetch(`http://${hostname}:${port}/favicon.ico`)
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    nosniff: response.headers.get('x-content-type-options'),
    bytes: Buffer.from(await response.arrayBuffer()),
  }
}

const faviconDir = join(workdir, 'public', 'uploads', 'favicon')
const generated = () => { try { return readdirSync(faviconDir).sort() } catch { return [] } }
const settingsMap = () => Object.fromEntries(harness.rows(settings).map(row => [row.key, row.value]))
const snapshot = () => ({ files: generated(), settings: settingsMap(), audit: harness.rows(activityLogs).length })
const publicFile = (url: unknown) => readFileSync(join(workdir, 'public', String(url)))

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 74, g: 103, b: 65, alpha: 1 } } })
const PNG = await solid(200, 120).png().toBuffer()
const JPEG = await solid(64, 64).jpeg().toBuffer()
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ICO_HEADER = Buffer.from([0x00, 0x00, 0x01, 0x00])
const UPLOADED_ICO = Buffer.concat([ICO_HEADER, Buffer.from([0x01, 0x00]), Buffer.from('uploaded-ico-entry-and-image-bytes')])
const DEFAULT_ICO = Buffer.concat([ICO_HEADER, Buffer.from('default-portal-icon')])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>')

beforeEach(async () => {
  harness.reset()
  clearFaviconSettingCache()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  rmSync(join(workdir, 'public'), { recursive: true, force: true })
  mkdirSync(join(workdir, 'public'), { recursive: true })
  writeFileSync(join(workdir, 'public', 'favicon-default.ico'), DEFAULT_ICO)
  writeFileSync(join(workdir, '.env'), 'JWT_SECRET=not-a-real-secret')
  await harness.db.insert(roles).values([
    { id: EDITOR.roleId, name: EDITOR.roleName, isSystem: false },
    { id: READER.roleId, name: READER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: EDITOR.roleId, resource: 'settings', canRead: true, canUpdate: true },
    { roleId: READER.roleId, resource: 'settings', canRead: true, canCreate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([EDITOR, READER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(settings).values([
    { key: 'favicon_url', value: '/favicon-32.png', group: 'general' },
    { key: 'site_name', value: 'Con Đường Hướng Thiện', group: 'general' },
  ])
})

test('without settings.update nothing is written: no session → 401, read/create/delete only → 403', async () => {
  const before = snapshot()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'logo.png')
  assert.equal((await server.request('POST', '/api/admin/settings/favicon', { body: form })).status, 401)
  assert.equal((await upload(PNG, 'image/png', 'logo.png', READER)).status, 403)
  assert.equal((await reset(READER)).status, 403)
  assert.deepEqual(snapshot(), before)
})

test('a PNG generates the set — 32 px and 180 px square PNGs and an ICO of the 32 px one — and /favicon.ico serves it at once', async () => {
  // Prime the setting cache with the old configuration first.
  assert.deepEqual((await favicon()).bytes, DEFAULT_ICO)

  const response = await upload(PNG, 'image/png', 'logo-c11.png')
  assert.equal(response.status, 200)
  const { faviconUrl, icoUrl, convertedToPng, sourceBytes } = response.body
  assert.match(String(faviconUrl), /^\/uploads\/favicon\/favicon-\d+-32\.png$/)
  assert.match(String(icoUrl), /^\/uploads\/favicon\/favicon-\d+\.ico$/)
  assert.equal(convertedToPng, false)
  assert.equal(sourceBytes, PNG.length)

  const stamp = /favicon-(\d+)-32/.exec(String(faviconUrl))![1]
  assert.deepEqual(generated(), [`favicon-${stamp}-180.png`, `favicon-${stamp}-32.png`, `favicon-${stamp}.ico`])
  const png32 = publicFile(faviconUrl)
  assert.deepEqual(await sharp(png32).metadata().then(meta => [meta.format, meta.width, meta.height]), ['png', 32, 32])
  const png180 = readFileSync(join(faviconDir, `favicon-${stamp}-180.png`))
  assert.deepEqual(await sharp(png180).metadata().then(meta => [meta.format, meta.width, meta.height]), ['png', 180, 180])
  const ico = publicFile(icoUrl)
  assert.deepEqual(ico.subarray(0, 4), ICO_HEADER)
  assert.ok(ico.includes(png32), 'the ICO wraps the very same 32 px PNG')

  assert.deepEqual(settingsMap(), {
    favicon_url: faviconUrl,
    favicon_ico_url: icoUrl,
    site_name: 'Con Đường Hướng Thiện',
  })
  const audit = harness.rows(activityLogs)
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.userId, EDITOR.id)
  assert.equal(audit[0]!.resource, 'settings')
  assert.equal((audit[0]!.meta as Record<string, unknown>).operation, 'set_favicon')
  assert.equal((audit[0]!.meta as Record<string, unknown>).sourceMime, 'image/png')

  const served = await favicon()
  assert.equal(served.status, 200)
  assert.equal(served.type, 'image/vnd.microsoft.icon')
  assert.equal(served.nosniff, 'nosniff')
  assert.deepEqual(served.bytes, ico)
})

test('a JPEG comes out as PNG and the response says so', async () => {
  const response = await upload(JPEG, 'image/jpeg', 'logo.jpg')
  assert.equal(response.status, 200)
  assert.equal(response.body.convertedToPng, true)
  assert.deepEqual(publicFile(response.body.faviconUrl).subarray(0, 8), PNG_SIGNATURE)
})

test('an ICO is stored as given and used for both tags', async () => {
  const response = await upload(UPLOADED_ICO, 'image/x-icon', 'favicon.ico')
  assert.equal(response.status, 200)
  assert.equal(response.body.faviconUrl, response.body.icoUrl)
  assert.deepEqual(publicFile(response.body.icoUrl), UPLOADED_ICO)
  assert.equal(generated().length, 1)
  assert.deepEqual((await favicon()).bytes, UPLOADED_ICO)
})

test('not an image by its bytes → 415, too large → 413, no file → 400 — nothing written', async () => {
  const before = snapshot()
  assert.equal((await upload(SVG, 'image/svg+xml', 'logo.svg')).status, 415)
  assert.equal((await upload(HTML, 'image/png', 'logo.png')).status, 415)
  const oversized = Buffer.alloc(20 * 1024 * 1024 + 1)
  PNG.copy(oversized)
  assert.equal((await upload(oversized, 'image/png', 'qua-lon.png')).status, 413)
  assert.equal((await server.request('POST', '/api/admin/settings/favicon', { cookie: cookieFor(EDITOR), body: new FormData() })).status, 400)
  assert.deepEqual(snapshot(), before)
})

test('the two setting keys and the audit line commit together: audit fails → 500, the old icon is still configured', async () => {
  harness.failNext(/^insert into `activity_logs`/)
  const before = settingsMap()
  assert.equal((await upload(PNG, 'image/png', 'logo.png')).status, 500)
  assert.deepEqual(settingsMap(), before)
  assert.equal(harness.rows(activityLogs).length, 0)
  assert.deepEqual((await favicon()).bytes, DEFAULT_ICO)
})

test('reset removes both keys with an audit line, and /favicon.ico goes back to the default at once', async () => {
  const set = await upload(PNG, 'image/png', 'logo.png')
  assert.equal(set.status, 200)
  assert.deepEqual((await favicon()).bytes, publicFile(set.body.icoUrl))

  assert.equal((await reset()).status, 200)
  assert.deepEqual(settingsMap(), { site_name: 'Con Đường Hướng Thiện' })
  const audit = harness.rows(activityLogs)
  assert.equal(audit.length, 2)
  assert.equal((audit[1]!.meta as Record<string, unknown>).operation, 'reset_favicon')
  assert.deepEqual((await favicon()).bytes, DEFAULT_ICO)
})

test('/favicon.ico serves only an .ico inside public/, and falls back to the default for anything else', async () => {
  mkdirSync(join(workdir, 'public', 'uploads'), { recursive: true })
  writeFileSync(join(workdir, 'public', 'uploads', 'pasted.ico'), UPLOADED_ICO)
  writeFileSync(join(workdir, 'public', 'uploads', 'logo.png'), PNG)

  const cases: Array<[Record<string, string>, Buffer, string]> = [
    [{ favicon_ico_url: '/uploads/pasted.ico?v=2' }, UPLOADED_ICO, 'a configured .ico (query string ignored)'],
    [{ favicon_url: '/uploads/pasted.ico' }, UPLOADED_ICO, 'an icon URL that is itself a local .ico'],
    [{ favicon_url: '/uploads/logo.png' }, DEFAULT_ICO, 'a PNG is never served under the ICO name'],
    [{ favicon_ico_url: '/uploads/deleted.ico' }, DEFAULT_ICO, 'a file deleted from the library'],
    [{ favicon_ico_url: '/../.env' }, DEFAULT_ICO, 'a path that climbs out of public/'],
    [{ favicon_ico_url: '/uploads/%2e%2e/%2e%2e/.env' }, DEFAULT_ICO, 'an encoded climb'],
    [{ favicon_ico_url: 'https://cdn.example.vn/favicon.ico' }, DEFAULT_ICO, 'a remote URL is not a file on disk'],
  ]
  for (const [values, expected, label] of cases) {
    harness.sqlite.prepare('DELETE FROM settings WHERE key IN (\'favicon_url\', \'favicon_ico_url\')').run()
    for (const [key, value] of Object.entries(values)) harness.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value)
    clearFaviconSettingCache()
    const served = await favicon()
    assert.equal(served.status, 200, label)
    assert.deepEqual(served.bytes, expected, label)
    assert.ok(!served.bytes.toString().includes('JWT_SECRET'), label)
  }

  // The database down: the default, not an error.
  clearFaviconSettingCache()
  harness.failNext(/from `settings`/)
  assert.deepEqual((await favicon()).bytes, DEFAULT_ICO)
})
