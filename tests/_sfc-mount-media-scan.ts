/**
 * Mount a REAL single-file component tree on a minimal in-memory DOM — for
 * tests/admin-media-scan-page.test.ts (wave3 4.1 + 7.1, `/admin/media/scan`).
 *
 * Each `<script setup>` and its template are compiled with @vue/compiler-sfc (template
 * inlined, as Nuxt builds it), every `.vue` file the component imports is mounted for
 * real, and the tree is rendered through Vue's own `createRenderer` onto plain objects.
 * No jsdom/happy-dom: the test runner installs nothing (CLAUDE.md).
 *
 * What a test gets that `tests/_render-sfc-template.ts` (SSR, a hand-made state) and the
 * `setup()`-only harness of tests/admin-fetch-rollout.test.ts do not:
 *   - lifecycle hooks run (`onMounted` loads the page, `onUnmounted` stops its timers);
 *   - a click reaches the compiled handler — through a child component's `emit` when the
 *     markup lives in a panel, so a page split into panels is driven through the same
 *     buttons as before the split;
 *   - `html()` serialises the whole tree (attributes, `v-model` values, listener names),
 *     so two versions of a page can be compared node for node.
 *
 * It is not a browser: no CSS, no layout, no focus. `v-model` directives are replaced by
 * recorders — the bound value shows as `v-model=` in `html()` and a test "types" with
 * `input(el, value)`, which calls the element's `onUpdate:modelValue`. Components it
 * cannot resolve (Nuxt's `<NuxtLink>`) render as plain elements carrying their props.
 * Static hoisting is off, so nothing is pre-stringified past the renderer; template
 * comments are dropped as in a production build (`v-if` placeholders stay).
 *
 * FOLLOW-UP: the moderation-page split (wave3 4.1, another branch) carries the same idea
 * as `tests/_sfc-mount.ts`. Once both have landed, keep one of the two.
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

const createElement = (tag: string): MiniElement => ({ kind: 'element', tag, props: {}, children: [], parent: null })

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
  /** Nuxt auto-imports the files use without importing them (`useToast`, `adminFetch`, `ref`…). */
  auto: Record<string, unknown>
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

type Loaded = Map<string, Promise<Vue.Component>>

async function resolveModule(from: string, importer: string, env: SfcEnv, loaded: Loaded): Promise<unknown> {
  if (from === 'vue') return VUE_FOR_SFC
  if (from.startsWith('~/') || from.startsWith('.')) {
    const file = resolveFile(from, importer)
    if (file.endsWith('.vue')) return { default: await loadSfc(file, env, loaded) }
    return import(pathToFileURL(file).href)
  }
  return import(from)
}

/** Compile one SFC (script + inline template) into a component, loading the `.vue` files it imports. */
export function loadSfc(file: string, env: SfcEnv, loaded: Loaded = new Map()): Promise<Vue.Component> {
  const absolute = path.resolve(file)
  const cached = loaded.get(absolute)
  if (cached) return cached
  const component = compileSfc(absolute, env, loaded)
  loaded.set(absolute, component)
  return component
}

async function compileSfc(file: string, env: SfcEnv, loaded: Loaded): Promise<Vue.Component> {
  // `comments: false` at PARSE time too: compileScript reuses the SFC parse's template AST.
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
  /** Every error Vue routed to `app.config.errorHandler`, and every rejection of a fired listener. */
  errors: unknown[]
  html: () => string
  unmount: () => void
}

const MOUNT_ERRORS = new WeakMap<MiniElement, unknown[]>()

export async function mountSfc(file: string, env: SfcEnv): Promise<MountedSfc> {
  const component = await loadSfc(file, env)
  const root = createElement('#root')
  const errors: unknown[] = []
  const app = renderer.createApp(component)
  // `<NuxtLink>` is left unresolved on purpose.
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
 * bound value, listeners as `onClick` without a value. Comments (`v-if` placeholders)
 * are kept.
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

/**
 * Visible text, whitespace collapsed. Element boundaries count as a space: the template
 * compiler drops the newline between `<p>Đã nhập</p>` and `<p>30</p>`, which a browser
 * still renders as two separate boxes.
 */
export function textOf(node: MiniNode | readonly MiniNode[]): string {
  const raw = (n: MiniNode | readonly MiniNode[]): string => {
    if (Array.isArray(n)) return n.map(raw).join('')
    const one = n as MiniNode
    return one.kind === 'text' ? one.text : one.kind === 'element' ? ` ${raw(one.children)} ` : ''
  }
  return raw(node).replace(/\s+/g, ' ').trim()
}

function isInside(node: MiniNode, ancestor: MiniElement): boolean {
  for (let current = node.parent; current; current = current.parent) if (current === ancestor) return true
  return false
}

/** Elements with this tag whose text contains `text`; nested matches count once (the innermost). */
export function allByText(from: MiniNode | readonly MiniNode[], tag: string, text: string): MiniElement[] {
  const found = findAll(from, el => el.tag === tag && textOf(el).includes(text))
  return found.filter(el => !found.some(other => other !== el && isInside(other, el)))
}

/** The one element with this tag whose text contains `text` — throws on none or several. */
export function byText(from: MiniNode | readonly MiniNode[], tag: string, text: string): MiniElement {
  const found = allByText(from, tag, text)
  if (found.length !== 1) throw new Error(`expected one <${tag}> containing "${text}", found ${found.length}`)
  return found[0]!
}

function errorsOf(el: MiniElement): unknown[] {
  let top = el
  while (top.parent) top = top.parent
  const errors = MOUNT_ERRORS.get(top)
  if (!errors) throw new Error(`<${el.tag}> is not in a mounted tree`)
  return errors
}

/** A browser event as the compiled handlers and `withModifiers` read it. */
const browserEvent = (type: string, target: MiniElement) =>
  ({ type, target, currentTarget: target, preventDefault() {}, stopPropagation() {} })

/**
 * Fire `event` on an element the way the browser reaches the compiled listener. A promise
 * the listener RETURNS is caught into the mount's `errors` (as runtime-dom's invoker
 * does); the result resolves once it settles.
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

export const isDisabled = (el: MiniElement) => el.props.disabled === true || el.props.disabled === ''

/** Click, refusing a disabled control as a browser does. */
export function click(el: MiniElement): Promise<void> {
  if (isDisabled(el)) throw new Error(`<${el.tag}> "${textOf(el)}" is disabled`)
  return fire(el, 'click')
}

/** Type into / tick a `v-model` control. */
export function input(el: MiniElement, value: unknown): Promise<void> {
  return fire(el, 'update:modelValue', value)
}
