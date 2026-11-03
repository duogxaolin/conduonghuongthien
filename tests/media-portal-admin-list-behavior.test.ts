import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * GET /api/admin/media-portal (index.get.ts → `listAllMediaForAdmin`): the admin list of
 * the media portal's videos, on `media_portal.read` — a separate resource from the old
 * image library (`media`).
 *
 * The invariants (the handler's header): page and size go through `finitePositive`
 * (`?page=abc`, `?page=1e999` answer a real number, never null or a 500); an unknown
 * `status`, `source`, `sort`, `order` or a category that is not a positive number is a
 * 400, never a silent "everything"; drafts, failed and archived items are listed with
 * their processing state (an admin list hides nothing); the search is the text typed
 * (`_`/`%` escaped); the default order is the most recently updated first, ties by id.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`).
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.mediaItems, s.mediaCategories],
  routes: async load => [
    { method: 'get', path: '/api/admin/media-portal', handler: await load('../server/api/admin/media-portal/index.get') },
  ],
})
after(() => h.server.close())
const { mediaItems, mediaCategories } = h.schema

type Json = Record<string, unknown>
type Account = Awaited<ReturnType<typeof h.account>>
let viewer: Account

beforeEach(async () => {
  h.reset()
  viewer = await h.account([{ resource: 'media_portal', canRead: true }], 'media')
})

let seq = 0
async function item(fields: Json = {}) {
  seq += 1
  const [row] = await h.harness.db.insert(mediaItems).values({
    slug: `video-${seq}`, shortId: `short${String(seq).padStart(6, '0')}`, title: `Video ${seq}`, source: 'upload', status: 'published',
    processingStatus: 'ready', updatedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)), ...fields,
  } as typeof mediaItems.$inferInsert)
  return Number(row.insertId)
}
async function list(query = '') {
  const response = await h.request('GET', `/api/admin/media-portal${query}`, viewer)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  return response.body as { items: Json[], total: number, page: number, limit: number }
}

test('media_portal.read is required — the old image library\'s `media` permission is not enough', async () => {
  const library = await h.account([{ resource: 'media', canRead: true, canUpdate: true }], 'thuvien')
  assert.equal((await h.request('GET', '/api/admin/media-portal', null)).status, 401)
  assert.equal((await h.request('GET', '/api/admin/media-portal', library)).status, 403)
})

test('every item, whatever its state, most recently updated first (ties by id), with its category and processing state', async () => {
  await h.harness.db.insert(mediaCategories).values({ id: 4, name: 'Hướng dẫn', slug: 'huong-dan' } as typeof mediaCategories.$inferInsert)
  const draft = await item({ status: 'draft', processingStatus: 'failed', processingError: 'ffmpeg: codec', categoryId: 4 })
  const archived = await item({ status: 'archived' })
  const tieA = await item({ updatedAt: new Date(Date.UTC(2026, 9, 5)) })
  const tieB = await item({ updatedAt: new Date(Date.UTC(2026, 9, 5)) })
  const page = await list()
  assert.deepEqual(page.items.map(row => row.id), [tieB, tieA, archived, draft])
  assert.deepEqual([page.total, page.page, page.limit], [4, 1, 20])
  const failed = page.items.find(row => row.id === draft)!
  assert.deepEqual([failed.status, failed.processingStatus, failed.processingError, failed.categoryName, failed.categorySlug], ['draft', 'failed', 'ffmpeg: codec', 'Hướng dẫn', 'huong-dan'])
})

test('filters, sort, order and page size — each value is what the URL says', async () => {
  await h.harness.db.insert(mediaCategories).values({ id: 7, name: 'Pháp luật', slug: 'phap-luat' } as typeof mediaCategories.$inferInsert)
  const yt = await item({ source: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ', title: 'B YouTube', viewCount: 50, categoryId: 7 })
  const up = await item({ title: 'A Tải lên', viewCount: 900, status: 'draft', processingStatus: 'processing' })
  const third = await item({ title: 'C Cuối', viewCount: 10 })
  assert.deepEqual((await list('?source=youtube')).items.map(row => row.id), [yt])
  assert.deepEqual((await list('?status=draft')).items.map(row => row.id), [up])
  assert.deepEqual((await list('?processingStatus=processing')).items.map(row => row.id), [up])
  assert.deepEqual((await list('?categoryId=7')).items.map(row => row.id), [yt])
  assert.deepEqual((await list('?sort=title&order=asc')).items.map(row => row.id), [up, yt, third])
  assert.deepEqual((await list('?sort=viewCount')).items.map(row => row.id), [up, yt, third])
  const second = await list('?limit=2&page=2&sort=title&order=asc')
  assert.deepEqual([second.items.map(row => row.id), second.total, second.page, second.limit], [[third], 3, 2, 2])
  assert.equal((await list('?limit=500')).limit, 50)
  for (const query of ['?page=abc', '?page=1e999', '?page=-4']) assert.equal((await list(query)).page, 1, query)
})

test('the search is the text typed: `_` and `%` match only themselves', async () => {
  const exact = await item({ title: 'Mẫu_01 hướng dẫn' })
  await item({ title: 'MẫuX01 hướng dẫn' })
  const percent = await item({ title: 'Giảm 50% án phí' })
  assert.deepEqual((await list(`?search=${encodeURIComponent('Mẫu_01')}`)).items.map(row => row.id), [exact])
  assert.deepEqual((await list(`?search=${encodeURIComponent('%')}`)).items.map(row => row.id), [percent])
})

test('an unknown status, source, sort, order or category is a 400 — never a silent "everything"', async () => {
  await item()
  const cases: Array<[string, string]> = [
    ['?status=banana', 'Giá trị trạng thái không hợp lệ.'], ['?source=vimeo', 'Giá trị nguồn không hợp lệ.'],
    ['?sort=password', 'Trường sắp xếp không hợp lệ.'], ['?order=sideways', 'Thứ tự sắp xếp không hợp lệ.'],
    ['?categoryId=abc', 'Danh mục không hợp lệ.'], ['?categoryId=-1', 'Danh mục không hợp lệ.'],
  ]
  for (const [query, message] of cases) {
    const response = await h.request('GET', `/api/admin/media-portal${query}`, viewer)
    assert.deepEqual([response.status, response.body.statusMessage], [400, message], query)
  }
})
