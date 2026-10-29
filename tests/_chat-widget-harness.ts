/**
 * Harness for tests/chat-widget-behavior.test.ts — the public chat widget
 * (`app/components/ChatWidget.vue`) with the REAL `useChatbot` behind it.
 *
 * Mounted on the minimal DOM of tests/_sfc-mount.ts: the widget's `<script setup>` and
 * template, every `.vue` it imports, the real `ChatMessageContent` and `ChatFollowUps`,
 * and the real composable over a fake network that answers like
 * `server/api/public/chatbot/**` (same shapes, same SSE frames, same status codes).
 *
 * Two things make the composable behave as it does in a browser, and both are scoped to
 * the files loaded for a mount (a `?chat-mount=N` tag on their URL), nothing else:
 *   - FRESH STATE PER MOUNT. `useChatbot` keeps its state at MODULE level (one transcript
 *     for the widget and `/assistant`). Each mount imports it under a new tag, and the
 *     resolve hook below hands the tag on to every file it imports in turn — so the
 *     storage helpers, the typewriter and any module the composable is made of start from
 *     a page load, whether the state lives in one file or several.
 *   - THE CLIENT BUILD. Nuxt compiles `import.meta.client` to `true` in the browser bundle;
 *     plain Node leaves it `undefined`, which would switch off `persist()`, `hydrate()` and
 *     the per-frame stream flush. The load hook below does what the client build does, for
 *     tagged files only.
 *
 * What the widget reaches outside Vue is stood in for, and restored after each test:
 *   - `fetch` / `$fetch` (real ofetch over the same fake network), `localStorage`;
 *   - `window` — keydown listeners (dispatch with `key()`), `matchMedia` (configurable per
 *     query; reduced motion ON by default so playback is instant and deterministic);
 *   - `document` — `activeElement` and `body.style`; `opener` is a stand-in for the control
 *     that had focus before the dialog opened (the bottom-nav button on a phone);
 *   - `requestAnimationFrame` — one frame per `setImmediate`, so `settle()` runs them;
 *   - `navigator.clipboard`, `crypto.randomUUID` (a counter), and the clock: `setTimeout`,
 *     `setInterval` and `Date` are node:test mock timers, so a test moves time with
 *     `tick(ms)` and nothing depends on the machine's speed or date.
 * `useChatAutoScroll` is a recorder (`scrolls`): it measures a real scroll box, which
 * tests/chatbot-mobile-smoothness.test.ts drives on a fake scroller; here the follow calls
 * the widget makes, their order, and that the two refs it was handed are wired, are what
 * is checked.
 * The dialog element is given the few DOM members `app/utils/focus-return.ts` reads
 * (`parentElement`, `children`, attributes, `querySelectorAll`, `contains`), so the REAL
 * inert/Tab-trap/focus-return code runs: `inert` shows up in `html()` on the elements it
 * marks, and every `focus()` / `inert` change is appended to `events`.
 *
 * Environment, for running the SAME suite against another version of the widget:
 *   CHAT_WIDGET_FILE=<file>         mount that file instead of app/components/ChatWidget.vue
 *   CHATBOT_COMPOSABLE_FILE=<file>  use that useChatbot.ts instead of app/composables/useChatbot.ts
 *   CHAT_WIDGET_DOM_LOG=<file>      after every `settle()`, append `{ test, step, html, calls,
 *                                   storage, overflow, events }` as one JSON line.
 */
import { appendFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary.ts'
import { findAll, loadSfc, mountSfc, textOf, type MiniElement, type MiniNode, type MountedSfc, type SfcEnv } from './_sfc-mount.ts'

export const WIDGET = process.env.CHAT_WIDGET_FILE
  ? path.resolve(process.env.CHAT_WIDGET_FILE)
  : fileURLToPath(new URL('../app/components/ChatWidget.vue', import.meta.url))
export const COMPOSABLE = process.env.CHATBOT_COMPOSABLE_FILE
  ? path.resolve(process.env.CHATBOT_COMPOSABLE_FILE)
  : fileURLToPath(new URL('../app/composables/useChatbot.ts', import.meta.url))
const DOM_LOG = process.env.CHAT_WIDGET_DOM_LOG ? path.resolve(process.env.CHAT_WIDGET_DOM_LOG) : null

// ─── Module hooks, for tagged files only ─────────────────────────────────────

const TAG = 'chat-mount'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context)
    const tag = context.parentURL?.startsWith('file:') ? new URL(context.parentURL).searchParams.get(TAG) : null
    if (!tag || !result.url.startsWith('file:') || result.url.includes('/node_modules/')) return result
    const url = new URL(result.url)
    if (url.searchParams.has(TAG)) return result
    url.searchParams.set(TAG, tag)
    return { ...result, url: url.href }
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (!url.startsWith('file:') || !new URL(url).searchParams.has(TAG) || result.source === undefined) return result
    return { ...result, source: String(result.source).replaceAll('import.meta.client', 'true') }
  },
})

let mounts = 0
async function freshComposable(): Promise<Record<string, unknown>> {
  mounts += 1
  const url = pathToFileURL(COMPOSABLE)
  url.searchParams.set(TAG, String(mounts))
  return await import(url.href) as Record<string, unknown>
}

// ─── Fake network ────────────────────────────────────────────────────────────

export type NetCall = {
  method: string
  url: URL
  headers: Record<string, string>
  body: unknown
  signal: AbortSignal | null
  respond: (response: Response) => void
  fail: (error: Error) => void
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 413: 'Payload Too Large', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' }
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })
export const abortError = () => new DOMException('The operation was aborted.', 'AbortError')
export const dropped = () => new TypeError('fetch failed')
export const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`

/** One content frame, as the endpoint writes a token. */
export const content = (text: string) => ({ choices: [{ delta: { content: text } }] })
/** The endpoint's closing metadata frame (`chatbot: { kind, sources, … }`). */
export const meta = (chatbot: Record<string, unknown>) => ({ choices: [{ delta: { content: '' } }], chatbot })

/**
 * An SSE body the test writes into frame by frame. Aborting the request errors the body
 * the way the browser does — a task later, not inside `abort()` — so `reader.read()`
 * rejects with an AbortError after whatever ran in the same turn as the abort.
 */
export function sseStream(signal: AbortSignal | null) {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  signal?.addEventListener('abort', () => {
    if (closed) return
    closed = true
    setImmediate(() => controller.error(abortError()))
  })
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    /** A frame object (`content()`, `meta()`, …) or raw text written as-is. */
    push(frame: Record<string, unknown> | string) {
      if (closed) return
      controller.enqueue(encoder.encode(typeof frame === 'string' ? frame : `data: ${JSON.stringify(frame)}\n\n`))
    },
    done() {
      if (closed) return
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      closed = true
      controller.close()
    },
    /** End the body without `[DONE]` (a proxy cutting the stream). */
    end() {
      if (closed) return
      closed = true
      controller.close()
    },
  }
}
export type SseStream = ReturnType<typeof sseStream>

/** A whole answer in one response: content frames, then the metadata frame, then `[DONE]`. */
export function answer(text: string | string[], chatbot: Record<string, unknown> = { kind: 'curated', sources: [] }) {
  return (call: NetCall) => {
    const stream = sseStream(call.signal)
    for (const piece of Array.isArray(text) ? text : [text]) stream.push(content(piece))
    stream.push(meta(chatbot))
    stream.done()
    return stream.response
  }
}

export const HOLD = Symbol('hold')
type Answer = Response | Error | typeof HOLD | undefined
type Handler = (call: NetCall) => Answer

export const QUICK_QUESTIONS = [
  { id: 1, question: 'Thủ tục xoá án tích như thế nào?' },
  { id: 2, question: 'Vay vốn sau khi ra tù?' },
  { id: '3', question: 'Học nghề miễn phí ở đâu?' },
]

export function chatServer() {
  const state = {
    /** Answers for `POST /api/public/chatbot`, used in order; a `HOLD` keeps the request open. */
    chat: [] as Handler[],
    quickQuestions: (() => json({ ok: true, available: true, items: QUICK_QUESTIONS })) as Handler,
    session: (() => json({ ok: true, token: 'tok.sig' })) as Handler,
    sources: ((call: NetCall) => {
      const id = Number(call.url.searchParams.get('id'))
      return json({ ok: true, source: { question: `Câu hỏi mục ${id}?`, answer: `Nội dung đã phê duyệt của mục ${id}.` } })
    }) as Handler,
    lead: (() => json({ ok: true })) as Handler,
    /** Requests left open (`HOLD`), oldest first. */
    held: [] as NetCall[],
  }
  const route = (call: NetCall): Answer => {
    const at = `${call.method} ${call.url.pathname}`
    if (at === 'POST /api/public/chatbot/session') return state.session(call)
    if (at === 'GET /api/public/chatbot/quick-questions') return state.quickQuestions(call)
    if (at === 'GET /api/public/chatbot/sources') return state.sources(call)
    if (at === 'POST /api/public/chatbot/lead') return state.lead(call)
    if (at === 'POST /api/public/chatbot') {
      const next = state.chat.shift()
      if (!next) throw new Error('unexpected chat request: queue an answer in server.state.chat')
      return next(call)
    }
    throw new Error(`unexpected request ${wire(call)}`)
  }
  return { state, route }
}
export type ChatServer = ReturnType<typeof chatServer>

// ─── The few DOM members focus-return.ts reads ───────────────────────────────

type Logged = (event: string) => void

const tagName = (el: MiniElement) => el.tag.toUpperCase()
const present = (value: unknown) => value !== undefined && value !== null && value !== false
const isInside = (node: MiniElement, ancestor: MiniElement) => {
  for (let current: MiniElement | null = node; current; current = current.parent) if (current === ancestor) return true
  return false
}
/** A short name for a control in the event log: `button "Gửi"`, `input#public-chatbot-input`. */
export const describe = (el: MiniElement) =>
  `${el.tag}${typeof el.props.id === 'string' ? `#${el.props.id}` : ''}${textOf(el) ? ` "${textOf(el).slice(0, 30)}"` : ''}${typeof el.props['aria-label'] === 'string' ? ` [${el.props['aria-label']}]` : ''}`

function isTabbable(el: MiniElement): boolean {
  if (present(el.props.disabled)) return false
  if (el.tag === 'a') return present(el.props.href)
  if (el.tag === 'input') return el.props.type !== 'hidden' && String(el.props.tabindex) !== '-1'
  if (['button', 'select', 'textarea', 'summary'].includes(el.tag)) return String(el.props.tabindex) !== '-1'
  return present(el.props.tabindex) && String(el.props.tabindex) !== '-1'
}

/**
 * Element-shaped views of the mini DOM. A tabbable's `focus()` moves `activeElement` to it
 * (the mini element's own `focus()` is a fixed no-op), and the view is cached so
 * `indexOf(document.activeElement)` in the Tab trap finds it again. `adopt(el)` makes an
 * element its own view (the dialog: `inertOutside` compares the siblings it walks with the
 * element it was given).
 */
function domViews(doc: FakeDocument, log: Logged) {
  const views = new WeakMap<MiniElement, Record<string, unknown>>()
  const view = (el: MiniElement): Record<string, unknown> => {
    const cached = views.get(el)
    if (cached) return cached
    const v: Record<string, unknown> = {
      el,
      get tagName() { return tagName(el) },
      get parentElement() { return el.parent ? view(el.parent) : null },
      get children() { return el.children.filter((c): c is MiniElement => c.kind === 'element').map(view) },
      get childElementCount() { return el.children.filter(c => c.kind === 'element').length },
      get textContent() { return textOf(el) },
      get tabIndex() { return present(el.props.tabindex) ? Number(el.props.tabindex) : 0 },
      offsetParent: {},
      getClientRects: () => ({ length: 1 }),
      hasAttribute: (name: string) => present(el.props[name]),
      getAttribute: (name: string) => (present(el.props[name]) ? String(el.props[name]) : null),
      setAttribute: (name: string, value: string) => { el.props[name] = value; log(`${name} set on ${describe(el).slice(0, 40)}`) },
      removeAttribute: (name: string) => { delete el.props[name]; log(`${name} removed from ${describe(el).slice(0, 40)}`) },
      querySelectorAll: () => findAll(el.children, isTabbable).map(view),
      contains: (other: unknown) => {
        const target = (other as { el?: MiniElement } | null)?.el
        return Boolean(target && isInside(target, el))
      },
      focus: () => { doc.activeElement = v; log(`focus ${describe(el)}`) },
    }
    views.set(el, v)
    return v
  }
  /** Give `el` itself the view's DOM members (read through), and make it its own view. */
  const adopt = (el: MiniElement) => {
    if (views.get(el) === (el as unknown)) return
    const v = view(el)
    for (const key of ['tagName', 'parentElement', 'childElementCount', 'textContent', 'hasAttribute', 'getAttribute', 'setAttribute', 'removeAttribute', 'querySelectorAll', 'contains']) {
      Object.defineProperty(el, key, { get: () => v[key], configurable: true, enumerable: false })
    }
    views.set(el, el as unknown as Record<string, unknown>)
  }
  return { view, adopt }
}

type FakeDocument = { activeElement: unknown, body: { style: Record<string, string> } }

// ─── Mounting the widget ─────────────────────────────────────────────────────

async function settleOnly() {
  for (let i = 0; i < 16; i++) {
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

export type MountOptions = {
  local?: Record<string, string>
  /** `route.path`; the launcher hides on `/assistant`. */
  path?: string
  /** `matchMedia(query).matches` per query; unlisted queries are `false`. */
  media?: Record<string, boolean>
  /** `window.visualViewport`, for the phone keyboard. */
  viewport?: { height: number, offsetTop: number }
}

/** The clock every test starts at (node:test mock timers). */
export const NOW = Date.UTC(2026, 9, 29, 3, 0, 0)

const MOUNT_STEPS = new WeakMap<TestContext, number>()
const CLOCKED = new WeakSet<TestContext>()

export async function mountChat(t: TestContext, server = chatServer(), options: MountOptions = {}) {
  // One clock per test, shared by every mount in it.
  if (!CLOCKED.has(t)) t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW })
  CLOCKED.add(t)

  const calls: NetCall[] = []
  const events: string[] = []
  const log: Logged = event => { events.push(event) }
  const restore: Restore[] = []

  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((value, key) => { headers[key] = value })
    const call: NetCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://portal.test'),
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      signal: init.signal ?? null,
      respond: resolve,
      fail: reject,
    }
    calls.push(call)
    if (call.signal?.aborted) return reject(abortError())
    call.signal?.addEventListener('abort', () => reject(abortError()))
    const answer = server.route(call)
    if (answer === HOLD) { server.state.held.push(call); return }
    if (answer instanceof Error) reject(answer)
    else if (answer) resolve(answer)
  })
  restore.push(replaceGlobal('fetch', fetchImpl))
  restore.push(replaceGlobal('$fetch', createFetch({ fetch: fetchImpl as typeof fetch })))

  const local = memoryStorage(options.local)
  restore.push(replaceGlobal('localStorage', local))

  const media: Record<string, boolean> = { '(prefers-reduced-motion: reduce)': true, ...options.media }
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const visualViewport = options.viewport
    ? { ...options.viewport, addEventListener: () => {}, removeEventListener: () => {} }
    : undefined
  const win = {
    location: { href: `http://portal.test${options.path ?? '/'}` },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => { listeners.get(type)?.delete(fn) },
    matchMedia: (query: string) => ({ matches: media[query] === true, media: query }),
    visualViewport,
  }
  restore.push(replaceGlobal('window', win))

  const body = { style: { overflow: '' } as Record<string, string> }
  const opener = { isConnected: true, focus: () => { doc.activeElement = opener; log('focus opener') } }
  const doc: FakeDocument = { activeElement: body, body }
  restore.push(replaceGlobal('document', doc))

  const frames = new Map<number, ReturnType<typeof setImmediate>>()
  let frameId = 0
  restore.push(replaceGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
    const id = ++frameId
    frames.set(id, setImmediate(() => { frames.delete(id); cb(0) }))
    return id
  }))
  restore.push(replaceGlobal('cancelAnimationFrame', (id: number) => {
    const handle = frames.get(id)
    if (handle) clearImmediate(handle)
    frames.delete(id)
  }))

  const clipboard: string[] = []
  restore.push(replaceGlobal('navigator', { clipboard: { writeText: async (text: string) => { clipboard.push(text) } } }))

  let uuid = 0
  const crypto = globalThis.crypto as unknown as Record<string, unknown>
  Object.defineProperty(crypto, 'randomUUID', { value: () => `uuid-${++uuid}`, configurable: true, writable: true })
  restore.push(() => { delete crypto.randomUUID })

  const route = Vue.reactive({ path: options.path ?? '/' })
  const navigations: string[] = []
  const translate = (key: string): string => hardcodedDictionary.vi?.[key] || key

  // `useChatAutoScroll` measures a real scroll box (tests/chatbot-mobile-smoothness.test.ts
  // runs it on a fake scroller). Here it is a recorder: which follow calls the widget makes,
  // and in what order, is the behaviour under test — and the refs it was given are checked.
  const scrolls: string[] = []
  const autoScroll = {
    useChatAutoScroll: (container: Vue.Ref<MiniElement | null>, content: Vue.Ref<MiniElement | null>) => {
      const isPinnedToBottom = Vue.ref(true)
      const wired = () => (container.value?.tag === 'div' && content.value?.tag === 'div' && content.value.parent === container.value ? '' : ' (refs not wired)')
      return {
        isPinnedToBottom,
        pinToBottom: () => { isPinnedToBottom.value = true; scrolls.push(`pin${wired()}`) },
        followLatestQuestion: () => { isPinnedToBottom.value = true; scrolls.push('follow-question') },
        releaseAnchor: () => { scrolls.push('release-anchor') },
      }
    },
  }

  const composable = await freshComposable()
  const env: SfcEnv = {
    auto: {
      computed: Vue.computed,
      useRoute: () => route,
      navigateTo: (to: string) => { navigations.push(to); log(`navigate ${to}`) },
    },
    modules: {
      '~/composables/useChatbot': composable,
      '~/composables/useI18n': { useI18n: () => ({ t: translate, currentLang: Vue.ref('vi') }) },
      '~/composables/useChatAutoScroll': autoScroll,
    },
  }
  const components = {
    ChatMessageContent: await loadSfc(fileURLToPath(new URL('../app/components/ChatMessageContent.vue', import.meta.url)), env),
    ChatFollowUps: await loadSfc(fileURLToPath(new URL('../app/components/ChatFollowUps.vue', import.meta.url)), env),
  }
  const widget = await mountSfc(WIDGET, { ...env, components })

  let open = true
  const close = () => {
    if (!open) return
    open = false
    widget.unmount()
    for (const undo of restore.reverse()) undo()
  }
  t.after(close)

  const { adopt } = domViews(doc, log)
  /**
   * The dialog, given the DOM members focus-return.ts reads (after the widget mounted).
   * Its `children` stays the mini DOM's own list (the renderer owns it); `inertOutside`
   * only reads `children` on the dialog's ancestors, which are views.
   */
  const decorate = () => {
    const dialog = dialogOf(widget)
    if (dialog) adopt(dialog)
  }

  const mount = (MOUNT_STEPS.get(t) ?? 0) + 1
  MOUNT_STEPS.set(t, mount)
  let step = 0
  const settle = async () => {
    await settleOnly()
    decorate()
    if (DOM_LOG) {
      appendFileSync(DOM_LOG, `${JSON.stringify({
        test: t.fullName,
        step: `${mount}.${step++}`,
        html: widget.html(),
        calls: calls.map(call => (call.body === undefined ? wire(call) : { wire: wire(call), body: call.body })),
        storage: Object.fromEntries(local.map),
        overflow: body.style.overflow ?? null,
        events,
        scrolls,
        navigations,
      })}\n`)
    }
  }
  /** Move the mocked clock, then let everything it released run. */
  const tick = async (ms: number) => {
    t.mock.timers.tick(ms)
    await settle()
  }
  const key = (name: string, extra: { shiftKey?: boolean } = {}) => {
    let prevented = false
    const event = { key: name, shiftKey: extra.shiftKey === true, preventDefault: () => { prevented = true } }
    for (const fn of [...(listeners.get('keydown') ?? [])]) fn(event)
    return { prevented }
  }
  const keydownListeners = () => listeners.get('keydown')?.size ?? 0

  return {
    widget, server, calls, events, scrolls, local, doc, body, opener, media, route, navigations, clipboard,
    composable, settle, tick, key, keydownListeners, close,
  }
}
export type ChatCtx = Awaited<ReturnType<typeof mountChat>>

export async function openWidget(t: TestContext, server = chatServer(), options?: MountOptions) {
  const ctx = await mountChat(t, server, options)
  await ctx.settle()
  return ctx
}

// ─── Reading the widget ──────────────────────────────────────────────────────

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

export const byId = (from: MiniElement | MountedSfc, id: string) => findAll(root(from), el => el.props.id === id)[0]
export function dialogOf(from: MiniElement | MountedSfc): MiniElement | undefined {
  return byId(from, 'public-chatbot-dialog')
}
export const byTag = (from: MiniElement | MountedSfc, tag: string) => findAll(root(from), el => el.tag === tag)
export const buttonsWith = (from: MiniElement | MountedSfc, text: string) => byTag(from, 'button').filter(el => words(el).includes(text))
export const button = (from: MiniElement | MountedSfc, text: string) => {
  const found = buttonsWith(from, text)
  if (found.length !== 1) throw new Error(`expected one <button> containing "${text}", found ${found.length}`)
  return found[0]!
}
export const byLabel = (from: MiniElement | MountedSfc, label: string) => {
  const found = findAll(root(from), el => el.props['aria-label'] === label)
  if (found.length !== 1) throw new Error(`expected one element labelled "${label}", found ${found.length}`)
  return found[0]!
}
export const alerts = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.props.role === 'alert').map(words)
export const statuses = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.props.role === 'status').map(words)
/** The message bubbles of the transcript, oldest first. */
export const bubbles = (from: MiniElement | MountedSfc) =>
  findAll(root(from), el => typeof el.props.class === 'string' && /max-w-\[80%\]/.test(el.props.class))
/**
 * What a bubble says: a question's own text, or an answer's markdown blocks (`v-html`,
 * so read from `innerHTML`) with the tags dropped.
 */
export function messageText(bubble: MiniElement): string {
  const markdown = findAll(bubble, el => typeof el.props.class === 'string' && el.props.class.includes('chat-markdown'))[0]
  if (!markdown) return words(findAll(bubble, el => el.tag === 'p')[0] ?? bubble)
  return findAll(markdown, el => typeof el.props.innerHTML === 'string')
    .map(el => String(el.props.innerHTML).replace(/<[^>]*>/g, ''))
    .join('\n')
    .trim()
}
/** The transcript as `{ who, text }`, oldest first (the welcome message is not a bubble). */
export function transcript(from: MiniElement | MountedSfc): Array<{ who: 'user' | 'bot', text: string }> {
  return bubbles(from)
    .map(bubble => ({ who: /justify-end/.test(String(bubble.parent?.props.class)) ? 'user' as const : 'bot' as const, text: messageText(bubble) }))
}
export const isOpen = (from: MiniElement | MountedSfc) => /!visible/.test(String(dialogOf(from)?.props.class))
export const mainInput = (from: MiniElement | MountedSfc) => byId(from, 'public-chatbot-input')!
export const sendForm = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.tag === 'form' && findAll(el, i => i.props.id === 'public-chatbot-input').length > 0)[0]!
export const launcher = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.tag === 'button' && el.props['aria-controls'] === 'public-chatbot-dialog')[0]
export const parsedStorage = (ctx: ChatCtx) => {
  const raw = ctx.local.getItem('cdkt_sessions_v1')
  return raw ? JSON.parse(raw) as { activeId: string, sessions: Array<{ id: string, title: string, token: string | null, messages: Array<{ sender: string, text: string }> }> } : null
}

export { textOf, findAll }
