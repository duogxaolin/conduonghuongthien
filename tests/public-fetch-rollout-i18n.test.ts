/**
 * D-FETCH lot G — `useI18n` (languages + the interface dictionary) and `useLiveSearch` (the
 * header's search suggestions) after their casts became `publicFetch<T>()`. Both import Nuxt
 * (`#imports`, `~/`), so they are evaluated as the build would
 * (`loadAppModule`, tests/_public-mount-harness.ts) with REAL ofetch on a fake network.
 *
 * useI18n is where the SWR cache invariant lives (CLAUDE.md: the server never writes
 * `cdkt_lang`; cached HTML is always Vietnamese; the language switches after hydrate):
 *   - on the SERVER: no request at all, the language read from the request's cookie header,
 *     nothing written (no `document` exists there — touching it would throw);
 *   - in the BROWSER: one languages read and one translations read for the language the page
 *     WILL show (a stored preference, not Vietnamese first), however many components call
 *     `useI18n()`; results applied only after hydration; a failed read falls back to the
 *     built-in dictionary; ofetch's default retry is untouched (the call passes no options).
 * useLiveSearch: `?q=&limit=6`, `retry: 0` (a 503 is asked once), and the `signal` reaches the
 * request (typing on aborts the request in flight).
 * Green on the base tree (5f1bb07d, casts) and on lot G alike.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { loadAppModule } from './_public-mount-harness.ts'

type Call = { method: string, wire: string, signal: AbortSignal | null | undefined }
const g = globalThis as Record<string, unknown>
const saved = new Map<string, PropertyDescriptor | undefined>()
function setGlobal(name: string, value: unknown) {
  if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(g, name))
  Object.defineProperty(g, name, { value, configurable: true, writable: true })
}
afterEach(() => {
  for (const [name, before] of saved) {
    if (before) Object.defineProperty(g, name, before)
    else delete g[name]
  }
  saved.clear()
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Service Unavailable', headers: { 'content-type': 'application/json' } })
const HOLD = Symbol('hold')
function network(answer: (call: Call) => Response | Error | typeof HOLD) {
  const calls: Call[] = []
  setGlobal('$fetch', createFetch({
    fetch: ((input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://portal.test')
      const call = { method: (init.method ?? 'GET').toUpperCase(), wire: `${url.pathname}${url.search}`, signal: init.signal }
      calls.push(call)
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
      const result = answer(call)
      if (result === HOLD) return
      if (result instanceof Error) reject(result)
      else resolve(result)
    })) as typeof fetch,
  }))
  return calls
}
const settle = async () => {
  for (let i = 0; i < 8; i++) { await Vue.nextTick(); await new Promise(resolve => setImmediate(resolve)) }
}

// ─── useI18n ─────────────────────────────────────────────────────────────────

const LANGUAGES = { ok: true, items: [
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', isDefault: true, displayOrder: 0 },
  { code: 'en', name: 'English', nativeName: '', isDefault: false, displayOrder: 1 },
] }
const TRANSLATIONS = (lang: string) => ({ ok: true, translations: { nav: { home: lang === 'en' ? 'Home (DB)' : 'Trang chủ (DB)' } } })

function nuxtStubs(options: { hydrating: boolean, cookieHeader?: string }) {
  const state = new Map<string, Vue.Ref<unknown>>()
  const afterHydrate: Array<() => void> = []
  const nuxtApp = { isHydrating: options.hydrating, hooks: { hookOnce: (_name: string, fn: () => void) => { afterHydrate.push(fn) } } }
  const imports = {
    useHead: () => {},
    useNuxtApp: () => nuxtApp,
    useRequestHeader: (name: string) => (name === 'cookie' ? options.cookieHeader : undefined),
    useState: <T>(key: string, init?: () => T) => {
      if (!state.has(key)) state.set(key, Vue.ref(init ? init() : undefined))
      return state.get(key) as Vue.Ref<T>
    },
  }
  const hydrate = () => { nuxtApp.isHydrating = false; for (const fn of afterHydrate.splice(0)) fn() }
  return { imports, hydrate }
}
type I18n = { currentLang: Vue.Ref<string>, t: (key: string) => string, locales: Vue.ComputedRef<Array<{ code: string, name: string }>> }

async function loadI18n(where: 'client' | 'server', options: { hydrating?: boolean, cookieHeader?: string } = {}) {
  const nuxt = nuxtStubs({ hydrating: options.hydrating ?? true, cookieHeader: options.cookieHeader })
  const module = await loadAppModule('composables/useI18n.ts', {
    modules: { '#imports': nuxt.imports },
    importMeta: { server: where === 'server', client: where === 'client' },
  })
  return { useI18n: module.useI18n as () => I18n, hydrate: nuxt.hydrate }
}
function browser(stored: string | null, cookie = '') {
  const writes: string[] = []
  const document = {}
  Object.defineProperty(document, 'cookie', { get: () => cookie, set: (value: string) => { writes.push(value) } })
  setGlobal('document', document)
  setGlobal('window', { localStorage: { getItem: () => stored, setItem: () => {} }, location: { reload: () => {} } })
  return writes
}

describe('useI18n over publicFetch', () => {
  it('browser: ONE languages read + ONE translations read however many components call it; applied after hydration', async () => {
    browser(null)
    const calls = network(call => (call.wire === '/api/public/languages' ? json(LANGUAGES) : json(TRANSLATIONS('vi'))))
    const { useI18n, hydrate } = await loadI18n('client')
    const first = useI18n()
    useI18n()
    useI18n()
    await settle()
    assert.deepEqual(calls.map(c => `${c.method} ${c.wire}`).sort(), ['GET /api/public/languages', 'GET /api/public/translations/vi'])
    assert.equal(first.t('home'), 'Trang chủ', 'nothing applied while hydrating (the server rendered the built-in words)')
    hydrate()
    assert.equal(first.t('home'), 'Trang chủ (DB)')
    assert.deepEqual(first.locales.value.map(l => `${l.code}:${l.name}`), ['vi:Tiếng Việt', 'en:English'])
  })

  it('browser: a stored "en" asks the English dictionary straight away (not Vietnamese first), switches after hydration', async () => {
    browser('en', 'cdkt_lang=en')
    const calls = network(call => (call.wire === '/api/public/languages' ? json(LANGUAGES) : json(TRANSLATIONS('en'))))
    const { useI18n, hydrate } = await loadI18n('client')
    const i18n = useI18n()
    await settle()
    assert.deepEqual(calls.map(c => c.wire).filter(w => w.includes('translations')), ['/api/public/translations/en'])
    assert.equal(i18n.currentLang.value, 'vi')
    hydrate()
    assert.equal(i18n.currentLang.value, 'en')
    assert.equal(i18n.t('home'), 'Home (DB)')
  })

  it('browser: failed reads fall back to the built-in dictionary; no options were added (ofetch retries a 503 GET once)', async () => {
    browser(null)
    const calls = network(() => json({ statusCode: 503, statusMessage: 'Service Unavailable' }, 503))
    const { useI18n, hydrate } = await loadI18n('client', { hydrating: false })
    const i18n = useI18n()
    await settle()
    hydrate()
    assert.equal(i18n.t('home'), 'Trang chủ')
    assert.deepEqual(i18n.locales.value.map(l => l.code), ['vi', 'en', 'zh', 'fr', 'ru', 'lo'])
    assert.equal(calls.filter(c => c.wire === '/api/public/languages').length, 2)
    assert.equal(calls.filter(c => c.wire === '/api/public/translations/vi').length, 2)
  })

  it('server: no request, the language from the request cookie header, nothing written (no document there)', async () => {
    const calls = network(() => json(LANGUAGES))
    const { useI18n } = await loadI18n('server', { cookieHeader: 'a=1; cdkt_lang=fr' })
    const i18n = useI18n()
    await settle()
    assert.deepEqual(calls, [])
    assert.equal(i18n.currentLang.value, 'fr')
    assert.equal(i18n.t('home'), 'Accueil')
  })
})

// ─── useLiveSearch ───────────────────────────────────────────────────────────

const ITEM = { id: 3, kind: 'article', type: 'news', typeLabel: 'Tin tức', typeIcon: 'fa-solid fa-newspaper', typeBadgeClass: '', title: 'Kết quả', excerpt: '', url: '/news/ket-qua', thumbnailUrl: null, publishedAt: null, categoryName: null }

async function loadLiveSearch() {
  const state = new Map<string, Vue.Ref<unknown>>()
  const navigations: unknown[] = []
  const module = await loadAppModule('composables/useLiveSearch.ts', {
    names: {
      useState: <T>(key: string, init?: () => T) => {
        if (!state.has(key)) state.set(key, Vue.ref(init ? init() : undefined))
        return state.get(key) as Vue.Ref<T>
      },
      navigateTo: (to: unknown) => { navigations.push(to) },
    },
  })
  const useLiveSearch = module.useLiveSearch as (open: Vue.Ref<boolean>) => {
    searchQuery: Vue.Ref<string>, liveSearchResults: Vue.Ref<unknown[]>, isSearchingLive: Vue.Ref<boolean>, onSearchInput: () => void
  }
  return { search: useLiveSearch(Vue.ref(false)), status: () => state.get('cdkt-live-search-status')?.value }
}

describe('useLiveSearch over publicFetch', () => {
  it('typing ≥ 2 characters asks /search?q=&limit=6 after the debounce; results land', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const calls = network(() => json({ ok: true, items: [ITEM] }))
    const { search, status } = await loadLiveSearch()
    search.searchQuery.value = 'ke'
    search.onSearchInput()
    t.mock.timers.tick(250)
    await settle()
    assert.deepEqual(calls.map(c => `${c.method} ${c.wire}`), ['GET /api/public/search?q=ke&limit=6'])
    assert.deepEqual(search.liveSearchResults.value, [ITEM])
    assert.equal(status(), 'success')
  })

  it('a 503 is asked ONCE (`retry: 0`) and reads as an error, not "no results"', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const calls = network(() => json({ statusCode: 503, statusMessage: 'Service Unavailable' }, 503))
    const { search, status } = await loadLiveSearch()
    search.searchQuery.value = 'ke'
    search.onSearchInput()
    t.mock.timers.tick(250)
    await settle()
    assert.equal(calls.length, 1)
    assert.equal(status(), 'error')
  })

  it('the `signal` reaches the request: typing on aborts the one in flight', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const calls = network(call => (call.wire.includes('q=ke&') ? HOLD : json({ ok: true, items: [ITEM] })))
    const { search } = await loadLiveSearch()
    search.searchQuery.value = 'ke'
    search.onSearchInput()
    t.mock.timers.tick(250)
    await settle()
    assert.equal(calls[0]!.signal?.aborted, false)
    search.searchQuery.value = 'ket'
    search.onSearchInput()
    t.mock.timers.tick(250)
    await settle()
    assert.equal(calls[0]!.signal?.aborted, true, 'the stale request was aborted through its signal')
    assert.deepEqual(calls.map(c => c.wire), ['/api/public/search?q=ke&limit=6', '/api/public/search?q=ket&limit=6'])
  })
})
