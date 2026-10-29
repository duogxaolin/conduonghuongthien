/**
 * Wave 3 D-FETCH, batch B: the admin users list (`pages/admin/users/index.vue`, 6 `$fetch`
 * casts) and one reader's page (`pages/admin/readers/[id].vue`, 7) call `adminFetch<T>()`
 * with response types derived from the handlers (app/types/admin-users-api.ts,
 * admin-readers-api.ts, and the existing `AdminReader*` of app/types/admin-api.ts).
 *
 * The REAL page — `<script setup>` and template — is mounted (tests/_admin-page-harness.ts)
 * over REAL ofetch on a fake network. Pinned, green before and after the conversion:
 *   - the exact requests of the mount and of every action (method, path, body), the
 *     confirm/prompt wording that decides them, and the reloads after them;
 *   - a failure shows the sentence the SERVER wrote, never ofetch's `[GET] "…"` line;
 *   - the cells that format nullable values: a user's `email`, `lastLoginAt`, `roleName`
 *     (role deleted → leftJoin NULL) and `isActive`; a reader's `email`, `displayName`,
 *     `createdAt`, `lastSeenAt`, `lastIp`, a comment's `createdAt` and its gone video.
 *
 * FINDING, RED on the base (ea5b500):
 *   - `users.is_active` is a nullable column. The list reads NULL as locked ("Đã khóa"),
 *     and so does the server — `admin-auth` and the login refuse `!user.isActive`. The
 *     edit dialog alone read it as active (`isActive !== false`), so saving any change
 *     to such an account (a new email) sent `isActive: true` and silently unlocked it.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { byText, click, findAll, fire, input, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, buttons, h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

function assertOnlyServerSentences(opened: MountedAdminPage) {
  for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
}

// ─── pages/admin/users/index.vue ─────────────────────────────────────────────

const USERS_PAGE = 'pages/admin/users/index.vue'
const ROLES = [
  { id: 1, name: 'superadmin', description: 'Toàn quyền', isSystem: true, permissions: [] },
  { id: 2, name: 'editor', description: 'Biên tập', isSystem: false, permissions: [] },
]
type UserRow = { id: number, username: string, email: string | null, isActive: boolean | null, roleId: number | null, roleName: string | null, createdAt: string | null, lastLoginAt: string | null }
const USERS: UserRow[] = [
  { id: 1, username: 'admin', email: 'admin@example.vn', isActive: true, roleId: 1, roleName: 'superadmin', createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: '2026-10-20T02:00:00.000Z' },
  { id: 5, username: 'bientap', email: null, isActive: true, roleId: 2, roleName: 'editor', createdAt: '2026-02-01T00:00:00.000Z', lastLoginAt: null },
  { id: 6, username: 'molan', email: 'molan@example.vn', isActive: null, roleId: null, roleName: null, createdAt: null, lastLoginAt: null },
]

function usersServer(overrides: Record<string, (call: NetCall) => Response | Error> = {}) {
  return routes({
    'GET /api/admin/users': () => json({ ok: true, users: USERS }),
    'GET /api/admin/roles': () => json({ ok: true, roles: ROLES }),
    'POST /api/admin/users': () => json({ ok: true, id: 9 }),
    'PUT /api/admin/users/5': () => json({ ok: true }),
    'PUT /api/admin/users/6': () => json({ ok: true }),
    'DELETE /api/admin/users/5': () => json({ ok: true }),
    ...overrides,
  })
}
const openUsers = (server = usersServer()) =>
  mountAdminPage(USERS_PAGE, server, { modules: { '~/components/admin/AdminModal.vue': { default: OpenModal } } })

const cells = (row: MiniElement) => findAll(row, el => el.tag === 'td').map(textOf)
const desktopRow = (opened: MountedAdminPage, username: string) =>
  findAll(opened.page.root, el => el.tag === 'tr' && findAll(el, td => td.tag === 'td').some(td => textOf(td) === username))[0]!
/** The mobile card (`md:hidden` branch): a `div.p-4` per user. */
const mobileCard = (opened: MountedAdminPage, username: string) =>
  findAll(opened.page.root, el => el.tag === 'div' && String(el.props.class).split(' ')[0] === 'p-4' && textOf(el).startsWith(username))[0]!
const dialog = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'dialog')[0]!

describe('pages/admin/users/index.vue', () => {
  afterEach(unmountAll)
  it('mount: users and roles together; the nullable cells read "—", "Chưa đăng nhập", "Chưa có email" and NULL isActive "Đã khóa"', async () => {
    const opened = await openUsers()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/users', 'GET /api/admin/roles'])
    // Cells: checkbox, ID, username, email, role, status, last login, actions.
    assert.deepEqual(cells(desktopRow(opened, 'bientap')), ['', '#5', 'bientap', '—', 'editor', 'Hoạt động', 'Chưa đăng nhập', ''])
    assert.deepEqual(cells(desktopRow(opened, 'admin')).slice(1, 7),
      ['#1', 'admin', 'admin@example.vn', 'superadmin', 'Hoạt động', new Date('2026-10-20T02:00:00.000Z').toLocaleString('vi-VN')])
    // NULL role (role deleted, leftJoin) → an empty badge; NULL is_active → "Đã khóa", as the login gate reads it.
    assert.deepEqual(cells(desktopRow(opened, 'molan')), ['', '#6', 'molan', 'molan@example.vn', '', 'Đã khóa', 'Chưa đăng nhập', ''])
    assert.match(textOf(mobileCard(opened, 'bientap')), /Chưa có email/)
    assert.doesNotMatch(textOf(opened.page.root), /1970|Invalid Date|null|undefined/)
    opened.page.unmount()
  })

  it('create: posts the form, toasts, reloads users and roles', async () => {
    const opened = await openUsers()
    await click(byText(opened.page.root, 'button', 'Thêm Người dùng Mới'))
    await settle()
    const fields = findAll(dialog(opened), el => el.tag === 'input')
    await input(fields[0]!, 'nv_moi')
    await input(fields[1]!, 'nv@example.vn')
    await input(fields[2]!, 'Mat-khau-dai-123')
    await settle()
    const before = opened.calls.length
    await fire(findAll(dialog(opened), el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'POST /api/admin/users', body: { username: 'nv_moi', email: 'nv@example.vn', password: 'Mat-khau-dai-123', roleId: 2 } },
      'GET /api/admin/users',
      'GET /api/admin/roles',
    ])
    assert.equal(opened.lastToast('success'), 'Đã tạo tài khoản nv_moi thành công!')
    opened.page.unmount()
  })

  it('create refused: the server\'s password-policy sentence shows in the dialog and as a toast', async () => {
    const opened = await openUsers(usersServer({ 'POST /api/admin/users': () => h3Error(400, 'Mật khẩu phải có ít nhất 3 trong 4 nhóm ký tự.') }))
    await click(byText(opened.page.root, 'button', 'Thêm Người dùng Mới'))
    await settle()
    await fire(findAll(dialog(opened), el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.equal(opened.lastToast('error'), 'Mật khẩu phải có ít nhất 3 trong 4 nhóm ký tự.')
    assert.match(textOf(dialog(opened)), /Mật khẩu phải có ít nhất 3 trong 4 nhóm ký tự\./)
    assertOnlyServerSentences(opened)
    opened.page.unmount()
  })

  it('edit: puts email/role/isActive (no password when blank), then reloads', async () => {
    const opened = await openUsers()
    await click(findAll(desktopRow(opened, 'bientap'), el => el.tag === 'button' && el.props.title === 'Chỉnh sửa tài khoản')[0]!)
    await settle()
    await input(findAll(dialog(opened), el => el.tag === 'input' && el.props.type === 'email')[0]!, 'bt@example.vn')
    await settle()
    const before = opened.calls.length
    await fire(findAll(dialog(opened), el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'PUT /api/admin/users/5', body: { email: 'bt@example.vn', roleId: 2, isActive: true } },
      'GET /api/admin/users',
      'GET /api/admin/roles',
    ])
    opened.page.unmount()
  })

  it('edit with a password shorter than 12 warns and sends nothing', async () => {
    const opened = await openUsers()
    await click(findAll(desktopRow(opened, 'bientap'), el => el.tag === 'button' && el.props.title === 'Chỉnh sửa tài khoản')[0]!)
    await settle()
    await input(findAll(dialog(opened), el => el.tag === 'input' && el.props.type === 'password')[0]!, 'ngan')
    await settle()
    const before = opened.calls.length
    await fire(findAll(dialog(opened), el => el.tag === 'form')[0]!, 'submit')
    await settle()
    assert.equal(opened.calls.length, before)
    assert.equal(opened.lastToast('warning'), 'Mật khẩu mới phải có ít nhất 12 ký tự')
    opened.page.unmount()
  })

  it('FINDING: editing an account whose is_active is NULL keeps it locked — saving a new email no longer unlocks it (RED on base)', async () => {
    const opened = await openUsers()
    await click(findAll(desktopRow(opened, 'molan'), el => el.tag === 'button' && el.props.title === 'Chỉnh sửa tài khoản')[0]!)
    await settle()
    // The status select shows what the list (and the login gate) say: locked.
    const status = findAll(dialog(opened), el => el.tag === 'select').at(-1)!
    assert.equal(status.model?.value, false)
    await input(findAll(dialog(opened), el => el.tag === 'input' && el.props.type === 'email')[0]!, 'molan2@example.vn')
    await settle()
    const before = opened.calls.length
    await fire(findAll(dialog(opened), el => el.tag === 'form')[0]!, 'submit')
    await settle()
    const put = sent(opened.calls, before)[0] as { wire: string, body: Record<string, unknown> }
    assert.equal(put.wire, 'PUT /api/admin/users/6')
    assert.equal(put.body.isActive, false)
    opened.page.unmount()
  })

  it('the status button toggles through PUT { isActive } and flips the row', async () => {
    const opened = await openUsers()
    const before = opened.calls.length
    await click(byText(desktopRow(opened, 'bientap'), 'button', 'Hoạt động'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'PUT /api/admin/users/5', body: { isActive: false } }])
    assert.match(textOf(desktopRow(opened, 'bientap')), /Đã khóa/)
    assert.equal(opened.lastToast('success'), 'Đã khóa tài khoản bientap!')
    opened.page.unmount()
  })

  it('delete: confirms, deletes, reloads; a refusal shows the server\'s sentence', async () => {
    let refuse = false
    const opened = await openUsers(usersServer({
      'DELETE /api/admin/users/5': () => (refuse ? h3Error(403, 'Không được xoá tài khoản có quyền cao hơn bạn.') : json({ ok: true })),
    }))
    const before = opened.calls.length
    await click(findAll(desktopRow(opened, 'bientap'), el => el.tag === 'button' && el.props.title === 'Xóa tài khoản')[0]!)
    await settle()
    assert.equal(opened.confirms.at(-1)?.message, 'Bạn có chắc muốn xóa tài khoản bientap?')
    assert.deepEqual(opened.calls.slice(before).map(wire), ['DELETE /api/admin/users/5', 'GET /api/admin/users', 'GET /api/admin/roles'])
    refuse = true
    await click(findAll(desktopRow(opened, 'bientap'), el => el.tag === 'button' && el.props.title === 'Xóa tài khoản')[0]!)
    await settle()
    assert.equal(opened.lastToast('error'), 'Không được xoá tài khoản có quyền cao hơn bạn.')
    opened.page.unmount()
  })

  it('a failed load shows the server\'s sentence in the alert and "thử lại" loads both again', async () => {
    let fail = true
    const opened = await openUsers(usersServer({ 'GET /api/admin/users': () => (fail ? h3Error(403, 'Bạn không có quyền xem người dùng.') : json({ ok: true, users: USERS })) }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem người dùng\./)
    assertOnlyServerSentences(opened)
    fail = false
    const before = opened.calls.length
    await click(byText(findAll(opened.page.root, el => el.props.role === 'alert')[0] as MiniElement, 'button', 'thử lại'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/users', 'GET /api/admin/roles'])
    assert.equal(alertText(opened.page), '')
    opened.page.unmount()
  })
})

// ─── pages/admin/readers/[id].vue ────────────────────────────────────────────

const READER_PAGE = 'pages/admin/readers/[id].vue'
const IMPACT = { comments: 3, adminReplies: 1, otherReaderReplies: 2 }
const READER = {
  id: 7, displayName: null, email: null, isBanned: false, banReason: null, bannedAt: null, bannedByName: null,
  createdAt: null, lastSeenAt: '2026-10-21T08:30:00.000Z', lastIp: null, lastUserAgent: 'Mozilla/5.0',
}
const COMMENTS = [
  { id: 41, body: 'Bình luận về bài viết', createdAt: '2026-10-20T02:00:00.000Z', parentId: null, articleId: 3, articleTitle: 'Tin tái hòa nhập', articleSlug: 'tin', mediaItemId: null, mediaItemTitle: null, mediaItemSlug: null },
  { id: 42, body: 'Phản hồi dưới video', createdAt: null, parentId: 40, articleId: null, articleTitle: null, articleSlug: null, mediaItemId: 12, mediaItemTitle: null, mediaItemSlug: null },
]

const readerDetail = (state: { banned: boolean }) => json({
  ok: true,
  reader: { ...READER, isBanned: state.banned, bannedAt: state.banned ? '2026-10-22T01:00:00.000Z' : null, bannedByName: state.banned ? 'admin' : null, banReason: state.banned ? 'Spam' : null },
  comments: COMMENTS,
  impact: IMPACT,
})

function readerServer(state: { banned: boolean }, overrides: Record<string, (call: NetCall) => Response | Error> = {}) {
  return routes({
    'GET /api/admin/readers/7': () => readerDetail(state),
    'GET /api/admin/readers/7/impact': () => json({ ok: true, impact: { ...IMPACT, comments: 4 } }),
    'POST /api/admin/readers/7/ban': () => { state.banned = true; return json({ ok: true, impact: { ...IMPACT, comments: 4 } }) },
    'POST /api/admin/readers/7/unban': () => { state.banned = false; return json({ ok: true }) },
    'DELETE /api/admin/readers/7/comments': () => json({ ok: true, impact: { ...IMPACT, comments: 4 } }),
    'DELETE /api/admin/readers/7': () => json({ ok: true, impact: IMPACT }),
    'DELETE /api/admin/comments/41': () => json({ ok: true }),
    ...overrides,
  })
}
const openReader = (state = { banned: false }, overrides?: Record<string, (call: NetCall) => Response | Error>) =>
  mountAdminPage(READER_PAGE, readerServer(state, overrides), { route: { params: { id: '7' } } })
/** The reader's `<dl>`: each `<dt>` with its `<dd>`. */
const definitions = (opened: MountedAdminPage) => Object.fromEntries(findAll(opened.page.root, el => el.tag === 'div' && el.children.some(c => c.kind === 'element' && c.tag === 'dt'))
  .map(div => [textOf(findAll(div, el => el.tag === 'dt')[0]!), textOf(findAll(div, el => el.tag === 'dd')[0]!)]))

describe('pages/admin/readers/[id].vue', () => {
  afterEach(unmountAll)
  it('mount reads the reader once; the nullable cells read "—" / "Chưa có tên" / "Video đã không còn"', async () => {
    const opened = await openReader()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/readers/7'])
    assert.equal(textOf(findAll(opened.page.root, el => el.tag === 'h1')[0]!), 'Chưa có tên')
    assert.deepEqual(definitions(opened), {
      'Đăng nhập lần đầu': '—',
      'Truy cập gần nhất': new Date('2026-10-21T08:30:00.000Z').toLocaleString('vi-VN', { hour12: false }),
      'Địa chỉ gần nhất': '—',
      'Trình duyệt gần nhất': 'Mozilla/5.0',
    })
    const text = textOf(opened.page.root)
    assert.match(text, /Bình luận đã viết \(3\)/)
    assert.match(text, /1 phản hồi của Ban quản trị và 2 phản hồi của người đọc khác/)
    const heads = findAll(opened.page.root, el => el.tag === 'li').map(li => textOf(findAll(li, el => el.tag === 'div' && String(el.props.class).startsWith('text-[0.8rem]'))[0]!))
    assert.deepEqual(heads, [
      `${new Date('2026-10-20T02:00:00.000Z').toLocaleString('vi-VN', { hour12: false })} — Bài viết: Tin tái hòa nhập`,
      'Phản hồi — — Video đã không còn',
    ])
    assert.doesNotMatch(text, /1970|Invalid Date|null|undefined/)
    opened.page.unmount()
  })

  it('ban: fresh impact, prompt, a confirm stating all three counts, POST { reason }, toast, reload', async () => {
    const opened = await openReader()
    opened.answers.prompt = 'Spam liên tục'
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Chặn tài khoản'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      'GET /api/admin/readers/7/impact',
      { wire: 'POST /api/admin/readers/7/ban', body: { reason: 'Spam liên tục' } },
      'GET /api/admin/readers/7',
    ])
    assert.match(String(opened.confirms.at(-1)?.message), /^Chặn tài khoản này và xoá 4 bình luận của người đọc này, và 1 phản hồi của Ban quản trị nằm dưới các bình luận đó, và 2 phản hồi của người đọc khác nằm dưới các bình luận đó\?/)
    assert.equal(opened.lastToast('success'), 'Đã chặn tài khoản và xoá 4 bình luận.')
    assert.match(textOf(opened.page.root), /Đã chặn/)
    assert.equal(definitions(opened)['Bị chặn lúc'], `${new Date('2026-10-22T01:00:00.000Z').toLocaleString('vi-VN', { hour12: false })} — bởi admin`)
    assert.equal(definitions(opened)['Lý do'], 'Spam')
    opened.page.unmount()
  })

  it('ban cancelled at the prompt sends nothing after the impact read', async () => {
    const opened = await openReader()
    opened.answers.prompt = null
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Chặn tài khoản'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/readers/7/impact'])
    opened.page.unmount()
  })

  it('a failed impact read falls back to the counts of the page load', async () => {
    const opened = await openReader({ banned: false }, { 'GET /api/admin/readers/7/impact': () => h3Error(503, 'Tạm thời không đếm được.') })
    opened.answers.confirm = false
    await click(byText(opened.page.root, 'button', 'Xoá tài khoản'))
    await settle()
    assert.match(String(opened.confirms.at(-1)?.message), /^Xoá hẳn tài khoản này cùng 3 bình luận của người đọc này/)
    opened.page.unmount()
  })

  it('unban: confirms, posts, reloads', async () => {
    const opened = await openReader({ banned: true })
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Bỏ chặn'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['POST /api/admin/readers/7/unban', 'GET /api/admin/readers/7'])
    assert.equal(opened.lastToast('success'), 'Đã bỏ chặn tài khoản.')
    opened.page.unmount()
  })

  it('purge: deletes the comments, toasts the server count, reloads; with none it only informs', async () => {
    const opened = await openReader()
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Xoá toàn bộ bình luận'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/readers/7/impact', 'DELETE /api/admin/readers/7/comments', 'GET /api/admin/readers/7'])
    assert.equal(opened.lastToast('success'), 'Đã xoá 4 bình luận.')
    opened.page.unmount()

    const none = await openReader({ banned: false }, { 'GET /api/admin/readers/7/impact': () => json({ ok: true, impact: { comments: 0, adminReplies: 0, otherReaderReplies: 0 } }) })
    const start = none.calls.length
    await click(byText(none.page.root, 'button', 'Xoá toàn bộ bình luận'))
    await settle()
    assert.deepEqual(none.calls.slice(start).map(wire), ['GET /api/admin/readers/7/impact'])
    assert.equal(none.lastToast('info'), 'Người đọc này chưa có bình luận nào.')
    none.page.unmount()
  })

  it('delete account: deletes, then leaves for the list', async () => {
    const opened = await openReader()
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Xoá tài khoản'))
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/readers/7/impact', 'DELETE /api/admin/readers/7'])
    assert.deepEqual(opened.pushes, ['/admin/readers'])
    opened.page.unmount()
  })

  it('delete account refused: 404 (already deleted by someone else) leaves for the list with the sentence; another refusal stays', async () => {
    const gone = await openReader({ banned: false }, { 'DELETE /api/admin/readers/7': () => h3Error(404, 'Không tìm thấy tài khoản người đọc.') })
    await click(byText(gone.page.root, 'button', 'Xoá tài khoản'))
    await settle()
    assert.equal(gone.lastToast('error'), 'Không tìm thấy tài khoản người đọc.')
    // Before (verifier round 3): the page stayed on an account that no longer exists.
    assert.deepEqual(gone.pushes, ['/admin/readers'])
    gone.page.unmount()

    const refused = await openReader({ banned: false }, { 'DELETE /api/admin/readers/7': () => h3Error(403, 'Forbidden: Insufficient permissions') })
    await click(byText(refused.page.root, 'button', 'Xoá tài khoản'))
    await settle()
    assert.deepEqual(refused.pushes, [])
    // The page stays usable: `busy` is cleared (verifier V3-21).
    assert.equal(byText(refused.page.root, 'button', 'Xoá tài khoản').props.disabled, false)
    refused.page.unmount()
  })

  it('ban or purge refused with 404 (the account was deleted meanwhile): the sentence, then back to the list; any other refusal stays', async () => {
    const sentence = 'Không tìm thấy tài khoản người đọc.'
    for (const [route, button] of [['POST /api/admin/readers/7/ban', 'Chặn tài khoản'], ['DELETE /api/admin/readers/7/comments', 'Xoá toàn bộ bình luận']] as const) {
      const gone = await openReader({ banned: false }, { [route]: () => h3Error(404, sentence) })
      gone.answers.prompt = ''
      await click(byText(gone.page.root, 'button', button))
      await settle()
      // Before (verifier round 4, L1): the page stayed on an account that no longer exists.
      assert.deepEqual([gone.lastToast('error'), gone.pushes], [sentence, ['/admin/readers']], route)
      gone.page.unmount()
    }
    for (const [route, button, refusal] of [
      ['POST /api/admin/readers/7/ban', 'Chặn tài khoản', () => h3Error(409, 'Tài khoản này đã bị chặn.')],
      ['DELETE /api/admin/readers/7/comments', 'Xoá toàn bộ bình luận', () => h3Error(403, 'Bạn không có quyền thực hiện thao tác này.')],
    ] as const) {
      const refused = await openReader({ banned: false }, { [route]: refusal })
      refused.answers.prompt = ''
      await click(byText(refused.page.root, 'button', button))
      await settle()
      assert.deepEqual(refused.pushes, [], route)
      refused.page.unmount()
    }
  })

  it('delete one comment: the confirm warns about the replies under a top-level comment; delete then reload', async () => {
    const opened = await openReader()
    const before = opened.calls.length
    const item = findAll(opened.page.root, el => el.tag === 'li' && textOf(el).includes('Bình luận về bài viết'))[0]!
    await click(byText(item, 'button', 'Xoá'))
    await settle()
    assert.match(String(opened.confirms.at(-1)?.message), /^Xoá bình luận này\? Mọi phản hồi bên dưới/)
    assert.deepEqual(opened.calls.slice(before).map(wire), ['DELETE /api/admin/comments/41', 'GET /api/admin/readers/7'])
    opened.page.unmount()
  })

  it('a refused action shows the server\'s sentence; a failed load the alert with "Thử lại"', async () => {
    const opened = await openReader({ banned: false }, { 'POST /api/admin/readers/7/ban': () => h3Error(409, 'Tài khoản này đã bị chặn.') })
    await click(byText(opened.page.root, 'button', 'Chặn tài khoản'))
    await settle()
    assert.equal(opened.lastToast('error'), 'Tài khoản này đã bị chặn.')
    assertOnlyServerSentences(opened)
    opened.page.unmount()

    let missing = true
    const gone = await openReader({ banned: false }, {
      'GET /api/admin/readers/7': () => (missing ? h3Error(404, 'Không tìm thấy tài khoản người đọc.') : readerDetail({ banned: false })),
    })
    assert.match(alertText(gone.page), /Không tìm thấy tài khoản người đọc\./)
    assertOnlyServerSentences(gone)
    missing = false
    gone.calls.length = 0
    await click(buttons(gone.page, 'Thử lại')[0]!)
    await settle()
    assert.deepEqual(gone.calls.map(wire), ['GET /api/admin/readers/7'])
    assert.equal(alertText(gone.page), '')
    gone.page.unmount()
  })
})
