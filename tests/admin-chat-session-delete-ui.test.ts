/**
 * Xoá phiên trò chuyện theo yêu cầu của người dân (CHANGELOG § 67): the two routes that had
 * no caller in `app/` — `DELETE /api/admin/chatbot/sessions/:id` (detail page, "Xóa phiên
 * này") and `POST /api/admin/chatbot/sessions/bulk-delete` (list page, tick rows → "Xóa
 * vĩnh viễn") — now have one each.
 *
 * The REAL pages (`<script setup>` + template, tests/_admin-page-harness.ts) over REAL ofetch
 * on a fake network, with the real `useAdminList` and `useBulkSelection<string>`. Pinned:
 *   - the wire: method, path, the body `{ ids: [<string ids>] }` exactly as ticked;
 *   - nothing is sent before the confirm is accepted; the confirm names the count and says
 *     it cannot be undone;
 *   - without `chatbot_knowledge.delete` (what both handlers require) no checkbox, no
 *     strip, no button;
 *   - the bulk route answers `{ ok, deleted: <count> }` with no per-id result: a count below
 *     what was sent (another officer, the retention purge) is a warning naming the gap;
 *   - the list reloads after a delete, and a now-empty last page asks once for the page
 *     before it (useAdminList — the list route echoes the page unclamped);
 *   - a refusal shows the server's sentence, a dropped connection the page's fallback,
 *     never ofetch's `[POST] "…"` line;
 *   - the detail page leaves for the list after a delete, and after a 404 (gone already —
 *     the route's own 404 sentence is English, so the page says it in Vietnamese);
 *   - one request per click while one is out.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { byText, click, findAll, fire, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined
const STAMP = '2026-10-20T02:00:00.000Z'
const LIST_URL = '/api/admin/chatbot/sessions'
const BULK_URL = '/api/admin/chatbot/sessions/bulk-delete'

function assertOnlyServerSentences(opened: MountedAdminPage) {
  for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
}
const noDelete = (resource: string, action: string) => !(resource === 'chatbot_knowledge' && action === 'delete')

// ─── pages/admin/chatbot/sessions/index.vue ──────────────────────────────────

const LIST_PAGE = 'pages/admin/chatbot/sessions/index.vue'
const session = (id: string, name: string | null = null) => ({
  id, ip: `ip-${id}`, browser: 'Chrome trên Android', detectedPhone: name ? '0900000001' : null, detectedName: name,
  messageCount: 3, startedAt: STAMP, lastMessageAt: STAMP,
})

/**
 * A list route over a mutable table, 25 per page, echoing the requested page unclamped
 * (like `sessions/index.get.ts`); the bulk route deletes the ids it still has and
 * answers the count, like `bulk-delete.post.ts`.
 */
function sessionServer(table: Array<ReturnType<typeof session>>, overrides: Record<string, Route> = {}) {
  return routes({
    [`GET ${LIST_URL}`]: (call) => {
      const page = Number(call.url.searchParams.get('page'))
      const pageSize = Number(call.url.searchParams.get('pageSize'))
      return json({
        ok: true, page, total: table.length, totalPages: Math.max(1, Math.ceil(table.length / pageSize)),
        items: table.slice((page - 1) * pageSize, page * pageSize),
      })
    },
    [`POST ${BULK_URL}`]: (call) => {
      const ids = (call.body as { ids: string[] }).ids
      const before = table.length
      for (let i = table.length - 1; i >= 0; i--) if (ids.includes(table[i]!.id)) table.splice(i, 1)
      return json({ ok: true, deleted: before - table.length })
    },
    ...overrides,
  })
}
const openList = (table: Array<ReturnType<typeof session>>, overrides: Record<string, Route> = {}, can?: (r: string, a: string) => boolean) =>
  mountAdminPage(LIST_PAGE, sessionServer(table, overrides), { can })

const checkboxes = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'input' && el.props.type === 'checkbox')
/** The desktop row of a session, found by its IP cell. */
const rowOf = (opened: MountedAdminPage, ip: string): MiniElement => {
  const found = findAll(opened.page.root, el => el.tag === 'tr' && findAll(el, td => td.tag === 'td').some(td => textOf(td) === ip))
  assert.equal(found.length, 1, `expected one row for ${ip}, found ${found.length}`)
  return found[0]!
}
const tick = async (opened: MountedAdminPage, ip: string) => {
  await fire(findAll(rowOf(opened, ip), el => el.tag === 'input' && el.props.type === 'checkbox')[0]!, 'change')
  await settle()
}
/** Asserted through `?.props.count`, never the node: a failing message must not print the whole cyclic tree. */
const bar = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'AdminBulkActionBar')[0]
const deleteButton = (opened: MountedAdminPage) => byText(bar(opened)!, 'button', 'Xóa vĩnh viễn')
const listQuery = (call: NetCall) => call.url.searchParams.get('page')

describe('pages/admin/chatbot/sessions/index.vue — bulk delete', () => {
  it('without chatbot_knowledge.delete: no checkbox anywhere (table, header, cards) and no action strip', async () => {
    const opened = await openList([session('s-1'), session('s-22', 'Nguyễn A')], {}, noDelete)
    assert.equal(checkboxes(opened).length, 0)
    assert.equal(bar(opened)?.props.count, undefined)
    assert.match(textOf(opened.page.root), /Chrome trên Android/, 'the list itself still renders')
  })

  it('with the permission: a header box, and a box per row in BOTH the table and the mobile cards; the strip appears once a row is ticked', async () => {
    const opened = await openList([session('s-1'), session('s-22', 'Nguyễn A')])
    // 1 header + 2 table rows + 2 mobile cards.
    assert.equal(checkboxes(opened).length, 5)
    assert.equal(bar(opened)?.props.count, undefined, 'no strip before anything is ticked')
    const card = findAll(opened.page.root, el => el.tag === 'div' && findAll(el, i => i.tag === 'input' && i.props['aria-label'] === 'Chọn phiên của Nguyễn A').length > 0 && el.props.class !== undefined && String(el.props.class).includes('items-start'))[0]!
    await fire(findAll(card, el => el.tag === 'input')[0]!, 'change')
    await settle()
    assert.equal(bar(opened)?.props.count, 1, 'the mobile card box ticks the same selection')
    // The link is beside the checkbox, never around it.
    for (const link of findAll(opened.page.root, el => el.tag === 'nuxt-link')) {
      assert.equal(findAll(link, el => el.tag === 'input').length, 0, 'a checkbox inside <a>')
    }
  })

  it('confirm declined: nothing is sent and the selection stays', async () => {
    const opened = await openList([session('s-1'), session('s-22')])
    await tick(opened, 'ip-s-1')
    opened.answers.confirm = false
    const before = opened.calls.length
    await click(deleteButton(opened))
    await settle()
    assert.equal(opened.confirms.length, 1)
    assert.deepEqual(sent(opened.calls, before), [])
    assert.equal(bar(opened)?.props.count, 1)
  })

  it('ticked rows → confirm naming the count and "không thể hoàn tác" → POST { ids } (the string ids) → success → the list reloads and the selection empties', async () => {
    const table = [session('s-1'), session('s-22', 'Nguyễn A'), session('s-333')]
    const opened = await openList(table)
    await tick(opened, 'ip-s-1')
    await tick(opened, 'ip-s-333')
    const before = opened.calls.length
    await click(deleteButton(opened))
    await settle()
    const asked = opened.confirms.at(-1)!
    assert.equal(asked.danger, true)
    assert.match(asked.message!, /^Xóa vĩnh viễn 2 phiên trò chuyện đã chọn/)
    assert.match(asked.message!, /không thể hoàn tác/)
    assert.deepEqual(sent(opened.calls, before), [
      { wire: `POST ${BULK_URL}`, body: { ids: ['s-1', 's-333'] } },
      `GET ${LIST_URL}?page=1&pageSize=25`,
    ])
    assert.deepEqual(opened.toasts, [{ type: 'success', message: 'Đã xóa 2 phiên trò chuyện.' }])
    assert.equal(bar(opened)?.props.count, undefined, 'nothing is left selected')
    assert.deepEqual(findAll(opened.page.root, el => el.tag === 'tr').length - 1, 1, 'one row left in the table')
    assert.match(textOf(opened.page.root), /Nguyễn A/)
  })

  it('a count below what was sent is a warning naming the gap — some gone already; none deleted is a warning too', async () => {
    const table = [session('s-1'), session('s-22')]
    const opened = await openList(table, {
      // Another officer removed s-22 between the list read and this request.
      [`POST ${BULK_URL}`]: () => { table.splice(0, table.length); return json({ ok: true, deleted: 1 }) },
    })
    await tick(opened, 'ip-s-1')
    await tick(opened, 'ip-s-22')
    await click(deleteButton(opened))
    await settle()
    assert.deepEqual(opened.toasts, [{ type: 'warning', message: 'Đã xóa 1 phiên trò chuyện; 1 phiên không còn tồn tại (có thể đã bị xóa trước đó).' }])
    assert.equal(bar(opened)?.props.count, undefined, 'every id sent is gone — none stays ticked')

    const none = await openList([session('s-1')], { [`POST ${BULK_URL}`]: () => json({ ok: true, deleted: 0 }) })
    await tick(none, 'ip-s-1')
    await click(deleteButton(none))
    await settle()
    assert.deepEqual(none.toasts, [{ type: 'warning', message: 'Không có phiên nào bị xóa: 1 phiên đã chọn không còn tồn tại (có thể đã bị xóa trước đó).' }])
    // The route answered for every id sent (deleted, or not there): none stays ticked,
    // even while this fake list still shows the row.
    assert.equal(bar(none)?.props.count, undefined)
  })

  it('deleting the only row of the last page: the reload asks for that page, then once for the page before it', async () => {
    const table = Array.from({ length: 26 }, (_, n) => session(`s-${String(n).padStart(2, '0')}`))
    const opened = await openList(table)
    await fire(findAll(opened.page.root, el => el.tag === 'AdminPagination')[0]!, 'update:page', 2)
    await settle()
    const last = table[25]!
    await tick(opened, last.ip!)
    const before = opened.calls.length
    await click(deleteButton(opened))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(c => `${c.method} ${c.url.pathname} ${listQuery(c) ?? ''}`.trim()), [
      `POST ${BULK_URL}`,
      `GET ${LIST_URL} 2`,
      `GET ${LIST_URL} 1`,
    ])
    assert.deepEqual(opened.calls.at(-3)!.body, { ids: [last.id] })
    assert.equal(findAll(opened.page.root, el => el.tag === 'AdminPagination')[0]!.props.page, 1)
    assert.equal(findAll(opened.page.root, el => el.tag === 'tr').length - 1, 25, 'page 1 is shown, not an empty page 2')
  })

  it('a refusal shows the server\'s sentence and keeps the selection; a dropped connection the fallback — no reload, never ofetch\'s line', async () => {
    const refused = await openList([session('s-1')], { [`POST ${BULK_URL}`]: () => h3Error(403, 'Bạn không có quyền xoá phiên trò chuyện.') })
    await tick(refused, 'ip-s-1')
    const before = refused.calls.length
    await click(deleteButton(refused))
    await settle()
    assert.deepEqual(refused.toasts, [{ type: 'error', message: 'Bạn không có quyền xoá phiên trò chuyện.' }])
    assert.deepEqual(refused.calls.slice(before).map(wire), [`POST ${BULK_URL}`], 'no reload after a refusal')
    assert.equal(bar(refused)?.props.count, 1)
    assertOnlyServerSentences(refused)

    const dead = await openList([session('s-1')], { [`POST ${BULK_URL}`]: () => dropped() })
    await tick(dead, 'ip-s-1')
    await click(deleteButton(dead))
    await settle()
    assert.deepEqual(dead.toasts, [{ type: 'error', message: 'Không thể xóa các phiên trò chuyện đã chọn.' }])
    assertOnlyServerSentences(dead)
  })

  it('one request while one is out: the strip is busy, the button disabled, a second click sends nothing', async () => {
    let pending: NetCall | undefined
    const opened = await openList([session('s-1')], { [`POST ${BULK_URL}`]: (call) => { pending = call; return undefined } })
    await tick(opened, 'ip-s-1')
    const button = deleteButton(opened)
    const first = fire(button, 'click')
    await settle()
    assert.equal(bar(opened)?.props.busy, true)
    assert.equal(button.props.disabled, true)
    assert.match(textOf(button), /Đang xóa…/)
    // `fire`, not `click`: past the disabled attribute, to reach the handler's own guard.
    // Not awaited: a second request would stay pending, and the test must fail, not hang.
    void fire(button, 'click')
    await settle()
    assert.equal(opened.calls.filter(c => c.method === 'POST').length, 1)
    assert.equal(opened.confirms.length, 1, 'the second click did not even ask')
    pending!.respond(json({ ok: true, deleted: 1 }))
    await first
    await settle()
    assert.equal(bar(opened)?.props.count, undefined)
  })

  it('a page change drops ticks no longer on screen — page 2 cannot delete a row ticked on page 1', async () => {
    const table = Array.from({ length: 26 }, (_, n) => session(`s-${String(n).padStart(2, '0')}`))
    const opened = await openList(table)
    await tick(opened, table[0]!.ip!)
    assert.equal(bar(opened)?.props.count, 1)
    await fire(findAll(opened.page.root, el => el.tag === 'AdminPagination')[0]!, 'update:page', 2)
    await settle()
    assert.equal(bar(opened)?.props.count, undefined)
  })
})

// ─── pages/admin/chatbot/sessions/[id].vue ───────────────────────────────────

const DETAIL_PAGE = 'pages/admin/chatbot/sessions/[id].vue'
const SESSION_URL = '/api/admin/chatbot/sessions/abc'
const DETAIL = {
  ok: true,
  session: { id: 'abc', ip: '10.0.0.1', userAgent: 'UA', browser: 'Chrome trên Android', detectedPhone: '0900000001', detectedName: 'Nguyễn A', messageCount: 7, startedAt: STAMP, lastMessageAt: STAMP },
  messages: [{ id: 1, role: 'user', content: 'Tôi cần hỗ trợ việc làm', kind: null, createdAt: STAMP }],
  truncated: false,
  relatedSubmissions: [],
}
const openDetail = (onDelete: Route = () => json({ ok: true, deleted: 'abc' }), can?: (r: string, a: string) => boolean) =>
  mountAdminPage(DETAIL_PAGE, routes({ [`GET ${SESSION_URL}`]: () => json(DETAIL), [`DELETE ${SESSION_URL}`]: onDelete }), { route: { params: { id: 'abc' } }, can })
const deleteOne = (opened: MountedAdminPage) => byText(opened.page.root, 'button', 'Xóa phiên này')

describe('pages/admin/chatbot/sessions/[id].vue — delete this session', () => {
  it('without chatbot_knowledge.delete there is no delete button', async () => {
    const opened = await openDetail(undefined, noDelete)
    assert.equal(findAll(opened.page.root, el => el.tag === 'button' && /Xóa phiên/.test(textOf(el))).length, 0)
    assert.match(textOf(opened.page.root), /Tôi cần hỗ trợ việc làm/)
  })

  it('no button while the session has not loaded (failed read)', async () => {
    const opened = await mountAdminPage(DETAIL_PAGE, routes({ [`GET ${SESSION_URL}`]: () => h3Error(500, 'Lỗi máy chủ.') }), { route: { params: { id: 'abc' } } })
    assert.equal(findAll(opened.page.root, el => el.tag === 'button' && /Xóa phiên/.test(textOf(el))).length, 0)
  })

  it('declined: nothing is sent and the page stays', async () => {
    const opened = await openDetail()
    opened.answers.confirm = false
    await click(deleteOne(opened))
    await settle()
    assert.deepEqual(opened.calls.map(wire), [`GET ${SESSION_URL}`])
    assert.deepEqual(opened.pushes, [])
  })

  it('accepted: confirm names the message count and that it cannot be undone → DELETE → success → back to the list', async () => {
    const opened = await openDetail()
    await click(deleteOne(opened))
    await settle()
    const asked = opened.confirms.at(-1)!
    assert.equal(asked.danger, true)
    assert.match(asked.message!, /cùng 7 tin nhắn/)
    assert.match(asked.message!, /không thể hoàn tác/)
    assert.deepEqual(sent(opened.calls, 1), [`DELETE ${SESSION_URL}`])
    assert.deepEqual(opened.toasts, [{ type: 'success', message: 'Đã xóa phiên trò chuyện.' }])
    assert.deepEqual(opened.pushes, ['/admin/chatbot/sessions'])
  })

  it('404 (removed meanwhile by another officer or the retention purge): a Vietnamese warning, back to the list — never the route\'s English sentence', async () => {
    const opened = await openDetail(() => json({ statusCode: 404, statusMessage: 'Not Found', message: 'Chat session not found' }, 404))
    await click(deleteOne(opened))
    await settle()
    assert.deepEqual(opened.toasts, [{ type: 'warning', message: 'Phiên trò chuyện này không còn tồn tại (có thể đã bị xóa trước đó).' }])
    assert.deepEqual(opened.pushes, ['/admin/chatbot/sessions'])
  })

  it('a refusal (403) shows the server\'s sentence and stays; a dropped connection the fallback; the button is usable again', async () => {
    const refused = await openDetail(() => h3Error(403, 'Bạn không có quyền xoá phiên trò chuyện.'))
    await click(deleteOne(refused))
    await settle()
    assert.deepEqual(refused.toasts, [{ type: 'error', message: 'Bạn không có quyền xoá phiên trò chuyện.' }])
    assert.deepEqual(refused.pushes, [])
    assert.notEqual(deleteOne(refused).props.disabled, true)
    assertOnlyServerSentences(refused)

    const dead = await openDetail(() => dropped())
    await click(deleteOne(dead))
    await settle()
    assert.deepEqual(dead.toasts, [{ type: 'error', message: 'Không thể xóa phiên trò chuyện.' }])
    assertOnlyServerSentences(dead)
  })

  it('one DELETE while one is out', async () => {
    let pending: NetCall | undefined
    const opened = await openDetail((call) => { pending = call; return undefined })
    const button = deleteOne(opened)
    const first = fire(button, 'click')
    await settle()
    assert.equal(button.props.disabled, true)
    assert.match(textOf(button), /Đang xóa…/)
    // `fire`, not `click`: past the disabled attribute, to reach the handler's own guard.
    // Not awaited: a second request would stay pending, and the test must fail, not hang.
    void fire(button, 'click')
    await settle()
    assert.equal(opened.calls.filter(c => c.method === 'DELETE').length, 1)
    assert.equal(opened.confirms.length, 1, 'the second click did not even ask')
    pending!.respond(json({ ok: true, deleted: 'abc' }))
    await first
    await settle()
    assert.deepEqual(opened.pushes, ['/admin/chatbot/sessions'])
  })
})
