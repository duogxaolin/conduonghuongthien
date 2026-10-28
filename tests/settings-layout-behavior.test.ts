import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The site layout setting — `GET`/`PUT /api/admin/settings/layout`
 * (server/api/admin/settings/layout.{get,put}.ts → server/services/layout-settings.ts):
 * container width, article grid, social-button mode, stored as JSON in
 * `settings.layout_config` and served to every public page through
 * `/api/public/settings`.
 *
 * The invariants:
 *   - reading takes `settings.read`, saving takes `settings.update`;
 *   - every field is checked against its closed set or range — a bad value is a
 *     400 naming it, and nothing is written;
 *   - nothing stored, or a stored value that no longer parses or validates, reads
 *     as the defaults (a hand-edited row cannot break the page);
 *   - the value and its audit line (`meta.after` = the saved object) commit
 *     together; saving again replaces the value (one row, upserted).
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite
 * (`_sqlite-mysql-db.ts`, real transaction, `ON DUPLICATE KEY UPDATE` → SQLite upsert).
 */

process.env.JWT_SECRET = 'settings-layout-behavior-test-secret-0123456789'
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

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const getLayout = (await import('../server/api/admin/settings/layout.get')).default
const putLayout = (await import('../server/api/admin/settings/layout.put')).default
const { DEFAULT_LAYOUT_CONFIG } = await import('../server/services/layout-settings')
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/settings/layout', handler: getLayout },
  { method: 'put', path: '/api/admin/settings/layout', handler: putLayout },
], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const SITE_ADMIN: Account = { id: 4, username: 'quantri', roleId: 3, roleName: 'Quản trị trang' }
const SETTINGS_READER: Account = { id: 5, username: 'xemcaidat', roleId: 4, roleName: 'Xem cài đặt' }
const EDITOR: Account = { id: 6, username: 'bientap', roleId: 5, roleName: 'Biên tập' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const read = (account: Account | null = SETTINGS_READER) =>
  server.request('GET', '/api/admin/settings/layout', account ? { cookie: cookieFor(account) } : {})
const save = (body: unknown, account: Account | null = SITE_ADMIN) =>
  server.request('PUT', '/api/admin/settings/layout', { ...(account ? { cookie: cookieFor(account) } : {}), body })

const VALID = { containerWidth: 'custom', containerCustom: 1366, articleGrid: 'list', articleGridCols: 4, socialDisplayMode: 'floating', socialAutoOpen: false }
const stored = () => harness.rows(settings).filter(row => row.key === 'layout_config').map(row => ({ value: JSON.parse(String(row.value)), type: row.type, group: row.group }))
const audit = () => harness.rows(activityLogs).map(row => ({ userId: row.userId, action: row.action, resource: row.resource, resourceId: row.resourceId, meta: row.meta }))
const snapshot = () => ({ stored: stored(), audit: audit() })

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([SITE_ADMIN, SETTINGS_READER, EDITOR].map(account => ({ id: account.roleId, name: account.roleName, isSystem: false })))
  await harness.db.insert(permissions).values([
    { roleId: SITE_ADMIN.roleId, resource: 'settings', canRead: true, canUpdate: true },
    { roleId: SETTINGS_READER.roleId, resource: 'settings', canRead: true, canCreate: true, canDelete: true },
    { roleId: EDITOR.roleId, resource: 'news', canRead: true, canCreate: true, canUpdate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([SITE_ADMIN, SETTINGS_READER, EDITOR].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
})

test('reading takes settings.read; saving takes settings.update — without it nothing is written', async () => {
  assert.equal((await read(null)).status, 401)
  assert.equal((await read(EDITOR)).status, 403)
  assert.equal((await read(SETTINGS_READER)).status, 200)
  assert.equal((await save(VALID, null)).status, 401)
  assert.equal((await save(VALID, SETTINGS_READER)).status, 403)
  assert.equal((await save(VALID, EDITOR)).status, 403)
  assert.deepEqual(snapshot(), { stored: [], audit: [] })
})

test('nothing stored, or a stored value that no longer parses or validates, reads as the defaults', async () => {
  assert.deepEqual((await read()).body, { ok: true, config: DEFAULT_LAYOUT_CONFIG })
  for (const value of ['{not json', JSON.stringify({ ...VALID, containerWidth: 'full-bleed' }), '[]', '']) {
    harness.sqlite.prepare('DELETE FROM settings').run()
    await harness.db.insert(settings).values({ key: 'layout_config', value, type: 'json', group: 'layout' })
    assert.deepEqual((await read()).body, { ok: true, config: DEFAULT_LAYOUT_CONFIG }, value)
  }
  harness.sqlite.prepare('DELETE FROM settings').run()
  await harness.db.insert(settings).values({ key: 'layout_config', value: JSON.stringify(VALID), type: 'json', group: 'layout' })
  assert.deepEqual((await read()).body, { ok: true, config: VALID })
})

test('every field is checked against its closed set or range: a bad value is a 400 and nothing is written', async () => {
  const cases: Array<[unknown, RegExp]> = [
    ['not json', /Dữ liệu cấu hình/],
    [[VALID], /Dữ liệu cấu hình/],
    [{ ...VALID, containerWidth: 'full' }, /container/],
    [{ ...VALID, containerCustom: 319 }, /320 đến 1920/],
    [{ ...VALID, containerCustom: 1921 }, /320 đến 1920/],
    [{ ...VALID, articleGrid: 'masonry' }, /grid bài viết/],
    [{ ...VALID, articleGridCols: 5 }, /2, 3 hoặc 4/],
    [{ ...VALID, articleGridCols: '3x' }, /2, 3 hoặc 4/],
    [{ ...VALID, socialDisplayMode: 'banner' }, /MXH/],
    [{ ...VALID, socialAutoOpen: 'true' }, /boolean/],
  ]
  for (const [body, message] of cases) {
    const response = await save(body)
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.match(String(response.body.statusMessage ?? response.body.message), message, JSON.stringify(body))
  }
  assert.deepEqual(snapshot(), { stored: [], audit: [] })
})

test('a valid save stores the checked object and audits it; a missing custom width takes the default; saving again replaces it', async () => {
  const response = await save({ ...VALID, articleGridCols: '2', extra: 'dropped' })
  assert.equal(response.status, 200)
  const first = { ...VALID, articleGridCols: 2 }
  assert.deepEqual(response.body, { ok: true, config: first })
  assert.deepEqual(stored(), [{ value: first, type: 'json', group: 'layout' }])
  assert.deepEqual(audit(), [{ userId: SITE_ADMIN.id, action: 'update', resource: 'settings', resourceId: null, meta: { key: 'layout_config', after: first } }])

  const withoutCustom: Record<string, unknown> = { ...VALID }
  delete withoutCustom.containerCustom
  assert.equal((await save({ ...withoutCustom, containerWidth: 'wide' })).status, 200)
  const second = { ...VALID, containerWidth: 'wide', containerCustom: DEFAULT_LAYOUT_CONFIG.containerCustom }
  assert.deepEqual(stored(), [{ value: second, type: 'json', group: 'layout' }])
  assert.equal(audit().length, 2)
  assert.deepEqual((await read()).body, { ok: true, config: second })
})

test('the value and its audit line commit together — audit fails → 500, the stored layout is what it was', async () => {
  assert.equal((await save(VALID)).status, 200)
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await save({ ...VALID, articleGrid: 'grid' })).status, 500)
  assert.deepEqual(snapshot(), before)
})
