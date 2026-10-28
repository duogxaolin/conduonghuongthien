/**
 * `app/composables/useAdminAuth.ts` — the signed-in admin account every admin page, the
 * `admin-auth` route middleware and the admin layout read — run for real (wave3 7.1
 * batch C, D-FETCH): its five requests go through `adminFetch<T>()` with response types
 * derived from the handlers (app/types/admin-auth-api.ts) instead of five `$fetch` casts.
 *
 * REAL ofetch over a fake network, the composable's own `adminFetch`; only the Nuxt
 * runtime auto-imports it uses — `useState`, `useRequestHeaders`, `navigateTo` — are
 * stand-ins on `globalThis` (node:test runs each file in its own process). Pinned, green
 * before and after the conversion:
 *   - what each call sends (method, path, body, the forwarded cookie header);
 *   - when the shared `user` is set and when it is cleared — a challenge (MFA) or a
 *     failure never signs anyone in;
 *   - a failure is rethrown AS IS: login.vue reads the captcha flags from `err.data.data`
 *     and the 401-vs-429 decision from the status, so a wrapped error would break both;
 *   - logout signs out and leaves for the login page even when the request fails.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { errorStatus } from '../app/utils/errorMessage.ts'

// ─── Fake network under real ofetch ──────────────────────────────────────────

type NetCall = { method: string, url: URL, body: unknown, headers: Headers }
let responder: (call: NetCall) => Response | Error = () => json({ statusCode: 404, statusMessage: 'Not Found' }, 404)
const calls: NetCall[] = []
const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const call: NetCall = {
    method: (init.method ?? 'GET').toUpperCase(),
    url: new URL(raw, 'http://admin.test'),
    body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    headers: new Headers(init.headers),
  }
  calls.push(call)
  const answer = responder(call)
  if (answer instanceof Error) reject(answer)
  else resolve(answer)
})
;(globalThis as Record<string, unknown>).$fetch = createFetch({ fetch: fetchImpl as typeof fetch })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const h3Error = (statusCode: number, statusMessage: string, data?: unknown) =>
  new Response(JSON.stringify({ statusCode, statusMessage, message: statusMessage, ...(data === undefined ? {} : { data }) }), {
    status: statusCode, statusText: statusMessage.replace(/[^\t\x20-\x7E]/g, ''), headers: { 'content-type': 'application/json' },
  })
const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`

// ─── The Nuxt runtime auto-imports, installed before the composable loads ────

const state = new Map<string, Vue.Ref<unknown>>()
const navigations: unknown[] = []
let requestHeaders: Record<string, string> = {}
Object.assign(globalThis, {
  useState: <T>(key: string, init: () => T) => {
    if (!state.has(key)) state.set(key, Vue.ref(init()))
    return state.get(key) as Vue.Ref<T>
  },
  useRequestHeaders: (names: string[]) => Object.fromEntries(Object.entries(requestHeaders).filter(([name]) => names.includes(name))),
  navigateTo: (to: unknown) => { navigations.push(to) },
})

const { useAdminAuth } = await import('../app/composables/useAdminAuth.ts')

const EDITOR = {
  id: 7, username: 'bientap', email: 'bientap@example.vn', roleName: 'Biên tập', isSuperAdmin: false,
  permissions: [
    { id: 1, roleId: 3, resource: 'articles', canCreate: true, canRead: true, canUpdate: null, canDelete: false, canPublish: true, canArchive: false, canTest: false },
  ],
  mfaEnrollmentRequired: false, mfaEnforceAfter: null,
}

beforeEach(() => {
  calls.length = 0
  navigations.length = 0
  state.clear()
  requestHeaders = {}
})

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (err: unknown) {
    return err
  }
  assert.fail('expected the call to throw')
}

describe('useAdminAuth: fetchUser', () => {
  it('GET auth/me with the request cookie forwarded; the answer\'s user is the signed-in account', async () => {
    requestHeaders = { cookie: 'cdkt_admin=abc', 'user-agent': 'x' }
    responder = () => json({ ok: true, user: EDITOR })
    const auth = useAdminAuth()
    const pending = auth.fetchUser()
    assert.equal(auth.loading.value, true)
    await pending
    assert.deepEqual(calls.map(wire), ['GET /api/admin/auth/me'])
    assert.equal(calls[0]!.headers.get('cookie'), 'cdkt_admin=abc')
    assert.equal(calls[0]!.headers.get('user-agent'), null, 'only the cookie header is forwarded')
    assert.deepEqual(auth.user.value, EDITOR)
    assert.equal(auth.loading.value, false)
    assert.equal(useAdminAuth().user.value, auth.user.value, 'one account shared by every caller')
  })

  for (const [label, answer] of [
    ['a 401 (no session)', () => h3Error(401, 'Unauthorized')],
    ['a dropped connection', () => new TypeError('fetch failed')],
    ['`ok: false`', () => json({ ok: false })],
  ] as const) {
    it(`${label} → nobody is signed in, nothing thrown`, async () => {
      const auth = useAdminAuth()
      auth.user.value = EDITOR as never
      responder = answer
      await auth.fetchUser()
      assert.equal(auth.user.value, null)
      assert.equal(auth.loading.value, false)
    })
  }
})

describe('useAdminAuth: login and the second factor', () => {
  it('login: POST {username, password} — no captcha keys unless a captcha is passed; a session signs in', async () => {
    responder = () => json({ ok: true, user: EDITOR })
    const auth = useAdminAuth()
    const res = await auth.login('bientap', 'Mat-khau-dai-123')
    assert.deepEqual(calls.map(call => ({ wire: wire(call), body: call.body })), [
      { wire: 'POST /api/admin/auth/login', body: { username: 'bientap', password: 'Mat-khau-dai-123' } },
    ])
    assert.deepEqual(res, { ok: true, user: EDITOR })
    assert.deepEqual(auth.user.value, EDITOR)

    calls.length = 0
    await auth.login('bientap', 'Mat-khau-dai-123', { captchaId: 'c-1', captchaCode: 'ab12' })
    assert.deepEqual(calls[0]!.body, { username: 'bientap', password: 'Mat-khau-dai-123', captchaId: 'c-1', captchaCode: 'ab12' })
  })

  it('login answered with a challenge: nobody is signed in, the challenge is returned', async () => {
    const challenge = { ok: true, mfaRequired: true, methods: ['totp', 'email_otp'], recoveryCodesAvailable: true }
    responder = () => json(challenge)
    const auth = useAdminAuth()
    const res = await auth.login('admin', 'Mat-khau-dai-123')
    assert.deepEqual(res, challenge)
    assert.equal(auth.user.value, null)
  })

  it('login refused: rethrown as is — the captcha flags stay at err.data.data, the status readable', async () => {
    responder = () => h3Error(403, 'Yêu cầu captcha.', { captchaRequired: true })
    const auth = useAdminAuth()
    const err = await failureOf(() => auth.login('bientap', 'sai'))
    assert.equal((err as { data?: { data?: { captchaRequired?: boolean } } }).data?.data?.captchaRequired, true)
    assert.equal(errorStatus(err), 403)
    assert.equal(auth.user.value, null)
  })

  it('captcha: GET auth/captcha answers its id and SVG', async () => {
    responder = () => json({ captchaId: 'c-9', svg: '<svg/>' })
    assert.deepEqual(await useAdminAuth().fetchCaptcha(), { captchaId: 'c-9', svg: '<svg/>' })
    assert.deepEqual(calls.map(wire), ['GET /api/admin/auth/captcha'])
  })

  it('verifyMfa: POST {method, code}; a session signs in; a refusal is rethrown with its status', async () => {
    responder = () => json({ ok: true, user: EDITOR })
    const auth = useAdminAuth()
    await auth.verifyMfa('totp', '123456')
    assert.deepEqual(calls.map(call => ({ wire: wire(call), body: call.body })), [{ wire: 'POST /api/admin/auth/mfa/verify', body: { method: 'totp', code: '123456' } }])
    assert.deepEqual(auth.user.value, EDITOR)

    state.clear()
    responder = () => h3Error(429, 'Quá nhiều lần xác thực sai. Vui lòng thử lại sau 15 phút.')
    const err = await failureOf(() => useAdminAuth().verifyMfa('email_otp', '000000'))
    assert.equal(errorStatus(err), 429)
    assert.equal(useAdminAuth().user.value, null)
  })
})

describe('useAdminAuth: logout and permissions', () => {
  it('logout: POST auth/logout, signed out, on to the login page', async () => {
    responder = () => json({ ok: true })
    const auth = useAdminAuth()
    auth.user.value = EDITOR as never
    await auth.logout()
    assert.deepEqual(calls.map(wire), ['POST /api/admin/auth/logout'])
    assert.equal(auth.user.value, null)
    assert.deepEqual(navigations, ['/admin/login'])
  })

  it('logout that fails on the wire still signs out and leaves — and the failure is not swallowed', async () => {
    responder = () => new TypeError('fetch failed')
    const auth = useAdminAuth()
    auth.user.value = EDITOR as never
    await failureOf(() => auth.logout())
    assert.equal(auth.user.value, null)
    assert.deepEqual(navigations, ['/admin/login'])
  })

  it('hasPermission: only a flag that is exactly true grants; a SuperAdmin has every one; nobody signed in has none', () => {
    const auth = useAdminAuth()
    assert.equal(auth.hasPermission('articles', 'read'), false)
    auth.user.value = EDITOR as never
    assert.equal(auth.hasPermission('articles', 'create'), true)
    assert.equal(auth.hasPermission('articles', 'update'), false, 'a NULL flag is not a grant')
    assert.equal(auth.hasPermission('articles', 'delete'), false)
    assert.equal(auth.hasPermission('users', 'read'), false)
    auth.user.value = { ...EDITOR, isSuperAdmin: true, permissions: [] } as never
    assert.equal(auth.hasPermission('users', 'delete'), true)
  })
})
