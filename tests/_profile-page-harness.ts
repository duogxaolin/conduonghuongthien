/**
 * Harness for tests/admin-profile-page.test.ts — `/admin/profile` (wave3 4.1 + 7.1).
 *
 * The REAL page — `<script setup>`, template and, after the split, the real child
 * components and composables it imports — mounted on the minimal DOM of
 * tests/_sfc-mount.ts, with REAL ofetch over a fake network that answers like
 * `server/api/admin/profile/**` (same sentences, same status codes, same shapes).
 *
 * What the page reaches outside Vue is stood in for, and restored after each test:
 *   - `window.addEventListener('keydown')` — the page's Escape handler; `pressKey()` fires it;
 *   - `document.getElementById(id).focus()` — each dialog moves focus to its first field;
 *     the ids focused are recorded in `focused`;
 *   - `document.createElement('a')` + `URL.createObjectURL` — "Tải về tệp .txt"; the
 *     file name and the Blob are recorded in `downloads`;
 *   - `navigator.clipboard.writeText` — "Copy toàn bộ"; written text in `clipboard`;
 *   - `useAdminAuth()` — `user` is a ref the test controls; `fetchUser()` re-reads it
 *     from `server.state.me` and is counted;
 *   - `<AdminProfileActivityHistory>` — a stub registered under the auto-import name,
 *     exposing `reload()` (counted). Registered by that exact name: a bare
 *     `<ProfileActivityHistory>` would not resolve, the template ref would hold a plain
 *     element, and `historyRef.reload()` would throw inside the enable flow (the bug the
 *     page comment describes).
 *
 * Two environment variables, for running the SAME suite against another version of the
 * page (red/green evidence, the DOM proof of the split):
 *   PROFILE_PAGE=<file>      mount that file instead of app/pages/admin/profile.vue;
 *   PROFILE_DOM_LOG=<file>   after every `settle()`, append one JSON line
 *                            `{ test, step, html, calls, toasts }` to that file.
 */
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveObjectURL } from 'node:buffer'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { errorMessage, errorStatus } from '../app/utils/errorMessage.ts'
import { formatDateTimeVN } from '../app/utils/formatDate.ts'
import { passwordRejectionMessage } from '../server/utils/password-policy.ts'
import { byText, findAll, mountSfc, textOf, type MiniElement, type MountedSfc } from './_sfc-mount.ts'

export const PAGE = process.env.PROFILE_PAGE
  ? path.resolve(process.env.PROFILE_PAGE)
  : fileURLToPath(new URL('../app/pages/admin/profile.vue', import.meta.url))
const DOM_LOG = process.env.PROFILE_DOM_LOG ? path.resolve(process.env.PROFILE_DOM_LOG) : null

// ─── Fake network under real ofetch ──────────────────────────────────────────

export type NetCall = {
  method: string
  url: URL
  body: unknown
  respond: (response: Response) => void
  fail: (error: Error) => void
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests', 503: 'Service Unavailable' }
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })
/** What `throw createError({ statusCode, statusMessage })` sends from a Nitro handler. */
export const h3Error = (statusCode: number, statusMessage: string) => json({ statusCode, statusMessage, message: statusMessage }, statusCode)
/** A connection that never got an answer. */
export const dropped = () => new TypeError('fetch failed')

export const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`
/** The request log as the tests compare it: the wire line, plus the JSON body when one was sent. */
export const sent = (calls: NetCall[], from = 0) =>
  calls.slice(from).map(call => (call.body === undefined ? wire(call) : { wire: wire(call), body: call.body }))

// ─── The profile API, as server/api/admin/profile/** answers it ──────────────

export type FactorType = 'totp' | 'email_otp' | 'second_password'
type FactorState = { state: 'disabled' | 'pending' | 'active', usable: boolean, enrolledAt: string | null, lastUsedAt: string | null }

export const API = '/api/admin/profile'
export const CURRENT_PASSWORD = 'Cu-MatKhau#2026'
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
export const TOTP_CODE = '482913'
export const EMAIL_CODE = '730154'
export const MASKED_EMAIL = 'c***@c11.example.vn'
const FACTOR_TYPES: FactorType[] = ['totp', 'email_otp', 'second_password']
const FACTOR_LABELS: Record<FactorType, string> = {
  totp: 'Ứng dụng xác thực (Google Authenticator)',
  email_otp: 'Mã gửi về email',
  second_password: 'Mật khẩu cấp 2',
}

/** Leave the request unanswered; the test answers it later with `call.respond(…)` or `server.answer(call)`. */
export const HOLD = Symbol('hold')
type Answer = Response | Error | typeof HOLD | undefined

const factor = (state: FactorState['state'] = 'disabled'): FactorState =>
  ({ state, usable: true, enrolledAt: state === 'disabled' ? null : '2026-10-01T02:00:00.000Z', lastUsedAt: null })

export const batchOf = (batch: number) => Array.from({ length: 10 }, (_, i) => `B${batch}-${String(i + 1).padStart(4, '0')}`)

export function profileServer() {
  const state = {
    email: 'canbo@c11.example.vn' as string | null,
    smtpReady: true,
    factors: { totp: factor(), email_otp: factor(), second_password: factor() } as Record<FactorType, FactorState>,
    recoveryRemaining: 0,
    /** MFA policy covers the account: the FIRST factor's confirm issues a batch (confirm.post.ts). */
    policyIssuesCodes: false,
    batches: 0,
    pendingSecondPassword: '',
    /** What `/api/admin/auth/me` would answer now; `fetchUser()` copies it into `user`. */
    me: { id: 7, username: 'canbo.c11', roleName: 'Biên tập viên', isSuperAdmin: false, mfaEnrollmentRequired: false } as Record<string, unknown>,
    /** Per-test answers, tried first. */
    override: (() => undefined) as (call: NetCall) => Answer,
  }

  const activeCount = () => FACTOR_TYPES.filter(type => state.factors[type].state === 'active').length
  const status = () => ({
    ok: true,
    email: state.email,
    smtpReady: state.smtpReady,
    factors: FACTOR_TYPES.map(factorType => ({ factorType, ...state.factors[factorType] })),
    recoveryCodesEnabled: state.recoveryRemaining > 0,
    recoveryCodesRemaining: state.recoveryRemaining,
    lockoutRisk: activeCount() > 0 && state.recoveryRemaining === 0
      && !(state.factors.email_otp.state === 'active' && state.factors.email_otp.usable),
  })
  const issueBatch = () => {
    state.batches += 1
    state.recoveryRemaining = 10
    return batchOf(state.batches)
  }
  const wrongPassword = (body: Record<string, unknown>) =>
    (body.currentPassword ? (body.currentPassword === CURRENT_PASSWORD ? null : h3Error(401, 'Mật khẩu hiện tại không đúng.'))
      : h3Error(400, 'Vui lòng nhập mật khẩu hiện tại để xác nhận.'))

  /** The default answer for a request — what the real handler would send. */
  const route = (call: NetCall): Response | Error => {
    const body = (call.body ?? {}) as Record<string, unknown>
    const at = `${call.method} ${call.url.pathname}`
    if (at === `GET ${API}/mfa`) return json(status())
    if (at === `PUT ${API}/password`) {
      if (!body.currentPassword || !body.newPassword) return h3Error(400, 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.')
      if (body.currentPassword !== CURRENT_PASSWORD) return h3Error(401, 'Mật khẩu hiện tại không đúng.')
      const problem = passwordRejectionMessage(body.newPassword, { username: String(state.me.username) })
      if (problem) return h3Error(400, problem)
      return json({ ok: true, message: 'Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị thu hồi.' })
    }
    if (at === `POST ${API}/mfa/enroll`) {
      const type = body.factorType as FactorType
      const rejected = wrongPassword(body)
      if (rejected) return rejected
      if (state.factors[type].state === 'active') return h3Error(409, 'Phương thức này đã được bật.')
      state.factors[type] = factor('pending')
      const expiresAt = '2026-10-26T03:15:00.000Z'
      if (type === 'totp') {
        return json({ ok: true, factorType: type, secret: TOTP_SECRET, otpauthUri: `otpauth://totp/CDKT%20Admin:canbo.c11?secret=${TOTP_SECRET}&issuer=CDKT%20Admin`, expiresAt })
      }
      if (type === 'email_otp') return json({ ok: true, factorType: type, sentTo: MASKED_EMAIL, expiresAt })
      state.pendingSecondPassword = String(body.secondPassword)
      return json({ ok: true, factorType: type, expiresAt })
    }
    if (at === `POST ${API}/mfa/confirm`) {
      const type = body.factorType as FactorType
      if (state.factors[type].state !== 'pending') return h3Error(400, 'Không có yêu cầu bật phương thức này đang chờ xác nhận.')
      const expected = type === 'totp' ? TOTP_CODE : type === 'email_otp' ? EMAIL_CODE : state.pendingSecondPassword
      if (body.code !== expected) {
        return h3Error(400, type === 'second_password' ? 'Mật khẩu cấp 2 nhập lại không khớp.' : 'Mã xác thực không đúng. Vui lòng thử lại.')
      }
      const first = activeCount() === 0
      state.factors[type] = { ...factor('active'), lastUsedAt: '2026-10-26T03:05:00.000Z' }
      const recoveryCodes = first && state.policyIssuesCodes && state.recoveryRemaining === 0 ? issueBatch() : null
      return json({ ok: true, factorType: type, message: `Đã bật ${FACTOR_LABELS[type]}. Các phiên đăng nhập khác đã bị thu hồi.`, ...(recoveryCodes ? { recoveryCodes } : {}) })
    }
    if (at === `POST ${API}/mfa/disable`) {
      const type = body.factorType as FactorType
      const rejected = wrongPassword(body)
      if (rejected) return rejected
      if (state.factors[type].state !== 'active') return h3Error(404, 'Phương thức này chưa được bật.')
      state.factors[type] = factor()
      const stillProtected = activeCount() > 0
      return json({
        ok: true,
        factorType: type,
        message: stillProtected
          ? `Đã tắt ${FACTOR_LABELS[type]}. Tài khoản vẫn còn yếu tố xác thực khác.`
          : `Đã tắt ${FACTOR_LABELS[type]}. Tài khoản trở lại đăng nhập chỉ bằng mật khẩu.`,
      })
    }
    if (at === `POST ${API}/mfa/recovery-codes`) {
      const rejected = wrongPassword(body)
      if (rejected) return rejected
      if (activeCount() === 0) return h3Error(400, 'Hãy bật ít nhất một phương thức xác thực hai bước trước khi tạo mã hồi phục.')
      return json({ ok: true, codes: issueBatch(), message: 'Hãy lưu các mã này ở nơi an toàn. Mỗi mã dùng được một lần và sẽ không hiển thị lại.' })
    }
    if (at === `DELETE ${API}/mfa/recovery-codes`) {
      const rejected = wrongPassword(body)
      if (rejected) return rejected
      state.recoveryRemaining = 0
      const emailUsable = state.factors.email_otp.state === 'active'
      return json({
        ok: true,
        lockoutRisk: activeCount() > 0 && !emailUsable,
        message: emailUsable
          ? 'Đã xoá toàn bộ mã hồi phục. Mã gửi về email là đường dự phòng còn lại.'
          : 'Đã xoá toàn bộ mã hồi phục. Tài khoản hiện KHÔNG còn đường dự phòng nào — hãy bật mã gửi về email.',
      })
    }
    throw new Error(`unexpected request ${wire(call)}`)
  }

  const respond = (call: NetCall): Answer => {
    const answer = state.override(call)
    if (answer !== undefined) return answer
    return route(call)
  }
  /** Answer a held request now, as the real handler would (state is read at THIS moment). */
  const answer = (call: NetCall) => {
    const response = route(call)
    if (response instanceof Error) call.fail(response)
    else call.respond(response)
  }
  return { state, respond, answer, route, status }
}

export type ProfileServer = ReturnType<typeof profileServer>

/** Status of a fresh account with these factors active (and optionally recovery codes). */
export function withActive(server: ProfileServer, types: FactorType[], recoveryRemaining = 0) {
  for (const type of types) server.state.factors[type] = { ...factor('active'), lastUsedAt: '2026-10-20T08:30:00.000Z' }
  server.state.recoveryRemaining = recoveryRemaining
  return server
}

// ─── Mounting the page ───────────────────────────────────────────────────────

export type Toast = { type: string, message: string }
export type Download = { name: string, blob: Blob | undefined }

/** Let promise chains, ofetch and Vue's scheduler run. */
async function settleOnly() {
  for (let i = 0; i < 12; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}

type Restore = () => void

function replaceGlobal(name: string, value: unknown): Restore {
  const target = globalThis as Record<string, unknown>
  const before = Object.getOwnPropertyDescriptor(target, name)
  Object.defineProperty(target, name, { value, configurable: true, writable: true })
  return () => {
    if (before) Object.defineProperty(target, name, before)
    else delete target[name]
  }
}

export async function mountProfile(t: TestContext, server = profileServer(), options: { superAdmin?: boolean } = {}) {
  const calls: NetCall[] = []
  const restore: Restore[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://admin.test'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      respond: resolve,
      fail: reject,
    }
    calls.push(call)
    const answer = server.respond(call)
    if (answer === HOLD) return
    if (answer instanceof Error) reject(answer)
    else if (answer) resolve(answer)
  })
  restore.push(replaceGlobal('$fetch', createFetch({ fetch: fetchImpl as typeof fetch })))

  // window: the page's Escape handler.
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  restore.push(replaceGlobal('window', {
    addEventListener: (type: string, fn: (event: unknown) => void) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn) },
    removeEventListener: (type: string, fn: (event: unknown) => void) => { listeners.get(type)?.delete(fn) },
  }))

  // document: focus moves and the download anchor.
  const focused: string[] = []
  const downloads: Download[] = []
  let root: MiniElement | null = null
  restore.push(replaceGlobal('document', {
    getElementById: (id: string) => {
      if (!root || !findAll(root, el => el.props.id === id).length) return null
      return { focus: () => { focused.push(id) } }
    },
    createElement: (tag: string) => {
      if (tag !== 'a') throw new Error(`unexpected document.createElement(${tag})`)
      const anchor = {
        href: '',
        download: '',
        // Read the Blob before the page revokes the URL (it does so right after click()).
        click: () => { downloads.push({ name: anchor.download, blob: resolveObjectURL(anchor.href) }) },
      }
      return anchor
    },
  }))

  const clipboard: string[] = []
  const clipboardAnswer = { fails: false }
  restore.push(replaceGlobal('navigator', {
    clipboard: {
      writeText: async (text: string) => {
        if (clipboardAnswer.fails) throw new DOMException('Write permission denied.', 'NotAllowedError')
        clipboard.push(text)
      },
    },
  }))

  const toasts: Toast[] = []
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type =>
    [type, (message: string) => { toasts.push({ type, message }) }]))

  const user = Vue.ref<Record<string, unknown> | null>({ ...server.state.me, isSuperAdmin: options.superAdmin === true })
  const auth = { fetches: 0 }
  const fetchUser = async () => {
    auth.fetches += 1
    user.value = { ...server.state.me, isSuperAdmin: options.superAdmin === true }
  }

  const history = { mounts: 0, reloads: 0 }
  const HistoryStub = Vue.defineComponent({
    name: 'AdminProfileActivityHistory',
    setup(_props, { expose }) {
      history.mounts += 1
      expose({ reload: () => { history.reloads += 1 } })
      return () => Vue.h('section', { 'data-stub': 'profile-activity-history' })
    },
  })

  const page = await mountSfc(PAGE, {
    auto: {
      definePageMeta: () => {},
      useToast: () => toast,
      useAdminAuth: () => ({ user, fetchUser }),
      ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
      onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted, onBeforeUnmount: Vue.onBeforeUnmount,
      // Nuxt auto-imports from app/utils and app/composables — the real ones.
      errorMessage, errorStatus, formatDateTimeVN, adminFetch,
    },
    components: { AdminProfileActivityHistory: HistoryStub },
  })
  root = page.root

  // Unmount, then put the globals back — at once, so a second mount in the same test
  // starts from the real ones (not from this mount's stand-ins).
  let open = true
  const close = () => {
    if (!open) return
    open = false
    page.unmount()
    for (const undo of restore.reverse()) undo()
  }
  t.after(close)

  let step = 0
  const settle = async () => {
    await settleOnly()
    if (DOM_LOG) {
      appendFileSync(DOM_LOG, `${JSON.stringify({ test: t.fullName, step: step++, html: page.html(), calls: sent(calls), toasts })}\n`)
    }
  }

  /** Fire a key at `window`, as a press outside any input does (the page listens there). */
  const pressKey = (key: string) => {
    for (const fn of [...(listeners.get('keydown') ?? [])]) fn({ key, preventDefault() {} })
  }
  const keydownListeners = () => listeners.get('keydown')?.size ?? 0

  return { page, server, calls, toasts, focused, downloads, clipboard, clipboardAnswer, user, auth, history, settle, close, pressKey, keydownListeners }
}

export type ProfileCtx = Awaited<ReturnType<typeof mountProfile>>

export async function openProfile(t: TestContext, server = profileServer(), options?: { superAdmin?: boolean }) {
  const ctx = await mountProfile(t, server, options)
  await ctx.settle()
  return ctx
}

// ─── Reading the page ────────────────────────────────────────────────────────

export const FACTOR_LABEL: Record<FactorType, string> = {
  totp: 'Ứng dụng xác thực (Google Authenticator)',
  email_otp: 'Mã OTP gửi về email',
  second_password: 'Mật khẩu cấp 2',
}

export const byId = (page: MountedSfc, id: string) => {
  const found = findAll(page.root, el => el.props.id === id)
  if (found.length !== 1) throw new Error(`expected one #${id}, found ${found.length}`)
  return found[0]!
}
export const maybeById = (page: MountedSfc, id: string) => findAll(page.root, el => el.props.id === id)[0] ?? null
export const button = (from: MiniElement, text: string) => byText(from, 'button', text)
/** Every `role="alert"` on screen. */
export const alerts = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'alert')
export const alertTexts = (from: MiniElement | MountedSfc) => findAll('root' in from ? from.root : from, el => el.props.role === 'alert').map(el => textOf(el))
export const skeleton = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'status' && el.props['aria-busy'] === 'true')[0] ?? null
export const dialogs = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'dialog')
export const dialog = (page: MountedSfc) => {
  const open = dialogs(page)
  if (open.length !== 1) throw new Error(`expected one open dialog, found ${open.length}`)
  return open[0]!
}
/** The overlay behind the open dialog (it closes the dialog on a click on itself). */
export const overlay = (page: MountedSfc) => dialog(page).parent!
export const section = (page: MountedSfc, heading: string) => {
  const found = findAll(page.root, el => el.tag === 'section' && findAll(el, h => h.tag === 'h2' && textOf(h) === heading).length > 0)
  if (found.length !== 1) throw new Error(`expected one section "${heading}", found ${found.length}`)
  return found[0]!
}
/** The card of one factor in the "Xác thực hai bước" list. */
export const factorCard = (page: MountedSfc, type: FactorType) => {
  const found = findAll(page.root, el => el.tag === 'div'
    && String(el.props.class ?? '').startsWith('rounded-xl border p-4')
    && findAll(el, s => s.tag === 'strong' && textOf(s) === FACTOR_LABEL[type]).length > 0)
  if (found.length !== 1) throw new Error(`expected one ${type} card, found ${found.length}`)
  return found[0]!
}
/** The "Mã dự phòng" card. */
export const recoveryCard = (page: MountedSfc) => {
  const found = findAll(page.root, el => el.tag === 'div'
    && String(el.props.class ?? '').startsWith('mt-5 rounded-xl')
    && findAll(el, s => s.tag === 'strong' && textOf(s) === 'Mã dự phòng').length > 0)
  if (found.length !== 1) throw new Error(`expected one recovery card, found ${found.length}`)
  return found[0]!
}
/** Recovery codes on screen — the `li.font-mono` list tests/e2e/admin-mfa.spec.ts reads. */
export const shownCodes = (page: MountedSfc) =>
  findAll(page.root, el => el.tag === 'li' && String(el.props.class ?? '').includes('font-mono')).map(el => textOf(el))
export const historyShown = (page: MountedSfc) => findAll(page.root, el => el.props['data-stub'] === 'profile-activity-history').length === 1
/** The account badge next to the user name. */
export const accountBadge = (page: MountedSfc) => {
  const found = findAll(page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('ml-auto flex items-center gap-2'))
  return found[0] ? textOf(found[0]) : null
}

/** An Enter key-down as the browser sends it from an input. */
export const enter = (overrides: Partial<{ repeat: boolean, isComposing: boolean, keyCode: number }> = {}) =>
  ({ key: 'Enter', repeat: false, isComposing: false, keyCode: 13, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...overrides })

/** ofetch's own line — `[GET] "/api/…": 403 Forbidden` — must never reach a person. */
export const OFETCH_LINE = /\[(GET|POST|PUT|DELETE)\]|<no response>|fetch failed/

export { textOf }
