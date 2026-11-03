/**
 * Static reading of one source file for the hex → token codemod's merge analysis
 * (scripts/codemod-hex-tokens-reach.ts): the template's start tags with their nesting and
 * attributes, the root elements, the non-literal sources of a class binding, and the
 * script's top-level declarations, imports, props and string literals.
 *
 * Pure: text in, structure out — no file system. Offsets are absolute in the file text.
 * Imports nothing from the codemod (the codemod imports the analysis, never the reverse).
 */
import ts from 'typescript'

export type Range = readonly [number, number]
type Node = import('typescript').Node
type SourceFile = import('typescript').SourceFile

export interface Attr { readonly name: string; readonly value: string; readonly valueStart: number }
export interface Tag { readonly name: string; readonly start: number; readonly end: number; readonly parent: number; readonly attrs: readonly Attr[] }
interface Script { readonly start: number; readonly sf: SourceFile }
export interface Decl { readonly node: Node; readonly script: Script }
export interface Imported { readonly spec: string; readonly imported: string }

export interface Parsed {
  readonly text: string
  readonly isSfc: boolean
  readonly tags: readonly Tag[]
  /** Elements the component's fallthrough `class` lands on (wrappers such as `<Transition>` are looked through). */
  readonly roots: readonly number[]
  readonly decls: ReadonlyMap<string, Decl>
  readonly imports: ReadonlyMap<string, Imported>
  /** `export … from` specifiers (re-exports). */
  readonly reExports: readonly string[]
  /** Prop names, and the identifiers bound to the `defineProps()` result (`props`). */
  readonly props: ReadonlySet<string>
  readonly propsObjects: ReadonlySet<string>
  /** String literals of the statement declaring the props (their defaults). */
  readonly propsDefaults: readonly Range[]
  /** Every string literal (and template-literal text part) of the script(s). */
  readonly literals: readonly Range[]
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
/** Components that render their child in place: a class on the child is what lands in the DOM. */
const WRAPPERS = new Set(['template', 'Transition', 'transition', 'ClientOnly', 'client-only', 'KeepAlive', 'keep-alive'])

function blockRanges(text: string): { blocks: Range[]; scripts: Array<{ start: number; content: string }> } {
  const blocks: Range[] = []
  const scripts: Array<{ start: number; content: string }> = []
  for (const m of text.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    blocks.push([m.index, m.index + m[0].length])
    if (m[1]!.toLowerCase() === 'script') scripts.push({ start: m.index + m[0].indexOf('>') + 1, content: m[2]! })
  }
  return { blocks, scripts }
}

/** Attributes between the tag name (`from`) and the closing `>` (`to`). */
function parseAttrs(text: string, from: number, to: number): Attr[] {
  const attrs: Attr[] = []
  for (const m of text.slice(from, to).matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    const raw = m[0]
    const quoted = m[2] !== undefined ? '"' : m[3] !== undefined ? '\'' : ''
    const offset = quoted ? raw.indexOf(quoted, m[1]!.length) + 1 : raw.length - value.length
    attrs.push({ name: m[1]!, value, valueStart: from + m.index + offset })
  }
  return attrs
}

/** Start tags outside `<script>`/`<style>`, with their parent (tolerant of unclosed tags). */
function parseTags(text: string, blocks: readonly Range[]): Tag[] {
  const tags: Tag[] = []
  const stack: number[] = []
  const regions: Range[] = []
  let cursor = 0
  for (const [s, e] of [...blocks].sort((a, b) => a[0] - b[0])) { regions.push([cursor, s]); cursor = e }
  regions.push([cursor, text.length])
  for (const [from, to] of regions) {
    let i = from
    while (i < to) {
      const lt = text.indexOf('<', i)
      if (lt === -1 || lt >= to) break
      if (text.startsWith('<!--', lt)) { const close = text.indexOf('-->', lt + 4); i = close === -1 ? to : close + 3; continue }
      const close = /^<\/([A-Za-z][\w.:-]*)\s*>/.exec(text.slice(lt, Math.min(to, lt + 200)))
      if (close) {
        const at = stack.map((index) => tags[index]!.name).lastIndexOf(close[1]!)
        if (at !== -1) stack.length = at
        i = lt + close[0].length
        continue
      }
      const open = /^<([A-Za-z][\w.:-]*)/.exec(text.slice(lt, lt + 200))
      if (!open) { i = lt + 1; continue }
      let j = lt + open[0].length
      let quote = ''
      for (; j < to; j++) {
        const ch = text[j]!
        if (quote) { if (ch === quote) quote = '' } else if (ch === '"' || ch === '\'') quote = ch
        else if (ch === '>') break
      }
      const end = Math.min(j + 1, to)
      const name = open[1]!
      tags.push({ name, start: lt, end, parent: stack.at(-1) ?? -1, attrs: parseAttrs(text, lt + open[0].length, j) })
      if (text[j - 1] !== '/' && !VOID.has(name)) stack.push(tags.length - 1)
      i = end
    }
  }
  return tags
}

function findRoots(tags: readonly Tag[]): number[] {
  const outer = tags.findIndex((tag) => tag.name === 'template' && tag.parent === -1)
  if (outer === -1) return []
  const roots: number[] = []
  const visit = (parent: number) => {
    tags.forEach((tag, index) => {
      if (tag.parent !== parent) return
      if (WRAPPERS.has(tag.name)) visit(index)
      else roots.push(index)
    })
  }
  visit(outer)
  return roots
}

const bindingNames = (name: import('typescript').BindingName, out: string[]) => {
  if (ts.isIdentifier(name)) out.push(name.text)
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, out)
  return out
}

function propNamesOf(call: import('typescript').CallExpression, types: ReadonlyMap<string, Node>): string[] {
  const names: string[] = []
  const fromMembers = (node: Node | undefined) => {
    if (!node) return
    if (ts.isTypeLiteralNode(node) || ts.isInterfaceDeclaration(node)) {
      for (const member of node.members) if (member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) names.push(member.name.text)
    } else if (ts.isTypeAliasDeclaration(node)) fromMembers(node.type)
    else if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) fromMembers(types.get(node.typeName.text))
  }
  fromMembers(call.typeArguments?.[0])
  const runtime = call.arguments[0]
  if (runtime && ts.isObjectLiteralExpression(runtime)) {
    for (const p of runtime.properties) if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) names.push(p.name.text)
  } else if (runtime && ts.isArrayLiteralExpression(runtime)) {
    for (const e of runtime.elements) if (ts.isStringLiteral(e)) names.push(e.text)
  }
  return names
}

export function literalRanges(node: Node, script: Script, out: Range[] = []): Range[] {
  const walk = (n: Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push([script.start + n.getStart(script.sf), script.start + n.getEnd()])
    }
    n.forEachChild(walk)
  }
  walk(node)
  return out
}

/** Reads one file: `.vue` (template + scripts) or a script module (`.ts`/`.js`). */
export function parseFile(text: string, fileName: string): Parsed {
  const isSfc = fileName.endsWith('.vue')
  const { blocks, scripts: rawScripts } = isSfc ? blockRanges(text) : { blocks: [], scripts: [{ start: 0, content: text }] }
  const tags = isSfc ? parseTags(text, blocks) : []
  const scripts: Script[] = rawScripts.map((s) => ({ start: s.start, sf: ts.createSourceFile('s.ts', s.content, ts.ScriptTarget.Latest, true) }))
  const decls = new Map<string, Decl>()
  const imports = new Map<string, Imported>()
  const reExports: string[] = []
  const types = new Map<string, Node>()
  const props = new Set<string>()
  const propsObjects = new Set<string>()
  const propsDefaults: Range[] = []
  const literals: Range[] = []
  for (const script of scripts) {
    literalRanges(script.sf, script, literals)
    for (const st of script.sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && !st.importClause?.isTypeOnly) {
        const spec = st.moduleSpecifier.text
        const clause = st.importClause
        if (clause?.name) imports.set(clause.name.text, { spec, imported: 'default' })
        const bindings = clause?.namedBindings
        if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { spec, imported: '*' })
        else if (bindings) for (const el of bindings.elements) if (!el.isTypeOnly) imports.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text })
      } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
        reExports.push(st.moduleSpecifier.text)
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) for (const name of bindingNames(d.name, [])) decls.set(name, { node: st, script })
      } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) {
        decls.set(st.name.text, { node: st, script })
      } else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) {
        types.set(st.name.text, st)
      }
    }
  }
  for (const script of scripts) {
    for (const st of script.sf.statements) {
      const calls: import('typescript').CallExpression[] = []
      const find = (n: Node) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'defineProps') calls.push(n); n.forEachChild(find) }
      find(st)
      if (!calls.length) continue
      for (const call of calls) for (const name of propNamesOf(call, types)) props.add(name)
      literalRanges(st, script, propsDefaults)
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) propsObjects.add(d.name.text)
          else for (const name of bindingNames(d.name, [])) props.add(name)
        }
      }
    }
  }
  return { text, isSfc, tags, roots: findRoots(tags), decls, imports, reExports, props, propsObjects, propsDefaults, literals }
}

/**
 * A class-producing expression in a binding that is not a literal: `cls`, `tone(x)`, `MAP[k].bg`,
 * `props.c`. `member`: the property read right off the root (`c` in `props.c`), when there is one.
 */
export interface DynamicSource { readonly text: string; readonly root: string; readonly member?: string }

/**
 * The non-literal expressions at class-producing positions of a binding (`:class` value).
 * In a `:class` object the values are conditions; in a `v-bind="{ class: x }"` object
 * (`objectValues`) they are what is bound, so they are sources too.
 */
export function dynamicSources(expression: string, objectValues = false): DynamicSource[] {
  const sf = ts.createSourceFile('x.ts', `(${expression}\n)`, ts.ScriptTarget.Latest, true)
  const out: DynamicSource[] = []
  const rootOf = (node: Node): { root: string; member?: string } => {
    let cur = node
    let member: string | undefined
    for (;;) {
      if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
        const arg = ts.isPropertyAccessExpression(cur) ? cur.name : cur.argumentExpression
        member = ts.isIdentifier(arg) || ts.isPrivateIdentifier(arg) || ts.isStringLiteral(arg) ? arg.text : undefined
        cur = cur.expression
      } else if (ts.isCallExpression(cur) || ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur)) {
        member = undefined
        cur = cur.expression
      } else break
    }
    const root = ts.isIdentifier(cur) ? cur.text : cur.kind === ts.SyntaxKind.ThisKeyword ? 'this' : ''
    return member === undefined ? { root } : { root, member }
  }
  const visit = (n: Node): void => {
    if (ts.isParenthesizedExpression(n)) return visit(n.expression)
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n)) return
    if (ts.isTemplateExpression(n)) { for (const span of n.templateSpans) visit(span.expression); return }
    if (ts.isArrayLiteralExpression(n)) { n.elements.forEach(visit); return }
    if (ts.isConditionalExpression(n)) { visit(n.whenTrue); visit(n.whenFalse); return }
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.CommaToken) return visit(n.right)
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.PlusToken) { visit(n.left); visit(n.right); return }
      return // comparison / arithmetic: a boolean or a number, never a class
    }
    if (ts.isPrefixUnaryExpression(n) || ts.isTypeOfExpression(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return
    // A helper's arguments can come back in its result (`cn(props.cls, 'p-2')`): sources too.
    for (let cur: Node = n; ;) {
      if (ts.isCallExpression(cur)) cur.arguments.forEach(visit)
      if (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur) || ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur)) cur = cur.expression
      else break
    }
    if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p) && ts.isComputedPropertyName(p.name)) visit(p.name.expression)
        if (objectValues && ts.isPropertyAssignment(p)) visit(p.initializer)
        else if (ts.isSpreadAssignment(p) || ts.isShorthandPropertyAssignment(p)) visit(ts.isSpreadAssignment(p) ? p.expression : p.name)
      }
      return
    }
    if (ts.isSpreadElement(n)) return visit(n.expression)
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return
    if (ts.isIdentifier(n) && n.text === 'undefined') return
    out.push({ text: n.getText(sf), ...rootOf(n) })
  }
  const stmt = sf.statements[0]
  if (stmt && ts.isExpressionStatement(stmt)) visit(stmt.expression)
  else if (expression.trim()) out.push({ text: expression, root: '' }) // unparseable: unresolvable
  return out
}

/** Names introduced by a `v-for` (`(item, i) in list`) or a slot scope (`{ item }`): alias names → source expression. */
export function scopeNames(attr: Attr): { names: string[]; source: string } | null {
  if (attr.name === 'v-for') {
    const m = /^\s*([\s\S]*?)\s+(?:in|of)\s+([\s\S]+)$/.exec(attr.value)
    if (!m) return null
    return { names: [...m[1]!.matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]), source: m[2]! }
  }
  if (attr.name === 'v-slot' || attr.name.startsWith('v-slot:') || attr.name.startsWith('#')) {
    return { names: [...attr.value.matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]), source: '' }
  }
  return null
}

/**
 * What a set of top-level declarations reaches: literals, imports, free names, and the props
 * it reads (`props.icon`, a destructured `icon` → `icon`; the props object used whole →
 * `allProps`). Transitive over local declarations.
 */
export interface Closure { readonly ranges: Range[]; readonly imports: Imported[]; readonly free: Set<string>; readonly propNames: Set<string>; allProps: boolean }

export function closureOf(file: Parsed, names: readonly string[]): Closure {
  const closure: Closure = { ranges: [], imports: [], free: new Set(), propNames: new Set(), allProps: false }
  const seen = new Set<Node>()
  const stack = names.flatMap((name) => (file.decls.has(name) && !file.props.has(name) && !file.propsObjects.has(name) ? [file.decls.get(name)!] : []))
  while (stack.length) {
    const decl = stack.pop()!
    if (seen.has(decl.node)) continue
    seen.add(decl.node)
    literalRanges(decl.node, decl.script, closure.ranges)
    const walk = (n: Node) => {
      const parent = n.parent
      if (ts.isIdentifier(n) && !(parent && ts.isPropertyAccessExpression(parent) && parent.name === n)) {
        const name = n.text
        if (file.propsObjects.has(name)) {
          const member = parent && ts.isPropertyAccessExpression(parent) && parent.expression === n ? parent.name.text
            : parent && ts.isElementAccessExpression(parent) && parent.expression === n && ts.isStringLiteral(parent.argumentExpression) ? parent.argumentExpression.text : undefined
          if (member !== undefined) closure.propNames.add(member)
          else closure.allProps = true
        } else if (file.props.has(name)) closure.propNames.add(name)
        else if (file.decls.has(name)) stack.push(file.decls.get(name)!)
        else if (file.imports.has(name)) closure.imports.push(file.imports.get(name)!)
        else closure.free.add(name)
      }
      n.forEachChild(walk)
    }
    walk(decl.node)
  }
  return closure
}
