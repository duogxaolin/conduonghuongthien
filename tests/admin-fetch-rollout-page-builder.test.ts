/**
 * Wave 3 D-FETCH, batch B: the page builder (`pages/admin/content/pages/[id].vue`, 10
 * `$fetch` casts) calls `adminFetch<T>()` with response types derived from the handlers
 * (app/types/admin-pages-api.ts, plus the existing `AdminPageDetail`/`PageVersionRow`/
 * `AdminPageUpdateResult` of app/types/admin-api.ts).
 *
 * The REAL page — `<script setup>` and template — is mounted (tests/_admin-page-harness.ts)
 * over REAL ofetch on a fake network; the canvas, tree and property panel are stand-ins
 * that only carry the page's listeners (they do not fetch), the modals render their slots
 * while open. Pinned, green before and after the conversion:
 *   - the requests of the mount, the debounced draft save, publish, discard, the meta
 *     dialog and the versions drawer — method, path, body — and the reloads after them;
 *   - a version with no `createdAt` (nullable column) reads "—";
 *   - a failure shows the sentence the SERVER wrote, never ofetch's `[GET] "…"` line.
 * No finding: every branch on `res.ok` here is reached only by a 2xx, which these
 * handlers answer with `ok: true` (failures throw).
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import * as Vue from 'vue'

import { byText, click, findAll, fire, input, textOf } from './_sfc-mount.ts'
import {
  alertText, buttons, h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

const PAGE = 'pages/admin/content/pages/[id].vue'

/** A child that renders a marker element carrying the page's props and listeners. */
const passthrough = (name: string) => ({ default: Vue.defineComponent({ name, setup: () => () => Vue.h('div', { 'data-stub': name }) }) })

const DETAIL_PAGE = { id: 5, title: 'Giới thiệu', slug: 'gioi-thieu', isSystem: false, isVisible: true, seoTitle: 'SEO cũ', seoDescription: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: null }
const PUBLISHED = [
  { id: 11, pageId: 5, blockType: 'hero', displayOrder: 1, data: { title: 'Xin chào' }, isVisible: true },
  { id: 12, pageId: 5, blockType: 'richtext', displayOrder: 2, data: { html: '<p>Nội dung</p>' }, isVisible: true },
]
const VERSIONS = [
  { id: 3, kind: 'origin', label: null, blockCount: 2, createdAt: '2026-09-01T03:00:00.000Z', createdBy: 1 },
  { id: 4, kind: 'manual', label: 'Trước Tết', blockCount: 2, createdAt: null, createdBy: 1 },
  { id: 5, kind: 'auto', label: null, blockCount: 1, createdAt: '2026-10-01T03:00:00.000Z', createdBy: 1 },
]

function builderServer(state: { draft: unknown[] | null, page?: Record<string, unknown> }, overrides: Record<string, (call: NetCall) => Response | Error> = {}) {
  return routes({
    'GET /api/admin/pages/5': () => json({
      ok: true, page: state.page ?? DETAIL_PAGE, blocks: PUBLISHED,
      draft: state.draft ? { blocks: state.draft, updatedAt: '2026-10-26T01:00:00.000Z' } : null, tree: false,
    }),
    'PUT /api/admin/pages/5/draft': (call) => {
      const blocks = (call.body as { blocks?: unknown[] }).blocks
      state.draft = blocks ?? null
      return json(blocks ? { ok: true, savedAt: '2026-10-27T01:00:00.000Z' } : { ok: true, cleared: true, savedAt: '2026-10-27T01:00:00.000Z' })
    },
    'POST /api/admin/pages/5/publish': (call) => {
      state.draft = null
      const blocks = (call.body as { blocks: Array<Record<string, unknown>> }).blocks.map((b, i) => ({ ...b, id: b.id ?? 100 + i, pageId: 5 }))
      return json({ ok: true, blocks, tree: false })
    },
    'PUT /api/admin/pages/5': (call) => json({ ok: true, slug: (call.body as { slug?: string }).slug ?? 'gioi-thieu' }),
    'GET /api/admin/pages/5/versions': () => json({ ok: true, versions: VERSIONS }),
    'POST /api/admin/pages/5/versions': () => json({ ok: true }),
    'POST /api/admin/pages/5/versions/4/restore': () => json({ ok: true, blocks: [{ blockType: 'heading', displayOrder: 1, data: { title: 'Bản Tết' }, isVisible: true }] }),
    'DELETE /api/admin/pages/5/versions/4': () => json({ ok: true }),
    ...overrides,
  })
}

const open = (state: { draft: unknown[] | null, page?: Record<string, unknown> } = { draft: null }, overrides?: Record<string, (call: NetCall) => Response | Error>) =>
  mountAdminPage(PAGE, builderServer(state, overrides), {
    route: { params: { id: '5' } },
    modules: {
      '~/components/admin/AdminModal.vue': { default: OpenModal },
      '~/components/admin/builder/BuilderCanvas.vue': passthrough('BuilderCanvas'),
      '~/components/admin/builder/PropertyPanel.vue': passthrough('PropertyPanel'),
      '~/components/admin/builder/BlockTreeNode.vue': passthrough('BlockTreeNode'),
    },
  })

const saveState = (opened: MountedAdminPage) => textOf(findAll(opened.page.root, el => el.tag === 'span' && String(el.props.class).includes('mr-1 flex items-center'))[0]!)
const panel = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props['data-stub'] === 'PropertyPanel')[0]!
const dialog = (opened: MountedAdminPage, title: string) => findAll(opened.page.root, el => el.props.role === 'dialog' && el.props['aria-label'] === title)[0]!
const PUBLISHED_PAYLOAD = [
  { id: 11, blockType: 'hero', displayOrder: 1, data: { title: 'Xin chào' }, isVisible: true },
  { id: 12, blockType: 'richtext', displayOrder: 2, data: { html: '<p>Nội dung</p>' }, isVisible: true },
]

function assertOnlyServerSentences(opened: MountedAdminPage) {
  for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
}

describe('pages/admin/content/pages/[id].vue', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
  afterEach(() => { unmountAll(); mock.timers.reset() })

  it('mount: one GET of the page; the published blocks are the working copy, nothing to publish', async () => {
    const opened = await open()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/pages/5'])
    assert.equal(textOf(findAll(opened.page.root, el => el.tag === 'h1')[0]!), 'Giới thiệu')
    assert.equal(saveState(opened), 'Đã xuất bản')
    assert.equal(buttons(opened.page, 'Hủy sửa').length, 0)
    opened.page.unmount()
  })

  it('a server draft becomes the working copy ("Nháp — chưa xuất bản", "Hủy sửa" offered)', async () => {
    const opened = await open({ draft: [{ id: 11, blockType: 'hero', displayOrder: 1, data: { title: 'Bản nháp' }, isVisible: true }] })
    assert.equal(saveState(opened), 'Nháp — chưa xuất bản')
    assert.equal(buttons(opened.page, 'Hủy sửa').length, 1)
    opened.page.unmount()
  })

  it('an edit is saved as a draft 800 ms later: PUT /draft with the whole serialized tree', async () => {
    const opened = await open()
    const before = opened.calls.length
    // The panel emits the selected block (the first node), which it received as `block`.
    await fire(panel(opened), 'toggleVisible', panel(opened).props.block)
    await settle()
    assert.equal(opened.calls.length, before, 'nothing is sent before the debounce')
    mock.timers.tick(800)
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{
      wire: 'PUT /api/admin/pages/5/draft',
      body: { blocks: [{ ...PUBLISHED_PAYLOAD[0], isVisible: false }, PUBLISHED_PAYLOAD[1]] },
    }])
    assert.equal(saveState(opened), 'Nháp — chưa xuất bản')
    opened.page.unmount()
  })

  it('a refused draft save shows the server\'s sentence and "Lỗi lưu nháp"', async () => {
    const opened = await open({ draft: null }, { 'PUT /api/admin/pages/5/draft': () => h3Error(403, 'Bạn không có quyền sửa trang này.') })
    await fire(panel(opened), 'toggleVisible', panel(opened).props.block)
    mock.timers.tick(800)
    await settle()
    assert.equal(opened.lastToast('error'), 'Bạn không có quyền sửa trang này.')
    assert.equal(saveState(opened), 'Lỗi lưu nháp')
    assertOnlyServerSentences(opened)
    opened.page.unmount()
  })

  it('publish: POST /publish with the working copy; the answer becomes the live baseline', async () => {
    const opened = await open({ draft: [{ blockType: 'heading', displayOrder: 1, data: { title: 'Mới' }, isVisible: true }] })
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Xuất bản'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{
      wire: 'POST /api/admin/pages/5/publish',
      body: { blocks: [{ blockType: 'heading', displayOrder: 1, data: { title: 'Mới' }, isVisible: true }] },
    }])
    assert.equal(opened.lastToast('success'), 'Đã xuất bản lên site.')
    assert.equal(saveState(opened), 'Đã xuất bản')
    mock.timers.tick(800)
    await settle()
    assert.equal(opened.calls.length, before + 1, 'publishing is not followed by a draft save')
    opened.page.unmount()
  })

  it('publish refused shows the server\'s sentence', async () => {
    const opened = await open({ draft: [{ blockType: 'heading', displayOrder: 1, data: {}, isVisible: true }] }, {
      'POST /api/admin/pages/5/publish': () => h3Error(400, 'Khối không hợp lệ ở vị trí 1.'),
    })
    await click(byText(opened.page.root, 'button', 'Xuất bản'))
    await settle()
    assert.equal(opened.lastToast('error'), 'Khối không hợp lệ ở vị trí 1.')
    assertOnlyServerSentences(opened)
    opened.page.unmount()
  })

  it('discard: confirms, PUT /draft {} clears the draft, then reloads the page', async () => {
    const opened = await open({ draft: [{ blockType: 'heading', displayOrder: 1, data: {}, isVisible: true }] })
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Hủy sửa'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'PUT /api/admin/pages/5/draft', body: {} }, 'GET /api/admin/pages/5'])
    assert.equal(saveState(opened), 'Đã xuất bản')
    assert.equal(opened.lastToast('success'), 'Đã quay lại bản đang chạy.')
    opened.page.unmount()
  })

  it('meta dialog: PUT title/SEO/slug, then the header shows the slug the SERVER answered', async () => {
    const opened = await open({ draft: null }, { 'PUT /api/admin/pages/5': () => json({ ok: true, slug: 'gioi-thieu-c11' }) })
    await click(byText(opened.page.root, 'button', 'Cấu hình'))
    await settle()
    const fields = findAll(dialog(opened, 'Cấu hình trang'), el => el.tag === 'input')
    await input(fields[0]!, 'Giới thiệu C11')
    await input(fields[1]!, 'Giới thiệu C11!')
    await settle()
    const before = opened.calls.length
    await click(byText(dialog(opened, 'Cấu hình trang'), 'button', 'Lưu'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{
      wire: 'PUT /api/admin/pages/5',
      body: { title: 'Giới thiệu C11', seoTitle: 'SEO cũ', seoDescription: '', slug: 'Giới thiệu C11!' },
    }])
    assert.equal(textOf(findAll(opened.page.root, el => el.tag === 'code')[0]!), '/gioi-thieu-c11')
    assert.equal(textOf(findAll(opened.page.root, el => el.tag === 'h1')[0]!), 'Giới thiệu C11')
    opened.page.unmount()
  })

  it('meta dialog on a system page never sends a slug', async () => {
    const opened = await open({ draft: null, page: { ...DETAIL_PAGE, slug: 'home', isSystem: true } })
    await click(byText(opened.page.root, 'button', 'Cấu hình'))
    await settle()
    const before = opened.calls.length
    await click(byText(dialog(opened, 'Cấu hình trang'), 'button', 'Lưu'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'PUT /api/admin/pages/5', body: { title: 'Giới thiệu', seoTitle: 'SEO cũ', seoDescription: '' } }])
    opened.page.unmount()
  })

  it('versions drawer: lists the versions; a NULL createdAt reads "—"', async () => {
    const opened = await open()
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Phiên bản'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/pages/5/versions'])
    const rows = findAll(dialog(opened, 'Phiên bản'), el => el.tag === 'p' && String(el.props.class).includes('text-gray-400') && textOf(el).includes('block'))
      .map(textOf)
    const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
    assert.deepEqual(rows, [
      `Bản gốc · 2 block · ${when('2026-09-01T03:00:00.000Z')}`,
      'Bản sao lưu · 2 block · —',
      `Tự động · 1 block · ${when('2026-10-01T03:00:00.000Z')}`,
    ])
    assert.match(textOf(byText(dialog(opened, 'Phiên bản'), 'button', 'Lưu (')), /Lưu \(1\/4\)/)
    opened.page.unmount()
  })

  it('versions: restore loads the version into the draft; delete re-reads the list; backup and origin post the working copy', async () => {
    const opened = await open()
    await click(byText(opened.page.root, 'button', 'Phiên bản'))
    await settle()
    const card = (label: string) => findAll(dialog(opened, 'Phiên bản'), el => el.tag === 'div' && String(el.props.class).startsWith('mb-2 rounded-lg') && textOf(el).includes(label))[0]!

    let before = opened.calls.length
    await click(byText(card('Trước Tết'), 'button', 'Khôi phục'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['POST /api/admin/pages/5/versions/4/restore'])
    assert.equal(opened.lastToast('success'), 'Đã nạp vào bản nháp. Xem trước rồi bấm Xuất bản.')
    assert.equal(saveState(opened), 'Nháp — chưa xuất bản')

    await click(byText(opened.page.root, 'button', 'Phiên bản'))
    await settle()
    before = opened.calls.length
    await click(findAll(card('Trước Tết'), el => el.tag === 'button' && el.props['aria-label'] === 'Xóa phiên bản Trước Tết')[0]!)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['DELETE /api/admin/pages/5/versions/4', 'GET /api/admin/pages/5/versions'])

    await input(findAll(dialog(opened, 'Phiên bản'), el => el.tag === 'input')[0]!, 'Bản thử')
    await settle()
    before = opened.calls.length
    await click(byText(dialog(opened, 'Phiên bản'), 'button', 'Lưu ('))
    await settle()
    const draft = [{ blockType: 'heading', displayOrder: 1, data: { title: 'Bản Tết' }, isVisible: true }]
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'POST /api/admin/pages/5/versions', body: { kind: 'manual', label: 'Bản thử', blocks: draft } },
      'GET /api/admin/pages/5/versions',
    ])

    before = opened.calls.length
    await click(byText(dialog(opened, 'Phiên bản'), 'button', 'Cập nhật bản gốc'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'POST /api/admin/pages/5/versions', body: { kind: 'origin', blocks: draft } },
      'GET /api/admin/pages/5/versions',
    ])
    assert.equal(opened.lastToast('success'), 'Đã chỉ định bản gốc.')
    opened.page.unmount()
  })

  it('a backup refused at the cap shows the server\'s sentence', async () => {
    const opened = await open({ draft: null }, { 'POST /api/admin/pages/5/versions': () => h3Error(409, 'Đã đủ 4 bản sao lưu — xoá bớt một bản.') })
    await click(byText(opened.page.root, 'button', 'Phiên bản'))
    await settle()
    await click(byText(dialog(opened, 'Phiên bản'), 'button', 'Lưu ('))
    await settle()
    assert.equal(opened.lastToast('error'), 'Đã đủ 4 bản sao lưu — xoá bớt một bản.')
    assertOnlyServerSentences(opened)
    opened.page.unmount()
  })

  it('a failed load shows the server\'s sentence in the alert; "Thử lại" loads again', async () => {
    let fail = true
    const state = { draft: null }
    const server = builderServer(state)
    const opened = await mountAdminPage(PAGE, call => (fail && wire(call) === 'GET /api/admin/pages/5' ? h3Error(404, 'Không tìm thấy trang.') : server(call)), {
      route: { params: { id: '5' } },
      modules: {
        '~/components/admin/AdminModal.vue': { default: OpenModal },
        '~/components/admin/builder/BuilderCanvas.vue': passthrough('BuilderCanvas'),
        '~/components/admin/builder/PropertyPanel.vue': passthrough('PropertyPanel'),
        '~/components/admin/builder/BlockTreeNode.vue': passthrough('BlockTreeNode'),
      },
    })
    assert.match(alertText(opened.page), /Không tìm thấy trang\./)
    assertOnlyServerSentences(opened)
    fail = false
    await click(byText(findAll(opened.page.root, el => el.props.role === 'alert')[0]!, 'button', 'Thử lại'))
    await settle()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/pages/5', 'GET /api/admin/pages/5'])
    assert.equal(alertText(opened.page), '')
    opened.page.unmount()
  })
})
