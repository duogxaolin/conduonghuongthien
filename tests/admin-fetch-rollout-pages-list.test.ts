/**
 * Wave 3 D-FETCH, batch E: the pages list — `pages/admin/content/pages/index.vue` (3 `$fetch`
 * casts) — calls `adminFetch<T>()` with response types derived from the handlers
 * (`AdminPageRow` in app/types/admin-api.ts; list/create/delete in app/types/admin-pages-api.ts).
 *
 * The REAL page is mounted (tests/_admin-page-harness.ts) over REAL ofetch on a fake network,
 * with the REAL bulk-selection composables. Pinned, green before and after the conversion:
 *   - the list read on mount: title, path ("/" for home), block count, system vs custom; system
 *     pages carry no checkbox and no delete;
 *   - create POSTs the trimmed title (and slug only when typed), then opens the builder of the
 *     created page; a refusal shows the server's sentence and keeps the dialog open;
 *   - delete asks first, DELETEs, reloads; the bulk delete posts the ticked ids and the reload
 *     narrows the selection to rows still on screen (`keepOnly`);
 *   - a failed load is a `role="alert"` with the server's sentence and "Thử lại", never the
 *     "Chưa có trang nào" empty state, never ofetch's `[GET] "…"` line.
 *
 * No finding on this page: its one list load is the only writer of the rows, and every action
 * that reloads hides the list (or the bar) while it does — nothing for an older answer to race.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { click, findAll, fire, input, textOf } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const PAGE = 'pages/admin/content/pages/index.vue'
const URL = '/api/admin/pages'
const STAMP = '2026-10-20T02:00:00.000Z'
const row = (id: number, title: string, slug: string, isSystem = false, blockCount = 0) => ({
  id, slug, title, isSystem, seoTitle: null, seoDescription: null, isVisible: true, publishedBlocks: null, draftBlocks: null,
  updatedBy: 1, createdAt: STAMP, updatedAt: STAMP, blockCount,
})
const ROWS = [row(8, 'Chương trình hỗ trợ', 'chuong-trinh', false, 4), row(9, 'Liên kết', 'lien-ket', false, 0), row(1, 'Trang chủ', 'home', true, 12)]
const list = (items: unknown[] = ROWS) => json({ ok: true, items })

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    [`GET ${URL}`]: () => list(),
    [`POST ${URL}`]: () => json({ ok: true, id: 12, slug: 'trang-moi' }),
    [`DELETE ${URL}/8`]: () => json({ ok: true }),
    [`POST ${URL}/bulk-delete`]: call => json({ requested: 2, succeeded: 2, succeededIds: (call.body as { ids: number[] }).ids, failed: [] }),
    ...overrides,
  })
}

async function open(responder = server()) {
  const navigations: unknown[] = []
  const opened = await mountAdminPage(PAGE, responder, {
    modules: { '~/components/admin/AdminModal.vue': { default: OpenModal } },
    auto: { navigateTo: (to: unknown) => { navigations.push(to) } },
  })
  return Object.assign(opened, { navigations })
}
const screen = (opened: MountedAdminPage) => textOf(opened.page.root)
const dialog = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'dialog')[0]
const tableRows = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'tbody').flatMap(body => findAll(body, el => el.tag === 'tr'))
const rowOf = (opened: MountedAdminPage, title: string) => tableRows(opened).find(tr => textOf(tr).includes(title))!
const cells = (opened: MountedAdminPage, title: string) => findAll(rowOf(opened, title), el => el.tag === 'td').map(textOf)
const tick = async (opened: MountedAdminPage, title: string) => {
  await fire(findAll(rowOf(opened, title), el => el.tag === 'input' && el.props.type === 'checkbox')[0]!, 'change')
  await settle()
}
const bulkBar = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'AdminBulkActionBar')[0]

describe(PAGE, () => {
  it('mount: the pages, with path, block count and kind; a system page has no checkbox and no delete', async () => {
    const opened = await open()
    assert.deepEqual(opened.calls.map(wire), [`GET ${URL}`])
    assert.deepEqual(cells(opened, 'Chương trình hỗ trợ').slice(1, 5), ['Chương trình hỗ trợ', '/chuong-trinh', '4', 'Tùy chỉnh'])
    assert.deepEqual(cells(opened, 'Trang chủ').slice(1, 5), ['Trang chủ', '/', '12', 'Hệ thống'])
    const home = rowOf(opened, 'Trang chủ')
    assert.equal(findAll(home, el => el.tag === 'input').length, 0)
    assert.equal(findAll(home, el => el.tag === 'button').length, 0)
    assert.equal(alertText(opened.page), '')
  })

  it('create: POST the trimmed title (no slug when blank), toast, close, open the new page\'s builder', async () => {
    const opened = await open()
    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Tạo trang mới')[0]!)
    await input(findAll(dialog(opened)!, el => el.props.placeholder === 'VD: Chương trình hỗ trợ')[0]!, '  Trang mới  ')
    const before = opened.calls.length
    await click(findAll(dialog(opened)!, el => el.tag === 'button' && textOf(el) === 'Tạo trang')[0]!)
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: `POST ${URL}`, body: { title: 'Trang mới' } }])
    assert.equal(opened.lastToast('success'), 'Đã tạo trang mới.')
    assert.ok(!dialog(opened))
    assert.deepEqual(opened.navigations, ['/admin/content/pages/12'])
  })

  it('create with a slug sends it; a refusal shows the server\'s sentence and keeps the dialog open', async () => {
    const opened = await open(server({ [`POST ${URL}`]: () => h3Error(400, 'Tiêu đề trang là bắt buộc.') }))
    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Tạo trang mới')[0]!)
    await input(findAll(dialog(opened)!, el => el.props.placeholder === 'VD: Chương trình hỗ trợ')[0]!, 'X')
    await input(findAll(dialog(opened)!, el => el.props.placeholder === 'tự động tạo từ tiêu đề nếu để trống')[0]!, ' tu-chon ')
    await click(findAll(dialog(opened)!, el => el.tag === 'button' && textOf(el) === 'Tạo trang')[0]!)
    await settle()
    assert.deepEqual(opened.calls.at(-1)!.body, { title: 'X', slug: 'tu-chon' })
    assert.equal(opened.lastToast('error'), 'Tiêu đề trang là bắt buộc.')
    assert.ok(dialog(opened))
    assert.deepEqual(opened.navigations, [])
  })

  it('delete asks first, DELETEs, toasts and reloads; declined sends nothing', async () => {
    const opened = await open()
    opened.answers.confirm = false
    await click(findAll(rowOf(opened, 'Chương trình hỗ trợ'), el => el.tag === 'button')[0]!)
    await settle()
    assert.equal(opened.calls.length, 1)
    assert.match(opened.confirms[0]!.message!, /Xóa trang "Chương trình hỗ trợ"\?/)
    opened.answers.confirm = true
    await click(findAll(rowOf(opened, 'Chương trình hỗ trợ'), el => el.tag === 'button')[0]!)
    await settle()
    assert.deepEqual(opened.calls.slice(1).map(wire), [`DELETE ${URL}/8`, `GET ${URL}`])
    assert.equal(opened.lastToast('success'), 'Đã xóa trang.')
  })

  it('a refused delete shows the server\'s sentence, not ofetch\'s line', async () => {
    const opened = await open(server({ [`DELETE ${URL}/8`]: () => h3Error(403, 'Không thể xoá trang hệ thống.') }))
    await click(findAll(rowOf(opened, 'Chương trình hỗ trợ'), el => el.tag === 'button')[0]!)
    await settle()
    assert.equal(opened.lastToast('error'), 'Không thể xoá trang hệ thống.')
    for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE)
  })

  it('bulk delete posts the ticked ids; the reload narrows the selection to rows still listed', async () => {
    let rows = ROWS
    const opened = await open(server({ [`GET ${URL}`]: () => list(rows) }))
    await tick(opened, 'Chương trình hỗ trợ')
    await tick(opened, 'Liên kết')
    assert.ok(bulkBar(opened))
    rows = [ROWS[1]!, ROWS[2]!]
    // A plain reload (the single delete of row 8 elsewhere): row 8 is gone, 9 stays ticked.
    await click(findAll(rowOf(opened, 'Chương trình hỗ trợ'), el => el.tag === 'button')[0]!)
    await settle()
    assert.equal(bulkBar(opened)?.props.count, 1)
    const before = opened.calls.length
    await click(findAll(bulkBar(opened)!, el => el.tag === 'button' && textOf(el) === 'Xóa')[0]!)
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: `POST ${URL}/bulk-delete`, body: { ids: [9] } }, `GET ${URL}`])
  })

  it('a failed load is an alert with the server\'s sentence and "Thử lại" — not "Chưa có trang nào"', async () => {
    let fail = true
    const opened = await open(server({ [`GET ${URL}`]: () => (fail ? h3Error(403, 'Bạn không có quyền xem trang.') : list()) }))
    assert.equal(alertText(opened.page), 'Bạn không có quyền xem trang.Thử lại')
    assert.ok(!screen(opened).includes('Chưa có trang nào'))
    fail = false
    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Thử lại')[0]!)
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.ok(rowOf(opened, 'Liên kết'))
  })

  it('a dropped connection reads as the page\'s own sentence', async () => {
    const opened = await open(server({ [`GET ${URL}`]: () => dropped() }))
    assert.match(alertText(opened.page), /^Không tải được danh sách trang\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
  })
})
