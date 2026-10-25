/**
 * The search box of the "Bản dịch UI" tab must survive its own reload.
 *
 * Found in the Wave 3 7.1 rollout: the page rendered `TranslationsTab` only while
 * `!translationsLoading && !translationsError`, and every keystroke in the tab's search
 * box starts a reload — so each key unmounted the whole tab (filters included) and
 * mounted a fresh one. The officer's input lost focus after one character.
 *
 * This mounts the REAL page (`pages/admin/languages/index.vue`, its `<script setup>`
 * and template compiled together) with the REAL `TranslationsTab.vue`, on a minimal
 * in-memory renderer (`createRenderer` from vue — no DOM library needed), over real
 * ofetch on a fake network. A rendered node is a plain object, so "the same input"
 * is object identity: the node before the keystroke is `===` the node after the
 * reload. Focus lives on that node; a new node means focus is gone.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { describe, it } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'

// ─── A renderer whose nodes are plain objects ────────────────────────────────

type TNode = {
  kind: 'element' | 'text' | 'comment'
  tag: string
  text: string
  props: Record<string, unknown>
  children: TNode[]
  parent: TNode | null
  // `v-model` (runtime-dom's vModelText) attaches listeners on the element itself and
  // asks `getRootNode().activeElement` before an update; nothing here is ever focused.
  addEventListener: () => void
  removeEventListener: () => void
  getRootNode: () => { activeElement: null }
}

const node = (kind: TNode['kind'], tag = '', text = ''): TNode => ({
  kind, tag, text, props: {}, children: [], parent: null,
  addEventListener() {}, removeEventListener() {}, getRootNode: () => ({ activeElement: null }),
})

function detach(child: TNode) {
  if (!child.parent) return
  const siblings = child.parent.children
  siblings.splice(siblings.indexOf(child), 1)
  child.parent = null
}

const { createApp } = Vue.createRenderer<TNode, TNode>({
  createElement: tag => node('element', tag),
  createText: text => node('text', '', text),
  createComment: text => node('comment', '', text),
  setText: (target, text) => { target.text = text },
  setElementText: (element, text) => {
    for (const child of [...element.children]) detach(child)
    if (text) {
      const child = node('text', '', text)
      child.parent = element
      element.children.push(child)
    }
  },
  insert: (child, parent, anchor) => {
    detach(child)
    child.parent = parent
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at < 0) parent.children.push(child)
    else parent.children.splice(at, 0, child)
  },
  remove: detach,
  parentNode: child => child.parent,
  nextSibling: (child) => {
    if (!child.parent) return null
    const siblings = child.parent.children
    return siblings[siblings.indexOf(child) + 1] ?? null
  },
  patchProp: (element, key, _previous, next) => { element.props[key] = next },
})

function findAll(root: TNode, match: (n: TNode) => boolean, found: TNode[] = []): TNode[] {
  if (match(root)) found.push(root)
  for (const child of root.children) findAll(child, match, found)
  return found
}
const textOf = (n: TNode): string => (n.kind === 'text' ? n.text : n.children.map(textOf).join(''))

// ─── Compile an SFC (script setup + template) into a component ───────────────

async function component(relative: string, modules: Record<string, Record<string, unknown>>, auto: Record<string, unknown>) {
  const { descriptor } = parse(readFileSync(new URL(`../app/${relative}`, import.meta.url), 'utf8'), { filename: relative })
  const compiled = compileScript(descriptor, { id: relative, inlineTemplate: true })
  for (const [, from] of compiled.content.matchAll(/import\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g)) {
    if (modules[from!]) continue
    if (from!.startsWith('~/') && !from!.endsWith('.vue')) modules[from!] = await import(new URL(`../app/${from!.slice(2)}.ts`, import.meta.url).href)
    else throw new Error(`unexpected import in ${relative}: ${from}`)
  }
  const code = stripTypeScriptTypes(compiled.content)
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (_m, names: string, from: string) =>
      `const {${names.replace(/\s+as\s+/g, ': ')}} = __modules[${JSON.stringify(from)}];`)
    .replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (_m, name: string, from: string) =>
      `const ${name} = __modules[${JSON.stringify(from)}].default;`)
    .replace(/export default/, 'return')
  const names = Object.keys(auto).filter(name => !new RegExp(`\\b${name}\\b\\s*[:,}]`).test(code.slice(0, code.indexOf('return'))))
  return new Function('__modules', ...names, code)(modules, ...names.map(name => auto[name])) as Vue.Component
}

// ─── Fake network under real ofetch ──────────────────────────────────────────

type Pending = { url: URL, respond: (response: Response) => void }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Bad Request', headers: { 'content-type': 'application/json' } })

const LANGUAGES = [
  { id: 1, code: 'vi', name: 'Tiếng Việt', nativeName: 'Tiếng Việt', isActive: true, isDefault: true, displayOrder: 0 },
  { id: 2, code: 'en', name: 'English', nativeName: 'English', isActive: true, isDefault: false, displayOrder: 1 },
  { id: 3, code: 'fr', name: 'French', nativeName: 'Français', isActive: true, isDefault: false, displayOrder: 2 },
]
const rowsFor = (langCode: string) => ['home', 'news', 'contact'].map((key, i) => ({ id: i + 1, langCode, group: 'nav', key, value: `${langCode}:${key}`, isAiTranslated: false }))

/** Answers at once, except translation lists while `hold` is set — those wait for the test. */
function installNetwork() {
  const held: Pending[] = []
  const sent: string[] = []
  const state = { hold: false, fail: false }
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://admin.test')
    sent.push(`${init.method ?? 'GET'} ${url.pathname}`)
    init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
    if (url.pathname === '/api/admin/languages') return resolve(json({ ok: true, items: LANGUAGES }))
    const list = /^\/api\/admin\/languages\/(\w+)\/translations$/.exec(url.pathname)
    if (list && (init.method ?? 'GET') === 'GET') {
      const search = url.searchParams.get('search') ?? ''
      const answer = () => (state.fail
        ? json({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' }, 400)
        : json({ ok: true, items: rowsFor(list[1]!).filter(row => row.key.includes(search)), groups: ['nav'] }))
      if (state.hold) return held.push({ url, respond: () => resolve(answer()) })
      return resolve(answer())
    }
    resolve(json({ ok: true }))
  })
  ;(globalThis as Record<string, unknown>).$fetch = createFetch({ fetch: fetchImpl as typeof fetch })
  return { held, sent, state }
}

const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

async function mountPage() {
  const network = installNetwork()
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type => [type, () => {}]))
  const auto = {
    definePageMeta: () => {}, useConfirm: () => ({ confirm: async () => true }), adminFetch,
    ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
  }
  const stub = Vue.defineComponent({ render: () => null })
  const tab = await component('components/admin/languages/TranslationsTab.vue', { vue: Vue }, auto)
  const page = await component('pages/admin/languages/index.vue', {
    'vue': Vue,
    '~/composables/useToast': { useToast: () => toast },
    '~/components/admin/languages/TranslationsTab.vue': { default: tab },
    '~/components/admin/languages/LanguagesListTab.vue': { default: stub },
    '~/components/admin/languages/UniversalTab.vue': { default: stub },
    '~/components/admin/AdminModal.vue': { default: stub },
  }, auto)

  const app = createApp(page)
  // The shared skeleton is a global Nuxt component; its own contract is tests/skeleton-loading-ui.test.ts.
  app.component('SkeletonTable', Vue.defineComponent({
    props: ['label', 'rows', 'cols'],
    setup: props => () => Vue.h('div', { 'role': 'status', 'aria-busy': 'true', 'data-skeleton': '' }, String(props.label)),
  }))
  app.config.warnHandler = (message) => { throw new Error(`Vue warning: ${message}`) }
  const root = node('element', 'root')
  app.mount(root)
  await settle()

  const button = (label: string) => findAll(root, n => n.tag === 'button' && textOf(n).includes(label))
  // Open the tab the way the officer does.
  ;(button('Bản dịch UI')[0]!.props.onClick as () => void)()
  await settle()

  const searchBoxes = () => findAll(root, n => n.tag === 'input' && n.props.placeholder === 'Tìm kiếm key hoặc giá trị...')
  const tableRows = () => findAll(root, n => n.tag === 'tr' && n.parent?.tag === 'tbody')
  const skeletons = () => findAll(root, n => n.props['data-skeleton'] === '')
  const alerts = () => findAll(root, n => n.props.role === 'alert')
  const type = (box: TNode, value: string) => (box.props.onInput as (event: unknown) => void)({ target: { value } })
  return { root, network, button, searchBoxes, tableRows, skeletons, alerts, type }
}

describe('pages/admin/languages/index.vue — the translations search box', () => {
  it('stays the same node while the table reloads for a keystroke, and after (RED before: unmounted mid-reload)', async () => {
    const view = await mountPage()
    assert.equal(view.searchBoxes().length, 1)
    assert.equal(view.tableRows().length, 3)
    const box = view.searchBoxes()[0]!

    view.network.state.hold = true
    view.type(box, 'ho')
    await settle()
    assert.equal(view.network.held.length, 1, 'the keystroke started a reload')
    assert.equal(view.network.held[0]!.url.searchParams.get('search'), 'ho')

    // Mid-reload: the filters are still there — the same input — and only the table
    // body is replaced by the skeleton.
    assert.equal(view.searchBoxes().length, 1, 'the search box is still rendered while the table reloads')
    assert.ok(view.searchBoxes()[0] === box, 'the search box is the same node mid-reload')
    assert.equal(view.skeletons().length, 1, 'the skeleton stands in for the table')
    assert.equal(view.tableRows().length, 0, 'no stale rows under the skeleton')

    view.network.held.shift()!.respond(new Response())
    await settle()
    assert.ok(view.searchBoxes()[0] === box, 'the search box is the same node after the reload')
    assert.equal(box.props.value, 'ho')
    assert.equal(view.skeletons().length, 0)
    assert.deepEqual(view.tableRows().map(row => textOf(row.children[0]!)), ['home'])
  })

  it('a failed reload shows the alert with its retry in place of the table, and the box is still the same node', async () => {
    const view = await mountPage()
    const box = view.searchBoxes()[0]!

    view.network.state.fail = true
    view.type(box, 'x')
    await settle()
    assert.ok(view.searchBoxes()[0] === box, 'the search box is the same node while the error shows')
    assert.equal(view.alerts().length, 1)
    assert.match(textOf(view.alerts()[0]!), /Mã ngôn ngữ bắt buộc\./)
    assert.equal(view.tableRows().length, 0)

    view.network.state.fail = false
    const retry = findAll(view.alerts()[0]!, n => n.tag === 'button' && textOf(n).includes('Thử lại'))[0]!
    ;(retry.props.onClick as () => void)()
    await settle()
    assert.equal(view.alerts().length, 0)
    assert.ok(view.searchBoxes()[0] === box, 'the search box is the same node after the retry')
    assert.equal(view.tableRows().length, 0, 'the retry re-ran the same search ("x" matches nothing)')
  })

  // Keeping the tab mounted also keeps its editor state across reloads. The editor is
  // keyed `group::key` — the same in every language — and "Lưu" saves to the language
  // selected AT SAVE TIME: an English draft left open would reappear on the French row
  // and be saved as French. (A regression of the fix above, closed with it; the base
  // passes this because every reload unmounted the tab.)
  it('an open edit is closed when the language changes — its draft is never offered under, or saved to, the new language', async () => {
    const view = await mountPage()
    const editors = () => findAll(view.root, n => n.tag === 'textarea')
    const editNews = findAll(view.root, n => n.tag === 'button' && n.props.title === 'Sửa bản dịch')[1]!
    ;(editNews.props.onClick as () => void)()
    await settle()
    assert.ok(editors().length > 0, 'the editor opened on the English "news" row')
    // Typing, as the browser does it: the element holds the text, then v-model reads it.
    for (const editor of editors()) {
      ;(editor as unknown as { value: string }).value = 'Breaking news'
      ;(editor.props['onUpdate:modelValue'] as (value: string) => void)('Breaking news')
    }
    await settle()

    const language = findAll(view.root, n => n.tag === 'select' && textOf(n).includes('English'))[0]!
    ;(language.props.onChange as (event: unknown) => void)({ target: { value: 'fr' } })
    await settle()
    assert.equal(view.network.sent.at(-1), 'GET /api/admin/languages/fr/translations')
    assert.deepEqual(view.tableRows().map(row => textOf(row.children[3]!)), ['fr:home', 'fr:news', 'fr:contact'])
    assert.deepEqual(editors(), [], 'no editor is open on the French rows')
    assert.ok(!view.network.sent.some(call => call.startsWith('PUT')), 'nothing was saved')
  })
})
