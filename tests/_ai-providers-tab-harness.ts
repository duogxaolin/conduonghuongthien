/**
 * Harness for tests/admin-ai-providers-tab.test.ts — the "Nhà cung cấp & Models" tab of
 * `/admin/ai` (`app/components/admin/ai/AiProvidersTab.vue`, wave3 4.2).
 *
 * The REAL tab — `<script setup>`, template and, after the split, the real parts and
 * composables it imports — mounted on the minimal DOM of tests/_sfc-mount.ts, with REAL
 * ofetch + the real `adminFetch` over a fake network that answers like
 * `server/api/admin/ai/{providers,pricing,test-call,delify}/**` (same sentences, same status
 * codes, same shapes; the Base URL rule runs the server's own `checkProviderBaseUrl`).
 *
 * Stood in for:
 *   - `useToast()` / `useConfirm()` — every toast and every confirm request recorded; what
 *     `confirm()` answers is `answers.confirm`;
 *   - `<AdminModal>` — `AdminModalStandIn` below: the real one teleports to `<body>` and
 *     traps focus through `document`, which the minimal DOM has not. The stand-in renders
 *     everything a part passes it (title, `busy` → `aria-busy` + a close button that is
 *     disabled and refuses while busy, `size`, `icon`, the footer slot), so a part that
 *     drops `:busy` or forgets to forward `close` shows in the snapshots. The SAME stand-in
 *     is used for the original and the split file.
 *
 * Two environment variables, for running the SAME suite against another version of the
 * tab (red/green evidence on the original, the DOM proof of the split):
 *   AI_PROVIDERS_TAB_FILE=<file>     mount that file instead of app/components/admin/ai/AiProvidersTab.vue;
 *   AI_PROVIDERS_TAB_DOM_LOG=<file>  after every `settle()`, append one JSON line
 *                                    `{ test, step, html, calls, toasts, confirms, invalidates }`.
 */
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { errorMessage } from '../app/utils/errorMessage.ts'
import { checkProviderBaseUrl, normalizedProviderBaseUrl } from '../server/utils/ai/provider-url.ts'
import { byText, findAll, fire, mountSfc, textOf, type MiniElement, type MountedSfc } from './_sfc-mount.ts'

export const TAB = process.env.AI_PROVIDERS_TAB_FILE
  ? path.resolve(process.env.AI_PROVIDERS_TAB_FILE)
  : fileURLToPath(new URL('../app/components/admin/ai/AiProvidersTab.vue', import.meta.url))
const DOM_LOG = process.env.AI_PROVIDERS_TAB_DOM_LOG ? path.resolve(process.env.AI_PROVIDERS_TAB_DOM_LOG) : null

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

// ─── The AI admin API, as server/api/admin/ai/** answers it ──────────────────

export type ServerProvider = { id: number, provider: string, label: string, baseUrl: string | null, isActive: boolean, key: string | null }
export type ServerModel = { model: string, provider: string, label: string | null, isActive: boolean, promptCostPerMillion: number, completionCostPerMillion: number }

const API = '/api/admin/ai'
/** Obviously fake. The server never sends a key back — only its last four characters. */
export const STORED_KEY = 'sk-fake-stored-0000-a1b2'

export function aiServer() {
  const state = {
    providers: [
      { id: 1, provider: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.vn/v1', isActive: true, key: STORED_KEY },
      { id: 2, provider: 'openai', label: 'OpenAI', baseUrl: null, isActive: false, key: null },
    ] as ServerProvider[],
    // A model id with a slash: the path segment must stay `encodeURIComponent`-ed.
    models: [
      { model: 'org/flash', provider: 'delify', label: null, isActive: true, promptCostPerMillion: 1, completionCostPerMillion: 4 },
      { model: 'glm-5.3', provider: 'delify', label: 'GLM 5.3', isActive: false, promptCostPerMillion: 0.6, completionCostPerMillion: 2.2 },
    ] as ServerModel[],
    /** provider → service key using it (the 409 of DELETE). */
    linked: {} as Record<string, string>,
    nextId: 3,
    probe: { ok: true, model: 'glm-5.3' } as { ok: true, model?: string } | { ok: false, error: string },
    override: (() => undefined) as (call: NetCall) => Answer,
  }
  const lastFour = (key: string | null) => (key ? key.slice(-4) : null)
  const body = (call: NetCall) => (call.body ?? {}) as Record<string, unknown>

  const route = (call: NetCall): Response | Error => {
    const at = `${call.method} ${call.url.pathname}`
    const b = body(call)
    if (at === `GET ${API}/providers`) {
      return json({ ok: true, providers: state.providers.map(p => ({
        id: p.id, provider: p.provider, label: p.label, baseUrl: p.baseUrl, isActive: p.isActive, apiKeyLastFour: lastFour(p.key),
        updatedAt: '2026-10-20T02:00:00.000Z',
        totalModels: state.models.filter(m => m.provider === p.provider).length,
        activeModels: state.models.filter(m => m.provider === p.provider && m.isActive).length,
      })) })
    }
    if (at === `GET ${API}/pricing`) return json({ ok: true, pricing: state.models.map(m => ({ ...m, updatedAt: null })) })
    if (at === `POST ${API}/providers`) {
      const provider = typeof b.provider === 'string' ? b.provider.trim() : ''
      const label = typeof b.label === 'string' ? b.label.trim() : ''
      if (!provider) return h3Error(400, 'Tên nhà cung cấp (provider) là bắt buộc.')
      if (!label) return h3Error(400, 'Nhãn hiển thị (label) là bắt buộc.')
      let baseUrl: string | null = null
      if (typeof b.baseUrl === 'string' && b.baseUrl.trim()) {
        const checked = checkProviderBaseUrl(b.baseUrl)
        if (!checked.ok) return h3Error(400, checked.message)
        baseUrl = checked.url
      }
      if (state.providers.some(p => p.provider === provider)) return h3Error(409, `Nhà cung cấp "${provider}" đã tồn tại.`)
      const id = state.nextId++
      state.providers.push({ id, provider, label, baseUrl, isActive: b.isActive !== false, key: typeof b.apiKey === 'string' && b.apiKey.trim() ? b.apiKey.trim() : null })
      return json({ ok: true, id })
    }
    if (at === `POST ${API}/providers/bulk-delete`) {
      const ids = (Array.isArray(b.ids) ? b.ids : []).filter((id): id is number => typeof id === 'number')
      if (!ids.length) return h3Error(400, 'Vui lòng chọn ít nhất 1 nhà cung cấp để xoá.')
      const doomed = state.providers.filter(p => ids.includes(p.id))
      if (!doomed.length) return h3Error(404, 'Không tìm thấy nhà cung cấp nào.')
      const names = doomed.map(p => p.provider)
      state.models = state.models.filter(m => !names.includes(m.provider))
      state.providers = state.providers.filter(p => !ids.includes(p.id))
      return json({ ok: true, deleted: doomed.length })
    }
    const probe = /^POST \/api\/admin\/ai\/providers\/(\d+)\/test$/.exec(at)
    if (probe) return json(state.providers.some(p => p.id === Number(probe[1])) ? state.probe : { ok: false, error: 'Provider không tồn tại.' })
    const one = /^(PUT|DELETE) \/api\/admin\/ai\/providers\/(\d+)$/.exec(at)
    if (one) {
      const row = state.providers.find(p => p.id === Number(one[2]))
      if (!row) return h3Error(404, 'Provider không tồn tại.')
      if (one[1] === 'DELETE') {
        if (state.linked[row.provider]) return h3Error(409, `Không thể xoá: nhà cung cấp "${row.provider}" đang được dùng bởi dịch vụ "${state.linked[row.provider]}". Gán dịch vụ sang nhà cung cấp khác trước khi xoá.`)
        state.providers = state.providers.filter(p => p !== row)
        return json({ ok: true })
      }
      // server/api/admin/ai/providers/[id].put.ts, step by step.
      const apiKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : ''
      let baseUrl = row.baseUrl
      if (typeof b.baseUrl === 'string') {
        const raw = b.baseUrl.trim()
        if (raw !== (row.baseUrl ?? '').trim()) {
          let next: string | null = null
          if (raw) {
            const checked = checkProviderBaseUrl(raw)
            if (!checked.ok) return h3Error(400, checked.message)
            next = checked.url
          }
          const current = row.baseUrl ? normalizedProviderBaseUrl(row.baseUrl) : null
          if (next !== null && next !== current && row.key && !apiKey) {
            return h3Error(400, 'Đổi địa chỉ nhà cung cấp (Base URL) phải nhập lại API key trong cùng lần lưu.')
          }
          baseUrl = next
        }
      }
      if (typeof b.label === 'string' && b.label.trim()) row.label = b.label.trim()
      if (typeof b.isActive === 'boolean') row.isActive = b.isActive
      row.baseUrl = baseUrl
      if (apiKey) row.key = apiKey
      return json({ ok: true })
    }
    if (at === `POST ${API}/pricing`) {
      const model = typeof b.model === 'string' ? b.model.trim() : ''
      if (!model) return h3Error(400, 'Tên model là bắt buộc.')
      if (typeof b.provider !== 'string' || !b.provider.trim()) return h3Error(400, 'Nhà cung cấp là bắt buộc.')
      if (state.models.some(m => m.model === model)) return h3Error(409, `Model "${model}" đã tồn tại trong bảng giá.`)
      state.models.push({ model, provider: b.provider, label: typeof b.label === 'string' ? b.label.trim() || null : null, isActive: b.isActive !== false,
        promptCostPerMillion: Number(b.promptCostPerMillion), completionCostPerMillion: Number(b.completionCostPerMillion) })
      return json({ ok: true })
    }
    if (at === `POST ${API}/pricing/bulk-delete`) {
      const models = (Array.isArray(b.models) ? b.models : []) as string[]
      if (!models.length) return h3Error(400, 'Vui lòng chọn ít nhất 1 model để xoá.')
      state.models = state.models.filter(m => !models.includes(m.model))
      // The real handler answers the count it was SENT, not the rows it removed.
      return json({ ok: true, deleted: models.length })
    }
    const price = /^(PUT|DELETE) \/api\/admin\/ai\/pricing\/(.+)$/.exec(at)
    if (price) {
      const row = state.models.find(m => m.model === decodeURIComponent(price[2]!))
      if (price[1] === 'DELETE') {
        if (!row) return h3Error(404, 'Model pricing không tồn tại.')
        state.models = state.models.filter(m => m !== row)
        return json({ ok: true })
      }
      if (!row) return h3Error(404, 'Model không tồn tại.')
      if (typeof b.label === 'string') row.label = b.label.trim() || null
      if (typeof b.isActive === 'boolean') row.isActive = b.isActive
      if (typeof b.promptCostPerMillion === 'number') row.promptCostPerMillion = b.promptCostPerMillion
      if (typeof b.completionCostPerMillion === 'number') row.completionCostPerMillion = b.completionCostPerMillion
      return json({ ok: true })
    }
    if (at === `POST ${API}/test-call`) {
      return json({ ok: true, model: b.model, provider: b.provider, reply: 'Xin chào, tôi đang hoạt động.', durationMs: 420,
        usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 }, costVnd: 2 })
    }
    if (at === `POST ${API}/delify/sync`) {
      if (!state.providers.some(p => p.provider === 'delify')) return h3Error(404, 'Nhà cung cấp "delify" chưa được tạo. Vui lòng thêm Delify Router trong tab Nhà cung cấp trước.')
      state.models.push({ model: 'claude-opus-5', provider: 'delify', label: 'Claude Opus 5', isActive: true, promptCostPerMillion: 15, completionCostPerMillion: 75 })
      return json({ ok: true, upserted: 3, skipped: 0, syncedLogs: 2, totalFromApi: 3, delifyUsage: { windowCostUsd: 0.5, windowRequests: 7, allowedModels: null } })
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

export type AiServer = ReturnType<typeof aiServer>

// ─── <AdminModal> stand-in ───────────────────────────────────────────────────

export const AdminModalStandIn = Vue.defineComponent({
  name: 'AdminModal',
  props: { open: { type: Boolean, required: true }, title: { type: String, required: true }, busy: Boolean, size: { type: String, default: 'md' }, icon: { type: String, default: '' } },
  emits: ['close'],
  setup(props, { slots, emit }) {
    return () => (props.open
      ? Vue.h('div', { 'role': 'dialog', 'aria-modal': 'true', 'aria-label': props.title, 'aria-busy': props.busy ? 'true' : undefined, 'data-size': props.size, 'data-icon': props.icon || undefined }, [
          Vue.h('h2', props.title),
          Vue.h('button', { 'type': 'button', 'aria-label': 'Đóng', 'disabled': props.busy, 'onClick': () => { if (!props.busy) emit('close') } }),
          Vue.h('div', { 'data-slot': 'body' }, slots.default?.()),
          slots.footer ? Vue.h('footer', slots.footer()) : null,
        ])
      : null)
  },
})

// ─── Mounting the tab ────────────────────────────────────────────────────────

export type Toast = { type: string, message: string }
export type ConfirmRequest = { title?: string, message?: string, danger?: boolean, confirmLabel?: string }
export type ExposedTab = { loadProviders: () => Promise<void>, providers: Array<{ provider: string }>, pricingRows: Array<{ model: string }> }

async function settleOnly() {
  for (let i = 0; i < 12; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}

export async function mountTab(t: TestContext, server = aiServer()) {
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
  const invalidates = { count: 0 }

  const page = await mountSfc(TAB, {
    auto: {
      ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
      onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted, onBeforeUnmount: Vue.onBeforeUnmount,
      useToast: () => toast,
      useConfirm: () => ({ confirm: async (request: ConfirmRequest) => { confirms.push(request); return answers.confirm } }),
      adminFetch,
      errorMessage,
    },
    modules: { '~/components/admin/AdminModal.vue': { default: AdminModalStandIn } },
  }, { onInvalidate: () => { invalidates.count += 1 } })

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
    if (DOM_LOG) appendFileSync(DOM_LOG, `${JSON.stringify({ test: t.fullName, step: step++, html: page.html(), calls: sent(calls), toasts, confirms, invalidates: invalidates.count })}\n`)
  }
  const exposed = page.instance as unknown as ExposedTab
  return { page, server, calls, toasts, confirms, answers, invalidates, exposed, settle, close }
}

export type TabCtx = Awaited<ReturnType<typeof mountTab>>

export async function openTab(t: TestContext, server = aiServer()) {
  const ctx = await mountTab(t, server)
  await ctx.settle()
  return ctx
}

// ─── Reading and driving the tab ─────────────────────────────────────────────

export const root = (from: MiniElement | MountedSfc) => ('root' in from ? from.root : from)
/** Visible text with ONE space between text nodes (`textOf` glues `<td>a</td><td>b</td>` into "ab"). */
export function spaced(from: MiniElement | MountedSfc): string {
  const parts: string[] = []
  const walk = (node: MiniElement['children'][number]) => {
    if (node.kind === 'text') parts.push(node.text)
    else if (node.kind === 'element') node.children.forEach(walk)
  }
  root(from).children.forEach(walk)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
/** The cells of a table row, one string each. */
export const cellsOf = (tr: MiniElement) => findAll(tr, el => el.tag === 'td').map(textOf)
export const alerts = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.props.role === 'alert').map(textOf)
export const skeleton = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'status' && el.props['aria-busy'] === 'true')[0] ?? null
export const dialogs = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'dialog')
export function dialog(page: MountedSfc, title?: string): MiniElement {
  const open = dialogs(page).filter(d => title === undefined || d.props['aria-label'] === title)
  if (open.length !== 1) throw new Error(`expected one open dialog${title ? ` "${title}"` : ''}, found ${open.length}: ${JSON.stringify(dialogs(page).map(d => d.props['aria-label']))}`)
  return open[0]!
}
/** The card of one provider, found by its heading. */
export function card(page: MountedSfc, label: string): MiniElement {
  const found = findAll(page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('rounded-xl border border-line bg-white overflow-hidden')
    && findAll(el, h => h.tag === 'h2' && textOf(h) === label).length > 0)
  if (found.length !== 1) throw new Error(`expected one card "${label}", found ${found.length}`)
  return found[0]!
}
export const cards = (page: MountedSfc) => findAll(page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('rounded-xl border border-line bg-white overflow-hidden'))
export const button = (from: MiniElement | MountedSfc, text: string) => byText(root(from), 'button', text)
export const buttonsWith = (from: MiniElement | MountedSfc, text: string) => findAll(root(from), el => el.tag === 'button' && textOf(el).includes(text))
/** The model row of a pricing table, by its model id cell. */
export function row(from: MiniElement | MountedSfc, model: string): MiniElement {
  const found = findAll(root(from), el => el.tag === 'tr' && findAll(el, td => td.tag === 'td' && textOf(td) === model).length > 0)
  if (found.length !== 1) throw new Error(`expected one row "${model}", found ${found.length}`)
  return found[0]!
}
/** The control inside the `<label>` whose caption is `caption` (a dialog field). */
export function field(from: MiniElement, caption: string): MiniElement {
  const labels = findAll(from, el => el.tag === 'label' && findAll(el, s => s.tag === 'span' && textOf(s) === caption).length > 0)
  if (labels.length !== 1) throw new Error(`expected one field "${caption}", found ${labels.length}`)
  const control = findAll(labels[0]!, el => el.tag === 'input' || el.tag === 'select')
  if (control.length !== 1) throw new Error(`field "${caption}" holds ${control.length} controls`)
  return control[0]!
}
export const checkboxes = (from: MiniElement) => findAll(from, el => el.tag === 'input' && el.props.type === 'checkbox')
/** Tick a `:checked` + `@change` checkbox (not a v-model one). */
export const tick = (el: MiniElement) => fire(el, 'change')
export const modelOf = (el: MiniElement) => el.model?.value
export const lastToast = (toasts: Toast[], type: string) => toasts.filter(x => x.type === type).at(-1)?.message

export { textOf, findAll }
