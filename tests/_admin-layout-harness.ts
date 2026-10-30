/**
 * Harness for tests/admin-layout.test.ts — the admin shell `app/layouts/admin.vue`
 * (sidebar, top bar, mobile drawer) that wraps every `/admin/**` page.
 *
 * The REAL layout — `<script setup>` (with its top-level `await useAsyncData`), template and
 * every `.vue` it imports — mounted inside `<Suspense>` on the minimal DOM of
 * tests/_sfc-mount.ts, with:
 *   - the REAL `useAdminAuth` (user, `hasPermission`, `logout`) and the REAL `useLayoutConfig`,
 *     over REAL ofetch + `adminFetch` on a fake network that answers like
 *     `server/api/public/settings.get.ts`, `server/api/admin/cache-clear.post.ts` and
 *     `server/api/admin/auth/logout.post.ts` (same sentences, status codes, shapes);
 *   - the Nuxt runtime it reaches for as globals — `useState` (one shared map: `admin_user` is
 *     what `useAdminAuth` reads), `navigateTo` (recorded), `useRequestHeaders`, `computed`
 *     (`useLayoutConfig` uses it unimported);
 *   - `useRoute()` — a reactive `{ path, fullPath, name }` the test moves with `go()`;
 *   - `useAsyncData` — runs the handler once; a failed read leaves `data` at `default()`, as
 *     Nuxt 4 does; awaiting it resolves after the read, as on the server;
 *   - `useToast()` — every toast recorded;
 *   - `document` — `body.style` / `documentElement.style` only (the scroll lock of the drawer);
 *   - `<Transition>` — renders its child as is (no CSS here: the real hooks need `classList`
 *     and `requestAnimationFrame`, and a leave would never finish).
 * Auto-imported components (`<ToastContainer>`, `<AdminMfaEnrollmentBanner>`, the two global
 * modals) and `<nuxt-link>` stay unresolved: plain elements carrying their props, so a link's
 * `to` / `active-class` / `exact-active-class` are read straight off the tree. Vue Router does
 * not run here: which link the browser highlights is NOT measured, only what the layout
 * hands the link.
 *
 * Two environment variables, for running the SAME suite against another version of the
 * layout (green on the original before the split; the DOM proof of the split):
 *   ADMIN_LAYOUT_FILE=<file>     mount that file instead of app/layouts/admin.vue;
 *   ADMIN_LAYOUT_DOM_LOG=<file>  after every `settle()`, append one JSON line
 *                                `{ test, step, html, calls, toasts, navigations, lock }`.
 */
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { byText, findAll, isShown, mountSfc, textOf, VUE_FOR_SFC, type MiniElement, type MountedSfc } from './_sfc-mount.ts'

export const LAYOUT = process.env.ADMIN_LAYOUT_FILE
  ? path.resolve(process.env.ADMIN_LAYOUT_FILE)
  : fileURLToPath(new URL('../app/layouts/admin.vue', import.meta.url))
const DOM_LOG = process.env.ADMIN_LAYOUT_DOM_LOG ? path.resolve(process.env.ADMIN_LAYOUT_DOM_LOG) : null

// ─── Fake network under real ofetch ──────────────────────────────────────────

export type NetCall = { method: string, url: URL, body: unknown, respond: (r: Response) => void, fail: (e: Error) => void }

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 500: 'Internal Server Error', 503: 'Service Unavailable' }
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })
/** What `throw createError({ statusCode, statusMessage })` sends from a Nitro handler. */
export const h3Error = (statusCode: number, statusMessage: string) => json({ statusCode, statusMessage, message: statusMessage }, statusCode)
export const dropped = () => new TypeError('fetch failed')
export const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`
export const sent = (calls: NetCall[], from = 0) =>
  calls.slice(from).map(call => (call.body === undefined ? wire(call) : { wire: wire(call), body: call.body }))

/** Leave the request unanswered; the test answers it with `server.answer(call)`. */
export const HOLD = Symbol('hold')
type Answer = Response | Error | typeof HOLD | undefined

export function adminLayoutServer() {
  const state = {
    /** `settings.layout_config` as `/api/public/settings` sends it (a JSON string, or absent). */
    layoutConfig: undefined as string | undefined,
    /** How many route-cache entries the next purge finds. */
    cachedRoutes: 3,
    override: (() => undefined) as (call: NetCall) => Answer,
  }
  const route = (call: NetCall): Response | Error => {
    const at = `${call.method} ${call.url.pathname}`
    if (at === 'GET /api/public/settings') {
      return json({ ok: true, settings: state.layoutConfig === undefined ? {} : { layout_config: state.layoutConfig } })
    }
    if (at === 'POST /api/admin/cache-clear') {
      if ((call.body as { confirm?: unknown } | undefined)?.confirm !== true) return h3Error(400, 'Cần xác nhận trước khi xoá cache.')
      const cleared = state.cachedRoutes
      state.cachedRoutes = 0
      return json({ ok: true, cleared, message: `Đã xoá ${cleared} mục cache. Trang công khai sẽ dựng lại từ dữ liệu mới.` })
    }
    if (at === 'POST /api/admin/auth/logout') return json({ ok: true })
    throw new Error(`unexpected request ${wire(call)}`)
  }
  const respond = (call: NetCall): Answer => state.override(call) ?? route(call)
  const answer = (call: NetCall) => {
    const response = route(call)
    if (response instanceof Error) call.fail(response)
    else call.respond(response)
  }
  return { state, respond, answer }
}
export type AdminLayoutServer = ReturnType<typeof adminLayoutServer>

// ─── Accounts, as `GET /api/admin/auth/me` sends them ────────────────────────

export type Grant = { resource: string, canRead?: boolean | null, canCreate?: boolean | null, canUpdate?: boolean | null, canDelete?: boolean | null }
export type LayoutUser = {
  id: number, username: string, email: string, roleName: string | null, isSuperAdmin: boolean,
  permissions: Array<{ id: number, roleId: number, resource: string, canCreate: boolean | null, canRead: boolean | null, canUpdate: boolean | null, canDelete: boolean | null, canPublish: boolean | null, canArchive: boolean | null, canTest: boolean | null }>,
  mfaEnrollmentRequired: boolean, mfaEnforceAfter: string | null,
}

export function account(username: string, grants: Grant[] = [], options: { isSuperAdmin?: boolean, roleName?: string | null } = {}): LayoutUser {
  return {
    id: 7, username, email: `${username}@example.vn`, roleName: options.roleName === undefined ? 'Biên tập' : options.roleName,
    isSuperAdmin: options.isSuperAdmin ?? false,
    permissions: grants.map((g, i) => ({
      id: i + 1, roleId: 3, resource: g.resource,
      canCreate: g.canCreate ?? false, canRead: g.canRead === undefined ? true : g.canRead, canUpdate: g.canUpdate ?? false, canDelete: g.canDelete ?? false,
      canPublish: false, canArchive: false, canTest: false,
    })),
    mfaEnrollmentRequired: false, mfaEnforceAfter: null,
  }
}
export const superAdmin = () => account('quantri', [], { isSuperAdmin: true, roleName: 'Quản trị cấp cao' })

// ─── Nuxt stand-ins ──────────────────────────────────────────────────────────

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

/** `useAsyncData` as `await`ed in a layout: one read; a failure leaves `data` at `default()`. */
function fakeUseAsyncData(keys: string[]) {
  return (key: string, handler: () => Promise<unknown>, options: { default?: () => unknown } = {}) => {
    keys.push(key)
    const data = Vue.shallowRef<unknown>(options.default ? options.default() : undefined)
    const error = Vue.shallowRef<unknown>(undefined)
    const result = { data, error }
    const run = Promise.resolve().then(() => handler()).then(
      (value) => { data.value = value },
      (err: unknown) => { error.value = err; data.value = options.default ? options.default() : undefined },
    ).then(() => result)
    return Object.assign(run, result)
  }
}

/** `<Transition>` without CSS: the child as is — enters and leaves at once, as with no transition styles. */
const TransitionStandIn = Vue.defineComponent({
  name: 'Transition',
  props: { name: String },
  setup: (_props, { slots }) => () => slots.default?.()[0],
})

async function settleOnly() {
  for (let i = 0; i < 12; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}

export type Toast = { type: string, message: string }
export type RouteState = { path: string, fullPath: string, name: string | undefined }
export type MountOptions = { user?: LayoutUser | null, path?: string, name?: string }
const MOUNTS = new WeakMap<TestContext, number>()

export async function mountLayout(t: TestContext, server = adminLayoutServer(), options: MountOptions = {}) {
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

  const state = new Map<string, Vue.Ref<unknown>>()
  const useState = <T>(key: string, init: () => T) => {
    if (!state.has(key)) state.set(key, Vue.ref(init()))
    return state.get(key) as Vue.Ref<T>
  }
  useState('admin_user', () => (options.user === undefined ? account('bientap') : options.user))
  const navigations: unknown[] = []
  restore.push(replaceGlobal('useState', useState))
  restore.push(replaceGlobal('navigateTo', (to: unknown) => { navigations.push(to) }))
  restore.push(replaceGlobal('useRequestHeaders', () => ({})))
  restore.push(replaceGlobal('computed', Vue.computed))

  const lockTarget = { body: { style: {} as Record<string, string> }, documentElement: { style: {} as Record<string, string> } }
  restore.push(replaceGlobal('document', lockTarget))

  const at = options.path ?? '/admin'
  const route = Vue.reactive<RouteState>({ path: at.split('?')[0]!, fullPath: at, name: options.name ?? 'admin' })
  const toasts: Toast[] = []
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type => [type, (message: string) => { toasts.push({ type, message }) }]))
  const asyncKeys: string[] = []
  const { useAdminAuth } = await import('../app/composables/useAdminAuth.ts')

  const layout = await mountSfc(LAYOUT, {
    suspense: true,
    auto: {
      ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
      onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted, onBeforeUnmount: Vue.onBeforeUnmount,
      useAsyncData: fakeUseAsyncData(asyncKeys),
      useAdminAuth,
      useRoute: () => route,
      useToast: () => toast,
    },
    modules: {
      vue: { ...VUE_FOR_SFC, Transition: TransitionStandIn },
    },
  })

  let open = true
  const close = () => {
    if (!open) return
    open = false
    layout.unmount()
    for (const undo of restore.reverse()) undo()
  }
  t.after(close)

  const user = useState<LayoutUser | null>('admin_user', () => null)
  const lock = () => ({ body: lockTarget.body.style.overflow ?? '', html: lockTarget.documentElement.style.overflow ?? '', touch: lockTarget.body.style.touchAction ?? '' })
  const mount = (MOUNTS.get(t) ?? 0) + 1
  MOUNTS.set(t, mount)
  let step = 0
  const settle = async () => {
    await settleOnly()
    if (DOM_LOG) {
      appendFileSync(DOM_LOG, `${JSON.stringify({ test: t.fullName, step: `${mount}.${step++}`, html: layout.html(), calls: sent(calls), toasts, navigations, lock: lock() })}\n`)
    }
  }
  /** Move the route the way a navigation does (path, fullPath and name together). */
  const go = async (to: string, name?: string) => {
    route.fullPath = to
    route.path = to.split('?')[0]!
    route.name = name
    await settle()
  }
  return { layout, server, calls, toasts, navigations, route, user, asyncKeys, lock, doc: lockTarget, settle, go, close }
}
export type LayoutCtx = Awaited<ReturnType<typeof mountLayout>>

export async function openLayout(t: TestContext, options: MountOptions = {}, server = adminLayoutServer()) {
  const ctx = await mountLayout(t, server, options)
  await ctx.settle()
  return ctx
}

// ─── Reading and driving the layout ──────────────────────────────────────────

export const root = (from: MiniElement | MountedSfc) => ('root' in from ? from.root : from)
const classOf = (el: MiniElement) => String(el.props.class ?? '')
export const hasClass = (el: MiniElement, name: string) => classOf(el).split(/\s+/).includes(name)
export const one = (found: MiniElement[], what: string): MiniElement => {
  if (found.length !== 1) throw new Error(`expected one ${what}, found ${found.length}`)
  return found[0]!
}
export const sidebar = (ctx: LayoutCtx) => one(findAll(ctx.layout.root, el => el.tag === 'aside'), '<aside>')
export const topbar = (ctx: LayoutCtx) => one(findAll(ctx.layout.root, el => el.tag === 'header'), '<header>')
export const nav = (ctx: LayoutCtx) => one(findAll(ctx.layout.root, el => el.tag === 'nav'), '<nav>')
export const mainContent = (ctx: LayoutCtx) => one(findAll(ctx.layout.root, el => el.tag === 'div' && hasClass(el, 'main-content')), '.main-content')
export const backdrops = (ctx: LayoutCtx) => findAll(ctx.layout.root, el => el.tag === 'div' && classOf(el).startsWith('fixed inset-0'))
export const container = (ctx: LayoutCtx) => one(findAll(ctx.layout.root, el => el.tag === 'div' && el.props.style !== undefined && classOf(el).startsWith('mx-auto')), 'page container')

/** Every menu link in the sidebar `<nav>`, in order: label (its `title`) and target. */
export const menuLinks = (ctx: LayoutCtx) => findAll(nav(ctx), el => el.tag === 'nuxt-link')
export const menuLabels = (ctx: LayoutCtx) => menuLinks(ctx).filter(isVisible).map(el => String(el.props.title))
export const menuLink = (ctx: LayoutCtx, label: string) => one(menuLinks(ctx).filter(el => el.props.title === label), `menu link "${label}"`)
/** Inside a `v-show="false"` ancestor (a closed accordion) counts as not visible. */
export function isVisible(el: MiniElement): boolean {
  for (let current: MiniElement | null = el; current; current = current.parent) if (!isShown(current)) return false
  return true
}
/** Group headings the sidebar shows (flat groups' titles and the accordion's button), in order. */
export const groupTitles = (ctx: LayoutCtx) => findAll(nav(ctx), el =>
  (el.tag === 'div' && classOf(el).startsWith('text-[0.66rem] uppercase')) || (el.tag === 'button' && el.props['aria-expanded'] !== undefined))
  .map(el => (el.tag === 'button' ? textOf(findAll(el, s => s.tag === 'span' && !hasClass(s, 'flex'))[0]!) : textOf(el)))
export const accordionButton = (ctx: LayoutCtx) => one(findAll(nav(ctx), el => el.tag === 'button' && el.props['aria-expanded'] !== undefined), 'accordion button')
export const searchInput = (ctx: LayoutCtx) => one(findAll(sidebar(ctx), el => el.tag === 'input'), 'search input')
export const buttonByTitle = (from: MiniElement, title: string) => one(findAll(from, el => el.tag === 'button' && el.props.title === title), `button titled "${title}"`)
export const buttonByText = (from: MiniElement, text: string) => byText(from, 'button', text)
export const linksTo = (from: MiniElement, to: string) => findAll(from, el => el.tag === 'nuxt-link' && el.props.to === to)
/** Text nodes, each trimmed, joined by one space — the template is compiled with whitespace condensed. */
export function words(from: MiniElement): string {
  const out: string[] = []
  const walk = (node: MiniElement['children'][number]) => {
    if (node.kind === 'text') { const text = node.text.replace(/\s+/g, ' ').trim(); if (text) out.push(text) }
    else if (node.kind === 'element') node.children.forEach(walk)
  }
  from.children.forEach(walk)
  return out.join(' ')
}
export const lastToast = (toasts: Toast[], type: string) => toasts.filter(x => x.type === type).at(-1)?.message
/** Every element carrying a keyboard listener. */
export const keyListeners = (ctx: LayoutCtx) => findAll(ctx.layout.root, el => Object.keys(el.props).some(key => /^onKey/.test(key)))

export { findAll, textOf, isShown }
