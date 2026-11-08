import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * The page builder's admin routes that no test ran (only e2e reached them):
 *   GET    /api/admin/pages                                   (list, block counts)
 *   POST   /api/admin/pages                                   (create + audit)
 *   GET    /api/admin/pages/:id                               (live tree / flat rows + draft)
 *   GET    /api/admin/pages/:id/versions                      (version metadata)
 *   POST   /api/admin/pages/:id/versions                      (manual backup ≤ 4 / origin baseline + audit)
 *   DELETE /api/admin/pages/:id/versions/:versionId           (non-origin version + audit)
 *   POST   /api/admin/pages/:id/versions/:versionId/restore   (version → draft + audit)
 *   PUT    /api/admin/pages/:id/draft                         (clear path — the save path runs in
 *                                                             security-block-link-schemes)
 *
 * Pinned as they behave today, before their statements move to `server/services` (2026-11-08):
 * the permission each needs; what is read and in which order; every write and its audit row
 * commit together — a failed audit insert leaves nothing written, including the origin path's
 * delete-then-insert pair and the manual-backup cap checked inside the transaction.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`).
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.pages, s.pageBlocks, s.pageVersions, s.activityLogs],
  routes: async load => [
    { method: 'get', path: '/api/admin/pages', handler: await load('../server/api/admin/pages/index.get') },
    { method: 'post', path: '/api/admin/pages', handler: await load('../server/api/admin/pages/index.post') },
    { method: 'get', path: '/api/admin/pages/:id', handler: await load('../server/api/admin/pages/[id].get') },
    { method: 'get', path: '/api/admin/pages/:id/versions', handler: await load('../server/api/admin/pages/[id]/versions/index.get') },
    { method: 'post', path: '/api/admin/pages/:id/versions', handler: await load('../server/api/admin/pages/[id]/versions/index.post') },
    { method: 'delete', path: '/api/admin/pages/:id/versions/:versionId', handler: await load('../server/api/admin/pages/[id]/versions/[versionId].delete') },
    { method: 'post', path: '/api/admin/pages/:id/versions/:versionId/restore', handler: await load('../server/api/admin/pages/[id]/versions/[versionId]/restore.post') },
    { method: 'put', path: '/api/admin/pages/:id/draft', handler: await load('../server/api/admin/pages/[id]/draft.put') },
  ],
})
after(() => h.server.close())
const { pages, pageBlocks, pageVersions, activityLogs } = h.schema

type Account = Awaited<ReturnType<typeof h.account>>
let editor: Account
let reader: Account
beforeEach(async () => {
  h.reset()
  editor = await h.account([{ resource: 'pages', canRead: true, canCreate: true, canUpdate: true, canDelete: true }], 'trang')
  reader = await h.account([{ resource: 'pages', canRead: true }], 'doctrang')
})

const TREE = [{ id: 'n1', blockType: 'section', isVisible: true, data: {}, children: [{ id: 'n2', blockType: 'richtext', isVisible: true, data: { html: '<p>Cây</p>' } }] }]
const AUDIT = /^insert into `activity_logs`/
const audits = () => h.harness.rows(activityLogs).map(row => ({ userId: row.userId, action: row.action, resource: row.resource, meta: row.meta }))
const versionRows = () => h.harness.rows(pageVersions).map(row => ({ id: row.id, pageId: row.pageId, kind: row.kind, label: row.label }))

async function seedPages() {
  await h.harness.db.insert(pages).values([
    { id: 1, slug: 'home', title: 'Trang chủ', isSystem: true, publishedBlocks: TREE },
    { id: 2, slug: 'gioi-thieu-them', title: 'Giới thiệu thêm', isSystem: false, draftBlocks: [{ blockType: 'richtext', displayOrder: 0, isVisible: true, data: { html: '<p>Nháp</p>' } }], draftUpdatedAt: new Date(Date.UTC(2026, 9, 5)), draftUpdatedBy: 1 },
    { id: 3, slug: 'trang-moi', title: 'Trang mới', isSystem: false },
  ])
  await h.harness.db.insert(pageBlocks).values([
    { id: 11, pageId: 2, blockType: 'richtext', displayOrder: 1, data: { html: '<p>Hai</p>' }, isVisible: true },
    { id: 10, pageId: 2, blockType: 'heading', displayOrder: 0, data: null, isVisible: null },
    { id: 13, pageId: 1, blockType: 'hero', displayOrder: 0, data: { badge: 'x' }, isVisible: true },
  ])
}

// ─── Permissions ─────────────────────────────────────────────────────────────

test('reading takes pages.read; every write takes its own permission — a reader writes nothing', async () => {
  await seedPages()
  await h.harness.db.insert(pageVersions).values({ id: 7, pageId: 1, kind: 'manual', label: 'A', blocks: TREE })
  for (const path of ['/api/admin/pages', '/api/admin/pages/1', '/api/admin/pages/1/versions']) {
    assert.equal((await h.request('GET', path, reader)).status, 200, path)
    assert.equal((await h.request('GET', path, null)).status, 401, path)
  }
  for (const [method, path, body] of [
    ['POST', '/api/admin/pages', { title: 'Mới' }],
    ['POST', '/api/admin/pages/1/versions', { kind: 'manual' }],
    ['DELETE', '/api/admin/pages/1/versions/7', undefined],
    ['POST', '/api/admin/pages/2/versions/7/restore', undefined],
  ] as const) {
    assert.equal((await h.request(method, path, reader, body)).status, 403, `${method} ${path}`)
  }
  assert.deepEqual([h.harness.rows(pages).length, versionRows().length, audits()], [3, 1, []])
})

// ─── Reads ───────────────────────────────────────────────────────────────────

test('the list puts custom pages before system pages, by id, each with its flat block count', async () => {
  await seedPages()
  const response = await h.request('GET', '/api/admin/pages', reader)
  assert.equal(response.status, 200)
  const items = response.body.items as Array<{ id: number, slug: string, blockCount: number }>
  assert.deepEqual(items.map(item => [item.id, item.slug, item.blockCount]), [[2, 'gioi-thieu-them', 2], [3, 'trang-moi', 0], [1, 'home', 1]])
})

test('one page: the live tree when published_blocks holds one, else the flat rows (data null → {}, visible null → true); the draft beside it', async () => {
  await seedPages()
  const tree = await h.request('GET', '/api/admin/pages/1', reader)
  assert.deepEqual([tree.status, tree.body.tree, tree.body.blocks, tree.body.draft], [200, true, TREE, null])

  const flat = await h.request('GET', '/api/admin/pages/2', reader)
  assert.equal(flat.body.tree, false)
  const blocks = flat.body.blocks as Array<{ id: number, data: unknown, isVisible: boolean }>
  assert.deepEqual(blocks.map(block => [block.id, block.data, block.isVisible]), [[10, {}, true], [11, { html: '<p>Hai</p>' }, true]])
  const draft = flat.body.draft as { blocks: unknown[], updatedAt: string }
  assert.deepEqual([draft.blocks.length, draft.updatedAt], [1, '2026-10-05T00:00:00.000Z'])

  const empty = await h.request('GET', '/api/admin/pages/3', reader)
  assert.deepEqual([empty.body.tree, empty.body.blocks, empty.body.draft], [false, [], null])
  assert.deepEqual([(await h.request('GET', '/api/admin/pages/999', reader)).status, (await h.request('GET', '/api/admin/pages/abc', reader)).status], [404, 400])
})

test('the version list is newest first, metadata only, its blocks reduced to a count', async () => {
  await seedPages()
  await h.harness.db.insert(pageVersions).values([
    { id: 1, pageId: 1, kind: 'origin', label: 'Bản gốc', blocks: TREE, createdBy: 11 },
    { id: 2, pageId: 1, kind: 'auto', label: null, blocks: [], createdBy: 11 },
    { id: 3, pageId: 2, kind: 'manual', label: 'Khác', blocks: TREE },
  ])
  const response = await h.request('GET', '/api/admin/pages/1/versions', reader)
  const versions = response.body.versions as Array<Record<string, unknown>>
  assert.deepEqual(versions.map(v => [v.id, v.kind, v.label, v.createdBy, v.blockCount]), [[2, 'auto', null, 11, 0], [1, 'origin', 'Bản gốc', 11, 1]])
  assert.ok(versions.every(v => !('blocks' in v)), 'the heavy blocks JSON stays out of the list')
  assert.equal((await h.request('GET', '/api/admin/pages/x/versions', reader)).status, 400)
})

// ─── Create ──────────────────────────────────────────────────────────────────

test('create: slug from the slug field or the title, made unique; SEO trimmed; one audit row — or nothing at all', async () => {
  await seedPages()
  const first = await h.request('POST', '/api/admin/pages', editor, { title: ' Trang mới ', seoTitle: ' Tiêu đề SEO ', seoDescription: '' })
  assert.deepEqual([first.status, first.body.slug], [200, 'trang-moi-2'])
  const created = h.harness.rows(pages).find(row => row.id === first.body.id)!
  assert.deepEqual([created.title, created.isSystem, created.seoTitle, created.seoDescription, created.updatedBy], ['Trang mới', false, 'Tiêu đề SEO', null, editor.id])
  assert.deepEqual(audits(), [{ userId: editor.id, action: 'create', resource: 'pages', meta: { slug: 'trang-moi-2', title: 'Trang mới' } }])

  const named = await h.request('POST', '/api/admin/pages', editor, { title: 'Khác', slug: 'Giới thiệu thêm' })
  assert.equal(named.body.slug, 'gioi-thieu-them-2')

  for (const body of [{ title: '   ' }, {}]) {
    assert.equal((await h.request('POST', '/api/admin/pages', editor, body)).status, 400)
  }
  h.harness.failNext(AUDIT)
  assert.equal((await h.request('POST', '/api/admin/pages', editor, { title: 'Sẽ rollback' })).status, 500)
  assert.deepEqual([h.harness.rows(pages).length, audits().length], [5, 2], 'a failed audit leaves no page behind')
})

// ─── Versions: save ──────────────────────────────────────────────────────────

test('a manual backup snapshots body → draft → live rows, ids stripped and label trimmed; the fifth is refused inside the transaction', async () => {
  await seedPages()
  assert.equal((await h.request('POST', '/api/admin/pages/2/versions', editor, { kind: 'manual', label: `  ${'x'.repeat(200)}  ` })).status, 200)
  assert.equal((await h.request('POST', '/api/admin/pages/1/versions', editor, { blocks: [{ id: 5, blockType: 'richtext', data: { html: '<p>Thân</p>' } }] })).status, 200)
  await h.harness.db.insert(pageBlocks).values({ id: 20, pageId: 3, blockType: 'richtext', displayOrder: 0, data: { html: '<p>Đã đăng</p>' }, isVisible: true })
  assert.equal((await h.request('POST', '/api/admin/pages/3/versions', editor, {})).status, 200)

  const rows = h.harness.rows(pageVersions)
  assert.deepEqual(rows.map(row => [row.pageId, row.kind, row.label, row.createdBy]), [[2, 'manual', 'x'.repeat(128), editor.id], [1, 'manual', null, editor.id], [3, 'manual', null, editor.id]])
  assert.deepEqual((rows[0]!.blocks as Array<{ data: { html: string } }>).map(b => b.data.html), ['<p>Nháp</p>'], 'the draft, not the live rows')
  assert.ok((rows[1]!.blocks as Array<Record<string, unknown>>).every(b => !('id' in b)), 'ids are stripped')
  assert.deepEqual(rows[2]!.blocks, [{ blockType: 'richtext', displayOrder: 0, data: { html: '<p>Đã đăng</p>' }, isVisible: true }])
  assert.deepEqual(audits().map(a => a.meta), [2, 1, 3].map(pageId => ({ pageId, action: 'version', kind: 'manual' })))

  for (let n = 0; n < 3; n++) await h.harness.db.insert(pageVersions).values({ pageId: 2, kind: 'manual', label: `M${n}`, blocks: [] })
  const refused = await h.request('POST', '/api/admin/pages/2/versions', editor, { kind: 'manual' })
  assert.deepEqual([refused.status, refused.body.statusMessage], [400, 'Đã đạt tối đa 4 bản sao lưu. Vui lòng xóa bớt trước khi lưu mới.'])
  assert.equal(h.harness.rows(pageVersions).filter(row => row.pageId === 2).length, 4)
  assert.equal(audits().length, 3, 'a refused backup is not audited')
  assert.equal((await h.request('POST', '/api/admin/pages/999/versions', editor, {})).status, 404)
})

test('the origin baseline replaces the previous one (default label "Bản gốc"); a failed audit keeps the old baseline', async () => {
  await seedPages()
  await h.harness.db.insert(pageVersions).values({ id: 1, pageId: 1, kind: 'origin', label: 'Cũ', blocks: TREE })
  assert.equal((await h.request('POST', '/api/admin/pages/1/versions', editor, { kind: 'origin' })).status, 200)
  assert.deepEqual(versionRows().map(v => [v.pageId, v.kind, v.label]), [[1, 'origin', 'Bản gốc']])
  assert.deepEqual(audits().map(a => a.meta), [{ pageId: 1, action: 'version', kind: 'origin' }])

  const before = versionRows()
  h.harness.failNext(AUDIT)
  assert.equal((await h.request('POST', '/api/admin/pages/1/versions', editor, { kind: 'origin', label: 'Mới' })).status, 500)
  assert.deepEqual(versionRows(), before, 'the delete-then-insert pair rolled back with the audit row')
})

// ─── Versions: delete / restore ──────────────────────────────────────────────

test('deleting a version: audited with its kind; the origin is a 400, another page\'s version a 404; a failed audit keeps it', async () => {
  await seedPages()
  await h.harness.db.insert(pageVersions).values([
    { id: 1, pageId: 1, kind: 'origin', label: 'Gốc', blocks: TREE },
    { id: 7, pageId: 1, kind: 'manual', label: 'A', blocks: TREE },
    { id: 8, pageId: 1, kind: 'auto', label: null, blocks: TREE },
  ])
  assert.equal((await h.request('DELETE', '/api/admin/pages/1/versions/7', editor)).status, 200)
  assert.deepEqual(audits(), [{ userId: editor.id, action: 'delete', resource: 'pages', meta: { pageId: 1, versionId: 7, kind: 'manual' } }])
  const origin = await h.request('DELETE', '/api/admin/pages/1/versions/1', editor)
  assert.deepEqual([origin.status, origin.body.statusMessage], [400, 'Không thể xóa bản gốc. Hãy chỉ định bản gốc khác để thay thế.'])
  assert.equal((await h.request('DELETE', '/api/admin/pages/2/versions/8', editor)).status, 404)
  assert.equal((await h.request('DELETE', '/api/admin/pages/1/versions/x', editor)).status, 400)

  h.harness.failNext(AUDIT)
  assert.equal((await h.request('DELETE', '/api/admin/pages/1/versions/8', editor)).status, 500)
  assert.deepEqual(versionRows().map(v => v.id), [1, 8])
  assert.equal(audits().length, 1)
})

test('restoring writes the normalised version INTO THE DRAFT (live untouched), audited; a failed audit leaves the draft as it was', async () => {
  await seedPages()
  await h.harness.db.insert(pageVersions).values([
    { id: 8, pageId: 2, kind: 'manual', label: 'A', blocks: [{ blockType: 'richtext', data: { html: '<p>A</p>' } }] },
    { id: 9, pageId: 1, kind: 'auto', label: null, blocks: TREE },
  ])
  const restored = await h.request('POST', '/api/admin/pages/2/versions/8/restore', editor)
  assert.equal(restored.status, 200)
  const page = h.harness.rows(pages).find(row => row.id === 2)!
  assert.deepEqual(page.draftBlocks, restored.body.blocks)
  assert.deepEqual((page.draftBlocks as Array<{ data: { html: string } }>).map(b => b.data.html), ['<p>A</p>'])
  assert.equal(page.draftUpdatedBy, editor.id)
  assert.deepEqual(h.harness.rows(pageBlocks).filter(row => row.pageId === 2).length, 2, 'the live rows are not touched')
  assert.deepEqual(audits(), [{ userId: editor.id, action: 'update', resource: 'pages', meta: { pageId: 2, action: 'restore', versionId: 8, kind: 'manual' } }])
  assert.equal((await h.request('POST', '/api/admin/pages/2/versions/9/restore', editor)).status, 404, 'a version of another page')

  const draftBefore = h.harness.rows(pages).find(row => row.id === 1)!.draftBlocks
  h.harness.failNext(AUDIT)
  assert.equal((await h.request('POST', '/api/admin/pages/1/versions/9/restore', editor)).status, 500)
  assert.deepEqual(h.harness.rows(pages).find(row => row.id === 1)!.draftBlocks, draftBefore)
  assert.equal(audits().length, 1)
})

// ─── Draft ───────────────────────────────────────────────────────────────────

test('the draft: no blocks array clears it (live untouched), an array — even empty — is saved normalised; not audited, not in a transaction', async () => {
  await seedPages()
  const cleared = await h.request('PUT', '/api/admin/pages/2/draft', editor, {})
  assert.deepEqual([cleared.status, cleared.body.cleared, typeof cleared.body.savedAt], [200, true, 'string'])
  const page = h.harness.rows(pages).find(row => row.id === 2)!
  assert.deepEqual([page.draftBlocks, page.draftUpdatedAt, page.draftUpdatedBy], [null, null, null])
  assert.equal(h.harness.rows(pageBlocks).filter(row => row.pageId === 2).length, 2, 'the live rows are not touched')

  const saved = await h.request('PUT', '/api/admin/pages/3/draft', editor, { blocks: [] })
  assert.deepEqual([saved.status, saved.body.cleared], [200, undefined])
  const draft = h.harness.rows(pages).find(row => row.id === 3)!
  assert.deepEqual([draft.draftBlocks, draft.draftUpdatedBy], [[], editor.id])

  assert.equal((await h.request('PUT', '/api/admin/pages/999/draft', editor, {})).status, 404)
  assert.equal((await h.request('PUT', '/api/admin/pages/0/draft', editor, {})).status, 400)
  assert.equal((await h.request('PUT', '/api/admin/pages/3/draft', reader, {})).status, 403)
  assert.deepEqual(audits(), [])
  assert.equal(h.harness.transactionsBegun, 0, 'the draft write runs on the pool, as before')
})
