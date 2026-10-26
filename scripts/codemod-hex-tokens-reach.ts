/**
 * Merge analysis for the hex → token codemod: which colour classes, written in DIFFERENT
 * places, can land on one DOM element. The order guard (scripts/codemod-hex-tokens-order.ts)
 * sees one tag or one line; Tailwind's cascade sees the element. Classes reach an element:
 *   - from its own tag (`class`, `:class` literals)                         kind `self`
 *   - through a `:class` identifier, computed, helper → its declaration     kind `script`
 *   - … → an imported or auto-imported module (`app/utils`, `shared`, …)   kind `module`
 *   - on a component tag: the child's root element(s), and the child's
 *     elements fed by the props this tag passes                             kind `component`
 *   - on a component's root element: the `class` each usage passes in       kind `usage`
 *   - from a prop: its defaults, and the matching attribute of each usage   kind `prop`
 *   - anything it cannot resolve (`$attrs.x`, `this.x`, slot props): every
 *     string literal of the script that could hold it, every attribute of
 *     every usage, the slot-rendering component's literals                  kind `fallback`
 * Conservative by construction: when unsure, more classes join the group (both branches of a
 * ternary in one helper, every literal a closure reaches). Over-grouping only keeps more hexes;
 * under-grouping would change pixels.
 *
 * Known limits (0 class bindings in app/ or shared/ use them, 2026-10-26): a value read through
 * `inject()`/`useAttrs()`/`useSlots()` is treated as unknown (this file's literals and every
 * attribute of every usage), but the `provide()` side — possibly several levels up — is not
 * followed; `useState()`/store state written from other files is not followed either.
 *
 * `mergeGroups(file, text, project)` returns, per element, the source ranges (any file) of
 * every class that can meet there. For a script module, the elements are the tags of other
 * files whose class sources reach it. The project (files, names, usages) is in
 * scripts/codemod-hex-tokens-project.ts.
 */
import path from 'node:path'
import { indexFor, type At, type Project, type ProjectIndex } from './codemod-hex-tokens-project.ts'
import { closureOf, dynamicSources, scopeNames, type DynamicSource, type Imported, type Range, type Tag } from './codemod-hex-tokens-sfc.ts'

export { nodeFs, type Project, type SourceFs } from './codemod-hex-tokens-project.ts'
export type SourceKind = 'self' | 'script' | 'module' | 'component' | 'usage' | 'prop' | 'fallback'
export interface Piece { readonly file: string; readonly range: Range; readonly kind: SourceKind; readonly text: string }
export interface MergeGroup { readonly key: string; readonly pieces: readonly Piece[] }
/** `both`: the element itself; `down`: reached from a parent tag already collected; `up`: values flowing from parents. */
type Dir = 'both' | 'down' | 'up'

/** Values that come from another component at run time (provider, attrs, slots): unknown. */
const FOREIGN = new Set(['inject', 'useAttrs', 'useSlots'])
const BOUND = /^(?::|v-bind:)(?!key$|ref$|style$)/
const CLASS_BINDING = (name: string) => name === ':class' || name === 'v-bind:class' || name === 'v-bind'

/** Which attributes of a parent feed something: prop names, or `all` (unknown, `$attrs`, the props object whole). */
type Fed = ReadonlySet<string> | 'all'
const union = (a: Fed | null, b: Fed | null): Fed | null => (!a ? b : !b ? a : a === 'all' || b === 'all' ? 'all' : new Set([...a, ...b]))
const meets = (fed: Fed | null, passed: Fed) => !!fed && (fed === 'all' || passed === 'all' || [...fed].some((name) => passed.has(name)))
/** `:img-class` / `v-bind:imgClass` / `img-class` → `imgClass`; `v-bind` (object) → `*`. */
const propOf = (attr: string) => (attr === 'v-bind' ? '*' : attr.replace(/^(?::|v-bind:)/, '').replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase()))
const isPassed = (attr: string) => !attr.startsWith('@') && !/^(v-(?!bind)|#)/.test(attr)
/** The attributes a parent tag passes to its component. */
const passedBy = (tag: Tag): Fed => {
  const names = tag.attrs.filter((a) => isPassed(a.name)).map((a) => propOf(a.name))
  return names.includes('*') ? 'all' : new Set(names)
}

/** What feeds a tag's class bindings (and, on a component tag, its bound attributes) from a parent. Cached. */
function fedBy(ix: ProjectIndex, file: string, tagIndex: number): Fed | null {
  const key = `fed:${file}#${tagIndex}`
  if (!ix.memo.has(key)) ix.memo.set(key, new Collector(ix, true).bindings(file, tagIndex, 'down', 'self'))
  return ix.memo.get(key) as Fed | null
}

/** Elements of `file` that the attributes `passed` by a parent tag reach: the roots, and the elements those props feed. */
function entryTags(ix: ProjectIndex, file: string, passed: Fed): number[] {
  const p = ix.parsed(file)
  if (!p) return []
  return p.tags.flatMap((_tag, index) => (p.roots.includes(index) || meets(fedBy(ix, file, index), passed) ? [index] : []))
}

/** Tags (any `.vue` file) whose class sources reach `file`. Built once per index. */
function consumersOf(ix: ProjectIndex, file: string): At[] {
  let map = ix.memo.get('consumers') as Map<string, At[]> | undefined
  if (!map) {
    map = new Map()
    for (const v of ix.vueFiles()) {
      ix.parsed(v)?.tags.forEach((tag, index) => {
        if (!tag.attrs.some((a) => CLASS_BINDING(a.name) || BOUND.test(a.name))) return
        const c = new Collector(ix, false)
        c.element(v, index, 'both', 'self')
        for (const f of new Set(c.pieces.map((p) => p.file))) map!.set(f, [...(map!.get(f) ?? []), { file: v, tag: index }])
      })
    }
    ix.memo.set('consumers', map)
  }
  return map.get(file) ?? []
}

class Collector {
  readonly pieces: Piece[] = []
  private readonly seen = new Set<string>()
  private readonly ix: ProjectIndex
  /** `probe`: only answer "what feeds it from a parent?", collect nothing. */
  private readonly probe: boolean
  constructor(ix: ProjectIndex, probe: boolean) { this.ix = ix; this.probe = probe }

  private add(file: string, range: Range, kind: SourceKind) {
    const key = `${file}:${range[0]}:${range[1]}`
    if (this.probe || this.seen.has(key)) return
    this.seen.add(key)
    this.pieces.push({ file, range, kind, text: this.ix.parsed(file)!.text.slice(range[0], range[1]) })
  }
  private kindOf(traversal: SourceKind, resolved: SourceKind): SourceKind { return traversal === 'self' ? resolved : traversal }
  private fallback(file: string, kind: SourceKind) {
    const p = this.ix.parsed(file)
    if (!p) return
    for (const r of p.literals) this.add(file, r, this.kindOf(kind, 'fallback'))
    for (const tag of p.tags) if (tag.name === 'slot') this.add(file, [tag.start, tag.end], this.kindOf(kind, 'fallback'))
  }
  /** Where an import points: its file, or for `#imports` (Nuxt's auto-import barrel) the project files exporting the name. */
  private targets(imp: Imported, from: string): string[] {
    const file = this.ix.resolveSpec(imp.spec, from)
    return file ? [file] : imp.spec === '#imports' ? this.ix.exportsOf(imp.imported) : []
  }
  private module(file: string | null, name: string, kind: SourceKind, depth = 0) {
    if (this.probe || !file || depth > 6 || this.seen.has(`mod:${file}#${name}`)) return
    this.seen.add(`mod:${file}#${name}`)
    const m = this.ix.parsed(file)
    if (!m) return
    const k = this.kindOf(kind, 'module')
    if (name === 'default' || name === '*' || !m.decls.has(name)) {
      for (const r of m.literals) this.add(file, r, k)
      for (const spec of m.reExports) this.module(this.ix.resolveSpec(spec, file), '*', kind, depth + 1)
      return
    }
    const c = closureOf(m, [name])
    for (const r of c.ranges) this.add(file, r, k)
    for (const imp of c.imports) for (const f of this.targets(imp, file)) this.module(f, imp.imported, kind, depth + 1)
    for (const free of c.free) for (const f of this.ix.exportsOf(free)) if (f !== file) this.module(f, free, kind, depth + 1)
  }
  /** Prop values: their defaults, and (unless going down) the matching attributes of every usage. */
  private props(file: string, names: Fed, dir: Dir, kind: SourceKind): Fed {
    for (const r of this.ix.parsed(file)!.propsDefaults) this.add(file, r, this.kindOf(kind, 'prop'))
    if (!this.probe && dir !== 'down') for (const u of this.ix.usagesOf(file)) this.passIn(u, names, this.kindOf(kind, 'prop'))
    return names
  }
  /**
   * What a usage tag passes to its component: the attributes named (`class` = the fallthrough
   * `class`/`:class`; `all` = every attribute), each value's literals and resolved sources.
   * When the usage is its own file's root, classes passed to THAT file land there too.
   */
  private passIn(u: At, names: Fed | 'class', kind: SourceKind) {
    const p = this.ix.parsed(u.file)
    const tag = p?.tags[u.tag]
    const key = `pass:${u.file}#${tag?.start}:${typeof names === 'string' ? names : [...names].sort().join(',')}`
    if (!tag || this.seen.has(key)) return
    this.seen.add(key)
    for (const attr of tag.attrs) {
      const prop = propOf(attr.name)
      if (!isPassed(attr.name) || !(names === 'all' || prop === '*' || (names === 'class' ? prop === 'class' : names.has(prop)))) continue
      if (attr.value) this.add(u.file, [attr.valueStart, attr.valueStart + attr.value.length], kind)
      if (BOUND.test(attr.name) || attr.name === 'v-bind') for (const s of dynamicSources(attr.value, attr.name === 'v-bind')) this.source(u.file, u.tag, s, 'up', kind)
    }
    if ((names === 'class' || names === 'all') && p.roots.includes(u.tag)) for (const up of this.ix.usagesOf(u.file)) this.passIn(up, 'class', kind)
  }
  /** Resolves one source at a tag (collecting its pieces); returns the parent attributes that feed it, if any. */
  private source(file: string, tagIndex: number, src: DynamicSource, dir: Dir, kind: SourceKind): Fed | null {
    const p = this.ix.parsed(file)!
    const root = src.root
    if (root && root !== 'this') {
      for (let t = tagIndex; t !== -1; t = p.tags[t]!.parent) {
        for (const attr of p.tags[t]!.attrs) {
          const scope = scopeNames(attr)
          if (!scope?.names.includes(root)) continue
          if (attr.name === 'v-for') {
            this.add(file, [attr.valueStart, attr.valueStart + attr.value.length], this.kindOf(kind, 'script'))
            return dynamicSources(scope.source).reduce<Fed | null>((fed, s) => union(fed, this.source(file, p.tags[t]!.parent, s, dir, kind)), null)
          }
          // A slot scope: the values come from the component that renders the slot.
          const host = p.tags[t]!.name === 'template' ? p.tags[p.tags[t]!.parent] : p.tags[t]
          const children = host ? this.ix.childrenOf(file, host) : []
          for (const f of children.length ? children : [file]) this.fallback(f, kind)
          return null
        }
      }
      if (p.propsObjects.has(root)) return this.props(file, src.member === undefined ? 'all' : new Set([src.member]), dir, kind)
      if (p.props.has(root)) return this.props(file, new Set([root]), dir, kind)
      if (p.decls.has(root)) {
        const c = closureOf(p, [root])
        for (const r of c.ranges) this.add(file, r, this.kindOf(kind, 'script'))
        for (const imp of c.imports) for (const f of this.targets(imp, file)) this.module(f, imp.imported, kind)
        for (const free of c.free) for (const f of this.ix.exportsOf(free)) this.module(f, free, kind)
        if ([...c.free].some((name) => FOREIGN.has(name))) return this.unknown(file, dir, kind)
        return c.allProps ? this.props(file, 'all', dir, kind) : c.propNames.size ? this.props(file, c.propNames, dir, kind) : null
      }
      const imp = p.imports.get(root)
      if (imp) { for (const f of this.targets(imp, file)) this.module(f, imp.imported, kind); return null }
      const auto = this.ix.exportsOf(root)
      if (auto.length) { for (const f of auto) this.module(f, root, kind); return null }
    }
    return this.unknown(file, dir, kind)
  }
  /**
   * Unknown (`$attrs.x`, `this.x`, `inject()`/`useAttrs()`/`useSlots()`, an unparseable binding):
   * every class string of the script, and every attribute every parent passes.
   */
  private unknown(file: string, dir: Dir, kind: SourceKind): Fed {
    this.fallback(file, kind)
    if (!this.probe && dir !== 'down') for (const u of this.ix.usagesOf(file)) this.passIn(u, 'all', this.kindOf(kind, 'fallback'))
    return 'all'
  }
  /** The class bindings of a tag (and every bound attribute of a component tag); returns what feeds them from a parent. */
  bindings(file: string, tagIndex: number, dir: Dir, kind: SourceKind): Fed | null {
    const tag = this.ix.parsed(file)!.tags[tagIndex]!
    const isComponent = this.ix.childrenOf(file, tag).length > 0
    let fed: Fed | null = null
    for (const attr of tag.attrs) {
      if (!CLASS_BINDING(attr.name) && !(isComponent && BOUND.test(attr.name))) continue
      for (const s of dynamicSources(attr.value, attr.name === 'v-bind')) fed = union(fed, this.source(file, tagIndex, s, dir, kind))
    }
    return fed
  }
  /** Every class that can land on this element (`both`), or on it as a child of a tag already collected (`down`). */
  element(file: string, tagIndex: number, dir: Exclude<Dir, 'up'>, kind: SourceKind) {
    const p = this.ix.parsed(file)
    const tag = p?.tags[tagIndex]
    if (!tag || this.seen.has(`tag:${file}#${tag.start}`)) return
    this.seen.add(`tag:${file}#${tag.start}`)
    this.add(file, [tag.start, tag.end], kind)
    this.bindings(file, tagIndex, dir, kind)
    for (const child of this.ix.childrenOf(file, tag)) for (const r of entryTags(this.ix, child, passedBy(tag))) this.element(child, r, 'down', this.kindOf(kind, 'component'))
    if (dir === 'both' && p.roots.includes(tagIndex)) for (const u of this.ix.usagesOf(file)) this.passIn(u, 'class', this.kindOf(kind, 'usage'))
  }
}

/**
 * The merge groups of one file (absolute path, its current text): per element, every piece
 * of source that can put a class on it. Only groups that reach beyond the element's own tag.
 */
export function mergeGroups(file: string, text: string, project: Project): MergeGroup[] {
  const ix = indexFor(project)
  ix.setCurrent(file, text)
  const p = ix.parsed(file)!
  const groups: MergeGroup[] = []
  const collect = (at: At, key: string, keep: (pieces: readonly Piece[]) => boolean) => {
    const c = new Collector(ix, false)
    c.element(at.file, at.tag, 'both', 'self')
    if (c.pieces.length > 1 && keep(c.pieces)) groups.push({ key, pieces: c.pieces })
  }
  if (p.isSfc) {
    const hasUsages = ix.usagesOf(file).length > 0
    p.tags.forEach((tag, index) => {
      const dynamic = tag.attrs.some((a) => (CLASS_BINDING(a.name) || BOUND.test(a.name)) && dynamicSources(a.value, a.name === 'v-bind').length)
      if (dynamic || ix.childrenOf(file, tag).length || (hasUsages && p.roots.includes(index))) collect({ file, tag: index }, `E${tag.start}`, () => true)
    })
  } else if (ix.exists(file)) {
    for (const at of consumersOf(ix, file)) {
      collect(at, `U${path.relative(project.root, at.file)}#${ix.parsed(at.file)!.tags[at.tag]!.start}`, (pieces) => pieces.some((piece) => piece.file === file))
    }
  }
  return groups
}
