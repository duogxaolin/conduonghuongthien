import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, beforeEach, mock } from 'node:test'
import sharp from 'sharp'

/**
 * `POST` / `DELETE /api/admin/media-portal/:id/thumbnail` — set a video's thumbnail from a Media
 * Library image, or clear it back to the generated one. No test ran these two handlers (the
 * service is covered by tests/media-portal-admin-write-behavior.test.ts on a fake handle); this one
 * pins, before the handlers' database access moved into a service:
 *
 *   - `media_portal.update`, and a bad id / body refused before any statement;
 *   - the media configuration resolved from the database (`settings`, group `media_portal`) is
 *     what the service works with — its `workdir` is where `thumb.jpg` is written / removed;
 *   - each `ok: false` reason of the service answers 404 with its own message;
 *   - a service THROW on the set path is a 500 carrying the thrown message (the config read
 *     before it is outside that mapping);
 *   - the answer-cache bump comes after the service succeeded, never after a refusal.
 *
 * The real service (`server/services/media-portal.ts` barrel) on SQLite (`_sqlite-mysql-db.ts`),
 * real sharp, real files under a temporary working directory; the bump is the only fake.
 */

const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'cdkt-thumb-handlers-')))
const originalCwd = process.cwd()
process.chdir(workdir)
const originalWorkdir = process.env.CDKT_MEDIA_WORKDIR
process.env.CDKT_MEDIA_WORKDIR = join(workdir, 'work')

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { settings, mediaItems, media, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([settings, mediaItems, media, activityLogs])
const trail = harness.statements
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })
mock.module('../server/services/chatbot-answer-cache', { namedExports: { bumpAnswerCacheVersion: async () => { trail.push('@bump'); return 1 } } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const h3 = await import('h3')
const load = async (file: string) => (await import(file)).default as import('h3').EventHandler

let actor: unknown = null
const server = await startHandlerServer([
  { method: 'post', path: '/items/:id/thumbnail', handler: await load('../server/api/admin/media-portal/[id]/thumbnail.post') },
  { method: 'delete', path: '/items/:id/thumbnail', handler: await load('../server/api/admin/media-portal/[id]/thumbnail.delete') },
], [h3.defineEventHandler((event) => { event.context.adminUser = actor })])
after(async () => {
  await server.close()
  process.chdir(originalCwd)
  if (originalWorkdir === undefined) delete process.env.CDKT_MEDIA_WORKDIR
  else process.env.CDKT_MEDIA_WORKDIR = originalWorkdir
  rmSync(workdir, { recursive: true, force: true })
})

const grant = (flags: Record<string, boolean>) => ({ resource: 'media_portal', canCreate: false, canRead: false, canUpdate: false, canDelete: false, ...flags })
const EDITOR = { id: 6, isSuperAdmin: false, permissions: [grant({ canRead: true, canUpdate: true })] }
const READER = { id: 7, isSuperAdmin: false, permissions: [grant({ canRead: true, canCreate: true })] }

const CONFIG_READ = 'select `key`, `value` from `settings` where `settings`.`group` = ?'
const thumbFile = join(workdir, 'work', 'media', 'clip', 'thumb.jpg')
const libraryImage = join(workdir, 'public', 'uploads', '2026', '11', 'anh.png')
let png: Buffer

beforeEach(async () => {
  harness.reset()
  png ??= await sharp({ create: { width: 64, height: 36, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer()
  rmSync(join(workdir, 'work'), { recursive: true, force: true })
  rmSync(join(workdir, 'public'), { recursive: true, force: true })
  mkdirSync(join(workdir, 'work', 'media', 'clip'), { recursive: true })
  mkdirSync(join(workdir, 'public', 'uploads', '2026', '11'), { recursive: true })
  writeFileSync(libraryImage, png)
  // The configuration the handlers resolve: a database override that must win over the default.
  await harness.db.insert(settings).values({ key: 'media_upload_enabled', value: 'true', group: 'media_portal' })
  await harness.db.insert(mediaItems).values([
    { id: 41, slug: 'clip', shortId: 'clip0001', title: 'Clip', source: 'upload', storagePath: 'media/clip', storageProvider: 'local', thumbnailUrl: '/uploads/old.png' },
    { id: 42, slug: 'yt', shortId: 'yt000001', title: 'YouTube', source: 'youtube' },
  ])
  await harness.db.insert(media).values([
    { id: 51, filename: 'anh.png', originalName: 'anh.png', mimeType: 'image/png', sizeBytes: png.length, provider: 'local', url: '/uploads/2026/11/anh.png', storagePath: libraryImage },
    { id: 52, filename: 'tai-lieu.pdf', originalName: 'tai-lieu.pdf', mimeType: 'application/pdf', sizeBytes: 3, provider: 'local', url: '/uploads/2026/11/tai-lieu.pdf', storagePath: join(workdir, 'public', 'uploads', '2026', '11', 'tai-lieu.pdf') },
    { id: 53, filename: 'mat.png', originalName: 'mat.png', mimeType: 'image/png', sizeBytes: 3, provider: 'local', url: '/uploads/2026/11/mat.png', storagePath: join(workdir, 'public', 'uploads', '2026', '11', 'mat.png') },
  ])
  trail.length = 0
  actor = EDITOR
})

const audits = () => harness.rows(activityLogs).map(row => [row.userId, row.action, row.resource, row.resourceId, row.meta])

test('POST sets thumb.jpg in the configured workdir from the library image, with its audit row, then bumps', async () => {
  const response = await server.request('POST', '/items/41/thumbnail', { body: { mediaId: 51 } })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true })
  assert.ok(existsSync(thumbFile), 'thumb.jpg not written under the configured workdir')
  assert.equal((await sharp(readFileSync(thumbFile)).metadata()).format, 'jpeg')
  assert.equal(harness.rows(mediaItems).find(row => row.id === 41)!.thumbnailUrl, '/uploads/2026/11/anh.png')
  assert.deepEqual(audits(), [[6, 'update', 'media_portal', 41, { changed: ['thumbnail'], thumbSource: 'media_library', mediaId: 51, pushedR2: false }]])
  assert.deepEqual(trail.slice(0, 2), [CONFIG_READ, CONFIG_READ])
  assert.equal(trail.at(-1), '@bump')
  assert.ok(trail.indexOf('@bump') > trail.findIndex(sql => sql.startsWith('insert into `activity_logs`')), 'bumped before the write')
})

test('POST: each refusal of the service is a 404 with its own message, a throw is a 500 with its message, none bumps', async () => {
  for (const [path, body, message] of [
    ['/items/99/thumbnail', { mediaId: 51 }, 'Mục media không tồn tại.'],
    ['/items/42/thumbnail', { mediaId: 51 }, 'Chỉ video tự tải lên mới đổi thumbnail được.'],
    ['/items/41/thumbnail', { mediaId: 99 }, 'Ảnh thư viện không tồn tại.'],
    ['/items/41/thumbnail', { mediaId: 52 }, 'Tệp đã chọn không phải ảnh.'],
  ] as const) {
    trail.length = 0
    const refused = await server.request('POST', path, { body })
    assert.equal(refused.status, 404, `${path} ${JSON.stringify(body)}`)
    assert.equal(refused.body.statusMessage, message)
    assert.deepEqual(trail.slice(0, 2), [CONFIG_READ, CONFIG_READ])
    assert.ok(!trail.includes('@bump'))
  }

  trail.length = 0
  const missingFile = await server.request('POST', '/items/41/thumbnail', { body: { mediaId: 53 } })
  assert.equal(missingFile.status, 500)
  assert.equal(missingFile.body.statusMessage, 'Ảnh thư viện không còn trên đĩa.')
  assert.ok(!trail.includes('@bump'))
  assert.equal(harness.rows(activityLogs).length, 0)
  assert.equal(existsSync(thumbFile), false)
})

test('POST: a bad id or body is a 400 before any statement; update permission is required', async () => {
  for (const [path, body, message] of [
    ['/items/0/thumbnail', { mediaId: 51 }, 'Mục media không hợp lệ.'],
    ['/items/4.5/thumbnail', { mediaId: 51 }, 'Mục media không hợp lệ.'],
    ['/items/41/thumbnail', [51], 'Dữ liệu không hợp lệ.'],
    ['/items/41/thumbnail', { mediaId: '0' }, 'Ảnh thư viện không hợp lệ.'],
    ['/items/41/thumbnail', { mediaId: 5.5 }, 'Ảnh thư viện không hợp lệ.'],
  ] as const) {
    const refused = await server.request('POST', path, { body })
    assert.equal(refused.status, 400, `${path} ${JSON.stringify(body)}`)
    assert.equal(refused.body.statusMessage, message)
  }
  assert.equal((await server.request('POST', '/items/41/thumbnail')).status, 400)
  actor = READER
  assert.equal((await server.request('POST', '/items/41/thumbnail', { body: { mediaId: 51 } })).status, 403)
  assert.deepEqual(trail, [])
})

test('DELETE removes thumb.jpg from the configured workdir, resets the column with its audit row, then bumps', async () => {
  writeFileSync(thumbFile, 'old thumb')
  const response = await server.request('DELETE', '/items/41/thumbnail')
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true })
  assert.equal(existsSync(thumbFile), false)
  assert.equal(harness.rows(mediaItems).find(row => row.id === 41)!.thumbnailUrl, null)
  assert.deepEqual(audits(), [[6, 'update', 'media_portal', 41, { changed: ['thumbnail'], cleared: true }]])
  assert.deepEqual(trail, [
    CONFIG_READ,
    CONFIG_READ,
    'select `id`, `source`, `storage_path`, `storage_provider`, `slug` from `media_items` where `media_items`.`id` = ? limit ?',
    'update `media_items` set `thumbnail_url` = ? where `media_items`.`id` = ?',
    'insert into `activity_logs` (`id`, `user_id`, `action`, `resource`, `resource_id`, `meta`, `created_at`) values (default, ?, ?, ?, ?, ?, default)',
    '@bump',
  ])
})

test('DELETE: not found / not an upload are 404s with their messages and no bump; a bad id is a 400; update is required', async () => {
  for (const [path, message] of [['/items/99/thumbnail', 'Mục media không tồn tại.'], ['/items/42/thumbnail', 'Chỉ video tự tải lên mới đổi thumbnail được.']] as const) {
    trail.length = 0
    const refused = await server.request('DELETE', path)
    assert.equal(refused.status, 404, path)
    assert.equal(refused.body.statusMessage, message)
    assert.equal(trail.length, 3, JSON.stringify(trail))
  }
  trail.length = 0
  for (const id of ['0', 'x', '1.5']) assert.equal((await server.request('DELETE', `/items/${id}/thumbnail`)).status, 400, id)
  actor = READER
  assert.equal((await server.request('DELETE', '/items/41/thumbnail')).status, 403)
  assert.deepEqual(trail, [])
  assert.equal(harness.rows(activityLogs).length, 0)
})
