/**
 * Harness for tests/news-index-page.test.ts — the public news list `/news`
 * (`app/pages/news/index.vue`, wave3 4.2).
 *
 * The REAL page — `<script setup>`, template and, after the split, the real parts it
 * imports — mounted on the minimal DOM of tests/_sfc-mount.ts, with the REAL
 * `usePublicArticleList`/`usePublicMostRead` composables and REAL ofetch over a fake
 * network that answers like `server/api/public/articles.get.ts` and
 * `server/api/public/categories.get.ts` (same shapes, same localisation rule for
 * category names: `?lang=` first, then the `cdkt_lang` cookie — which a request from
 * this harness never carries — then Vietnamese).
 *
 * Nuxt is stood in for, thinly, after `node_modules/nuxt/dist/app/composables/asyncData.js`
 * (4.6.1):
 *   - `useAsyncData(key, handler, options)` — a reactive key is watched with
 *     `flush: 'sync'` and a key change runs the handler (the new key starts from the old
 *     data); `options.watch` runs it too, except in the tick the key changed; a newer run
 *     wins; a FAILED run sets `error` and resets `data` to `default()` (line 419 — the
 *     reason a failed list reads as an empty one); `pending` is `status === 'pending'`;
 *   - `useRoute()` — a reactive `{ path, query }`; `navigateTo(location)` is recorded and,
 *     when it stays on `/news`, applied to the route (a client-side navigation);
 *   - `useSeoMeta(input)` — recorded (`seo()` reads its current values);
 *   - `useI18n()` — the real fallback dictionaries (`hardcodedDictionary[lang]`, then `vi`,
 *     then the key); `currentLang` is a ref the test sets;
 *   - `useLayoutConfig()` — the one computed this page reads.
 * `<PageHero>`, `<SafeImg>` and `<nuxt-link>` stay unresolved: plain elements with their
 * props (PageHero's slot content renders inside it).
 *
 * Environment, for running the SAME suite against another version of the page:
 *   NEWS_PAGE_FILE=<file>     mount that file instead of app/pages/news/index.vue;
 *   NEWS_PAGE_DOM_LOG=<file>  after every `settle()`, append `{ test, step, html, calls,
 *                             navigations, seo }` as one JSON line.
 */
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary.ts'
import { byText, findAll, mountSfc, textOf, type MiniElement, type MiniNode, type MountedSfc } from './_sfc-mount.ts'

export const PAGE = process.env.NEWS_PAGE_FILE
  ? path.resolve(process.env.NEWS_PAGE_FILE)
  : fileURLToPath(new URL('../app/pages/news/index.vue', import.meta.url))
const DOM_LOG = process.env.NEWS_PAGE_DOM_LOG ? path.resolve(process.env.NEWS_PAGE_DOM_LOG) : null

// ─── Fake network under real ofetch ──────────────────────────────────────────

export type NetCall = {
  method: string
  url: URL
  respond: (response: Response) => void
  fail: (error: Error) => void
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 404: 'Not Found', 500: 'Internal Server Error', 503: 'Service Unavailable' }
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })
/** What `reportPublicReadFailure()` + `return { ok: false, … }` sends: a 503 with the empty shape. */
export const unavailable = (body: unknown) => json(body, 503)
export const dropped = () => new TypeError('fetch failed')
export const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`

export const HOLD = Symbol('hold')
type Answer = Response | Error | typeof HOLD | undefined

/** The query of a request, as an object (repeated keys never occur here). */
export const queryOf = (call: NetCall) => Object.fromEntries(call.url.searchParams)
export const isMostRead = (call: NetCall) => call.url.pathname === '/api/public/articles' && call.url.searchParams.get('sort') === 'views'
export const isList = (call: NetCall) => call.url.pathname === '/api/public/articles' && !isMostRead(call)
export const isCategories = (call: NetCall) => call.url.pathname === '/api/public/categories'

// ─── The two endpoints, as the handlers answer them ──────────────────────────

export type FakeCategory = { id: number, name: string, slug: string, parentId: number | null }

/** `CATEGORY_TRANSLATIONS` of server/api/public/categories.get.ts, for the slugs used here. */
const CATEGORY_TRANSLATIONS: Record<string, Record<string, string>> = {
  'tin-noi-bat': { en: 'Featured News' },
  'tin-hoat-dong': { en: 'Activities' },
  'tin-dia-phuong': { en: 'Local News' },
}

export const CATEGORIES: FakeCategory[] = [
  { id: 1, name: 'Tin nổi bật', slug: 'tin-noi-bat', parentId: null },
  { id: 2, name: 'Tin hoạt động', slug: 'tin-hoat-dong', parentId: null },
  { id: 3, name: 'Tin địa phương', slug: 'tin-dia-phuong', parentId: null },
  { id: 4, name: 'Miền Bắc', slug: 'dia-phuong-mien-bac', parentId: 3 },
  { id: 5, name: 'Miền Nam', slug: 'dia-phuong-mien-nam', parentId: 3 },
]

export const newsItem = (n: number, over: Record<string, unknown> = {}) => ({
  id: n,
  type: 'news',
  category: null,
  categoryId: n % 2 ? 2 : 3,
  categoryName: n % 3 === 0 ? null : (n % 2 ? 'Tin hoạt động' : 'Tin địa phương'),
  categorySlug: n % 2 ? 'tin-hoat-dong' : 'tin-dia-phuong',
  title: `Bản tin số ${n}`,
  slug: `ban-tin-${n}`,
  // Entities as the old CMS import left them (CLAUDE.md): the page decodes them for display.
  excerpt: n % 4 === 0 ? null : `Ng&agrave;y ${n}: t&oacute;m t&#7855;t b&agrave;i <b>${n}</b>`,
  thumbnailUrl: n % 2 ? `/uploads/2026/10/tin-${n}.webp` : null,
  publishedAt: n % 5 === 0 ? null : `2026-10-${String(1 + (n % 27)).padStart(2, '0')}T03:00:00.000Z`,
  createdAt: '2026-09-30T20:00:00.000Z',
  authorName: null,
  ...over,
})

export function newsServer() {
  const state = {
    /** Articles of the unfiltered list. */
    total: 45,
    /** Articles matching any search. */
    searchTotal: 4,
    mostRead: Array.from({ length: 6 }, (_, i) => newsItem(100 + i, { title: `Đọc nhiều ${i + 1}` })),
    categories: CATEGORIES as FakeCategory[],
    /** Per-test answers, tried first. */
    override: (() => undefined) as (call: NetCall) => Answer,
  }

  const route = (call: NetCall): Response | Error => {
    const q = queryOf(call)
    if (call.method === 'GET' && isCategories(call)) {
      const lang = (q.lang ?? '').toLowerCase()
      const items = state.categories
        .filter(() => q.type === 'news')
        .map(c => ({ ...c, type: 'news', description: null, displayOrder: c.id, name: (lang && lang !== 'vi' ? CATEGORY_TRANSLATIONS[c.slug]?.[lang] : null) || c.name }))
      return json({ ok: true, items })
    }
    if (call.method === 'GET' && isMostRead(call)) {
      const articles = state.mostRead.map(a => ({ ...a, title: q.lang === 'en' ? `${a.title} (en)` : a.title }))
      return json({ ok: true, articles, pagination: { page: 1, limit: 6, total: articles.length, totalPages: 1 } })
    }
    if (call.method === 'GET' && isList(call)) {
      const limit = Number(q.limit)
      const page = Number(q.page)
      const total = q.search ? state.searchTotal : state.total
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const first = (page - 1) * limit
      const count = Math.max(0, Math.min(limit, total - first))
      const articles = Array.from({ length: count }, (_, i) => {
        const n = first + i + 1
        return newsItem(n, q.lang === 'en' ? { title: `News item ${n}` } : {})
      })
      return json({ ok: true, articles, pagination: { page, limit, total, totalPages } })
    }
    throw new Error(`unexpected request ${wire(call)}`)
  }
  const respond = (call: NetCall): Answer => state.override(call) ?? route(call)
  /** Answer a held request now, as the handler would. */
  const answer = (call: NetCall) => {
    const response = route(call)
    if (response instanceof Error) call.fail(response)
    else call.respond(response)
  }
  return { state, respond, answer, route }
}
export type NewsServer = ReturnType<typeof newsServer>

// ─── Nuxt stand-ins ──────────────────────────────────────────────────────────

type AsyncOptions = { default?: () => unknown, watch?: Vue.WatchSource[], lazy?: boolean, server?: boolean }
export type AsyncRegistration = { key: string, lazy?: boolean, server?: boolean }

/** `useAsyncData` after Nuxt 4.6.1 — see the file comment. */
function fakeUseAsyncData(registrations: AsyncRegistration[]) {
  return (keyArg: string | (() => string), handler: () => Promise<unknown>, options: AsyncOptions = {}) => {
    const key = typeof keyArg === 'function' ? Vue.computed(keyArg) : Vue.computed(() => keyArg)
    registrations.push({ key: key.value, lazy: options.lazy, server: options.server })
    const data = Vue.shallowRef<unknown>(options.default ? options.default() : undefined)
    const error = Vue.shallowRef<unknown>(undefined)
    const status = Vue.shallowRef<'idle' | 'pending' | 'success' | 'error'>('idle')
    const pending = Vue.computed(() => status.value === 'pending')
    let current: Promise<void> | null = null
    const execute = (): Promise<void> => {
      status.value = 'pending'
      const run: Promise<void> = Promise.resolve()
        .then(() => handler())
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
    void execute()
    const result = { data, pending, error, status, refresh: execute, execute }
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

export type Location = { path: string, query: Record<string, unknown> }
export const GRID_CLASS = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6'
const MOUNTS = new WeakMap<TestContext, number>()

export async function mountNews(t: TestContext, server = newsServer(), options: { query?: Record<string, unknown>, lang?: string } = {}) {
  const calls: NetCall[] = []
  const restore: Restore[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = { method: (init.method ?? 'GET').toUpperCase(), url: new URL(raw, 'http://portal.test'), respond: resolve, fail: reject }
    calls.push(call)
    const answer = server.respond(call)
    if (answer === HOLD) return
    if (answer instanceof Error) reject(answer)
    else if (answer) resolve(answer)
  })
  restore.push(replaceGlobal('$fetch', createFetch({ fetch: fetchImpl as typeof fetch })))

  const route = Vue.reactive<Location>({ path: '/news', query: { ...(options.query ?? {}) } })
  const navigations: Location[] = []
  restore.push(replaceGlobal('useRoute', () => route))
  restore.push(replaceGlobal('navigateTo', (to: Location) => {
    navigations.push({ path: to.path, query: { ...to.query } })
    if (to.path === '/news') route.query = { ...to.query }
    return Promise.resolve()
  }))
  const registrations: AsyncRegistration[] = []
  const useAsyncData = fakeUseAsyncData(registrations)
  restore.push(replaceGlobal('useAsyncData', useAsyncData))

  const currentLang = Vue.ref(options.lang ?? 'vi')
  const translate = (key: string): string => hardcodedDictionary[currentLang.value]?.[key] || hardcodedDictionary.vi?.[key] || key
  let seoInput: Record<string, unknown> = {}

  const page = await mountSfc(PAGE, {
    auto: {
      useAsyncData,
      useSeoMeta: (input: Record<string, unknown>) => { seoInput = input },
    },
    modules: {
      '~/composables/useI18n': { useI18n: () => ({ t: translate, currentLang }) },
      '~/composables/useLayoutConfig': { useLayoutConfig: () => ({ articleGridClass: Vue.computed(() => GRID_CLASS) }) },
    },
  })

  let open = true
  const close = () => {
    if (!open) return
    open = false
    page.unmount()
    for (const undo of restore.reverse()) undo()
  }
  t.after(close)

  const seo = () => Object.fromEntries(Object.entries(seoInput).map(([k, v]) => [k, typeof v === 'function' ? (v as () => unknown)() : Vue.unref(v)]))
  const mount = (MOUNTS.get(t) ?? 0) + 1
  MOUNTS.set(t, mount)
  let step = 0
  const settle = async () => {
    await settleOnly()
    if (DOM_LOG) {
      appendFileSync(DOM_LOG, `${JSON.stringify({ test: t.fullName, step: `${mount}.${step++}`, html: page.html(), calls: calls.map(wire), navigations, seo: seo() })}\n`)
    }
  }

  return { page, server, calls, route, navigations, registrations, currentLang, seo, settle, close }
}
export type NewsCtx = Awaited<ReturnType<typeof mountNews>>

export async function openNews(t: TestContext, server = newsServer(), options?: { query?: Record<string, unknown>, lang?: string }) {
  const ctx = await mountNews(t, server, options)
  await ctx.settle()
  return ctx
}

// ─── Reading the page ────────────────────────────────────────────────────────

const root = (from: MiniElement | MountedSfc) => ('root' in from ? from.root : from)

/**
 * The text nodes under an element, each trimmed, joined by one space. `textOf` joins them
 * as they sit in the tree, and the compiled template drops the whitespace between tags.
 */
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
export const buttonsWith = (from: MiniElement | MountedSfc, text: string) => byTag(from, 'button').filter(el => textOf(el).includes(text))
export const alerts = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'alert')
export const busy = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'status' && el.props['aria-busy'] === 'true')
export const busyLabels = (page: MountedSfc) => busy(page).map(el => textOf(findAll(el, s => String(s.props.class ?? '') === 'sr-only')))
export const links = (from: MiniElement | MountedSfc) => byTag(from, 'nuxt-link').map(el => ({ to: el.props.to, text: textOf(el) }))
export const navByLabel = (page: MountedSfc, label: string) => {
  const found = findAll(page.root, el => el.tag === 'nav' && el.props['aria-label'] === label)
  return found[0] ?? null
}
/** The aside (right rail). */
export const rail = (page: MountedSfc) => byTag(page, 'aside')[0]!
/** A rail widget by its heading text. */
export const widget = (page: MountedSfc, heading: string) => {
  const found = findAll(rail(page), el => el.tag === 'div' && el.parent?.tag === 'aside'
    && findAll(el, h => /^h[23]$/.test(h.tag) && textOf(h) === heading).length > 0)
  return found[0] ?? null
}
/** The articles of the main column, in order (featured first when shown). */
export const articleCards = (page: MountedSfc) => byTag(page, 'article')
export const cardTitle = (card: MiniElement) => textOf(findAll(card, el => /^h[23]$/.test(el.tag))[0]!)
export const searchInput = (page: MountedSfc) => findAll(page.root, el => el.tag === 'input' && el.props.type === 'text')[0]!
export const searchForm = (page: MountedSfc) => byTag(page, 'form')[0]!
/** The category filter bar's root pills (`aria-pressed` buttons outside the rail). */
export const pills = (page: MountedSfc) => findAll(navByLabel(page, 'Lọc bản tin theo chuyên mục')!, el => el.tag === 'button')
export const pressed = (page: MountedSfc) => pills(page).filter(el => el.props['aria-pressed'] === true).map(el => textOf(el))
export const h1 = (page: MountedSfc) => textOf(byTag(page, 'h1')[0]!)

export { byText, textOf }
