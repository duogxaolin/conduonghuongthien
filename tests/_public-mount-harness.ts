/**
 * Mount ONE public view (a page, a layout, a block, a widget) for real — `<script setup>` and
 * template through tests/_sfc-mount.ts — over REAL ofetch on a fake network, with a recording
 * `useAsyncData`. Built for wave3 D-FETCH lot G, to show that moving a call site from a
 * `$fetch` cast to `publicFetch<T>()` changed nothing a visitor or the SSR cache can see:
 *   - the requests on the wire (method, path, query, JSON body) and WHERE each was made:
 *     inside a `useAsyncData` handler (server-rendered, carried in the payload) or anywhere
 *     else (after mount, a click: the browser only) — `NetCall.via`;
 *   - every `useAsyncData` registration: its key, `lazy`, `server`, `immediate`, `default()`,
 *     how many `watch` sources, `getCachedData` — the flags that decide SSR vs client-only;
 *   - what renders, for a good answer and for a failed one.
 * The SAME suite runs on the base tree (casts) and on lot G; the proof directory keeps both.
 *
 * Nuxt is stood in for thinly, after `node_modules/nuxt/dist/app/composables/asyncData.js`
 * (4.6.1), like tests/_news-page-harness.ts: a reactive key (function) is watched with
 * `flush: 'sync'` and a change re-runs the handler; `options.watch` re-runs it too; a newer
 * run wins; a failed run sets `error` and resets `data` to `default()`; `pending` is
 * `status === 'pending'`; the result is awaitable (`await useAsyncData(…)`).
 * `useI18n` is the fallback dictionary with a `currentLang` ref the test sets; `useRoute`
 * a reactive `{ path, params, query }`; `useSeoMeta`/`useHead` and `useSsrFailureStatus`
 * are recorded. Components the view does not import render as plain elements with props.
 */
import { existsSync, readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary.ts'
import { errorMessage, errorStatus } from '../app/utils/errorMessage.ts'
import { findAll, mountSfc, textOf, type MiniElement, type MountedSfc } from './_sfc-mount.ts'

const APP = fileURLToPath(new URL('../app/', import.meta.url))

/**
 * The real `publicFetch`, for views that call it as a Nuxt auto-import. Loaded optionally:
 * the same suites run on the tree BEFORE lot G (proof of "nothing changed"), where the
 * module does not exist and no view calls it.
 */
const publicFetch: unknown = await import('../app/composables/publicFetch.ts')
  .then(module => (module as { publicFetch: unknown }).publicFetch, () => undefined)

// ─── Fake network under real ofetch ──────────────────────────────────────────

export type NetCall = {
  method: string
  url: URL
  body: unknown
  /**
   * Where the request was made: `asyncData` — inside a `useAsyncData` handler (rendered on
   * the server, carried to the browser in the payload); `direct` — anywhere else (after
   * mount, an event handler: the browser only). Read from the CALL of `$fetch`, so a retry
   * of the same request keeps it.
   */
  via: 'asyncData' | 'direct'
  /** `keepalive` as ofetch handed it to `fetch` (a beacon that may outlive the page). */
  keepalive?: boolean
  respond: (response: Response) => void
  fail: (error: Error) => void
}
export const HOLD = Symbol('hold')
export type Answer = Response | Error | typeof HOLD | undefined
export type Responder = (call: NetCall) => Answer

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 202: 'Accepted', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable' }
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })
/** What `throw createError({ statusCode, statusMessage })` sends. */
export const h3Error = (statusCode: number, statusMessage: string) =>
  new Response(JSON.stringify({ statusCode, statusMessage, message: statusMessage }), {
    status: statusCode,
    statusText: statusMessage.replace(/[^\t\x20-\x7E]/g, ''),
    headers: { 'content-type': 'application/json' },
  })
export const dropped = () => new TypeError('fetch failed')
export const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`
/** Wire lines (with where they were made) and the JSON body for requests that sent one. */
export const sent = (calls: NetCall[]) =>
  calls.map(call => (call.body === undefined ? `${call.via}: ${wire(call)}` : { at: `${call.via}: ${wire(call)}`, body: call.body }))
export const OFETCH_LINE = /\[(GET|POST|PUT|PATCH|DELETE)\]|<no response>|fetch failed/

/** Routes keyed `'GET /api/x'`; an unknown route is a 404 the test sees in `sent(calls)`. */
export function routes(table: Record<string, (call: NetCall) => Answer>): Responder {
  return (call) => {
    const route = table[`${call.method} ${call.url.pathname}`]
    return route ? route(call) : json({ statusCode: 404, statusMessage: 'Not Found' }, 404)
  }
}

// ─── useAsyncData, recorded ──────────────────────────────────────────────────

export type AsyncRegistration = {
  key: string
  lazy?: boolean
  server?: boolean
  immediate?: boolean
  /** `JSON.stringify(default())`, or `undefined` without a default. */
  default?: string
  watch: number
  getCachedData: boolean
}
type AsyncOptions = {
  default?: () => unknown
  watch?: Vue.WatchSource[]
  lazy?: boolean
  server?: boolean
  immediate?: boolean
  getCachedData?: unknown
}

/** > 0 while a `useAsyncData` handler runs its synchronous part (where the request is made). */
let inAsyncHandler = 0

function fakeUseAsyncData(registrations: AsyncRegistration[], liveKeys: Array<() => string>) {
  return (keyArg: string | (() => string), handler: () => Promise<unknown>, options: AsyncOptions = {}) => {
    const key = typeof keyArg === 'function' ? Vue.computed(keyArg) : Vue.computed(() => keyArg)
    liveKeys.push(() => key.value)
    registrations.push({
      key: key.value,
      lazy: options.lazy,
      server: options.server,
      immediate: options.immediate,
      default: options.default ? JSON.stringify(options.default()) : undefined,
      watch: options.watch?.length ?? 0,
      getCachedData: typeof options.getCachedData === 'function',
    })
    const data = Vue.shallowRef<unknown>(options.default ? options.default() : undefined)
    const error = Vue.shallowRef<unknown>(undefined)
    const status = Vue.shallowRef<'idle' | 'pending' | 'success' | 'error'>('idle')
    const pending = Vue.computed(() => status.value === 'pending')
    let current: Promise<void> | null = null
    const execute = (): Promise<void> => {
      status.value = 'pending'
      const run: Promise<void> = Promise.resolve()
        .then(() => {
          inAsyncHandler += 1
          try {
            return handler()
          } finally {
            inAsyncHandler -= 1
          }
        })
        .then((value) => {
          if (current !== run) return
          data.value = value
          error.value = undefined
          status.value = 'success'
        }, (err: unknown) => {
          if (current !== run) return
          error.value = err
          data.value = options.default ? options.default() : undefined
          status.value = 'error'
        })
      current = run
      return run
    }
    let keyChanging = false
    if (typeof keyArg === 'function') {
      Vue.watch(key, (next, prev) => {
        if (next === prev) return
        keyChanging = true
        void execute()
        Vue.queuePostFlushCb(() => { keyChanging = false })
      }, { flush: 'sync' })
    }
    if (options.watch) Vue.watch(options.watch, () => { if (!keyChanging) void execute() })
    if (options.immediate !== false) void execute()
    const result = { data, pending, error, status, refresh: execute, execute, clear: () => { data.value = options.default?.() } }
    // Awaiting it waits for the first run, as Nuxt does for a non-lazy call on the server.
    const first = current ?? Promise.resolve()
    return Object.assign(first.then(() => result), result)
  }
}

// ─── Mounting ────────────────────────────────────────────────────────────────

export async function settle(): Promise<void> {
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

export interface PublicMountOptions {
  /** `app/`-relative path; `<NAME>_FILE`-style override is the caller's (see `fileFor`). */
  file: string
  responder: Responder
  props?: Record<string, unknown>
  route?: { path?: string, params?: Record<string, string>, query?: Record<string, unknown> }
  lang?: string
  modules?: Record<string, Record<string, unknown>>
  auto?: Record<string, unknown>
  components?: Record<string, Vue.Component>
  suspense?: boolean
  importMeta?: { server: boolean, client: boolean }
  /** Globals the view reads (`window`, `document`, `localStorage`…), restored after the test. */
  globals?: Record<string, unknown>
}

export type SsrStatusCall = { failed: boolean, notFound?: boolean }

export async function mountPublic(t: TestContext, options: PublicMountOptions) {
  const calls: NetCall[] = []
  const restore: Restore[] = []
  const VIA = 'x-lot-g-via'
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://portal.test'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      via: new Headers(init.headers).get(VIA) === 'asyncData' ? 'asyncData' : 'direct',
      keepalive: init.keepalive,
      respond: resolve,
      fail: reject,
    }
    calls.push(call)
    // As a browser does: an aborted request (ofetch's `timeout`, a caller's `signal`) rejects.
    init.signal?.addEventListener('abort', () => reject(init.signal!.reason ?? new DOMException('Aborted', 'AbortError')), { once: true })
    const answer = options.responder(call)
    if (answer === HOLD) return
    if (answer instanceof Error) reject(answer)
    else if (answer) resolve(answer)
    else resolve(json({ statusCode: 404, statusMessage: 'Not Found' }, 404))
  })
  const real = createFetch({ fetch: fetchImpl as typeof fetch })
  // Tag each CALL with where it was made (a header only the fake network reads; the caller's
  // options object is copied, never changed).
  const tagged = (url: string, opts: Record<string, unknown> = {}) => real(url, {
    ...opts,
    headers: { ...(opts.headers as Record<string, string> | undefined), [VIA]: inAsyncHandler > 0 ? 'asyncData' : 'direct' },
  })
  restore.push(replaceGlobal('$fetch', tagged))
  for (const [name, value] of Object.entries(options.globals ?? {})) restore.push(replaceGlobal(name, value))

  const route = Vue.reactive({ path: options.route?.path ?? '/', params: { ...(options.route?.params ?? {}) }, query: { ...(options.route?.query ?? {}) } })
  const navigations: unknown[] = []
  const registrations: AsyncRegistration[] = []
  const liveKeys: Array<() => string> = []
  const useAsyncData = fakeUseAsyncData(registrations, liveKeys)
  const currentLang = Vue.ref(options.lang ?? 'vi')
  const t_ = (key: string): string => hardcodedDictionary[currentLang.value]?.[key] || hardcodedDictionary.vi?.[key] || key
  const i18n = { t: t_, currentLang, locales: Vue.computed(() => []), setLang: (lang: string) => { currentLang.value = lang } }
  const seo: Array<Record<string, unknown>> = []
  const heads: unknown[] = []
  const ssrStatus: Array<{ settled: () => unknown, failed: () => boolean, notFound?: () => boolean }> = []
  const state = new Map<string, Vue.Ref<unknown>>()
  // Recorded on the globals too: a composable imported for real (usePublicArticleList)
  // reaches `useAsyncData`/`useRoute`/`navigateTo` as bare globals, like Nuxt's auto-imports.
  const navigateTo = (to: unknown) => { navigations.push(to); return Promise.resolve() }
  restore.push(replaceGlobal('useAsyncData', useAsyncData))
  restore.push(replaceGlobal('useRoute', () => route))
  restore.push(replaceGlobal('navigateTo', navigateTo))

  const useSsrFailureStatus = (settled: () => unknown, failed: () => boolean, extra: { notFound?: () => boolean } = {}) => {
    ssrStatus.push({ settled, failed, notFound: extra.notFound })
  }
  const auto: Record<string, unknown> = {
    ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, watchEffect: Vue.watchEffect,
    nextTick: Vue.nextTick, shallowRef: Vue.shallowRef, onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted,
    onBeforeUnmount: Vue.onBeforeUnmount, toRef: Vue.toRef, unref: Vue.unref, useId: Vue.useId,
    useAsyncData,
    useRoute: () => route,
    useRouter: () => ({ push: navigateTo, replace: navigateTo }),
    navigateTo,
    useSeoMeta: (input: Record<string, unknown>) => { seo.push(input) },
    useHead: (input: unknown) => { heads.push(input) },
    definePageMeta: () => {},
    useI18n: () => i18n,
    useSsrFailureStatus,
    useState: <T>(key: string, init?: () => T) => {
      if (!state.has(key)) state.set(key, Vue.ref(init ? init() : undefined))
      return state.get(key) as Vue.Ref<T>
    },
    createError: (input: { statusCode?: number, statusMessage?: string }) => Object.assign(new Error(input.statusMessage ?? 'error'), input),
    errorMessage,
    errorStatus,
    // Nuxt auto-imports `composables/*.ts`: a view may call it without importing it (the
    // public layout does, to keep its line count). The real one, over the global above.
    publicFetch,
    ...options.auto,
  }
  const modules: Record<string, Record<string, unknown>> = {
    '~/composables/useI18n': { useI18n: () => i18n },
    '~/composables/useSsrFailureStatus': { useSsrFailureStatus },
    'vue-router': { useRoute: () => route, useRouter: () => ({ push: navigateTo, replace: navigateTo }) },
    ...options.modules,
  }

  const file = path.isAbsolute(options.file) ? options.file : path.join(APP, options.file)
  const page = await mountSfc(file, {
    auto,
    modules,
    components: options.components,
    suspense: options.suspense,
    importMeta: options.importMeta ?? { server: false, client: true },
  }, options.props)
  let open = true
  const close = () => {
    if (!open) return
    open = false
    page.unmount()
    for (const undo of restore.reverse()) undo()
  }
  t.after(close)

  const seoNow = () => Object.assign({}, ...seo.map(input => Object.fromEntries(Object.entries(input)
    .map(([k, v]) => [k, typeof v === 'function' ? (v as () => unknown)() : Vue.unref(v)]))))
  const keys = () => liveKeys.map(read => read())
  return { page, calls, registrations, keys, route, navigations, currentLang, seo: seoNow, heads, ssrStatus, state, settle, close }
}
export type PublicMount = Awaited<ReturnType<typeof mountPublic>>

/** A component that renders nothing (a child the view under test only passes props to). */
export const Stub = Vue.defineComponent({ inheritAttrs: false, setup: () => () => null })

// ─── Loading a composable Node cannot import as is ───────────────────────────

const IMPORT_FROM = /^import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"];?/gm

/**
 * Evaluate one `app/` module the way the Nuxt build would, for a composable that imports
 * `#imports` or a `~/` path (useI18n, useLiveSearch): types stripped, `import.meta.server` /
 * `client` replaced, each import taken from `modules` when given there, else loaded for real
 * (`~/` and relative paths from disk). A fresh evaluation each call — fresh module state.
 * Nuxt auto-imports the module uses bare (`useState`, `navigateTo`) come from `names`.
 */
export async function loadAppModule(
  file: string,
  options: { modules?: Record<string, Record<string, unknown>>, importMeta?: { server: boolean, client: boolean }, names?: Record<string, unknown> } = {},
): Promise<Record<string, unknown>> {
  const absolute = path.isAbsolute(file) ? file : path.join(APP, file)
  const meta = options.importMeta ?? { server: false, client: true }
  const code = stripTypeScriptTypes(readFileSync(absolute, 'utf8'))
    .replace(/\bimport\.meta\.(server|client|dev)\b/g, (_m, flag: 'server' | 'client' | 'dev') => String(flag === 'dev' ? false : meta[flag]))
  const modules: Record<string, unknown> = {}
  for (const [, , from] of code.matchAll(IMPORT_FROM)) {
    if (modules[from!]) continue
    if (options.modules?.[from!]) { modules[from!] = options.modules[from!]; continue }
    if (from!.startsWith('~/') || from!.startsWith('.')) {
      const base = from!.startsWith('~/') ? path.join(APP, from!.slice(2)) : path.resolve(path.dirname(absolute), from!)
      const target = existsSync(base) ? base : `${base}.ts`
      modules[from!] = await import(pathToFileURL(target).href)
    } else {
      modules[from!] = await import(from!)
    }
  }
  const exported = [...code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/gm)].map(match => match[1]!)
  // `export default <expr>` (a Nuxt plugin) becomes `default` of the result.
  if (/^export\s+default\s/m.test(code)) exported.push('default: __default')
  const body = code
    .replace(/^export\s+default\s/m, 'const __default = ')
    .replace(IMPORT_FROM, (_m, clause: string, from: string) => {
      const named = /^\{([^}]*)\}$/.exec(clause.trim())
      if (named) return `const {${named[1]!.replace(/\s+as\s+/g, ': ')}} = __modules[${JSON.stringify(from)}];`
      if (/^\w+$/.test(clause.trim())) return `const ${clause.trim()} = __modules[${JSON.stringify(from)}].default;`
      if (!clause.trim()) return ''
      throw new Error(`${file}: unsupported import clause \`${clause}\``)
    })
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let)\s)/gm, '')
  const names = Object.entries(options.names ?? {})
  return new Function('__modules', ...names.map(([name]) => name), `${body}\nreturn { ${exported.join(', ')} }`)(modules, ...names.map(([, value]) => value)) as Record<string, unknown>
}

// ─── Reading the screen ──────────────────────────────────────────────────────

const rootOf = (from: MiniElement | MountedSfc) => ('root' in from ? from.root : from)
/** Text nodes trimmed and joined by one space (the compiled template drops whitespace between tags). */
export function words(from: MiniElement | MountedSfc): string {
  const out: string[] = []
  const walk = (node: MiniElement['children'][number]) => {
    if (node.kind === 'text') out.push(node.text.replace(/\s+/g, ' ').trim())
    else if (node.kind === 'element') node.children.forEach(walk)
  }
  walk(rootOf(from))
  return out.filter(Boolean).join(' ')
}
export const alerts = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'alert')
export const busy = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'status' && el.props['aria-busy'] === 'true')
export const byTag = (from: MiniElement | MountedSfc, tag: string) => findAll(rootOf(from), el => el.tag === tag)
export const buttons = (from: MiniElement | MountedSfc, text: string) => findAll(rootOf(from), el => el.tag === 'button' && textOf(el).includes(text))
export { textOf }
