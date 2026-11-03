/**
 * `/profile` (app/pages/profile.vue, the READER's page) — behaviour, written BEFORE the
 * wave3 4.2 split and green on the original file: the page as a reader drives it, through
 * the real reader composables, against a fake network that answers like
 * `server/api/public/reader/**` (tests/_reader-profile-harness.ts).
 *
 * The source-text contract of the page (no routeRules, nothing fetched during SSR,
 * `<client-only>`, no `v-html`, branch chains) is tests/reader-profile-page.test.ts; this
 * file pins what it DOES: what is requested and when, what each block shows in each state,
 * every control, the 401-vs-403 rule on every write, and the reading history kept on the
 * device.
 *
 * `READER_PROFILE_FILE=<file>` runs the same suite against another version of the page;
 * `READER_PROFILE_DOM_LOG=<file>` records the DOM after every step (the split's DOM proof).
 * Defects found while splitting are in tests/reader-profile-page-findings.test.ts.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { click, findAll, fire, input } from './_sfc-mount.ts'
import {
  API, HOLD, alerts, block, busy, button, buttonsWith, byTag, chat, comment, dropped, emailSwitch, h3Error, identity, items, links, nameInput,
  notification, openProfile, readerServer, sent, statuses, unauthorized, wire, words, type NetCall,
} from './_reader-profile-harness.ts'

const NOON = (day: number) => Date.UTC(2026, 9, day, 12, 0, 0)
const HISTORY_KEY = 'cdkt_reader_history_v1'
const history = (entries: Array<{ slug: string, title?: string, readAt?: number }>) => ({ [HISTORY_KEY]: JSON.stringify(entries) })
const signInBlock = (ctx: { page: { root: never } } | Awaited<ReturnType<typeof openProfile>>) =>
  byTag(ctx.page, 'h2').some(h => words(h) === 'Bạn chưa đăng nhập')
const gets = (calls: NetCall[]) => calls.filter(c => c.method === 'GET').map(wire)

test('signed out: the sign-in block, nothing else requested, and the button leaves for Google with /profile to come back to', async (t) => {
  const server = readerServer()
  server.state.reader = null
  const ctx = await openProfile(t, server)
  assert.deepEqual(sent(ctx.calls), [`GET ${API}/me`])
  assert.ok(signInBlock(ctx))
  assert.deepEqual(busy(ctx.page), [])
  assert.equal(byTag(ctx.page, 'form').length, 0)
  await click(button(ctx.page, 'Đăng nhập bằng Google'))
  assert.equal(ctx.location.href, '/api/auth/google/start?return_to=%2Fprofile')
})

test('while the identity is unknown: one busy placeholder, no sign-in block (no false "not signed in")', async (t) => {
  const server = readerServer()
  const held: NetCall[] = []
  server.state.override = (call) => {
    if (call.url.pathname !== `${API}/me`) return undefined
    held.push(call)
    return HOLD
  }
  const ctx = await openProfile(t, server)
  assert.deepEqual(busy(ctx.page), ['Đang tải trang cá nhân'])
  assert.equal(signInBlock(ctx), false)
  // Not loaded yet: no control to write with — no rename form, no email switch.
  assert.equal(byTag(ctx.page, 'form').length, 0)
  assert.equal(findAll(ctx.page.root, el => el.props.role === 'switch').length, 0)
  server.answer(held[0]!)
  await ctx.settle()
  assert.deepEqual(busy(ctx.page), [])
  assert.equal(byTag(ctx.page, 'form').length, 1)
})

test('signed in: the three lists load after the identity, together; SEO says noindex', async (t) => {
  const ctx = await openProfile(t)
  assert.deepEqual(sent(ctx.calls), [
    `GET ${API}/me`,
    `GET ${API}/comments?page=1`,
    `GET ${API}/chats`,
    `GET ${API}/notifications?page=1`,
  ])
  assert.deepEqual(ctx.seo(), {
    title: 'Trang cá nhân | Con Đường Hướng Thiện',
    description: 'Quản lý tên hiển thị, xem lại bình luận đã gửi và các đoạn trò chuyện với trợ lý.',
    robots: 'noindex, nofollow',
  })
  assert.deepEqual(byTag(ctx.page, 'h1').map(words), ['Trang cá nhân'])
  assert.deepEqual(byTag(ctx.page, 'h2').map(words), ['Thông báo 2 mới', 'Bình luận của tôi', 'Bài đã đọc', 'Đoạn chat của tôi'])
  assert.deepEqual(alerts(ctx.page), [])
  assert.deepEqual(busy(ctx.page), [])
})

test('identity block: avatar, name, email; the box starts with the current name; "Lưu tên" only for a real change', async (t) => {
  const ctx = await openProfile(t)
  const card = identity(ctx.page)
  assert.equal(byTag(card, 'ReaderAvatar')[0]!.props.initials, 'TB')
  assert.equal(byTag(card, 'ReaderAvatar')[0]!.props.size, 'lg')
  assert.match(words(card), /^Trần Thị Bình binh@example\.test Tên hiển thị Tên này hiện cùng mọi bình luận của bạn trên cổng thông tin\. Từ 2 đến 60 ký tự\./)
  const box = nameInput(ctx.page)
  assert.equal(box.model!.value, 'Trần Thị Bình')
  assert.equal(box.props.maxlength, 60)
  assert.equal(box.props.placeholder, 'Ví dụ: Nguyễn Văn A')
  assert.equal(button(card, 'Lưu tên').props.disabled, true, 'unchanged')
  await input(box, '   ')
  await ctx.settle()
  assert.equal(button(card, 'Lưu tên').props.disabled, true, 'blank')
  await input(box, '  Trần Thị Bình  ')
  await ctx.settle()
  assert.equal(button(card, 'Lưu tên').props.disabled, true, 'the same once trimmed')
  await input(box, 'Bình Trần')
  await ctx.settle()
  assert.equal(button(card, 'Lưu tên').props.disabled, false)
})

test('rename: PUT the trimmed name, "Đang lưu…" while it travels, then the saved note — and the shared identity changes', async (t) => {
  const server = readerServer()
  const held: NetCall[] = []
  server.state.override = (call) => {
    if (call.method !== 'PUT') return undefined
    held.push(call)
    return HOLD
  }
  const ctx = await openProfile(t, server)
  await input(nameInput(ctx.page), '  Bình Trần ')
  // Not awaited: the handler waits for the held request.
  const submitted = fire(byTag(ctx.page, 'form')[0]!, 'submit')
  await ctx.settle()
  assert.deepEqual(sent(ctx.calls).at(-1), { wire: `PUT ${API}/profile`, body: { displayName: 'Bình Trần' } })
  const saving = button(identity(ctx.page), 'Đang lưu…')
  assert.equal(saving.props.disabled, true)
  server.answer(held[0]!)
  await submitted
  await ctx.settle()
  assert.deepEqual(statuses(identity(ctx.page)), ['Đã lưu tên hiển thị mới.'])
  assert.equal(ctx.auth().reader.value!.displayName, 'Bình Trần')
  assert.equal(ctx.auth().reader.value!.initials, 'BT')
  assert.match(words(identity(ctx.page)), /^Bình Trần binh@example\.test/)
  // Typing again drops the note: the next edit is not "saved".
  await input(nameInput(ctx.page), 'Bình Trần Thị')
  await ctx.settle()
  assert.deepEqual(statuses(identity(ctx.page)), [])
})

test('rename submitted twice while the first PUT travels (double submit): exactly one request', async (t) => {
  // "Lưu tên" is disabled while saving (test above), so the browser stops a second click and a
  // second Enter (implicit submission needs the default button enabled). This pins the second
  // layer — `saveName` itself refuses while a save is in flight — reached here by submitting
  // the form directly, as any submit that gets past the button would.
  const server = readerServer()
  const held: NetCall[] = []
  server.state.override = (call) => {
    if (call.method !== 'PUT') return undefined
    held.push(call)
    return HOLD
  }
  const ctx = await openProfile(t, server)
  await input(nameInput(ctx.page), 'Bình Trần')
  const form = byTag(ctx.page, 'form')[0]!
  let prevented = 0
  const submit = () => fire(form, 'submit', { type: 'submit', target: form, currentTarget: form, preventDefault() { prevented += 1 }, stopPropagation() {} })
  const first = submit()
  const second = submit()
  await ctx.settle()
  const puts = () => ctx.calls.filter(c => c.method === 'PUT').map(wire)
  assert.deepEqual(puts(), [`PUT ${API}/profile`])
  assert.equal(prevented, 2, 'each submit is kept from reloading the page')
  // Answer whatever was sent (one call — or two if the guard is gone) before awaiting.
  for (const call of held) server.answer(call)
  await Promise.all([first, second])
  await ctx.settle()
  assert.deepEqual(puts(), [`PUT ${API}/profile`])
  assert.deepEqual(statuses(identity(ctx.page)), ['Đã lưu tên hiển thị mới.'])
})

test('rename refused (400): the server\'s sentence as an alert, the form stays', async (t) => {
  const server = readerServer()
  server.state.override = call => (call.method === 'PUT' ? h3Error(400, 'Tên hiển thị chứa từ ngữ không phù hợp.') : undefined)
  const ctx = await openProfile(t, server)
  await input(nameInput(ctx.page), 'Tên mới')
  await fire(byTag(ctx.page, 'form')[0]!, 'submit')
  await ctx.settle()
  assert.deepEqual(alerts(identity(ctx.page)), ['Tên hiển thị chứa từ ngữ không phù hợp.'])
  assert.equal(button(identity(ctx.page), 'Lưu tên').props.disabled, false)
  assert.equal(signInBlock(ctx), false)
})

test('rename on a dropped connection: the fallback sentence, never ofetch\'s', async (t) => {
  const server = readerServer()
  server.state.override = call => (call.method === 'PUT' ? dropped() : undefined)
  const ctx = await openProfile(t, server)
  await input(nameInput(ctx.page), 'Tên mới')
  await fire(byTag(ctx.page, 'form')[0]!, 'submit')
  await ctx.settle()
  assert.deepEqual(alerts(identity(ctx.page)), ['Không thể lưu tên hiển thị. Vui lòng thử lại.'])
})

test('rename 401 (ticket expired mid-session): the page turns into the sign-in block; 403 (ban) does not', async (t) => {
  const server = readerServer()
  server.state.override = call => (call.method === 'PUT' ? unauthorized() : undefined)
  const ctx = await openProfile(t, server)
  await input(nameInput(ctx.page), 'Tên mới')
  await fire(byTag(ctx.page, 'form')[0]!, 'submit')
  await ctx.settle()
  assert.ok(signInBlock(ctx))

  const banned = readerServer()
  banned.state.override = call => (call.method === 'PUT' ? h3Error(403, 'Tài khoản của bạn đã bị hạn chế bình luận trên cổng thông tin.') : undefined)
  const other = await openProfile(t, banned)
  await input(nameInput(other.page), 'Tên mới')
  await fire(byTag(other.page, 'form')[0]!, 'submit')
  await other.settle()
  assert.equal(signInBlock(other), false)
  assert.deepEqual(alerts(identity(other.page)), ['Tài khoản của bạn đã bị hạn chế bình luận trên cổng thông tin.'])
})

test('email switch: on by default; a click PUTs the opposite and the switch follows the server', async (t) => {
  const ctx = await openProfile(t)
  const box = block(ctx.page, 'Thông báo')
  assert.match(words(box), /Gửi email khi có người trả lời Gửi tới binh@example\.test \. Bạn có thể tắt bất cứ lúc nào\./)
  assert.equal(emailSwitch(ctx.page).props['aria-checked'], true)
  assert.equal(emailSwitch(ctx.page).props.disabled, false)
  await click(emailSwitch(ctx.page))
  await ctx.settle()
  assert.deepEqual(sent(ctx.calls).at(-1), { wire: `PUT ${API}/profile/email-notifications`, body: { enabled: false } })
  assert.equal(emailSwitch(ctx.page).props['aria-checked'], false)
  assert.equal(ctx.auth().reader.value!.emailNotifications, false)
  await click(emailSwitch(ctx.page))
  await ctx.settle()
  assert.deepEqual(sent(ctx.calls).at(-1), { wire: `PUT ${API}/profile/email-notifications`, body: { enabled: true } })
  assert.equal(emailSwitch(ctx.page).props['aria-checked'], true)
})

test('email switch while its PUT travels: disabled (no second click), and a click that gets through sends nothing', async (t) => {
  const server = readerServer()
  const held: NetCall[] = []
  server.state.override = (call) => {
    if (!call.url.pathname.endsWith('/email-notifications')) return undefined
    held.push(call)
    return HOLD
  }
  const ctx = await openProfile(t, server)
  const switches = () => ctx.calls.filter(c => c.url.pathname.endsWith('/email-notifications'))
  const pending = click(emailSwitch(ctx.page))
  await ctx.settle()
  assert.equal(switches().length, 1)
  assert.equal(emailSwitch(ctx.page).props.disabled, true, 'disabled while saving')
  assert.throws(() => click(emailSwitch(ctx.page)), /is disabled/)
  // Layer two: the toggle itself refuses while a save is in flight (a click past the button).
  const forced = fire(emailSwitch(ctx.page), 'click')
  await ctx.settle()
  assert.equal(switches().length, 1)
  for (const call of held) server.answer(call)
  await Promise.all([pending, forced])
  await ctx.settle()
  assert.equal(switches().length, 1)
  assert.deepEqual(sent(ctx.calls).filter(c => typeof c !== 'string' && c.wire.endsWith('/email-notifications')), [
    { wire: `PUT ${API}/profile/email-notifications`, body: { enabled: false } },
  ])
  assert.equal(emailSwitch(ctx.page).props.disabled, false, 'enabled again once the server answered')
  assert.equal(emailSwitch(ctx.page).props['aria-checked'], false)
})

test('email switch refused: an alert under it, the switch stays; 401 → sign-in block', async (t) => {
  const server = readerServer()
  server.state.override = call => (call.url.pathname.endsWith('/email-notifications') ? h3Error(429, 'Bạn thao tác quá nhanh. Vui lòng chờ một lát.') : undefined)
  const ctx = await openProfile(t, server)
  await click(emailSwitch(ctx.page))
  await ctx.settle()
  assert.deepEqual(alerts(block(ctx.page, 'Thông báo')), ['Bạn thao tác quá nhanh. Vui lòng chờ một lát.'])
  assert.equal(emailSwitch(ctx.page).props['aria-checked'], true)

  const expired = readerServer()
  expired.state.override = call => (call.url.pathname.endsWith('/email-notifications') ? unauthorized() : undefined)
  const other = await openProfile(t, expired)
  await click(emailSwitch(other.page))
  await other.settle()
  assert.ok(signInBlock(other))
})

test('email switch: an account with no email cannot turn it on, and is told why', async (t) => {
  const server = readerServer()
  server.state.reader = { ...server.state.reader!, email: null }
  const ctx = await openProfile(t, server)
  assert.equal(emailSwitch(ctx.page).props.disabled, true)
  assert.match(words(block(ctx.page, 'Thông báo')), /Tài khoản của bạn không có địa chỉ email nên cổng thông tin không gửi được\./)
  assert.doesNotMatch(words(identity(ctx.page)), /@/)
})

test('notifications: unread count, each item (link when reachable, a note when not), reading one marks it', async (t) => {
  const ctx = await openProfile(t)
  const box = block(ctx.page, 'Thông báo')
  const rows = items(box)
  assert.deepEqual(rows.map(words), [
    'Ban quản trị đã trả lời bình luận của bạn • 20/10/2026 Trả lời số 1 Bài viết 1 →',
    'Nguyễn Văn An đã trả lời bình luận của bạn • 20/10/2026 Trả lời số 2 Bài viết 2 →',
    'Ban quản trị đã trả lời bình luận của bạn • 20/10/2026 Trả lời số 3 Bài viết hiện không mở bình luận',
  ])
  const targets = rows.map(li => li.children.find(c => c.kind === 'element')!)
  assert.deepEqual(targets.map(el => ('tag' in el ? el.tag : '')), ['nuxt-link', 'nuxt-link', 'div'])
  assert.deepEqual(targets.map(el => ('props' in el ? el.props.to ?? null : null)), ['/news/bai-viet-1#comment-1', '/news/bai-viet-2#comment-2', null])
  // Unread vs read styling.
  assert.ok(String(byTag(rows[0]!, 'span')[0]!.props.class).includes('bg-accent'))
  assert.ok(String(byTag(rows[1]!, 'span')[0]!.props.class).includes('bg-transparent'))

  await click(targets[0] as never)
  await ctx.settle()
  assert.deepEqual(sent(ctx.calls).at(-1), { wire: `POST ${API}/notifications/read`, body: { ids: [1] } })
  assert.match(words(byTag(box, 'h2')[0]!), /^Thông báo 1 mới$/)
  // A read one sends nothing.
  const before = ctx.calls.length
  await click(items(block(ctx.page, 'Thông báo'))[1]!.children.find(c => c.kind === 'element') as never)
  assert.equal(ctx.calls.length, before)
})

test('notifications: "Đánh dấu tất cả đã đọc" clears the count', async (t) => {
  const ctx = await openProfile(t)
  await click(button(ctx.page, 'Đánh dấu tất cả đã đọc'))
  await ctx.settle()
  assert.deepEqual(sent(ctx.calls).at(-1), { wire: `POST ${API}/notifications/read`, body: { all: true } })
  assert.equal(words(byTag(block(ctx.page, 'Thông báo'), 'h2')[0]!), 'Thông báo')
  assert.equal(buttonsWith(ctx.page, 'Đánh dấu tất cả đã đọc').length, 0)
})

test('notifications: skeleton while loading; empty sentence when there are none', async (t) => {
  const server = readerServer()
  server.state.override = call => (call.url.pathname === `${API}/notifications` ? HOLD : undefined)
  const ctx = await openProfile(t, server)
  assert.deepEqual(busy(block(ctx.page, 'Thông báo')), ['Đang tải thông báo'])

  const none = readerServer()
  none.state.notifications = []
  const other = await openProfile(t, none)
  assert.match(words(block(other.page, 'Thông báo')), /Chưa có thông báo nào\. Khi có người trả lời bình luận của bạn, thông báo sẽ hiện ở đây\.$/)
})

test('notifications failure: an alert with "Thử lại" that re-runs the same page', async (t) => {
  const server = readerServer()
  server.state.override = call => (call.url.pathname === `${API}/notifications` ? h3Error(503, 'Dịch vụ tạm thời không khả dụng.') : undefined)
  const ctx = await openProfile(t, server)
  assert.deepEqual(alerts(block(ctx.page, 'Thông báo')), ['Không thể tải thông báo. Thử lại .'])
  server.state.override = () => undefined
  await click(button(block(ctx.page, 'Thông báo'), 'Thử lại'))
  await ctx.settle()
  assert.equal(gets(ctx.calls).at(-1), `GET ${API}/notifications?page=1`)
  assert.deepEqual(alerts(ctx.page), [])
  assert.equal(items(block(ctx.page, 'Thông báo')).length, 3)
})

test('notifications pages: "Trang 1 / 3", Trước off on the first, Sau loads the next', async (t) => {
  const server = readerServer()
  server.state.notifications = Array.from({ length: 25 }, (_, i) => notification(i + 1, { isRead: i > 0 }))
  const ctx = await openProfile(t, server)
  const box = block(ctx.page, 'Thông báo')
  assert.match(words(box), /Trước Trang 1 \/ 3 Sau$/)
  assert.equal(button(box, 'Trước').props.disabled, true)
  await click(button(box, 'Sau'))
  await ctx.settle()
  assert.equal(gets(ctx.calls).at(-1), `GET ${API}/notifications?page=2`)
  assert.match(words(block(ctx.page, 'Thông báo')), /Trước Trang 2 \/ 3 Sau$/)
  assert.equal(items(block(ctx.page, 'Thông báo')).length, 10)
  await click(button(block(ctx.page, 'Thông báo'), 'Trước'))
  await ctx.settle()
  assert.equal(gets(ctx.calls).at(-1), `GET ${API}/notifications?page=1`)
})

test('my comments: count, date, reply tag, reply count, body with line breaks, link only when the thread is open', async (t) => {
  const ctx = await openProfile(t)
  const box = block(ctx.page, 'Bình luận của tôi')
  assert.equal(words(byTag(box, 'header')[0]!), 'Bình luận của tôi 3')
  assert.deepEqual(items(box).map(words), [
    '19/10/2026 Bình luận số 1. Dòng thứ hai. Bài viết 1',
    '19/10/2026 Phản hồi Bình luận số 2. Dòng thứ hai. Bài viết 2',
    '19/10/2026 2 trả lời Bình luận số 3. Dòng thứ hai. Bài đã ẩn (bài viết hiện không mở bình luận)',
  ])
  const bodies = findAll(box, el => el.tag === 'p' && String(el.props.class ?? '').includes('whitespace-pre-line'))
  assert.equal(bodies.length, 3)
  assert.equal(bodies[0]!.children[0]!.kind === 'text' && bodies[0]!.children[0]!.text, 'Bình luận số 1.\nDòng thứ hai.')
  assert.deepEqual(links(box), [{ to: '/news/bai-viet-1', text: 'Bài viết 1' }, { to: '/news/bai-viet-2', text: 'Bài viết 2' }])
})

test('my comments: skeleton, failure with a retry of the same page, empty sentence', async (t) => {
  const server = readerServer()
  server.state.override = call => (call.url.pathname === `${API}/comments` ? HOLD : undefined)
  const ctx = await openProfile(t, server)
  assert.deepEqual(busy(block(ctx.page, 'Bình luận của tôi')), ['Đang tải bình luận của bạn'])

  const failing = readerServer()
  failing.state.override = call => (call.url.pathname === `${API}/comments` ? h3Error(503, 'x') : undefined)
  const other = await openProfile(t, failing)
  assert.deepEqual(alerts(block(other.page, 'Bình luận của tôi')), ['Không thể tải bình luận của bạn. Thử lại .'])
  assert.equal(words(byTag(block(other.page, 'Bình luận của tôi'), 'header')[0]!), 'Bình luận của tôi', 'no count while unknown')
  failing.state.override = () => undefined
  await click(button(block(other.page, 'Bình luận của tôi'), 'Thử lại'))
  await other.settle()
  assert.equal(gets(other.calls).at(-1), `GET ${API}/comments?page=1`)
  assert.equal(items(block(other.page, 'Bình luận của tôi')).length, 3)

  const none = readerServer()
  none.state.comments = []
  const empty = await openProfile(t, none)
  assert.match(words(block(empty.page, 'Bình luận của tôi')), /Bạn chưa gửi bình luận nào\. Hãy mở một bài viết và đặt câu hỏi ở phần bình luận\.$/)
})

test('my comments pages: Sau loads page 2, Trước goes back; both off while loading', async (t) => {
  const server = readerServer()
  server.state.comments = Array.from({ length: 25 }, (_, i) => comment(i + 1))
  const ctx = await openProfile(t, server)
  const box = () => block(ctx.page, 'Bình luận của tôi')
  assert.match(words(box()), /Trước Trang 1 \/ 3 Sau$/)
  assert.equal(button(box(), 'Trước').props.disabled, true)
  const held: NetCall[] = []
  server.state.override = (call) => {
    if (call.url.pathname !== `${API}/comments`) return undefined
    held.push(call)
    return HOLD
  }
  await click(button(box(), 'Sau'))
  await ctx.settle()
  assert.equal(gets(ctx.calls).at(-1), `GET ${API}/comments?page=2`)
  assert.equal(button(box(), 'Sau').props.disabled, true)
  assert.equal(button(box(), 'Trước').props.disabled, true)
  server.answer(held[0]!)
  await ctx.settle()
  assert.match(words(box()), /Trước Trang 2 \/ 3 Sau$/)
  server.state.override = () => undefined
  await click(button(box(), 'Trước'))
  await ctx.settle()
  assert.equal(gets(ctx.calls).at(-1), `GET ${API}/comments?page=1`)
})

test('a 401 on any of the three lists drops the identity → sign-in block', async (t) => {
  for (const path of ['comments', 'chats', 'notifications']) {
    const server = readerServer()
    server.state.override = call => (call.url.pathname === `${API}/${path}` ? unauthorized() : undefined)
    const ctx = await openProfile(t, server)
    assert.ok(signInBlock(ctx), path)
    assert.deepEqual(ctx.page.errors, [], path)
  }
})

test('reading history: from this device, newest first, title or slug, local date; remove one, clear all', async (t) => {
  const ctx = await openProfile(t, readerServer(), {
    local: history([
      { slug: 'bai-cu', title: 'Bài cũ', readAt: NOON(2) },
      { slug: 'bai-moi', title: 'Bài mới', readAt: NOON(20) },
      { slug: 'khong-tieu-de', title: '', readAt: NOON(10) },
    ]),
  })
  const box = () => block(ctx.page, 'Bài đã đọc')
  assert.match(words(box()), /Danh sách này được lưu trên thiết bị này , không lưu trên máy chủ/)
  assert.deepEqual(items(box()).map(words), ['Bài mới 20/10/2026', 'khong-tieu-de 10/10/2026', 'Bài cũ 02/10/2026'])
  assert.deepEqual(links(box()).map(l => l.to), ['/news/bai-moi', '/news/khong-tieu-de', '/news/bai-cu'])
  const remove = byTag(items(box())[1]!, 'button')[0]!
  assert.equal(remove.props['aria-label'], 'Xoá khong-tieu-de')
  assert.equal(remove.props.title, 'Xoá khỏi danh sách')
  await click(remove)
  await ctx.settle()
  assert.deepEqual(items(box()).map(words), ['Bài mới 20/10/2026', 'Bài cũ 02/10/2026'])
  assert.deepEqual(JSON.parse(ctx.local.getItem(HISTORY_KEY)!).map((e: { slug: string }) => e.slug), ['bai-moi', 'bai-cu'])
  await click(button(box(), 'Xoá danh sách'))
  await ctx.settle()
  assert.equal(ctx.local.getItem(HISTORY_KEY), null)
  assert.match(words(box()), /Chưa có bài viết nào được đọc trên thiết bị này\.$/)
  assert.equal(buttonsWith(box(), 'Xoá danh sách').length, 0)
  // Nothing about it reached the server.
  assert.ok(!ctx.calls.some(c => /history/.test(c.url.pathname)))
})

test('my chats: title, last message and count; the assistant link', async (t) => {
  const ctx = await openProfile(t)
  const box = block(ctx.page, 'Đoạn chat của tôi')
  assert.deepEqual(items(box).map(words), ['Câu hỏi về thủ tục số 1 18/10/2026 • 3 tin nhắn', 'Câu hỏi về thủ tục số 2 18/10/2026 • 4 tin nhắn'])
  assert.deepEqual(links(byTag(box, 'header')[0]!), [{ to: '/assistant', text: 'Mở trợ lý →' }])
  assert.equal(button(box, 'Nhận các đoạn chat trên thiết bị này').props.disabled, false)
})

test('my chats: skeleton, failure with a retry, empty sentence (the claim button stays reachable)', async (t) => {
  const server = readerServer()
  server.state.override = call => (call.url.pathname === `${API}/chats` ? HOLD : undefined)
  const ctx = await openProfile(t, server)
  assert.deepEqual(busy(block(ctx.page, 'Đoạn chat của tôi')), ['Đang tải đoạn chat của bạn'])

  const failing = readerServer()
  failing.state.override = call => (call.url.pathname === `${API}/chats` ? dropped() : undefined)
  const other = await openProfile(t, failing)
  assert.deepEqual(alerts(block(other.page, 'Đoạn chat của tôi')), ['Không thể tải đoạn chat của bạn. Thử lại .'])
  assert.equal(buttonsWith(other.page, 'Nhận các đoạn chat').length, 0)
  failing.state.override = () => undefined
  await click(button(block(other.page, 'Đoạn chat của tôi'), 'Thử lại'))
  await other.settle()
  assert.equal(gets(other.calls).at(-1), `GET ${API}/chats`)
  assert.equal(items(block(other.page, 'Đoạn chat của tôi')).length, 2)

  const none = readerServer()
  none.state.chats = []
  const empty = await openProfile(t, none)
  assert.match(words(block(empty.page, 'Đoạn chat của tôi')), /Chưa có đoạn trò chuyện nào gắn với tài khoản của bạn\./)
  assert.equal(buttonsWith(empty.page, 'Nhận các đoạn chat trên thiết bị này').length, 1)
})

test('claim on load: once per browser session, only the tickets this device holds', async (t) => {
  const tickets = { cdkt_sessions_v1: JSON.stringify({ sessions: [{ id: 1, token: 'tok-a' }, { id: 2, token: null }, { id: 3, token: 'tok-b' }] }) }
  const ctx = await openProfile(t, readerServer(), { local: tickets })
  assert.deepEqual(sent(ctx.calls).filter(c => typeof c !== 'string'), [{ wire: `POST ${API}/claim-chats`, body: { sessions: [{ token: 'tok-a' }, { token: 'tok-b' }] } }])
  assert.equal(ctx.session.getItem('cdkt_chats_claimed_v1'), '1')
  const again = await openProfile(t, readerServer(), { local: tickets, session: { cdkt_chats_claimed_v1: '1' } })
  assert.ok(!again.calls.some(c => c.url.pathname.endsWith('/claim-chats')))
})

test('"Nhận các đoạn chat": clears the session flag, claims, reloads the list, and reports from what it now shows', async (t) => {
  const server = readerServer()
  server.state.claimable = [chat(9)]
  const tickets = { cdkt_sessions_v1: JSON.stringify({ sessions: [{ token: 'tok-9' }] }) }
  const ctx = await openProfile(t, server, { local: tickets, session: { cdkt_chats_claimed_v1: '1' } })
  const held: NetCall[] = []
  server.state.override = (call) => {
    if (!call.url.pathname.endsWith('/claim-chats')) return undefined
    held.push(call)
    return HOLD
  }
  const pressed = click(button(ctx.page, 'Nhận các đoạn chat trên thiết bị này'))
  await ctx.settle()
  assert.equal(button(ctx.page, 'Đang gắn…').props.disabled, true)
  server.answer(held[0]!)
  await pressed
  await ctx.settle()
  assert.deepEqual(sent(ctx.calls).slice(-2), [{ wire: `POST ${API}/claim-chats`, body: { sessions: [{ token: 'tok-9' }] } }, `GET ${API}/chats`])
  assert.deepEqual(statuses(block(ctx.page, 'Đoạn chat của tôi')), ['Đã gắn 3 đoạn trò chuyện vào tài khoản của bạn.'])
  assert.equal(items(block(ctx.page, 'Đoạn chat của tôi')).length, 3)
  assert.equal(button(ctx.page, 'Nhận các đoạn chat trên thiết bị này').props.disabled, false)
})

test('"Nhận các đoạn chat" with nothing on this device and no chats: says none was found', async (t) => {
  const server = readerServer()
  server.state.chats = []
  const ctx = await openProfile(t, server)
  await click(button(ctx.page, 'Nhận các đoạn chat trên thiết bị này'))
  await ctx.settle()
  assert.ok(!ctx.calls.some(c => c.url.pathname.endsWith('/claim-chats')), 'no tickets → nothing sent')
  assert.deepEqual(statuses(block(ctx.page, 'Đoạn chat của tôi')), ['Không tìm thấy đoạn trò chuyện nào trên thiết bị này.'])
})

test('nothing on the page is rendered as HTML', async (t) => {
  const server = readerServer()
  server.state.comments = [comment(1, { body: '<img src=x onerror=alert(1)>' })]
  server.state.chats = [chat(1, { title: '<b>đậm</b>' })]
  const ctx = await openProfile(t, server)
  assert.doesNotMatch(ctx.page.html(), /innerHTML=/)
  assert.match(words(block(ctx.page, 'Bình luận của tôi')), /<img src=x onerror=alert\(1\)>/)
  assert.match(words(block(ctx.page, 'Đoạn chat của tôi')), /<b>đậm<\/b>/)
})
