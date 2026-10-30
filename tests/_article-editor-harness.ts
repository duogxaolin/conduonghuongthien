/**
 * Harness for tests/admin-article-editor.test.ts — the article editor
 * (`app/pages/admin/content/articles/[id].vue`): the REAL page — `<script setup>`, template
 * and, after its split, the real parts and composables it imports — over REAL ofetch + the
 * real `adminFetch`/`errorMessage` on a fake network shaped like `server/api/admin/articles/**`
 * (tests/_admin-page-harness.ts `mountAdminPage`).
 *
 * Stood in for, each recording what the page asked of it:
 *   - TinyMCE (`window.tinymce`): `init` records the config and runs `setup` + the editor's
 *     `init` event as the editor does; `get` answers only for a live editor with the page's id;
 *     `remove`/`destroy` are logged. `normalize` lets a test make `setContent` serialise like
 *     the real editor (which rewrites HTML on the way in);
 *   - `window` — the SAME object as an auto-import (what the page's own script sees) AND as the
 *     global (what a composable imported from `app/composables/*.ts` sees): `addEventListener`/
 *     `removeEventListener` keep the listeners, so a test can raise `beforeunload`;
 *   - `document` — `createElement('script')` + `head.appendChild` (the self-hosted TinyMCE
 *     script), `getElementById` (the "Bản dịch" button's scroll), both recorded;
 *   - `onBeforeRouteLeave` — the guard is kept and a test calls it, as the router would;
 *   - `navigateTo`, `useImagePicker().openPicker`, `useUpload()` — recorded; an upload stays
 *     pending until the test answers it;
 *   - `ArticleAIPanel` — renders its props and keeps them (`ai.props`) plus its `emit`, so a
 *     test can apply a title/excerpt suggestion or write polished HTML through the bridge;
 *   - `ArticleTranslationPanel` — renders its props and exposes what the page reads from it
 *     (`availableLanguages`, `translateAllForThisArticle`, recorded);
 *   - `<AdminModal>` — `AdminModalStandIn` (title, `busy`, icon, footer in the snapshot).
 *
 * Environment variables, to run the SAME suite on another version of the page:
 *   ARTICLE_EDITOR_FILE=<file>     mount that file instead of app/pages/admin/content/articles/[id].vue;
 *   ARTICLE_EDITOR_DOM_LOG=<file>  after every `settle()`, append one JSON line
 *                                  `{ test, step, html, calls, toasts, confirms }`.
 */
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as Vue from 'vue'

import { AdminModalStandIn } from './_ai-providers-tab-harness.ts'
import {
  h3Error, json, mountAdminPage, routes, sent, settle as settleOnly, Stub, type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'
import { findAll, textOf, type MiniElement } from './_sfc-mount.ts'

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url))
export const PAGE = process.env.ARTICLE_EDITOR_FILE
  ? path.resolve(process.env.ARTICLE_EDITOR_FILE)
  : path.join(APP_DIR, 'pages/admin/content/articles/[id].vue')
const DOM_LOG = process.env.ARTICLE_EDITOR_DOM_LOG ? path.resolve(process.env.ARTICLE_EDITOR_DOM_LOG) : null

export const EDITOR_ID = 'tinymce-content-editor'

// ─── The articles admin API ──────────────────────────────────────────────────

export const STAMP = '2026-10-20T02:00:00.000Z'
export const ARTICLE = {
  id: 42, title: 'Bài gốc', slug: 'bai-goc', type: 'role_model', category: '', categoryId: 21, excerpt: 'Tóm tắt gốc',
  content: '<p>Nội dung gốc</p>', thumbnailUrl: '/uploads/goc.jpg', status: 'draft', authorId: 1, publishedAt: null,
  createdAt: STAMP, updatedAt: STAMP, commentsEnabled: false,
}
export const cats = (type: string) => [
  { id: type === 'news' ? 10 : 20, name: `Gốc ${type}`, slug: `goc-${type}`, parentId: null, type, description: null, displayOrder: 0, createdAt: STAMP, parentName: null },
  { id: type === 'news' ? 11 : 21, name: `Con ${type}`, slug: `con-${type}`, parentId: type === 'news' ? 10 : 20, type, description: null, displayOrder: 0, createdAt: STAMP, parentName: null },
]
export const TYPES = [
  { id: 1, name: 'Tin tức', slug: 'news', icon: 'fa-solid fa-newspaper', description: null, displayOrder: 1, isSystem: true, createdAt: STAMP, categoryCount: 2, articleCount: 4 },
  { id: 2, name: 'Tấm gương', slug: 'role_model', icon: 'fa-regular fa-star', description: null, displayOrder: 2, isSystem: true, createdAt: STAMP, categoryCount: 2, articleCount: 1 },
  { id: 3, name: 'Không biểu tượng', slug: 'plain', icon: null, description: null, displayOrder: 3, isSystem: false, createdAt: STAMP, categoryCount: 0, articleCount: 0 },
]
export const LANGUAGES = [
  { code: 'en', label: 'Tiếng Anh', flag: 'EN' },
  { code: 'zh', label: 'Tiếng Trung', flag: 'ZH' },
  { code: 'fr', label: 'Tiếng Pháp', flag: 'FR' },
]

type Route = (call: NetCall) => Response | Error | undefined
export function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    'GET /api/admin/categories': call => json({ ok: true, items: cats(call.url.searchParams.get('type') ?? '') }),
    'GET /api/admin/content-types': () => json({ ok: true, items: TYPES }),
    'GET /api/admin/articles/42': () => json({ ok: true, article: ARTICLE }),
    'PUT /api/admin/articles/42': () => json({ ok: true }),
    'POST /api/admin/articles': () => json({ ok: true, id: 99, slug: 'bai-moi' }),
    'POST /api/admin/articles/99/translations/translate': () => json({ ok: true, message: 'Đã bắt đầu dịch. Vui lòng đợi.' }),
    'POST /api/admin/media/upload': () => json({ ok: true, media: { id: 5, url: 'https://cdn.example/anh.webp' } }),
    ...overrides,
  })
}
export { h3Error, json }

// ─── TinyMCE ─────────────────────────────────────────────────────────────────

export type FakeEditor = ReturnType<typeof fakeTinymce>['editor']

/**
 * TinyMCE attaches to the element its `selector` finds IN THE PAGE when `init` runs, and stays
 * with that element. Measured with TinyMCE 6 in Chromium on the real build (the "Thử lại" of a
 * failed load, docs/decisions/refactor-large-files.md): when the page then swaps that element
 * out, the editor is orphaned — `get()` still returns it, it is not `removed`, `getContent()`/
 * `setContent()` still work on its detached body — but nothing of it is on screen: the new
 * element is a bare, empty `<div>`. And `init` with no matching element creates no editor. So
 * here: `init` binds the editor to the element with the page's id found from the mounted root
 * (none found → no editor, logged `init:no-element`), and starts it empty, as a new editor on an
 * empty `<div>` does; `onScreen()` says whether the live editor's element is still the one on
 * the page. `page.root` is set by `openEditor` (the AI panel's stand-in, which sits in the
 * editor grid, reports the root the first time it mounts).
 *
 * And, as measured on the same build: `tinymce.init()` returns at once, `get()` answers the new
 * editor straight away, but its `init` event comes later (iframe, theme, plugins) and until then
 * it reads back '' — a baseline taken in that window is the empty string (the reordering
 * "markSaved after initTinyMCE" warned on close with nothing edited, in Chromium). So the event
 * fires on a later turn (`setImmediate`, which `settle()` runs), and `getContent()` is '' before.
 */
export function fakeTinymce(options: { normalize?: (html: string) => string } = {}) {
  const normalize = options.normalize ?? ((html: string) => html)
  const handlers: Record<string, () => void> = {}
  const configs: Record<string, unknown>[] = []
  const log: string[] = []
  let live = false
  let initialized = false
  let generation = 0
  const page: { root: MiniElement | null } = { root: null }
  const findBox = () => (page.root ? findAll(page.root, el => el.props.id === EDITOR_ID)[0] : undefined)
  const editor = {
    html: '',
    inserted: [] as string[],
    /** The element `init` attached this editor to. */
    box: undefined as MiniElement | undefined,
    on(event: string, handler: () => void) { handlers[event] = handler },
    setContent(html: string) { editor.html = normalize(html) },
    getContent() { return initialized ? editor.html : '' },
    insertContent(html: string) { editor.inserted.push(html); editor.html += html },
    remove() { log.push('remove'); live = false },
    destroy() { log.push('destroy'); live = false },
    /** What TinyMCE does when the officer's edit settles (blur, undo level). */
    fire(event: string) { handlers[event]?.() },
  }
  const tinymce = {
    get: (id: string) => (live && id === EDITOR_ID ? editor : undefined),
    init(config: Record<string, unknown>) {
      configs.push(config)
      const box = findBox()
      if (!box) { log.push('init:no-element'); return }
      log.push('init')
      live = true
      initialized = false
      editor.box = box
      editor.html = ''
      ;(config.setup as (e: typeof editor) => void)(editor)
      const mine = ++generation
      setImmediate(() => {
        if (!live || generation !== mine) return // removed, or replaced, before it came up
        initialized = true
        handlers.init?.()
      })
    },
  }
  /** An editor left over from an earlier visit (the page must remove it before init). */
  const leftover = () => { live = true; initialized = true }
  /** A started editor whose element is the one on the page now — what a person can see and type in. */
  const onScreen = () => live && initialized && editor.box !== undefined && editor.box === findBox()
  return { tinymce, editor, configs, log, leftover, onScreen, page }
}

// ─── Stand-ins for the children ──────────────────────────────────────────────

type AiProps = { formTitle: string, getEditorContent: () => string, setEditorContent: (html: string) => void }
export type AiPanel = { props: AiProps | null, emit: ((event: 'update:title' | 'update:excerpt', value: string) => void) | null }

function aiPanelStandIn(record: AiPanel, onRoot: (root: MiniElement) => void) {
  return Vue.defineComponent({
    props: { formTitle: { type: String, required: true }, getEditorContent: { type: Function, required: true }, setEditorContent: { type: Function, required: true } },
    emits: ['update:title', 'update:excerpt'],
    setup(props, { emit }) {
      record.props = props as unknown as AiProps
      record.emit = (event, value) => emit(event, value)
      const el = Vue.ref<MiniElement | null>(null)
      // In the editor grid, beside the box TinyMCE attaches to: from here, the page's root.
      Vue.onMounted(() => {
        let top = el.value
        while (top?.parent) top = top.parent
        if (top?.tag === '#root') onRoot(top)
      })
      return () => Vue.h('div', { ref: el, 'data-stub': 'ArticleAIPanel', 'data-form-title': props.formTitle })
    },
  })
}

export type TranslationPanel = { languages: typeof LANGUAGES, translateAll: string[], pending: (() => void) | null, hold: boolean, props: Record<string, unknown> | null }

function translationPanelStandIn(record: TranslationPanel) {
  return Vue.defineComponent({
    props: { articleId: { type: Number, default: null }, isNew: Boolean, formTitle: { type: String, required: true } },
    setup(props, { expose }) {
      record.props = props
      expose({
        availableLanguages: record.languages,
        translateAllForThisArticle: (status: string) => {
          record.translateAll.push(status)
          return record.hold ? new Promise<void>((resolve) => { record.pending = resolve }) : Promise.resolve()
        },
      })
      return () => Vue.h('div', { 'data-stub': 'ArticleTranslationPanel', 'data-article-id': props.articleId, 'data-is-new': props.isNew, 'data-form-title': props.formTitle })
    },
  })
}

// ─── Globals a composable sees ───────────────────────────────────────────────

function replaceGlobal(name: string, value: unknown): () => void {
  const target = globalThis as Record<string, unknown>
  const before = Object.getOwnPropertyDescriptor(target, name)
  Object.defineProperty(target, name, { value, configurable: true, writable: true })
  return () => {
    if (before) Object.defineProperty(target, name, before)
    else delete target[name]
  }
}

export type Picker = { multiple?: boolean, onSelect?: (media: unknown) => void, onSelectMultiple?: (items: unknown[]) => void }
export type ScriptTag = { tag: string, src: string, onload: (() => void) | null, onerror: (() => void) | null }

export interface OpenOptions {
  responder?: Responder
  /** TinyMCE already on `window` (default) or still to be loaded by the page. */
  tinymceLoaded?: boolean
  /** An editor with the page's id is still alive from an earlier visit. */
  leftover?: boolean
  normalize?: (html: string) => string
  languages?: typeof LANGUAGES
}

export async function openEditor(t: TestContext, id: string, options: OpenOptions = {}) {
  const tiny = fakeTinymce({ normalize: options.normalize })
  if (options.leftover) tiny.leftover()
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const win: Record<string, unknown> = {
    addEventListener: (type: string, fn: (event: unknown) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn) },
    removeEventListener: (type: string, fn: (event: unknown) => void) => { listeners.get(type)?.delete(fn) },
  }
  if (options.tinymceLoaded !== false) win.tinymce = tiny.tinymce
  const scripts: ScriptTag[] = []
  const scrolls: Array<{ id: string, options: unknown }> = []
  const doc = {
    createElement: (tag: string) => { const el: ScriptTag = { tag, src: '', onload: null, onerror: null }; return el },
    head: { appendChild: (el: ScriptTag) => { scripts.push(el) } },
    getElementById: (elementId: string) => ({ scrollIntoView: (opts: unknown) => { scrolls.push({ id: elementId, options: opts }) } }),
  }
  const restore = [replaceGlobal('window', win), replaceGlobal('document', doc)]

  const leaveGuards: Array<() => Promise<boolean> | boolean> = []
  const navigations: unknown[] = []
  /** What the leave guard answered at the moment the page navigated (the redirect after a create). */
  const leaveAtNavigation: Array<Promise<boolean> | boolean | undefined> = []
  const pickers: Picker[] = []
  const uploading = Vue.ref(false)
  const uploads: Array<{ file: unknown, answer: (media: { url: string } | null) => void }> = []
  const ai: AiPanel = { props: null, emit: null }
  const panel: TranslationPanel = { languages: options.languages ?? LANGUAGES, translateAll: [], pending: null, hold: false, props: null }

  const opened: MountedAdminPage = await mountAdminPage(path.relative(APP_DIR, PAGE), options.responder ?? server(), {
    route: { params: { id } },
    modules: {
      '~/components/admin/TinyMceEditor.vue': { default: Stub },
      '~/components/admin/AdminModal.vue': { default: AdminModalStandIn },
      '~/components/admin/articles/ArticleTranslationPanel.vue': { default: translationPanelStandIn(panel) },
      '~/components/admin/articles/ArticleAIPanel.vue': { default: aiPanelStandIn(ai, (root) => { tiny.page.root = root }) },
    },
    auto: {
      window: win,
      document: doc,
      onBeforeRouteLeave: (guard: () => Promise<boolean> | boolean) => { leaveGuards.push(guard) },
      navigateTo: (to: unknown) => { navigations.push(to); leaveAtNavigation.push(leaveGuards[0]?.()) },
      useImagePicker: () => ({ openPicker: (request: Picker) => { pickers.push(request) } }),
      useUpload: () => ({
        uploading,
        uploadFile: (file: unknown) => {
          uploading.value = true
          return new Promise((resolve) => {
            uploads.push({ file, answer: (media) => { uploading.value = false; resolve(media) } })
          })
        },
      }),
    },
  })

  let open = true
  const close = () => {
    if (!open) return
    open = false
    opened.page.unmount()
    for (const undo of restore.reverse()) undo()
  }
  t.after(close)

  let step = 0
  const settle = async () => {
    await settleOnly()
    if (DOM_LOG) {
      appendFileSync(DOM_LOG, `${JSON.stringify({ test: t.fullName, step: step++, html: opened.page.html(), calls: sent(opened.calls), toasts: opened.toasts, confirms: opened.confirms })}\n`)
    }
  }
  await settle()

  /** Raise `beforeunload` as the browser does; true when the page asked the browser to warn. */
  const beforeUnload = () => {
    let prevented = false
    const event = { preventDefault: () => { prevented = true }, returnValue: undefined as unknown }
    for (const fn of listeners.get('beforeunload') ?? []) fn(event)
    return prevented && event.returnValue === ''
  }
  /** What the router gets from the page's leave guard. */
  const leave = async () => {
    assert(leaveGuards.length === 1, `expected one onBeforeRouteLeave guard, found ${leaveGuards.length}`)
    return await leaveGuards[0]!()
  }

  return {
    ...opened, settle, close, tiny, win, scripts, scrolls, listeners, leaveGuards, navigations, leaveAtNavigation, pickers, uploading, uploads,
    ai, panel, beforeUnload, leave,
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export type Editor = Awaited<ReturnType<typeof openEditor>>

// ─── Reading the screen ──────────────────────────────────────────────────────

export const all = (ctx: Editor, match: (el: MiniElement) => boolean) => findAll(ctx.page.root, match)
export const titleInput = (ctx: Editor) => all(ctx, el => el.tag === 'input' && el.props.placeholder === 'Nhập tiêu đề hấp dẫn...')[0]!
export const excerptInput = (ctx: Editor) => all(ctx, el => el.tag === 'textarea')[0]!
/** The `<select>` under the label that starts with `label`. */
export function selectOf(ctx: Editor, label: string): MiniElement {
  const fields = all(ctx, el => el.tag === 'div' && findAll(el, l => l.tag === 'label' && textOf(l).startsWith(label)).length === 1
    && findAll(el, s => s.tag === 'select').length === 1)
  return findAll(fields.at(-1)!, el => el.tag === 'select')[0]!
}
export const optionsOf = (select: MiniElement) => findAll(select, el => el.tag === 'option').map(textOf)
export const editorBox = (ctx: Editor) => all(ctx, el => el.props.id === EDITOR_ID)[0]
export const placeholder = (ctx: Editor) => all(ctx, el => el.props.role === 'status')[0]
export const dialogs = (ctx: Editor) => all(ctx, el => el.props.role === 'dialog')
export const isDisabled = (el: MiniElement) => el.props.disabled === true || el.props.disabled === ''
export const classOf = (el: MiniElement) => String(el.props.class ?? '')
export { textOf, findAll }
