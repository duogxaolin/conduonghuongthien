/**
 * The page builder — a bug found while writing tests/admin-page-builder.test.ts (wave3 4.2).
 * RED on the original page (`PAGE_BUILDER_FILE=<original>`) and on the pure split, green
 * after its fix (its own commit).
 *
 * FINDING-B1 — a versions list that failed to load read as "no versions". The drawer showed
 * "Chưa có phiên bản nào. Bấm Xuất bản để tạo bản tự động đầu tiên." (the error went to a toast
 * that fades), counted "Lưu (0/4)", and offered "Chỉ định làm bản gốc" whose prompt said it
 * would SET an origin — confirming it replaced the existing origin, which the "Cập nhật bản
 * gốc" prompt warns about ("Ghi đè bản gốc hiện tại…"). Now the drawer shows the failure in
 * `role="alert"` with "Thử lại" (that list only) in place of the list, and the two actions that
 * depend on the list — "Lưu (n/4)" and the origin button — wait until it is known.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { click } from './_sfc-mount.ts'
import { alerts, builderServer, button, dialog, findAll, h3Error, openBuilder, textOf, wire } from './_page-builder-harness.ts'

const API = '/api/admin/pages/5'

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
afterEach(() => mock.timers.reset())

describe('FINDING-B1 — a versions list that cannot be read is not shown as "no versions"', () => {
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

  it('a failure after a write (the list read again after a backup) is shown the same way; the write\'s own toast stands', async (t) => {
    const server = builderServer()
    const ctx = await openBuilder(t, server)
    await click(button(ctx.page, 'Phiên bản'))
    await ctx.settle()
    server.state.override = call => (wire(call) === `GET ${API}/versions` ? h3Error(503, 'Không đọc được danh sách phiên bản lúc này.') : undefined)
    await click(findAll(dialog(ctx.page, 'Phiên bản'), el => el.tag === 'button' && textOf(el).startsWith('Lưu ('))[0]!)
    await ctx.settle()
    assert.equal(ctx.toasts.filter(x => x.type === 'success').at(-1)?.message, 'Đã lưu bản sao lưu.')
    assert.equal(alerts(dialog(ctx.page, 'Phiên bản')).length, 1)
  })
})
