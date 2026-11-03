/**
 * Wave 3 D-FETCH, batch F: the submissions list — `pages/admin/submissions/index.vue` — a pending
 * item of D-FETCH (lots D/E: "đọc mã nguồn thì tải lại theo bộ lọc không có mã lượt — nghi đua").
 * Its request is a BARE `$fetch` with no cast, its type inferred from the Nitro route; it stays
 * bare (`adminFetch` would trade that inferred type for an unchecked one — no cast to remove).
 *
 * The REAL page is mounted over REAL ofetch on a fake network. Pinned, green before and after:
 * the query of the mount (from the URL), of a status tile and of the "viewed" select; the rows
 * and the counts; a failed or `ok: false` load shows a `role="alert"` with "thử lại".
 *
 * FINDINGS, RED on the base (551651c7) — every filter change reloads (`watch`), the bulk
 * actions and the detail dialog reload too, and nothing said which answer was the latest:
 *   - pick a status tile, then "Chưa ai xem" before the first answer: the older answer landing
 *     last showed rows of the first filter under the second ("đơn đã xem" under "Chưa ai xem");
 *   - the older request FAILING last put an error over the newer request's rows;
 *   - the older request settling first ended the skeleton while the newer was still in flight,
 *     showing the older filter's rows meanwhile.
 * Only the latest request writes rows, counts, error and loading now (the ticket of
 * docs/decisions/fetch-rollout-d-fetch.md).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { fire, findAll, input, textOf } from './_sfc-mount.ts'
import {
  alertText, h3Error, json, mountAdminPage, OFETCH_LINE, routes, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const PAGE = 'pages/admin/submissions/index.vue'
const LIST = '/api/admin/submissions'
const STAMP = '2026-10-20T02:00:00.000Z'
const row = (id: number, fullName: string, over: Record<string, unknown> = {}) => ({
  id, fullName, phone: `09000000${id}`, email: null, address: 'Tam Hưng', message: 'Hoàn cảnh', answers: null,
  formTitle: 'Đăng ký hỗ trợ', status: 'new', statusChangedAt: null, statusChangedByName: null, firstViewedAt: null,
  notifiedAt: STAMP, createdAt: STAMP, ...over,
})
const ALL = [row(12, 'Nguyễn Văn A'), row(13, 'Trần Thị B', { firstViewedAt: STAMP })]
const listAnswer = (rows: unknown[], counts: Record<string, number> = { new: 2 }) => json({ ok: true, submissions: rows, counts })

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({ [`GET ${LIST}`]: () => listAnswer(ALL), ...overrides })
}
const open = (responder = server(), query: Record<string, unknown> = {}) =>
  mountAdminPage(PAGE, responder, { route: { query }, auto: { formatDateTimeVN: (v: unknown) => String(v) } })

/** Names on the desktop table, one per row. */
const names = (opened: MountedAdminPage) =>
  findAll(opened.page.root, el => el.tag === 'tbody').flatMap(body => findAll(body, el => el.tag === 'tr'))
    .map(tr => ALL.find(r => textOf(tr).includes(r.fullName))?.fullName ?? textOf(tr))
const loadingShown = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props['aria-busy'] === 'true').length > 0
const tile = (opened: MountedAdminPage, label: string) =>
  findAll(opened.page.root, el => el.tag === 'button' && el.props['aria-pressed'] !== undefined && textOf(el).startsWith(label))[0]!
const viewedSelect = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'select' && el.props['aria-label'] === 'Lọc theo lượt xem')[0]!
const listCalls = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(call => call.url.pathname === LIST)

/** A server whose list answers wait for the test (`pending`), in arrival order. */
function heldServer() {
  const pending: NetCall[] = []
  let first = true
  const responder = server({
    [`GET ${LIST}`]: (call) => {
      if (first) { first = false; return listAnswer(ALL) }
      pending.push(call)
      return undefined
    },
  })
  return { responder, pending }
}

describe(PAGE, () => {
  it('mount: the URL\'s filters go to the server; rows and the status counts render', async () => {
    const opened = await open(server(), { status: 'new', viewed: 'no' })
    assert.deepEqual(opened.calls.map(wire), [`GET ${LIST}?status=new&viewed=no`])
    assert.deepEqual(names(opened), ['Nguyễn Văn A', 'Trần Thị B'])
    assert.match(textOf(tile(opened, 'Tất cả')), /2/)
    assert.equal(alertText(opened.page), '')
  })

  it('a status tile and the "viewed" select each reload with their filter', async () => {
    const opened = await open()
    assert.deepEqual(opened.calls.map(wire), [`GET ${LIST}`])
    await fire(tile(opened, 'Mới'), 'click')
    await settle()
    await input(viewedSelect(opened), 'yes')
    await settle()
    assert.deepEqual(listCalls(opened, 1).map(wire), [`GET ${LIST}?status=new`, `GET ${LIST}?status=new&viewed=yes`])
  })

  it('a failed load: the server\'s sentence in role="alert" with "thử lại"; `ok: false` the page\'s', async () => {
    const opened = await open(server({ [`GET ${LIST}`]: () => h3Error(403, 'Bạn không có quyền xem đơn.') }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem đơn\. Vui lòng thử lại\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    const notOk = await open(server({ [`GET ${LIST}`]: () => json({ ok: false }) }))
    assert.match(alertText(notOk.page), /Không tải được danh sách đơn đăng ký\./)
  })

  it('FINDING: the older filter\'s answer landing last does not replace the newer filter\'s rows', async () => {
    const { responder, pending } = heldServer()
    const opened = await open(responder)
    await fire(tile(opened, 'Mới'), 'click')
    await settle()
    await input(viewedSelect(opened), 'no')
    await settle()
    assert.equal(pending.length, 2)
    pending[1]!.respond(listAnswer([ALL[0]], { new: 1 }))
    await settle()
    assert.deepEqual(names(opened), ['Nguyễn Văn A'])
    pending[0]!.respond(listAnswer(ALL))
    await settle()
    assert.deepEqual(names(opened), ['Nguyễn Văn A'])
    assert.ok(!loadingShown(opened))
  })

  it('FINDING: the older request failing last does not put an error over the newer rows', async () => {
    const { responder, pending } = heldServer()
    const opened = await open(responder)
    await fire(tile(opened, 'Mới'), 'click')
    await settle()
    await input(viewedSelect(opened), 'no')
    await settle()
    pending[1]!.respond(listAnswer([ALL[0]], { new: 1 }))
    await settle()
    // 403: ofetch retries a GET on 5xx, and the retry would wait here unanswered.
    pending[0]!.respond(h3Error(403, 'Lỗi cũ.'))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.deepEqual(names(opened), ['Nguyễn Văn A'])
  })

  it('FINDING: the older request settling first keeps the skeleton until the newer one is back', async () => {
    const { responder, pending } = heldServer()
    const opened = await open(responder)
    await fire(tile(opened, 'Mới'), 'click')
    await settle()
    await input(viewedSelect(opened), 'no')
    await settle()
    pending[0]!.respond(listAnswer(ALL))
    await settle()
    assert.ok(loadingShown(opened), 'still loading the newer filter')
    assert.deepEqual(names(opened), [])
    pending[1]!.respond(listAnswer([ALL[0]], { new: 1 }))
    await settle()
    assert.ok(!loadingShown(opened))
    assert.deepEqual(names(opened), ['Nguyễn Văn A'])
  })
})
