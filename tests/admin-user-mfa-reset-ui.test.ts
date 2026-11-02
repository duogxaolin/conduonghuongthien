/**
 * The break-glass "Xoá xác thực hai bước" button on /admin/users (§ 68) — the interface to
 * `DELETE /api/admin/users/:id/mfa` (server/api/admin/users/[id]/mfa.delete.ts; the route's own
 * invariants are pinned by tests/admin-user-mfa-reset-behavior.test.ts).
 *
 * Three layers, each driven for real:
 *   - `app/utils/admin-user-mfa-reset.ts` — who may see it, the dialog, the request — called
 *     directly with recording stand-ins;
 *   - `components/admin/UserMfaResetButton.vue` mounted on its own (tests/_admin-page-harness.ts:
 *     real `<script setup>` + template, real ofetch on a fake network, real `adminFetch`);
 *   - `pages/admin/users/index.vue` mounted, to pin WHERE the button sits: on every row of both
 *     layouts, with that row's account, icon-only in the desktop table.
 *
 * Mutations each test is meant to catch: a truthy look-alike counted as SuperAdmin; the button on
 * the operator's own row (number or string id); `users.update` instead of SuperAdmin; a request
 * without the typed name, or with a wrong one, or after "Hủy"; a decomposed (NFD) typing of the
 * right name refused; the wrong path/method, or a body; the dialog dropping a consequence, or
 * stating re-enrolment as unconditional; the success/failure toast not being the server's
 * sentence; a double click sending twice; a button losing `aria-busy` while in flight.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  canResetUserMfa, mfaResetConfirmed, mfaResetPrompt, resetUserMfa, userMfaResetPath,
  type MfaResetDeps,
} from '../app/utils/admin-user-mfa-reset.ts'
import { click, findAll, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

const SUPERADMIN = { id: 1, isSuperAdmin: true }
const TARGET = { id: 9, username: 'target' }

// ─── Who sees the button ─────────────────────────────────────────────────────

describe('canResetUserMfa — the server\'s gate, mirrored', () => {
  it('a SuperAdmin sees it on another account — including another SuperAdmin\'s, the main break-glass case', () => {
    assert.equal(canResetUserMfa(SUPERADMIN, TARGET), true)
    assert.equal(canResetUserMfa(SUPERADMIN, { id: 2, username: 'admin2' }), true)
  })

  it('only a strict isSuperAdmin === true counts, as in the handler', () => {
    for (const isSuperAdmin of ['true', 1, {}, [true], 'yes', false, null, undefined]) {
      assert.equal(canResetUserMfa({ id: 1, isSuperAdmin }, TARGET), false, JSON.stringify(isSuperAdmin))
    }
    assert.equal(canResetUserMfa(null, TARGET), false)
    assert.equal(canResetUserMfa(undefined, TARGET), false)
  })

  it('never on the operator\'s own row, whether the ids are numbers or strings', () => {
    assert.equal(canResetUserMfa(SUPERADMIN, { id: 1, username: 'admin' }), false)
    assert.equal(canResetUserMfa(SUPERADMIN, { id: '1', username: 'admin' }), false)
    assert.equal(canResetUserMfa({ id: '9', isSuperAdmin: true }, TARGET), false)
  })

  it('an actor or a row without a usable id shows nothing — "not myself" cannot be known', () => {
    for (const id of [undefined, null, 0, -1, 'abc', 1.5]) {
      assert.equal(canResetUserMfa({ id, isSuperAdmin: true }, TARGET), false, `actor id ${String(id)}`)
      assert.equal(canResetUserMfa(SUPERADMIN, { id: id as number, username: 'x' }), false, `target id ${String(id)}`)
    }
  })
})

describe('the dialog and the request', () => {
  it('the path is the route\'s, with the row\'s numeric id', () => {
    assert.equal(userMfaResetPath(TARGET), '/api/admin/users/9/mfa')
    assert.equal(userMfaResetPath({ id: '12', username: 'x' }), '/api/admin/users/12/mfa')
  })

  it('the dialog is a danger prompt that names the account and every consequence', () => {
    const options = mfaResetPrompt(TARGET)
    assert.equal(options.danger, true)
    assert.equal(options.title, 'Xoá xác thực hai bước')
    assert.equal(options.confirmLabel, 'Xoá xác thực hai bước')
    assert.equal(options.label, 'Gõ tên tài khoản "target" để xác nhận')
    assert.equal(options.placeholder, '', 'the field does not hand the name over')
    for (const consequence of [
      /MỌI yếu tố xác thực hai bước \(ứng dụng xác thực, mã qua email, mật khẩu thứ hai\)/,
      // The recovery codes go too — pinned on their own clause: "mất mã dự phòng" further on is the
      // lockout example, not this consequence.
      /và mọi mã dự phòng của tài khoản "target"/,
      /đăng xuất khỏi mọi phiên/,
      /Không thể hoàn tác/,
      /nhật ký hoạt động của cả hai tài khoản/,
    ]) {
      assert.match(options.message, consequence)
    }
  })

  it('re-enrolment is stated as conditional on the MFA policy — without it the next sign-in is the password alone', () => {
    const { message } = mfaResetPrompt(TARGET)
    // server/utils/mfa/policy.ts: `off` covers no one; login.post.ts issues no challenge without an active factor.
    assert.match(message, /Nếu hệ thống đang bắt buộc xác thực hai bước với tài khoản này, người đó phải đăng ký lại; nếu không, lần đăng nhập sau chỉ cần mật khẩu\./)
    assert.doesNotMatch(message, /phiên và phải đăng ký lại/, 'not the unconditional claim')
  })

  it('only the exact name confirms (spaces around it are dropped; case is not)', () => {
    assert.equal(mfaResetConfirmed('target', TARGET), true)
    assert.equal(mfaResetConfirmed('  target \n', TARGET), true)
    for (const typed of [null, '', 'Target', 'targe', 'target2', 'admin']) {
      assert.equal(mfaResetConfirmed(typed, TARGET), false, String(typed))
    }
  })

  it('a composed and a decomposed Vietnamese name are the same name (NFC on both sides); case and diacritics still count', () => {
    const vi = { id: 7, username: 'nguyễn.văn'.normalize('NFC') }
    const nfd = vi.username.normalize('NFD')
    assert.notEqual(nfd, vi.username, 'the two forms really are different strings')
    assert.equal(mfaResetConfirmed(nfd, vi), true, 'typed decomposed, stored composed')
    assert.equal(mfaResetConfirmed(` ${nfd}\n`, vi), true, 'trimmed as well')
    assert.equal(mfaResetConfirmed(vi.username, { ...vi, username: nfd }), true, 'typed composed, stored decomposed')
    assert.equal(mfaResetConfirmed('Nguyễn.văn'.normalize('NFD'), vi), false, 'case still counts')
    assert.equal(mfaResetConfirmed('nguyen.van', vi), false, 'no diacritics folding')
  })

  function recorder(answer: string | null, response: (url: string) => Promise<{ message?: string }>) {
    const requests: Array<{ url: string, options: unknown }> = []
    const toasts: Array<[string, string]> = []
    const prompts: unknown[] = []
    const deps: MfaResetDeps = {
      prompt: async (options) => { prompts.push(options); return answer },
      request: (url, options) => { requests.push({ url, options }); return response(url) },
      toast: {
        success: m => { toasts.push(['success', m]) },
        warning: m => { toasts.push(['warning', m]) },
        error: m => { toasts.push(['error', m]) },
      },
    }
    return { deps, requests, toasts, prompts }
  }
  const ok = async () => ({ ok: true, message: 'Đã xoá toàn bộ xác thực hai bước của tài khoản "target" và thu hồi các phiên đăng nhập.' })

  it('"Hủy" sends nothing and says nothing', async () => {
    const r = recorder(null, ok)
    assert.equal(await resetUserMfa(TARGET, r.deps), 'cancelled')
    assert.equal(r.prompts.length, 1)
    assert.deepEqual(r.requests, [])
    assert.deepEqual(r.toasts, [])
  })

  it('a wrong name sends nothing and says why', async () => {
    for (const typed of ['', 'Target', 'admin']) {
      const r = recorder(typed, ok)
      assert.equal(await resetUserMfa(TARGET, r.deps), 'mismatch')
      assert.deepEqual(r.requests, [])
      assert.deepEqual(r.toasts, [['warning', 'Tên tài khoản không khớp "target" — chưa xoá gì.']])
    }
  })

  it('the right name sends exactly one DELETE, no body, and toasts the server\'s sentence', async () => {
    const r = recorder(' target ', ok)
    assert.equal(await resetUserMfa(TARGET, r.deps), 'cleared')
    assert.deepEqual(r.requests, [{ url: '/api/admin/users/9/mfa', options: { method: 'DELETE' } }])
    assert.deepEqual(r.toasts, [['success', 'Đã xoá toàn bộ xác thực hai bước của tài khoản "target" và thu hồi các phiên đăng nhập.']])
  })

  it('a decomposed typing of the right name sends the DELETE by id', async () => {
    const vi = { id: 7, username: 'nguyễn.văn'.normalize('NFC') }
    const r = recorder(vi.username.normalize('NFD'), ok)
    assert.equal(await resetUserMfa(vi, r.deps), 'cleared')
    assert.deepEqual(r.requests, [{ url: '/api/admin/users/7/mfa', options: { method: 'DELETE' } }])
  })

  it('an answer without a sentence still names the account', async () => {
    const r = recorder('target', async () => ({}))
    assert.equal(await resetUserMfa(TARGET, r.deps), 'cleared')
    assert.deepEqual(r.toasts, [['success', 'Đã xoá xác thực hai bước của tài khoản "target".']])
  })

  it('a refusal toasts the server\'s sentence; a failure without one, the fallback', async () => {
    const refused = recorder('target', async () => { throw Object.assign(new Error('[DELETE] "/api/admin/users/9/mfa": 403 Forbidden'), { data: { statusMessage: 'Chỉ quản trị viên cấp cao được xoá xác thực hai bước của tài khoản khác.' } }) })
    assert.equal(await resetUserMfa(TARGET, refused.deps), 'failed')
    assert.deepEqual(refused.toasts, [['error', 'Chỉ quản trị viên cấp cao được xoá xác thực hai bước của tài khoản khác.']])
    // ofetch's own error for a dropped connection: its generated line never reaches the toast.
    const dropped = recorder('target', async () => { throw Object.assign(new Error('[DELETE] "/api/admin/users/9/mfa": <no response> fetch failed'), { name: 'FetchError' }) })
    assert.equal(await resetUserMfa(TARGET, dropped.deps), 'failed')
    assert.deepEqual(dropped.toasts, [['error', 'Không xoá được xác thực hai bước của tài khoản này.']])
  })
})

// ─── The component, mounted ──────────────────────────────────────────────────

const BUTTON = 'components/admin/UserMfaResetButton.vue'
const RESET_OK = { ok: true, message: 'Đã xoá toàn bộ xác thực hai bước của tài khoản "bientap" và thu hồi các phiên đăng nhập.' }
const ROW = { id: 5, username: 'bientap' }

const mfaServer = (answer = () => json(RESET_OK)) => routes({ 'DELETE /api/admin/users/5/mfa': answer })
const openButton = (options: { user?: Record<string, unknown>, compact?: boolean, server?: ReturnType<typeof mfaServer> } = {}) =>
  mountAdminPage(BUTTON, options.server ?? mfaServer(), { props: { user: ROW, compact: options.compact ?? true }, user: options.user })
const resetButtons = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button')

describe('components/admin/UserMfaResetButton.vue', () => {
  afterEach(unmountAll)

  it('a SuperAdmin on another row: an icon button named for the account, nothing sent on mount', async () => {
    const opened = await openButton()
    const [button] = resetButtons(opened)
    assert.ok(button)
    assert.equal(button.props['aria-label'], 'Xoá xác thực hai bước của bientap')
    assert.equal(button.props.title, 'Xoá xác thực hai bước của bientap')
    assert.equal(textOf(button), '', 'icon only — the desktop actions cell carries no text')
    assert.equal(findAll(button, el => el.tag === 'i')[0]?.props['aria-hidden'], 'true')
    assert.deepEqual(opened.calls, [])
  })

  it('the mobile variant is a text button', async () => {
    const opened = await openButton({ compact: false })
    const [button] = resetButtons(opened)
    assert.equal(textOf(button!), 'Xoá xác thực hai bước')
  })

  it('hidden for a non-SuperAdmin — even one holding every flag on users — for look-alikes, and on one\'s own row', async () => {
    for (const user of [{ isSuperAdmin: false }, { isSuperAdmin: 'true' }, { isSuperAdmin: 1 }, { id: 5, isSuperAdmin: true }, { id: '5', isSuperAdmin: true }]) {
      for (const compact of [true, false]) {
        const opened = await openButton({ user, compact })
        assert.deepEqual(resetButtons(opened), [], `${JSON.stringify(user)} compact=${compact}`)
      }
    }
  })

  it('click → the danger prompt → the typed name → DELETE /api/admin/users/5/mfa without a body → the server\'s sentence', async () => {
    const opened = await openButton()
    opened.answers.prompt = 'bientap'
    await click(resetButtons(opened)[0]!)
    await settle()
    assert.equal(opened.prompts.length, 1)
    assert.equal(opened.prompts[0]!.danger, true)
    assert.match(String(opened.prompts[0]!.message), /"bientap"/)
    assert.deepEqual(sent(opened.calls), ['DELETE /api/admin/users/5/mfa'])
    assert.equal(opened.lastToast('success'), RESET_OK.message)
    assert.equal(resetButtons(opened)[0]!.props.disabled, false, 'usable again afterwards')
  })

  it('"Hủy" or a wrong name sends nothing', async () => {
    const opened = await openButton()
    opened.answers.prompt = null
    await click(resetButtons(opened)[0]!)
    await settle()
    opened.answers.prompt = 'admin'
    await click(resetButtons(opened)[0]!)
    await settle()
    assert.equal(opened.prompts.length, 2)
    assert.deepEqual(opened.calls, [])
    assert.equal(opened.lastToast('warning'), 'Tên tài khoản không khớp "bientap" — chưa xoá gì.')
  })

  it('a refusal shows the sentence the server wrote, never ofetch\'s line', async () => {
    const opened = await openButton({ server: mfaServer(() => h3Error(403, 'Chỉ quản trị viên cấp cao được xoá xác thực hai bước của tài khoản khác.')) })
    opened.answers.prompt = 'bientap'
    await click(resetButtons(opened)[0]!)
    await settle()
    assert.deepEqual(opened.calls.map(wire), ['DELETE /api/admin/users/5/mfa'])
    assert.equal(opened.lastToast('error'), 'Chỉ quản trị viên cấp cao được xoá xác thực hai bước của tài khoản khác.')
    for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE)
  })

  it('both variants: disabled and aria-busy while the request is in flight, neither before nor after', async () => {
    for (const compact of [true, false]) {
      const pending: NetCall[] = []
      const opened = await openButton({ compact, server: routes({ 'DELETE /api/admin/users/5/mfa': (call) => { pending.push(call); return undefined } }) })
      opened.answers.prompt = 'bientap'
      const idle = resetButtons(opened)[0]!
      assert.equal(idle.props['aria-busy'], false, `compact=${compact}: idle`)
      assert.equal(idle.props.disabled, false)
      void click(idle)
      await settle()
      assert.equal(pending.length, 1)
      const busy = resetButtons(opened)[0]!
      assert.equal(busy.props['aria-busy'], true, `compact=${compact}: in flight`)
      assert.equal(busy.props.disabled, true)
      pending[0]!.respond(json(RESET_OK))
      await settle()
      assert.equal(resetButtons(opened)[0]!.props['aria-busy'], false, `compact=${compact}: done`)
      assert.equal(resetButtons(opened)[0]!.props.disabled, false)
      unmountAll()
    }
  })

  it('a second click while the first is still asking does nothing', async () => {
    const opened = await openButton()
    opened.answers.prompt = 'bientap'
    const button = resetButtons(opened)[0]!
    const first = click(button)
    const second = click(button)
    await Promise.all([first, second])
    await settle()
    assert.equal(opened.prompts.length, 1)
    assert.deepEqual(opened.calls.map(wire), ['DELETE /api/admin/users/5/mfa'])
  })
})

// ─── Where the page puts it ──────────────────────────────────────────────────

describe('pages/admin/users/index.vue — the button on every row, both layouts', () => {
  afterEach(unmountAll)

  const USERS = [
    { id: 1, username: 'admin', email: null, isActive: true, roleId: 1, roleName: 'superadmin', createdAt: null, lastLoginAt: null },
    { id: 5, username: 'bientap', email: null, isActive: true, roleId: 2, roleName: 'editor', createdAt: null, lastLoginAt: null },
  ]
  const openUsers = () => mountAdminPage('pages/admin/users/index.vue', routes({
    'GET /api/admin/users': () => json({ ok: true, users: USERS }),
    'GET /api/admin/roles': () => json({ ok: true, roles: [] }),
  }), { modules: { '~/components/admin/AdminModal.vue': { default: OpenModal } } })

  // Auto-imported, not registered here: the tag renders as a plain element carrying its props
  // (tests/_sfc-mount.ts), which is exactly what a placement check reads.
  const placed = (root: MiniElement) => findAll(root, el => el.tag === 'AdminUserMfaResetButton')

  it('each desktop row\'s actions cell holds it, compact, for that row\'s account', async () => {
    const opened = await openUsers()
    const rows = findAll(opened.page.root, el => el.tag === 'tr' && findAll(el, td => td.tag === 'td').length > 0)
    assert.equal(rows.length, USERS.length)
    for (const [i, row] of rows.entries()) {
      const actions = findAll(row, el => el.tag === 'td').at(-1)!
      const [tag] = placed(actions)
      assert.ok(tag, `row ${i}`)
      assert.deepEqual(tag.props.user, USERS[i], 'the row itself — the component decides who sees it')
      assert.equal(tag.props.compact, '')
    }
  })

  it('each mobile card\'s action row holds it, not compact', async () => {
    const opened = await openUsers()
    const cards = findAll(opened.page.root, el => el.tag === 'div' && String(el.props.class).split(' ')[0] === 'p-4')
    assert.equal(cards.length, USERS.length)
    for (const [i, card] of cards.entries()) {
      const [tag] = placed(card)
      assert.ok(tag, `card ${i}`)
      assert.deepEqual(tag.props.user, USERS[i])
      assert.equal('compact' in tag.props, false)
      // Beside Sửa / Xóa / Khóa, in a row that wraps on a narrow phone.
      assert.match(String(tag.parent!.props.class), /\bflex-wrap\b/)
    }
  })
})
