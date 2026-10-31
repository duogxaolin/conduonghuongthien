/**
 * Harness for tests/article-comments-thread.test.ts — the public comment thread
 * (`app/components/ArticleComments.vue`, wave3 4.2).
 *
 * The REAL component — `<script setup>`, template and, after the split, the real child
 * components, composable and helpers it imports — mounted on the minimal DOM of
 * tests/_sfc-mount.ts, with REAL ofetch over a fake network that answers like
 * `server/api/public/comments/**` (same sentences, same status codes, same shapes).
 *
 * Stood in for, and restored after each test:
 *   - `useReaderAuth()` — `isSignedIn` is a ref the test controls; `signIn()`, `load()` and
 *     `forgetReader()` are counted (forgetReader drops the identity, as the real one does);
 *   - `useI18n()` — the real Vietnamese fallback dictionary (`hardcodedDictionary.vi`),
 *     key name when missing, exactly the real `t()`'s last two steps;
 *   - `useRoute()` — `hash` and `query` the test sets before mounting;
 *   - `window.sessionStorage` (a Map; every write/remove logged), `window.confirm` (answer
 *     set by the test, questions recorded), `window.setTimeout` (late-bound to the global,
 *     so node:test's mock timers drive it), `window.matchMedia` (reduced motion on/off),
 *     `window.location.href`, `window.history.replaceState` (recorded);
 *   - `document.getElementById(id)` — finds the element in the mounted tree; its
 *     `scrollIntoView(options)` is recorded;
 *   - `navigator.clipboard.writeText` — written text recorded, or a refusal.
 *
 * Two environment variables, for running the SAME suite against another version of the
 * component (red/green evidence, the DOM proof of the split):
 *   ARTICLE_COMMENTS_FILE=<file>     mount that file instead of app/components/ArticleComments.vue;
 *   ARTICLE_COMMENTS_DOM_LOG=<file>  after every `settle()`, append one JSON line
 *                                    `{ test, step, html, calls }` to that file.
 */
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary.ts'
import { byText, findAll, mountSfc, textOf, type MiniElement, type MountedSfc } from './_sfc-mount.ts'

export const COMPONENT = process.env.ARTICLE_COMMENTS_FILE
  ? path.resolve(process.env.ARTICLE_COMMENTS_FILE)
  : fileURLToPath(new URL('../app/components/ArticleComments.vue', import.meta.url))
const DOM_LOG = process.env.ARTICLE_COMMENTS_DOM_LOG ? path.resolve(process.env.ARTICLE_COMMENTS_DOM_LOG) : null

// ─── Fake network under real ofetch ──────────────────────────────────────────

export type NetCall = {
  method: string
  url: URL
  body: unknown
  respond: (response: Response) => void
  fail: (error: Error) => void
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable' }
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

/** Leave the request unanswered; the test answers it later with `call.respond(…)` or `server.answer(call)`. */
export const HOLD = Symbol('hold')
type Answer = Response | Error | typeof HOLD | undefined

// ─── The comments API, as server/api/public/comments/** answers it ───────────

export type ThreadComment = {
  id: number
  authorName: string
  initials: string
  isAdminReply: boolean
  body: string
  createdAt: string | null
  canDelete: boolean
  parentId: number | null
  replies?: ThreadComment[]
}

export const comment = (id: number, over: Partial<ThreadComment> = {}): ThreadComment => ({
  id,
  authorName: `Bạn đọc ${id}`,
  initials: `B${id}`,
  isAdminReply: false,
  body: `Nội dung bình luận ${id}`,
  createdAt: '2026-10-20T03:00:00.000Z',
  canDelete: false,
  parentId: null,
  ...over,
})

export const adminReply = (id: number, parentId: number, body = 'Cảm ơn bạn đã theo dõi.'): ThreadComment =>
  comment(id, { authorName: 'Ban quản trị', initials: 'QT', isAdminReply: true, body, parentId, createdAt: '2026-10-20T04:00:00.000Z' })

export function commentsServer() {
  const state = {
    /** `comments_enabled` of the item: off → `{ enabled: false, comments: [] }` (the GET handler's early return). */
    enabled: true,
    /** Is the reader ticket still valid? A POST/DELETE without it answers 401 'Chưa đăng nhập'. */
    ticket: true,
    /** Top-level comments of page 1, replies nested — the projection of `serializePublicComment`. */
    comments: [] as ThreadComment[],
    /** Extra pages (page number → top-level comments); `totalPages` counts them. */
    pages: {} as Record<number, ThreadComment[]>,
    /** Ids the moderation worker has hidden since; the checkpoint answers `isHidden: true` for them. */
    hidden: new Set<number>(),
    nextId: 900,
    /** Per-test answers, tried first. */
    override: (() => undefined) as (call: NetCall) => Answer,
  }

  const pageList = (page: number) => (page === 1 ? state.comments : state.pages[page] ?? [])
  const totalPages = () => Math.max(1, 1 + Object.keys(state.pages).length)
  const count = (list: ThreadComment[]) => list.length
  const withoutId = (list: ThreadComment[], id: number): ThreadComment[] =>
    list.filter(c => c.id !== id).map(c => (c.replies ? { ...c, replies: withoutId(c.replies, id) } : c))

  const route = (call: NetCall): Response | Error => {
    const { pathname, searchParams } = call.url
    if (call.method === 'GET' && pathname === '/api/public/comments/checkpoint') {
      const ids = (searchParams.get('ids') ?? '').split(',').map(Number).filter(Boolean)
      return json({ ok: true, items: ids.map(id => ({ id, isHidden: state.hidden.has(id) })) })
    }
    if (call.method === 'GET' && pathname.startsWith('/api/public/comments/')) {
      const page = Number(searchParams.get('page') ?? 1)
      if (!state.enabled) return json({ ok: true, enabled: false, signedIn: false, comments: [], total: 0, page, perPage: 20, totalPages: 1 })
      const list = pageList(page)
      return json({ ok: true, enabled: true, signedIn: state.ticket, comments: list, total: count(state.comments) + Object.values(state.pages).reduce((n, l) => n + l.length, 0), page, perPage: 20, totalPages: totalPages() })
    }
    if (call.method === 'POST' && pathname === '/api/public/comments') {
      if (!state.ticket) return h3Error(401, 'Chưa đăng nhập')
      const body = call.body as { parentId: number | null, body: string }
      const id = state.nextId++
      const created = comment(id, { authorName: 'Tôi', initials: 'TI', body: body.body.trim(), canDelete: true, parentId: body.parentId })
      if (body.parentId === null) state.comments = [...state.comments, created]
      else state.comments = state.comments.map(c => (c.id === body.parentId ? { ...c, replies: [...(c.replies ?? []), created] } : c))
      return json({ ok: true, id })
    }
    if (call.method === 'DELETE' && pathname.startsWith('/api/public/comments/')) {
      if (!state.ticket) return h3Error(401, 'Chưa đăng nhập')
      const id = Number(pathname.split('/').pop())
      state.comments = withoutId(state.comments, id)
      return json({ ok: true })
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
  return { state, respond, answer }
}

export type CommentsServer = ReturnType<typeof commentsServer>

// ─── Mounting ────────────────────────────────────────────────────────────────

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

export type MountOptions = {
  slug?: string
  mediaItemId?: number | null
  signedIn?: boolean
  hash?: string
  query?: Record<string, string>
  /** sessionStorage content before the mount. */
  storage?: Record<string, string>
  reducedMotion?: boolean
}

const t = (key: string): string => hardcodedDictionary.vi?.[key] || key
const MOUNTS = new WeakMap<TestContext, number>()

export async function mountThread(t_: TestContext, server = commentsServer(), options: MountOptions = {}) {
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

  const storage = new Map<string, string>(Object.entries(options.storage ?? {}))
  const storageLog: string[] = []
  const confirms: string[] = []
  const confirmAnswer = { value: true }
  const replacedUrls: string[] = []
  const location = { href: `http://portal.test/news/${options.slug ?? 'bai-viet'}${options.hash ?? ''}` }
  restore.push(replaceGlobal('window', {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storageLog.push(`set ${key}`); storage.set(key, value) },
      removeItem: (key: string) => { storageLog.push(`remove ${key}`); storage.delete(key) },
    },
    confirm: (question: string) => { confirms.push(question); return confirmAnswer.value },
    matchMedia: (query: string) => ({ matches: query.includes('reduce') && options.reducedMotion === true }),
    location,
    history: { replaceState: (_state: unknown, _title: string, url: string) => { replacedUrls.push(url) } },
  }))

  const scrolls: Array<{ id: string, behavior: string, block: string }> = []
  let root: MiniElement | null = null
  restore.push(replaceGlobal('document', {
    getElementById: (id: string) => {
      if (!root || !findAll(root, el => el.props.id === id).length) return null
      return { scrollIntoView: (opts: { behavior: string, block: string }) => { scrolls.push({ id, ...opts }) } }
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

  const isSignedIn = Vue.ref(options.signedIn === true)
  const reader = { loads: 0, signIns: 0, forgets: 0 }
  const readerAuth = {
    isSignedIn,
    signIn: () => { reader.signIns += 1 },
    load: async () => { reader.loads += 1 },
    forgetReader: () => { reader.forgets += 1; isSignedIn.value = false },
  }
  const route = Vue.reactive({ hash: options.hash ?? '', query: { ...(options.query ?? {}) } })

  const props: Record<string, unknown> = { slug: options.slug ?? 'bai-viet' }
  if (options.mediaItemId !== undefined) props.mediaItemId = options.mediaItemId

  const thread = await mountSfc(COMPONENT, {
    auto: {},
    modules: {
      '~/composables/useReaderAuth': { useReaderAuth: () => readerAuth },
      '~/composables/useI18n': { useI18n: () => ({ t }) },
      'vue-router': { useRoute: () => route },
    },
  }, props)
  root = thread.root

  let open = true
  const close = () => {
    if (!open) return
    open = false
    thread.unmount()
    for (const undo of restore.reverse()) undo()
  }
  t_.after(close)

  // Several mounts in one test (a second visit) keep counting, so every snapshot has its own key.
  const mount = (MOUNTS.get(t_) ?? 0) + 1
  MOUNTS.set(t_, mount)
  let step = 0
  const settle = async () => {
    await settleOnly()
    if (DOM_LOG) appendFileSync(DOM_LOG, `${JSON.stringify({ test: t_.fullName, step: `${mount}.${step++}`, html: thread.html(), calls: sent(calls) })}\n`)
  }

  /** Unmount without restoring the globals — what leaving the page does; `close()` restores later. */
  const leave = () => thread.unmount()

  return { thread, server, calls, reader, isSignedIn, route, storage, storageLog, confirms, confirmAnswer, replacedUrls, scrolls, clipboard, clipboardAnswer, location, settle, close, leave }
}

export type ThreadCtx = Awaited<ReturnType<typeof mountThread>>

export async function openThread(t_: TestContext, server = commentsServer(), options?: MountOptions) {
  const ctx = await mountThread(t_, server, options)
  await ctx.settle()
  return ctx
}

// ─── Reading the thread ──────────────────────────────────────────────────────

export const button = (from: MiniElement | MountedSfc, text: string) => byText('root' in from ? from.root : from, 'button', text)
export const buttons = (from: MiniElement | MountedSfc, text: string) =>
  findAll('root' in from ? from.root : from, el => el.tag === 'button' && textOf(el).includes(text))
export const alertTexts = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'alert').map(el => textOf(el))
export const skeleton = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'status' && el.props['aria-busy'] === 'true')[0] ?? null
export const section = (page: MountedSfc) => findAll(page.root, el => el.tag === 'section')[0] ?? null
/** The rendered comment (top-level `<article>` or reply `<div>`) carrying `#comment-<id>`. */
export const commentEl = (page: MountedSfc, id: number) => {
  const found = findAll(page.root, el => el.props.id === `comment-${id}`)
  if (found.length !== 1) throw new Error(`expected one #comment-${id}, found ${found.length}`)
  return found[0]!
}
export const hasComment = (page: MountedSfc, id: number) => findAll(page.root, el => el.props.id === `comment-${id}`).length === 1
/** The compose (`#comment-body`) and reply textareas. */
export const composeBox = (page: MountedSfc) => findAll(page.root, el => el.tag === 'textarea' && el.props.id === 'comment-body')[0] ?? null
export const replyBox = (page: MountedSfc) => findAll(page.root, el => el.tag === 'textarea' && el.props.id !== 'comment-body')[0] ?? null
export const forms = (from: MiniElement | MountedSfc) => findAll('root' in from ? from.root : from, el => el.tag === 'form')
/** Optimistic (pending) entries — the `<li>` of the list labelled with c_section_title. */
export const pendingItems = (page: MountedSfc) => {
  const list = findAll(page.root, el => el.tag === 'ul' && el.props['aria-label'] === t('c_section_title'))[0]
  return list ? list.children.filter((c): c is MiniElement => c.kind === 'element') : []
}
export const vi = t
