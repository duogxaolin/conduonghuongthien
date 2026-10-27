/**
 * Mount a REAL admin page — `<script setup>` AND template, through tests/_sfc-mount.ts —
 * over REAL ofetch on a fake network, with the real `adminFetch`, `useAdminList`,
 * `errorMessage`, `formatDateTimeVN` and bulk-selection composables. Only the Nuxt
 * runtime pieces (`useToast`, `useConfirm`, `useAdminAuth`, `useRoute`, `useRouter`,
 * `window`, `document`) are stand-ins, and each one records what the page asked of it.
 *
 * Shared by the wave3 7.1 batch-B suites (tests/admin-fetch-rollout-*.test.ts): one copy
 * of the fake network instead of one per file. The shape is the one of
 * tests/admin-fetch-rollout-settings.test.ts and tests/admin-moderation-page.test.ts:
 *   - `installNetwork(responder)` replaces the `$fetch` global with a real ofetch whose
 *     `fetch` is the responder. A responder that returns `undefined` leaves the request
 *     pending until the test calls `call.respond(…)` — how the race tests order answers;
 *   - `h3Error` is what `throw createError({ statusCode, statusMessage })` sends: the
 *     sentence in the JSON body, and on the HTTP status line the same sentence with every
 *     non-ASCII character stripped (h3 `sanitizeStatusMessage`);
 *   - `OFETCH_LINE` is ofetch's own `[GET] "/api/…": 403 Forbidden` line, which must never
 *     reach a person (CLAUDE.md "Xử lý lỗi tầng giao diện").
 */
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { useAdminList } from '../app/composables/useAdminList.ts'
import { formatDateTimeVN } from '../app/utils/formatDate.ts'
import { errorMessage, errorStatus } from '../app/utils/errorMessage.ts'
import { findAll, mountSfc, textOf, type MiniElement, type MountedSfc } from './_sfc-mount.ts'

// ─── Fake network under real ofetch ──────────────────────────────────────────

export type NetCall = {
  method: string
  url: URL
  body: unknown
  /** Answer a request the responder left pending. */
  respond: (response: Response) => void
  fail: (error: Error) => void
}
export type Responder = (call: NetCall) => Response | Error | undefined

export function installNetwork(responder: Responder): NetCall[] {
  const calls: NetCall[] = []
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
    const answer = responder(call)
    if (answer instanceof Error) reject(answer)
    else if (answer) resolve(answer)
  })
  ;(globalThis as Record<string, unknown>).$fetch = createFetch({ fetch: fetchImpl as typeof fetch })
  return calls
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 503: 'Service Unavailable',
}
export const json = (body: unknown, status = 200, statusText = STATUS_TEXT[status] ?? '') =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } })
export const h3Error = (statusCode: number, statusMessage: string) =>
  json({ statusCode, statusMessage, message: statusMessage }, statusCode, statusMessage.replace(/[^\t\x20-\x7E]/g, ''))
/** A connection that never got an answer. */
export const dropped = () => new TypeError('fetch failed')
export const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`
/** Wire lines, with the JSON body for requests that sent one. */
export const sent = (calls: NetCall[], from = 0) =>
  calls.slice(from).map(call => (call.body === undefined ? wire(call) : { wire: wire(call), body: call.body }))
export const OFETCH_LINE = /\[(GET|POST|PUT|PATCH|DELETE)\]|<no response>|fetch failed/

/**
 * Routes keyed `'GET /api/x'`. A route answering `undefined` leaves the request pending
 * (the test answers it with `call.respond`); an unknown route is a 404 the test sees in
 * `wire(calls)`.
 */
export function routes(table: Record<string, (call: NetCall) => Response | Error | undefined>): Responder {
  return (call) => {
    const route = table[`${call.method} ${call.url.pathname}`]
    return route ? route(call) : json({ statusCode: 404, statusMessage: 'Not Found' }, 404)
  }
}

/** Let promise chains, ofetch and Vue's scheduler run (setImmediate: unaffected by mocked timers). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}

// ─── The bulk-selection composables, run for real ────────────────────────────

/**
 * app/composables/useBulkSelection.ts relies on Nuxt auto-imports (`ref`, `useToast`…)
 * and has no import of its own, so it cannot be `import`ed here: its source is compiled
 * with those names bound to this mount's stand-ins.
 */
const BULK_SOURCE = stripTypeScriptTypes(readFileSync(new URL('../app/composables/useBulkSelection.ts', import.meta.url), 'utf8'))
  .replace(/export function (\w+)/g, 'function $1')
type Bulk = { useBulkSelection: () => unknown, useBulkAction: (selection: unknown) => unknown }
function loadBulk(auto: Record<string, unknown>): Bulk {
  const names = ['ref', 'computed', 'useToast', 'useConfirm', 'errorMessage']
  return new Function(...names, `${BULK_SOURCE}\nreturn { useBulkSelection, useBulkAction }`)(...names.map(name => auto[name])) as Bulk
}

// ─── Mounting ────────────────────────────────────────────────────────────────

export type Toast = { type: string, message: string }
export type ConfirmRequest = { title?: string, message?: string, confirmLabel?: string, confirmText?: string, danger?: boolean }

export interface MountOptions {
  route?: { params?: Record<string, string>, query?: Record<string, unknown> }
  props?: Record<string, unknown>
  /** Permission check; every permission by default. */
  can?: (resource: string, action: string) => boolean
  user?: Record<string, unknown>
  /** Import specifiers replaced by stand-in modules (child components, the editor…). */
  modules?: Record<string, Record<string, unknown>>
  components?: Record<string, Vue.Component>
}

export interface MountedAdminPage {
  page: MountedSfc
  calls: NetCall[]
  toasts: Toast[]
  confirms: ConfirmRequest[]
  prompts: ConfirmRequest[]
  /** What `confirm()` / `prompt()` answer next. */
  answers: { confirm: boolean, prompt: string | null }
  pushes: unknown[]
  /** `window.open(url, target, features)` calls. */
  opened: unknown[][]
  /** Anchors the page created and clicked (`a.download` downloads). */
  downloads: Array<{ href: string, download: string }>
  lastToast: (type: string) => string | undefined
}

const MOUNTED: MountedSfc[] = []
/** Unmount every page this file mounted — `afterEach(unmountAll)`. */
export function unmountAll(): void {
  for (const page of MOUNTED.splice(0)) page.unmount()
}

/** `<ClientOnly>` as the server renders it: the fallback, never the client-only child. */
const ClientOnly = Vue.defineComponent({
  setup: (_props, { slots }) => () => slots.fallback?.() ?? null,
})

export async function mountAdminPage(file: string, responder: Responder, options: MountOptions = {}): Promise<MountedAdminPage> {
  const calls = installNetwork(responder)
  const toasts: Toast[] = []
  const confirms: ConfirmRequest[] = []
  const prompts: ConfirmRequest[] = []
  const answers = { confirm: true, prompt: '' as string | null }
  const pushes: unknown[] = []
  const opened: unknown[][] = []
  const downloads: Array<{ href: string, download: string }> = []
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type =>
    [type, (message: string) => { toasts.push({ type, message }) }]))

  const can = options.can ?? (() => true)
  const auto: Record<string, unknown> = {
    // Vue APIs the files use without importing them (Nuxt auto-imports).
    ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
    onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted, onBeforeUnmount: Vue.onBeforeUnmount,
    provide: Vue.provide, inject: Vue.inject,
    definePageMeta: () => {},
    useToast: () => toast,
    useConfirm: () => ({
      confirm: async (request: ConfirmRequest) => { confirms.push(request); return answers.confirm },
      prompt: async (request: ConfirmRequest) => { prompts.push(request); return answers.prompt },
    }),
    useAdminAuth: () => ({ user: Vue.ref({ id: 1, username: 'admin', isSuperAdmin: true, ...options.user }), hasPermission: can }),
    useRoute: () => ({ params: options.route?.params ?? {}, query: options.route?.query ?? {} }),
    useRouter: () => ({ push: (to: unknown) => { pushes.push(to) } }),
    errorMessage,
    errorStatus,
    adminFetch,
    useAdminList,
    formatDateTimeVN,
    // Timers go through the global at CALL time, so a test's mock.timers applies.
    window: {
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
      open: (...args: unknown[]) => { opened.push(args) },
    },
    document: {
      createElement: () => ({ href: '', download: '', click() { downloads.push({ href: this.href, download: this.download }) } }),
      body: { appendChild: () => {}, removeChild: () => {} },
    },
  }
  Object.assign(auto, loadBulk(auto))

  const page = await mountSfc(fileURLToPath(new URL(`../app/${file}`, import.meta.url)), {
    auto,
    modules: options.modules,
    components: { ClientOnly, ...options.components },
  }, options.props)
  // Idempotent, and remembered: `unmountAll()` (an `afterEach`) stops a failed test's
  // polling intervals, which would otherwise keep the test process alive.
  const unmount = page.unmount
  let gone = false
  page.unmount = () => { if (!gone) { gone = true; unmount() } }
  MOUNTED.push(page)
  await settle()
  const lastToast = (type: string) => toasts.filter(t => t.type === type).at(-1)?.message
  return { page, calls, toasts, confirms, prompts, answers, pushes, opened, downloads, lastToast }
}

/** A component that renders nothing — for children the page under test only passes props to. */
export const Stub = Vue.defineComponent({ inheritAttrs: false, setup: () => () => null })

/** A modal that renders its slots while `open` — what AdminModal shows, without Teleport/focus traps. */
export const OpenModal = Vue.defineComponent({
  props: { open: Boolean, title: String },
  setup: (props, { slots }) => () => (props.open
    ? Vue.h('div', { role: 'dialog', 'aria-label': props.title }, [slots.default?.(), slots.footer?.()])
    : null),
})

// ─── Reading the screen ──────────────────────────────────────────────────────

export const alerts = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'alert')
export const alertText = (page: MountedSfc) => alerts(page).map(textOf).join(' | ')
export const buttons = (from: MiniElement | MountedSfc, text: string) =>
  findAll('root' in from ? from.root : from, el => el.tag === 'button' && textOf(el).includes(text))
export const byTag = (from: MiniElement | MountedSfc, tag: string) => findAll('root' in from ? from.root : from, el => el.tag === tag)
export const screenText = (page: MountedSfc) => textOf(page.root)
