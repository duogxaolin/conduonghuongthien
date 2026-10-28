/**
 * Wave 3 D-FETCH, first slice: the two admin files with the most `$fetch` casts —
 * `components/admin/ai/AiProvidersTab.vue` (15) and `pages/admin/languages/index.vue`
 * (14) — call `adminFetch<T>()` instead. This runs each file's REAL `<script setup>`
 * (compiled with `@vue/compiler-sfc`, Nuxt auto-imports stubbed, as in
 * tests/admin-slug-input.test.ts) against REAL ofetch over a fake network (the
 * `installFakeNetwork` shape of tests/admin-list.test.ts). What is checked is what the
 * officer gets, not the source text.
 *
 * Neither file is a paged list, so neither moved to `useAdminList`: the providers tab
 * flips a model's `isActive` in place (optimistic toggle) and hands its refs to the
 * parent page through `defineExpose`; the translations table has no paging, its rows
 * are written in place by the AI "translate this key" action, and its filters are set
 * from the languages tab too. Both keep their own loading/error refs, which
 * tests/admin-error-retry-ui.test.ts and tests/skeleton-loading-ui.test.ts pin by name.
 *
 * Pinned here:
 *   1. a failed load shows the sentence the SERVER wrote, never ofetch's `[GET] "…"`
 *      line; a dropped connection shows the page's own fallback;
 *   2. 401 and 403 are handled as before — neither file branches on the status: each
 *      shows the server's sentence where any other failure goes, and nothing else
 *      happens (no redirect, no second request);
 *   3. the translations table reloads on every language/group/search change, and an
 *      older answer can no longer land over a newer one (RED on the base: 166c84f);
 *   4. a translation whose `value` is NULL reaches the table as '' — the type the table
 *      declares (RED on the base: the editor started from null, and "Lưu" without typing
 *      sent `value: null`, which the PUT handler's `String(i.value)` stores as "null");
 *   5. every action sends exactly the requests it sent before (method, path, query,
 *      body, and the reloads after it) — green on the base too: the conversion is a
 *      no-op on the wire. One change since, on purpose: the vi source map and the
 *      missing-keys scan no longer ask for `?limit=500` — the server capped the list
 *      there and ~600 keys exist (see "more than 500 keys" below);
 *   6. neither file mentions `$fetch` any more (RED on the base), and both still count
 *      as "fetching" for the error/skeleton coverage gates.
 *
 * The fetch-cast count itself is the ratchet's job (tests/ratchets/fetch-casts.test.ts).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { describe, it } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { ADMIN_FETCH_CALL } from './_admin-fetch-call.ts'
import { AI_PROVIDERS_TAB_FAMILY, familyFiles, readAppFile } from './_component-family.ts'

const PROVIDERS_TAB = 'components/admin/ai/AiProvidersTab.vue'
const LANGUAGES_PAGE = 'pages/admin/languages/index.vue'

// ─── Fake network under real ofetch ──────────────────────────────────────────

type NetCall = {
  method: string
  url: URL
  body: unknown
  signal: AbortSignal | undefined
  respond: (response: Response) => void
  fail: (reason: unknown) => void
}

/** Answer a call now (a Response, or an Error for a dropped connection), or leave it to the test. */
type Responder = (call: NetCall) => Response | Error | undefined

/**
 * The browser's `fetch`, faked at the network edge only; ofetch above it is real and
 * installed as the `$fetch` global, the way Nuxt installs it. `ignoreAbort` models a
 * source that answers anyway after being cancelled, so a guard is shown to rest on
 * "which request is current" rather than on the abort reaching the wire.
 */
function installNetwork(responder: Responder = () => undefined, { ignoreAbort = false } = {}) {
  const calls: NetCall[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://admin.test'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      signal: init.signal ?? undefined,
      respond: resolve,
      fail: reject,
    }
    if (!ignoreAbort) init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
    calls.push(call)
    const answer = responder(call)
    if (answer instanceof Error) reject(answer)
    else if (answer) resolve(answer)
  })
  ;(globalThis as Record<string, unknown>).$fetch = createFetch({ fetch: fetchImpl as typeof fetch })
  return calls
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 409: 'Conflict' }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })

/** What `throw createError({ statusCode, statusMessage })` sends from a Nitro handler. */
const h3Error = (statusCode: number, statusMessage: string) => json({ statusCode, statusMessage, message: statusMessage }, statusCode)

/** A connection that never got an answer (ofetch wraps it in a FetchError with no response). */
const dropped = () => new TypeError('fetch failed')

/** Let promise chains (and ofetch's internal awaits) run to completion. */
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`

// ─── Run a file's real <script setup> ────────────────────────────────────────

type Toast = { type: string, message: string }

/**
 * Compile the SFC's `<script setup>`, resolve its imports the way Nuxt would, stub the
 * auto-imports, and call `setup()`. `onMounted` hooks are collected and run by `mount()`.
 */
async function runSfc<T extends object>(relative: string) {
  const { descriptor } = parse(readFileSync(new URL(`../app/${relative}`, import.meta.url), 'utf8'), { filename: relative })
  const compiled = compileScript(descriptor, { id: 'admin-fetch-rollout-test' })

  const toasts: Toast[] = []
  const emitted: string[] = []
  const mounted: Array<() => unknown> = []
  const exposed: Record<string, unknown> = {}
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type =>
    [type, (message: string) => { toasts.push({ type, message }) }]))
  const onMounted = (hook: () => unknown) => { mounted.push(hook) }

  const modules: Record<string, Record<string, unknown>> = {
    vue: { ...Vue, onMounted },
    // The real module relies on Nuxt's auto-imported `ref`; record the toasts instead.
    '~/composables/useToast': { useToast: () => toast },
  }
  for (const [, from] of compiled.content.matchAll(/import\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g)) {
    if (modules[from!]) continue
    if (from!.endsWith('.vue')) modules[from!] = { default: {} }
    else if (from!.startsWith('~/')) modules[from!] = await import(new URL(`../app/${from!.slice(2)}.ts`, import.meta.url).href)
    else throw new Error(`unexpected import in ${relative}: ${from}`)
  }
  const code = stripTypeScriptTypes(compiled.content)
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (_m, names: string, from: string) =>
      `const {${names.replace(/\s+as\s+/g, ': ')}} = __modules[${JSON.stringify(from)}];`)
    .replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (_m, name: string, from: string) =>
      `const ${name} = __modules[${JSON.stringify(from)}].default;`)
    .replace(/export default/, 'return')

  const auto: Record<string, unknown> = {
    definePageMeta: () => {},
    useToast: () => toast,
    useConfirm: () => ({ confirm: async () => true }),
    ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
    onMounted,
    // The real one: it calls the `$fetch` global installed by installNetwork().
    adminFetch,
  }
  // A name the file imports itself is not an auto-import (and would clash as a parameter).
  for (const [, names] of compiled.content.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const name of names!.split(',')) delete auto[name.split(/\s+as\s+/).at(-1)!.trim()]
  }

  const component = new Function('__modules', ...Object.keys(auto), code)(modules, ...Object.values(auto)) as {
    setup: (props: object, ctx: object) => Record<string, unknown>
  }
  const bindings = component.setup({}, {
    expose: (value?: Record<string, unknown>) => { Object.assign(exposed, value) },
    emit: (event: string) => { emitted.push(event) },
    attrs: {},
    slots: {},
  })
  const page = Vue.proxyRefs(bindings) as unknown as T
  const mount = async () => {
    for (const hook of mounted) await hook()
    await settle()
  }
  return { page, toasts, emitted, exposed, mount }
}

const lastToast = (toasts: Toast[], type: string) => toasts.filter(t => t.type === type).at(-1)?.message

// ─── components/admin/ai/AiProvidersTab.vue ─────────────────────────────────

type ProviderRow = { id: number, provider: string, label: string, baseUrl: string | null, isActive: boolean, apiKeyLastFour: string | null }
type PricingRow = { model: string, provider: string, label: string | null, isActive: boolean, promptCostPerMillion: number, completionCostPerMillion: number }

type ProvidersTab = {
  providers: ProviderRow[]
  pricingRows: PricingRow[]
  providersError: string | null
  providersLoading: boolean
  testResult: string | null
  newProviderError: string
  newModelError: string
  modelTestModal: { reply: string, error: string | null, costVnd: number } | null
  delifyUsage: { windowCostUsd: number | null } | null
  providerForm: { label: string, baseUrl: string, isActive: boolean, apiKey: string }
  newModelForm: { model: string, label: string, promptCostPerMillion: number, completionCostPerMillion: number, isActive: boolean }
  editModelForm: { label: string, promptCostPerMillion: number, completionCostPerMillion: number, isActive: boolean }
  loadProviders: () => Promise<void>
  toggleSelectProvider: (id: number) => void
  bulkDeleteProviders: () => Promise<void>
  toggleSelectModel: (model: string) => void
  bulkDeleteModels: () => Promise<void>
  openProviderEdit: (p: ProviderRow) => void
  saveProvider: () => Promise<void>
  testProvider: (id: number) => Promise<void>
  openCreateProvider: () => void
  createProvider: () => Promise<void>
  deleteProvider: (p: ProviderRow) => Promise<void>
  toggleModelActive: (m: PricingRow) => Promise<void>
  openAddModel: (provider: string) => void
  addModelToProvider: () => Promise<void>
  openEditModel: (m: PricingRow) => void
  saveEditModel: () => Promise<void>
  deleteModel: (m: PricingRow) => Promise<void>
  testCallModel: (provider: string, model: string) => Promise<void>
  syncDelifyPricing: () => Promise<void>
}

const providerRows = (): ProviderRow[] => [
  { id: 1, provider: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1', isActive: true, apiKeyLastFour: 'a1b2' },
  { id: 2, provider: 'openai', label: 'OpenAI', baseUrl: null, isActive: false, apiKeyLastFour: null },
]
// A model id with a slash: the path segment must stay `encodeURIComponent`-ed.
const pricingRows = (): PricingRow[] => [
  { model: 'org/flash', provider: 'delify', label: null, isActive: true, promptCostPerMillion: 1, completionCostPerMillion: 4 },
]

/** The AI admin API as the handlers under server/api/admin/ai/** answer it. */
function aiServer(override: Responder = () => undefined): Responder {
  return (call) => {
    const answer = override(call)
    if (answer) return answer
    const route = `${call.method} ${call.url.pathname}`
    if (route === 'GET /api/admin/ai/providers') {
      return json({ ok: true, providers: providerRows().map(p => ({ ...p, updatedAt: '2026-10-20T02:00:00.000Z', totalModels: 1, activeModels: 1 })) })
    }
    if (route === 'GET /api/admin/ai/pricing') return json({ ok: true, pricing: pricingRows().map(m => ({ ...m, updatedAt: null })) })
    if (route.endsWith('/bulk-delete')) return json({ ok: true, deleted: 2 })
    if (route === 'POST /api/admin/ai/providers/1/test') return json({ ok: true, model: 'glm-5.3' })
    if (route === 'POST /api/admin/ai/test-call') {
      return json({ ok: true, model: 'org/flash', provider: 'delify', reply: 'Xin chào.', durationMs: 420, usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 }, costVnd: 2 })
    }
    if (route === 'POST /api/admin/ai/delify/sync') {
      return json({ ok: true, upserted: 3, skipped: 0, syncedLogs: 2, totalFromApi: 3, delifyUsage: { windowCostUsd: 0.5, windowRequests: 7, allowedModels: null } })
    }
    return json({ ok: true })
  }
}

async function providersTab(override?: Responder) {
  const calls = installNetwork(aiServer(override))
  const run = await runSfc<ProvidersTab>(PROVIDERS_TAB)
  await run.mount()
  return { ...run, calls }
}

describe(`${PROVIDERS_TAB} — loading the providers and models`, () => {
  it('loads both lists on mount and keeps them on the refs the parent page reads through defineExpose', async () => {
    const { page, calls, exposed } = await providersTab()
    assert.deepEqual(calls.map(wire), ['GET /api/admin/ai/providers', 'GET /api/admin/ai/pricing'])
    assert.deepEqual(page.providers.map(p => p.provider), ['delify', 'openai'])
    assert.deepEqual(page.pricingRows.map(m => m.model), ['org/flash'])
    assert.equal(page.providersLoading, false)
    assert.equal(page.providersError, null)
    // ai/index.vue bridges `providers`/`pricingRows` to the Services and Logs tabs and
    // calls `loadProviders` on tab switch — the exposed surface must not change.
    assert.deepEqual(Object.keys(exposed).sort(), ['loadProviders', 'pricingRows', 'providers'])
    assert.ok(Vue.isRef(exposed.providers) && Vue.isRef(exposed.pricingRows))
    assert.equal(exposed.loadProviders, page.loadProviders)
  })

  it('a failed load shows the server\'s sentence — not ofetch\'s request line — and "Thử lại" recovers', async () => {
    let failing = true
    const { page, calls } = await providersTab(call =>
      failing && call.url.pathname === '/api/admin/ai/pricing' ? h3Error(400, 'Bảng giá model đang được cập nhật, thử lại sau.') : undefined)
    assert.equal(page.providersError, 'Bảng giá model đang được cập nhật, thử lại sau.')
    assert.equal(page.providersLoading, false)

    failing = false
    await page.loadProviders()
    assert.equal(page.providersError, null)
    assert.deepEqual(page.pricingRows.map(m => m.model), ['org/flash'])
    assert.equal(calls.length, 4, 'the retry re-runs exactly the two list requests')
  })

  it('a dropped connection shows the tab\'s own fallback, never the ofetch line', async () => {
    const { page } = await providersTab(call => (call.url.pathname === '/api/admin/ai/providers' ? dropped() : undefined))
    assert.equal(page.providersError, 'Không thể tải danh sách nhà cung cấp.')
    assert.doesNotMatch(String(page.providersError), /\[GET\]|fetch failed|<no response>/)
  })

  for (const [status, sentence] of [[401, 'Unauthorized: Invalid token'], [403, 'Forbidden: Insufficient permissions']] as const) {
    it(`${status}: shows the server's sentence in the same error branch and sends nothing more (no status branch, as before)`, async () => {
      const { page, calls } = await providersTab(call => (call.method === 'GET' ? h3Error(status, sentence) : undefined))
      assert.equal(page.providersError, sentence)
      assert.equal(page.providersLoading, false)
      assert.deepEqual(calls.map(wire), ['GET /api/admin/ai/providers', 'GET /api/admin/ai/pricing'])
    })
  }
})

describe(`${PROVIDERS_TAB} — actions`, () => {
  it('a failed action reports the server\'s sentence where it did before (toast, form error, test line)', async () => {
    const { page, toasts } = await providersTab((call) => {
      if (call.method === 'DELETE') return h3Error(409, 'Không thể xoá: nhà cung cấp "delify" đang được dùng bởi dịch vụ "chatbot".')
      if (call.method === 'POST' && call.url.pathname === '/api/admin/ai/providers') return h3Error(409, 'Nhà cung cấp "delify" đã tồn tại.')
      if (call.url.pathname === '/api/admin/ai/providers/1/test') return h3Error(403, 'Forbidden: Insufficient permissions')
      if (call.url.pathname === '/api/admin/ai/test-call') return h3Error(401, 'Unauthorized: Session revoked')
      return undefined
    })
    await page.deleteProvider(page.providers[0]!)
    assert.equal(lastToast(toasts, 'error'), 'Không thể xoá: nhà cung cấp "delify" đang được dùng bởi dịch vụ "chatbot".')

    page.openCreateProvider()
    await page.createProvider()
    assert.equal(page.newProviderError, 'Nhà cung cấp "delify" đã tồn tại.')

    await page.testProvider(1)
    assert.equal(page.testResult, 'Thất bại: Forbidden: Insufficient permissions')

    await page.testCallModel('delify', 'org/flash')
    assert.equal(page.modelTestModal?.error, 'Unauthorized: Session revoked')
  })

  it('a model test the provider refused (200 `{ ok: false, error }`) shows that error in the result modal', async () => {
    const { page, emitted } = await providersTab(call => (call.url.pathname === '/api/admin/ai/test-call'
      ? json({ ok: false, model: 'org/flash', durationMs: 31, error: 'Thất bại khi gọi API: hết hạn mức.' })
      : undefined))
    await page.testCallModel('delify', 'org/flash')
    assert.equal(page.modelTestModal?.error, 'Thất bại khi gọi API: hết hạn mức.')
    assert.equal(page.modelTestModal?.reply, '')
    assert.deepEqual(emitted, ['invalidate'])
  })

  it('every action sends the same requests as before — method, path, body, and the reloads after it', async () => {
    const { page, calls, toasts } = await providersTab()
    const sent = async (action: () => unknown) => {
      const from = calls.length
      await action()
      await settle()
      return calls.slice(from).map(call => ({ wire: wire(call), body: call.body }))
    }
    const reload = [{ wire: 'GET /api/admin/ai/providers', body: undefined }, { wire: 'GET /api/admin/ai/pricing', body: undefined }]
    const delify = page.providers[0]!

    page.toggleSelectProvider(1)
    page.toggleSelectProvider(2)
    assert.deepEqual(await sent(page.bulkDeleteProviders), [{ wire: 'POST /api/admin/ai/providers/bulk-delete', body: { ids: [1, 2] } }, ...reload])
    assert.equal(lastToast(toasts, 'success'), 'Đã xoá 2 nhà cung cấp.')

    page.toggleSelectModel('org/flash')
    assert.deepEqual(await sent(page.bulkDeleteModels), [{ wire: 'POST /api/admin/ai/pricing/bulk-delete', body: { models: ['org/flash'] } }, ...reload])

    page.openProviderEdit(delify)
    page.providerForm.apiKey = 'sk-new-key'
    assert.deepEqual(await sent(page.saveProvider), [{
      wire: 'PUT /api/admin/ai/providers/1',
      body: { label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1', isActive: true, apiKey: 'sk-new-key' },
    }, ...reload])

    assert.deepEqual(await sent(() => page.testProvider(1)), [{ wire: 'POST /api/admin/ai/providers/1/test', body: undefined }])
    assert.equal(page.testResult, 'Kết nối thành công (model: glm-5.3)')

    page.openCreateProvider()
    assert.deepEqual(await sent(page.createProvider), [{
      wire: 'POST /api/admin/ai/providers',
      body: { provider: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1', isActive: true, apiKey: null },
    }, ...reload])

    assert.deepEqual(await sent(() => page.deleteProvider(delify)), [{ wire: 'DELETE /api/admin/ai/providers/1', body: undefined }, ...reload])

    const model = page.pricingRows[0]!
    assert.deepEqual(await sent(() => page.toggleModelActive(model)), [{ wire: 'PUT /api/admin/ai/pricing/org%2Fflash', body: { isActive: false } }])
    assert.equal(model.isActive, false, 'the optimistic toggle stays after the server accepts it')

    page.openAddModel('delify')
    page.newModelForm.model = ' glm-6 '
    assert.deepEqual(await sent(page.addModelToProvider), [{
      wire: 'POST /api/admin/ai/pricing',
      body: { model: 'glm-6', provider: 'delify', label: null, isActive: true, promptCostPerMillion: 1, completionCostPerMillion: 4 },
    }, ...reload])

    page.openEditModel(page.pricingRows[0]!)
    page.editModelForm.label = 'Flash'
    assert.deepEqual(await sent(page.saveEditModel), [{
      wire: 'PUT /api/admin/ai/pricing/org%2Fflash',
      body: { label: 'Flash', promptCostPerMillion: 1, completionCostPerMillion: 4, isActive: true },
    }, ...reload])

    assert.deepEqual(await sent(() => page.deleteModel(page.pricingRows[0]!)), [{ wire: 'DELETE /api/admin/ai/pricing/org%2Fflash', body: undefined }, ...reload])

    assert.deepEqual(await sent(() => page.testCallModel('delify', 'org/flash')), [{
      wire: 'POST /api/admin/ai/test-call',
      body: { provider: 'delify', model: 'org/flash', serviceKey: 'test_call', message: 'Xin chào! Hãy phản hồi ngắn gọn 1 câu để kiểm tra kết nối.', maxTokens: 100 },
    }])
    assert.equal(page.modelTestModal?.reply, 'Xin chào.')
    assert.equal(page.modelTestModal?.costVnd, 2)

    assert.deepEqual(await sent(page.syncDelifyPricing), [{ wire: 'POST /api/admin/ai/delify/sync', body: undefined }, ...reload])
    assert.equal(page.delifyUsage?.windowCostUsd, 0.5)
    assert.equal(lastToast(toasts, 'success'), 'Đã đồng bộ 3 model và 2 cuộc gọi từ Delify Router.')
  })

  it('pricing is loaded with the providers only — the uncalled `loadPricing` is gone (no caller: not in the template, not exposed)', async () => {
    const { page, exposed } = await providersTab()
    assert.equal((page as unknown as Record<string, unknown>).loadPricing, undefined)
    assert.deepEqual(Object.keys(exposed).sort(), ['loadProviders', 'pricingRows', 'providers'])
  })
})

// ─── pages/admin/languages/index.vue ────────────────────────────────────────

type LanguageRow = { id: number, code: string, name: string, nativeName: string, isActive: boolean, isDefault: boolean, displayOrder: number }
type TranslationRow = { id: number, group: string, key: string, value: string, isAiTranslated: boolean }

type LanguagesPage = {
  loading: boolean
  loadError: string
  languages: LanguageRow[]
  translationsLoading: boolean
  translationsError: string
  translations: TranslationRow[]
  translationGroups: string[]
  viTranslationsMap: Map<string, string>
  selectedGroup: string
  searchQuery: string
  selectedLangCode: string
  fetchLanguages: () => Promise<void>
  fetchTranslations: () => Promise<void>
  addLanguage: (data: { code: string, name: string, nativeName: string, displayOrder: number }) => Promise<void>
  toggleActive: (lang: LanguageRow) => Promise<void>
  setDefault: (lang: LanguageRow) => Promise<void>
  deleteLanguage: (lang: LanguageRow) => Promise<void>
  shiftOrder: (index: number, direction: 'up' | 'down') => Promise<void>
  translateSingleKey: (t: TranslationRow) => Promise<void>
  saveEdit: (t: TranslationRow, value: string) => Promise<void>
  startBatchTranslateWithProgress: (langCode: string, langName: string) => Promise<void>
  seedDefaultTranslations: () => Promise<void>
  syncAllLanguages: () => Promise<void>
}

const LANGUAGE_ROWS: LanguageRow[] = [
  { id: 1, code: 'vi', name: 'Tiếng Việt', nativeName: 'Tiếng Việt', isActive: true, isDefault: true, displayOrder: 0 },
  { id: 2, code: 'en', name: 'English', nativeName: 'English', isActive: true, isDefault: false, displayOrder: 1 },
  { id: 3, code: 'fr', name: 'French', nativeName: 'Français', isActive: true, isDefault: false, displayOrder: 2 },
]

/** A lang_translations row as `GET /api/admin/languages/:code/translations` sends it. */
const record = (code: string, id: number, key: string, value: string | null, group = 'nav') =>
  ({ id, langCode: code, group, key, value, isAiTranslated: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: null })

const TRANSLATIONS: Record<string, ReturnType<typeof record>[]> = {
  vi: [record('vi', 1, 'home', 'Trang chủ'), record('vi', 2, 'news', 'Tin tức')],
  en: [record('en', 11, 'home', 'Home'), record('en', 12, 'news', null)],
  fr: [record('fr', 21, 'home', 'Accueil'), record('fr', 22, 'news', null)],
}

/** The languages admin API as server/api/admin/languages/** answers it. */
function languagesServer(override: Responder = () => undefined): Responder {
  return (call) => {
    const answer = override(call)
    if (answer) return answer
    const route = `${call.method} ${call.url.pathname}`
    if (route === 'GET /api/admin/languages') {
      return json({ ok: true, items: LANGUAGE_ROWS.map(l => ({ ...l, createdAt: null, updatedAt: null, stats: { totalKeys: 2, translatedKeys: 1, missingKeys: 1, aiKeys: 0, percent: 50 } })) })
    }
    const list = /^GET \/api\/admin\/languages\/(\w+)\/translations$/.exec(route)
    if (list) return json({ ok: true, items: TRANSLATIONS[list[1]!] ?? [], groups: ['nav'] })
    if (route === 'POST /api/admin/languages/ai-translate-key') return json({ ok: true, group: 'nav', key: 'news', value: 'News' })
    if (route === 'POST /api/admin/languages/ai-translate-chunk') return json({ ok: true, translated: [{ group: 'nav', key: 'news', value: 'Actualités' }] })
    if (route === 'POST /api/admin/languages/seed-default') {
      return json({ ok: true, result: { languagesSeeded: 0, translationsSeeded: 4 }, message: 'Đã nạp 0 ngôn ngữ và 4 bản dịch mặc định.' })
    }
    if (route === 'POST /api/admin/languages/sync') {
      return json({ ok: true, result: { synced: 0, totalViKeys: 2 }, message: 'Tất cả các ngôn ngữ đã được đồng bộ đầy đủ các khóa từ ngôn ngữ mặc định.' })
    }
    return json({ ok: true })
  }
}

async function languagesPage(override?: Responder, options?: { ignoreAbort?: boolean }) {
  const calls = installNetwork(languagesServer(override), options)
  const run = await runSfc<LanguagesPage>(LANGUAGES_PAGE)
  await run.mount()
  return { ...run, calls }
}

describe(`${LANGUAGES_PAGE} — loading`, () => {
  it('mount loads the languages, the translations table and the Vietnamese source map, then selects the first other active language', async () => {
    const { page, calls } = await languagesPage()
    assert.deepEqual(calls.map(wire), [
      'GET /api/admin/languages',
      'GET /api/admin/languages/en/translations',
      'GET /api/admin/languages/vi/translations',
    ])
    assert.deepEqual(page.languages.map(l => l.code), ['vi', 'en', 'fr'])
    assert.equal(page.selectedLangCode, 'en')
    assert.equal(page.loading, false)
    assert.equal(page.translationsLoading, false)
    assert.deepEqual(page.translationGroups, ['nav'])
  })

  it('a NULL translation reaches the table as "" — the type the table declares (RED before: the editor started from null)', async () => {
    const { page, calls } = await languagesPage()
    // `news` is NULL in lang_translations: added by "Đồng bộ key" / a new language, never translated.
    assert.deepEqual(page.translations.map(t => [t.key, t.value]), [['home', 'Home'], ['news', '']])
    for (const row of page.translations) assert.equal(typeof row.value, 'string', `${row.key}: TranslationsTab declares value: string`)

    // TranslationsTab's editor starts from `t.value` and emits it unchanged when "Lưu" is
    // pressed without typing; the PUT handler stores `String(i.value)`.
    const untouched = page.translations[1]!
    const from = calls.length
    await page.saveEdit(untouched, untouched.value)
    const put = calls.slice(from).find(c => c.method === 'PUT')!
    assert.deepEqual(put.body, { items: [{ group: 'nav', key: 'news', value: '' }] }, 'saving an untouched empty row must not send null (stored as the text "null")')
  })

  for (const [what, path, errorRef, fallback] of [
    ['the language list', '/api/admin/languages', 'loadError', 'Không thể tải danh sách ngôn ngữ.'],
    ['the translations table', '/api/admin/languages/en/translations', 'translationsError', 'Không thể tải bản dịch.'],
  ] as const) {
    it(`${what}: a failure shows the server's sentence, a dropped connection the page's fallback, and retry recovers`, async () => {
      let answer: (() => Response | Error) | null = () => h3Error(400, 'Mã ngôn ngữ bắt buộc.')
      const { page } = await languagesPage(call => (answer && call.url.pathname === path && call.url.search === '' ? answer() : undefined))
      assert.equal(page[errorRef], 'Mã ngôn ngữ bắt buộc.')

      answer = dropped
      await (errorRef === 'loadError' ? page.fetchLanguages() : page.fetchTranslations())
      assert.equal(page[errorRef], fallback)
      assert.doesNotMatch(page[errorRef], /\[GET\]|fetch failed|<no response>/)

      answer = null
      await (errorRef === 'loadError' ? page.fetchLanguages() : page.fetchTranslations())
      assert.equal(page[errorRef], '')
      assert.equal(page.loading, false)
      assert.equal(page.translationsLoading, false)
    })
  }

  for (const [status, sentence] of [[401, 'Unauthorized: No token'], [403, 'Forbidden: Insufficient permissions']] as const) {
    it(`${status}: both loads show the server's sentence in their own error branch, nothing more is sent (no status branch, as before)`, async () => {
      const { page, calls } = await languagesPage(call => (call.method === 'GET' ? h3Error(status, sentence) : undefined))
      assert.equal(page.loadError, sentence)
      assert.equal(page.translationsError, sentence)
      assert.equal(calls.length, 3, 'the three mount requests, no retry and no redirect')
    })
  }
})

describe(`${LANGUAGES_PAGE} — the translations table follows the latest filter`, () => {
  // No NULL values here, so each failure on the base is the race alone, not the '' fix.
  const ROWS: Record<string, ReturnType<typeof record>[]> = {
    en: [record('en', 11, 'home', 'Home'), record('en', 12, 'news', 'News')],
    fr: [record('fr', 21, 'home', 'Accueil'), record('fr', 22, 'news', 'Actualités')],
  }
  const answerFor = (code: string) => json({ ok: true, items: ROWS[code], groups: [`${code}-group`] })

  /** Start the table on `en`, then switch to `fr` while the `en` answer is still out. */
  async function switchLanguageMidFlight(options?: { ignoreAbort?: boolean }) {
    // Mount leaves the table empty, so a superseded answer that wrote anything would show.
    const { page } = await languagesPage(call => (call.url.pathname === '/api/admin/languages/en/translations' ? json({ ok: true, items: [], groups: [] }) : undefined))
    // From here on the test answers each request by hand.
    const manual = installNetwork(() => undefined, options)
    page.selectedLangCode = 'en'
    const older = page.fetchTranslations()
    // TranslationsTab: `@update:selected-lang-code` then `@fetch-translations`.
    page.selectedLangCode = 'fr'
    const newer = page.fetchTranslations()
    await settle()
    assert.deepEqual(manual.map(wire), ['GET /api/admin/languages/en/translations', 'GET /api/admin/languages/fr/translations'])
    return { page, older, newer, en: manual[0]!, fr: manual[1]! }
  }

  it('the older language\'s answer landing LAST does not replace the newer one (RED before)', async () => {
    const { page, older, newer, en, fr } = await switchLanguageMidFlight()
    fr.respond(answerFor('fr'))
    await settle()
    en.respond(answerFor('en'))
    await Promise.all([older, newer])
    await settle()
    assert.deepEqual(page.translations.map(t => t.value), ['Accueil', 'Actualités'])
    assert.deepEqual(page.translationGroups, ['fr-group'])
    assert.equal(page.translationsLoading, false)
    assert.equal(page.translationsError, '')
    assert.equal(en.signal?.aborted, true, 'the superseded request is cancelled on the wire')
  })

  it('an older answer arriving FIRST neither fills the table nor ends the skeleton while the newer is out (RED before)', async () => {
    const { page, older, newer, en, fr } = await switchLanguageMidFlight({ ignoreAbort: true })
    en.respond(answerFor('en'))
    await older
    await settle()
    assert.equal(page.translationsLoading, true, 'the skeleton stays until the current request answers')
    assert.deepEqual(page.translations, [], 'the superseded answer wrote no rows')
    assert.deepEqual(page.translationGroups, [], 'the superseded answer wrote no groups')

    fr.respond(answerFor('fr'))
    await newer
    assert.deepEqual(page.translations.map(t => t.value), ['Accueil', 'Actualités'])
    assert.deepEqual(page.translationGroups, ['fr-group'])
    assert.equal(page.translationsLoading, false)
  })

  it('an older request failing late does not put an error over the newer rows (RED before)', async () => {
    const { page, older, newer, en, fr } = await switchLanguageMidFlight({ ignoreAbort: true })
    fr.respond(answerFor('fr'))
    await newer
    en.respond(h3Error(403, 'Forbidden: Insufficient permissions'))
    await older
    await settle()
    // TranslationsTab shows its `#status` slot (the error) in place of the table while
    // `translationsError` is set: a stale error would hide the table.
    assert.equal(page.translationsError, '')
    assert.deepEqual(page.translations.map(t => t.value), ['Accueil', 'Actualités'])
  })
})

describe(`${LANGUAGES_PAGE} — actions`, () => {
  it('a failed action toasts the server\'s sentence', async () => {
    const { page, toasts } = await languagesPage(call => (call.method === 'DELETE' ? h3Error(409, 'Không thể xoá ngôn ngữ mặc định.') : undefined))
    await page.deleteLanguage(page.languages[0]!)
    assert.equal(lastToast(toasts, 'error'), 'Không thể xoá ngôn ngữ mặc định.')
  })

  it('deleting the language the translations tab is on moves the tab to a language that exists (RED before: it stayed on the deleted one and 404ed)', async () => {
    const deleted = new Set<string>()
    const { page } = await languagesPage((call) => {
      const route = `${call.method} ${call.url.pathname}`
      const removed = /^DELETE \/api\/admin\/languages\/(\w+)$/.exec(route)
      if (removed) { deleted.add(removed[1]!); return json({ ok: true }) }
      if (route === 'GET /api/admin/languages') {
        return json({ ok: true, items: LANGUAGE_ROWS.filter(l => !deleted.has(l.code)).map(l => ({ ...l, createdAt: null, updatedAt: null })) })
      }
      return undefined
    })
    assert.equal(page.selectedLangCode, 'en')
    await page.deleteLanguage(page.languages.find(l => l.code === 'fr')!)
    assert.equal(page.selectedLangCode, 'en', 'deleting another language leaves the selection alone')
    await page.deleteLanguage(page.languages.find(l => l.code === 'en')!)
    assert.equal(page.selectedLangCode, 'vi', 'the first remaining language (only vi is left)')
  })

  it('saving and AI-translating a row go to the language the row was loaded under, not the one selected now (RED before)', async () => {
    const { page, calls } = await languagesPage()
    // An en row still on screen while the selection already says fr (C1, verify of 85a22c7).
    const enRow = page.translations[1]!
    page.selectedLangCode = 'fr'
    const from = calls.length
    await page.saveEdit(enRow, 'News')
    await page.translateSingleKey(enRow)
    await settle()
    const writes = calls.slice(from).filter(call => call.method !== 'GET').map(call => ({ wire: wire(call), body: call.body }))
    assert.deepEqual(writes, [
      { wire: 'PUT /api/admin/languages/en/translations', body: { items: [{ group: 'nav', key: 'news', value: 'News' }] } },
      { wire: 'POST /api/admin/languages/ai-translate-key', body: { langCode: 'en', langName: 'English', group: 'nav', key: 'news', sourceText: 'Tin tức' } },
    ])
  })

  it('every action sends the same requests as before — method, path, query, body, and the reloads after it', async () => {
    const { page, calls, toasts } = await languagesPage()
    const sent = async (action: () => unknown) => {
      const from = calls.length
      await action()
      await settle()
      return calls.slice(from).map(call => (call.body === undefined ? wire(call) : { wire: wire(call), body: call.body }))
    }
    const reloadLanguages = 'GET /api/admin/languages'
    const reloadAll = [reloadLanguages, 'GET /api/admin/languages/en/translations', 'GET /api/admin/languages/vi/translations']
    const english = page.languages[1]!

    const added = { code: 'de', name: 'German', nativeName: 'Deutsch', displayOrder: 3 }
    assert.deepEqual(await sent(() => page.addLanguage(added)), [{ wire: 'POST /api/admin/languages', body: added }, reloadLanguages])
    assert.deepEqual(await sent(() => page.toggleActive(english)), [{ wire: 'PUT /api/admin/languages/en', body: { isActive: false } }, reloadLanguages])
    assert.deepEqual(await sent(() => page.setDefault(english)), [{ wire: 'PUT /api/admin/languages/en', body: { isDefault: true } }, reloadLanguages])
    assert.deepEqual(await sent(() => page.deleteLanguage(english)), ['DELETE /api/admin/languages/en', reloadLanguages])
    assert.deepEqual(await sent(() => page.shiftOrder(1, 'down')), [{
      wire: 'POST /api/admin/languages/reorder',
      body: { orders: [{ code: 'vi', displayOrder: 0 }, { code: 'fr', displayOrder: 1 }, { code: 'en', displayOrder: 2 }] },
    }, reloadLanguages])

    const news = page.translations[1]!
    assert.deepEqual(await sent(() => page.translateSingleKey(news)), [{
      wire: 'POST /api/admin/languages/ai-translate-key',
      body: { langCode: 'en', langName: 'English', group: 'nav', key: 'news', sourceText: 'Tin tức' },
    }, reloadLanguages])
    assert.equal(news.value, 'News', 'the translated value is written into the row in place')
    assert.equal(news.isAiTranslated, true)

    assert.deepEqual(await sent(() => page.saveEdit(page.translations[0]!, 'Homepage')), [{
      wire: 'PUT /api/admin/languages/en/translations',
      body: { items: [{ group: 'nav', key: 'home', value: 'Homepage' }] },
    }, 'GET /api/admin/languages/en/translations'])

    // The filters go out as the query string (the old code passed ofetch's `params` alias).
    page.selectedGroup = 'nav'
    page.searchQuery = 'trang chủ'
    assert.deepEqual(await sent(page.fetchTranslations), ['GET /api/admin/languages/en/translations?group=nav&search=trang+ch%E1%BB%A7'])
    page.selectedGroup = 'all'
    page.searchQuery = ''
    assert.deepEqual(await sent(page.fetchTranslations), ['GET /api/admin/languages/en/translations'])

    assert.deepEqual(await sent(page.seedDefaultTranslations), ['POST /api/admin/languages/seed-default', reloadLanguages, 'GET /api/admin/languages/en/translations'])
    assert.equal(lastToast(toasts, 'success'), 'Đã nạp 0 ngôn ngữ và 4 bản dịch mặc định.')
    assert.deepEqual(await sent(page.syncAllLanguages), ['POST /api/admin/languages/sync', ...reloadAll])
    assert.equal(lastToast(toasts, 'success'), 'Tất cả các ngôn ngữ đã được đồng bộ đầy đủ các khóa từ ngôn ngữ mặc định.')

    assert.deepEqual(await sent(() => page.startBatchTranslateWithProgress('fr', 'French')), [
      'GET /api/admin/languages/fr/translations',
      { wire: 'POST /api/admin/languages/ai-translate-chunk', body: { langCode: 'fr', langName: 'French', items: [{ group: 'nav', key: 'news', sourceText: 'Tin tức' }] } },
      ...reloadAll,
    ])
    assert.equal(lastToast(toasts, 'success'), 'Đã hoàn tất dịch 1/1 key cho French!')
  })
})

describe(`${LANGUAGES_PAGE} — more than 500 keys`, () => {
  // ~600 keys per language when this was found; the server used to cap a list at 500,
  // and both "every key" callers asked for `?limit=500`. This fake server keeps that
  // cap for a client that asks for it, so a client still asking is seen to lose keys.
  const COUNT = 581
  const pad = (n: number) => String(n).padStart(4, '0')
  const rows = (code: string, value: (n: number) => string | null, skip?: number) =>
    Array.from({ length: COUNT }, (_, i) => i + 1).filter(n => n !== skip)
      .map(n => record(code, n, `key-${pad(n)}`, value(n), 'ui'))
  const BIG: Record<string, ReturnType<typeof record>[]> = {
    vi: rows('vi', n => `Giá trị ${pad(n)}`),
    // en: everything translated except key-0560, and key-0581 has no en row at all.
    en: rows('en', n => (n === 560 ? null : `Value ${pad(n)}`), 581),
  }
  const bigServer: Responder = (call) => {
    const list = /^\/api\/admin\/languages\/(\w+)\/translations$/.exec(call.url.pathname)
    if (call.method !== 'GET' || !list) return undefined
    const limit = call.url.searchParams.get('limit')
    const items = BIG[list[1]!] ?? []
    return json({ ok: true, items: limit ? items.slice(0, Math.min(500, Number(limit))) : items, groups: ['ui'] })
  }

  it(`the Vietnamese source map holds all ${COUNT} keys (RED before: 500)`, async () => {
    const { page, calls } = await languagesPage(bigServer)
    assert.equal(page.viTranslationsMap.size, COUNT)
    assert.equal(page.viTranslationsMap.get(`ui::key-${pad(COUNT)}`), `Giá trị ${pad(COUNT)}`)
    assert.ok(calls.every(call => !call.url.searchParams.has('limit')), 'no list request asks for a capped page')
  })

  it('the missing-keys scan finds a blank key past row 500 and a key the language has no row for, each with its Vietnamese source (RED before: "100%")', async () => {
    const { page, calls, toasts } = await languagesPage(bigServer)
    const from = calls.length
    await page.startBatchTranslateWithProgress('en', 'English')
    const chunks = calls.slice(from).filter(call => call.url.pathname === '/api/admin/languages/ai-translate-chunk')
    assert.equal(chunks.length, 1, `toasts: ${JSON.stringify(toasts)}`)
    assert.deepEqual((chunks[0]!.body as { items: unknown[] }).items, [
      { group: 'ui', key: 'key-0560', sourceText: 'Giá trị 0560' },
      { group: 'ui', key: 'key-0581', sourceText: 'Giá trị 0581' },
    ])
    assert.equal(lastToast(toasts, 'info'), undefined, 'no "đã có bản dịch đầy đủ 100%" while two keys are untranslated')
  })
})

// ─── Source ──────────────────────────────────────────────────────────────────

/**
 * Files of the providers tab that still call or cast `$fetch`. Since the wave3 4.2 split the
 * tab is a family — the parent, its display parts (`components/admin/ai/providers/*.vue`)
 * and the two write composables — and every one of them must go through `adminFetch<T>()`.
 */
const bareFetchIn = (files: Array<{ file: string, source: string }>) =>
  files.filter(f => /\$fetch\b/.test(f.source)).map(f => f.file)

describe('source', () => {
  it('neither file calls or casts $fetch (RED before), and both still count as fetching for the coverage gates', () => {
    for (const file of [PROVIDERS_TAB, LANGUAGES_PAGE]) {
      const source = readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8')
      assert.doesNotMatch(source, /\$fetch\b/, `${file} still uses $fetch — go through adminFetch<T>()`)
      // tests/admin-error-retry-ui.test.ts and skeleton-loading-ui.test.ts find the views
      // to check with this pattern; a file it misses silently leaves both gates. The tab's
      // list load stays in the parent after the split, so the parent still matches.
      assert.match(source, ADMIN_FETCH_CALL, `${file} would drop out of the error/skeleton coverage gates`)
    }
  })

  it('no file of the split providers tab — parent, parts, composables — calls or casts $fetch', () => {
    assert.deepEqual(bareFetchIn(familyFiles(AI_PROVIDERS_TAB_FAMILY)), [])
  })

  it('proof: $fetch planted in a part or in a composable of the tab is caught', () => {
    const part = 'components/admin/ai/providers/ProviderEditModal.vue'
    const composable = 'composables/useAiModelWrites.ts'
    const plant = (file: string) => readAppFile(file).replace('</script>', "const x = await ($fetch as (u: string) => Promise<unknown>)('/api/x')\n</script>")
    const plantTs = (file: string) => `${readAppFile(file)}\nexport const leak = () => $fetch('/api/admin/ai/providers')\n`
    assert.deepEqual(bareFetchIn(familyFiles(AI_PROVIDERS_TAB_FAMILY, { [part]: plant(part) })), [part])
    assert.deepEqual(bareFetchIn(familyFiles(AI_PROVIDERS_TAB_FAMILY, { [composable]: plantTs(composable) })), [composable])
    // A NEW part dropped into the parts directory joins the scan too.
    const added = 'components/admin/ai/providers/ProviderExtra.vue'
    assert.deepEqual(bareFetchIn(familyFiles(AI_PROVIDERS_TAB_FAMILY, { [added]: '<script setup lang="ts">\n$fetch(\'/x\')\n</script>' })), [added])
  })
})
