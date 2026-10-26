/**
 * The project the hex → token codemod's merge analysis reads (scripts/codemod-hex-tokens-reach.ts):
 * files (through a `SourceFs`, so tests run on an in-memory tree), Nuxt's component names,
 * import specifiers (`~/`, `~~/`, `#shared/`, relative), auto-imported exports
 * (`app/utils`, `app/composables`, `shared`), and where each component is used.
 *
 * One `ProjectIndex` per (file system, root), cached: a codemod run over many files parses
 * each other file once. The file being rewritten is read from its current text, not the disk.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parseFile, type Parsed, type Tag } from './codemod-hex-tokens-sfc.ts'

export interface SourceFs { read(file: string): string | undefined; list(dir: string): string[] }
const SKIP = new Set(['node_modules', '.nuxt', '.output', '.git', '.data'])
export const nodeFs: SourceFs = {
  read: (file) => { try { return readFileSync(file, 'utf8') } catch { return undefined } },
  list: (dir) => {
    const out: string[] = []
    const walk = (d: string) => {
      let entries
      try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name)) } else if (e.isFile()) out.push(path.join(d, e.name))
      }
    }
    walk(dir)
    return out.sort()
  },
}

export interface Project { readonly root: string; readonly fs: SourceFs }
/** A start tag in a file (index into `Parsed.tags`). */
export interface At { readonly file: string; readonly tag: number }

// ---- Nuxt component names (nuxt/src/components/scan.ts: scule's splitByCase + resolveComponentNameSegments)
export function splitByCase(text: string): string[] {
  const parts: string[] = []
  let buff = ''
  let prevUpper: boolean | undefined
  let prevSplitter: boolean | undefined
  const upper = (c: string) => (/\d/.test(c) ? undefined : c !== c.toLowerCase())
  for (const c of text) {
    const splitter = ['-', '_', '/', '.'].includes(c)
    if (splitter) { parts.push(buff); buff = ''; prevUpper = undefined; continue }
    const isUpper = upper(c)
    if (prevSplitter === false) {
      if (prevUpper === false && isUpper === true) { parts.push(buff); buff = c; prevUpper = isUpper; continue }
      if (prevUpper === true && isUpper === false && buff.length > 1) { const last = buff.at(-1)!; parts.push(buff.slice(0, -1)); buff = last + c; prevUpper = isUpper; continue }
    }
    buff += c
    prevUpper = isUpper
    prevSplitter = splitter
  }
  parts.push(buff)
  return parts.filter(Boolean)
}
const pascal = (parts: readonly string[]) => parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join('')

/** `blocks/HeadingBlock.vue` → `BlocksHeadingBlock`; `admin/AdminModal.vue` → `AdminModal`; `x/index.vue` → `X`. */
export function nuxtComponentName(relativePath: string): string {
  const dir = path.posix.dirname(relativePath)
  let fileName = path.posix.basename(relativePath).replace(/\.vue$/, '').replace(/(\.(client|server))?(\.global|\.island)*$/, '')
  if (fileName.toLowerCase() === 'index') fileName = ''
  const prefixParts = dir === '.' ? [] : splitByCase(dir)
  const fileParts = splitByCase(fileName)
  const content = fileParts.join('/').toLowerCase()
  const nameParts = prefixParts.flatMap((p) => splitByCase(p))
  const matched: string[] = []
  for (let index = prefixParts.length - 1; index >= 0; index--) {
    matched.unshift(...splitByCase(prefixParts[index] ?? '').map((p) => p.toLowerCase()))
    const suffix = matched.join('/')
    if (content === suffix || content.startsWith(`${suffix}/`)
      || (prefixParts[index]!.toLowerCase() === content && prefixParts[index + 1] && prefixParts[index] === prefixParts[index + 1])) {
      nameParts.length = index
    }
  }
  return pascal([...nameParts, ...fileParts])
}

const isHtmlName = (name: string) => /^[a-z][a-z0-9]*$/.test(name)

export class ProjectIndex {
  readonly root: string
  readonly fs: SourceFs
  /** Caches the reach module keeps per index (fed-by answers, module consumers). */
  readonly memo = new Map<string, unknown>()
  private readonly parsedCache = new Map<string, Parsed | null>()
  private current: { file: string; parsed: Parsed } | null = null
  private vue?: string[]
  private registryMap?: Map<string, string>
  private exportsMap?: Map<string, string[]>
  private readonly usageCache = new Map<string, At[]>()
  constructor(root: string, fs: SourceFs) { this.root = root; this.fs = fs }

  setCurrent(file: string, text: string) {
    if (this.current?.file !== file || this.current.parsed.text !== text) this.current = { file, parsed: parseFile(text, file) }
  }
  exists(file: string) { return file === this.current?.file || this.parsed(file) !== null }
  parsed(file: string): Parsed | null {
    if (file === this.current?.file) return this.current.parsed
    if (!this.parsedCache.has(file)) {
      const text = /\.(vue|ts|js|mjs)$/.test(file) ? this.fs.read(file) : undefined
      this.parsedCache.set(file, text === undefined ? null : parseFile(text, file))
    }
    return this.parsedCache.get(file)!
  }
  vueFiles() { return (this.vue ??= this.fs.list(path.join(this.root, 'app')).filter((f) => f.endsWith('.vue'))) }
  private registry() {
    if (!this.registryMap) {
      this.registryMap = new Map()
      const dir = path.join(this.root, 'app', 'components')
      for (const file of this.vueFiles()) {
        if (!file.startsWith(dir + path.sep)) continue
        const name = nuxtComponentName(path.relative(dir, file).split(path.sep).join('/'))
        this.registryMap.set(name, file)
        this.registryMap.set(`Lazy${name}`, file)
      }
    }
    return this.registryMap
  }
  /** Files under the auto-import directories that export `name`. */
  exportsOf(name: string): string[] {
    if (!this.exportsMap) {
      this.exportsMap = new Map()
      for (const dir of ['app/utils', 'app/composables', 'shared']) {
        for (const file of this.fs.list(path.join(this.root, dir))) {
          if (!/\.(ts|js|mjs)$/.test(file)) continue
          const text = this.fs.read(file) ?? ''
          const names = [...text.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!)
          for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) names.push(...m[1]!.split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean))
          for (const n of names) this.exportsMap.set(n, [...(this.exportsMap.get(n) ?? []), file])
        }
      }
    }
    return this.exportsMap.get(name) ?? []
  }
  resolveSpec(spec: string, from: string): string | null {
    let base: string
    if (/^[~@]\//.test(spec)) base = path.join(this.root, 'app', spec.slice(2))
    else if (/^(~~|@@)\//.test(spec)) base = path.join(this.root, spec.slice(3))
    else if (spec.startsWith('#shared/')) base = path.join(this.root, 'shared', spec.slice(8))
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
    else return null
    for (const candidate of [base, `${base}.ts`, `${base}.js`, `${base}.vue`, `${base}.mjs`, path.join(base, 'index.ts'), path.join(base, 'index.js')]) {
      if (this.exists(candidate)) return candidate
    }
    return null
  }
  componentFile(from: string, tagName: string): string | null {
    if (isHtmlName(tagName)) return null
    const imported = this.parsed(from)?.imports.get(tagName)
    if (imported?.imported === 'default') { const file = this.resolveSpec(imported.spec, from); if (file?.endsWith('.vue')) return file }
    const name = tagName.includes('-') ? pascal(splitByCase(tagName)) : tagName
    return this.registry().get(name) ?? null
  }
  /** Project components a tag renders: by its name, or for `<component :is>` every name/import `:is` can hold. */
  childrenOf(from: string, tag: Tag): string[] {
    if (tag.name !== 'component') { const file = this.componentFile(from, tag.name); return file ? [file] : [] }
    const is = tag.attrs.find((a) => a.name === ':is' || a.name === 'v-bind:is' || a.name === 'is')
    if (!is) return []
    const names = is.name === 'is' ? [is.value] : [...is.value.matchAll(/['"`]([A-Za-z][\w-]*)['"`]|\b([A-Z][\w]*)\b/g)].map((m) => m[1] ?? m[2]!)
    return [...new Set(names.flatMap((n) => this.componentFile(from, n) ?? []))]
  }
  /** Tags in the project's `.vue` files that render `component`. */
  usagesOf(component: string): At[] {
    if (!component.endsWith('.vue') || !this.exists(component)) return []
    let usages = this.usageCache.get(component)
    if (!usages) {
      usages = []
      const names = [...this.registry()].filter(([, file]) => file === component).map(([name]) => name)
      const base = path.basename(component, '.vue')
      const needles = [...names, ...names.map((n) => splitByCase(n).map((p) => p.toLowerCase()).join('-'))].map((n) => `<${n}`)
      for (const file of this.vueFiles()) {
        const text = file === this.current?.file ? this.current.parsed.text : this.fs.read(file) ?? ''
        if (!needles.some((n) => text.includes(n)) && !text.includes(base)) continue
        this.parsed(file)?.tags.forEach((tag, index) => { if (this.childrenOf(file, tag).includes(component)) usages!.push({ file, tag: index }) })
      }
      this.usageCache.set(component, usages)
    }
    return usages
  }
}

const INDEXES = new WeakMap<SourceFs, Map<string, ProjectIndex>>()
export function indexFor(project: Project): ProjectIndex {
  let byRoot = INDEXES.get(project.fs)
  if (!byRoot) INDEXES.set(project.fs, (byRoot = new Map()))
  let ix = byRoot.get(project.root)
  if (!ix) byRoot.set(project.root, (ix = new ProjectIndex(project.root, project.fs)))
  return ix
}
