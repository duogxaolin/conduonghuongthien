/**
 * Wave 3 D-FETCH, batch E: the video library list — `pages/admin/media-portal/index.vue` (3
 * `$fetch` casts) — calls `adminFetch<T>()` with response types derived from the handlers
 * (`AdminMediaPage`/`AdminMediaConfig` in app/types/admin-api.ts, the delete answer in
 * app/types/admin-media-portal-api.ts).
 *
 * The REAL page is mounted (tests/_admin-page-harness.ts) over REAL ofetch on a fake network.
 * Pinned, green before and after the conversion:
 *   - the list read on mount, from the URL's `search`/`status`/`source`/`page` (absent filters are
 *     not sent — `params:` became `query:`, the wire must not change), and the upload config;
 *   - a filter writes the URL and asks for page 1; the pager asks for its page; delete asks first,
 *     DELETEs, reloads;
 *   - a failed load is a `role="alert"` with the server's sentence and "thử lại", never "Chưa có
 *     video nào", never ofetch's `[GET] "…"` line.
 *
 * FINDINGS, RED on the base (88073004):
 *   - the list and the upload config were one `Promise.all`: the config failing (it answers only
 *     the "Tải video lên" button) replaced a list that HAD loaded with "Không tải được danh sách
 *     video." — and it was re-read on every filter and page. It is read once, on its own now;
 *   - the page lived in the URL only on paper (the page's own doc: "sống qua F5"): the pager
 *     never wrote it, so F5 or a shared link went back to page 1;
 *   - no notion of "the latest request": pick "Bản nháp" (slow), then "YouTube" — the older
 *     answer landing last showed the drafts under the YouTube filter;
 *   - deleting the last video of the last page reloaded a page past the end (the service does not
 *     clamp): "Chưa có video nào" — and the pager lives in the data branch, so there was no way
 *     back but clearing the filters. It asks once for the last page that exists.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { byText, click, findAll, fire, input, textOf } from './_sfc-mount.ts'
import {
  alertText, h3Error, json, mountAdminPage, OFETCH_LINE, routes, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const PAGE = 'pages/admin/media-portal/index.vue'
const URL = '/api/admin/media-portal'
const EMPTY = 'Chưa có video nào'
const video = (id: number, title: string, over: Record<string, unknown> = {}) => ({
  id, title, slug: `v-${id}`, categoryName: null, source: 'upload', durationSeconds: 125, status: 'published',
  processingStatus: 'ready', viewCount: 1500, updatedAt: '2026-10-20T02:00:00.000Z', ...over,
})
const VIDEOS = [video(7, 'Lễ ra trại'), video(8, 'Phóng sự hoàn lương', { source: 'youtube', status: 'draft' })]
const listAnswer = (items: unknown[], page = 1, total = items.length) => json({ ok: true, items, total, page, limit: 20 })
const CONFIG = { ok: true, uploadEnabled: true, maxUploadSize: 1073741824, categories: [] }

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    [`GET ${URL}`]: call => listAnswer(VIDEOS, Number(call.url.searchParams.get('page') ?? 1)),
    [`GET ${URL}/config`]: () => json(CONFIG),
    [`DELETE ${URL}/7`]: () => json({ ok: true }),
    ...overrides,
  })
}

const open = (responder = server(), query: Record<string, unknown> = {}) => mountAdminPage(PAGE, responder, { route: { query } })
const screen = (opened: MountedAdminPage) => textOf(opened.page.root)
const titles = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'tbody').flatMap(body => findAll(body, el => el.tag === 'tr'))
  .map(tr => textOf(findAll(tr, el => el.tag === 'div')[0]!))
const select = (opened: MountedAdminPage, label: string) => findAll(opened.page.root, el => el.tag === 'select' && el.props['aria-label'] === label)[0]!
const listCalls = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(c => c.url.pathname === URL).map(wire)
const nextPage = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button' && findAll(el, i => i.tag === 'i' && String(i.props.class).includes('fa-chevron-right')).length > 0)[0]!
async function pick(opened: MountedAdminPage, label: string, value: string, wait = true) {
  await input(select(opened, label), value)
  const done = fire(select(opened, label), 'change')
  if (wait) await done
  await settle()
}

describe(PAGE, () => {
  it('mount: page 1 without the absent filters, and the upload config; rows and "Tải video lên" render', async () => {
    const opened = await open()
    assert.deepEqual(opened.calls.map(wire), [`GET ${URL}?page=1&limit=20`, `GET ${URL}/config`])
    assert.deepEqual(titles(opened), ['Lễ ra trại', 'Phóng sự hoàn lương'])
    assert.match(screen(opened), /2:05/)
    assert.match(screen(opened), /Tải video lên/)
    assert.equal(alertText(opened.page), '')
  })

  it('the URL\'s filters and page are the first request, and fill the controls', async () => {
    const opened = await open(server({ [`GET ${URL}`]: call => listAnswer(VIDEOS, Number(call.url.searchParams.get('page')), 45) }),
      { search: 'lễ', status: 'published', source: 'youtube', page: '2' })
    assert.deepEqual(listCalls(opened), [`GET ${URL}?page=2&limit=20&search=l%E1%BB%85&status=published&source=youtube`])
    assert.equal(select(opened, 'Lọc trạng thái xuất bản').model?.value, 'published')
    assert.match(screen(opened), /Trang 2 \/ 3/)
  })

  it('a filter writes the URL and asks for page 1; the pager asks for the next page', async () => {
    const opened = await open(server({ [`GET ${URL}`]: call => listAnswer(VIDEOS, Number(call.url.searchParams.get('page')), 45) }))
    let before = opened.calls.length
    await pick(opened, 'Lọc trạng thái xuất bản', 'draft')
    assert.deepEqual(opened.pushes.at(-1), { query: { status: 'draft' } })
    assert.deepEqual(listCalls(opened, before), [`GET ${URL}?page=1&limit=20&status=draft`])
    before = opened.calls.length
    await click(nextPage(opened))
    await settle()
    assert.deepEqual(listCalls(opened, before), [`GET ${URL}?page=2&limit=20&status=draft`])
  })

  it('delete asks first, DELETEs, toasts and reloads; a refusal shows the server\'s sentence', async () => {
    const opened = await open()
    const row = findAll(opened.page.root, el => el.tag === 'tr' && textOf(el).includes('Lễ ra trại'))[0]!
    const before = opened.calls.length
    await click(findAll(row, el => el.tag === 'button')[0]!)
    await settle()
    assert.match(opened.confirms.at(-1)!.message!, /Xoá video "Lễ ra trại"\?/)
    assert.deepEqual(listCalls(opened, before).concat(opened.calls.slice(before).filter(c => c.method === 'DELETE').map(wire)),
      [`GET ${URL}?page=1&limit=20`, `DELETE ${URL}/7`])
    assert.equal(opened.lastToast('success'), 'Đã xoá video.')
    const refused = await open(server({ [`DELETE ${URL}/7`]: () => h3Error(409, 'Video đang phát trực tiếp, không xoá được.') }))
    await click(findAll(findAll(refused.page.root, el => el.tag === 'tr' && textOf(el).includes('Lễ ra trại'))[0]!, el => el.tag === 'button')[0]!)
    await settle()
    assert.equal(refused.lastToast('error'), 'Video đang phát trực tiếp, không xoá được.')
  })

  it('a failed list is an alert with the server\'s sentence and "thử lại" — never "Chưa có video nào"', async () => {
    let fail = true
    const opened = await open(server({ [`GET ${URL}`]: () => (fail ? h3Error(403, 'Bạn không có quyền xem thư viện video.') : listAnswer(VIDEOS)) }))
    assert.match(alertText(opened.page), /^Bạn không có quyền xem thư viện video\. Vui lòng thử lại\.$/)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    assert.ok(!screen(opened).includes(EMPTY))
    fail = false
    await click(byText(opened.page.root, 'button', 'thử lại'))
    await settle()
    assert.deepEqual(titles(opened), ['Lễ ra trại', 'Phóng sự hoàn lương'])
  })

  it('FINDING: the upload config failing does not replace a list that loaded (RED on base)', async () => {
    const opened = await open(server({ [`GET ${URL}/config`]: () => h3Error(400, 'Cấu hình media không hợp lệ.') }))
    assert.equal(alertText(opened.page), '', 'the list is replaced by an error about the config')
    assert.deepEqual(titles(opened), ['Lễ ra trại', 'Phóng sự hoàn lương'])
    assert.doesNotMatch(screen(opened), /Tải video lên/)
  })

  it('FINDING: the pager writes the page into the URL, so F5 and a shared link keep it (RED on base)', async () => {
    const opened = await open(server({ [`GET ${URL}`]: call => listAnswer(VIDEOS, Number(call.url.searchParams.get('page')), 45) }), { source: 'upload' })
    await click(nextPage(opened))
    await settle()
    assert.deepEqual(opened.pushes.at(-1), { query: { source: 'upload', page: 2 } })
  })

  it('FINDING: the older of two filter loads, answered last, does not replace the newer one\'s rows (RED on base)', async () => {
    const held: NetCall[] = []
    let holding = false
    const opened = await open(server({ [`GET ${URL}`]: call => (holding ? (held.push(call), undefined) : listAnswer(VIDEOS)) }))
    holding = true
    await pick(opened, 'Lọc trạng thái xuất bản', 'draft', false)
    await pick(opened, 'Lọc nguồn video', 'youtube', false)
    const lists = held.filter(c => c.url.pathname === URL)
    assert.equal(lists.length, 2, lists.map(wire).join(', '))
    lists[1]!.respond(listAnswer([VIDEOS[1]!]))
    await settle()
    lists[0]!.respond(listAnswer([video(9, 'Nháp tải lên', { status: 'draft' })]))
    await settle()
    assert.deepEqual(titles(opened), ['Phóng sự hoàn lương'], 'the drafts are shown under the YouTube filter')
  })

  it('FINDING: an older load answered while the newer is in flight keeps the skeleton; failing late shows no error (RED on base)', async () => {
    const held: NetCall[] = []
    let holding = false
    const opened = await open(server({ [`GET ${URL}`]: call => (holding ? (held.push(call), undefined) : listAnswer(VIDEOS)) }))
    holding = true
    await pick(opened, 'Lọc trạng thái xuất bản', 'draft', false)
    await pick(opened, 'Lọc nguồn video', 'youtube', false)
    const lists = () => held.filter(c => c.url.pathname === URL)
    lists()[0]!.respond(listAnswer([video(9, 'Nháp tải lên', { status: 'draft' })]))
    await settle()
    assert.ok(findAll(opened.page.root, el => el.props['aria-busy'] === 'true').length > 0, 'the loading state ended on the older answer')
    lists()[1]!.respond(listAnswer([VIDEOS[1]!]))
    await settle()
    await pick(opened, 'Lọc nguồn video', 'upload', false)
    await pick(opened, 'Lọc nguồn video', 'youtube', false)
    lists()[3]!.respond(listAnswer([VIDEOS[1]!]))
    await settle()
    lists()[2]!.respond(h3Error(400, 'Giá trị nguồn không hợp lệ.'))
    await settle()
    assert.equal(alertText(opened.page), '', 'a superseded request\'s failure replaced the rows')
    assert.deepEqual(titles(opened), ['Phóng sự hoàn lương'])
  })

  it('a filter picked on page 2 asks for page 1 and drops the page from the URL', async () => {
    const opened = await open(server({ [`GET ${URL}`]: call => listAnswer(VIDEOS, Number(call.url.searchParams.get('page')), 45) }))
    await click(nextPage(opened))
    await settle()
    const before = opened.calls.length
    await pick(opened, 'Lọc nguồn video', 'upload')
    assert.deepEqual(listCalls(opened, before), [`GET ${URL}?page=1&limit=20&source=upload`])
    assert.deepEqual(opened.pushes.at(-1), { query: { source: 'upload' } })
  })

  it('verify E: a list answer landing after the page was left neither rewrites the URL nor asks again', async () => {
    const held: NetCall[] = []
    const opened = await open(server({ [`GET ${URL}`]: call => { held.push(call); return undefined } }), { page: '9' })
    const pushes = opened.pushes.length
    const before = opened.calls.length
    opened.page.unmount()
    // Page 9 of 2: the "last page that exists" path — which used to call router.replace and fetch again.
    held[0]!.respond(listAnswer([], 9, 25))
    await settle()
    assert.deepEqual(opened.pushes.slice(pushes), [], 'router.replace ran after the page was left (the URL of the NEXT page)')
    assert.deepEqual(opened.calls.slice(before).map(wire), [], 'a request was sent after the page was left')
  })

  it('verify E: the upload config failing at mount is read again with the next load, so "Tải video lên" comes back', async () => {
    let configCalls = 0
    const opened = await open(server({ [`GET ${URL}/config`]: () => (++configCalls === 1 ? h3Error(400, 'Tạm thời lỗi.') : json(CONFIG)) }))
    assert.doesNotMatch(screen(opened), /Tải video lên/)
    await pick(opened, 'Lọc trạng thái xuất bản', 'draft')
    assert.equal(configCalls, 2, 'the config is not read again while it is missing')
    assert.match(screen(opened), /Tải video lên/)
    await pick(opened, 'Lọc trạng thái xuất bản', 'published')
    assert.equal(configCalls, 2, 'a config already read is read again on every load')
  })

  it('FINDING: deleting the last video of the last page shows the page before it, not "Chưa có video nào" (RED on base)', async () => {
    let total = 21
    const opened = await open(server({
      [`GET ${URL}`]: (call) => {
        const asked = Number(call.url.searchParams.get('page'))
        return listAnswer(asked === 2 ? (total > 20 ? [VIDEOS[0]!] : []) : VIDEOS, asked, total)
      },
      [`DELETE ${URL}/7`]: () => { total = 20; return json({ ok: true }) },
    }))
    await click(nextPage(opened))
    await settle()
    assert.deepEqual(titles(opened), ['Lễ ra trại'])
    await click(findAll(findAll(opened.page.root, el => el.tag === 'tr' && textOf(el).includes('Lễ ra trại'))[0]!, el => el.tag === 'button')[0]!)
    await settle()
    assert.ok(!screen(opened).includes(EMPTY), 'a library with 20 videos says it has none, with no pager to go back')
    assert.deepEqual(titles(opened), ['Lễ ra trại', 'Phóng sự hoàn lương'])
    assert.deepEqual(opened.pushes.at(-1), { query: {} }, 'the URL still says page 2')
  })
})
