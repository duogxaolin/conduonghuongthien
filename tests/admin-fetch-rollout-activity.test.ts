/**
 * Wave 3 D-FETCH, batch E: the system-wide activity log — `pages/admin/users/activity.vue`
 * (3 `$fetch` casts) — calls `adminFetch<T>()` with response types derived from the handlers
 * (app/types/admin-users-api.ts, `ActivityRetentionStatus` in app/types/admin-api.ts).
 *
 * The REAL page — `<script setup>` and template — is mounted (tests/_admin-page-harness.ts)
 * over REAL ofetch on a fake network. Pinned, green before and after the conversion:
 *   - the three requests of the mount, and the exact query string of every filter / page /
 *     reset (`params:` became `query:` — the wire must not change);
 *   - the rows, the account filter filled from `/api/admin/users`, the retention panel;
 *   - a failure shows the sentence the SERVER wrote in a `role="alert"` with "thử lại", never
 *     ofetch's `[GET] "…"` line; "thử lại" asks again for the same page with the same filters;
 *   - the account list and the retention panel failing does not take the log down with them.
 *
 * FINDINGS, RED on the base (88073004):
 *   - a failed load showed the alert AND "Không có bản ghi nào khớp điều kiện lọc." under it —
 *     the alert sat outside the loading/empty chain, so the failure also read as "nothing
 *     matched" (the "lỗi lẫn rỗng" of batches C/D);
 *   - the list had no notion of "the latest request": filter by an account, then "Xoá lọc"
 *     before the first answer is back — the older (filtered) answer landing last showed one
 *     account's trail under cleared filters, and its late failure or its `finally` overwrote
 *     the newer request's state. Only the latest load writes rows, totals, error and loading
 *     now (the ticket pattern of docs/decisions/fetch-rollout-d-fetch.md).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { byText, click, findAll, fire, input, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const PAGE = 'pages/admin/users/activity.vue'
const LOGS = '/api/admin/activity-logs'
const EMPTY = 'Không có bản ghi nào khớp điều kiện lọc.'

const logRow = (id: number, username: string | null, over: Record<string, unknown> = {}) => ({
  id, userId: username ? 1 : null, username, action: 'login', resource: 'auth', resourceId: null,
  createdAt: '2026-10-20T02:00:00.000Z', ip: '10.0.0.1', userAgent: null, mfaMethod: null, phase: null, ...over,
})
const ROWS = [logRow(2, 'admin'), logRow(1, 'bientap', { userId: 5, action: 'update', resource: 'articles', resourceId: 42 })]
const logsAnswer = (items: unknown[] = ROWS, over: Record<string, unknown> = {}) =>
  json({ ok: true, page: 1, pageSize: 25, total: items.length, totalPages: 1, items, ...over })
const RETENTION = {
  ok: true, total: 1200, overdue: 0, oldest: '2026-01-01T00:00:00.000Z', newest: '2026-10-20T00:00:00.000Z',
  retentionDays: 180, maxRows: 0, purgedTotal: 0, lifetimeTotal: 1200, overRowCap: 0, lastRunAt: null, lastDeleted: 0,
  purgeDisabled: false, purgeOverdue: false, command: 'npm run analytics:maintenance',
}

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    [`GET ${LOGS}`]: () => logsAnswer(),
    'GET /api/admin/users': () => json({ ok: true, users: [{ id: 1, username: 'admin' }, { id: 5, username: 'bientap' }] }),
    [`GET ${LOGS}/retention`]: () => json(RETENTION),
    ...overrides,
  })
}

const open = (responder = server()) => mountAdminPage(PAGE, responder)
const screen = (opened: MountedAdminPage) => textOf(opened.page.root)
/** The control inside the `<label>` whose text starts with `label`. */
const control = (opened: MountedAdminPage, label: string, tag: 'select' | 'input') => {
  const owner = findAll(opened.page.root, el => el.tag === 'label' && textOf(el).startsWith(label))[0]
  assert.ok(owner, `no "${label}" label`)
  return findAll(owner, el => el.tag === tag)[0]!
}
const button = (opened: MountedAdminPage, label: string) => findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === label)[0]!
const pager = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'AdminPagination')[0]!
const skeleton = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'SkeletonTable').length === 1
/** Desktop table rows: the account cell of each. */
const accountsShown = (opened: MountedAdminPage) =>
  findAll(opened.page.root, el => el.tag === 'tbody').flatMap(body => findAll(body, el => el.tag === 'tr'))
    .map(tr => textOf(findAll(tr, el => el.tag === 'td')[1]!))
const logCalls = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(call => call.url.pathname === LOGS)

async function filterBy(opened: MountedAdminPage, values: { user?: string, action?: string, resource?: string, from?: string, to?: string }) {
  if (values.user !== undefined) await input(control(opened, 'Tài khoản', 'select'), values.user)
  if (values.action !== undefined) await input(control(opened, 'Hoạt động', 'select'), values.action)
  if (values.resource !== undefined) await input(control(opened, 'Đối tượng', 'select'), values.resource)
  if (values.from !== undefined) await input(control(opened, 'Từ ngày', 'input'), values.from)
  if (values.to !== undefined) await input(control(opened, 'Đến ngày', 'input'), values.to)
}
/** Press a button without waiting for the load it starts — for a request the test answers later. */
async function press(el: MiniElement) {
  void click(el)
  await settle()
}

describe(PAGE, () => {
  it('mount: the log page 1, the account list and the retention status; the rows, the accounts and the panel render', async () => {
    const opened = await open()
    assert.deepEqual(opened.calls.map(wire), [`GET ${LOGS}?page=1&pageSize=25`, 'GET /api/admin/users', `GET ${LOGS}/retention`])
    assert.deepEqual(accountsShown(opened), ['admin', 'bientap'])
    assert.match(screen(opened), /Cập nhật · Bài viết #42/)
    assert.deepEqual(findAll(control(opened, 'Tài khoản', 'select'), el => el.tag === 'option').map(textOf), ['Tất cả', 'admin', 'bientap'])
    assert.match(screen(opened), /Tổng bản ghi\s*1\.200/)
    assert.match(screen(opened), /180 ngày/)
    assert.equal(alertText(opened.page), '')
    assert.ok(!skeleton(opened))
  })

  it('"Lọc" asks for page 1 with every filter set; "Xoá lọc" clears the controls and asks without them', async () => {
    const opened = await open()
    await filterBy(opened, { user: '5', action: 'update', resource: 'articles', from: '2026-10-01', to: '2026-10-28' })
    const before = opened.calls.length
    await click(button(opened, 'Lọc'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [
      `GET ${LOGS}?page=1&pageSize=25&userId=5&action=update&resource=articles&from=2026-10-01&to=2026-10-28`,
    ])
    const next = opened.calls.length
    await click(button(opened, 'Xoá lọc'))
    await settle()
    assert.deepEqual(opened.calls.slice(next).map(wire), [`GET ${LOGS}?page=1&pageSize=25`])
    for (const [label, tag] of [['Tài khoản', 'select'], ['Hoạt động', 'select'], ['Đối tượng', 'select'], ['Từ ngày', 'input'], ['Đến ngày', 'input']] as const) {
      assert.equal(control(opened, label, tag).model?.value, '', `${label} not cleared`)
    }
  })

  it('the pager asks for the page it emits with the filters on screen; a page outside 1..totalPages is ignored', async () => {
    const opened = await open(server({ [`GET ${LOGS}`]: call => logsAnswer(ROWS, { page: Number(call.url.searchParams.get('page')), total: 60, totalPages: 3 }) }))
    await filterBy(opened, { action: 'login' })
    const before = opened.calls.length
    await fire(pager(opened), 'update:page', 2)
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${LOGS}?page=2&pageSize=25&action=login`])
    assert.equal(pager(opened).props.page, 2)
    assert.equal(pager(opened).props.total, 60)
    const next = opened.calls.length
    await fire(pager(opened), 'update:page', 4)
    await fire(pager(opened), 'update:page', 0)
    await settle()
    assert.equal(opened.calls.length, next)
  })

  it('a failed load shows the server\'s sentence with "thử lại", which asks again for the same page and filters', async () => {
    let fail = true
    const opened = await open(server({
      [`GET ${LOGS}`]: call => (fail && call.url.searchParams.get('page') === '2'
        ? h3Error(403, 'Bạn không có quyền xem nhật ký hoạt động.')
        : logsAnswer(ROWS, { page: Number(call.url.searchParams.get('page')), total: 60, totalPages: 3 })),
    }))
    await filterBy(opened, { resource: 'auth' })
    await fire(pager(opened), 'update:page', 2)
    await settle()
    assert.match(alertText(opened.page), /^Bạn không có quyền xem nhật ký hoạt động\. Vui lòng thử lại\.$/)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    fail = false
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${LOGS}?page=2&pageSize=25&resource=auth`])
    assert.equal(alertText(opened.page), '')
    assert.deepEqual(accountsShown(opened), ['admin', 'bientap'])
  })

  it('a dropped connection reads as the page\'s own sentence, not ofetch\'s line', async () => {
    const opened = await open(server({ [`GET ${LOGS}`]: () => dropped() }))
    assert.match(alertText(opened.page), /^Không tải được lịch sử hoạt động\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
  })

  it('the account list and the retention panel failing leave the log on screen (best-effort extras)', async () => {
    const opened = await open(server({
      'GET /api/admin/users': () => h3Error(403, 'Không có quyền.'),
      [`GET ${LOGS}/retention`]: () => dropped(),
    }))
    assert.deepEqual(accountsShown(opened), ['admin', 'bientap'])
    assert.deepEqual(findAll(control(opened, 'Tài khoản', 'select'), el => el.tag === 'option').map(textOf), ['Tất cả'])
    assert.doesNotMatch(screen(opened), /Tổng bản ghi/)
    assert.equal(alertText(opened.page), '')
  })

  it('an overdue purge is spelled out with the command to schedule', async () => {
    const opened = await open(server({ [`GET ${LOGS}/retention`]: () => json({ ...RETENTION, overdue: 340, purgeOverdue: true }) }))
    assert.match(screen(opened), /Có 340 bản ghi vượt thời hạn 180 ngày nhưng chưa bị xoá\./)
    assert.match(screen(opened), /npm run analytics:maintenance/)
  })

  it('FINDING: a row without a time (`created_at` is nullable) reads "—", not 1 Jan 1970 (RED on base)', async () => {
    // The hand-written `LogItem` said `createdAt: string`; the handler's type says `string | null`.
    // `new Date(null)` is the epoch, a VALID date — the row claimed to be from 1970.
    const opened = await open(server({ [`GET ${LOGS}`]: () => logsAnswer([logRow(9, 'admin', { createdAt: null })]) }))
    const row = findAll(opened.page.root, el => el.tag === 'tbody').flatMap(body => findAll(body, el => el.tag === 'tr'))[0]!
    assert.equal(textOf(findAll(row, el => el.tag === 'td')[0]!), '—')
    assert.doesNotMatch(screen(opened), /1970/)
  })

  it('FINDING: a failed load is not also shown as "no record matched" (RED on base)', async () => {
    const opened = await open(server({ [`GET ${LOGS}`]: () => h3Error(503, 'Cơ sở dữ liệu đang bảo trì.') }))
    assert.match(alertText(opened.page), /Cơ sở dữ liệu đang bảo trì\./)
    assert.ok(!screen(opened).includes(EMPTY), 'the failure also reads as "nothing matched the filters"')
  })

  it('FINDING: the older of two loads, answered last, does not replace the newer one\'s rows (RED on base)', async () => {
    const held: NetCall[] = []
    let holding = false
    const opened = await open(server({ [`GET ${LOGS}`]: call => (holding ? (held.push(call), undefined) : logsAnswer()) }))
    holding = true
    await filterBy(opened, { user: '5' })
    await press(button(opened, 'Lọc'))
    await press(button(opened, 'Xoá lọc'))
    const [filtered, cleared] = held
    assert.ok(filtered && cleared, `two loads expected, got ${held.map(wire).join(', ')}`)
    assert.equal(filtered!.url.searchParams.get('userId'), '5')
    assert.equal(cleared!.url.searchParams.get('userId'), null)
    cleared!.respond(logsAnswer(ROWS))
    await settle()
    filtered!.respond(logsAnswer([logRow(1, 'bientap', { userId: 5 })]))
    await settle()
    assert.deepEqual(accountsShown(opened), ['admin', 'bientap'], 'one account\'s trail is shown under cleared filters')
    assert.ok(!skeleton(opened))
  })

  it('FINDING: an older load answered while the newer is in flight neither ends the loading state nor shows its rows (RED on base)', async () => {
    const held: NetCall[] = []
    let holding = false
    const opened = await open(server({ [`GET ${LOGS}`]: call => (holding ? (held.push(call), undefined) : logsAnswer()) }))
    holding = true
    await filterBy(opened, { user: '5' })
    await press(button(opened, 'Lọc'))
    await press(button(opened, 'Xoá lọc'))
    held[0]!.respond(logsAnswer([logRow(1, 'bientap', { userId: 5 })]))
    await settle()
    assert.ok(skeleton(opened), 'the skeleton gave way while the latest load was still in flight')
    assert.deepEqual(accountsShown(opened), [])
    held[1]!.respond(logsAnswer(ROWS))
    await settle()
    assert.deepEqual(accountsShown(opened), ['admin', 'bientap'])
  })

  it('FINDING: an older load failing after the newer one succeeded shows no error (RED on base)', async () => {
    const held: NetCall[] = []
    let holding = false
    const opened = await open(server({ [`GET ${LOGS}`]: call => (holding ? (held.push(call), undefined) : logsAnswer()) }))
    holding = true
    await filterBy(opened, { user: '5' })
    await press(button(opened, 'Lọc'))
    await press(button(opened, 'Xoá lọc'))
    held[1]!.respond(logsAnswer(ROWS))
    await settle()
    // 400, not 5xx: ofetch retries a GET on 5xx by itself, which would hold the failure back.
    held[0]!.respond(h3Error(400, 'Giá trị userId không hợp lệ.'))
    await settle()
    assert.equal(alertText(opened.page), '', 'a superseded request\'s failure is shown over the current rows')
    assert.deepEqual(accountsShown(opened), ['admin', 'bientap'])
    assert.equal(logCalls(opened).length, 3)
  })
})
