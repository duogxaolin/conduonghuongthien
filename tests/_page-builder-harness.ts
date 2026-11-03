/**
 * Harness for tests/admin-page-builder.test.ts — the page builder
 * (`app/pages/admin/content/pages/[id].vue`, wave3 4.2).
 *
 * The REAL page — `<script setup>`, template and, after the split, the real parts and
 * composables it imports — and the REAL recursive tree navigator (`BlockTreeNode.vue`, which
 * reaches the page through `inject('builderTree')`), mounted on the minimal DOM of
 * tests/_sfc-mount.ts over REAL ofetch + the real `adminFetch` on a fake network that answers
 * like `server/api/admin/pages/[id]/**` (same shapes and sentences; publish gives every new
 * node an id, as `publish.post.ts` does).
 *
 * Stood in for:
 *   - `useToast()` / `useConfirm()` — recorded; `confirm()` answers `answers.confirm`;
 *   - `useRoute()` — `{ params: { id: '5' } }`;
 *   - `<AdminModal>` — `AdminModalStandIn` of tests/_ai-providers-tab-harness.ts: title,
 *     `busy` (✕ disabled), `size`, `icon` and the footer are in the snapshot;
 *   - `BuilderCanvas` — the live preview is an iframe of the public site. The stand-in shows
 *     what the page hands it (block count, selected id, viewport, preview path) and offers
 *     its two events: one "select" button per root block and the three viewport buttons;
 *   - `PropertyPanel` — the real one edits every block field (TinyMCE, image picker). The
 *     stand-in shows what the page hands it (`block`, `index`, `total`) and carries the
 *     panel's action bar — same titles, same disabled rules, same events — plus one text box
 *     that writes `block.data.title` in place, as the real fields do.
 *
 * Environment variables, to run the SAME suite on another version of the page:
 *   PAGE_BUILDER_FILE=<file>     mount that file instead of app/pages/admin/content/pages/[id].vue;
 *   PAGE_BUILDER_DOM_LOG=<file>  after every `settle()`, append one JSON line
 *                                `{ test, step, html, calls, toasts, confirms }`.
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
import { byText, findAll, loadSfc, mountSfc, textOf, type MiniElement, type MountedSfc, type SfcEnv } from './_sfc-mount.ts'

export const PAGE = process.env.PAGE_BUILDER_FILE
  ? path.resolve(process.env.PAGE_BUILDER_FILE)
  : fileURLToPath(new URL('../app/pages/admin/content/pages/[id].vue', import.meta.url))
const DOM_LOG = process.env.PAGE_BUILDER_DOM_LOG ? path.resolve(process.env.PAGE_BUILDER_DOM_LOG) : null

// ─── Fake network under real ofetch ──────────────────────────────────────────

export type NetCall = { method: string, url: URL, body: unknown, respond: (r: Response) => void, fail: (e: Error) => void }

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict' }
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })
export const h3Error = (statusCode: number, statusMessage: string) => json({ statusCode, statusMessage, message: statusMessage }, statusCode)
export const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`
export const sent = (calls: NetCall[], from = 0) =>
  calls.slice(from).map(call => (call.body === undefined ? wire(call) : { wire: wire(call), body: call.body }))
export const OFETCH_LINE = /\[(GET|POST|PUT|DELETE)\]|<no response>|fetch failed/
export const HOLD = Symbol('hold')
type Answer = Response | Error | typeof HOLD | undefined

// ─── The pages admin API, as server/api/admin/pages/[id]/** answers it ───────

export type ServerBlock = { id?: number, blockType: string, displayOrder?: number, data: Record<string, unknown>, isVisible: boolean, colSpan?: number, children?: ServerBlock[] }
export type ServerVersion = { id: number, kind: 'origin' | 'manual' | 'auto', label: string | null, blockCount: number, createdAt: string | null, createdBy: number, blocks: ServerBlock[] }

const API = '/api/admin/pages/5'

export function builderServer() {
  const state = {
    page: { id: 5, title: 'Giới thiệu', slug: 'gioi-thieu', isSystem: false, isVisible: true, seoTitle: 'SEO cũ', seoDescription: null as string | null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: null },
    published: [
      { id: 11, blockType: 'hero', displayOrder: 1, data: { title: 'Xin chào' }, isVisible: true },
      { id: 12, blockType: 'row', displayOrder: 2, data: {}, isVisible: true, children: [
        { id: 13, blockType: 'column', displayOrder: 1, data: {}, isVisible: true, colSpan: 6, children: [
          { id: 14, blockType: 'richtext', displayOrder: 1, data: { html: '<p>Nội dung <b>đậm</b></p>' }, isVisible: true },
        ] },
        { id: 15, blockType: 'column', displayOrder: 2, data: {}, isVisible: true, colSpan: 6, children: [] },
      ] },
      { id: 16, blockType: 'heading', displayOrder: 3, data: { title: 'Liên hệ' }, isVisible: true },
    ] as ServerBlock[],
    draft: null as ServerBlock[] | null,
    versions: [
      { id: 3, kind: 'origin', label: null, blockCount: 3, createdAt: '2026-09-01T03:00:00.000Z', createdBy: 1, blocks: [] },
      { id: 4, kind: 'manual', label: 'Trước Tết', blockCount: 1, createdAt: null, createdBy: 1, blocks: [{ blockType: 'heading', displayOrder: 1, data: { title: 'Bản Tết' }, isVisible: true }] },
      { id: 5, kind: 'auto', label: null, blockCount: 1, createdAt: '2026-10-01T03:00:00.000Z', createdBy: 1, blocks: [] },
    ] as ServerVersion[],
    nextId: 100,
    nextVersionId: 6,
    override: (() => undefined) as (call: NetCall) => Answer,
  }
  const body = (call: NetCall) => (call.body ?? {}) as Record<string, unknown>
  const count = (list: ServerBlock[]): number => list.reduce((n, b) => n + 1 + count(b.children ?? []), 0)
  const assignIds = (list: ServerBlock[]): ServerBlock[] => list.map((b, i) => ({
    ...b, id: typeof b.id === 'number' ? b.id : state.nextId++, displayOrder: i + 1,
    ...(b.children ? { children: assignIds(b.children) } : {}),
  }))

  const route = (call: NetCall): Response | Error => {
    const at = `${call.method} ${call.url.pathname}`
    const b = body(call)
    if (at === `GET ${API}`) {
      return json({ ok: true, page: state.page, blocks: state.published, draft: state.draft ? { blocks: state.draft, updatedAt: '2026-10-26T01:00:00.000Z' } : null, tree: true })
    }
    if (at === `PUT ${API}/draft`) {
      if (Array.isArray(b.blocks)) { state.draft = b.blocks as ServerBlock[]; return json({ ok: true, savedAt: '2026-10-27T01:00:00.000Z' }) }
      state.draft = null
      return json({ ok: true, cleared: true, savedAt: '2026-10-27T01:00:00.000Z' })
    }
    if (at === `POST ${API}/publish`) {
      state.published = assignIds(b.blocks as ServerBlock[])
      state.draft = null
      state.versions.unshift({ id: state.nextVersionId++, kind: 'auto', label: null, blockCount: count(state.published), createdAt: '2026-10-28T01:00:00.000Z', createdBy: 1, blocks: state.published })
      return json({ ok: true, blocks: state.published, tree: true })
    }
    if (at === `PUT ${API}`) {
      if (typeof b.title === 'string' && !b.title.trim()) return h3Error(400, 'Tiêu đề không được để trống.')
      if (typeof b.title === 'string') state.page.title = b.title
      if (typeof b.slug === 'string' && !state.page.isSystem) state.page.slug = b.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      return json({ ok: true, slug: state.page.slug })
    }
    if (at === `GET ${API}/versions`) return json({ ok: true, versions: state.versions.map(({ blocks: _blocks, ...v }) => v) })
    if (at === `POST ${API}/versions`) {
      const blocks = (b.blocks ?? []) as ServerBlock[]
      if (b.kind === 'manual') {
        if (state.versions.filter(v => v.kind === 'manual').length >= 4) return h3Error(400, 'Đã đạt tối đa 4 bản sao lưu. Vui lòng xóa bớt trước khi lưu mới.')
        state.versions.unshift({ id: state.nextVersionId++, kind: 'manual', label: String(b.label ?? '') || null, blockCount: count(blocks), createdAt: '2026-10-28T02:00:00.000Z', createdBy: 1, blocks })
      } else {
        state.versions = state.versions.filter(v => v.kind !== 'origin')
        state.versions.unshift({ id: state.nextVersionId++, kind: 'origin', label: null, blockCount: count(blocks), createdAt: '2026-10-28T02:00:00.000Z', createdBy: 1, blocks })
      }
      return json({ ok: true })
    }
    const restore = new RegExp(`^POST ${API}/versions/(\\d+)/restore$`).exec(at)
    if (restore) {
      const v = state.versions.find(x => x.id === Number(restore[1]))
      if (!v) return h3Error(404, 'Phiên bản không tồn tại.')
      state.draft = v.blocks
      return json({ ok: true, blocks: v.blocks })
    }
    const removed = new RegExp(`^DELETE ${API}/versions/(\\d+)$`).exec(at)
    if (removed) {
      const v = state.versions.find(x => x.id === Number(removed[1]))
      if (!v) return h3Error(404, 'Phiên bản không tồn tại.')
      if (v.kind === 'origin') return h3Error(400, 'Không thể xóa bản gốc. Hãy chỉ định bản gốc khác để thay thế.')
      state.versions = state.versions.filter(x => x !== v)
      return json({ ok: true })
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

export type BuilderServer = ReturnType<typeof builderServer>

// ─── Stand-ins ───────────────────────────────────────────────────────────────

type Node = { id?: number | string, blockType: string, isVisible?: boolean, data?: Record<string, unknown> }

const BuilderCanvasStandIn = Vue.defineComponent({
  name: 'BuilderCanvas',
  props: { blocks: { type: Array, required: true }, selectedId: { type: [Number, String], default: null }, viewport: { type: String, required: true }, previewPath: { type: String, required: true } },
  emits: ['select', 'update:viewport'],
  setup(props, { emit }) {
    return () => Vue.h('div', { 'data-stub': 'BuilderCanvas', 'data-count': props.blocks.length, 'data-selected': String(props.selectedId), 'data-viewport': props.viewport, 'data-preview': props.previewPath }, [
      ...(props.blocks as Node[]).map(b => Vue.h('button', { 'type': 'button', 'data-canvas-select': String(b.id), 'onClick': () => emit('select', b.id) }, `chọn ${String(b.id)}`)),
      ...['desktop', 'tablet', 'mobile'].map(vp => Vue.h('button', { 'type': 'button', 'data-viewport-button': vp, 'onClick': () => emit('update:viewport', vp) }, vp)),
    ])
  },
})

const PropertyPanelStandIn = Vue.defineComponent({
  name: 'PropertyPanel',
  props: { block: { type: Object, default: null }, index: { type: Number, required: true }, total: { type: Number, required: true } },
  emits: ['move', 'duplicate', 'delete', 'toggle-visible'],
  setup(props, { emit }) {
    return () => {
      const block = props.block as Node | null
      if (!block) return Vue.h('div', { 'data-stub': 'PropertyPanel' }, 'Chọn một block')
      return Vue.h('div', { 'data-stub': 'PropertyPanel', 'data-block': String(block.id), 'data-index': props.index, 'data-total': props.total }, [
        Vue.h('button', { title: 'Di chuyển lên', disabled: props.index <= 0, onClick: () => emit('move', props.index, -1) }),
        Vue.h('button', { title: 'Di chuyển xuống', disabled: props.index >= props.total - 1, onClick: () => emit('move', props.index, 1) }),
        Vue.h('button', { title: 'Nhân đôi', onClick: () => emit('duplicate', block) }),
        Vue.h('button', { title: block.isVisible ? 'Ẩn block' : 'Hiện block', onClick: () => emit('toggle-visible', block) }),
        Vue.h('button', { title: 'Xóa block', onClick: () => emit('delete', block) }),
        Vue.h('input', { 'data-field': 'title', 'value': String(block.data?.title ?? ''), 'onInput': (e: { target: { value: string } }) => { block.data = block.data ?? {}; block.data.title = e.target.value } }),
      ])
    }
  },
})

// ─── Mounting ────────────────────────────────────────────────────────────────

export type Toast = { type: string, message: string }
export type ConfirmRequest = { title?: string, message?: string, danger?: boolean, confirmLabel?: string }

async function settleOnly() {
  for (let i = 0; i < 12; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}

function builderEnv(toast: Record<string, (message: string) => void>, confirms: ConfirmRequest[], answers: { confirm: boolean }): SfcEnv {
  return {
    auto: {
      ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
      onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted, onBeforeUnmount: Vue.onBeforeUnmount,
      provide: Vue.provide, inject: Vue.inject,
      definePageMeta: () => {},
      useRoute: () => ({ params: { id: '5' }, query: {} }),
      useToast: () => toast,
      useConfirm: () => ({ confirm: async (request: ConfirmRequest) => { confirms.push(request); return answers.confirm } }),
      adminFetch,
      errorMessage,
    },
    modules: {
      '~/components/admin/AdminModal.vue': { default: AdminModalStandIn },
      '~/components/admin/builder/BuilderCanvas.vue': { default: BuilderCanvasStandIn },
      '~/components/admin/builder/PropertyPanel.vue': { default: PropertyPanelStandIn },
    },
  }
}

/**
 * The page's FIRST frame as the server renders it — Nuxt renders admin pages on the server, and
 * `onMounted` (the page load) does not run there: this HTML is what the officer sees until the
 * page hydrates. Same stand-ins as `mountBuilder`; nothing is fetched.
 */
export async function serverRender(): Promise<string> {
  const { renderToString } = await import('vue/server-renderer')
  const noop = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type => [type, () => {}]))
  const env = builderEnv(noop, [], { confirm: false })
  const app = Vue.createSSRApp(await loadSfc(PAGE, env))
  Object.assign(app.config.globalProperties, env.auto)
  app.config.warnHandler = () => {}
  return renderToString(app)
}

export async function mountBuilder(t: TestContext, server = builderServer()) {
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

  const page = await mountSfc(PAGE, builderEnv(toast, confirms, answers))

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
    if (DOM_LOG) appendFileSync(DOM_LOG, `${JSON.stringify({ test: t.fullName, step: step++, html: page.html(), calls: sent(calls), toasts, confirms })}\n`)
  }
  return { page, server, calls, toasts, confirms, answers, settle, close }
}

export type BuilderCtx = Awaited<ReturnType<typeof mountBuilder>>

export async function openBuilder(t: TestContext, server = builderServer()) {
  const ctx = await mountBuilder(t, server)
  await ctx.settle()
  return ctx
}

// ─── Reading and driving ─────────────────────────────────────────────────────

export const root = (from: MiniElement | MountedSfc) => ('root' in from ? from.root : from)
export const alerts = (from: MiniElement | MountedSfc) => findAll(root(from), el => el.props.role === 'alert')
export const dialogs = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'dialog')
export function dialog(page: MountedSfc, title: string): MiniElement {
  const open = dialogs(page).filter(d => d.props['aria-label'] === title)
  if (open.length !== 1) throw new Error(`expected one open dialog "${title}", found ${open.length}: ${JSON.stringify(dialogs(page).map(d => d.props['aria-label']))}`)
  return open[0]!
}
export const closeX = (d: MiniElement) => findAll(d, el => el.tag === 'button' && el.props['aria-label'] === 'Đóng')[0]!
export const button = (from: MiniElement | MountedSfc, text: string) => byText(root(from), 'button', text)
export const buttonsWith = (from: MiniElement | MountedSfc, text: string) => findAll(root(from), el => el.tag === 'button' && textOf(el).includes(text))
export const byTitle = (from: MiniElement | MountedSfc, title: string) => findAll(root(from), el => el.tag === 'button' && el.props.title === title)
export const panel = (page: MountedSfc) => findAll(page.root, el => el.props['data-stub'] === 'PropertyPanel')[0]!
export const canvas = (page: MountedSfc) => findAll(page.root, el => el.props['data-stub'] === 'BuilderCanvas')[0]!
/** The save indicator of the top bar ("Đã xuất bản", "Nháp — chưa xuất bản"…). */
export const saveState = (page: MountedSfc) => textOf(findAll(page.root, el => el.tag === 'span' && String(el.props.class ?? '').includes('mr-1 flex items-center'))[0]!)
/** The tree navigator, as rows: `label · preview` per node, indented by depth. */
export function treeRows(page: MountedSfc): string[] {
  const rows = findAll(page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('group mb-1 flex cursor-pointer'))
  return rows.map((row) => {
    const pad = Number(String((row.props.style as Record<string, string> | undefined)?.paddingLeft ?? '8px').replace('px', ''))
    const depth = (pad - 8) / 14
    const [label, preview] = findAll(row, el => el.tag === 'p').map(textOf)
    const selected = String(row.props.class).includes('bg-green-50 ring-1') ? '*' : ''
    return `${'  '.repeat(depth)}${selected}${label} · ${preview}`
  })
}
export const treeRow = (page: MountedSfc, label: string) => {
  const rows = findAll(page.root, el => el.tag === 'div' && String(el.props.class ?? '').startsWith('group mb-1 flex cursor-pointer')
    && textOf(findAll(el, p => p.tag === 'p')[0]!) === label)
  if (rows.length !== 1) throw new Error(`expected one tree row "${label}", found ${rows.length}`)
  return rows[0]!
}
export const lastToast = (toasts: Toast[], type: string) => toasts.filter(x => x.type === type).at(-1)?.message
/** The draft PUTs sent since `from`, as their `blocks` bodies. */
export const draftBodies = (calls: NetCall[], from = 0) => calls.slice(from).filter(c => wire(c) === `PUT ${API}/draft`).map(c => (c.body as { blocks?: unknown }).blocks)

export { textOf, findAll }
