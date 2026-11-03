/**
 * Phân tích một module cho `scripts/test-inventory.ts` (docs/decisions/test-strategy.md).
 *
 *   1. **Reader**: hàm có tham số chảy vào một lời gọi đọc (lặp tới điểm dừng, xuyên helper).
 *   2. **Lời gọi đọc nguồn**: `readFileSync`/`readFile`/`readdirSync`/`readdir`, `git show`,
 *      hay lời gọi reader, mà đường dẫn suy được nằm dưới bốn gốc mã nguồn.
 *   3. **Nhiễm**: khai báo (biến, hàm, biến lặp, phép gán) có giá trị dùng văn bản nguồn —
 *      lặp tới điểm dừng. Không tính: đối số dữ liệu của lời gọi ghi tệp (chép script vào
 *      sandbox), chuỗi `createHash(…)` (checksum), giá trị mặc định của tham số trừ khi chính
 *      nó là lời gọi đọc. Dựng/chạy mã đã đọc (render template, `vm`, `new Function`, chạy
 *      tiến trình với script đó) là **chạy**, không phải văn bản.
 *   4. **Khối**: `it`/`test` (kể cả `.skip/.only/.todo`) phụ thuộc văn bản nguồn khi thân nó
 *      chứa lời gọi đọc nguồn hay tham chiếu symbol đã nhiễm; khối sinh trong vòng lặp đếm
 *      một lần (tĩnh).
 *
 * Giới hạn: không theo giá trị qua thuộc tính đối tượng hay tham số hàm (trừ reader), và
 * không phân biệt một biến nhiễm chỉ dùng để dựng sandbox với một biến dùng để khẳng định
 * — bản duyệt tay đánh dấu những khối đó là `executed`.
 */
import ts from 'typescript'
import { calleeName, isFsImport, isFunctionValue, moduleScope, READ_FNS, type Frag, type HelperExport, type HelperInfo } from './test-inventory-bindings.ts'
import { resolvePaths, SANDBOX } from './test-inventory-paths.ts'

export type { HelperInfo } from './test-inventory-bindings.ts'
export type Class = 'behavioural' | 'structural' | 'brittle'
/** `source`: khẳng định trên văn bản nguồn; `executed`: chỉ dựng/chạy mã đã đọc (render, eval, tiến trình). */
export type Block = { title: string, source: boolean, executed: boolean, commentPins: number, lineCount: boolean }
export type FileFacts = {
  file: string
  reads: string[]
  otherReads: string[]
  unresolvedReads: number
  scansDirs: boolean
  helpers: string[]
  ast: boolean
  blocks: Block[]
}

const DIR_FNS = new Set(['readdirSync', 'readdir'])
const TEST_FNS = new Set(['it', 'test'])
const TEST_MODIFIERS = new Set(['skip', 'only', 'todo'])
const ASSERTING = new Set(['match', 'doesNotMatch', 'includes', 'test', 'ok', 'equal', 'strictEqual', 'notEqual', 'deepEqual', 'indexOf', 'startsWith', 'endsWith', 'search'])
const WRITE_FNS = new Set(['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile'])
const RUN_FNS = new Set(['Function', 'runInNewContext', 'runInThisContext', 'runInContext', 'compileTemplate', 'renderToString'])
const PROCESS_FNS = new Set(['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec'])
/** Chú thích JS/HTML trong một chuỗi/regex dùng để khẳng định: `// ` `/*` `<!--`. */
const COMMENT_MARKER = /<!--|\/\*|\\\/\\\*|(^|[^:\\/])\/\/\s|\\\/\\\/\s/
const LINE_COUNT = /split\(\s*(['"`])\\n\1\s*\)\.length|split\(\/\\r\?\\n\/\)\.length|\blines?\.length\b|\blineCount\b|\bwc -l\b/

type ReadSite = Frag & { primitive: boolean, dir: boolean }
type Flags = { text: boolean, exec: boolean }

export function analyzeModule(sf: ts.SourceFile, checker: ts.TypeChecker, rel: string, helpers: Map<string, HelperInfo>) {
  const { symOf, fsFns, fsNs, execFns, helperSyms, ast, calls, decls, returnsOf, collect } = moduleScope(sf, checker, rel, helpers)

  const readers = new Map<ts.Symbol, Set<string>>()
  const isFsCallee = (callee: ts.Expression): boolean => {
    if (ts.isIdentifier(callee)) return fsFns.has(symOf(callee)!)
    if (!ts.isPropertyAccessExpression(callee) || !READ_FNS.has(callee.name.text)) return false
    let base = callee.expression
    if (ts.isPropertyAccessExpression(base) && base.name.text === 'promises') base = base.expression
    return isFsImport(base) || (ts.isIdentifier(base) && fsNs.has(symOf(base)!))
  }
  const readSiteOf = (call: ts.CallExpression): ReadSite | null => {
    const acc: Frag = { texts: new Set(), params: new Set() }
    const callee = call.expression
    const s = ts.isIdentifier(callee) ? symOf(callee) : undefined
    if (isFsCallee(callee)) {
      if (call.arguments[0]) collect(call.arguments[0], acc)
      return { ...acc, primitive: true, dir: DIR_FNS.has(calleeName(callee)) }
    }
    if (s && execFns.has(s)) {
      call.arguments.forEach(arg => collect(arg, acc))
      const words = [...acc.texts].join(' ')
      return /\bgit\b/.test(words) && /\bshow\b/.test(words) ? { ...acc, primitive: true, dir: false } : null
    }
    const helper = s ? helperSyms.get(s) : undefined
    const own = s && (readers.get(s) ?? (helper?.info.takesPath ? helper.info.texts : undefined))
    if (!own) return null
    call.arguments.forEach(arg => collect(arg, acc))
    for (const t of own) acc.texts.add(t)
    return { ...acc, primitive: false, dir: false }
  }
  for (let changed = true; changed;) {
    changed = false
    for (const call of calls) {
      const site = readSiteOf(call)
      for (const fn of site?.params ?? []) {
        const own = readers.get(fn) ?? new Set<string>()
        const before = readers.has(fn) ? own.size : -1
        for (const t of site!.texts) own.add(t)
        readers.set(fn, own)
        if (own.size !== before) changed = true
      }
    }
  }

  const sourceSites = new Set<ts.CallExpression>()
  const reads = new Set<string>()
  const otherReads = new Set<string>()
  const usedHelpers = new Set<string>()
  let unresolvedReads = 0
  let scansDirs = false
  for (const call of calls) {
    const site = readSiteOf(call)
    if (!site) continue
    const { source, other } = resolvePaths(site.texts)
    other.forEach(p => otherReads.add(p))
    // Đường dẫn còn phụ thuộc tham số: lời gọi reader ở nơi gọi mới quyết định đọc gì.
    if (source.length > 0 && site.params.size === 0) {
      sourceSites.add(call)
      source.forEach(p => reads.add(p))
      if (site.dir || source.some(p => p.endsWith('/'))) scansDirs = true
      const helper = ts.isIdentifier(call.expression) ? helperSyms.get(symOf(call.expression)!) : undefined
      if (helper) usedHelpers.add(helper.module)
    } else if (site.primitive && site.texts.size === 0 && site.params.size === 0) unresolvedReads++
  }

  const tainted = new Set<ts.Symbol>()
  const executed = new Set<ts.Symbol>()
  const runFns = new Set<ts.Symbol>()
  for (const [s, helper] of helperSyms) {
    if (helper.info.provider) tainted.add(s)
    if (helper.info.executes) runFns.add(s)
  }
  const isRunCall = (node: ts.Node): node is ts.CallExpression | ts.NewExpression =>
    (ts.isCallExpression(node) || ts.isNewExpression(node))
    && (RUN_FNS.has(calleeName(node.expression)) || (ts.isIdentifier(node.expression) && runFns.has(symOf(node.expression)!)))
  const has = (node: ts.Node, test: (n: ts.Node) => boolean): boolean => test(node) || !!node.forEachChild(c => (has(c, test) ? true : undefined))
  for (let changed = true; changed;) {
    changed = false
    for (const d of decls) {
      if (!isFunctionValue(d.value) || d.names.every(s => runFns.has(s)) || !has(d.value, isRunCall)) continue
      d.names.forEach(s => runFns.add(s))
      changed = true
    }
  }
  const chainRoot = (node: ts.Expression): string => {
    while (ts.isCallExpression(node) || ts.isPropertyAccessExpression(node)) node = node.expression
    return ts.isIdentifier(node) ? node.text : ''
  }
  const isSourceSite = (n: ts.Node) => ts.isCallExpression(n) && sourceSites.has(n)
  const scan = (node: ts.Node, out: Flags = { text: false, exec: false }): Flags => {
    if (ts.isCallExpression(node) && WRITE_FNS.has(calleeName(node.expression))) {
      if (node.arguments[0]) scan(node.arguments[0], out)
      return out
    }
    if (ts.isCallExpression(node) && chainRoot(node) === 'createHash') return out
    if (ts.isParameter(node)) {
      if (node.initializer && has(node.initializer, isSourceSite)) out.text = true
      return out
    }
    const spawns = ts.isCallExpression(node) && PROCESS_FNS.has(calleeName(node.expression)) && !sourceSites.has(node)
    if (spawns || isRunCall(node)) {
      const run = node as ts.CallExpression | ts.NewExpression
      const inner: Flags = { text: false, exec: false }
      for (const arg of run.arguments ?? []) scan(arg, inner)
      const self = ts.isIdentifier(run.expression) && tainted.has(symOf(run.expression)!)
      if (inner.text || inner.exec || self || isSourceSite(run)) out.exec = true
      return out
    }
    if (isSourceSite(node)) out.text = true
    if (ts.isIdentifier(node)) {
      const s = symOf(node)
      if (s && tainted.has(s)) out.text = true
      if (s && executed.has(s)) out.exec = true
    }
    node.forEachChild(child => { scan(child, out) })
    return out
  }
  for (let changed = true; changed;) {
    changed = false
    for (const d of decls) {
      const flags = scan(d.value)
      const into = flags.text ? tainted : flags.exec ? executed : null
      if (!into || d.names.every(s => into.has(s))) continue
      d.names.forEach(s => into.add(s))
      changed = true
    }
  }
  const referenced = (node: ts.Node): void => {
    const helper = ts.isIdentifier(node) ? helperSyms.get(symOf(node)!) : undefined
    if (helper && (helper.info.provider || helper.info.takesPath || helper.info.executes)) usedHelpers.add(helper.module)
    if (helper?.info.provider) resolvePaths(helper.info.texts).source.forEach(p => reads.add(p))
    node.forEachChild(referenced)
  }
  referenced(sf)

  const blocks: Block[] = []
  for (const call of calls) {
    const callee = call.expression
    const isTest = (ts.isIdentifier(callee) && TEST_FNS.has(callee.text))
      || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && TEST_FNS.has(callee.expression.text) && TEST_MODIFIERS.has(callee.name.text))
    const [first, ...body] = call.arguments
    if (!isTest || !first) continue
    const title = ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) ? first.text
      : ts.isTemplateExpression(first) ? first.getText(sf).slice(1, -1) : first.getText(sf)
    let commentPins = 0
    const pins = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ASSERTING.has(calleeName(node.expression))) {
        const candidates = [...node.arguments, ...(ts.isPropertyAccessExpression(node.expression) ? [node.expression.expression] : [])]
        for (const arg of candidates) {
          if ((ts.isStringLiteral(arg) || ts.isRegularExpressionLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) || ts.isTemplateExpression(arg))
            && COMMENT_MARKER.test(arg.getText(sf))) commentPins++
        }
      }
      node.forEachChild(pins)
    }
    body.forEach(pins)
    const flags: Flags = { text: false, exec: false }
    body.forEach(node => scan(node, flags))
    blocks.push({ title, source: flags.text, executed: flags.exec && !flags.text, commentPins, lineCount: body.some(node => LINE_COUNT.test(node.getText(sf))) })
  }

  const exports = new Map<string, HelperExport>()
  const moduleSym = checker.getSymbolAtLocation(sf)
  for (const exported of moduleSym ? checker.getExportsOfModule(moduleSym) : []) {
    const local = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const takesPath = readers.has(local)
    const provider = tainted.has(local)
    const executes = runFns.has(local) || executed.has(local)
    if (takesPath || provider || executes) {
      exports.set(exported.name, { texts: [...(readers.get(local) ?? []), ...(provider || executes ? reads : [])].sort(), takesPath, provider, executes })
      continue
    }
    // Hằng đường dẫn (`SEED_PATH = 'server/db/seed.ts'`) mà test truyền vào reader của helper,
    // hoặc hàm trả về một sandbox (`makeSandbox()`): đường dẫn dựng trên nó là tệp tạm.
    const decl = local.valueDeclaration
    const acc: Frag = { texts: new Set(), params: new Set() }
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer && !isFunctionValue(decl.initializer)) collect(decl.initializer, acc, 0, new Set(), false)
    else returnsOf(decl).forEach(r => collect(r, acc, 0, new Set(), false))
    const { source, other } = resolvePaths(acc.texts)
    const texts = acc.texts.has(SANDBOX) ? [SANDBOX] : [...source, ...other]
    if (texts.length > 0) exports.set(exported.name, { texts, takesPath: false, provider: false, executes: false })
  }

  const facts: FileFacts = {
    file: rel,
    // Đã chuẩn hoá theo từng lời gọi; không gộp lại ở đây — một lượt quét thư mục và một
    // tệp cụ thể bên dưới nó là hai lượt đọc khác nhau.
    reads: [...reads].sort(),
    otherReads: [...otherReads].sort(),
    unresolvedReads,
    scansDirs,
    helpers: [...usedHelpers].sort(),
    ast,
    blocks,
  }
  return { facts, helper: { exports, ast } satisfies HelperInfo }
}
