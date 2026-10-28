/**
 * The page builder — bugs found while writing tests/admin-page-builder.test.ts and by the
 * independent verification of the split (wave3 4.2). RED on the original page
 * (`PAGE_BUILDER_FILE=<original>`) and on the pure split, green after their fixes (each its own
 * commit).
 *
 * FINDING-B1 — a versions list that is not known read as "no versions". The drawer showed
 * "Chưa có phiên bản nào. Bấm Xuất bản để tạo bản tự động đầu tiên." (the error went to a toast
 * that fades), counted "Lưu (0/4)", and offered "Chỉ định làm bản gốc" whose prompt said it
 * would SET an origin — confirming it replaced the existing origin, which the "Cập nhật bản
 * gốc" prompt warns about ("Ghi đè bản gốc hiện tại…"). The same while the list is still
 * LOADING (first open, or "Thử lại" in flight): an empty or stale list, the same prompt.
 * Now a failed read shows in `role="alert"` with "Thử lại" (that list only) in place of the
 * list, and the actions that depend on the list — "Lưu (n/4)", Enter in the name box, the
 * origin button — are off while the list is unknown: loading or failed.
 *
 * FINDING-B2 — the builder offered page actions before the page was loaded. The top bar sits
 * outside the loading/error branches, and with nothing loaded the "anything to publish"
 * comparison (an empty tree against an empty snapshot) said yes: while the page loaded, after a
 * failed load or with "Thử lại" in flight, "Xuất bản" was enabled and published an EMPTY tree
 * (`POST …/publish { blocks: [] }` — the live page emptied), "Hủy sửa" cleared the server draft,
 * "Cấu hình" opened an empty form whose "Lưu" wrote blank SEO fields over the page's, and
 * "Phiên bản" let the empty working copy become the origin. Now the page holds a positive
 * `loaded` flag (set by a successful load, cleared when a load starts): the four buttons are off
 * without it, and the handlers check it too (a click that reaches them past a disabled button
 * does nothing) — as is the debounced draft save.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { click, fire, type MiniElement } from './_sfc-mount.ts'
import {
  alerts, builderServer, button, byTitle, dialog, dialogs, draftBodies, findAll, h3Error, HOLD, mountBuilder, openBuilder, panel, serverRender, textOf, wire,
  type BuilderCtx, type NetCall,
} from './_page-builder-harness.ts'

const tap = (el: MiniElement) => { void click(el) }
const versionCards = (drawer: MiniElement) => findAll(drawer, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('mb-2 rounded-lg'))

const API = '/api/admin/pages/5'

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
afterEach(() => mock.timers.reset())

describe('FINDING-B1 — a versions list that is not known (failed, or still loading) is not shown as "no versions"', () => {
  async function failedDrawer(t: Parameters<typeof openBuilder>[0]) {
    const server = builderServer()
    let fail = true
    server.state.override = call => (fail && wire(call) === `GET ${API}/versions` ? h3Error(503, 'Không đọc được danh sách phiên bản lúc này.') : undefined)
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    return { ctx, server, recover: () => { fail = false } }
  }
  const actions = (drawer: ReturnType<typeof dialog>) => findAll(drawer, el => el.tag === 'button' && (textOf(el).startsWith('Lưu (') || /bản gốc/.test(textOf(el))))

  it('the failure is in the drawer, in role="alert", with the server\'s sentence — not "Chưa có phiên bản nào" (RED before)', async (t) => {
    const { ctx } = await failedDrawer(t)
    const drawer = dialog(ctx.page, 'Phiên bản')
    assert.doesNotMatch(textOf(drawer), /Chưa có phiên bản nào/)
    const alert = alerts(drawer)
    assert.equal(alert.length, 1)
    assert.match(textOf(alert[0]!), /Không đọc được danh sách phiên bản lúc này\./)
  })

  it('"Lưu (n/4)" and the origin button wait for the list — no prompt that would replace an origin it cannot see (RED before)', async (t) => {
    const { ctx } = await failedDrawer(t)
    const drawer = dialog(ctx.page, 'Phiên bản')
    assert.equal(actions(drawer).length, 2)
    for (const action of actions(drawer)) assert.equal(action.props.disabled, true, `"${textOf(action)}" is disabled while the list is unknown`)
  })

  it('"Thử lại" reads the list again (that request only); then the versions and the actions are back (RED before)', async (t) => {
    const { ctx, recover } = await failedDrawer(t)
    recover()
    const from = ctx.calls.length
    await click(button(alerts(dialog(ctx.page, 'Phiên bản'))[0]!, 'Thử lại'))
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(from).map(wire), [`GET ${API}/versions`])
    const drawer = dialog(ctx.page, 'Phiên bản')
    assert.equal(alerts(drawer).length, 0)
    assert.equal(findAll(drawer, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('mb-2 rounded-lg')).length, 3)
    assert.deepEqual(actions(drawer).map(a => [textOf(a), Boolean(a.props.disabled)]), [['Lưu (1/4)', false], ['Cập nhật bản gốc', false]])
  })

  it('a failure after a write (the list read again after a backup) is shown the same way — the old list is not drawn under it; the write\'s own toast stands', async (t) => {
    const server = builderServer()
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    assert.equal(versionCards(dialog(ctx.page, 'Phiên bản')).length, 3)
    server.state.override = call => (wire(call) === `GET ${API}/versions` ? h3Error(503, 'Không đọc được danh sách phiên bản lúc này.') : undefined)
    await click(findAll(dialog(ctx.page, 'Phiên bản'), el => el.tag === 'button' && textOf(el).startsWith('Lưu ('))[0]!)
    await ctx.settle()
    assert.equal(ctx.toasts.filter(x => x.type === 'success').at(-1)?.message, 'Đã lưu bản sao lưu.')
    const drawer = dialog(ctx.page, 'Phiên bản')
    assert.equal(alerts(drawer).length, 1)
    // The list the server no longer confirms is gone, with its "Khôi phục"/delete buttons.
    assert.equal(versionCards(drawer).length, 0, 'no stale version under the alert')
    assert.equal(findAll(drawer, el => el.tag === 'button' && (textOf(el).includes('Khôi phục') || String(el.props['aria-label'] ?? '').startsWith('Xóa phiên bản'))).length, 0)
  })

  // Verification V1 of the split: the fix covered `failed` only.
  async function loadingDrawer(t: Parameters<typeof openBuilder>[0], first: 'hold' | 'fail-then-hold') {
    const server = builderServer()
    let mode: 'fail' | 'hold' = first === 'hold' ? 'hold' : 'fail'
    const held: NetCall[] = []
    server.state.override = call => (wire(call) === `GET ${API}/versions` ? (mode === 'fail' ? h3Error(503, 'Không đọc được.') : (held.push(call), HOLD)) : undefined)
    const ctx = await openBuilder(t, server)
    tap(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    if (first === 'fail-then-hold') {
      assert.equal(alerts(dialog(ctx.page, 'Phiên bản')).length, 1)
      mode = 'hold'
      tap(button(alerts(dialog(ctx.page, 'Phiên bản'))[0]!, 'Thử lại'))
      await ctx.settle()
    }
    assert.equal(held.length, 1, 'the list is still loading')
    return { ctx, server, held }
  }

  for (const first of ['hold', 'fail-then-hold'] as const) {
    const when = first === 'hold' ? 'first open, the list still loading' : '"Thử lại" in flight after a failure'
    it(`${when}: "Lưu (n/4)", Enter and the origin button are off — confirming cannot overwrite an origin the drawer cannot see (RED before)`, async (t) => {
      const { ctx, server, held } = await loadingDrawer(t, first)
      const drawer = dialog(ctx.page, 'Phiên bản')
      assert.equal(actions(drawer).length, 2)
      for (const action of actions(drawer)) assert.equal(action.props.disabled, true, `"${textOf(action)}" is disabled while the list loads`)
      // Past the disabled controls: Enter in the name box and a click that reaches the button.
      await fire(findAll(drawer, el => el.tag === 'input')[0]!, 'keydown', { key: 'Enter', isComposing: false, repeat: false, keyCode: 13, preventDefault() {} })
      await ctx.settle()
      assert.equal(ctx.calls.filter(c => wire(c) === `POST ${API}/versions`).length, 0, 'Enter saves no backup over an unknown count')
      server.answer(held[0]!)
      await ctx.settle()
      assert.deepEqual(actions(dialog(ctx.page, 'Phiên bản')).map(a => [textOf(a), Boolean(a.props.disabled)]), [['Lưu (1/4)', false], ['Cập nhật bản gốc', false]], 'back once the list is known')
    })
  }
})

describe('FINDING-B2 — page actions wait for the page (verification V3)', () => {
  /** The page load: in flight (`hold`), failed, or failed and then "Thử lại" in flight. */
  async function notLoaded(t: Parameters<typeof openBuilder>[0], state: 'loading' | 'failed' | 'retrying') {
    const server = builderServer()
    let mode: 'hold' | 'fail' = state === 'loading' ? 'hold' : 'fail'
    server.state.override = call => (wire(call) === `GET ${API}` ? (mode === 'hold' ? HOLD : h3Error(503, 'Không tải được trang.')) : undefined)
    const ctx = await mountBuilder(t, server)
    await ctx.settle()
    if (state === 'retrying') {
      mode = 'hold'
      tap(button(alerts(ctx.page)[0]!, 'Thử lại'))
      await ctx.settle()
    }
    return { ctx, server }
  }
  const topBar = (ctx: BuilderCtx) => ({
    publish: button(ctx.page, 'Xuất bản'),
    // Shown only while the working copy differs from the live page (absent once loaded and clean).
    discard: findAll(ctx.page.root, el => el.tag === 'button' && textOf(el).includes('Hủy sửa'))[0]!,
    versions: findAll(ctx.page.root, el => el.tag === 'button' && textOf(el) === 'Phiên bản')[0]!,
    meta: findAll(ctx.page.root, el => el.tag === 'button' && textOf(el) === 'Cấu hình')[0]!,
  })

  for (const state of ['loading', 'failed', 'retrying'] as const) {
    it(`guard 1, the buttons — ${state}: "Xuất bản", "Hủy sửa", "Phiên bản" and "Cấu hình" are off (RED before: "Xuất bản" published an empty tree)`, async (t) => {
      const { ctx } = await notLoaded(t, state)
      for (const [name, el] of Object.entries(topBar(ctx))) assert.equal(el.props.disabled, true, `${name} is disabled while the page is ${state}`)
    })
  }

  it('guard 1, the first frame: the server-rendered page (before the load runs, until hydration) has the four buttons off — the flag starts false (RED before)', async () => {
    const html = await serverRender()
    const buttonTag = (label: string) => {
      const found = [...html.matchAll(/<button\b([^>]*)>((?:(?!<\/button>)[\s\S])*)<\/button>/g)].filter(m => m[2]!.replace(/<[^>]+>/g, '').includes(label))
      assert.equal(found.length, 1, `one "${label}" button in the server HTML`)
      return found[0]![1]!
    }
    assert.match(html, /Đang tải trình dựng trang/, 'the first frame is the loading placeholder')
    for (const label of ['Hủy sửa', 'Phiên bản', 'Cấu hình', 'Xuất bản']) assert.match(buttonTag(label), /\sdisabled(?=[\s=>]|$)/, `"${label}" is disabled in the first frame`)
  })

  it('guard 2, the handlers: a click that reaches them past the disabled buttons publishes nothing, clears no draft, opens nothing (RED before)', async (t) => {
    const { ctx, server } = await notLoaded(t, 'failed')
    const before = ctx.calls.length
    const bar = topBar(ctx)
    for (const el of [bar.publish, bar.discard, bar.versions, bar.meta]) await fire(el, 'click')
    await ctx.settle()
    assert.deepEqual(ctx.calls.slice(before).map(wire), [], 'no POST /publish {blocks: []}, no PUT /draft {}, no versions read')
    assert.equal(ctx.confirms.length, 0, '"Hủy sửa" asks nothing')
    assert.equal(dialogs(ctx.page).length, 0, 'no dialog opens')
    assert.equal(server.state.published.length, 3, 'the live page is untouched')
  })

  it('guard 2, the draft save: an edit that lands after the page failed to reload is not saved as a draft (RED before)', async (t) => {
    const server = builderServer()
    const ctx = await openBuilder(t, server)
    // A draft to discard, and the block palette left open (the harness does not trap focus).
    await click(byTitle(panel(ctx.page), 'Ẩn block')[0]!)
    await ctx.settle()
    await click(button(ctx.page, 'Thêm khối'))
    await ctx.settle()
    server.state.override = call => (wire(call) === `GET ${API}` ? h3Error(503, 'Không tải được trang.') : undefined)
    await click(button(ctx.page, 'Hủy sửa'))
    await ctx.settle()
    assert.equal(alerts(ctx.page).length, 1, 'the reload after the discard failed')
    const before = draftBodies(ctx.calls).length
    await click(findAll(dialog(ctx.page, 'Thêm khối'), el => el.tag === 'button' && textOf(el) === 'Tiêu đề')[0]!)
    await ctx.settle()
    mock.timers.tick(800)
    await ctx.settle()
    assert.equal(draftBodies(ctx.calls).length, before, 'the discarded working copy is not saved back')
  })

  it('once the page is loaded, every action is back', async (t) => {
    const { ctx, server } = await notLoaded(t, 'failed')
    server.state.override = () => undefined
    await click(button(alerts(ctx.page)[0]!, 'Thử lại'))
    await ctx.settle()
    const bar = topBar(ctx)
    assert.equal(bar.publish.props.disabled, true, 'nothing to publish yet')
    for (const el of [bar.versions, bar.meta]) assert.notEqual(el.props.disabled, true)
    assert.equal(findAll(ctx.page.root, el => el.tag === 'button' && textOf(el).includes('Hủy sửa')).length, 0)
    await click(byTitle(panel(ctx.page), 'Ẩn block')[0]!)
    await ctx.settle()
    assert.notEqual(button(ctx.page, 'Xuất bản').props.disabled, true)
    assert.notEqual(button(ctx.page, 'Hủy sửa').props.disabled, true)
  })
})
