import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'

/**
 * Chính sách MFA có thể tới hạn GIỮA phiên (kiểm chứng 2A, S4): cán bộ đang mở một
 * trang quản trị lúc mốc cưỡng chế qua, lượt gọi API kế tiếp nhận 403
 * `data.code = 'mfa_enrollment_required'`. Middleware route chỉ chạy khi chuyển
 * trang, nên trước đây trang hiện một lỗi rời rạc và cán bộ không biết phải làm gì.
 * Nay plugin client `app/plugins/mfa-enrollment-redirect.client.ts` gắn một hook vào
 * `$fetch` toàn cục: thấy đúng mã đó → đánh dấu tài khoản phải bật MFA (banner) và
 * chuyển về `/admin/profile#security`.
 *
 * Chạy THẬT plugin và helper với các global của Nuxt giả lập.
 */

type Hook = (context: { response?: { status?: number, _data?: unknown } }) => unknown
let installedHook: Hook | null = null
const navigations: unknown[] = []
let currentPath = '/admin/content/articles'
const user = { value: { id: 1, username: 'admin', mfaEnrollmentRequired: false } as Record<string, unknown> | null }

const baseFetch = Object.assign(async () => ({}), {
  create: (options: { onResponseError?: Hook }) => {
    installedHook = options.onResponseError ?? null
    return Object.assign(async () => ({}), { create: baseFetch.create })
  },
})

Object.assign(globalThis, {
  $fetch: baseFetch,
  defineNuxtPlugin: (plugin: unknown) => plugin,
  useAdminAuth: () => ({ user }),
  useRouter: () => ({ currentRoute: { get value() { return { path: currentPath } } } }),
  navigateTo: (to: unknown) => { navigations.push(to); return Promise.resolve() },
})

const helper = await import('../app/utils/mfa-enrollment-redirect')
const plugin = (await import('../app/plugins/mfa-enrollment-redirect.client')).default as unknown as { setup: () => void } | (() => void)

beforeEach(() => {
  navigations.length = 0
  currentPath = '/admin/content/articles'
  user.value = { id: 1, username: 'admin', mfaEnrollmentRequired: false }
  installedHook = null
  ;(globalThis as Record<string, unknown>).$fetch = baseFetch
  if (typeof plugin === 'function') plugin()
  else plugin.setup()
})

const enrollmentError = { status: 403, _data: { statusCode: 403, statusMessage: 'x', data: { code: 'mfa_enrollment_required', message: 'x' } } }

test('the plugin installs one onResponseError hook on the global $fetch', () => {
  assert.equal(typeof installedHook, 'function')
  assert.notEqual((globalThis as Record<string, unknown>).$fetch, baseFetch, 'the global $fetch was not replaced by the hooked instance')
})

test('a 403 mfa_enrollment_required mid-session flags the account and goes to /admin/profile#security', async () => {
  await installedHook!({ response: enrollmentError })
  assert.equal(user.value!.mfaEnrollmentRequired, true)
  assert.deepEqual(navigations, [{ path: '/admin/profile', hash: '#security' }])
})

test('already on the profile page: flagged, no navigation loop', async () => {
  currentPath = '/admin/profile'
  await installedHook!({ response: enrollmentError })
  assert.equal(user.value!.mfaEnrollmentRequired, true)
  assert.deepEqual(navigations, [])
})

test('any other error is left alone', async () => {
  for (const response of [
    { status: 403, _data: { statusMessage: 'Forbidden: Insufficient permissions' } },
    { status: 401, _data: { data: { code: 'mfa_enrollment_required' } } },
    { status: 500, _data: null },
    { status: 403, _data: 'mfa_enrollment_required' },
  ]) {
    await installedHook!({ response })
  }
  assert.equal(user.value!.mfaEnrollmentRequired, false)
  assert.deepEqual(navigations, [])
})

test('the code is the one the server sends', async () => {
  const policy = await import('../server/utils/mfa/policy')
  assert.equal(helper.MFA_ENROLLMENT_REQUIRED_CODE, policy.MFA_ENROLLMENT_REQUIRED_CODE)
})
