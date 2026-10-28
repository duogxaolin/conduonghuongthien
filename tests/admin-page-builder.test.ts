/**
 * The page builder (`app/pages/admin/content/pages/[id].vue`) — behaviour, written BEFORE the
 * wave3 4.2 split and run on both versions (`PAGE_BUILDER_FILE=<original>`).
 *
 * The real page and the real tree navigator are mounted (tests/_page-builder-harness.ts) and
 * driven through the controls an officer uses: the top bar, the tree's "+", the block palette,
 * the property panel's action bar, the meta dialog and the versions drawer. Checked: what is
 * sent (method, path, the serialized tree), when (the 800 ms draft debounce; never while the
 * page is loading a copy from the server), what the screen says meanwhile, toasts, prompts.
 *
 * Sanitising is NOT the page's job: the working copy — rich-text HTML included — goes to the
 * server verbatim, and `sanitizeBlockData` filters it there (tests/security-block-link-schemes
 * .test.ts, tests/security-translation-html.test.ts). The page renders no block HTML itself.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { DEFAULT_COL_SPAN, getDefaultData } from '../shared/blocks/registry.ts'
import { click, fire, input, type MiniElement } from './_sfc-mount.ts'
import {
  alerts, builderServer, button, buttonsWith, byTitle, canvas, closeX, dialog, dialogs, draftBodies, findAll, h3Error, HOLD, lastToast,
  OFETCH_LINE, openBuilder, mountBuilder, panel, saveState, sent, textOf, treeRow, treeRows, wire,
  type BuilderCtx, type NetCall,
} from './_page-builder-harness.ts'

const tap = (el: MiniElement) => { void click(el) }
const isDisabled = (el: MiniElement) => el.props.disabled === true || el.props.disabled === ''
const DEBOUNCE = 800
const API = '/api/admin/pages/5'

/** The published tree as the page serializes it (`displayOrder` per level, columns keep `colSpan`). */
const PUBLISHED = () => [
  { id: 11, blockType: 'hero', displayOrder: 1, data: { title: 'Xin chào' }, isVisible: true },
  { id: 12, blockType: 'row', displayOrder: 2, data: {}, isVisible: true, children: [
    { id: 13, blockType: 'column', displayOrder: 1, data: {}, isVisible: true, colSpan: 6, children: [
      { id: 14, blockType: 'richtext', displayOrder: 1, data: { html: '<p>Nội dung <b>đậm</b></p>' }, isVisible: true },
    ] },
    { id: 15, blockType: 'column', displayOrder: 2, data: {}, isVisible: true, colSpan: 6, children: [] },
  ] },
  { id: 16, blockType: 'heading', displayOrder: 3, data: { title: 'Liên hệ' }, isVisible: true },
]
const TREE = [
  '*Banner Hero · Xin chào',
  'Row (Hàng lưới) · —',
  '  Column (Cột) · —',
  '    Nội dung văn bản · Nội dung đậm',
  '  Column (Cột) · —',
  'Tiêu đề · Liên hệ',
]

async function debounce(ctx: BuilderCtx) {
  mock.timers.tick(DEBOUNCE)
  await ctx.settle()
}
const plus = (ctx: BuilderCtx, label: string) => findAll(treeRow(ctx.page, label), el => el.tag === 'button')[0]!
const paletteItem = (ctx: BuilderCtx, label: string) => findAll(dialog(ctx.page, 'Thêm khối'), el => el.tag === 'button' && textOf(el) === label)[0]!
const paletteGroups = (ctx: BuilderCtx) => findAll(dialog(ctx.page, 'Thêm khối'), el => el.tag === 'h3').map(textOf)
const paletteContext = (ctx: BuilderCtx) => textOf(findAll(dialog(ctx.page, 'Thêm khối'), el => el.tag === 'p')[0]!)

function assertOnlyServerSentences(ctx: BuilderCtx) {
  for (const t of ctx.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  for (const a of alerts(ctx.page)) assert.doesNotMatch(textOf(a), OFETCH_LINE)
}

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
afterEach(() => mock.timers.reset())

describe('page builder — loading, empty, error', () => {
  it('the three-pane placeholder while the page loads, announced busy; then the tree, the canvas and the panel on the first block', async (t) => {
    const server = builderServer()
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === `GET ${API}` && !held.length ? (held.push(call), HOLD) : undefined)
    const ctx = await mountBuilder(t, server)
    await ctx.settle()
    const placeholder = findAll(ctx.page.root, el => el.props.role === 'status' && el.props['aria-busy'] === 'true')
    assert.equal(placeholder.length, 1)
    assert.match(textOf(placeholder[0]!), /^Đang tải trình dựng trang$/)
    assert.equal(textOf(findAll(ctx.page.root, el => el.tag === 'h1')[0]!), 'Trình dựng trang')
    assert.equal(treeRows(ctx.page).length, 0)
    server.answer(held[0]!)
    await ctx.settle()
    assert.equal(findAll(ctx.page.root, el => el.props['aria-busy'] === 'true').length, 0)
    assert.deepEqual(treeRows(ctx.page), TREE)
    assert.equal(textOf(findAll(ctx.page.root, el => el.tag === 'h1')[0]!), 'Giới thiệu')
    assert.equal(textOf(findAll(ctx.page.root, el => el.tag === 'code')[0]!), '/gioi-thieu')
    assert.equal(saveState(ctx.page), 'Đã xuất bản')
    assert.equal(buttonsWith(ctx.page, 'Hủy sửa').length, 0)
    assert.ok(isDisabled(button(ctx.page, 'Xuất bản')), 'nothing to publish')
    assert.deepEqual([panel(ctx.page).props['data-block'], panel(ctx.page).props['data-index'], panel(ctx.page).props['data-total']], ['11', 0, 3])
    assert.deepEqual([canvas(ctx.page).props['data-count'], canvas(ctx.page).props['data-selected'], canvas(ctx.page).props['data-viewport'], canvas(ctx.page).props['data-preview']], [3, '11', 'desktop', '/gioi-thieu'])
    const view = findAll(ctx.page.root, el => el.tag === 'nuxt-link' && textOf(el).includes('Xem trang'))[0]!
    assert.deepEqual([view.props.to, view.props.target], ['/gioi-thieu', '_blank'])
    await debounce(ctx)
    assert.deepEqual(ctx.calls.map(wire), [`GET ${API}`], 'loading the page saves nothing')
  })

  it('a failed load: the server\'s sentence in role="alert", no workspace; "Thử lại" loads again', async (t) => {
    const server = builderServer()
    let fail = true
    server.state.override = call => (fail && wire(call) === `GET ${API}` ? h3Error(404, 'Trang không tồn tại.') : undefined)
    const ctx = await openBuilder(t, server)
    assert.equal(alerts(ctx.page).length, 1)
    assert.match(textOf(alerts(ctx.page)[0]!), /Trang không tồn tại\./)
    assert.equal(treeRows(ctx.page).length, 0)
    assertOnlyServerSentences(ctx)
    fail = false
    await click(button(alerts(ctx.page)[0]!, 'Thử lại'))
    await ctx.settle()
    assert.deepEqual(ctx.calls.map(wire), [`GET ${API}`, `GET ${API}`])
    assert.equal(alerts(ctx.page).length, 0)
    assert.deepEqual(treeRows(ctx.page), TREE)
    await debounce(ctx)
    assert.equal(ctx.calls.length, 2, 'the reload saves nothing either')
  })

  it('a dropped connection: the page\'s own sentence', async (t) => {
    const server = builderServer()
    server.state.override = call => (wire(call) === `GET ${API}` ? new TypeError('fetch failed') : undefined)
    const ctx = await openBuilder(t, server)
    assert.match(textOf(alerts(ctx.page)[0]!), /^Không tải được trang\./)
    assertOnlyServerSentences(ctx)
  })

  it('an empty page: "Chưa có khối nào.", the panel asks for a block, the canvas has none', async (t) => {
    const server = builderServer()
    server.state.published = []
    const ctx = await openBuilder(t, server)
    assert.equal(findAll(ctx.page.root, el => el.tag === 'p' && textOf(el) === 'Chưa có khối nào.').length, 1)
    assert.equal(textOf(panel(ctx.page)), 'Chọn một block')
    assert.equal(canvas(ctx.page).props['data-count'], 0)
  })

  it('a server draft is the working copy: "Nháp — chưa xuất bản", "Hủy sửa" offered, publish enabled — and nothing is saved on load', async (t) => {
    const server = builderServer()
    server.state.draft = [{ id: 11, blockType: 'hero', displayOrder: 1, data: { title: 'Bản nháp' }, isVisible: true }]
    const ctx = await openBuilder(t, server)
    assert.deepEqual(treeRows(ctx.page), ['*Banner Hero · Bản nháp'])
    assert.equal(saveState(ctx.page), 'Nháp — chưa xuất bản')
    assert.equal(buttonsWith(ctx.page, 'Hủy sửa').length, 1)
    assert.ok(!isDisabled(button(ctx.page, 'Xuất bản')))
    await debounce(ctx)
    assert.deepEqual(ctx.calls.map(wire), [`GET ${API}`])
  })

  it('the home page (system): "/" everywhere, the lock badge', async (t) => {
    const server = builderServer()
    server.state.page = { ...server.state.page, slug: 'home', isSystem: true }
    const ctx = await openBuilder(t, server)
    assert.equal(textOf(findAll(ctx.page.root, el => el.tag === 'code')[0]!), '/')
    assert.match(textOf(findAll(ctx.page.root, el => el.tag === 'p' && textOf(el).includes('Trang hệ thống'))[0]!), /Trang hệ thống/)
    assert.equal(findAll(ctx.page.root, el => el.tag === 'nuxt-link' && textOf(el).includes('Xem trang'))[0]!.props.to, '/')
    assert.equal(canvas(ctx.page).props['data-preview'], '/')
  })
})

describe('page builder — selecting', () => {
  it('a tree row selects its node: highlighted, the panel on it (index among its own siblings), the canvas told', async (t) => {
    const ctx = await openBuilder(t)
    await fire(treeRow(ctx.page, 'Nội dung văn bản'), 'click')
    await ctx.settle()
    assert.deepEqual(treeRows(ctx.page), TREE.map(r => r.replace('*', '')).map(r => (r.includes('Nội dung văn bản') ? r.replace('Nội dung', '*Nội dung') : r)))
    assert.deepEqual([panel(ctx.page).props['data-block'], panel(ctx.page).props['data-index'], panel(ctx.page).props['data-total']], ['14', 0, 1])
    assert.equal(canvas(ctx.page).props['data-selected'], '14')
    await fire(treeRow(ctx.page, 'Tiêu đề'), 'click')
    await ctx.settle()
    assert.deepEqual([panel(ctx.page).props['data-block'], panel(ctx.page).props['data-index'], panel(ctx.page).props['data-total']], ['16', 2, 3])
  })

  it('the canvas selects too, and switches the viewport', async (t) => {
    const ctx = await openBuilder(t)
    await click(findAll(canvas(ctx.page), el => el.props['data-canvas-select'] === '12')[0]!)
    await ctx.settle()
    assert.equal(panel(ctx.page).props['data-block'], '12')
    await click(findAll(canvas(ctx.page), el => el.props['data-viewport-button'] === 'mobile')[0]!)
    await ctx.settle()
    assert.equal(canvas(ctx.page).props['data-viewport'], 'mobile')
    await debounce(ctx)
    assert.equal(ctx.calls.length, 1, 'selecting and the viewport are not edits')
  })
})

describe('page builder — adding blocks', () => {
  it('"Thêm khối": the drawer offers layout (no Column), home sections and content; a block lands after the selected root block, selected; a draft 800 ms later', async (t) => {
    const ctx = await openBuilder(t)
    await click(button(ctx.page, 'Thêm khối'))
    await ctx.settle()
    const drawer = dialog(ctx.page, 'Thêm khối')
    assert.equal(drawer.props['data-size'], 'drawer')
    assert.equal(paletteContext(ctx), 'Thêm vào cấp gốc của trang.')
    assert.deepEqual(paletteGroups(ctx), ['Bố cục', 'Khối trang chủ', 'Khối nội dung'])
    assert.deepEqual(findAll(drawer, el => el.tag === 'button' && el.props['aria-label'] !== 'Đóng').slice(0, 2).map(textOf), ['Section (Dải nội dung)', 'Row (Hàng lưới)'])
    assert.equal(findAll(drawer, el => el.tag === 'button' && textOf(el) === 'Column (Cột)').length, 0)
    await click(paletteItem(ctx, 'Tiêu đề'))
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0)
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã thêm block. Nhớ bấm Xuất bản để đưa lên site.')
    assert.deepEqual(treeRows(ctx.page).slice(0, 2), ['Banner Hero · Xin chào', '*Tiêu đề · Tiêu đề mục'])
    assert.equal(saveState(ctx.page), 'Đang lưu nháp…')
    assert.equal(draftBodies(ctx.calls).length, 0)
    await debounce(ctx)
    const [hero, ...rest] = PUBLISHED()
    assert.deepEqual(draftBodies(ctx.calls), [[hero, { blockType: 'heading', displayOrder: 2, data: getDefaultData('heading'), isVisible: true }, ...rest.map(b => ({ ...b, displayOrder: b.displayOrder + 1 }))]])
    assert.equal(saveState(ctx.page), 'Nháp — chưa xuất bản')
    assert.ok(!isDisabled(button(ctx.page, 'Xuất bản')))
  })

  it('with a nested block selected, a root add is appended at the end of the page', async (t) => {
    const ctx = await openBuilder(t)
    await fire(treeRow(ctx.page, 'Nội dung văn bản'), 'click')
    await click(button(ctx.page, 'Thêm khối'))
    await ctx.settle()
    await click(paletteItem(ctx, 'Hình ảnh'))
    await ctx.settle()
    assert.match(treeRows(ctx.page).at(-1)!, /^\*Hình ảnh · /)
  })

  it('the "+" of a Row offers Column only; the column joins the row with the default width and no children yet', async (t) => {
    const ctx = await openBuilder(t)
    assert.equal(plus(ctx, 'Row (Hàng lưới)').props.title, 'Thêm Cột vào Row')
    await click(plus(ctx, 'Row (Hàng lưới)'))
    await ctx.settle()
    assert.equal(paletteContext(ctx), 'Thêm Cột vào Row (Hàng lưới).')
    assert.deepEqual(paletteGroups(ctx), ['Bố cục'])
    assert.deepEqual(findAll(dialog(ctx.page, 'Thêm khối'), el => el.tag === 'button' && el.props['aria-label'] !== 'Đóng').map(textOf), ['Column (Cột)'])
    await click(paletteItem(ctx, 'Column (Cột)'))
    await ctx.settle()
    await debounce(ctx)
    const row = (draftBodies(ctx.calls)[0] as Array<{ children?: unknown[] }>)[1]!
    assert.deepEqual(row.children!.at(-1), { blockType: 'column', displayOrder: 3, data: getDefaultData('column'), isVisible: true, colSpan: DEFAULT_COL_SPAN, children: [] })
    assert.equal(panel(ctx.page).props['data-index'], 2)
  })

  it('the "+" of a Column offers content then home sections, no layout; the block goes inside the column', async (t) => {
    const ctx = await openBuilder(t)
    const emptyColumn = findAll(ctx.page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('group mb-1 flex cursor-pointer'))[4]!
    await click(findAll(emptyColumn, el => el.tag === 'button')[0]!)
    await ctx.settle()
    assert.equal(paletteContext(ctx), 'Thêm nội dung vào Column (Cột).')
    assert.deepEqual(paletteGroups(ctx), ['Khối nội dung', 'Khối trang chủ'])
    await click(paletteItem(ctx, 'Nội dung văn bản'))
    await ctx.settle()
    await debounce(ctx)
    const row = (draftBodies(ctx.calls)[0] as Array<{ children?: Array<{ children?: unknown[] }> }>)[1]!
    assert.deepEqual(row.children![1]!.children, [{ blockType: 'richtext', displayOrder: 1, data: getDefaultData('richtext'), isVisible: true }])
  })

  it('a Section takes rows and sections again; ✕ closes the drawer, and the next "Thêm khối" is back at the root', async (t) => {
    const ctx = await openBuilder(t)
    await click(button(ctx.page, 'Thêm khối'))
    await ctx.settle()
    await click(paletteItem(ctx, 'Section (Dải nội dung)'))
    await ctx.settle()
    await click(plus(ctx, 'Section (Dải nội dung)'))
    await ctx.settle()
    assert.equal(paletteContext(ctx), 'Thêm vào Section (Dải nội dung).')
    assert.deepEqual(paletteGroups(ctx), ['Bố cục', 'Khối trang chủ', 'Khối nội dung'])
    await click(closeX(dialog(ctx.page, 'Thêm khối')))
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0)
    await click(button(ctx.page, 'Thêm khối'))
    await ctx.settle()
    assert.equal(paletteContext(ctx), 'Thêm vào cấp gốc của trang.')
  })
})

describe('page builder — editing', () => {
  it('"Nhân đôi" deep-copies the block and its subtree right after it, new (unsaved) ids, selected', async (t) => {
    const ctx = await openBuilder(t)
    await fire(treeRow(ctx.page, 'Row (Hàng lưới)'), 'click')
    await click(byTitle(panel(ctx.page), 'Nhân đôi')[0]!)
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã nhân đôi block.')
    assert.equal(treeRows(ctx.page).filter(r => r.includes('Row (Hàng lưới)')).length, 2)
    assert.equal(treeRows(ctx.page)[5], '*Row (Hàng lưới) · —')
    await debounce(ctx)
    const body = draftBodies(ctx.calls)[0] as unknown[]
    const [hero, row, heading] = PUBLISHED()
    const strip = (n: Record<string, unknown>): Record<string, unknown> => {
      const { id: _id, ...rest } = n
      return { ...rest, ...(Array.isArray(n.children) ? { children: (n.children as Array<Record<string, unknown>>).map(strip) } : {}) }
    }
    assert.deepEqual(body, [hero, row, { ...strip(row!), displayOrder: 3 }, { ...heading, displayOrder: 4 }])
  })

  it('"Ẩn block" dims the tree row and saves isVisible false; the panel then offers "Hiện block"', async (t) => {
    const ctx = await openBuilder(t)
    await click(byTitle(panel(ctx.page), 'Ẩn block')[0]!)
    await ctx.settle()
    assert.match(String(treeRow(ctx.page, 'Banner Hero').props.class), /opacity-50/)
    assert.equal(byTitle(panel(ctx.page), 'Hiện block').length, 1)
    await debounce(ctx)
    const [hero, ...rest] = PUBLISHED()
    assert.deepEqual(draftBodies(ctx.calls), [[{ ...hero, isVisible: false }, ...rest]])
  })

  it('a field edited in the panel is saved by itself (the working copy is watched deeply); rapid edits make one save', async (t) => {
    const ctx = await openBuilder(t)
    const box = () => findAll(panel(ctx.page), el => el.tag === 'input')[0]!
    for (const text of ['X', 'Xi', 'Xin chào C11']) {
      await fire(box(), 'input', { target: { value: text } })
      await ctx.settle()
      mock.timers.tick(DEBOUNCE - 100)
    }
    assert.equal(draftBodies(ctx.calls).length, 0, 'still typing')
    await debounce(ctx)
    const [hero, ...rest] = PUBLISHED()
    assert.deepEqual(draftBodies(ctx.calls), [[{ ...hero, data: { title: 'Xin chào C11' } }, ...rest]])
  })

  it('"Xóa block" asks with the block\'s name; "Hủy" changes nothing; confirmed: removed, the next sibling selected, toast, a draft', async (t) => {
    const ctx = await openBuilder(t)
    ctx.answers.confirm = false
    await click(byTitle(panel(ctx.page), 'Xóa block')[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.confirms.at(-1), { title: 'Xóa block', message: 'Xóa block "Banner Hero"?', danger: true, confirmLabel: 'Xóa' })
    assert.deepEqual(treeRows(ctx.page), TREE)
    await debounce(ctx)
    assert.equal(draftBodies(ctx.calls).length, 0)
    ctx.answers.confirm = true
    await click(byTitle(panel(ctx.page), 'Xóa block')[0]!)
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã xóa block khỏi bản nháp.')
    assert.equal(treeRows(ctx.page)[0], '*Row (Hàng lưới) · —')
    await debounce(ctx)
    const [, row, heading] = PUBLISHED()
    assert.deepEqual(draftBodies(ctx.calls), [[{ ...row, displayOrder: 1 }, { ...heading, displayOrder: 2 }]])
  })

  it('deleting the only child selects its parent; deleting the last of several selects the one before', async (t) => {
    const ctx = await openBuilder(t)
    await fire(treeRow(ctx.page, 'Nội dung văn bản'), 'click')
    await click(byTitle(panel(ctx.page), 'Xóa block')[0]!)
    await ctx.settle()
    assert.equal(panel(ctx.page).props['data-block'], '13')
    await fire(treeRow(ctx.page, 'Tiêu đề'), 'click')
    await click(byTitle(panel(ctx.page), 'Xóa block')[0]!)
    await ctx.settle()
    assert.equal(panel(ctx.page).props['data-block'], '12')
  })

  it('▲/▼ move a block among its own siblings (nesting kept); the ends are disabled', async (t) => {
    const ctx = await openBuilder(t)
    assert.ok(isDisabled(byTitle(panel(ctx.page), 'Di chuyển lên')[0]!))
    await fire(treeRow(ctx.page, 'Tiêu đề'), 'click')
    await ctx.settle()
    assert.ok(isDisabled(byTitle(panel(ctx.page), 'Di chuyển xuống')[0]!))
    await click(byTitle(panel(ctx.page), 'Di chuyển lên')[0]!)
    await ctx.settle()
    assert.equal(panel(ctx.page).props['data-index'], 1)
    assert.deepEqual(treeRows(ctx.page).filter(r => !r.startsWith(' ')), ['Banner Hero · Xin chào', '*Tiêu đề · Liên hệ', 'Row (Hàng lưới) · —'])
    await debounce(ctx)
    const [hero, row, heading] = PUBLISHED()
    assert.deepEqual(draftBodies(ctx.calls), [[hero, { ...heading, displayOrder: 2 }, { ...row, displayOrder: 3 }]])
    // A nested column moves within its row only.
    const second = findAll(ctx.page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('group mb-1 flex cursor-pointer'))[5]!
    await fire(second, 'click')
    await click(byTitle(panel(ctx.page), 'Di chuyển lên')[0]!)
    await ctx.settle()
    await debounce(ctx)
    const last = draftBodies(ctx.calls).at(-1) as Array<{ blockType: string, children?: Array<{ id: number }> }>
    assert.deepEqual(last.find(b => b.blockType === 'row')!.children!.map(c => c.id), [15, 13])
  })

  it('a refused draft save: "Lỗi lưu nháp" and the server\'s sentence; the next edit saves again', async (t) => {
    const server = builderServer()
    let refuse = true
    server.state.override = call => (refuse && wire(call) === `PUT ${API}/draft` ? h3Error(403, 'Bạn không có quyền sửa trang này.') : undefined)
    const ctx = await openBuilder(t, server)
    await click(byTitle(panel(ctx.page), 'Ẩn block')[0]!)
    await debounce(ctx)
    assert.equal(saveState(ctx.page), 'Lỗi lưu nháp')
    assert.equal(lastToast(ctx.toasts, 'error'), 'Bạn không có quyền sửa trang này.')
    assertOnlyServerSentences(ctx)
    refuse = false
    await click(byTitle(panel(ctx.page), 'Hiện block')[0]!)
    await ctx.settle()
    assert.equal(saveState(ctx.page), 'Đang lưu nháp…')
    await debounce(ctx)
    assert.equal(saveState(ctx.page), 'Đã xuất bản', 'back to the live content')
    assert.equal(draftBodies(ctx.calls).length, 2)
  })
})

describe('page builder — publish and discard', () => {
  it('publish: disabled "Đang xuất bản…" while out; a pending draft save is dropped; new blocks get their ids; "Đã xuất bản"; nothing saved after', async (t) => {
    const server = builderServer()
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === `POST ${API}/publish` ? (held.push(call), HOLD) : undefined)
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Thêm khối'))
    await ctx.settle()
    await click(paletteItem(ctx, 'Tiêu đề'))
    await ctx.settle()
    assert.equal(saveState(ctx.page), 'Đang lưu nháp…')
    tap(button(ctx.page, 'Xuất bản'))
    await ctx.settle()
    const busy = button(ctx.page, 'Đang xuất bản…')
    assert.ok(isDisabled(busy))
    assert.equal(saveState(ctx.page), 'Đang xuất bản…')
    const [hero, ...rest] = PUBLISHED()
    assert.deepEqual((held[0]!.body as { blocks: unknown }).blocks, [hero, { blockType: 'heading', displayOrder: 2, data: getDefaultData('heading'), isVisible: true }, ...rest.map(b => ({ ...b, displayOrder: b.displayOrder + 1 }))])
    server.answer(held[0]!)
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã xuất bản lên site.')
    assert.equal(saveState(ctx.page), 'Đã xuất bản')
    assert.ok(isDisabled(button(ctx.page, 'Xuất bản')))
    assert.equal(panel(ctx.page).props['data-block'], '11', 'the selection fell back to the first block: the new one had a temporary id')
    await debounce(ctx)
    await debounce(ctx)
    assert.equal(draftBodies(ctx.calls).length, 0, 'the debounced draft save was dropped, and the published copy is not saved back as a draft')
  })

  it('publish keeps the selected block selected when it survives (a real id)', async (t) => {
    const ctx = await openBuilder(t)
    await fire(treeRow(ctx.page, 'Tiêu đề'), 'click')
    await click(byTitle(panel(ctx.page), 'Ẩn block')[0]!)
    await ctx.settle()
    await click(button(ctx.page, 'Xuất bản'))
    await ctx.settle()
    assert.equal(panel(ctx.page).props['data-block'], '16')
  })

  it('publish refused: the server\'s sentence; still a draft, publish offered again', async (t) => {
    const server = builderServer()
    server.state.override = call => (wire(call) === `POST ${API}/publish` ? h3Error(400, 'Khối không hợp lệ ở vị trí 1.') : undefined)
    const ctx = await openBuilder(t, server)
    await click(byTitle(panel(ctx.page), 'Ẩn block')[0]!)
    await debounce(ctx)
    await click(button(ctx.page, 'Xuất bản'))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Khối không hợp lệ ở vị trí 1.')
    assert.equal(saveState(ctx.page), 'Nháp — chưa xuất bản')
    assert.ok(!isDisabled(button(ctx.page, 'Xuất bản')))
    assertOnlyServerSentences(ctx)
  })

  it('"Hủy sửa" asks; "Hủy" keeps the draft; confirmed: the server draft is cleared, the live copy reloaded — and nothing is saved back', async (t) => {
    const server = builderServer()
    server.state.draft = [{ id: 11, blockType: 'hero', displayOrder: 1, data: { title: 'Bản nháp' }, isVisible: true }]
    const ctx = await openBuilder(t, server)
    ctx.answers.confirm = false
    await click(button(ctx.page, 'Hủy sửa'))
    await ctx.settle()
    assert.deepEqual(ctx.confirms.at(-1), { title: 'Hủy thay đổi', message: 'Bỏ toàn bộ chỉnh sửa chưa xuất bản và quay lại bản đang chạy trên site?', danger: true, confirmLabel: 'Hủy thay đổi' })
    assert.equal(ctx.calls.length, 1)
    ctx.answers.confirm = true
    const from = ctx.calls.length
    await click(button(ctx.page, 'Hủy sửa'))
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{ wire: `PUT ${API}/draft`, body: {} }, `GET ${API}`])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã quay lại bản đang chạy.')
    assert.equal(saveState(ctx.page), 'Đã xuất bản')
    assert.deepEqual(treeRows(ctx.page), TREE)
    await debounce(ctx)
    assert.equal(ctx.calls.length, from + 2)
  })

  it('"Hủy sửa" drops a pending draft save; refused: the server\'s sentence, and later edits are saved again', async (t) => {
    const server = builderServer()
    let refuse = true
    server.state.override = call => (refuse && wire(call) === `PUT ${API}/draft` && JSON.stringify(call.body) === '{}' ? h3Error(403, 'Bạn không có quyền sửa trang này.') : undefined)
    const ctx = await openBuilder(t, server)
    await click(byTitle(panel(ctx.page), 'Ẩn block')[0]!)
    await ctx.settle()
    await click(button(ctx.page, 'Hủy sửa'))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Bạn không có quyền sửa trang này.')
    await debounce(ctx)
    assert.deepEqual(draftBodies(ctx.calls), [undefined], 'only the refused clear: the pending save was dropped')
    refuse = false
    await click(byTitle(panel(ctx.page), 'Hiện block')[0]!)
    await debounce(ctx)
    assert.equal(draftBodies(ctx.calls).length, 2, 'editing after the refusal saves again')
  })
})

describe('page builder — "Cấu hình trang"', () => {
  it('opens on the page\'s values; "Lưu" sends title/slug/SEO; the header shows the slug the server answered; closed with a toast', async (t) => {
    const ctx = await openBuilder(t)
    await click(button(ctx.page, 'Cấu hình'))
    await ctx.settle()
    const meta = dialog(ctx.page, 'Cấu hình trang')
    const fields = findAll(meta, el => el.tag === 'input' || el.tag === 'textarea')
    assert.deepEqual(fields.map(f => f.model?.value), ['Giới thiệu', 'gioi-thieu', 'SEO cũ', ''])
    assert.ok(!isDisabled(fields[1]!))
    await input(fields[0]!, 'Giới thiệu C11')
    await input(fields[1]!, 'Giới thiệu C11!')
    await input(fields[3]!, 'Mô tả')
    await ctx.settle()
    const from = ctx.calls.length
    await click(button(dialog(ctx.page, 'Cấu hình trang'), 'Lưu'))
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{ wire: `PUT ${API}`, body: { title: 'Giới thiệu C11', seoTitle: 'SEO cũ', seoDescription: 'Mô tả', slug: 'Giới thiệu C11!' } }])
    assert.equal(dialogs(ctx.page).length, 0)
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã lưu cấu hình trang.')
    assert.equal(textOf(findAll(ctx.page.root, el => el.tag === 'h1')[0]!), 'Giới thiệu C11')
    assert.equal(textOf(findAll(ctx.page.root, el => el.tag === 'code')[0]!), '/gi-i-thi-u-c11')
    assert.equal(canvas(ctx.page).props['data-preview'], '/gi-i-thi-u-c11')
    await click(button(ctx.page, 'Cấu hình'))
    await ctx.settle()
    assert.deepEqual(findAll(dialog(ctx.page, 'Cấu hình trang'), el => el.tag === 'input' || el.tag === 'textarea').map(f => f.model?.value), ['Giới thiệu C11', 'gi-i-thi-u-c11', 'SEO cũ', 'Mô tả'])
  })

  it('a system page: the slug box is disabled with its hint, and no slug is sent', async (t) => {
    const server = builderServer()
    server.state.page = { ...server.state.page, slug: 'home', isSystem: true }
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Cấu hình'))
    await ctx.settle()
    const meta = dialog(ctx.page, 'Cấu hình trang')
    assert.ok(isDisabled(findAll(meta, el => el.tag === 'input')[1]!))
    assert.match(textOf(meta), /Trang hệ thống không thể đổi đường dẫn\./)
    const from = ctx.calls.length
    await click(button(meta, 'Lưu'))
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{ wire: `PUT ${API}`, body: { title: 'Giới thiệu', seoTitle: 'SEO cũ', seoDescription: '' } }])
  })

  it('while saving: "Lưu" disabled with a spinner, the dialog busy; refused: the server\'s sentence and the dialog stays as typed', async (t) => {
    const server = builderServer()
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === `PUT ${API}` ? (held.push(call), HOLD) : undefined)
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Cấu hình'))
    await ctx.settle()
    await input(findAll(dialog(ctx.page, 'Cấu hình trang'), el => el.tag === 'input')[0]!, '')
    await ctx.settle()
    tap(button(dialog(ctx.page, 'Cấu hình trang'), 'Lưu'))
    await ctx.settle()
    const meta = dialog(ctx.page, 'Cấu hình trang')
    assert.equal(meta.props['aria-busy'], 'true')
    assert.ok(isDisabled(closeX(meta)))
    const save = findAll(meta, el => el.tag === 'button' && textOf(el) === 'Lưu')[0]!
    assert.ok(isDisabled(save))
    assert.equal(findAll(save, el => el.tag === 'i' && String(el.props.class).includes('fa-spinner')).length, 1)
    server.answer(held[0]!)
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Tiêu đề không được để trống.')
    assert.equal(dialogs(ctx.page).length, 1)
    assert.equal(findAll(dialog(ctx.page, 'Cấu hình trang'), el => el.tag === 'input')[0]!.model?.value, '')
    assert.equal(dialog(ctx.page, 'Cấu hình trang').props['aria-busy'], undefined)
  })

  it('"Hủy" closes without a request; reopening starts again from the page', async (t) => {
    const ctx = await openBuilder(t)
    await click(button(ctx.page, 'Cấu hình'))
    await ctx.settle()
    await input(findAll(dialog(ctx.page, 'Cấu hình trang'), el => el.tag === 'input')[2]!, 'đã gõ')
    await click(button(dialog(ctx.page, 'Cấu hình trang'), 'Hủy'))
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 0)
    await click(button(ctx.page, 'Cấu hình'))
    await ctx.settle()
    assert.equal(findAll(dialog(ctx.page, 'Cấu hình trang'), el => el.tag === 'input')[2]!.model?.value, 'SEO cũ')
    assert.equal(ctx.calls.length, 1)
  })
})

describe('page builder — "Phiên bản"', () => {
  const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
  const versionCards = (ctx: BuilderCtx) => findAll(dialog(ctx.page, 'Phiên bản'), el => el.tag === 'div' && String(el.props.class ?? '').startsWith('mb-2 rounded-lg'))
  const card = (ctx: BuilderCtx, label: string) => versionCards(ctx).find(c => textOf(c).includes(label))!
  const labelBox = (ctx: BuilderCtx) => findAll(dialog(ctx.page, 'Phiên bản'), el => el.tag === 'input')[0]!
  const saveBackupButton = (ctx: BuilderCtx) => findAll(dialog(ctx.page, 'Phiên bản'), el => el.tag === 'button' && textOf(el).startsWith('Lưu ('))[0]!
  const enter = (extra: Record<string, unknown> = {}) => ({ key: 'Enter', isComposing: false, repeat: false, keyCode: 13, preventDefault() {}, ...extra })

  it('the drawer: a spinner while the list loads, then each version — kind, label, size, date ("—" when unknown); the origin is locked', async (t) => {
    const server = builderServer()
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === `GET ${API}/versions` ? (held.push(call), HOLD) : undefined)
    const ctx = await openBuilder(t, server)
    tap(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    const drawer = dialog(ctx.page, 'Phiên bản')
    assert.equal(drawer.props['data-size'], 'drawer')
    assert.equal(findAll(drawer, el => el.tag === 'i' && String(el.props.class).includes('fa-spinner fa-spin text-xl')).length, 1)
    server.answer(held[0]!)
    await ctx.settle()
    assert.deepEqual(versionCards(ctx).map(textOf), [
      `Bản gốcBản gốc · 3 block · ${when('2026-09-01T03:00:00.000Z')}KHÓA Khôi phục`,
      'Trước TếtBản sao lưu · 1 block · — Khôi phục',
      `Tự độngTự động · 1 block · ${when('2026-10-01T03:00:00.000Z')} Khôi phục`,
    ])
    assert.equal(findAll(card(ctx, 'KHÓA'), el => el.tag === 'button').length, 1, 'no delete on the origin')
    assert.equal(textOf(saveBackupButton(ctx)), 'Lưu (1/4)')
    assert.equal(saveBackupButton(ctx).props.title, 'Lưu nội dung đang dựng thành bản sao lưu')
    assert.equal(buttonsWith(dialog(ctx.page, 'Phiên bản'), 'Cập nhật bản gốc').length, 1)
  })

  it('no version yet: says so and offers "Chỉ định làm bản gốc"', async (t) => {
    const server = builderServer()
    server.state.versions = []
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    assert.match(textOf(dialog(ctx.page, 'Phiên bản')), /Chưa có phiên bản nào\. Bấm Xuất bản để tạo bản tự động đầu tiên\./)
    assert.equal(buttonsWith(dialog(ctx.page, 'Phiên bản'), 'Chỉ định làm bản gốc').length, 1)
    assert.equal(textOf(saveBackupButton(ctx)), 'Lưu (0/4)')
  })

  it('"Lưu (n/4)" posts the working copy with the typed name; busy while out; the name clears and the list reloads', async (t) => {
    const server = builderServer()
    const held: NetCall[] = []
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    await input(labelBox(ctx), 'Bản thử')
    await ctx.settle()
    server.state.override = call => (wire(call) === `POST ${API}/versions` ? (held.push(call), HOLD) : undefined)
    const from = ctx.calls.length
    tap(saveBackupButton(ctx))
    await ctx.settle()
    assert.ok(isDisabled(saveBackupButton(ctx)))
    assert.equal(dialog(ctx.page, 'Phiên bản').props['aria-busy'], 'true')
    server.answer(held[0]!)
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{ wire: `POST ${API}/versions`, body: { kind: 'manual', label: 'Bản thử', blocks: PUBLISHED() } }, `GET ${API}/versions`])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã lưu bản sao lưu.')
    assert.equal(labelBox(ctx).model?.value, '')
    assert.equal(textOf(saveBackupButton(ctx)), 'Lưu (2/4)')
  })

  it('Enter in the name box saves once — not while composing (IME), not on a held key; at 4 backups neither the button nor Enter saves', async (t) => {
    const server = builderServer()
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    const posts = () => ctx.calls.filter(c => wire(c) === `POST ${API}/versions`).length
    await fire(labelBox(ctx), 'keydown', enter({ isComposing: true }))
    await fire(labelBox(ctx), 'keydown', enter({ repeat: true }))
    await ctx.settle()
    assert.equal(posts(), 0)
    await fire(labelBox(ctx), 'keydown', enter())
    await ctx.settle()
    assert.equal(posts(), 1)
    for (let i = 0; i < 2; i++) {
      await fire(labelBox(ctx), 'keydown', enter())
      await ctx.settle()
    }
    assert.equal(textOf(saveBackupButton(ctx)), 'Lưu (4/4)')
    assert.ok(isDisabled(saveBackupButton(ctx)))
    assert.equal(saveBackupButton(ctx).props.title, 'Đã đạt tối đa 4 bản sao lưu')
    await fire(labelBox(ctx), 'keydown', enter())
    await ctx.settle()
    assert.equal(posts(), 3, 'nothing past the cap')
  })

  it('"Khôi phục" asks; confirmed: the version becomes the working copy (a draft), the drawer closes — and nothing is saved back', async (t) => {
    const ctx = await openBuilder(t)
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    ctx.answers.confirm = false
    await click(button(card(ctx, 'Trước Tết'), 'Khôi phục'))
    await ctx.settle()
    assert.deepEqual(ctx.confirms.at(-1), { title: 'Khôi phục phiên bản', message: 'Nạp "Trước Tết" vào bản nháp? Bản đang chạy trên site không đổi cho tới khi bạn Xuất bản.', confirmLabel: 'Khôi phục' })
    ctx.answers.confirm = true
    const from = ctx.calls.length
    await click(button(card(ctx, 'Trước Tết'), 'Khôi phục'))
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire), [`POST ${API}/versions/4/restore`])
    assert.equal(dialogs(ctx.page).length, 0)
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã nạp vào bản nháp. Xem trước rồi bấm Xuất bản.')
    assert.deepEqual(treeRows(ctx.page), ['*Tiêu đề · Bản Tết'])
    assert.equal(saveState(ctx.page), 'Nháp — chưa xuất bản')
    await debounce(ctx)
    assert.equal(ctx.calls.length, from + 1)
    // The origin's message names its kind (no label).
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    ctx.answers.confirm = false
    await click(button(card(ctx, 'KHÓA'), 'Khôi phục'))
    assert.match(ctx.confirms.at(-1)!.message!, /^Nạp "Bản gốc" vào bản nháp\?/)
  })

  it('delete asks; confirmed: DELETE then the list again; refused: the server\'s sentence', async (t) => {
    const server = builderServer()
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    const from = ctx.calls.length
    await click(findAll(card(ctx, 'Trước Tết'), el => el.props['aria-label'] === 'Xóa phiên bản Trước Tết')[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.confirms.at(-1), { title: 'Xóa phiên bản', message: 'Xóa "Trước Tết"?', danger: true, confirmLabel: 'Xóa' })
    assert.deepEqual(ctx.calls.slice(from).map(wire), [`DELETE ${API}/versions/4`, `GET ${API}/versions`])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã xóa phiên bản.')
    assert.equal(versionCards(ctx).length, 2)
    server.state.override = call => (call.method === 'DELETE' ? h3Error(400, 'Không thể xóa bản gốc. Hãy chỉ định bản gốc khác để thay thế.') : undefined)
    await click(findAll(card(ctx, 'Tự động'), el => el.props['aria-label'] === 'Xóa phiên bản Tự động')[0]!)
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Không thể xóa bản gốc. Hãy chỉ định bản gốc khác để thay thế.')
    assertOnlyServerSentences(ctx)
  })

  it('"Cập nhật bản gốc" warns it overwrites; "Chỉ định làm bản gốc" (none yet) says what an origin is; both post the working copy', async (t) => {
    const server = builderServer()
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    const from = ctx.calls.length
    await click(button(dialog(ctx.page, 'Phiên bản'), 'Cập nhật bản gốc'))
    await ctx.settle()
    assert.deepEqual(ctx.confirms.at(-1), { title: 'Chỉ định bản gốc', message: 'Ghi đè bản gốc hiện tại bằng nội dung đang dựng?', confirmLabel: 'Chỉ định' })
    assert.deepEqual(sent(ctx.calls, from), [{ wire: `POST ${API}/versions`, body: { kind: 'origin', blocks: PUBLISHED() } }, `GET ${API}/versions`])
    assert.equal(lastToast(ctx.toasts, 'success'), 'Đã chỉ định bản gốc.')
    server.state.versions = []
    await click(closeX(dialog(ctx.page, 'Phiên bản')))
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    ctx.answers.confirm = false
    await click(button(dialog(ctx.page, 'Phiên bản'), 'Chỉ định làm bản gốc'))
    assert.equal(ctx.confirms.at(-1)!.message, 'Đặt nội dung đang dựng làm bản gốc (khóa, dùng để khôi phục sau này)?')
  })

  it('a backup refused at the cap: the server\'s sentence', async (t) => {
    const server = builderServer()
    server.state.override = call => (wire(call) === `POST ${API}/versions` ? h3Error(400, 'Đã đạt tối đa 4 bản sao lưu. Vui lòng xóa bớt trước khi lưu mới.') : undefined)
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    await click(saveBackupButton(ctx))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Đã đạt tối đa 4 bản sao lưu. Vui lòng xóa bớt trước khi lưu mới.')
    assertOnlyServerSentences(ctx)
  })

  it('only the latest list is shown: an older answer landing last does not hide the backup just saved', async (t) => {
    const server = builderServer()
    const held: NetCall[] = []
    const ctx = await openBuilder(t, server)
    server.state.override = call => (wire(call) === `GET ${API}/versions` && !held.length ? (held.push(call), HOLD) : undefined)
    tap(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    await click(saveBackupButton(ctx))
    await ctx.settle()
    held[0]!.respond(new Response(JSON.stringify({ ok: true, versions: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await ctx.settle()
    assert.equal(versionCards(ctx).length, 4, 'the newer list (with the new backup) stays')
    assert.equal(findAll(dialog(ctx.page, 'Phiên bản'), el => String(el.props.class ?? '').includes('fa-spinner fa-spin text-xl')).length, 0)
  })

  it('the rich-text HTML goes to the server verbatim — the page filters nothing (the server does)', async (t) => {
    const ctx = await openBuilder(t)
    await click(byTitle(panel(ctx.page), 'Ẩn block')[0]!)
    await debounce(ctx)
    await click(button(ctx.page, 'Xuất bản'))
    await ctx.settle()
    const html = (body: unknown) => JSON.stringify(body).match(/<p>Nội dung <b>đậm<\/b><\/p>/g)?.length ?? 0
    assert.equal(html(draftBodies(ctx.calls)), 1)
    assert.equal(html(ctx.calls.find(c => wire(c) === `POST ${API}/publish`)!.body), 1)
    assert.equal(findAll(ctx.page.root, el => el.props.innerHTML !== undefined).length, 0, 'no block HTML rendered by the page')
  })
})
