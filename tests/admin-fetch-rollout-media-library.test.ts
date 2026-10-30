/**
 * Wave 3 D-FETCH, batch E: the image library — `pages/admin/media/index.vue` (3 `$fetch` casts) —
 * calls `adminFetch<T>()` with response types derived from the handlers (`AdminMediaRow` in
 * app/types/admin-api.ts; list/delete/storage size in app/types/admin-media-api.ts).
 *
 * The REAL page is mounted (tests/_admin-page-harness.ts) over REAL ofetch on a fake network, with
 * the REAL bulk-selection composables; only the uploader (`useUpload`) is a stand-in. Pinned, green
 * before and after the conversion:
 *   - the grid read on mount (page 1, 24 per page, the search and type as typed) and the storage
 *     card; search / type / pager ask with the exact query string (`params:` became `query:`);
 *   - delete asks first, DELETEs, reloads the page on screen; the bulk delete posts the ticked
 *     ids and the reload narrows the selection;
 *   - a failed load is a `role="alert"` with the server's sentence and "Thử lại", never the
 *     "Chưa có file nào" empty state; a failed storage scan is its own alert, the grid stays.
 *
 * FINDINGS, RED on the base (88073004):
 *   - no notion of "the latest request": search "báo cáo" (slow), then pick "Chỉ Video" — the
 *     older answer landing last showed the search's tiles under the video filter (and its late
 *     failure or `finally` overwrote the newer state). Only the latest load writes now;
 *   - deleting the last tile of the last page reloaded a page past the end, and the library said
 *     "Chưa có file nào. Hãy tải lên file đầu tiên!" over a pager of N−1 full pages. It asks for
 *     the last page that exists (once — the rule of `useAdminList`).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { click, findAll, fire, input, textOf } from './_sfc-mount.ts'
import {
  alertText, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const PAGE = 'pages/admin/media/index.vue'
const URL = '/api/admin/media'
const EMPTY = 'Chưa có file nào. Hãy tải lên file đầu tiên!'
const tile = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, filename: `${id}.jpg`, originalName: name, mimeType: 'image/jpeg', sizeBytes: 2048, provider: 'local',
  url: `/uploads/2026/10/${id}.jpg`, width: 100, height: 80, createdAt: '2026-10-20T02:00:00.000Z', uploadedBy: 'admin', ...over,
})
const TILES = [tile(5, 'anh-hoi-nghi.jpg'), tile(6, 'bao-cao.pdf', { mimeType: 'application/pdf', provider: 'r2' })]
const page = (items: unknown[], pageNo = 1, total = items.length) =>
  json({ ok: true, items, pagination: { page: pageNo, perPage: 24, total, totalPages: Math.ceil(total / 24) } })
const STORAGE = {
  ok: true,
  local: { dbCount: 10, dbBytes: 1048576, diskCount: 12, diskBytes: 2097152 },
  r2: { configured: true, dbCount: 3, dbBytes: 3072, bucketCount: 3, bucketBytes: 3072 },
}

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    [`GET ${URL}`]: () => page(TILES),
    [`GET ${URL}/storage-size`]: () => json(STORAGE),
    [`DELETE ${URL}/5`]: () => json({ ok: true }),
    [`POST ${URL}/bulk-delete`]: call => json({ requested: 2, succeeded: 2, succeededIds: (call.body as { ids: number[] }).ids, failed: [] }),
    ...overrides,
  })
}

const uploader = () => ({ uploading: Vue.ref(false), uploadBatch: async () => [], tasks: Vue.ref([]), uploadingBatch: Vue.ref(false) })
const open = (responder = server()) => mountAdminPage(PAGE, responder, { auto: { useUpload: uploader } })
const screen = (opened: MountedAdminPage) => textOf(opened.page.root)
const names = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'span' && typeof el.props.title === 'string' && el.props.class === 'text-[0.82rem] font-bold text-brand-950 truncate').map(textOf)
const searchBox = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'input' && el.props.placeholder === 'Tìm kiếm file...')[0]!
const typeSelect = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'select')[0]!
const pager = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'AdminPagination')[0]
const button = (opened: MountedAdminPage, label: string) => findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === label)[0]!
const tileOf = (opened: MountedAdminPage, name: string) => findAll(opened.page.root, el => el.tag === 'div' && el.children.some(c => c.kind === 'element' && c.tag === 'div' && textOf(c).startsWith(name)) && textOf(el).includes('Link'))[0]!
const listCalls = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(c => c.url.pathname === URL).map(wire)
const skeleton = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'SkeletonCards').length === 1

describe(PAGE, () => {
  it('mount: page 1 of the grid with the empty search and type, and the storage scan; tiles and storage render', async () => {
    const opened = await open()
    assert.deepEqual(opened.calls.map(wire), [`GET ${URL}?page=1&search&type&perPage=24`, `GET ${URL}/storage-size`])
    assert.deepEqual(names(opened), ['anh-hoi-nghi.jpg', 'bao-cao.pdf'])
    assert.match(screen(opened), /2\.0 KB/)
    assert.match(screen(opened), /Local \/uploads\s*2\.0 MB/)
    assert.match(screen(opened), /Mồ côi \(chưa có DB\)\s*2 tệp/)
    assert.equal(alertText(opened.page), '')
  })

  it('search (Enter and the button) and the type filter ask for page 1 with them; the pager asks for its page', async () => {
    const opened = await open(server({ [`GET ${URL}`]: call => page(TILES, Number(call.url.searchParams.get('page')), 60) }))
    await input(searchBox(opened), 'hội nghị')
    let before = opened.calls.length
    await fire(searchBox(opened), 'keyup', { key: 'Enter', type: 'keyup', preventDefault() {}, stopPropagation() {} })
    await settle()
    await click(button(opened, 'Tìm kiếm'))
    await settle()
    assert.deepEqual(listCalls(opened, before), [`GET ${URL}?page=1&search=h%E1%BB%99i+ngh%E1%BB%8B&type&perPage=24`, `GET ${URL}?page=1&search=h%E1%BB%99i+ngh%E1%BB%8B&type&perPage=24`])
    before = opened.calls.length
    await input(typeSelect(opened), 'image')
    await fire(typeSelect(opened), 'change')
    await settle()
    assert.deepEqual(listCalls(opened, before), [`GET ${URL}?page=1&search=h%E1%BB%99i+ngh%E1%BB%8B&type=image&perPage=24`])
    before = opened.calls.length
    await fire(pager(opened)!, 'update:page', 2)
    await settle()
    assert.deepEqual(listCalls(opened, before), [`GET ${URL}?page=2&search=h%E1%BB%99i+ngh%E1%BB%8B&type=image&perPage=24`])
    assert.equal(pager(opened)!.props.page, 2)
  })

  it('delete asks first, DELETEs and reloads the page on screen; a refusal shows the server\'s sentence', async () => {
    const opened = await open(server({ [`GET ${URL}`]: call => page(TILES, Number(call.url.searchParams.get('page')), 60) }))
    await fire(pager(opened)!, 'update:page', 2)
    await settle()
    const before = opened.calls.length
    await click(findAll(tileOf(opened, 'anh-hoi-nghi.jpg'), el => el.tag === 'button' && textOf(el) === 'Xóa')[0]!)
    await settle()
    assert.match(opened.confirms.at(-1)!.message!, /Bạn có chắc muốn xóa file anh-hoi-nghi\.jpg\?/)
    assert.deepEqual(opened.calls.slice(before).map(wire), [`DELETE ${URL}/5`, `GET ${URL}?page=2&search&type&perPage=24`])
    assert.equal(opened.lastToast('success'), 'Đã xóa tệp media thành công!')
    const refused = await open(server({ [`DELETE ${URL}/5`]: () => h3Error(409, 'Tệp đang được dùng trong bài viết.') }))
    await click(findAll(tileOf(refused, 'anh-hoi-nghi.jpg'), el => el.tag === 'button' && textOf(el) === 'Xóa')[0]!)
    await settle()
    assert.equal(refused.lastToast('error'), 'Tệp đang được dùng trong bài viết.')
  })

  it('bulk delete posts the ticked ids and reloads; the reload narrows the selection', async () => {
    let rows = TILES
    const opened = await open(server({ [`GET ${URL}`]: () => page(rows) }))
    for (const name of ['anh-hoi-nghi.jpg', 'bao-cao.pdf']) {
      await fire(findAll(opened.page.root, el => el.tag === 'input' && el.props['aria-label'] === `Chọn tệp ${name}`)[0]!, 'change')
    }
    await settle()
    const bar = () => findAll(opened.page.root, el => el.tag === 'AdminBulkActionBar')[0]
    assert.equal(bar()?.props.count, 2)
    rows = [TILES[1]!]
    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Tìm kiếm')[0]!)
    await settle()
    assert.equal(bar()?.props.count, 1)
    const before = opened.calls.length
    await click(findAll(bar()!, el => el.tag === 'button' && textOf(el) === 'Xóa')[0]!)
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: `POST ${URL}/bulk-delete`, body: { ids: [6] } }, `GET ${URL}?page=1&search&type&perPage=24`])
  })

  it('a failed load is an alert with the server\'s sentence and "Thử lại" — never "Chưa có file nào"', async () => {
    let fail = true
    const opened = await open(server({ [`GET ${URL}`]: () => (fail ? h3Error(403, 'Bạn không có quyền xem thư viện.') : page(TILES)) }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem thư viện\.\s*Thử lại/)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    assert.equal(opened.lastToast('error'), 'Bạn không có quyền xem thư viện.')
    assert.ok(!screen(opened).includes(EMPTY))
    fail = false
    await click(button(opened, 'Thử lại'))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.deepEqual(names(opened), ['anh-hoi-nghi.jpg', 'bao-cao.pdf'])
  })

  it('FINDING-R8-5: an uploads tree the server could not read (disk null) reads "—" and says so — never "0 B"', async () => {
    const unreadable = { ...STORAGE, local: { dbCount: 10, dbBytes: 1048576, diskCount: null, diskBytes: null } }
    const opened = await open(server({ [`GET ${URL}/storage-size`]: () => json(unreadable) }))
    assert.equal(alertText(opened.page), '')
    assert.deepEqual(opened.page.errors, [])
    assert.match(screen(opened), /Local \/uploads\s*—/)
    assert.doesNotMatch(screen(opened), /Local \/uploads\s*0 B/)
    assert.match(screen(opened), /Không đọc được thư mục uploads/)
    assert.match(screen(opened), /Đã ghi DB \(local\)\s*10 tệp · 1\.0 MB/, 'the database numbers still show')
    assert.doesNotMatch(screen(opened), /Mồ côi|Quét & nhập tệp mồ côi/, 'no orphan count is inferred from an unknown disk')
    // A readable but EMPTY tree is a real 0 — shown as such.
    const empty = await open(server({ [`GET ${URL}/storage-size`]: () => json({ ...STORAGE, local: { dbCount: 0, dbBytes: 0, diskCount: 0, diskBytes: 0 } }) }))
    assert.match(screen(empty), /Local \/uploads\s*0 B/)
    assert.doesNotMatch(screen(empty), /Không đọc được thư mục uploads/)
  })

  it('a failed storage scan is its own alert; the grid stays', async () => {
    const opened = await open(server({ [`GET ${URL}/storage-size`]: () => h3Error(403, 'Không có quyền quét dung lượng.') }))
    assert.equal(alertText(opened.page), 'Không có quyền quét dung lượng.')
    assert.deepEqual(names(opened), ['anh-hoi-nghi.jpg', 'bao-cao.pdf'])
  })

  it('FINDING: the older of two loads, answered last, does not replace the newer one\'s tiles (RED on base)', async () => {
    const held: NetCall[] = []
    let holding = false
    const opened = await open(server({ [`GET ${URL}`]: call => (holding ? (held.push(call), undefined) : page(TILES)) }))
    holding = true
    await input(searchBox(opened), 'báo cáo')
    void click(button(opened, 'Tìm kiếm'))
    await settle()
    await input(typeSelect(opened), 'video')
    void fire(typeSelect(opened), 'change')
    await settle()
    const [searched, videos] = held
    assert.ok(searched && videos, `two loads expected, got ${held.map(wire).join(', ')}`)
    videos!.respond(page([tile(9, 'phong-su.mp4', { mimeType: 'video/mp4' })]))
    await settle()
    searched!.respond(page([TILES[1]!]))
    await settle()
    assert.deepEqual(names(opened), ['phong-su.mp4'], 'the search\'s tiles are shown under the video filter')
  })

  it('FINDING: an older load answered while the newer is in flight keeps the skeleton; failing late shows no error (RED on base)', async () => {
    const held: NetCall[] = []
    let holding = false
    const opened = await open(server({ [`GET ${URL}`]: call => (holding ? (held.push(call), undefined) : page(TILES)) }))
    holding = true
    void click(button(opened, 'Tìm kiếm'))
    await settle()
    void fire(typeSelect(opened), 'change')
    await settle()
    held[0]!.respond(page([TILES[1]!]))
    await settle()
    assert.ok(skeleton(opened), 'the skeleton gave way to the older answer while the newer was in flight')
    held[1]!.respond(page(TILES))
    await settle()
    void click(button(opened, 'Tìm kiếm'))
    await settle()
    void click(button(opened, 'Tìm kiếm'))
    await settle()
    held[3]!.respond(page(TILES))
    await settle()
    held[2]!.respond(h3Error(400, 'Từ khoá không hợp lệ.'))
    await settle()
    assert.equal(alertText(opened.page), '', 'a superseded request\'s failure replaced the tiles')
    assert.deepEqual(names(opened), ['anh-hoi-nghi.jpg', 'bao-cao.pdf'])
  })

  it('the page past the end asks for the LAST page that exists (page 3 of 3), not page 1', async () => {
    let total = 73
    const opened = await open(server({
      [`GET ${URL}`]: (call) => {
        const asked = Number(call.url.searchParams.get('page'))
        const last = Math.ceil(total / 24)
        const items = asked > last ? [] : asked === last ? [tile(5, 'anh-hoi-nghi.jpg')] : TILES
        return page(items, asked, total)
      },
      [`DELETE ${URL}/5`]: () => { total = 72; return json({ ok: true }) },
    }))
    await fire(pager(opened)!, 'update:page', 4)
    await settle()
    const before = opened.calls.length
    await click(findAll(tileOf(opened, 'anh-hoi-nghi.jpg'), el => el.tag === 'button' && textOf(el) === 'Xóa')[0]!)
    await settle()
    assert.deepEqual(listCalls(opened, before), [`GET ${URL}?page=4&search&type&perPage=24`, `GET ${URL}?page=3&search&type&perPage=24`])
    assert.equal(pager(opened)!.props.page, 3)
  })

  it('verify E: a page answering past the end after the page was left asks for nothing more', async () => {
    const held: NetCall[] = []
    let holding = false
    const opened = await open(server({ [`GET ${URL}`]: call => (holding ? (held.push(call), undefined) : page(TILES, Number(call.url.searchParams.get('page')), 80)) }))
    holding = true
    void fire(pager(opened)!, 'update:page', 4)
    await settle()
    const before = opened.calls.length
    opened.page.unmount()
    held[0]!.respond(page([], 4, 50))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [], 'a request was sent after the page was left')
  })

  it('verify E: a delete answered after the page was left reloads nothing', async () => {
    const held: NetCall[] = []
    const opened = await open(server({ [`DELETE ${URL}/5`]: call => { held.push(call); return undefined } }))
    void click(findAll(tileOf(opened, 'anh-hoi-nghi.jpg'), el => el.tag === 'button' && textOf(el) === 'Xóa')[0]!)
    await settle()
    const before = opened.calls.length
    opened.page.unmount()
    held[0]!.respond(json({ ok: true }))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [], 'the list was reloaded for a page that is gone')
  })

  it('FINDING: deleting the last tile of the last page shows the page before it, not "Chưa có file nào" (RED on base)', async () => {
    let total = 25
    const opened = await open(server({
      [`GET ${URL}`]: (call) => {
        const asked = Number(call.url.searchParams.get('page'))
        const items = asked === 2 ? (total > 24 ? [tile(5, 'anh-hoi-nghi.jpg')] : []) : TILES
        return page(items, asked, total)
      },
      [`DELETE ${URL}/5`]: () => { total = 24; return json({ ok: true }) },
    }))
    await fire(pager(opened)!, 'update:page', 2)
    await settle()
    assert.deepEqual(names(opened), ['anh-hoi-nghi.jpg'])
    const before = opened.calls.length
    await click(findAll(tileOf(opened, 'anh-hoi-nghi.jpg'), el => el.tag === 'button' && textOf(el) === 'Xóa')[0]!)
    await settle()
    assert.ok(!screen(opened).includes(EMPTY), 'a library with 24 files says it has none')
    assert.deepEqual(listCalls(opened, before), [`GET ${URL}?page=2&search&type&perPage=24`, `GET ${URL}?page=1&search&type&perPage=24`])
    assert.deepEqual(names(opened), ['anh-hoi-nghi.jpg', 'bao-cao.pdf'])
  })
})
