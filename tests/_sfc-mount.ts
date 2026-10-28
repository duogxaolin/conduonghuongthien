/**
 * Mount a REAL single-file component tree — each `<script setup>` and template compiled
 * with @vue/compiler-sfc, every `.vue` it imports mounted for real — on a minimal
 * in-memory DOM built with Vue's own `createRenderer`. No jsdom/happy-dom: the test runner
 * installs nothing (CLAUDE.md).
 *
 * What a test gets that `tests/_render-sfc-template.ts` (SSR, a hand-made state) and the
 * `setup()`-only harness of tests/admin-fetch-rollout.test.ts cannot give:
 *   - lifecycle hooks run (`onMounted` loads the page, `onBeforeUnmount` cleans up);
 *   - a click reaches the compiled handler, through a child component's `emit` when the
 *     markup lives in a child — so a page split into panels is tested through the same
 *     buttons as before the split;
 *   - `html()` serialises the whole tree (attributes, bound `v-model` values, listener
 *     names), so two versions of a page can be compared node for node.
 *
 * What it is not: a browser. No CSS, no layout, no focus. `v-model` directives are
 * replaced by recorders — the bound value shows as `v-model=` in `html()`, and a test
 * "types" with `input(el, value)`, which calls the element's `onUpdate:modelValue`.
 * Components it cannot resolve (Nuxt's `<nuxt-link>`, auto-imported `<AdminPagination>`)
 * render as plain elements carrying their props, so a test can read and fire them.
 * Static hoisting is off, so no subtree is pre-stringified past the renderer; template
 * comments are dropped as in a production build (`v-if` placeholders stay).
 */
import { existsSync, readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url))

// ─── A minimal DOM ───────────────────────────────────────────────────────────

export interface MiniElement {
  kind: 'element'
  tag: string
  props: Record<string, unknown>
  children: MiniNode[]
  parent: MiniElement | null
  /** The value bound with `v-model`, recorded by the directive stand-ins below. */
  model?: { value: unknown }
}
export interface MiniText { kind: 'text', text: string, parent: MiniElement | null }
export interface MiniComment { kind: 'comment', text: string, parent: MiniElement | null }
export type MiniNode = MiniElement | MiniText | MiniComment

function detach(node: MiniNode): void {
  const parent = node.parent
  if (!parent) return
  const at = parent.children.indexOf(node)
  if (at >= 0) parent.children.splice(at, 1)
  node.parent = null
}

/**
 * `focus()` exists and does nothing — a page calls it on a template ref (login.vue moves
 * focus to the code field). Non-enumerable, so it is not part of the element's data.
 */
const createElement = (tag: string): MiniElement =>
  Object.defineProperty({ kind: 'element', tag, props: {}, children: [], parent: null } as MiniElement, 'focus', { value: () => {} })

const renderer = Vue.createRenderer<MiniNode, MiniElement>({
  insert(child, parent, anchor) {
    detach(child)
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at >= 0) parent.children.splice(at, 0, child)
    else parent.children.push(child)
    child.parent = parent
  },
  remove: detach,
  createElement,
  createText: text => ({ kind: 'text', text, parent: null }),
  createComment: text => ({ kind: 'comment', text, parent: null }),
  setText(node, text) {
    if (node.kind !== 'element') node.text = text
  },
  setElementText(el, text) {
    for (const child of el.children) child.parent = null
    el.children = text ? [{ kind: 'text', text, parent: el }] : []
  },
  parentNode: node => node.parent,
  nextSibling(node) {
    const siblings = node.parent?.children
    if (!siblings) return null
    return siblings[siblings.indexOf(node) + 1] ?? null
  },
  patchProp(el, key, _previous, next) {
    if (next === null || next === undefined) delete el.props[key]
    else el.props[key] = next
  },
})

/** Records what `v-model` is bound to; the real directives need a browser DOM. */
const recordModel: Vue.ObjectDirective<MiniElement> = {
  created(el, { value }) { el.model = { value } },
  beforeUpdate(el, { value }) { el.model = { value } },
}

/** The `vue` module as compiled SFCs see it: real, except for the DOM-only `v-model` directives. */
const VUE_FOR_SFC: Record<string, unknown> = {
  ...Vue,
  vModelText: recordModel,
  vModelCheckbox: recordModel,
  vModelRadio: recordModel,
  vModelSelect: recordModel,
  vModelDynamic: recordModel,
}

// ─── Loading an SFC ──────────────────────────────────────────────────────────

export interface SfcEnv {
  /** Nuxt auto-imports the files use without importing them (`useToast`, `adminFetch`…). */
  auto: Record<string, unknown>
  /** Import specifiers to replace with a stand-in module. */
  modules?: Record<string, Record<string, unknown>>
  /**
   * Components registered on the app, for auto-imported tags the files use without
   * importing them (`<AdminProfileActivityHistory>`). A tag left out renders as a plain
   * element — and a template `ref` on it then holds that element, not the component.
   */
  components?: Record<string, Vue.Component>
  /**
   * Mount inside `<Suspense>`: a `<script setup>` with a top-level `await` (login.vue's
   * `await useAsyncData`) compiles to an async `setup`, which renders nothing without one.
   * Settle (or await) after mounting for the setup to resolve.
   */
  suspense?: boolean
}

const IMPORT_FROM = /^import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"];?/gm

function resolveFile(from: string, importer: string): string {
  const absolute = from.startsWith('~/')
    ? path.join(APP_DIR, from.slice(2))
    : path.resolve(path.dirname(importer), from)
  if (existsSync(absolute)) return absolute
  if (existsSync(`${absolute}.ts`)) return `${absolute}.ts`
  throw new Error(`cannot resolve ${from} imported by ${importer}`)
}

async function resolveModule(from: string, importer: string, env: SfcEnv, loaded: Map<string, Promise<Vue.Component>>): Promise<unknown> {
  if (env.modules?.[from]) return env.modules[from]
  if (from === 'vue') return VUE_FOR_SFC
  if (from.startsWith('~/') || from.startsWith('.')) {
    const file = resolveFile(from, importer)
    if (file.endsWith('.vue')) return { default: await loadSfc(file, env, loaded) }
    return import(pathToFileURL(file).href)
  }
  return import(from)
}

/** Compile one SFC (script + inline template) into a component, loading the `.vue` files it imports. */
export function loadSfc(file: string, env: SfcEnv, loaded = new Map<string, Promise<Vue.Component>>()): Promise<Vue.Component> {
  const absolute = path.resolve(file)
  const cached = loaded.get(absolute)
  if (cached) return cached
  const component = compileSfc(absolute, env, loaded)
  loaded.set(absolute, component)
  return component
}

async function compileSfc(file: string, env: SfcEnv, loaded: Map<string, Promise<Vue.Component>>): Promise<Vue.Component> {
  // `comments: false` as in a production build: template comments are not rendered. Set at
  // PARSE time too — compileScript reuses the (cached) SFC parse's template AST, so a
  // compiler-only option dropped them on every compile but the first.
  const { descriptor, errors } = parse(readFileSync(file, 'utf8'), { filename: file, templateParseOptions: { comments: false } })
  if (errors.length) throw errors[0]
  const compiled = compileScript(descriptor, {
    id: `sfc-mount-${path.basename(file)}`,
    inlineTemplate: true,
    templateOptions: { compilerOptions: { hoistStatic: false, comments: false } },
  })
  const code = stripTypeScriptTypes(compiled.content)

  const modules: Record<string, unknown> = {}
  const imported = new Set<string>()
  for (const [, clause, from] of code.matchAll(IMPORT_FROM)) {
    modules[from!] ??= await resolveModule(from!, file, env, loaded)
    const named = /\{([^}]*)\}/.exec(clause!)?.[1]
    for (const name of named ? named.split(',') : [clause!]) {
      const local = name.split(/\s+as\s+/).at(-1)!.trim()
      if (local) imported.add(local)
    }
  }
  const body = code
    .replace(IMPORT_FROM, (_m, clause: string, from: string) => {
      const named = /^\{([^}]*)\}$/.exec(clause.trim())
      if (named) return `const {${named[1]!.replace(/\s+as\s+/g, ': ')}} = __modules[${JSON.stringify(from)}];`
      if (/^\w+$/.test(clause.trim())) return `const ${clause.trim()} = __modules[${JSON.stringify(from)}].default;`
      throw new Error(`${file}: unsupported import clause \`${clause}\``)
    })
    .replace(/export default/, 'return')

  // A name the file imports itself is not an auto-import (and would clash as a parameter).
  const auto = Object.entries(env.auto).filter(([name]) => !imported.has(name))
  return new Function('__modules', ...auto.map(([name]) => name), body)(modules, ...auto.map(([, value]) => value)) as Vue.Component
}

// ─── Mounting, querying, firing ──────────────────────────────────────────────

export interface MountedSfc {
  root: MiniElement
  /** Every error Vue routed to `app.config.errorHandler` (a handler that threw or rejected). */
  errors: unknown[]
  html: () => string
  unmount: () => void
}

export async function mountSfc(file: string, env: SfcEnv, props?: Record<string, unknown>): Promise<MountedSfc> {
  const component = await loadSfc(file, env)
  const root = createElement('#root')
  const errors: unknown[] = []
  const app = env.suspense
    ? renderer.createApp(Vue.defineComponent({ setup: () => () => Vue.h(Vue.Suspense, null, { default: () => Vue.h(component, props) }) }))
    : renderer.createApp(component, props)
  // `<nuxt-link>` and auto-imported components are left unresolved on purpose, unless
  // the test registers one (`env.components`).
  for (const [name, registered] of Object.entries(env.components ?? {})) app.component(name, registered)
  // A name only the TEMPLATE uses (`formatDateTimeVN(f.lastUsedAt)`) is compiled to
  // `_ctx.name`, not to the script's scope; Nuxt's template transform imports it. Here the
  // instance proxy finds it on globalProperties.
  Object.assign(app.config.globalProperties, env.auto)
  app.config.warnHandler = () => {}
  app.config.errorHandler = (err) => { errors.push(err) }
  MOUNT_ERRORS.set(root, errors)
  app.mount(root)
  return { root, errors, html: () => serialize(root.children), unmount: () => app.unmount() }
}

const isListener = (key: string, value: unknown) =>
  /^on[A-Z]/.test(key) && (typeof value === 'function' || (Array.isArray(value) && value.every(item => typeof item === 'function')))

function attribute(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/**
 * The tree as markup: attributes in patch order with JSON values, `v-model=` for the
 * bound value, listeners as `onClick` without a value. Empty text nodes (Vue's fragment
 * anchors) are dropped; comments (`v-if` placeholders) are kept.
 */
export function serialize(nodes: readonly MiniNode[]): string {
  return nodes.map((node) => {
    if (node.kind === 'text') return escapeText(node.text)
    if (node.kind === 'comment') return `<!--${node.text}-->`
    const attrs = Object.entries(node.props)
      .map(([key, value]) => (isListener(key, value) ? ` ${key}` : ` ${key}=${attribute(value)}`))
      .join('')
    const model = node.model ? ` v-model=${attribute(node.model.value)}` : ''
    return `<${node.tag}${attrs}${model}>${serialize(node.children)}</${node.tag}>`
  }).join('')
}

export function findAll(from: MiniNode | readonly MiniNode[], match: (el: MiniElement) => boolean, out: MiniElement[] = []): MiniElement[] {
  if (Array.isArray(from)) {
    for (const node of from) findAll(node, match, out)
    return out
  }
  const node = from as MiniNode
  if (node.kind !== 'element') return out
  if (match(node)) out.push(node)
  findAll(node.children, match, out)
  return out
}

/** Visible text, whitespace collapsed. */
export function textOf(node: MiniNode | readonly MiniNode[]): string {
  const raw = (n: MiniNode | readonly MiniNode[]): string => {
    if (Array.isArray(n)) return n.map(raw).join('')
    const one = n as MiniNode
    return one.kind === 'text' ? one.text : one.kind === 'element' ? raw(one.children) : ''
  }
  return raw(node).replace(/\s+/g, ' ').trim()
}

/** The one element with this tag whose text contains `text` — throws on none or several. */
export function byText(from: MiniNode | readonly MiniNode[], tag: string, text: string): MiniElement {
  const found = findAll(from, el => el.tag === tag && textOf(el).includes(text))
  // Nested matches (a <div> inside a <div>) count once: keep the innermost.
  const innermost = found.filter(el => !found.some(other => other !== el && isInside(other, el)))
  if (innermost.length !== 1) throw new Error(`expected one <${tag}> containing "${text}", found ${innermost.length}`)
  return innermost[0]!
}

function isInside(node: MiniNode, ancestor: MiniElement): boolean {
  for (let current = node.parent; current; current = current.parent) if (current === ancestor) return true
  return false
}

/** A browser event as the compiled handlers and `withModifiers` read it. */
const browserEvent = (type: string, target: MiniElement) =>
  ({ type, target, currentTarget: target, preventDefault() {}, stopPropagation() {} })

/**
 * Fire `event` on an element the way the browser reaches the compiled listener. As
 * runtime-dom's invoker does (`callWithAsyncErrorHandling`), a promise the listener
 * RETURNS is caught into the mount's `errors`; the result resolves once it settles. A
 * promise the listener drops (`a = 1; load()`) is not seen — its rejection is unhandled,
 * exactly as in a browser.
 */
export async function fire(el: MiniElement, event: string, payload?: unknown): Promise<void> {
  const key = `on${event[0]!.toUpperCase()}${event.slice(1)}`
  const handler = el.props[key]
  if (!handler) throw new Error(`<${el.tag}> has no ${event} listener`)
  const arg = payload === undefined ? browserEvent(event, el) : payload
  const errors = errorsOf(el)
  await Promise.all((Array.isArray(handler) ? handler : [handler]).map(async (fn) => {
    try {
      await (fn as (value: unknown) => unknown)(arg)
    } catch (err: unknown) {
      errors.push(err)
    }
  }))
}

const MOUNT_ERRORS = new WeakMap<MiniElement, unknown[]>()

function errorsOf(el: MiniElement): unknown[] {
  let top = el
  while (top.parent) top = top.parent
  const errors = MOUNT_ERRORS.get(top)
  if (!errors) throw new Error(`<${el.tag}> is not in a mounted tree`)
  return errors
}

/** Click, refusing a disabled control as a browser does. */
export function click(el: MiniElement): Promise<void> {
  if (el.props.disabled === true || el.props.disabled === '') throw new Error(`<${el.tag}> "${textOf(el)}" is disabled`)
  return fire(el, 'click')
}

/** Type into / pick in a `v-model` control. */
export function input(el: MiniElement, value: unknown): Promise<void> {
  return fire(el, 'update:modelValue', value)
}
