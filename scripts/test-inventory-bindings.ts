/**
 * Phạm vi một module cho `scripts/test-inventory.ts`: các tên đọc tệp nhập từ `fs` (tĩnh,
 * namespace, `import('node:fs')` động, `.then(fs => …)`), `child_process`, export của
 * helper `tests/_*.ts`, mọi lời gọi và mọi khai báo mang giá trị (biến, hàm, biến lặp
 * `for…of`, phép gán), cùng bộ suy văn bản đường dẫn `collect`.
 *
 * Mọi tra cứu đi qua symbol của checker (không theo tên), nên hai biến `source` ở hai
 * phạm vi không lẫn nhau. `collect` đi theo: chuỗi, template (hằng chuỗi được nội suy,
 * phần còn lại là `*`), `new URL`, `path.join`, biến `const`, biến lặp, tham số đầu của
 * callback `map/filter/…` (lấy theo mảng nguồn), biểu thức `return` của hàm cục bộ gọi
 * không đối số; gặp tham số của một hàm có tên thì ghi hàm đó (nó là reader).
 */
import path from 'node:path'
import ts from 'typescript'
import { SANDBOX } from './test-inventory-paths.ts'

export type HelperExport = { texts: string[], takesPath: boolean, provider: boolean, executes: boolean }
export type HelperInfo = { exports: Map<string, HelperExport>, ast: boolean }
export type Frag = { texts: Set<string>, params: Set<ts.Symbol> }
export type Decl = { names: ts.Symbol[], value: ts.Node }

export const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises'])
export const READ_FNS = new Set(['readFileSync', 'readFile', 'readdirSync', 'readdir'])
const EXEC_MODULES = new Set(['child_process', 'node:child_process'])
const EXEC_FNS = new Set(['execSync', 'execFileSync', 'spawnSync'])
const ARRAY_CALLBACKS = new Set(['map', 'flatMap', 'forEach', 'filter', 'some', 'every', 'find'])
/** Gốc sandbox: đường dẫn dựng trên đây là tệp tạm, kể cả khi trùng tên `app/`… */
const SANDBOX_FNS = new Set(['mkdtempSync', 'mkdtemp', 'tmpdir'])

export const calleeName = (callee: ts.Expression) =>
  (ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '')
export const isFunctionValue = (node: ts.Node) => ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)

/** `import('node:fs')`, `await import('node:fs/promises')`, trong ngoặc hay không. */
export function isFsImport(node: ts.Expression): boolean {
  while (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)) node = node.expression
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
    && !!node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && FS_MODULES.has(node.arguments[0].text)
}

export function moduleScope(sf: ts.SourceFile, checker: ts.TypeChecker, rel: string, helpers: Map<string, HelperInfo>) {
  const symOf = (node: ts.Node): ts.Symbol | undefined =>
    (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node))
  const add = (set: Set<ts.Symbol>, node: ts.Node) => { const s = symOf(node); if (s) set.add(s) }
  const fsFns = new Set<ts.Symbol>()
  const fsNs = new Set<ts.Symbol>()
  const execFns = new Set<ts.Symbol>()
  const helperSyms = new Map<ts.Symbol, { module: string, info: HelperExport }>()
  let ast = false

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const spec = stmt.moduleSpecifier.text
    if (spec === 'typescript') ast = true
    const helperKey = spec.startsWith('./_') ? `${path.posix.join(path.posix.dirname(rel), spec).replace(/\.ts$/, '')}.ts` : ''
    const helper = helpers.get(helperKey)
    if (helper?.ast) ast = true
    const clause = stmt.importClause
    if (!clause || clause.isTypeOnly) continue
    const named = clause.namedBindings
    const elements = named && ts.isNamedImports(named) ? named.elements : []
    if (FS_MODULES.has(spec)) {
      if (clause.name) add(fsNs, clause.name)
      if (named && ts.isNamespaceImport(named)) add(fsNs, named.name)
      for (const el of elements) {
        const name = (el.propertyName ?? el.name).text
        if (READ_FNS.has(name)) add(fsFns, el.name)
        if (name === 'promises') add(fsNs, el.name)
      }
    }
    if (EXEC_MODULES.has(spec)) for (const el of elements) if (EXEC_FNS.has((el.propertyName ?? el.name).text)) add(execFns, el.name)
    if (helper) for (const el of elements) {
      const info = helper.exports.get((el.propertyName ?? el.name).text)
      const s = symOf(el.name)
      if (info && s) helperSyms.set(s, { module: helperKey, info })
    }
  }

  const calls: ts.CallExpression[] = []
  const decls: Decl[] = []
  const bindingSyms = (name: ts.BindingName): ts.Symbol[] => (ts.isIdentifier(name)
    ? [symOf(name)].filter((s): s is ts.Symbol => !!s)
    : name.elements.flatMap(el => (ts.isBindingElement(el) ? bindingSyms(el.name) : [])))
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) calls.push(node)
    if (ts.isVariableDeclaration(node) && node.initializer && isFsImport(node.initializer)) {
      if (ts.isIdentifier(node.name)) add(fsNs, node.name)
      else if (ts.isObjectBindingPattern(node.name)) for (const el of node.name.elements) {
        const name = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : ''
        if (READ_FNS.has(name)) add(fsFns, el.name)
        if (name === 'promises') add(fsNs, el.name)
      }
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parameters[0] && ts.isCallExpression(node.parent)
      && ts.isPropertyAccessExpression(node.parent.expression) && node.parent.expression.name.text === 'then'
      && isFsImport(node.parent.expression.expression)) add(fsNs, node.parameters[0].name)
    if (ts.isVariableDeclaration(node) && node.initializer) decls.push({ names: bindingSyms(node.name), value: node.initializer })
    if (ts.isFunctionDeclaration(node) && node.name && node.body) decls.push({ names: bindingSyms(node.name), value: node })
    if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && ts.isVariableDeclarationList(node.initializer))
      decls.push({ names: node.initializer.declarations.flatMap(d => bindingSyms(d.name)), value: node.expression })
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left))
      decls.push({ names: bindingSyms(node.left), value: node.right })
    node.forEachChild(visit)
  }
  visit(sf)

  const staticText = (node: ts.Expression, depth: number): string => {
    if (depth > 4) return '*'
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isTemplateExpression(node))
      return node.head.text + node.templateSpans.map(s => staticText(s.expression, depth + 1) + s.literal.text).join('')
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return staticText(node.left, depth + 1) + staticText(node.right, depth + 1)
    if (ts.isParenthesizedExpression(node)) return staticText(node.expression, depth + 1)
    const d = ts.isIdentifier(node) ? symOf(node)?.valueDeclaration : undefined
    return d && ts.isVariableDeclaration(d) && d.initializer ? staticText(d.initializer, depth + 1) : '*'
  }
  /** Hàm sở hữu tham số: callback mảng → chính mảng; còn lại → symbol của hàm có tên. */
  const ownerOf = (param: ts.ParameterDeclaration): { array?: ts.Expression, fn?: ts.Symbol } => {
    const fn = param.parent
    const parent = fn.parent
    if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isCallExpression(parent) && parent.arguments.includes(fn)
      && ts.isPropertyAccessExpression(parent.expression) && ARRAY_CALLBACKS.has(parent.expression.name.text) && fn.parameters[0] === param)
      return { array: parent.expression.expression }
    if (ts.isFunctionDeclaration(fn) && fn.name) return { fn: symOf(fn.name) }
    if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
      return { fn: symOf(parent.name) }
    return {}
  }
  /** Biểu thức `return` của một hàm (không đi vào hàm lồng): thứ hàm trả về, không phải mọi chuỗi trong thân. */
  const returnsOf = (d: ts.Declaration | undefined): ts.Node[] => {
    const init = d && ts.isVariableDeclaration(d) ? d.initializer : undefined
    const fn = d && ts.isFunctionDeclaration(d) ? d : init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined
    if (!fn?.body) return []
    if (!ts.isBlock(fn.body)) return [fn.body]
    const out: ts.Node[] = []
    const walk = (node: ts.Node): void => {
      if (ts.isReturnStatement(node) && node.expression) out.push(node.expression)
      if (!ts.isFunctionLike(node)) node.forEachChild(walk)
    }
    fn.body.forEachChild(walk)
    return out
  }
  const collect = (node: ts.Node, acc: Frag, depth = 0, seen = new Set<ts.Node>(), params = true): void => {
    if (depth > 8 || seen.has(node)) return
    seen.add(node)
    const next = (child: ts.Node, withParams = params) => collect(child, acc, depth + 1, seen, withParams)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) acc.texts.add(node.text)
    else if (ts.isTemplateExpression(node)) {
      acc.texts.add(staticText(node, 0))
      for (const span of node.templateSpans) next(span.expression)
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      acc.texts.add(staticText(node, 0))
      next(node.left)
      next(node.right)
    } else if (ts.isIdentifier(node)) {
      const s = symOf(node)
      const helper = s && helperSyms.get(s)
      if (helper) { for (const t of helper.info.texts) acc.texts.add(t); return }
      const d = s?.valueDeclaration ?? s?.declarations?.[0]
      if (!d) return
      if (ts.isParameter(d)) {
        const owner = ownerOf(d)
        if (owner.array) next(owner.array)
        else if (owner.fn && params) acc.params.add(owner.fn)
        return
      }
      let decl: ts.Node = d
      while (ts.isBindingElement(decl) || ts.isObjectBindingPattern(decl) || ts.isArrayBindingPattern(decl)) decl = decl.parent
      if (!ts.isVariableDeclaration(decl)) return
      if (decl.initializer) next(decl.initializer)
      else if (ts.isForOfStatement(decl.parent.parent) || ts.isForInStatement(decl.parent.parent)) next(decl.parent.parent.expression)
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression
      if (SANDBOX_FNS.has(calleeName(callee))) acc.texts.add(SANDBOX)
      for (const arg of node.arguments ?? []) next(arg)
      if (ts.isPropertyAccessExpression(callee)) next(callee.expression)
      const s = ts.isIdentifier(callee) ? symOf(callee) : undefined
      if (s && helperSyms.get(s)?.info.texts.includes(SANDBOX)) acc.texts.add(SANDBOX)
      if (s && (node.arguments ?? []).length === 0) returnsOf(s.valueDeclaration).forEach(r => next(r, false))
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) next(prop.initializer)
        else if (ts.isShorthandPropertyAssignment(prop)) next(prop.name)
      }
    } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(el => next(el))
    else if (ts.isConditionalExpression(node)) { next(node.whenTrue); next(node.whenFalse) }
    else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isParenthesizedExpression(node)
      || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node) || ts.isSpreadElement(node)
      || ts.isSatisfiesExpression(node)) next(node.expression)
  }

  return { symOf, fsFns, fsNs, execFns, helperSyms, ast, calls, decls, returnsOf, collect }
}
