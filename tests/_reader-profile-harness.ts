/**
 * Harness for tests/reader-profile-page-behavior.test.ts — the reader's own page `/profile`
 * (`app/pages/profile.vue`, wave3 4.2). NOT `/admin/profile`: that one is
 * tests/_profile-page-harness.ts.
 *
 * The REAL page — `<script setup>`, template and, after the split, the real parts it
 * imports — mounted on the minimal DOM of tests/_sfc-mount.ts, with the REAL
 * `useReaderAuth`, `useReaderNotifications` and `useReadingHistory`, and REAL ofetch over a
 * fake network that answers like `server/api/public/reader/**` (same shapes, same
 * sentences, same status codes: `requireReader` → 401 "Chưa đăng nhập").
 *
 * The three composables keep their state at MODULE level (one identity, one notification
 * list, one history per page). Each mount imports a FRESH copy of each (`?mount=N`), so a
 * test starts from what a page load starts from — nothing loaded, nothing in flight — and
 * no state leaks from the test before.
 *
 * What the page reaches outside Vue is stood in for, and restored after each test:
 *   - `localStorage` / `sessionStorage` — in-memory; `storage` seeds them (the reading
 *     history `cdkt_reader_history_v1`, the chat tickets `cdkt_sessions_v1`);
 *   - `window.location` — `signIn()` writes `href`; read it back from `location`;
 *   - `useSeoMeta(input)` — recorded; `useI18n()` — the real fallback dictionaries.
 * `<client-only>` and `<ReaderAvatar>` stay unresolved: plain elements with their props
 * (client-only's content renders inside it). `NuxtLink` is registered as a stand-in that
 * renders a `<nuxt-link to>` element around its slot, so `<nuxt-link>` in a template and
 * `resolveComponent('NuxtLink')` in a script (a notification with a target) reach the SAME
 * component — as in Nuxt. Left unresolved, the two would render under two different tag
 * names depending on whether the file declares a `NuxtLink` binding, which is not a
 * difference a browser ever sees.
 *
 * Environment, for running the SAME suite against another version of the page:
 *   READER_PROFILE_FILE=<file>     mount that file instead of app/pages/profile.vue;
 *   READER_PROFILE_DOM_LOG=<file>  after every `settle()`, append `{ test, step, html,
 *                                  calls, location }` as one JSON line.
 */
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary.ts'
import { findAll, mountSfc, textOf, type MiniElement, type MiniNode, type MountedSfc } from './_sfc-mount.ts'

export const PAGE = process.env.READER_PROFILE_FILE
  ? path.resolve(process.env.READER_PROFILE_FILE)
  : fileURLToPath(new URL('../app/pages/profile.vue', import.meta.url))
const DOM_LOG = process.env.READER_PROFILE_DOM_LOG ? path.resolve(process.env.READER_PROFILE_DOM_LOG) : null

// ─── Fake network under real ofetch ──────────────────────────────────────────

export type NetCall = {
  method: string
  url: URL
  body: unknown
  respond: (response: Response) => void
  fail: (error: Error) => void
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable' }
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })
/** What `throw createError({ statusCode, statusMessage })` sends from a Nitro handler. */
export const h3Error = (statusCode: number, statusMessage: string) => json({ statusCode, statusMessage, message: statusMessage }, statusCode)
/** `requireReader()` on a missing / expired / revoked ticket. */
export const unauthorized = () => h3Error(401, 'Chưa đăng nhập')
export const dropped = () => new TypeError('fetch failed')
export const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`
export const sent = (calls: NetCall[], from = 0) =>
  calls.slice(from).map(call => (call.body === undefined ? wire(call) : { wire: wire(call), body: call.body }))

export const HOLD = Symbol('hold')
type Answer = Response | Error | typeof HOLD | undefined

export const API = '/api/public/reader'

// ─── The reader API, as server/api/public/reader/** answers it ───────────────

export type FakeReader = { displayName: string, email: string | null, initials: string, customDisplayName?: string | null, emailNotifications?: boolean }

export const READER: FakeReader = { displayName: 'Trần Thị Bình', email: 'binh@example.test', initials: 'TB', customDisplayName: null, emailNotifications: true }

export const comment = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  body: `Bình luận số ${id}.\nDòng thứ hai.`,
  createdAt: '2026-10-19T03:00:00.000Z',
  isReply: false,
  replyCount: 0,
  article: { title: `Bài viết ${id}`, slug: `bai-viet-${id}`, readable: true, url: `/news/bai-viet-${id}` },
  ...over,
})

export const chat = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `Câu hỏi về thủ tục số ${id}`,
  messageCount: 2 + id,
  startedAt: '2026-10-18T02:00:00.000Z',
  lastMessageAt: '2026-10-18T02:30:00.000Z',
  ...over,
})

export const notification = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  isRead: false,
  createdAt: '2026-10-20T01:00:00.000Z',
  authorName: 'Ban quản trị',
  isAdminReply: true,
  excerpt: `Trả lời số ${id}`,
  target: { articleTitle: `Bài viết ${id}`, url: `/news/bai-viet-${id}#comment-${id}` },
  ...over,
})

const COMMENTS_PER_PAGE = 10
const NOTIFICATIONS_PER_PAGE = 10

export function readerServer() {
  const state = {
    /** `null` → signed out (`/me` answers `{ ok: true, reader: null }`). */
    reader: { ...READER } as FakeReader | null,
    comments: [comment(1), comment(2, { isReply: true, replyCount: 0 }), comment(3, { replyCount: 2, article: { title: 'Bài đã ẩn', slug: 'bai-an', readable: false, url: '/news/bai-an' } })] as Array<ReturnType<typeof comment>>,
    chats: [chat(1), chat(2)] as Array<ReturnType<typeof chat>>,
    notifications: [notification(1), notification(2, { isRead: true, isAdminReply: false, authorName: 'Nguyễn Văn An' }), notification(3, { target: null })] as Array<ReturnType<typeof notification>>,
    /** Chats the server attaches on a claim (tickets → sessions), appended to `chats`. */
    claimable: [] as Array<ReturnType<typeof chat>>,
    /** Per-test answers, tried first. */
    override: (() => undefined) as (call: NetCall) => Answer,
  }

  const page = <T>(rows: T[], perPage: number, requested: number) => {
    const total = rows.length
    const totalPages = Math.max(1, Math.ceil(total / perPage))
    const current = Math.min(Math.max(1, requested || 1), totalPages)
    return { total, totalPages, page: current, perPage, rows: rows.slice((current - 1) * perPage, current * perPage) }
  }

  const route = (call: NetCall): Response | Error => {
    const at = `${call.method} ${call.url.pathname}`
    const body = (call.body ?? {}) as Record<string, unknown>
    if (at === `GET ${API}/me`) return json({ ok: true, reader: state.reader })
    if (!state.reader) return unauthorized()
    if (at === `GET ${API}/comments`) {
      const p = page(state.comments, COMMENTS_PER_PAGE, Number(call.url.searchParams.get('page')))
      return json({ ok: true, total: p.total, page: p.page, perPage: p.perPage, totalPages: p.totalPages, comments: p.rows })
    }
    if (at === `GET ${API}/chats`) return json({ ok: true, sessions: state.chats })
    if (at === `GET ${API}/notifications`) {
      const p = page(state.notifications, NOTIFICATIONS_PER_PAGE, Number(call.url.searchParams.get('page')))
      return json({ ok: true, items: p.rows, total: p.total, unreadCount: state.notifications.filter(n => !n.isRead).length, page: p.page, perPage: p.perPage, totalPages: p.totalPages })
    }
    if (at === `POST ${API}/notifications/read`) {
      for (const n of state.notifications) if (body.all === true || (Array.isArray(body.ids) && body.ids.includes(n.id))) n.isRead = true
      return json({ ok: true })
    }
    if (at === `PUT ${API}/profile`) {
      const name = String(body.displayName ?? '').trim()
      if (name.length < 2 || name.length > 60) return h3Error(400, 'Tên hiển thị phải có từ 2 đến 60 ký tự.')
      state.reader = { ...state.reader, displayName: name, customDisplayName: name, initials: name.split(/\s+/).slice(-2).map(w => w[0]!.toUpperCase()).join('') }
      return json({ ok: true, reader: { displayName: name, customDisplayName: name, initials: state.reader.initials } })
    }
    if (at === `PUT ${API}/profile/email-notifications`) {
      if (typeof body.enabled !== 'boolean') return h3Error(400, 'Giá trị không hợp lệ.')
      state.reader = { ...state.reader, emailNotifications: body.enabled }
      return json({ ok: true, emailNotifications: body.enabled })
    }
    if (at === `POST ${API}/claim-chats`) {
      const claimed = state.claimable.length
      state.chats = [...state.claimable, ...state.chats]
      state.claimable = []
      return json({ ok: true, claimed, verified: claimed })
    }
    throw new Error(`unexpected request ${wire(call)}`)
  }
  const respond = (call: NetCall): Answer => state.override(call) ?? route(call)
  /** Answer a held request now, as the handler would (state is read at THIS moment). */
  const answer = (call: NetCall) => {
    const response = route(call)
    if (response instanceof Error) call.fail(response)
    else call.respond(response)
  }
  return { state, respond, answer, route }
}
export type ReaderServer = ReturnType<typeof readerServer>

// ─── Mounting the page ───────────────────────────────────────────────────────

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

/** A Web Storage over a Map (the composables call getItem/setItem/removeItem). */
export function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
    clear: () => { map.clear() },
  }
}

const COMPOSABLES = ['useReaderAuth', 'useReaderNotifications', 'useReadingHistory'] as const
let freshness = 0
/** A fresh copy of each module-state composable: a new module URL is a new module instance. */
async function freshComposables() {
  freshness += 1
  const out: Record<string, Record<string, unknown>> = {}
  for (const name of COMPOSABLES) {
    const url = pathToFileURL(fileURLToPath(new URL(`../app/composables/${name}.ts`, import.meta.url)))
    url.search = `?mount=${freshness}`
    out[`~/composables/${name}`] = await import(url.href) as Record<string, unknown>
  }
  return out
}

/** `<nuxt-link to>` around the slot; class and listeners fall through onto it. */
const NuxtLinkStandIn = Vue.defineComponent({
  name: 'NuxtLink',
  props: { to: { type: [String, Object], default: undefined } },
  setup(props, { slots }) {
    return () => Vue.h('nuxt-link', { to: props.to }, slots.default?.())
  },
})

export type MountOptions = { local?: Record<string, string>, session?: Record<string, string> }
const MOUNTS = new WeakMap<TestContext, number>()

export async function mountProfile(t: TestContext, server = readerServer(), options: MountOptions = {}) {
  const calls: NetCall[] = []
  const restore: Restore[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://portal.test'),
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

  const local = memoryStorage(options.local)
  const session = memoryStorage(options.session)
  const location = { pathname: '/profile', search: '', href: 'http://portal.test/profile' }
  restore.push(replaceGlobal('window', { location }))
  restore.push(replaceGlobal('localStorage', local))
  restore.push(replaceGlobal('sessionStorage', session))

  const currentLang = Vue.ref('vi')
  const translate = (key: string): string => hardcodedDictionary[currentLang.value]?.[key] || hardcodedDictionary.vi?.[key] || key
  let seoInput: Record<string, unknown> = {}

  const composables = await freshComposables()
  const page = await mountSfc(PAGE, {
    auto: {
      useSeoMeta: (input: Record<string, unknown>) => { seoInput = input },
    },
    modules: {
      ...composables,
      '~/composables/useI18n': { useI18n: () => ({ t: translate, currentLang }) },
    },
    components: { NuxtLink: NuxtLinkStandIn },
  })

  let open = true
  const close = () => {
    if (!open) return
    open = false
    page.unmount()
    for (const undo of restore.reverse()) undo()
  }
  t.after(close)

  const mount = (MOUNTS.get(t) ?? 0) + 1
  MOUNTS.set(t, mount)
  let step = 0
  const settle = async () => {
    await settleOnly()
    if (DOM_LOG) {
      appendFileSync(DOM_LOG, `${JSON.stringify({ test: t.fullName, step: `${mount}.${step++}`, html: page.html(), calls: sent(calls), location: location.href })}\n`)
    }
  }
  const seo = () => ({ ...seoInput })
  const auth = composables['~/composables/useReaderAuth']!.useReaderAuth as () => { reader: Vue.ComputedRef<FakeReader | null>, loaded: Vue.ComputedRef<boolean> }

  return { page, server, calls, local, session, location, seo, settle, close, auth }
}
export type ProfileCtx = Awaited<ReturnType<typeof mountProfile>>

export async function openProfile(t: TestContext, server = readerServer(), options?: MountOptions) {
  const ctx = await mountProfile(t, server, options)
  await ctx.settle()
  return ctx
}

// ─── Reading the page ────────────────────────────────────────────────────────

const root = (from: MiniElement | MountedSfc) => ('root' in from ? from.root : from)

/** The text nodes under an element, each trimmed, joined by one space. */
export function words(from: MiniElement | MountedSfc): string {
  const out: string[] = []
  const walk = (node: MiniNode) => {
    if (node.kind === 'text') out.push(node.text.replace(/\s+/g, ' ').trim())
    else if (node.kind === 'element') node.children.forEach(walk)
  }
  walk(root(from))
  return out.filter(Boolean).join(' ')
}

export const byTag = (from: MiniElement | MountedSfc, tag: string) => findAll(root(from), el => el.tag === tag)
export const buttonsWith = (from: MiniElement | MountedSfc, text: string) => byTag(from, 'button').filter(el => words(el).includes(text))
export const button = (from: MiniElement | MountedSfc, text: string) => {
  const found = buttonsWith(from, text)
  if (found.length !== 1) throw new Error(`expected one <button> containing "${text}", found ${found.length}`)
  return found[0]!
}
export const alerts = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.props.role === 'alert').map(words)
export const statuses = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.props.role === 'status' && el.props['aria-busy'] !== 'true').map(words)
export const busy = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.props.role === 'status' && el.props['aria-busy'] === 'true').map(words)
/** One block of the signed-in page, by its `<h2>` text (start of it). */
export const block = (page: MountedSfc, heading: string) => {
  const found = findAll(page.root, el => el.tag === 'section' && findAll(el, h => h.tag === 'h2' && words(h).startsWith(heading)).length > 0
    && !findAll(el, s => s !== el && s.tag === 'section').length)
  if (found.length !== 1) throw new Error(`expected one block "${heading}", found ${found.length}`)
  return found[0]!
}
/** The identity block (avatar, name, rename form) — the first block, it has no `<h2>`. */
export const identity = (page: MountedSfc) => byTag(page, 'form')[0]!.parent!
export const nameInput = (page: MountedSfc) => findAll(page.root, el => el.tag === 'input' && el.props.id === 'reader-display-name')[0]!
export const emailSwitch = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'switch')[0]!
export const links = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.tag === 'nuxt-link' || el.tag === 'NuxtLink').map(el => ({ to: el.props.to, text: words(el) }))
export const items = (from: MiniElement) => byTag(from, 'li')

export { textOf }
