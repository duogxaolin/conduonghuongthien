/**
 * `/admin/login` (`pages/admin/login.vue`) on the REAL `useAdminAuth` — wave3 7.1 batch C.
 *
 * `useAdminAuth`'s answers are now typed from the handlers (app/types/admin-auth-api.ts),
 * and the login answer is a UNION: a session (`user`) or a second-factor challenge
 * (`mfaRequired`, `methods`, `recoveryCodesAvailable`). The page now narrows it
 * (`'mfaRequired' in res`), and its "Gửi mã" request goes through `adminFetch` too. This
 * suite pins the whole flow on the wire and on screen, green before and after:
 *   - mount: the public settings (logo) and `auth/me`;
 *   - a session → straight to /admin; a challenge → step 2 with the methods offered, the
 *     password dropped from the page;
 *   - "Gửi mã tới email" → POST send-code and the confirmation line (the server answers
 *     `{ ok, sent }` — the page's `res.sentTo` read a field never sent, now gone; the
 *     sentence on screen is unchanged);
 *   - the second factor → POST verify → /admin; a 401 sends the officer back to step 1;
 *   - refusals: the captcha flags (`err.data.data`) open the captcha and fetch one; any
 *     other refusal shows the server's sentence.
 *
 * The page's `<script setup>` awaits `useAsyncData`, so it is mounted inside `<Suspense>`
 * (tests/_sfc-mount.ts `suspense`).
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { byText, findAll, fire, input, textOf } from './_sfc-mount.ts'
import { alertText, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire, type MountedAdminPage, type NetCall } from './_admin-page-harness.ts'

// ─── The real useAdminAuth, with the Nuxt runtime pieces it uses stood in ────

const state = new Map<string, Vue.Ref<unknown>>()
const navigations: unknown[] = []
Object.assign(globalThis, {
  useState: <T>(key: string, init: () => T) => {
    if (!state.has(key)) state.set(key, Vue.ref(init()))
    return state.get(key) as Vue.Ref<T>
  },
  useRequestHeaders: () => ({}),
  navigateTo: (to: unknown) => { navigations.push(to) },
})
const { useAdminAuth } = await import('../app/composables/useAdminAuth.ts')

const storage = new Map<string, string>()
const sessionStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
}

beforeEach(() => {
  state.clear()
  navigations.length = 0
  storage.clear()
})
afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const EDITOR = {
  id: 7, username: 'bientap', email: 'bientap@example.vn', roleName: 'Biên tập', isSuperAdmin: false,
  permissions: [], mfaEnrollmentRequired: false, mfaEnforceAfter: null,
}
const CHALLENGE = { ok: true, mfaRequired: true, methods: ['totp', 'email_otp'], recoveryCodesAvailable: true }

function server(overrides: Record<string, Route> = {}) {
  return routes({
    'GET /api/public/settings': () => json({ ok: true, settings: { logo_url: '/Logo.png', main_logo_url: '' } }),
    'GET /api/admin/auth/me': () => h3Error(401, 'Unauthorized'),
    'POST /api/admin/auth/login': () => json(CHALLENGE),
    'POST /api/admin/auth/mfa/send-code': () => json({ ok: true, sent: true }),
    'POST /api/admin/auth/mfa/verify': () => json({ ok: true, user: EDITOR }),
    'GET /api/admin/auth/captcha': () => json({ captchaId: 'c-1', svg: '<svg/>' }),
    ...overrides,
  })
}

async function openLogin(overrides: Record<string, Route> = {}) {
  const opened = await mountAdminPage('pages/admin/login.vue', server(overrides), {
    suspense: true,
    auto: {
      useAdminAuth,
      navigateTo: (to: unknown) => { navigations.push(to) },
      sessionStorage,
      useAsyncData: async <T>(_key: string, fetcher: () => Promise<T>) => ({ data: Vue.ref(await fetcher()) }),
    },
  })
  await settle()
  return opened
}
const byPlaceholder = (opened: MountedAdminPage, placeholder: string) =>
  findAll(opened.page.root, el => el.tag === 'input' && el.props.placeholder === placeholder)[0]!
const submit = async (opened: MountedAdminPage) => {
  await fire(findAll(opened.page.root, el => el.tag === 'form')[0]!, 'submit')
  await settle()
}
async function signIn(opened: MountedAdminPage) {
  await input(byPlaceholder(opened, 'Nhập tên đăng nhập'), 'admin')
  await input(byPlaceholder(opened, 'Nhập mật khẩu'), 'Mat-khau-dai-123')
  await submit(opened)
}
const codeField = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'input' && el.props.id === 'mfa-code')[0]

describe('pages/admin/login.vue', () => {
  it('mount: the public settings, then auth/me; nobody signed in → the password form', async () => {
    const opened = await openLogin()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/public/settings', 'GET /api/admin/auth/me'])
    assert.ok(byPlaceholder(opened, 'Nhập tên đăng nhập'))
    assert.deepEqual(navigations, [])
  })

  it('a session: POST {username, password} → /admin, no second step', async () => {
    const opened = await openLogin({ 'POST /api/admin/auth/login': () => json({ ok: true, user: EDITOR }) })
    const before = opened.calls.length
    await signIn(opened)
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'POST /api/admin/auth/login', body: { username: 'admin', password: 'Mat-khau-dai-123' } }])
    assert.deepEqual(navigations, ['/admin'])
    assert.equal(codeField(opened), undefined)
  })

  it('a challenge: step 2 offers the methods (+ recovery code), the password is dropped, nobody signed in', async () => {
    const opened = await openLogin()
    await signIn(opened)
    assert.deepEqual(navigations, [])
    assert.ok(codeField(opened), 'the code field of step 2')
    const methods = findAll(opened.page.root, el => el.tag === 'button' && el.props['aria-pressed'] !== undefined).map(textOf)
    assert.deepEqual(methods, ['Ứng dụng xác thực', 'Mã qua email', 'Mã dự phòng'])
    assert.equal(useAdminAuth().user.value, null)
    await fire(byText(opened.page.root, 'button', 'Quay lại đăng nhập'), 'click')
    await settle()
    assert.equal(byPlaceholder(opened, 'Nhập mật khẩu').model?.value, '', 'the password is not kept in the page')
  })

  it('"Gửi mã tới email": POST send-code; the confirmation; a refusal shows the server\'s sentence', async () => {
    const opened = await openLogin()
    await signIn(opened)
    await fire(byText(opened.page.root, 'button', 'Mã qua email'), 'click')
    await settle()
    const before = opened.calls.length
    await fire(byText(opened.page.root, 'button', 'Gửi mã tới email'), 'click')
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['POST /api/admin/auth/mfa/send-code'])
    const status = findAll(opened.page.root, el => el.props.role === 'status').map(textOf)
    assert.deepEqual(status, ['Đã gửi mã tới email của bạn. Mã có hiệu lực 10 phút.'])

    const refused = await openLogin({ 'POST /api/admin/auth/mfa/send-code': () => h3Error(429, 'Đã gửi quá nhiều mã. Vui lòng thử lại sau ít phút.') })
    await signIn(refused)
    await fire(byText(refused.page.root, 'button', 'Mã qua email'), 'click')
    await settle()
    await fire(byText(refused.page.root, 'button', 'Gửi mã tới email'), 'click')
    await settle()
    assert.match(alertText(refused.page), /Đã gửi quá nhiều mã\. Vui lòng thử lại sau ít phút\./)
    assert.doesNotMatch(alertText(refused.page), OFETCH_LINE)
  })

  it('the second factor: POST verify {method, code} → signed in, /admin; a 401 goes back to step 1 with the sentence', async () => {
    const opened = await openLogin()
    await signIn(opened)
    await input(codeField(opened)!, ' 123456 ')
    const before = opened.calls.length
    await submit(opened)
    assert.deepEqual(sent(opened.calls, before), [{ wire: 'POST /api/admin/auth/mfa/verify', body: { method: 'totp', code: '123456' } }])
    assert.deepEqual(navigations, ['/admin'])
    assert.equal(useAdminAuth().user.value?.username, 'bientap')

    state.clear()
    navigations.length = 0
    const expired = await openLogin({ 'POST /api/admin/auth/mfa/verify': () => h3Error(401, 'Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại.') })
    await signIn(expired)
    await input(codeField(expired)!, '000000')
    await submit(expired)
    assert.equal(codeField(expired), undefined, 'back to the password step')
    assert.match(alertText(expired.page), /Phiên xác thực đã hết hạn\. Vui lòng đăng nhập lại\./)
    assert.deepEqual(navigations, [])
  })

  it('refused with the captcha flag: the captcha opens and one is fetched; any other refusal shows its sentence', async () => {
    const captcha = await openLogin({
      'POST /api/admin/auth/login': () => json({ statusCode: 403, statusMessage: 'Yêu cầu captcha.', data: { captchaRequired: true } }, 403),
    })
    const before = captcha.calls.length
    await signIn(captcha)
    assert.deepEqual(captcha.calls.slice(before).map(wire), ['POST /api/admin/auth/login', 'GET /api/admin/auth/captcha'])
    assert.match(alertText(captcha.page), /Bạn đã sai nhiều lần\. Vui lòng nhập mã captcha\./)
    assert.ok(byPlaceholder(captcha, 'Nhập mã trong hình'), 'the captcha field')
    assert.equal(storage.get('cdkt_login_captcha_needed'), '1')

    const wrong = await openLogin({ 'POST /api/admin/auth/login': () => h3Error(401, 'Tài khoản hoặc mật khẩu không đúng.') })
    await signIn(wrong)
    assert.match(alertText(wrong.page), /Tài khoản hoặc mật khẩu không đúng\./)
    assert.doesNotMatch(alertText(wrong.page), OFETCH_LINE)
  })

  // Batch D: the public settings read lost its `$fetch` cast (typed by the Nitro route).
  it('the public settings choose the logos: both, the main one only (""), or the default small one', async () => {
    const logos = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'img').map(el => [el.props.alt, el.props.src])
    const both = await openLogin({ 'GET /api/public/settings': () => json({ ok: true, settings: { logo_url: '/uploads/con.png', main_logo_url: ' /uploads/chinh.png ' } }) })
    assert.deepEqual(logos(both), [['Logo cơ quan chủ quản', '/uploads/chinh.png'], ['Logo Con Đường Hướng Thiện', '/uploads/con.png']])
    const mainOnly = await openLogin({ 'GET /api/public/settings': () => json({ ok: true, settings: { logo_url: '', main_logo_url: '/uploads/chinh.png' } }) })
    assert.deepEqual(logos(mainOnly), [['Logo cơ quan chủ quản', '/uploads/chinh.png']])
    const unset = await openLogin({ 'GET /api/public/settings': () => json({ ok: true, settings: {} }) })
    assert.deepEqual(logos(unset), [['Logo Con Đường Hướng Thiện', '/Logo.png']])
  })
})
