/**
 * `/admin/profile` — behaviour, through the page's own controls.
 *
 * Wave 3 task 4.1 (split the 901-line page along its section seams: password, factors,
 * recovery codes, history) and 7.1 (its 8 `($fetch as …)` casts become `adminFetch<T>()`).
 * Written BEFORE the split and run the same way on both versions: the REAL page mounted
 * on a minimal DOM with real ofetch over a fake profile API (tests/_profile-page-harness.ts).
 * Every action is a click, a typed value or a key on the rendered control, so a split that
 * forgets to wire a model or an emit fails here exactly as a dead control would.
 *
 * Pinned (green on the base f6b110a and after the split):
 *   - the mount shows the three-card skeleton, reads `GET /api/admin/profile/mfa` once and
 *     renders the three factors; a failed read shows the SERVER's sentence (never ofetch's
 *     `[GET] "…"` line) in the `role="alert"` branch and "Thử lại" re-reads; 401 and 403
 *     are not branched on — same sentence, nothing more is sent;
 *   - password change: the two client checks, the server's policy sentence verbatim, a
 *     wrong current password (401) stays a form error, success toasts and clears;
 *   - each factor — TOTP, email OTP, second password — enroll (password step), confirm
 *     (code step), and disable: same method, path and body, same messages, same focus
 *     moves, and the same re-reads after it (confirm: status + history + `me`; disable:
 *     status + history);
 *   - recovery codes: shown once from the first factor's confirm (MFA policy), created,
 *     regenerated and turned off through their dialog, copied, downloaded, hidden;
 *   - the lockout warning follows the server's `lockoutRisk` after the re-read;
 *   - Escape, the ✕, "Huỷ" and the backdrop close a dialog; Escape does not while busy;
 *     a held or IME Enter sends nothing.
 *
 * Fixed by the split (RED on the base — each test says why):
 *   - a dialog answer that lands after "Huỷ" is no longer written into the dialog opened
 *     since (its error, its close, its step), while what the server DID (the toast, the
 *     one-time recovery codes, the re-reads) still happens;
 *   - two status reads in flight: the newest answer wins and the skeleton stays until it
 *     lands (an older answer landing last showed the state from before the change);
 *   - Enter pressed again while a request is in flight sends nothing more (a second
 *     "Tạo mã" replaced the batch just shown on screen);
 *   - of two recovery batches in flight, the older answer landing last no longer replaces
 *     the newer batch on screen (the codes shown would be the ones the server discarded).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { passwordRejectionMessage } from '../server/utils/password-policy.ts'
import { formatDateTimeVN } from '../app/utils/formatDate.ts'
import {
  API, CURRENT_PASSWORD, EMAIL_CODE, FACTOR_LABEL, HOLD, MASKED_EMAIL, OFETCH_LINE, TOTP_CODE, TOTP_SECRET,
  accountBadge, alertTexts, alerts, batchOf, button, byId, dialog, dialogs, dropped, enter, factorCard, h3Error,
  historyShown, json, maybeById, mountProfile, openProfile, overlay, profileServer, recoveryCard, section, sent,
  shownCodes, skeleton, textOf, wire, withActive, type FactorType, type NetCall, type ProfileCtx,
} from './_profile-page-harness.ts'
import { click, findAll, fire, input } from './_sfc-mount.ts'

const MFA_GET = `GET ${API}/mfa`

function assertOnlyServerSentences(ctx: ProfileCtx) {
  for (const t of ctx.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  for (const alert of alerts(ctx.page)) assert.doesNotMatch(textOf(alert), OFETCH_LINE)
}

/** The sentences in the page's alerts, without the "Thử lại" button text of the load alert. */
const loadAlert = (ctx: ProfileCtx) => alertTexts(ctx.page).map(text => text.replace(/\s*Thử lại$/, ''))
const dialogTitle = (ctx: ProfileCtx) => textOf(findAll(dialog(ctx.page), el => el.tag === 'h3')[0]!)
const modelOf = (ctx: ProfileCtx, id: string) => byId(ctx.page, id).model?.value
const lastToast = (ctx: ProfileCtx, type: string) => ctx.toasts.filter(t => t.type === type).at(-1)?.message
const holdWhere = (ctx: ProfileCtx, match: (call: NetCall) => boolean) => {
  const before = ctx.server.state.override
  ctx.server.state.override = call => (match(call) ? HOLD : before(call))
}
const isCall = (method: string, path: string) => (call: NetCall) => call.method === method && call.url.pathname === `${API}${path}`

async function typeInto(ctx: ProfileCtx, id: string, value: string) {
  await input(byId(ctx.page, id), value)
  await ctx.settle()
}
async function press(ctx: ProfileCtx, el: ReturnType<typeof button>) {
  // Not awaited: a handler waiting on a held request settles later (its errors land in page.errors).
  void click(el)
  await ctx.settle()
}
async function pressEnter(ctx: ProfileCtx, id: string, overrides?: Parameters<typeof enter>[0]) {
  const event = enter(overrides)
  void fire(byId(ctx.page, id), 'keydown', event)
  await ctx.settle()
  return event
}
async function openFactorDialog(ctx: ProfileCtx, factorType: FactorType, label: 'Bật' | 'Tiếp tục bật' | 'Tắt') {
  await press(ctx, button(factorCard(ctx.page, factorType), label))
}
/** Enroll step 1 → step 2 of a factor through the dialog. */
async function reachConfirmStep(ctx: ProfileCtx, factorType: FactorType, secondPassword = 'Cap2-BiMat#2026') {
  await openFactorDialog(ctx, factorType, 'Bật')
  await typeInto(ctx, 'enroll-pw', CURRENT_PASSWORD)
  if (factorType === 'second_password') {
    await typeInto(ctx, 'enroll-sp', secondPassword)
    await typeInto(ctx, 'enroll-sp2', secondPassword)
  }
  await press(ctx, button(dialog(ctx.page), 'Tiếp tục'))
}

// ─── Loading, error and retry ────────────────────────────────────────────────

describe('profile page — loading', () => {
  it('shows a three-card skeleton, then reads the factor state once and renders the three factors', async (t) => {
    const ctx = await mountProfile(t)
    const busy = skeleton(ctx.page)
    assert.ok(busy, 'role="status" aria-busy skeleton while loading')
    assert.equal(findAll(busy, el => el.props['aria-hidden'] === 'true' && String(el.props.class).startsWith('rounded-xl')).length, 3)
    assert.equal(textOf(findAll(busy, el => el.props.class === 'sr-only')[0]!), 'Đang tải trạng thái xác thực hai bước')
    await ctx.settle()

    assert.deepEqual(sent(ctx.calls), [MFA_GET])
    assert.equal(skeleton(ctx.page), null)
    assert.deepEqual(alertTexts(ctx.page), [])
    assert.deepEqual(ctx.page.errors, [])
    for (const factorType of ['totp', 'email_otp', 'second_password'] as const) {
      const card = factorCard(ctx.page, factorType)
      assert.match(textOf(card), /Đang tắt/)
      assert.equal(button(card, 'Bật').props.disabled, false)
    }
    assert.equal(accountBadge(ctx.page), 'Chưa bật xác thực hai bước')
    assert.match(textOf(ctx.page.root), /canbo\.c11Biên tập viên · canbo@c11\.example\.vn/)
    // No factor yet: no recovery codes, and the button says why it is off.
    const card = recoveryCard(ctx.page)
    assert.equal(button(card, 'Tạo mã dự phòng').props.disabled, true)
    assert.match(textOf(card), /Cần bật ít nhất một yếu tố thứ hai trước khi tạo mã dự phòng\./)
    assert.ok(historyShown(ctx.page), 'the activity history is rendered under its auto-import name')
    assert.equal(ctx.keydownListeners(), 1)
  })

  it('a failed read shows the server\'s sentence in the alert; "Thử lại" reads again and recovers', async (t) => {
    const server = profileServer()
    let failing = true
    server.state.override = call => (failing && call.url.pathname === `${API}/mfa` ? h3Error(400, 'Không đọc được cấu hình xác thực.') : undefined)
    const ctx = await openProfile(t, server)

    const [alert] = alerts(ctx.page)
    assert.deepEqual(loadAlert(ctx), ['Không đọc được cấu hình xác thực.'])
    assert.equal(findAll(ctx.page.root, el => el.tag === 'strong' && textOf(el) === FACTOR_LABEL.totp).length, 0)
    assertOnlyServerSentences(ctx)

    failing = false
    await press(ctx, button(alert!, 'Thử lại'))
    assert.deepEqual(sent(ctx.calls), [MFA_GET, MFA_GET])
    assert.deepEqual(alertTexts(ctx.page), [])
    assert.match(textOf(factorCard(ctx.page, 'totp')), /Đang tắt/)
  })

  it('a dropped connection shows the page\'s own fallback, never ofetch\'s line', async (t) => {
    const server = profileServer()
    server.state.override = call => (call.url.pathname === `${API}/mfa` ? dropped() : undefined)
    const ctx = await openProfile(t, server)
    assert.deepEqual(loadAlert(ctx), ['Không tải được trạng thái xác thực hai bước.'])
    assertOnlyServerSentences(ctx)
  })

  for (const [status, sentence] of [[401, 'Unauthorized'], [403, 'Tài khoản phải bật xác thực hai bước trước khi tiếp tục.']] as const) {
    it(`${status} on the read: the server's sentence in the same alert, and nothing more is sent (no status branch)`, async (t) => {
      const server = profileServer()
      server.state.override = call => (call.url.pathname === `${API}/mfa` ? h3Error(status, sentence) : undefined)
      const ctx = await openProfile(t, server)
      assert.deepEqual(loadAlert(ctx), [sentence])
      assert.ok(button(alerts(ctx.page)[0]!, 'Thử lại'))
      assert.deepEqual(sent(ctx.calls), [MFA_GET])
      assert.equal(ctx.auth.fetches, 0)
      assert.deepEqual(ctx.toasts, [])
    })
  }

  it('leaving the page removes its Escape listener', async (t) => {
    const ctx = await openProfile(t)
    assert.equal(ctx.keydownListeners(), 1)
    ctx.close()
    assert.equal(ctx.keydownListeners(), 0)
  })
})

// ─── Password ────────────────────────────────────────────────────────────────

describe('profile page — password change', () => {
  const form = (ctx: ProfileCtx) => findAll(section(ctx.page, 'Đổi mật khẩu'), el => el.tag === 'form')[0]!
  const submit = async (ctx: ProfileCtx) => { void fire(form(ctx), 'submit'); await ctx.settle() }
  const passwordAlert = (ctx: ProfileCtx) => alertTexts(section(ctx.page, 'Đổi mật khẩu'))

  it('checks the two fields and the repeat before sending anything', async (t) => {
    const ctx = await openProfile(t)
    await submit(ctx)
    assert.deepEqual(passwordAlert(ctx), ['Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.'])
    await typeInto(ctx, 'pw-current', CURRENT_PASSWORD)
    await typeInto(ctx, 'pw-next', 'Moi-MatKhau#2027')
    await typeInto(ctx, 'pw-confirm', 'Moi-MatKhau#2028')
    await submit(ctx)
    assert.deepEqual(passwordAlert(ctx), ['Mật khẩu mới và ô nhập lại không khớp.'])
    assert.deepEqual(sent(ctx.calls), [MFA_GET])
  })

  it('a password the policy rejects shows the SERVER\'s sentence, verbatim, and keeps what was typed', async (t) => {
    const ctx = await openProfile(t)
    await typeInto(ctx, 'pw-current', CURRENT_PASSWORD)
    await typeInto(ctx, 'pw-next', 'abc12')
    await typeInto(ctx, 'pw-confirm', 'abc12')
    await submit(ctx)
    const sentence = passwordRejectionMessage('abc12', { username: 'canbo.c11' })
    assert.ok(sentence)
    assert.deepEqual(sent(ctx.calls, 1), [{ wire: `PUT ${API}/password`, body: { currentPassword: CURRENT_PASSWORD, newPassword: 'abc12' } }])
    assert.deepEqual(passwordAlert(ctx), [sentence])
    assert.equal(modelOf(ctx, 'pw-next'), 'abc12')
    assert.equal(button(form(ctx), 'Đổi mật khẩu').props.disabled, false)
    assert.deepEqual(ctx.toasts, [])
  })

  it('a wrong current password (401) stays a form error: nothing re-read, no session handling', async (t) => {
    const ctx = await openProfile(t)
    await typeInto(ctx, 'pw-current', 'sai-mat-khau')
    await typeInto(ctx, 'pw-next', 'Moi-MatKhau#2027')
    await typeInto(ctx, 'pw-confirm', 'Moi-MatKhau#2027')
    await submit(ctx)
    assert.deepEqual(passwordAlert(ctx), ['Mật khẩu hiện tại không đúng.'])
    assert.deepEqual(sent(ctx.calls, 1), [{ wire: `PUT ${API}/password`, body: { currentPassword: 'sai-mat-khau', newPassword: 'Moi-MatKhau#2027' } }])
    assert.equal(ctx.auth.fetches, 0)
    assertOnlyServerSentences(ctx)
  })

  it('while saving the button is disabled and says so; success toasts the server\'s message and clears the fields', async (t) => {
    const ctx = await openProfile(t)
    holdWhere(ctx, isCall('PUT', '/password'))
    await typeInto(ctx, 'pw-current', CURRENT_PASSWORD)
    await typeInto(ctx, 'pw-next', 'Moi-MatKhau#2027')
    await typeInto(ctx, 'pw-confirm', 'Moi-MatKhau#2027')
    await submit(ctx)
    const saving = findAll(form(ctx), el => el.tag === 'button')[0]!
    assert.equal(saving.props.disabled, true)
    assert.equal(textOf(saving), 'Đang đổi…')

    ctx.server.answer(ctx.calls.at(-1)!)
    await ctx.settle()
    assert.deepEqual(ctx.toasts, [{ type: 'success', message: 'Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị thu hồi.' }])
    assert.deepEqual(['pw-current', 'pw-next', 'pw-confirm'].map(id => modelOf(ctx, id)), ['', '', ''])
    assert.deepEqual(passwordAlert(ctx), [])
    assert.equal(textOf(button(form(ctx), 'Đổi mật khẩu')), 'Đổi mật khẩu')
  })
})

// ─── Factors: enroll, confirm, disable ───────────────────────────────────────

describe('profile page — TOTP', () => {
  it('enroll: password step, the secret shown for manual entry, a wrong code kept out, the right code turns it on', async (t) => {
    const ctx = await openProfile(t)
    await openFactorDialog(ctx, 'totp', 'Bật')
    assert.equal(dialogTitle(ctx), `Bật ${FACTOR_LABEL.totp}`)
    assert.deepEqual(ctx.focused, ['enroll-pw'])

    await press(ctx, button(dialog(ctx.page), 'Tiếp tục'))
    assert.deepEqual(alertTexts(dialog(ctx.page)), ['Vui lòng nhập mật khẩu hiện tại.'])

    await typeInto(ctx, 'enroll-pw', CURRENT_PASSWORD)
    // A held key (autorepeat) and an IME commit are not a submit.
    await pressEnter(ctx, 'enroll-pw', { repeat: true })
    await pressEnter(ctx, 'enroll-pw', { isComposing: true })
    await pressEnter(ctx, 'enroll-pw', { keyCode: 229 })
    assert.deepEqual(sent(ctx.calls), [MFA_GET])

    const event = await pressEnter(ctx, 'enroll-pw')
    assert.equal(event.defaultPrevented, true)
    assert.deepEqual(sent(ctx.calls, 1), [{ wire: `POST ${API}/mfa/enroll`, body: { factorType: 'totp', currentPassword: CURRENT_PASSWORD } }])
    const box = dialog(ctx.page)
    assert.equal(textOf(findAll(box, el => el.tag === 'code')[0]!), TOTP_SECRET)
    assert.match(String(findAll(box, el => el.tag === 'a')[0]!.props.href), /^otpauth:\/\/totp\//)
    assert.deepEqual(alertTexts(box), ['Chuỗi này chỉ hiện một lần. Đóng cửa sổ mà chưa thêm vào app thì phải bật lại từ đầu.'])
    assert.deepEqual(ctx.focused, ['enroll-pw', 'enroll-code'])

    await typeInto(ctx, 'enroll-code', '000000')
    await press(ctx, button(dialog(ctx.page), 'Xác nhận bật'))
    assert.deepEqual(sent(ctx.calls, 2), [{ wire: `POST ${API}/mfa/confirm`, body: { factorType: 'totp', code: '000000' } }])
    assert.ok(alertTexts(dialog(ctx.page)).includes('Mã xác thực không đúng. Vui lòng thử lại.'))
    assert.equal(modelOf(ctx, 'enroll-code'), '', 'a wrong code is cleared for the next try')

    await typeInto(ctx, 'enroll-code', ` ${TOTP_CODE} `)
    await pressEnter(ctx, 'enroll-code')
    assert.deepEqual(sent(ctx.calls, 3), [{ wire: `POST ${API}/mfa/confirm`, body: { factorType: 'totp', code: TOTP_CODE } }, MFA_GET])
    assert.deepEqual(dialogs(ctx.page), [])
    assert.equal(lastToast(ctx, 'success'), `Đã bật Ứng dụng xác thực (Google Authenticator). Các phiên đăng nhập khác đã bị thu hồi.`)
    // Confirm re-reads the status, the history (a row was just written) and `me`.
    assert.equal(ctx.history.reloads, 1)
    assert.equal(ctx.auth.fetches, 1)
    const card = factorCard(ctx.page, 'totp')
    assert.match(textOf(card), /Đang bật/)
    assert.ok(textOf(card).includes(`Dùng lần cuối: ${formatDateTimeVN('2026-10-26T03:05:00.000Z')}`))
    assert.ok(button(card, 'Tắt'))
    assert.equal(accountBadge(ctx.page), 'Đã bật 1 yếu tố thứ hai')
    assert.deepEqual(shownCodes(ctx.page), [], 'MFA policy off: the confirm issues no recovery codes')
    assertOnlyServerSentences(ctx)
  })

  it('a pending enrollment offers "Tiếp tục bật", which opens the same dialog', async (t) => {
    const server = profileServer()
    server.state.factors.totp = { state: 'pending', usable: true, enrolledAt: '2026-10-26T03:00:00.000Z', lastUsedAt: null }
    const ctx = await openProfile(t, server)
    assert.match(textOf(factorCard(ctx.page, 'totp')), /Chờ xác nhận/)
    await openFactorDialog(ctx, 'totp', 'Tiếp tục bật')
    assert.equal(dialogTitle(ctx), `Bật ${FACTOR_LABEL.totp}`)
    assert.ok(byId(ctx.page, 'enroll-pw'))
  })

  it('a factor whose secret no longer decrypts says so and offers only "Tắt"', async (t) => {
    const server = withActive(profileServer(), ['totp'])
    server.state.factors.totp.usable = false
    const ctx = await openProfile(t, server)
    const card = factorCard(ctx.page, 'totp')
    assert.match(textOf(card), /Không dùng được/)
    assert.match(textOf(card), /Bí mật lưu trữ không giải mã được \(thường do khóa JWT_SECRET đã bị đổi\)/)
    assert.equal(findAll(card, el => el.tag === 'button').length, 1)
  })

  it('disable: password checked, a wrong one (401) stays in the dialog, the right one turns it off and re-reads', async (t) => {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp']))
    assert.equal(accountBadge(ctx.page), 'Đã bật 1 yếu tố thứ hai')
    await openFactorDialog(ctx, 'totp', 'Tắt')
    assert.equal(dialogTitle(ctx), `Tắt ${FACTOR_LABEL.totp}`)
    assert.deepEqual(ctx.focused, ['disable-pw'])

    await press(ctx, button(dialog(ctx.page), 'Xác nhận tắt'))
    assert.deepEqual(alertTexts(dialog(ctx.page)), ['Vui lòng nhập mật khẩu hiện tại.'])

    await typeInto(ctx, 'disable-pw', 'sai-mat-khau')
    await pressEnter(ctx, 'disable-pw')
    assert.deepEqual(alertTexts(dialog(ctx.page)), ['Mật khẩu hiện tại không đúng.'])
    assert.deepEqual(sent(ctx.calls, 1), [{ wire: `POST ${API}/mfa/disable`, body: { factorType: 'totp', currentPassword: 'sai-mat-khau' } }])

    await typeInto(ctx, 'disable-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Xác nhận tắt'))
    assert.deepEqual(sent(ctx.calls, 2), [{ wire: `POST ${API}/mfa/disable`, body: { factorType: 'totp', currentPassword: CURRENT_PASSWORD } }, MFA_GET])
    assert.deepEqual(dialogs(ctx.page), [])
    assert.equal(lastToast(ctx, 'success'), `Đã tắt Ứng dụng xác thực (Google Authenticator). Tài khoản trở lại đăng nhập chỉ bằng mật khẩu.`)
    // Disable re-reads the status and the history, not `me`.
    assert.equal(ctx.history.reloads, 1)
    assert.equal(ctx.auth.fetches, 0)
    assert.match(textOf(factorCard(ctx.page, 'totp')), /Đang tắt/)
    assert.equal(accountBadge(ctx.page), 'Chưa bật xác thực hai bước')
  })
})

describe('profile page — email OTP', () => {
  it('cannot be enrolled without SMTP, nor without an email on the account — and says which', async (t) => {
    const noSmtp = profileServer()
    noSmtp.state.smtpReady = false
    const ctx = await openProfile(t, noSmtp)
    let card = factorCard(ctx.page, 'email_otp')
    assert.equal(button(card, 'Bật').props.disabled, true)
    assert.match(textOf(card), /Chưa cấu hình SMTP nên chưa gửi được mã\. Cấu hình tại Cài đặt → Cấu hình Email\./)
    assert.equal(button(factorCard(ctx.page, 'totp'), 'Bật').props.disabled, false)
    ctx.close()

    const noEmail = profileServer()
    noEmail.state.email = null
    const other = await openProfile(t, noEmail)
    card = factorCard(other.page, 'email_otp')
    assert.equal(button(card, 'Bật').props.disabled, true)
    assert.match(textOf(card), /Tài khoản chưa có email — cần bổ sung email trước\./)
    assert.doesNotMatch(textOf(other.page.root), /Biên tập viên ·/)
  })

  it('enroll sends the code, "Gửi lại mã" re-runs the enroll step, the code turns it on', async (t) => {
    const ctx = await openProfile(t)
    await reachConfirmStep(ctx, 'email_otp')
    assert.deepEqual(sent(ctx.calls, 1), [{ wire: `POST ${API}/mfa/enroll`, body: { factorType: 'email_otp', currentPassword: CURRENT_PASSWORD } }])
    assert.match(textOf(dialog(ctx.page)), new RegExp(`Đã gửi mã 6 số tới ${MASKED_EMAIL.replace(/[.*]/g, '\\$&')}\\. Mã sống 10 phút\\.`))
    assert.deepEqual(ctx.focused, ['enroll-pw', 'enroll-code'])

    await press(ctx, button(dialog(ctx.page), 'Gửi lại mã'))
    assert.deepEqual(sent(ctx.calls, 2), [{ wire: `POST ${API}/mfa/enroll`, body: { factorType: 'email_otp', currentPassword: CURRENT_PASSWORD } }])
    assert.deepEqual(ctx.toasts, [{ type: 'info', message: 'Đã gửi lại mã mới. Mã cũ không còn dùng được.' }])

    await typeInto(ctx, 'enroll-code', EMAIL_CODE)
    await press(ctx, button(dialog(ctx.page), 'Xác nhận bật'))
    assert.deepEqual(sent(ctx.calls, 3), [{ wire: `POST ${API}/mfa/confirm`, body: { factorType: 'email_otp', code: EMAIL_CODE } }, MFA_GET])
    assert.deepEqual(dialogs(ctx.page), [])
    assert.match(textOf(factorCard(ctx.page, 'email_otp')), /Đang bật/)
  })

  it('a resend the mail server refuses shows the server\'s sentence in the dialog', async (t) => {
    const ctx = await openProfile(t)
    await reachConfirmStep(ctx, 'email_otp')
    ctx.server.state.override = call => (isCall('POST', '/mfa/enroll')(call)
      ? h3Error(503, 'Không gửi được mã tới email của tài khoản. Vui lòng kiểm tra cấu hình SMTP.') : undefined)
    await press(ctx, button(dialog(ctx.page), 'Gửi lại mã'))
    assert.deepEqual(alertTexts(dialog(ctx.page)), ['Không gửi được mã tới email của tài khoản. Vui lòng kiểm tra cấu hình SMTP.'])
    assert.deepEqual(ctx.toasts, [])
  })
})

describe('profile page — second password', () => {
  it('checks both fields, sends the second password once, and re-sends the re-typed one to confirm', async (t) => {
    const ctx = await openProfile(t)
    await openFactorDialog(ctx, 'second_password', 'Bật')
    await typeInto(ctx, 'enroll-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Tiếp tục'))
    assert.deepEqual(alertTexts(dialog(ctx.page)), ['Vui lòng nhập mật khẩu cấp 2.'])
    await typeInto(ctx, 'enroll-sp', 'Cap2-BiMat#2026')
    await typeInto(ctx, 'enroll-sp2', 'Cap2-BiMat#2027')
    await press(ctx, button(dialog(ctx.page), 'Tiếp tục'))
    assert.deepEqual(alertTexts(dialog(ctx.page)), ['Mật khẩu cấp 2 và ô nhập lại không khớp.'])
    assert.deepEqual(sent(ctx.calls), [MFA_GET])

    await typeInto(ctx, 'enroll-sp2', 'Cap2-BiMat#2026')
    await pressEnter(ctx, 'enroll-sp2')
    assert.deepEqual(sent(ctx.calls, 1), [{
      wire: `POST ${API}/mfa/enroll`,
      body: { factorType: 'second_password', currentPassword: CURRENT_PASSWORD, secondPassword: 'Cap2-BiMat#2026' },
    }])
    assert.deepEqual(ctx.focused, ['enroll-pw', 'enroll-sp-confirm'])
    // Step 2's field is bound to the same value as step 1's (as before the split).
    assert.equal(modelOf(ctx, 'enroll-sp-confirm'), 'Cap2-BiMat#2026')

    await typeInto(ctx, 'enroll-sp-confirm', '')
    await press(ctx, button(dialog(ctx.page), 'Xác nhận bật'))
    assert.deepEqual(alertTexts(dialog(ctx.page)), ['Vui lòng nhập lại mật khẩu cấp 2.'])

    await typeInto(ctx, 'enroll-sp-confirm', 'Cap2-Khac#2026')
    await pressEnter(ctx, 'enroll-sp-confirm')
    assert.deepEqual(alertTexts(dialog(ctx.page)), ['Mật khẩu cấp 2 nhập lại không khớp.'])
    assert.equal(modelOf(ctx, 'enroll-sp-confirm'), 'Cap2-Khac#2026', 'a password is not cleared on a mismatch (only a code is)')

    await typeInto(ctx, 'enroll-sp-confirm', 'Cap2-BiMat#2026')
    await press(ctx, button(dialog(ctx.page), 'Xác nhận bật'))
    assert.deepEqual(sent(ctx.calls, 3), [{ wire: `POST ${API}/mfa/confirm`, body: { factorType: 'second_password', code: 'Cap2-BiMat#2026' } }, MFA_GET])
    assert.match(textOf(factorCard(ctx.page, 'second_password')), /Đang bật/)
  })
})

// ─── Recovery codes ──────────────────────────────────────────────────────────

describe('profile page — recovery codes', () => {
  it('MFA policy on: the FIRST factor\'s confirm shows the batch once; "ẩn đi" hides it and a reload never brings it back', async (t) => {
    const server = profileServer()
    server.state.policyIssuesCodes = true
    const ctx = await openProfile(t, server)
    await reachConfirmStep(ctx, 'totp')
    await typeInto(ctx, 'enroll-code', TOTP_CODE)
    await press(ctx, button(dialog(ctx.page), 'Xác nhận bật'))

    assert.deepEqual(shownCodes(ctx.page), batchOf(1))
    const card = recoveryCard(ctx.page)
    assert.match(textOf(card), /Lưu lại ngay — các mã này chỉ hiện một lần duy nhất và sẽ không xem lại được\./)
    assert.match(textOf(card), /Còn 10 mã/)
    assert.ok(button(card, 'Tạo lại mã'))

    await press(ctx, button(card, 'Tôi đã lưu, ẩn đi'))
    assert.deepEqual(shownCodes(ctx.page), [])
    ctx.close()

    const again = await openProfile(t, server)
    assert.deepEqual(shownCodes(again.page), [])
    assert.match(textOf(recoveryCard(again.page)), /Còn 10 mã/)
  })

  it('create: through the password dialog, shown once, the status re-read (not the history)', async (t) => {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp']))
    assert.match(textOf(recoveryCard(ctx.page)), /Đang tắt/)
    await press(ctx, button(recoveryCard(ctx.page), 'Tạo mã dự phòng'))
    assert.equal(dialogTitle(ctx), 'Tạo mã dự phòng')
    assert.deepEqual(ctx.focused, ['recovery-pw'])
    assert.doesNotMatch(textOf(dialog(ctx.page)), /Toàn bộ mã cũ sẽ hết hiệu lực ngay/)

    await press(ctx, button(dialog(ctx.page), 'Tạo mã'))
    assert.deepEqual(alertTexts(dialog(ctx.page)), ['Vui lòng nhập mật khẩu hiện tại.'])
    await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Tạo mã'))
    assert.deepEqual(sent(ctx.calls, 1), [{ wire: `POST ${API}/mfa/recovery-codes`, body: { currentPassword: CURRENT_PASSWORD } }, MFA_GET])
    assert.deepEqual(dialogs(ctx.page), [])
    assert.deepEqual(shownCodes(ctx.page), batchOf(1))
    // The page's own sentence, not the server's `message`.
    assert.deepEqual(ctx.toasts, [{ type: 'success', message: 'Đã tạo mã dự phòng mới. Lưu lại ngay — sẽ không hiện lại.' }])
    assert.equal(ctx.history.reloads, 0)
    const card = recoveryCard(ctx.page)
    assert.match(textOf(card), /Còn 10 mã/)
    assert.ok(button(card, 'Tắt'))
  })

  it('regenerate warns that the old batch dies, and the new batch replaces the old one on screen', async (t) => {
    const server = withActive(profileServer(), ['totp'], 10)
    server.state.batches = 1
    const ctx = await openProfile(t, server)
    await press(ctx, button(recoveryCard(ctx.page), 'Tạo lại mã'))
    assert.match(textOf(dialog(ctx.page)), /Hệ thống sinh 10 mã mới, mỗi mã dùng một lần\. Toàn bộ mã cũ sẽ hết hiệu lực ngay\./)
    await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD)
    await pressEnter(ctx, 'recovery-pw')
    assert.deepEqual(shownCodes(ctx.page), batchOf(2))
  })

  it('turn off: DELETE with the password, the codes on screen cleared, the server\'s message toasted', async (t) => {
    const server = withActive(profileServer(), ['totp', 'email_otp'], 10)
    server.state.policyIssuesCodes = false
    const ctx = await openProfile(t, server)
    await press(ctx, button(recoveryCard(ctx.page), 'Tạo lại mã'))
    await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Tạo mã'))
    assert.equal(shownCodes(ctx.page).length, 10)

    await press(ctx, button(recoveryCard(ctx.page), 'Tắt'))
    assert.equal(dialogTitle(ctx), 'Tắt mã dự phòng')
    assert.match(textOf(dialog(ctx.page)), /Sau khi tắt, nếu mất thiết bị xác thực bạn sẽ cần quản trị viên cấp cao mở lại tài khoản\./)
    await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD)
    const from = ctx.calls.length
    await press(ctx, button(dialog(ctx.page), 'Xác nhận tắt'))
    assert.deepEqual(sent(ctx.calls, from), [{ wire: `DELETE ${API}/mfa/recovery-codes`, body: { currentPassword: CURRENT_PASSWORD } }, MFA_GET])
    assert.deepEqual(shownCodes(ctx.page), [])
    assert.equal(lastToast(ctx, 'success'), 'Đã xoá toàn bộ mã hồi phục. Mã gửi về email là đường dự phòng còn lại.')
    assert.match(textOf(recoveryCard(ctx.page)), /Đang tắt/)
  })

  it('a wrong password keeps the dialog open with the server\'s sentence and the codes on screen untouched', async (t) => {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp']))
    await press(ctx, button(recoveryCard(ctx.page), 'Tạo mã dự phòng'))
    await typeInto(ctx, 'recovery-pw', 'sai-mat-khau')
    await press(ctx, button(dialog(ctx.page), 'Tạo mã'))
    assert.deepEqual(alertTexts(dialog(ctx.page)), ['Mật khẩu hiện tại không đúng.'])
    assert.deepEqual(shownCodes(ctx.page), [])
    assert.deepEqual(sent(ctx.calls, 1), [{ wire: `POST ${API}/mfa/recovery-codes`, body: { currentPassword: 'sai-mat-khau' } }])
  })

  it('copy writes every code, one per line; a refused clipboard says to copy by hand', async (t) => {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp']))
    await press(ctx, button(recoveryCard(ctx.page), 'Tạo mã dự phòng'))
    await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Tạo mã'))

    await press(ctx, button(recoveryCard(ctx.page), 'Copy toàn bộ'))
    assert.deepEqual(ctx.clipboard, [batchOf(1).join('\n')])
    assert.equal(lastToast(ctx, 'success'), 'Đã copy toàn bộ mã dự phòng.')

    ctx.clipboardAnswer.fails = true
    await press(ctx, button(recoveryCard(ctx.page), 'Copy toàn bộ'))
    assert.equal(lastToast(ctx, 'error'), 'Trình duyệt không cho copy. Vui lòng chọn và copy thủ công.')
  })

  it('download saves a text file named after the account, the codes after the header', async (t) => {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp']))
    await press(ctx, button(recoveryCard(ctx.page), 'Tạo mã dự phòng'))
    await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Tạo mã'))

    await press(ctx, button(recoveryCard(ctx.page), 'Tải về tệp .txt'))
    assert.equal(ctx.downloads.length, 1)
    const [file] = ctx.downloads
    assert.equal(file!.name, 'ma-du-phong-canbo.c11.txt')
    assert.equal(file!.blob?.type, 'text/plain;charset=utf-8')
    const lines = (await file!.blob!.text()).split('\n')
    assert.equal(lines[0], 'Mã dự phòng — Con Đường Hướng Thiện (Admin)')
    assert.equal(lines[1], 'Tài khoản: canbo.c11')
    assert.match(lines[2]!, /^Tạo lúc: /)
    assert.equal(lines[3], 'Mỗi mã chỉ dùng được MỘT lần. Giữ tệp này ở nơi an toàn.')
    assert.equal(lines[4], '')
    assert.deepEqual(lines.slice(5), batchOf(1))
  })
})

// ─── Lockout warning ─────────────────────────────────────────────────────────

describe('profile page — lockout warning', () => {
  const LOCKOUT = /Bạn đã bật xác thực hai bước nhưng không có cách dự phòng nào\./

  it('turning off the last backup (email OTP) raises the warning the server now reports', async (t) => {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp', 'email_otp']))
    assert.equal(alertTexts(ctx.page).filter(text => LOCKOUT.test(text)).length, 0)
    assert.equal(accountBadge(ctx.page), 'Đã bật 2 yếu tố thứ hai')

    await openFactorDialog(ctx, 'email_otp', 'Tắt')
    await typeInto(ctx, 'disable-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Xác nhận tắt'))
    assert.equal(lastToast(ctx, 'success'), 'Đã tắt Mã gửi về email. Tài khoản vẫn còn yếu tố xác thực khác.')
    assert.equal(alertTexts(ctx.page).filter(text => LOCKOUT.test(text)).length, 1)
  })

  it('turning off the recovery codes with only an app factor left raises it too; disabling the last factor clears it', async (t) => {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp'], 10))
    assert.equal(alertTexts(ctx.page).filter(text => LOCKOUT.test(text)).length, 0)
    await press(ctx, button(recoveryCard(ctx.page), 'Tắt'))
    await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Xác nhận tắt'))
    assert.equal(lastToast(ctx, 'success'), 'Đã xoá toàn bộ mã hồi phục. Tài khoản hiện KHÔNG còn đường dự phòng nào — hãy bật mã gửi về email.')
    assert.equal(alertTexts(ctx.page).filter(text => LOCKOUT.test(text)).length, 1)

    await openFactorDialog(ctx, 'totp', 'Tắt')
    await typeInto(ctx, 'disable-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Xác nhận tắt'))
    assert.equal(alertTexts(ctx.page).filter(text => LOCKOUT.test(text)).length, 0)
  })
})

// ─── MFA policy: the history panel and `me` ──────────────────────────────────

describe('profile page — MFA enrollment required', () => {
  it('the history is hidden while the account must enroll; the first factor re-reads `me` and brings it back', async (t) => {
    const server = profileServer()
    server.state.me = { ...server.state.me, mfaEnrollmentRequired: true }
    const ctx = await openProfile(t, server)
    assert.equal(historyShown(ctx.page), false)

    await reachConfirmStep(ctx, 'totp')
    server.state.me = { ...server.state.me, mfaEnrollmentRequired: false }
    await typeInto(ctx, 'enroll-code', TOTP_CODE)
    await press(ctx, button(dialog(ctx.page), 'Xác nhận bật'))
    assert.deepEqual(ctx.page.errors, [])
    assert.equal(ctx.auth.fetches, 1, 'the enable flow re-reads `me` (the banner and the redirect gate read it)')
    assert.equal(ctx.history.reloads, 0, 'no history panel to reload while hidden')
    assert.equal(historyShown(ctx.page), true)
  })
})

// ─── Closing the dialogs ─────────────────────────────────────────────────────

describe('profile page — closing a dialog', () => {
  it('Escape closes whichever dialog is open; the ✕, "Huỷ" and the backdrop close it too', async (t) => {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp']))
    const ways: Array<[string, () => Promise<void>]> = [
      ['Escape', async () => { ctx.pressKey('Escape'); await ctx.settle() }],
      ['✕', () => press(ctx, findAll(dialog(ctx.page), el => el.props['aria-label'] === 'Đóng')[0]!)],
      ['Huỷ', () => press(ctx, button(dialog(ctx.page), 'Huỷ'))],
      ['backdrop', async () => { void fire(overlay(ctx.page), 'click'); await ctx.settle() }],
    ]
    const openers: Array<[string, () => Promise<void>]> = [
      ['enroll', () => openFactorDialog(ctx, 'email_otp', 'Bật')],
      ['disable', () => openFactorDialog(ctx, 'totp', 'Tắt')],
      ['recovery', () => press(ctx, button(recoveryCard(ctx.page), 'Tạo mã dự phòng'))],
    ]
    for (const [name, open] of openers) {
      for (const [how, close] of ways) {
        await open()
        assert.equal(dialogs(ctx.page).length, 1, `${name} opens`)
        await close()
        assert.deepEqual(dialogs(ctx.page), [], `${how} closes the ${name} dialog`)
      }
    }
    ctx.pressKey('Escape')
    assert.deepEqual(sent(ctx.calls), [MFA_GET], 'closing sends nothing')
  })

  it('Escape does not close a dialog whose request is in flight', async (t) => {
    const ctx = await openProfile(t)
    holdWhere(ctx, isCall('POST', '/mfa/enroll'))
    await openFactorDialog(ctx, 'totp', 'Bật')
    await typeInto(ctx, 'enroll-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Tiếp tục'))
    assert.equal(button(dialog(ctx.page), 'Tiếp tục').props.disabled, true)
    ctx.pressKey('Escape')
    await ctx.settle()
    assert.equal(dialogs(ctx.page).length, 1)
    ctx.server.answer(ctx.calls.at(-1)!)
    await ctx.settle()
    assert.ok(byId(ctx.page, 'enroll-code'))
  })

  it('closing forgets the TOTP secret: reopening starts again at the password step', async (t) => {
    const ctx = await openProfile(t)
    await reachConfirmStep(ctx, 'totp')
    assert.ok(byId(ctx.page, 'enroll-code'))
    await press(ctx, button(dialog(ctx.page), 'Huỷ'))
    await openFactorDialog(ctx, 'totp', 'Bật')
    assert.equal(maybeById(ctx.page, 'enroll-code'), null)
    assert.equal(modelOf(ctx, 'enroll-pw'), '')
    assert.equal(findAll(dialog(ctx.page), el => el.tag === 'code').length, 0)
  })
})

// ─── Answers that land late (fixed by the split) ─────────────────────────────

describe('profile page — a dialog answer that lands after "Huỷ"', () => {
  async function disableInFlightThenOpenOther(t: Parameters<typeof openProfile>[0]) {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp', 'email_otp']))
    holdWhere(ctx, isCall('POST', '/mfa/disable'))
    await openFactorDialog(ctx, 'totp', 'Tắt')
    await typeInto(ctx, 'disable-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Xác nhận tắt'))
    const first = ctx.calls.at(-1)!
    await press(ctx, button(dialog(ctx.page), 'Huỷ'))
    await openFactorDialog(ctx, 'email_otp', 'Tắt')
    await typeInto(ctx, 'disable-pw', 'dang-go-do')
    return { ctx, first }
  }

  it('a failure is not written into the dialog opened since (RED on the base: its error showed in the email dialog)', async (t) => {
    const { ctx, first } = await disableInFlightThenOpenOther(t)
    first.respond(h3Error(401, 'Mật khẩu hiện tại không đúng.'))
    await ctx.settle()
    assert.equal(dialogTitle(ctx), `Tắt ${FACTOR_LABEL.email_otp}`)
    assert.deepEqual(alertTexts(dialog(ctx.page)), [])
    assert.equal(modelOf(ctx, 'disable-pw'), 'dang-go-do')
    assert.equal(button(dialog(ctx.page), 'Xác nhận tắt').props.disabled, false)
  })

  it('a success does not close the dialog opened since, and still toasts and re-reads (RED on the base: it closed the email dialog)', async (t) => {
    const { ctx, first } = await disableInFlightThenOpenOther(t)
    const from = ctx.calls.length
    ctx.server.answer(first)
    await ctx.settle()
    assert.equal(lastToast(ctx, 'success'), `Đã tắt Ứng dụng xác thực (Google Authenticator). Tài khoản vẫn còn yếu tố xác thực khác.`)
    assert.deepEqual(sent(ctx.calls, from), [MFA_GET])
    assert.equal(ctx.history.reloads, 1)
    assert.equal(dialogTitle(ctx), `Tắt ${FACTOR_LABEL.email_otp}`)
    assert.equal(modelOf(ctx, 'disable-pw'), 'dang-go-do')
  })

  it('a late enroll answer does not turn the next dialog into a code step (RED on the base: "Đã gửi mã … tới" with nothing sent)', async (t) => {
    const ctx = await openProfile(t)
    holdWhere(ctx, isCall('POST', '/mfa/enroll'))
    await openFactorDialog(ctx, 'totp', 'Bật')
    await typeInto(ctx, 'enroll-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Tiếp tục'))
    const first = ctx.calls.at(-1)!
    await press(ctx, button(dialog(ctx.page), 'Huỷ'))
    await openFactorDialog(ctx, 'email_otp', 'Bật')
    ctx.server.answer(first)
    await ctx.settle()
    assert.equal(dialogTitle(ctx), `Bật ${FACTOR_LABEL.email_otp}`)
    assert.ok(byId(ctx.page, 'enroll-pw'), 'still the password step')
    assert.equal(maybeById(ctx.page, 'enroll-code'), null)
    assert.doesNotMatch(textOf(dialog(ctx.page)), /Đã gửi mã/)
    assert.deepEqual(ctx.focused, ['enroll-pw', 'enroll-pw'])
    assert.equal(button(dialog(ctx.page), 'Tiếp tục').props.disabled, false)
  })

  it('a late confirm still shows its one-time codes, toasts and re-reads — and closes nothing (RED on the base: it closed the next dialog)', async (t) => {
    const server = profileServer()
    server.state.policyIssuesCodes = true
    const ctx = await openProfile(t, server)
    await reachConfirmStep(ctx, 'totp')
    holdWhere(ctx, isCall('POST', '/mfa/confirm'))
    await typeInto(ctx, 'enroll-code', TOTP_CODE)
    await press(ctx, button(dialog(ctx.page), 'Xác nhận bật'))
    const confirm = ctx.calls.at(-1)!
    await press(ctx, button(dialog(ctx.page), 'Huỷ'))
    await openFactorDialog(ctx, 'second_password', 'Bật')
    await typeInto(ctx, 'enroll-pw', 'dang-go-do')

    const from = ctx.calls.length
    ctx.server.answer(confirm)
    await ctx.settle()
    assert.deepEqual(shownCodes(ctx.page), batchOf(1), 'the codes exist nowhere else: dropping them loses them')
    assert.equal(lastToast(ctx, 'success'), `Đã bật Ứng dụng xác thực (Google Authenticator). Các phiên đăng nhập khác đã bị thu hồi.`)
    assert.deepEqual(sent(ctx.calls, from), [MFA_GET])
    assert.equal(ctx.history.reloads, 1)
    assert.equal(ctx.auth.fetches, 1)
    assert.equal(dialogTitle(ctx), `Bật ${FACTOR_LABEL.second_password}`)
    assert.equal(modelOf(ctx, 'enroll-pw'), 'dang-go-do')
  })
})

describe('profile page — two status reads in flight (fixed by the split)', () => {
  /**
   * The one path that runs two reads at once: a disable is cancelled while in flight, a
   * recovery batch is created, and both answers trigger a re-read. Read #1 (after the
   * batch) left before the disable committed, so its answer is the older state.
   */
  async function twoReadsInFlight(t: Parameters<typeof openProfile>[0]) {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp', 'email_otp']))
    holdWhere(ctx, isCall('POST', '/mfa/disable'))
    await openFactorDialog(ctx, 'email_otp', 'Tắt')
    await typeInto(ctx, 'disable-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Xác nhận tắt'))
    const disable = ctx.calls.at(-1)!
    await press(ctx, button(dialog(ctx.page), 'Huỷ'))

    holdWhere(ctx, isCall('GET', '/mfa'))
    await press(ctx, button(recoveryCard(ctx.page), 'Tạo mã dự phòng'))
    await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Tạo mã'))
    const older = ctx.calls.at(-1)!
    assert.equal(wire(older), MFA_GET)
    const olderAnswer = json(ctx.server.status())

    ctx.server.answer(disable)
    await ctx.settle()
    const newer = ctx.calls.at(-1)!
    assert.notEqual(newer, older)
    assert.equal(wire(newer), MFA_GET)
    return { ctx, older, olderAnswer, newer }
  }

  it('the older answer landing LAST does not replace the newer state (RED on the base: email OTP showed as on again)', async (t) => {
    const { ctx, older, olderAnswer, newer } = await twoReadsInFlight(t)
    ctx.server.answer(newer)
    await ctx.settle()
    assert.match(textOf(factorCard(ctx.page, 'email_otp')), /Đang tắt/)
    older.respond(olderAnswer)
    await ctx.settle()
    assert.match(textOf(factorCard(ctx.page, 'email_otp')), /Đang tắt/)
    assert.equal(accountBadge(ctx.page), 'Đã bật 1 yếu tố thứ hai')
  })

  it('the older answer landing FIRST leaves the skeleton up until the newer one lands (RED on the base: the old state showed meanwhile)', async (t) => {
    const { ctx, older, olderAnswer, newer } = await twoReadsInFlight(t)
    older.respond(olderAnswer)
    await ctx.settle()
    assert.ok(skeleton(ctx.page), 'still loading the newest state')
    ctx.server.answer(newer)
    await ctx.settle()
    assert.equal(skeleton(ctx.page), null)
    assert.match(textOf(factorCard(ctx.page, 'email_otp')), /Đang tắt/)
  })
})

describe('profile page — Enter pressed again while a request is in flight (fixed by the split)', () => {
  const cases: Array<{ name: string, field: string, path: string, method: string, setup: (ctx: ProfileCtx) => Promise<void> }> = [
    {
      name: 'enroll', field: 'enroll-pw', method: 'POST', path: '/mfa/enroll',
      setup: async ctx => { await openFactorDialog(ctx, 'totp', 'Bật'); await typeInto(ctx, 'enroll-pw', CURRENT_PASSWORD) },
    },
    {
      name: 'confirm', field: 'enroll-code', method: 'POST', path: '/mfa/confirm',
      setup: async ctx => { await reachConfirmStep(ctx, 'totp'); await typeInto(ctx, 'enroll-code', TOTP_CODE) },
    },
    {
      name: 'disable', field: 'disable-pw', method: 'POST', path: '/mfa/disable',
      setup: async ctx => { await openFactorDialog(ctx, 'email_otp', 'Tắt'); await typeInto(ctx, 'disable-pw', CURRENT_PASSWORD) },
    },
    {
      name: 'recovery codes', field: 'recovery-pw', method: 'POST', path: '/mfa/recovery-codes',
      setup: async ctx => { await press(ctx, button(recoveryCard(ctx.page), 'Tạo mã dự phòng')); await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD) },
    },
  ]
  for (const { name, field, method, path, setup } of cases) {
    it(`${name}: one request (RED on the base: a second one was sent)`, async (t) => {
      const server = name === 'disable' ? withActive(profileServer(), ['email_otp']) : name === 'recovery codes' ? withActive(profileServer(), ['totp']) : profileServer()
      const ctx = await openProfile(t, server)
      await setup(ctx)
      holdWhere(ctx, isCall(method, path))
      const from = ctx.calls.length
      await pressEnter(ctx, field)
      await pressEnter(ctx, field)
      assert.equal(ctx.calls.slice(from).filter(isCall(method, path)).length, 1)
    })
  }
})

describe('profile page — two recovery batches in flight (fixed by the split)', () => {
  it('the older answer landing last does not replace the newer batch on screen (RED on the base: the discarded batch showed)', async (t) => {
    const ctx = await openProfile(t, withActive(profileServer(), ['totp']))
    holdWhere(ctx, isCall('POST', '/mfa/recovery-codes'))
    await press(ctx, button(recoveryCard(ctx.page), 'Tạo mã dự phòng'))
    await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Tạo mã'))
    const first = ctx.calls.at(-1)!
    await press(ctx, button(dialog(ctx.page), 'Huỷ'))
    await press(ctx, button(recoveryCard(ctx.page), 'Tạo mã dự phòng'))
    await typeInto(ctx, 'recovery-pw', CURRENT_PASSWORD)
    await press(ctx, button(dialog(ctx.page), 'Tạo mã'))
    const second = ctx.calls.at(-1)!
    assert.notEqual(first, second)

    // The server handles them in the order sent — batch 1, then batch 2, which discards
    // batch 1 — and the answers arrive the other way round.
    ctx.server.state.override = () => undefined
    const firstAnswer = ctx.server.route(first)
    const secondAnswer = ctx.server.route(second)
    assert.ok(firstAnswer instanceof Response && secondAnswer instanceof Response)
    second.respond(secondAnswer)
    await ctx.settle()
    assert.deepEqual(shownCodes(ctx.page), batchOf(2))
    first.respond(firstAnswer)
    await ctx.settle()
    assert.deepEqual(shownCodes(ctx.page), batchOf(2), 'batch 1 no longer works: the screen must keep batch 2')
  })
})
