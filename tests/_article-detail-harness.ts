/**
 * Harness for tests/article-detail-page.test.ts — the shared article detail view
 * (`app/components/ArticleDetail.vue`, wave3 4.2).
 *
 * The REAL component — `<script setup>`, template and, after the split, the real child
 * components and helpers it imports — mounted on the minimal DOM of tests/_sfc-mount.ts,
 * with REAL ofetch over a fake network that answers like `server/api/public/articles/**`
 * and `/api/public/settings`.
 *
 * Nuxt is stood in for, thinly:
 *   - `useAsyncData(key, handler, options)` — runs the handler at once (as on a client-side
 *     navigation), `default()`, a `status`/`pending`/`error`/`data` quartet, `refresh()`
 *     (the newest call wins), and ONE re-run when the key or a `watch` source changes;
 *   - `useSeoMeta(input)` — the input is recorded (`seo()` reads its current values);
 *   - `useI18n()` — the real fallback dictionaries (`hardcodedDictionary[lang]`, then `vi`,
 *     then the key — the real `t()` minus the DB layer); `currentLang` is a ref the test sets;
 *   - `useToast()` — toasts recorded;
 *   - module stand-ins: `useSsrFailureStatus` (its `failed()`/`notFound()` closures are kept
 *     so a test can read the SSR decision in any state), `useReadingHistory` (records),
 *     `useBrokenImageFallback` (records the root ref), `useSiteSettings` (the one computed
 *     this view reads);
 *   - browser: `window.open` (recorded), `window.location`, `document.referrer`,
 *     `navigator.clipboard.writeText` (recorded, or refused).
 * `<nuxt-link>`, `<SafeImg>` and `<ArticleComments>` stay unresolved: plain elements with
 * their props, so the markup and the bound values are compared, not their insides.
 *
 * Environment, as tests/_article-comments-harness.ts:
 *   ARTICLE_DETAIL_FILE=<file>     mount that file instead of app/components/ArticleDetail.vue;
 *   ARTICLE_DETAIL_DOM_LOG=<file>  after every `settle()`, append `{ test, step, html, calls,
 *                                  toasts, opened, seo }` as one JSON line.
 */
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary.ts'
import { findAll, mountSfc, textOf, type MiniElement, type MountedSfc } from './_sfc-mount.ts'

export const COMPONENT = process.env.ARTICLE_DETAIL_FILE
  ? path.resolve(process.env.ARTICLE_DETAIL_FILE)
  : fileURLToPath(new URL('../app/components/ArticleDetail.vue', import.meta.url))
const DOM_LOG = process.env.ARTICLE_DETAIL_DOM_LOG ? path.resolve(process.env.ARTICLE_DETAIL_DOM_LOG) : null

// ─── Fake network under real ofetch ──────────────────────────────────────────

export type NetCall = {
  method: string
  url: URL
  body: unknown
  /** What ofetch handed to `fetch` (D-FETCH lot G pins the view ping's beacon options). */
  keepalive?: boolean
  signal?: AbortSignal | null
  respond: (response: Response) => void
  fail: (error: Error) => void
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 202: 'Accepted', 404: 'Not Found', 500: 'Internal Server Error', 503: 'Service Unavailable' }
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })
export const h3Error = (statusCode: number, statusMessage: string) => json({ statusCode, statusMessage, message: statusMessage }, statusCode)
export const dropped = () => new TypeError('fetch failed')
export const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`
export const sent = (calls: NetCall[], from = 0) =>
  calls.slice(from).map(call => (call.body === undefined ? wire(call) : { wire: wire(call), body: call.body }))

export const HOLD = Symbol('hold')
type Answer = Response | Error | typeof HOLD | undefined

export type FakeArticle = {
  id: number
  title: string
  slug: string
  excerpt: string | null
  content: string
  featuredImage: string | null
  thumbnailUrl?: string | null
  publishedAt: string | null
  createdAt?: string | null
  type?: string
  categoryName?: string | null
  authorName?: string | null
  viewTotal?: number
}

/** Three h2 → the outline shows (TOC_MIN_HEADINGS = 3); one h3 under the second. */
export const LONG_BODY = '<p>Mở đầu.</p><h2>Bối cảnh</h2><p>A.</p><h2>Diễn biến</h2><h3>Chi tiết</h3><p>B.</p><h2>Kết quả</h2><p>C.</p>'

export const article = (over: Partial<FakeArticle> = {}): FakeArticle => ({
  id: 11,
  title: 'Hành trình hoàn lương của anh A',
  slug: 'hanh-trinh',
  excerpt: 'Sapo của bài viết.',
  content: LONG_BODY,
  featuredImage: null,
  thumbnailUrl: '/uploads/2026/10/anh.webp',
  publishedAt: '2026-10-20T03:00:00.000Z',
  createdAt: '2026-10-19T03:00:00.000Z',
  type: 'news',
  categoryName: 'Tin địa phương',
  authorName: 'Nguyễn Văn B',
  viewTotal: 1234,
  ...over,
})

export const relatedItem = (id: number, over: Record<string, unknown> = {}) => ({
  id, title: `Bài liên quan ${id}`, slug: `lien-quan-${id}`, excerpt: `Tóm tắt ${id}`, featuredImage: null,
  thumbnailUrl: id % 2 ? `/uploads/lq-${id}.webp` : null, publishedAt: '2026-10-18T10:00:00.000Z', createdAt: '2026-10-18T09:00:00.000Z', ...over,
})

export function articleServer() {
  const state = {
    /** `null` → the handler's 404 (missing or unpublished). */
    article: article() as FakeArticle | null,
    related: { ok: true, articles: [relatedItem(21), relatedItem(22)], topics: [{ slug: 'tin-dia-phuong', name: 'Tin địa phương', isCurrent: true, total: 12 }, { slug: 'hoat-dong', name: 'Hoạt động', total: 5 }] } as Record<string, unknown>,
    settings: { settings: { og_image_url: '/uploads/og-mac-dinh.jpg' } } as Record<string, unknown>,
    override: (() => undefined) as (call: NetCall) => Answer,
  }
  const route = (call: NetCall): Response | Error => {
    const { pathname } = call.url
    if (call.method === 'GET' && pathname === '/api/public/settings') return json(state.settings)
    if (call.method === 'POST' && /^\/api\/public\/articles\/[^/]+\/view$/.test(pathname)) return json({ ok: true }, 202)
    if (call.method === 'GET' && /^\/api\/public\/articles\/[^/]+\/related$/.test(pathname)) return json(state.related)
    if (call.method === 'GET' && /^\/api\/public\/articles\/[^/]+$/.test(pathname)) {
      if (!state.article) return h3Error(404, 'Không tìm thấy bài viết')
      return json({ ok: true, article: state.article })
    }
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
export type ArticleServer = ReturnType<typeof articleServer>

// ─── Nuxt stand-ins ──────────────────────────────────────────────────────────

type AsyncOptions = { default?: () => unknown, watch?: Vue.WatchSource[], lazy?: boolean, server?: boolean, immediate?: boolean }

/**
 * One `useAsyncData` call as registered: its key, WHEN it was registered (`setup` — while the
 * component's setup runs, which is when Nuxt starts it on the server too — or later), and the
 * options that decide whether it runs during server rendering at all (`server`, `immediate`).
 * As Nuxt, `immediate: false` does not run the handler at registration.
 */
export type AsyncRegistration = { key: string, phase: 'setup' | 'mounted' | 'outside', lazy?: boolean, server?: boolean, immediate?: boolean }

function phaseNow(): AsyncRegistration['phase'] {
  const instance = Vue.getCurrentInstance()
  return !instance ? 'outside' : instance.isMounted ? 'mounted' : 'setup'
}

function fakeUseAsyncData(keys: string[], registrations: AsyncRegistration[]) {
  return (keyArg: string | (() => string), handler: () => Promise<unknown>, options: AsyncOptions = {}) => {
    const key = typeof keyArg === 'function' ? keyArg : () => keyArg
    registrations.push({ key: key(), phase: phaseNow(), lazy: options.lazy, server: options.server, immediate: options.immediate })
    const data = Vue.ref<unknown>(options.default ? options.default() : undefined)
    const error = Vue.ref<unknown>(undefined)
    const status = Vue.ref<'idle' | 'pending' | 'success' | 'error'>('idle')
    const pending = Vue.computed(() => status.value === 'pending')
    let seq = 0
    const refresh = async () => {
      const mine = ++seq
      status.value = 'pending'
      keys.push(key())
      try {
        const value = await handler()
        if (mine !== seq) return
        data.value = value
        error.value = undefined
        status.value = 'success'
      } catch (err: unknown) {
        if (mine !== seq) return
        error.value = err
        status.value = 'error'
      }
    }
    if (options.immediate !== false) void refresh()
    Vue.watch([key, ...(options.watch ?? [])], () => { void refresh() })
    const result = { data, pending, error, status, refresh, execute: refresh }
    return Object.assign(Promise.resolve(result), result)
  }
}

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

export type DetailProps = Record<string, unknown> & { slug?: string, backTo?: string }
const MOUNTS = new WeakMap<TestContext, number>()

export async function mountDetail(t: TestContext, server = articleServer(), props: DetailProps = {}, options: { lang?: string, referrer?: string } = {}) {
  const calls: NetCall[] = []
  const restore: Restore[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://portal.test'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      keepalive: init.keepalive,
      signal: init.signal,
      respond: resolve,
      fail: reject,
    }
    calls.push(call)
    init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    const answer = server.respond(call)
    if (answer === HOLD) return
    if (answer instanceof Error) reject(answer)
    else if (answer) resolve(answer)
  })
  restore.push(replaceGlobal('$fetch', createFetch({ fetch: fetchImpl as typeof fetch })))

  const opened: Array<[string, string, string]> = []
  const location = { href: `http://portal.test/news/${props.slug ?? 'hanh-trinh'}`, hostname: 'portal.test' }
  restore.push(replaceGlobal('window', {
    open: (url: string, target: string, features: string) => { opened.push([url, target, features]); return null },
    location,
  }))
  restore.push(replaceGlobal('document', { referrer: options.referrer ?? 'https://www.google.com/' }))
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

  const currentLang = Vue.ref(options.lang ?? 'vi')
  const translate = (key: string): string => hardcodedDictionary[currentLang.value]?.[key] || hardcodedDictionary.vi?.[key] || key
  const toasts: Array<{ type: string, message: string }> = []
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type => [type, (message: string) => { toasts.push({ type, message }) }]))
  let seoInput: Record<string, unknown> = {}
  const asyncKeys: string[] = []
  const registrations: AsyncRegistration[] = []
  const useAsyncData = fakeUseAsyncData(asyncKeys, registrations)
  // Composables imported by the view (`useArticleRelated`) reach Nuxt's auto-imports as bare
  // globals — the same stand-in, on `globalThis` (the pattern of tests/public-article-list.test.ts).
  restore.push(replaceGlobal('useAsyncData', useAsyncData))
  const ssr: Array<{ failed: () => boolean, notFound?: () => boolean }> = []
  const reads: Array<[string, string]> = []
  const brokenRoots: unknown[] = []

  const detail = await mountSfc(COMPONENT, {
    auto: {
      useI18n: () => ({ t: translate, currentLang }),
      useAsyncData,
      useSeoMeta: (input: Record<string, unknown>) => { seoInput = input },
      useToast: () => toast,
    },
    modules: {
      '~/composables/useSsrFailureStatus': {
        useSsrFailureStatus: (_settled: unknown, failed: () => boolean, opts: { notFound?: () => boolean } = {}) => { ssr.push({ failed, notFound: opts.notFound }) },
      },
      '~/composables/useReadingHistory': { useReadingHistory: () => ({ record: (slug: string, title: string) => { reads.push([slug, title]) } }) },
      // As the real one: the watch is attached on mount, to whatever the ref holds THEN.
      '~/composables/useBrokenImageFallback': {
        // (`toRaw`: a template ref in a `ref()` reads back as a reactive proxy of the element.)
        useBrokenImageFallback: (root: Vue.Ref<unknown>) => { Vue.onMounted(() => { brokenRoots.push(Vue.toRaw(root.value) ?? null) }) },
      },
      '~/composables/useSiteSettings': {
        useSiteSettings: (data: Vue.Ref<{ settings?: Record<string, string | null> } | null>) => ({ sitePublicSettings: Vue.computed(() => data.value?.settings || {}) }),
      },
    },
  }, { slug: 'hanh-trinh', backTo: '/news', ...props })

  let open = true
  const close = () => {
    if (!open) return
    open = false
    detail.unmount()
    for (const undo of restore.reverse()) undo()
  }
  t.after(close)

  const seo = () => Object.fromEntries(Object.entries(seoInput).map(([k, v]) => [k, Vue.unref(v as Vue.Ref<unknown>)]))
  // Several mounts in one test keep counting, so every snapshot has its own key.
  const mount = (MOUNTS.get(t) ?? 0) + 1
  MOUNTS.set(t, mount)
  let step = 0
  const settle = async () => {
    await settleOnly()
    if (DOM_LOG) appendFileSync(DOM_LOG, `${JSON.stringify({ test: t.fullName, step: `${mount}.${step++}`, html: detail.html(), calls: sent(calls), toasts, opened, seo: seo() })}\n`)
  }

  return { detail, server, calls, opened, location, clipboard, clipboardAnswer, currentLang, toasts, seo, asyncKeys, registrations, ssr, reads, brokenRoots, settle, close }
}
export type DetailCtx = Awaited<ReturnType<typeof mountDetail>>

export async function openDetail(t: TestContext, server = articleServer(), props: DetailProps = {}, options?: { lang?: string, referrer?: string }) {
  const ctx = await mountDetail(t, server, props, options)
  await ctx.settle()
  return ctx
}

// ─── Reading the view ────────────────────────────────────────────────────────

export const byTag = (from: MiniElement | MountedSfc, tag: string) => findAll('root' in from ? from.root : from, el => el.tag === tag)
export const buttonsWith = (from: MiniElement | MountedSfc, text: string) => byTag(from, 'button').filter(el => textOf(el).includes(text))
export const alertTexts = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'alert').map(el => textOf(el))
export const busy = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'status' && el.props['aria-busy'] === 'true')
export const aside = (page: MountedSfc) => byTag(page, 'aside')[0] ?? null
export const tocNav = (page: MountedSfc) => findAll(page.root, el => el.tag === 'nav' && el.props['aria-labelledby'] === 'muc-luc-heading')[0] ?? null
export const links = (from: MiniElement | MountedSfc) => byTag(from, 'nuxt-link').map(el => ({ to: el.props.to, text: textOf(el) }))
