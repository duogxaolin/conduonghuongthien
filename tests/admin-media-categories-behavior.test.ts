import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The four Media Portal category routes — `GET`/`POST /api/admin/media-portal/categories` and
 * `PUT`/`DELETE /api/admin/media-portal/categories/:id` — and `GET /api/admin/media/counts`, run
 * for real on SQLite (`_sqlite-mysql-db.ts`: Drizzle's own MySQL SQL, executed on SQLite) behind a
 * real h3 router. Written to pin what the handlers do BEFORE their queries moved into a service,
 * so the move can be shown to change nothing — the statements, their order, the refusals:
 *
 *   - every route checks `media_portal` (`media.read` for the counts) before any statement;
 *   - a create needs a name (400, nothing read), picks a collision-free slug from the slug or the
 *     name, and stores a display order that is not a number as 0;
 *   - an edit looks the row up first (404), then reads the body; a body that changes nothing
 *     writes nothing and answers the stored slug; a name or slug change regenerates the slug
 *     excluding the row itself;
 *   - a delete looks the row up (404), refuses while a video still uses it (400 naming the
 *     count, nothing deleted), and otherwise deletes the row — with no audit row (portal
 *     configuration, `UNAUDITED_DELETE_EXEMPTIONS` in tests/reader-audit-atomicity.test.ts) and no
 *     transaction: the check and the delete are two statements.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { mediaCategories, mediaItems, media, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([mediaCategories, mediaItems, media, activityLogs])
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const h3 = await import('h3')
const load = async (file: string) => (await import(file)).default as import('h3').EventHandler

let actor: unknown = null
const server = await startHandlerServer([
  { method: 'get', path: '/categories', handler: await load('../server/api/admin/media-portal/categories/index.get') },
  { method: 'post', path: '/categories', handler: await load('../server/api/admin/media-portal/categories/index.post') },
  { method: 'put', path: '/categories/:id', handler: await load('../server/api/admin/media-portal/categories/[id].put') },
  { method: 'delete', path: '/categories/:id', handler: await load('../server/api/admin/media-portal/categories/[id].delete') },
  { method: 'get', path: '/counts', handler: await load('../server/api/admin/media/counts.get') },
], [h3.defineEventHandler((event) => { event.context.adminUser = actor })])
after(() => server.close())

const grant = (resource: string, flags: Record<string, boolean>) => ({ resource, canCreate: false, canRead: false, canUpdate: false, canDelete: false, ...flags })
const PORTAL_ADMIN = { id: 3, isSuperAdmin: false, permissions: [grant('media_portal', { canRead: true, canCreate: true, canUpdate: true, canDelete: true })] }
const PORTAL_READER = { id: 4, isSuperAdmin: false, permissions: [grant('media_portal', { canRead: true }), grant('media', { canRead: true })] }

const trail = harness.statements
const categories = () => harness.rows(mediaCategories).map(row => `${row.id}:${row.slug}:${row.name}:${row.description ?? '-'}:${row.displayOrder}`)

const SELECT_CATEGORY = 'select `id`, `name`, `slug`, `description`, `display_order`, `created_at` from `media_categories` where `media_categories`.`id` = ? limit ?'
const SLUGS_LIKE = 'select `id`, `slug` from `media_categories` where `media_categories`.`slug` like ?'
const SLUGS_LIKE_EXCEPT = 'select `id`, `slug` from `media_categories` where (`media_categories`.`slug` like ? and `media_categories`.`id` <> ?)'

beforeEach(async () => {
  harness.reset()
  await harness.db.insert(mediaCategories).values([
    { id: 1, name: 'Phóng sự', slug: 'phong-su', description: 'Video phóng sự', displayOrder: 2 },
    { id: 2, name: 'Tọa đàm', slug: 'toa-dam', description: null, displayOrder: 1 },
    { id: 3, name: 'Tọa đàm 2', slug: 'toa-dam-2', description: null, displayOrder: 1 },
  ])
  await harness.db.insert(mediaItems).values([
    { id: 10, slug: 'v1', shortId: 'aaaa1111', title: 'V1', categoryId: 1 },
    { id: 11, slug: 'v2', shortId: 'aaaa2222', title: 'V2', categoryId: 1 },
    { id: 12, slug: 'v3', shortId: 'aaaa3333', title: 'V3', categoryId: 2 },
    { id: 13, slug: 'v4', shortId: 'aaaa4444', title: 'V4', categoryId: null },
  ])
  await harness.db.insert(media).values([
    { filename: 'a.webp', originalName: 'a.png', mimeType: 'image/webp', sizeBytes: 10, provider: 'local', url: '/uploads/a.webp', storagePath: 'a' },
    { filename: 'b.webp', originalName: 'b.png', mimeType: 'image/webp', sizeBytes: 20, provider: 'local', url: '/uploads/b.webp', storagePath: 'b' },
    { filename: 'c.webp', originalName: 'c.png', mimeType: 'image/webp', sizeBytes: 30, provider: 'r2', url: 'https://cdn/c.webp', storagePath: 'c' },
  ])
  trail.length = 0
  actor = PORTAL_ADMIN
})

const req = (method: string, path: string, body?: unknown) => server.request(method, path, body === undefined ? {} : { body })

test('GET lists every category by display order then id, each with the number of videos using it', async () => {
  const response = await req('GET', '/categories')
  assert.equal(response.status, 200)
  const items = response.body.items as Array<Record<string, unknown>>
  assert.deepEqual(items.map(item => [item.id, item.slug, item.displayOrder, item.usageCount]), [[2, 'toa-dam', 1, 1], [3, 'toa-dam-2', 1, 0], [1, 'phong-su', 2, 2]])
  assert.deepEqual(Object.keys(items[0]!).sort(), ['createdAt', 'description', 'displayOrder', 'id', 'name', 'slug', 'usageCount'])
  assert.deepEqual(trail, [
    'select `id`, `name`, `slug`, `description`, `display_order`, `created_at` from `media_categories` order by `media_categories`.`display_order` asc, `media_categories`.`id` asc',
    'select `category_id`, count(*) from `media_items` where `media_items`.`category_id` is not null group by `media_items`.`category_id`',
  ])

  actor = { id: 9, isSuperAdmin: false, permissions: [grant('media', { canRead: true })] }
  trail.length = 0
  assert.equal((await req('GET', '/categories')).status, 403)
  assert.deepEqual(trail, [])
})

test('POST creates under a collision-free slug; no name is a 400 before any statement; a non-number order is 0', async () => {
  const created = await req('POST', '/categories', { name: '  Tọa đàm ', description: '  ', displayOrder: 'x' })
  assert.equal(created.status, 200)
  assert.deepEqual(created.body, { ok: true, id: 4, slug: 'toa-dam-3' })
  assert.deepEqual(trail, [SLUGS_LIKE, 'insert into `media_categories` (`id`, `name`, `slug`, `description`, `display_order`, `created_at`) values (default, ?, ?, ?, ?, default)'])
  assert.deepEqual(categories().at(-1), '4:toa-dam-3:Tọa đàm:-:0')

  trail.length = 0
  const explicit = await req('POST', '/categories', { name: 'Khác', slug: ' Phim Tài Liệu ', description: ' Mô tả ', displayOrder: 7.9 })
  assert.deepEqual(explicit.body, { ok: true, id: 5, slug: 'phim-tai-lieu' })
  assert.deepEqual(categories().at(-1), '5:phim-tai-lieu:Khác:Mô tả:7')

  trail.length = 0
  const unnamed = await req('POST', '/categories', { name: '   ', slug: 'x' })
  assert.equal(unnamed.status, 400)
  assert.equal(unnamed.body.statusMessage, 'Tên danh mục không được để trống.')
  assert.deepEqual(trail, [])

  actor = PORTAL_READER
  assert.equal((await req('POST', '/categories', { name: 'Không được' })).status, 403)
  assert.deepEqual(trail, [])
  assert.equal(categories().length, 5)
})

test('PUT looks the row up first (404), writes nothing for an empty body, regenerates the slug excluding itself', async () => {
  const missing = await req('PUT', '/categories/99', { name: 'X' })
  assert.equal(missing.status, 404)
  assert.equal(missing.body.statusMessage, 'Danh mục không tồn tại.')
  assert.deepEqual(trail, [SELECT_CATEGORY])

  trail.length = 0
  assert.equal((await req('PUT', '/categories/abc', { name: 'X' })).status, 400)
  assert.deepEqual(trail, [])

  const noop = await req('PUT', '/categories/2', {})
  assert.deepEqual(noop.body, { ok: true, slug: 'toa-dam' })
  assert.deepEqual(trail, [SELECT_CATEGORY])

  trail.length = 0
  const renamed = await req('PUT', '/categories/2', { name: 'Tọa đàm' })
  assert.deepEqual(renamed.body, { ok: true, slug: 'toa-dam' }, 'its own slug is not a collision')
  assert.deepEqual(trail, [SELECT_CATEGORY, SLUGS_LIKE_EXCEPT, 'update `media_categories` set `name` = ?, `slug` = ? where `media_categories`.`id` = ?'])

  trail.length = 0
  const clash = await req('PUT', '/categories/1', { slug: 'Tọa đàm', description: '', displayOrder: 'abc' })
  assert.deepEqual(clash.body, { ok: true, slug: 'toa-dam-3' })
  assert.deepEqual(trail, [SELECT_CATEGORY, SLUGS_LIKE_EXCEPT, 'update `media_categories` set `slug` = ?, `description` = ?, `display_order` = ? where `media_categories`.`id` = ?'])
  assert.equal(categories()[0], '1:toa-dam-3:Phóng sự:-:0')

  trail.length = 0
  const describeOnly = await req('PUT', '/categories/3', { description: ' Mới ', displayOrder: 4.6 })
  assert.deepEqual(describeOnly.body, { ok: true, slug: 'toa-dam-2' })
  assert.deepEqual(trail, [SELECT_CATEGORY, 'update `media_categories` set `description` = ?, `display_order` = ? where `media_categories`.`id` = ?'])
  assert.equal(categories()[2], '3:toa-dam-2:Tọa đàm 2:Mới:4')

  trail.length = 0
  const emptySlug = await req('PUT', '/categories/3', { slug: '' })
  assert.deepEqual(emptySlug.body, { ok: true, slug: 'toa-dam-2' }, 'an empty slug falls back to the stored name')
  assert.deepEqual(trail, [SELECT_CATEGORY, SLUGS_LIKE_EXCEPT, 'update `media_categories` set `slug` = ? where `media_categories`.`id` = ?'])

  actor = PORTAL_READER
  trail.length = 0
  assert.equal((await req('PUT', '/categories/2', { name: 'X' })).status, 403)
  assert.deepEqual(trail, [])
})

test('DELETE refuses a missing row (404) and a row still in use (400, nothing deleted); deletes an unused one with no audit row', async () => {
  const missing = await req('DELETE', '/categories/99')
  assert.equal(missing.status, 404)
  assert.deepEqual(trail, [SELECT_CATEGORY])

  trail.length = 0
  assert.equal((await req('DELETE', '/categories/0')).status, 400)
  assert.deepEqual(trail, [])

  const inUse = await req('DELETE', '/categories/1')
  assert.equal(inUse.status, 400)
  assert.equal(inUse.body.statusMessage, 'Không thể xóa danh mục đang có 2 video. Hãy chuyển video sang danh mục khác trước.')
  const COUNT_USE = 'select count(*) from `media_items` where `media_items`.`category_id` = ?'
  assert.deepEqual(trail, [SELECT_CATEGORY, COUNT_USE])

  trail.length = 0
  const removed = await req('DELETE', '/categories/3')
  assert.deepEqual(removed.body, { ok: true })
  assert.deepEqual(trail, [SELECT_CATEGORY, COUNT_USE, 'delete from `media_categories` where `media_categories`.`id` = ?'])
  assert.deepEqual(categories().map(row => row.split(':')[0]), ['1', '2'])
  assert.equal(harness.rows(activityLogs).length, 0)
  assert.equal(harness.transactionsBegun, 0)

  actor = PORTAL_READER
  trail.length = 0
  assert.equal((await req('DELETE', '/categories/2')).status, 403)
  assert.deepEqual(trail, [])
})

test('GET /api/admin/media/counts answers the number of library files per provider (media.read)', async () => {
  actor = PORTAL_READER
  const response = await req('GET', '/counts')
  assert.deepEqual(response.body, { ok: true, local: 2, r2: 1 })
  assert.deepEqual(trail, ['select `provider`, COUNT(*) from `media` group by `media`.`provider`'])

  harness.reset()
  assert.deepEqual((await req('GET', '/counts')).body, { ok: true, local: 0, r2: 0 })

  actor = PORTAL_ADMIN
  trail.length = 0
  assert.equal((await req('GET', '/counts')).status, 403)
  assert.deepEqual(trail, [])
})
