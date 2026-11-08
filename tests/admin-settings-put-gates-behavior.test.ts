import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * `PUT /api/admin/settings` — the three refusals and the one extra write that happen INSIDE the
 * per-key loop, i.e. inside the transaction (`saveGeneralSettingsWithAudit`,
 * server/services/admin-settings-general.ts):
 *   - `tracking_custom_head` / `tracking_custom_body` are injected raw into every public page, so
 *     only a SuperAdmin may CHANGE them — a delegated editor re-sending the stored value still
 *     saves the rest of the form; changing it is a 403 that rolls back the keys written before it;
 *   - a value over 20 000 characters is a 400 naming the key, with the same rollback;
 *   - changing `favicon_url` deletes the derived `favicon_ico_url` in the same transaction (one
 *     failed audit row leaves both as they were), and the favicon cache is cleared only after the
 *     commit.
 * The source-text tests (cms-core-auth-media, favicon-settings, main-logo-settings) pin the lists;
 * nothing ran these branches before.
 *
 * The REAL handler and service, with Drizzle's MySQL SQL on SQLite (tests/_sqlite-mysql-db.ts —
 * a real transaction, so a throw mid-loop really rolls back).
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { settings, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([settings, activityLogs])

const events: string[] = []
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })
mock.module('../server/utils/favicon-setting', {
  namedExports: { FAVICON_ICO_SETTING_KEY: 'favicon_ico_url', clearFaviconSettingCache: () => { events.push('clear favicon') } },
})
mock.module('../server/utils/public-page-cache', {
  namedExports: { purgePublicPageCacheAfterWrite: async (reason: string) => { events.push(`purge ${reason}`) } },
})

type Event = { body?: unknown, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const put = (await import('../server/api/admin/settings/index.put')).default as unknown as (event: Event) => Promise<{ ok: boolean }>

const grant = { resource: 'settings', canCreate: false, canRead: true, canUpdate: true, canDelete: false }
const EDITOR = { id: 5, isSuperAdmin: false, permissions: [grant] }
const SUPERADMIN = { id: 1, isSuperAdmin: true, permissions: [] }
const save = (actor: unknown, values: Record<string, unknown>) => put({ body: { settings: values }, context: { adminUser: actor } })

const HEAD = '<script>window.ga = 1</script>'
const stored = () => Object.fromEntries(harness.rows(settings).map(row => [row.key, row.value]))
const audits = () => harness.rows(activityLogs).map(row => row.meta)
async function refused(promise: Promise<unknown>): Promise<{ statusCode: number, statusMessage: string }> {
  try { await promise } catch (error) { return error as { statusCode: number, statusMessage: string } }
  assert.fail('expected the save to be refused')
}

beforeEach(async () => {
  harness.reset()
  events.length = 0
  await harness.db.insert(settings).values([
    { key: 'site_name', value: 'Cổng cũ' },
    { key: 'tracking_custom_head', value: HEAD },
    { key: 'favicon_url', value: '/uploads/favicon/a-32.png' },
    { key: 'favicon_ico_url', value: '/uploads/favicon/a.ico' },
  ])
})

test('an editor changing the custom head script is refused, and the keys saved before it in the same request roll back', async () => {
  const error = await refused(save(EDITOR, { site_name: 'Cổng mới', tracking_custom_head: '<script>evil()</script>', hotline: '1900' }))
  assert.equal(error.statusCode, 403)
  assert.match(error.statusMessage, /Chỉ SuperAdmin/)
  assert.equal(stored().site_name, 'Cổng cũ', 'site_name was written before the 403 and must roll back with it')
  assert.equal(stored().tracking_custom_head, HEAD)
  assert.equal(stored().hotline, undefined)
  assert.deepEqual(audits(), [])
  assert.deepEqual(events, [], 'nothing is purged for a refused save')
})

test('an editor re-sending the stored custom head saves the rest of the form; the script is not rewritten', async () => {
  assert.deepEqual(await save(EDITOR, { tracking_custom_head: HEAD, tracking_custom_body: '', site_name: 'Cổng mới' }), { ok: true })
  assert.equal(stored().site_name, 'Cổng mới')
  assert.equal(stored().tracking_custom_head, HEAD)
  // `tracking_custom_body` was not stored; '' equals "absent", so it is skipped too.
  assert.equal(stored().tracking_custom_body, undefined)
  assert.deepEqual(audits(), [{ keysUpdated: ['site_name'] }])
})

test('a SuperAdmin may change the custom head script, and the change is audited', async () => {
  assert.deepEqual(await save(SUPERADMIN, { tracking_custom_head: '<script>b()</script>' }), { ok: true })
  assert.equal(stored().tracking_custom_head, '<script>b()</script>')
  assert.deepEqual(audits(), [{ keysUpdated: ['tracking_custom_head'] }])
})

test('a value over 20 000 characters is a 400 naming the key, and the earlier keys roll back', async () => {
  const error = await refused(save(SUPERADMIN, { site_name: 'Cổng mới', site_description: 'x'.repeat(20_001) }))
  assert.equal(error.statusCode, 400)
  assert.match(error.statusMessage, /"site_description" quá dài/)
  assert.equal(stored().site_name, 'Cổng cũ')
  assert.equal(stored().site_description, undefined)
  assert.deepEqual(audits(), [])
})

test('changing favicon_url drops the derived .ico in the same transaction; the cache is cleared after the commit', async () => {
  assert.deepEqual(await save(EDITOR, { favicon_url: '/uploads/favicon/b-32.png' }), { ok: true })
  assert.equal(stored().favicon_url, '/uploads/favicon/b-32.png')
  assert.equal(stored().favicon_ico_url, undefined, '/favicon.ico would keep serving the old icon')
  assert.deepEqual(events, ['clear favicon', 'purge settings.update'])
})

test('re-sending the same favicon_url keeps the .ico (the key is rewritten, so its cache is still cleared)', async () => {
  assert.deepEqual(await save(EDITOR, { favicon_url: '/uploads/favicon/a-32.png' }), { ok: true })
  assert.equal(stored().favicon_ico_url, '/uploads/favicon/a.ico')
  assert.deepEqual(events, ['clear favicon', 'purge settings.update'])
})

test('a failed audit row leaves the old favicon pair in place and clears no cache', async () => {
  harness.failNext(/^insert into `activity_logs`/, { errno: 1452 })
  await assert.rejects(save(EDITOR, { favicon_url: '/uploads/favicon/b-32.png' }))
  assert.equal(stored().favicon_url, '/uploads/favicon/a-32.png')
  assert.equal(stored().favicon_ico_url, '/uploads/favicon/a.ico')
  assert.deepEqual(events, [])
})
