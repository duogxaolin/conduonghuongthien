/**
 * `/profile` (the reader's page) — defects found while splitting it (wave3 4.2). Each test
 * was RED on the original `app/pages/profile.vue` (run it there with
 * `READER_PROFILE_FILE=<file>`), and is green after the fix. Recorded in
 * docs/decisions/refactor-large-files.md.
 *
 *   FINDING-R1  "Nhận các đoạn chat trên thiết bị này" reported outcomes it did not know.
 *               `claimChats()` swallows every failure (right for the silent claim on each
 *               page load), and the button read its success from the reloaded list alone:
 *               a claim that never reached the server said "Đã gắn 2 đoạn trò chuyện…" (or
 *               "Không tìm thấy…" when the list was empty) — and when the reload failed,
 *               the sentence was computed from the OLD list and appeared, stale, once "Thử
 *               lại" brought the list back.
 *   FINDING-R2  the notification pager dropped the 401 rule. "Trước"/"Sau" called the
 *               loader straight from the template; a 401 (ticket expired mid-session) is
 *               rethrown by the loader, so it surfaced as an unhandled error and the page
 *               stayed "signed in" over a broken list — every other request on the page
 *               turns a 401 into the sign-in block.
 *   FINDING-R3  the comments pager read two different pages. Its label showed the page on
 *               screen (`commentsData.page`) while its buttons counted from the page last
 *               REQUESTED (`commentsPage`): after page 2 failed, the pager said "Trang 1 /
 *               3", "Trước" was live, and "Sau" asked for page 3 — skipping the page that
 *               failed.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { click } from './_sfc-mount.ts'
import {
  API, HOLD, alerts, block, button, byTag, chat, comment, dropped, h3Error, items, notification, openProfile, readerServer, sent, statuses,
  unauthorized, wire, words, type NetCall,
} from './_reader-profile-harness.ts'

const TICKETS = { cdkt_sessions_v1: JSON.stringify({ sessions: [{ token: 'tok-9' }] }) }
const signedOut = (ctx: Awaited<ReturnType<typeof openProfile>>) => byTag(ctx.page, 'h2').some(h => words(h) === 'Bạn chưa đăng nhập')

for (const [label, failure] of [['server error', () => h3Error(503, 'Dịch vụ tạm thời không khả dụng.')], ['dropped connection', dropped]] as const) {
  test(`FINDING-R1: a claim that fails (${label}) says so — never "Đã gắn …" or "Không tìm thấy …"`, async (t) => {
    const server = readerServer()
    server.state.claimable = [chat(9)]
    const ctx = await openProfile(t, server, { local: TICKETS, session: { cdkt_chats_claimed_v1: '1' } })
    server.state.override = call => (call.url.pathname.endsWith('/claim-chats') ? failure() : undefined)
    await click(button(ctx.page, 'Nhận các đoạn chat trên thiết bị này'))
    await ctx.settle()
    const box = block(ctx.page, 'Đoạn chat của tôi')
    assert.deepEqual(statuses(box), [], 'no success sentence')
    assert.deepEqual(alerts(box), ['Không thể gắn các đoạn trò chuyện vào tài khoản. Vui lòng thử lại.'])
    assert.equal(button(ctx.page, 'Nhận các đoạn chat trên thiết bị này').props.disabled, false, 'the reader can try again')

    // The retry that succeeds replaces the alert with the real outcome.
    server.state.override = () => undefined
    await click(button(ctx.page, 'Nhận các đoạn chat trên thiết bị này'))
    await ctx.settle()
    assert.deepEqual(alerts(block(ctx.page, 'Đoạn chat của tôi')), [])
    assert.deepEqual(statuses(block(ctx.page, 'Đoạn chat của tôi')), ['Đã gắn 3 đoạn trò chuyện vào tài khoản của bạn.'])
  })
}

test('FINDING-R1: when the list cannot be reloaded after the claim, no sentence is made up from the old list', async (t) => {
  const server = readerServer()
  server.state.claimable = [chat(9)]
  const ctx = await openProfile(t, server, { local: TICKETS, session: { cdkt_chats_claimed_v1: '1' } })
  server.state.override = call => (call.url.pathname === `${API}/chats` ? h3Error(503, 'x') : undefined)
  await click(button(ctx.page, 'Nhận các đoạn chat trên thiết bị này'))
  await ctx.settle()
  // (ofetch retries the 503 GET once, as in the browser.)
  assert.deepEqual(sent(ctx.calls).slice(-3).map(c => (typeof c === 'string' ? c : c.wire)), [`POST ${API}/claim-chats`, `GET ${API}/chats`, `GET ${API}/chats`])
  assert.deepEqual(alerts(block(ctx.page, 'Đoạn chat của tôi')), ['Không thể tải đoạn chat của bạn. Thử lại .'])
  server.state.override = () => undefined
  await click(button(block(ctx.page, 'Đoạn chat của tôi'), 'Thử lại'))
  await ctx.settle()
  const box = block(ctx.page, 'Đoạn chat của tôi')
  assert.equal(items(box).length, 3)
  assert.deepEqual(statuses(box), [], 'the stale "Đã gắn 2 …" (the list before the claim) must not appear')
})

test('FINDING-R2: a 401 while paging notifications turns the page into the sign-in block, with no unhandled error', async (t) => {
  const server = readerServer()
  server.state.notifications = Array.from({ length: 25 }, (_, i) => notification(i + 1))
  const ctx = await openProfile(t, server)
  server.state.override = call => (call.url.pathname === `${API}/notifications` ? unauthorized() : undefined)
  await click(button(block(ctx.page, 'Thông báo'), 'Sau'))
  await ctx.settle()
  assert.equal(wire(ctx.calls.at(-1)!), `GET ${API}/notifications?page=2`)
  assert.deepEqual(ctx.page.errors, [], 'the 401 escaped as an unhandled error')
  assert.ok(signedOut(ctx), 'the reader is still shown as signed in over a dead list')
})

test('FINDING-R2: "Trước" too', async (t) => {
  const server = readerServer()
  server.state.notifications = Array.from({ length: 25 }, (_, i) => notification(i + 1))
  const ctx = await openProfile(t, server)
  await click(button(block(ctx.page, 'Thông báo'), 'Sau'))
  await ctx.settle()
  server.state.override = call => (call.url.pathname === `${API}/notifications` ? unauthorized() : undefined)
  await click(button(block(ctx.page, 'Thông báo'), 'Trước'))
  await ctx.settle()
  assert.deepEqual(ctx.page.errors, [])
  assert.ok(signedOut(ctx))
})

test('FINDING-R3: after a page fails to load, the comments pager counts from the page on screen', async (t) => {
  const server = readerServer()
  server.state.comments = Array.from({ length: 25 }, (_, i) => comment(i + 1))
  const ctx = await openProfile(t, server)
  server.state.override = call => (call.url.pathname === `${API}/comments` ? h3Error(503, 'x') : undefined)
  await click(button(block(ctx.page, 'Bình luận của tôi'), 'Sau'))
  await ctx.settle()
  assert.equal(wire(ctx.calls.at(-1)!), `GET ${API}/comments?page=2`)
  const box = () => block(ctx.page, 'Bình luận của tôi')
  assert.deepEqual(alerts(box()), ['Không thể tải bình luận của bạn. Thử lại .'])
  assert.match(words(box()), /Trang 1 \/ 3/)
  assert.equal(button(box(), 'Trước').props.disabled, true, 'page 1 is on screen: there is no page before it')

  // "Sau" asks for the page after the one shown — page 2 again, not page 3.
  const held: NetCall[] = []
  server.state.override = (call) => {
    if (call.url.pathname !== `${API}/comments`) return undefined
    held.push(call)
    return HOLD
  }
  const pressed = click(button(box(), 'Sau'))
  await ctx.settle()
  assert.equal(held.length, 1)
  assert.equal(wire(held[0]!), `GET ${API}/comments?page=2`)
  server.answer(held[0]!)
  await pressed
  await ctx.settle()
  assert.match(words(box()), /Trang 2 \/ 3/)
  // And "Thử lại" (were it to fail again) re-runs the same page.
  assert.equal(items(box()).length, 10)
})
