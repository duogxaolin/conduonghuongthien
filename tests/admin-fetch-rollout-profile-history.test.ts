/**
 * Wave 3 D-FETCH, lot H: the "Lịch sử truy cập & hoạt động" block of /admin/profile —
 * `components/admin/ProfileActivityHistory.vue` (2 `$fetch` casts) — calls
 * `adminFetch<AdminProfileHistoryResponse>()` and `adminFetch<AdminUsersResponse>()`, both derived
 * from the handlers (app/types/admin-profile.ts, app/types/admin-users-api.ts).
 *
 * The REAL component (tests/_admin-page-harness.ts) over REAL ofetch on a fake network that answers
 * like `server/api/admin/profile/history.get.ts` and `server/api/admin/users/index.get.ts`. The
 * profile page's own suite (tests/admin-profile-page.test.ts) stubs this block; this file is its
 * behaviour. Pinned, green on the base (a7f312c1) and after: the GETs (page, 20 per page, `userId`
 * only for another account), the rows (action/resource labels, IP, short agent, MFA method), the
 * record count, the SuperAdmin-only account picker without one's own account, the "đang xem lịch sử
 * của …" notice, paging, the failure chain (the server's sentence in `role="alert"` + "Thử lại"; a
 * dropped connection the fallback, never ofetch's line), a failed account list staying silent, and
 * the exposed `reload()` the page calls after an MFA change.
 *
 * FINDING H-1, RED on the base: the account picker stays live while the history loads, and the
 * block had no notion of "the latest request" — pick account B, then "Tài khoản của tôi" before B's
 * answer: B's history landing last was shown under "Tài khoản của tôi" WITHOUT the notice (the
 * notice needs the picker's value, which is now empty) — another officer's sign-ins and IPs read as
 * one's own. B's late failure put its error over one's own history; B's `finally` ended the
 * skeleton while one's own was still loading. Each load now takes a number; only the latest writes.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { click, findAll, fire, input, textOf } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

const FILE = 'components/admin/ProfileActivityHistory.vue'
const HISTORY = '/api/admin/profile/history'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const row = (id: number, over: Record<string, unknown> = {}) => ({
  id, action: 'login', resource: 'auth', resourceId: null, createdAt: '2026-10-20T02:00:00.000Z', ip: `10.0.0.${id}`, userAgent: UA, mfaMethod: null, ...over,
})
/** What history.get.ts answers: `targetUsername` only for another account; `totalPages` ≥ 1. */
const page = (items: unknown[], { total = items.length, target = null as string | null, at = 1 } = {}) =>
  json({ ok: true, targetUsername: target, page: at, pageSize: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)), items })
/** A new `Response` each time — a body is read once. */
const USERS = () => json({ ok: true, users: [
  { id: 1, username: 'admin', email: 'a@x.vn', isActive: true, roleId: 1, roleName: 'SuperAdmin', createdAt: null, lastLoginAt: null },
  { id: 7, username: 'bientap', email: 'b@x.vn', isActive: true, roleId: 2, roleName: 'Biên tập', createdAt: null, lastLoginAt: null },
] })

type Route = (call: NetCall) => Response | Error | undefined
function mount(history: Route, users: Route = USERS, user: Record<string, unknown> = {}) {
  return mountAdminPage(FILE, routes({ [`GET ${HISTORY}`]: history, 'GET /api/admin/users': users }), { user })
}
const historyCalls = (opened: MountedAdminPage, from = 0) => opened.calls.slice(from).filter(c => c.url.pathname === HISTORY).map(wire)
const picker = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'select' && el.props.id === 'history-target')[0]
const tableText = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'tbody').map(textOf).join(' | ')
const notice = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'p' && textOf(el).includes('Bạn đang xem lịch sử của')).map(textOf).join('')
/** `<SkeletonTable>` is an auto-imported component, unresolved here: a plain element of that tag. */
const skeleton = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag.toLowerCase() === 'skeletontable').length > 0
async function pick(opened: MountedAdminPage, value: string) {
  await input(picker(opened)!, value)
  void fire(picker(opened)!, 'change')
  await settle()
}

describe(FILE, () => {
  it('mounting reads page 1 (20 per page) of one\'s own history and the account list; the rows, the count, the picker without one\'s own account', async () => {
    const opened = await mount(() => page([row(1, { mfaMethod: 'totp' }), row(2, { action: 'update', resource: 'profile_password', userAgent: null })], { total: 2 }))
    assert.deepEqual(opened.calls.map(wire).sort(), ['GET /api/admin/profile/history?page=1&pageSize=20', 'GET /api/admin/users'])
    const text = tableText(opened)
    assert.match(text, /Đăng nhập · Xác thực\s*10\.0\.0\.1\s*Chrome · Windows\s*ứng dụng xác thực/)
    assert.match(text, /Cập nhật · Mật khẩu tài khoản\s*10\.0\.0\.2\s*—/)
    assert.match(textOf(opened.page.root), /2 bản ghi/)
    const options = findAll(picker(opened)!, el => el.tag === 'option').map(el => [el.props.value, textOf(el)])
    assert.deepEqual(options, [['', 'Tài khoản của tôi'], ['7', 'bientap']])
    assert.equal(notice(opened), '')
  })

  it('another account: `userId` in the query, the notice names it; paging keeps the account', async () => {
    const opened = await mount(call => (call.url.searchParams.get('userId') === '7'
      ? page([row(Number(call.url.searchParams.get('page')) * 10)], { total: 45, target: 'bientap', at: Number(call.url.searchParams.get('page')) })
      : page([row(1)])))
    const before = opened.calls.length
    await pick(opened, '7')
    assert.deepEqual(historyCalls(opened, before), [`GET ${HISTORY}?page=1&pageSize=20&userId=7`])
    assert.match(notice(opened), /Bạn đang xem lịch sử của bientap\. Lần xem này được ghi vào nhật ký hệ thống\./)
    assert.match(textOf(opened.page.root), /Trang 1 \/ 3/)
    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el).includes('Sau'))[0]!)
    await settle()
    assert.equal(historyCalls(opened).at(-1), `GET ${HISTORY}?page=2&pageSize=20&userId=7`)
    assert.match(tableText(opened), /10\.0\.0\.20/)
  })

  it('a failed load: the server\'s sentence in role="alert" with "Thử lại" (which reads again); a dropped one the fallback, never ofetch\'s line', async () => {
    let fail = true
    const opened = await mount(() => (fail ? h3Error(400, 'pageSize phải là số nguyên từ 1 đến 100.') : page([row(3)])))
    assert.match(alertText(opened.page), /pageSize phải là số nguyên từ 1 đến 100\./)
    assert.equal(tableText(opened), '')
    fail = false
    await click(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Thử lại')[0]!)
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.match(tableText(opened), /10\.0\.0\.3/)

    const dead = await mount(() => dropped())
    assert.match(alertText(dead.page), /Không tải được lịch sử\./)
    assert.doesNotMatch(alertText(dead.page), OFETCH_LINE)
  })

  it('a failed account list is silent: no picker, no alert, the history shown; a non-SuperAdmin never asks for it', async () => {
    const opened = await mount(() => page([row(1)]), () => h3Error(403, 'Không có quyền.'))
    assert.equal(picker(opened), undefined)
    assert.equal(alertText(opened.page), '')
    assert.match(tableText(opened), /10\.0\.0\.1/)

    const editor = await mount(() => page([row(1)]), USERS, { isSuperAdmin: false })
    assert.deepEqual(editor.calls.map(wire), [`GET ${HISTORY}?page=1&pageSize=20`])
    assert.equal(picker(editor), undefined)
  })

  it('`reload()` (exposed; the page calls it after an MFA change) reads the page shown again', async () => {
    let n = 0
    const opened = await mount(() => page([row(++n)]))
    const before = opened.calls.length
    await (opened.page.instance as unknown as { reload: () => Promise<void> }).reload()
    await settle()
    assert.deepEqual(historyCalls(opened, before), [`GET ${HISTORY}?page=1&pageSize=20`])
    assert.match(tableText(opened), /10\.0\.0\.2/)
  })

  // ─── FINDING H-1 ───────────────────────────────────────────────────────────

  /** One's own row (`row(1)`): its IP, not followed by another digit (10.0.0.10…, 10.0.0.99 are others). */
  const OWN_ROW = /10\.0\.0\.1(?!\d)/

  /** Mount answered; then every history request waits for the test (`held`). */
  async function racing() {
    const held: NetCall[] = []
    let hold = false
    const opened = await mount((call) => {
      if (!hold) return page([row(1)])
      held.push(call)
      return undefined
    })
    hold = true
    return { opened, held }
  }

  it('FINDING H-1: another account, then one\'s own before the first answers — the first landing LAST is not shown as one\'s own', async () => {
    const { opened, held } = await racing()
    await pick(opened, '7')
    await pick(opened, '')
    assert.deepEqual(held.map(wire), [`GET ${HISTORY}?page=1&pageSize=20&userId=7`, `GET ${HISTORY}?page=1&pageSize=20`])
    held[1]!.respond(page([row(1)]))
    await settle()
    held[0]!.respond(page([row(99)], { target: 'bientap' }))
    await settle()
    assert.match(tableText(opened), OWN_ROW)
    assert.doesNotMatch(tableText(opened), /10\.0\.0\.99/, 'bientap\'s sign-ins shown under "Tài khoản của tôi"')
    assert.equal(notice(opened), '')
  })

  it('FINDING H-1: the first one\'s late FAILURE does not cover one\'s own history', async () => {
    const { opened, held } = await racing()
    await pick(opened, '7')
    await pick(opened, '')
    held[1]!.respond(page([row(1)]))
    await settle()
    held[0]!.respond(h3Error(404, 'Người dùng không tồn tại'))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.match(tableText(opened), OWN_ROW)
  })

  it('FINDING H-1: the first one ending (its `finally`) does not end the skeleton while one\'s own is still loading', async () => {
    const { opened, held } = await racing()
    await pick(opened, '7')
    await pick(opened, '')
    held[0]!.respond(page([row(99)], { target: 'bientap' }))
    await settle()
    assert.equal(skeleton(opened), true, 'still loading one\'s own history')
    assert.doesNotMatch(tableText(opened), /10\.0\.0\.99/)
    held[1]!.respond(page([row(1)]))
    await settle()
    assert.equal(skeleton(opened), false)
    assert.match(tableText(opened), OWN_ROW)
  })
})
