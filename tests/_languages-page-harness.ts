/**
 * Harness for tests/admin-languages-page.test.ts — `/admin/languages`
 * (`app/pages/admin/languages/index.vue`, wave3 4.2).
 *
 * The REAL page — `<script setup>`, template and everything it imports — mounted on the
 * minimal DOM of tests/_sfc-mount.ts: the real `LanguagesListTab` and `TranslationsTab`,
 * after the split the real parts and composables too, over REAL ofetch + the real
 * `adminFetch` on a fake network that answers like `server/api/admin/languages/**` (same
 * sentences, status codes and shapes; a translation list carries the vi keys the language
 * has no row for as `id: null` rows, as `listTranslations` does).
 *
 * Stood in for:
 *   - `useToast()` / `useConfirm()` — every toast and confirm request recorded; what
 *     `confirm()` answers is `answers.confirm`;
 *   - `<AdminModal>` — `AdminModalStandIn` of tests/_ai-providers-tab-harness.ts (the same
 *     one the providers tab uses): title, `busy` (✕ disabled and refusing), `size`, `icon`
 *     and the footer are all in the snapshot, so a part that drops `:busy` or the spinning
 *     `:icon` shows;
 *   - `<SkeletonTable>` — a marker carrying its label/rows/cols (its own contract is
 *     tests/skeleton-loading-ui.test.ts);
 *   - `UniversalTab` — a marker: the "Dịch toàn cục" tab fetches and polls on its own and has
 *     its own suite (tests/admin-fetch-rollout-universal-translate.test.ts);
 *   - `window.scrollTo` — recorded.
 *
 * Two environment variables, for running the SAME suite against another version of the page
 * (red/green evidence on the original, the DOM proof of the split):
 *   LANGUAGES_PAGE_FILE=<file>     mount that file instead of app/pages/admin/languages/index.vue;
 *   LANGUAGES_PAGE_DOM_LOG=<file>  after every `settle()`, append one JSON line
 *                                  `{ test, step, html, calls, toasts, confirms, scrolls }`.
 */
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { errorMessage } from '../app/utils/errorMessage.ts'
import { AdminModalStandIn } from './_ai-providers-tab-harness.ts'
import { byText, findAll, mountSfc, textOf, type MiniElement, type MountedSfc } from './_sfc-mount.ts'

export const PAGE = process.env.LANGUAGES_PAGE_FILE
  ? path.resolve(process.env.LANGUAGES_PAGE_FILE)
  : fileURLToPath(new URL('../app/pages/admin/languages/index.vue', import.meta.url))
const DOM_LOG = process.env.LANGUAGES_PAGE_DOM_LOG ? path.resolve(process.env.LANGUAGES_PAGE_DOM_LOG) : null

// ─── Fake network under real ofetch ──────────────────────────────────────────

export type NetCall = { method: string, url: URL, body: unknown, respond: (r: Response) => void, fail: (e: Error) => void }

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 502: 'Bad Gateway' }
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })
/** What `throw createError({ statusCode, statusMessage })` sends from a Nitro handler. */
export const h3Error = (statusCode: number, statusMessage: string) => json({ statusCode, statusMessage, message: statusMessage }, statusCode)
export const dropped = () => new TypeError('fetch failed')
export const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`
export const sent = (calls: NetCall[], from = 0) =>
  calls.slice(from).map(call => (call.body === undefined ? wire(call) : { wire: wire(call), body: call.body }))
/** ofetch's own line — `[GET] "/api/…": 403 Forbidden` — must never reach a person. */
export const OFETCH_LINE = /\[(GET|POST|PUT|DELETE)\]|<no response>|fetch failed/

/** Leave the request unanswered; the test answers it with `server.answer(call)` or `call.respond(…)`. */
export const HOLD = Symbol('hold')
type Answer = Response | Error | typeof HOLD | undefined

// ─── The languages admin API, as server/api/admin/languages/** answers it ────

export type ServerLanguage = { id: number, code: string, name: string, nativeName: string, isActive: boolean, isDefault: boolean, displayOrder: number }
export type ServerRow = { group: string, key: string, value: string | null, isAiTranslated: boolean }

const API = '/api/admin/languages'
const row = (group: string, key: string, value: string | null, isAiTranslated = false): ServerRow => ({ group, key, value, isAiTranslated })

export function languagesServer() {
  const state = {
    languages: [
      { id: 1, code: 'vi', name: 'Tiếng Việt', nativeName: 'Tiếng Việt', isActive: true, isDefault: true, displayOrder: 0 },
      { id: 2, code: 'en', name: 'English', nativeName: 'English', isActive: true, isDefault: false, displayOrder: 1 },
      { id: 3, code: 'fr', name: 'French', nativeName: 'Français', isActive: true, isDefault: false, displayOrder: 2 },
      { id: 4, code: 'lo', name: 'Lao', nativeName: 'ພາສາລາວ', isActive: false, isDefault: false, displayOrder: 3 },
    ] as ServerLanguage[],
    rows: {
      vi: [row('nav', 'home', 'Trang chủ'), row('nav', 'news', 'Tin tức'), row('footer', 'contact', 'Liên hệ')],
      en: [row('nav', 'home', 'Home'), row('nav', 'news', null), row('footer', 'contact', 'Contact')],
      fr: [row('nav', 'home', 'Accueil'), row('nav', 'news', 'Actualités'), row('footer', 'contact', 'Contact')],
      lo: [],
    } as Record<string, ServerRow[]>,
    /** What `seed-default` inserts when it runs (vi rows only, as most seed keys carry vi alone). */
    seedRows: [row('footer', 'hotline', 'Đường dây nóng')] as ServerRow[],
    nextId: 5,
    override: (() => undefined) as (call: NetCall) => Answer,
  }
  const body = (call: NetCall) => (call.body ?? {}) as Record<string, unknown>
  const byCode = (code: string) => state.languages.find(l => l.code === code)
  const viKeys = () => state.rows.vi!.map(r => `${r.group}::${r.key}`)
  const stats = (code: string) => {
    const own = new Map((state.rows[code] ?? []).map(r => [`${r.group}::${r.key}`, r]))
    const total = viKeys().length
    const translated = viKeys().filter(id => (own.get(id)?.value ?? '').trim() !== '').length
    const aiKeys = [...own.values()].filter(r => r.isAiTranslated).length
    return { totalKeys: total, translatedKeys: translated, missingKeys: total - translated, aiKeys, percent: total ? Math.round(translated / total * 100) : 100 }
  }
  /** `listTranslations`: the language's rows, plus every vi key it has none for (`id: null`). */
  const list = (code: string, group?: string, search?: string) => {
    const own = state.rows[code] ?? []
    const have = new Set(own.map(r => `${r.group}::${r.key}`))
    let id = 0
    const items = [
      ...own.map(r => ({ id: ++id, langCode: code, ...r })),
      ...(code === 'vi' ? [] : state.rows.vi!.filter(r => !have.has(`${r.group}::${r.key}`)).map(r => ({ id: null, langCode: code, group: r.group, key: r.key, value: null, isAiTranslated: false }))),
    ].filter(r => (!group || r.group === group) && (!search || `${r.key} ${r.value ?? ''}`.toLowerCase().includes(search.toLowerCase())))
      .map(r => ({ ...r, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: null }))
    return { ok: true, items, groups: [...new Set((code === 'vi' ? own : [...own, ...state.rows.vi!]).map(r => r.group))].sort() }
  }
  const upsert = (code: string, group: string, key: string, value: string, isAiTranslated: boolean) => {
    const rows = (state.rows[code] ??= [])
    const found = rows.find(r => r.group === group && r.key === key)
    if (found) Object.assign(found, { value, isAiTranslated })
    else rows.push(row(group, key, value, isAiTranslated))
  }
  /** The fake AI: the source text it was given is visible in what it answers. */
  const ai = (code: string, sourceText: string) => `AI(${code}): ${sourceText}`

  const route = (call: NetCall): Response | Error => {
    const at = `${call.method} ${call.url.pathname}`
    const b = body(call)
    if (at === `GET ${API}`) {
      return json({ ok: true, items: [...state.languages].sort((a, b) => a.displayOrder - b.displayOrder).map(l => ({ ...l, createdAt: null, updatedAt: null, stats: stats(l.code) })) })
    }
    if (at === `POST ${API}`) {
      const code = typeof b.code === 'string' ? b.code.trim() : ''
      if (!code || !b.name || !b.nativeName) return h3Error(400, 'Thiếu mã, tên hoặc tên bản địa.')
      if (byCode(code)) return h3Error(409, 'Mã ngôn ngữ đã tồn tại.')
      const id = state.nextId++
      state.languages.push({ id, code, name: String(b.name), nativeName: String(b.nativeName), isActive: true, isDefault: false, displayOrder: Number(b.displayOrder) || 0 })
      state.rows[code] = []
      return json({ ok: true, id })
    }
    if (at === `POST ${API}/reorder`) {
      const orders = Array.isArray(b.orders) ? b.orders as Array<{ code: string, displayOrder: number }> : []
      if (!orders.length) return h3Error(400, 'Không có dữ liệu sắp xếp.')
      for (const o of orders) { const l = byCode(o.code); if (l) l.displayOrder = o.displayOrder }
      return json({ ok: true, message: 'Đã cập nhật thứ tự ngôn ngữ thành công.' })
    }
    if (at === `POST ${API}/seed-default`) {
      let seeded = 0
      for (const r of state.seedRows) {
        if (state.rows.vi!.some(v => v.group === r.group && v.key === r.key)) continue
        state.rows.vi!.push({ ...r })
        seeded++
      }
      return json({ ok: true, result: { languagesSeeded: 0, translationsSeeded: seeded }, message: `Đã nạp 0 ngôn ngữ và ${seeded} bản dịch mặc định.` })
    }
    if (at === `POST ${API}/sync`) {
      let synced = 0
      for (const l of state.languages) {
        if (l.code === 'vi') continue
        for (const v of state.rows.vi!) {
          const rows = (state.rows[l.code] ??= [])
          if (rows.some(r => r.group === v.group && r.key === v.key)) continue
          rows.push(row(v.group, v.key, null))
          synced++
        }
      }
      return json({ ok: true, result: { synced, totalViKeys: state.rows.vi!.length }, message: synced
        ? `Đã đồng bộ ${synced} khóa còn thiếu sang các ngôn ngữ.`
        : 'Tất cả các ngôn ngữ đã được đồng bộ đầy đủ các khóa từ ngôn ngữ mặc định.' })
    }
    if (at === `POST ${API}/ai-translate-key`) {
      const code = String(b.langCode)
      const value = ai(code, String(b.sourceText))
      upsert(code, String(b.group), String(b.key), value, true)
      return json({ ok: true, group: b.group, key: b.key, value })
    }
    if (at === `POST ${API}/ai-translate-chunk`) {
      const code = String(b.langCode)
      const items = Array.isArray(b.items) ? b.items as Array<{ group: string, key: string, sourceText: string }> : []
      const translated = items.map(i => ({ group: i.group, key: i.key, value: ai(code, i.sourceText) }))
      for (const t of translated) upsert(code, t.group, t.key, t.value, true)
      return json({ ok: true, translated })
    }
    const translations = new RegExp(`^(GET|PUT) ${API}/([\\w-]+)/translations$`).exec(at)
    if (translations) {
      const code = translations[2]!
      if (!byCode(code)) return h3Error(404, 'Ngôn ngữ không tồn tại.')
      if (translations[1] === 'GET') return json(list(code, call.url.searchParams.get('group') ?? undefined, call.url.searchParams.get('search') ?? undefined))
      const items = Array.isArray(b.items) ? b.items as Array<{ group: string, key: string, value: string }> : []
      for (const i of items) upsert(code, i.group, i.key, String(i.value), false)
      return json({ ok: true, count: items.length })
    }
    const one = new RegExp(`^(PUT|DELETE) ${API}/([\\w-]+)$`).exec(at)
    if (one) {
      const lang = byCode(one[2]!)
      if (!lang) return h3Error(404, 'Ngôn ngữ không tồn tại.')
      if (one[1] === 'DELETE') {
        if (lang.isDefault) return h3Error(400, 'Không thể xoá ngôn ngữ mặc định.')
        state.languages = state.languages.filter(l => l !== lang)
        delete state.rows[lang.code]
        return json({ ok: true })
      }
      if (typeof b.isActive === 'boolean') lang.isActive = b.isActive
      if (b.isDefault === true) for (const l of state.languages) l.isDefault = l === lang
      return json({ ok: true })
    }
    throw new Error(`unexpected request ${wire(call)}`)
  }
  const respond = (call: NetCall): Answer => state.override(call) ?? route(call)
  /** Answer a held request now, as the real handler would (state read at THIS moment). */
  const answer = (call: NetCall) => {
    const response = route(call)
    if (response instanceof Error) call.fail(response)
    else call.respond(response)
  }
  return { state, respond, answer }
}

export type LanguagesServer = ReturnType<typeof languagesServer>

// ─── Stand-ins ───────────────────────────────────────────────────────────────

const SkeletonTableStandIn = Vue.defineComponent({
  name: 'SkeletonTable',
  props: { label: String, rows: Number, cols: Number },
  setup: props => () => Vue.h('div', { 'role': 'status', 'aria-busy': 'true', 'data-skeleton': props.label, 'data-rows': props.rows, 'data-cols': props.cols }),
})

const UniversalTabStandIn = Vue.defineComponent({
  name: 'UniversalTab',
  setup: () => () => Vue.h('div', { 'data-stub': 'UniversalTab' }),
})

// ─── Mounting the page ───────────────────────────────────────────────────────

export type Toast = { type: string, message: string }
export type ConfirmRequest = { title?: string, message?: string, danger?: boolean, confirmLabel?: string }

async function settleOnly() {
  for (let i = 0; i < 12; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}

export async function mountPage(t: TestContext, server = languagesServer()) {
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
    init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
    calls.push(call)
    const answer = server.respond(call)
    if (answer === HOLD) return
    if (answer instanceof Error) reject(answer)
    else if (answer) resolve(answer)
  })
  const g = globalThis as Record<string, unknown>
  const before = g.$fetch
  g.$fetch = createFetch({ fetch: fetchImpl as typeof fetch })

  const toasts: Toast[] = []
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type => [type, (message: string) => { toasts.push({ type, message }) }]))
  const confirms: ConfirmRequest[] = []
  const answers = { confirm: true }
  const scrolls: unknown[] = []

  const page = await mountSfc(PAGE, {
    auto: {
      ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
      onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted, onBeforeUnmount: Vue.onBeforeUnmount,
      definePageMeta: () => {},
      useToast: () => toast,
      useConfirm: () => ({ confirm: async (request: ConfirmRequest) => { confirms.push(request); return answers.confirm } }),
      adminFetch,
      errorMessage,
      window: { scrollTo: (options: unknown) => { scrolls.push(options) } },
    },
    modules: {
      '~/composables/useToast': { useToast: () => toast },
      '~/components/admin/AdminModal.vue': { default: AdminModalStandIn },
      '~/components/admin/languages/UniversalTab.vue': { default: UniversalTabStandIn },
    },
    components: { SkeletonTable: SkeletonTableStandIn },
  })

  let open = true
  const close = () => {
    if (!open) return
    open = false
    page.unmount()
    g.$fetch = before
  }
  t.after(close)

  let step = 0
  const settle = async () => {
    await settleOnly()
    if (DOM_LOG) appendFileSync(DOM_LOG, `${JSON.stringify({ test: t.fullName, step: step++, html: page.html(), calls: sent(calls), toasts, confirms, scrolls })}\n`)
  }
  return { page, server, calls, toasts, confirms, answers, scrolls, settle, close }
}

export type PageCtx = Awaited<ReturnType<typeof mountPage>>

export async function openPage(t: TestContext, server = languagesServer()) {
  const ctx = await mountPage(t, server)
  await ctx.settle()
  return ctx
}

// ─── Reading and driving the page ────────────────────────────────────────────

export const root = (from: MiniElement | MountedSfc) => ('root' in from ? from.root : from)
export const alerts = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.props.role === 'alert')
export const skeletons = (page: MountedSfc) => findAll(page.root, el => el.props['data-skeleton'] !== undefined).map(el => String(el.props['data-skeleton']))
export const dialogs = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'dialog')
export function dialog(page: MountedSfc, title?: string | RegExp): MiniElement {
  const matches = (label: unknown) => title === undefined || (typeof title === 'string' ? label === title : title.test(String(label)))
  const open = dialogs(page).filter(d => matches(d.props['aria-label']))
  if (open.length !== 1) throw new Error(`expected one open dialog${title ? ` "${title}"` : ''}, found ${open.length}: ${JSON.stringify(dialogs(page).map(d => d.props['aria-label']))}`)
  return open[0]!
}
/** The stand-in's ✕ (aria-label "Đóng", no text) — distinct from a footer button reading "Đóng". */
export const closeX = (d: MiniElement) => findAll(d, el => el.tag === 'button' && el.props['aria-label'] === 'Đóng')[0]!
export const button = (from: MiniElement | MountedSfc, text: string) => byText(root(from), 'button', text)
export const buttonsWith = (from: MiniElement | MountedSfc, text: string) => findAll(root(from), el => el.tag === 'button' && textOf(el).includes(text))
export const byTitle = (from: MiniElement | MountedSfc, title: string) => findAll(root(from), el => el.tag === 'button' && el.props.title === title)
/** The card of one language, found by its native name heading. */
export function card(page: MountedSfc, code: string): MiniElement {
  const found = findAll(page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('rounded-xl border bg-white p-4')
    && findAll(el, s => s.tag === 'span' && textOf(s) === `(${code})`).length > 0)
  if (found.length !== 1) throw new Error(`expected one card "${code}", found ${found.length}`)
  return found[0]!
}
export const cardCodes = (page: MountedSfc) => findAll(page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('rounded-xl border bg-white p-4'))
  .map(c => findAll(c, s => s.tag === 'span' && /^\(.+\)$/.test(textOf(s)))[0]).map(s => (s ? textOf(s).slice(1, -1) : '?'))
/** Data rows of the translations table (desktop `<tr>` with cells). */
export const tableRows = (page: MountedSfc) => findAll(page.root, el => el.tag === 'tr' && el.parent?.tag === 'tbody' && el.children.filter(c => c.kind === 'element' && c.tag === 'td').length > 1)
export const lastToast = (toasts: Toast[], type: string) => toasts.filter(x => x.type === type).at(-1)?.message
export const tabButton = (page: MountedSfc, label: string) => findAll(page.root, el => el.tag === 'button' && textOf(el).includes(label) && String(el.props.class ?? '').includes('border-b-2'))[0]!

export { textOf, findAll }
