/**
 * AST classifier behind `admin-handler-authorization.test.ts`: does a handler
 * under `server/api/admin/**` enforce an authorization check?
 *
 * Built on the TypeScript compiler API (not regex) so that comments, `import type`,
 * import boundaries and "is this result actually used" are exact. Exported as a
 * separate module so mutation proofs can run the SAME classifier on scratch copies
 * of handlers (`classifyHandler(file, { overrides })`) without touching real files.
 *
 * What counts as a check:
 *  1. A call to `requireResourcePermission`, `requireSuperAdmin`,
 *     `require<Something>Permission` or `requireAnalyticsRead` (they throw).
 *  2. A call to `checkPermission(...)` ONLY when its boolean is consumed: it reaches
 *     an `if`/`?:` condition, a `return` or a `throw` (through `!`, `&&`/`||`/`??`,
 *     comparisons, `await`, parentheses, property access/method calls on the result,
 *     call arguments whose call result is itself consumed, an arrow's concise body
 *     whose enclosing call is consumed, or a `const` whose identifier is consumed).
 *     `checkPermission(...);` as a bare statement is NOT a check.
 *  3. One hop (or more) through `server/services/**` / `server/utils/**`: the handler
 *     must CALL an imported function, and THAT function (resolved per exported
 *     name, following local helpers and further service/util imports) must contain
 *     a check. Importing a module that happens to contain a check somewhere else
 *     proves nothing. `server/utils/permissions.ts` / `server/utils/auth.ts` define
 *     the checks and are never a hop.
 * Analysis starts at the handler's `export default` and follows only the local
 * functions it calls — a helper that is defined but never called does not count.
 * Limitation (stated, not hidden): presence of a check in a reachable function is
 * required, not that it runs on every path.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const ROOT = path.resolve(import.meta.dirname, '..')
const STRONG_CHECK = /^(?:requireResourcePermission|require[A-Z]\w*Permission|requireAnalyticsRead|requireSuperAdmin)$/
/** Modules that define the checks: importing them is not evidence of calling them. */
export const DEFINING_MODULES = new Set(['server/utils/permissions.ts', 'server/utils/auth.ts'])
const MAX_HOPS = 4

export interface ClassifyOptions {
  /** Absolute path → source text, used instead of the file on disk (mutation proofs). */
  overrides?: ReadonlyMap<string, string>
}

export const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

interface ModuleInfo {
  sourceFile: ts.SourceFile
  /** Local top-level function-like declarations by name. */
  locals: Map<string, ts.Node>
  /** Exported name → local function node (or a re-export target). */
  exports: Map<string, ts.Node | { from: string, name: string }>
  /** Local binding → imported module (absolute) + imported name (`default`, `*`, or a name). */
  imports: Map<string, { module: string, name: string }>
  defaultExport: ts.Node | null
}

function readSource(file: string, options: ClassifyOptions): string | null {
  const override = options.overrides?.get(file)
  if (override !== undefined) return override
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  if (base.endsWith('.ts')) return base
  if (!existsSync(`${base}.ts`) && existsSync(path.join(base, 'index.ts'))) return path.join(base, 'index.ts')
  return `${base}.ts`
}

const hasExportModifier = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
const hasDefaultModifier = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.DefaultKeyword)

const moduleCache = new Map<string, ModuleInfo | null>()

export function loadModule(file: string, options: ClassifyOptions = {}): ModuleInfo | null {
  const cacheable = !options.overrides
  if (cacheable && moduleCache.has(file)) return moduleCache.get(file)!
  const source = readSource(file, options)
  if (source === null) {
    if (cacheable) moduleCache.set(file, null)
    return null
  }
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const info: ModuleInfo = { sourceFile, locals: new Map(), exports: new Map(), imports: new Map(), defaultExport: null }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause
      if (!clause || clause.isTypeOnly) continue
      const target = resolveSpecifier(file, statement.moduleSpecifier.text)
      if (!target) continue
      if (clause.name) info.imports.set(clause.name.text, { module: target, name: 'default' })
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) info.imports.set(bindings.name.text, { module: target, name: '*' })
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue
          info.imports.set(element.name.text, { module: target, name: (element.propertyName ?? element.name).text })
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      info.locals.set(statement.name.text, statement)
      if (hasExportModifier(statement)) info.exports.set(hasDefaultModifier(statement) ? 'default' : statement.name.text, statement)
    } else if (ts.isFunctionDeclaration(statement) && hasDefaultModifier(statement)) {
      info.exports.set('default', statement)
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        info.locals.set(declaration.name.text, declaration.initializer)
        if (hasExportModifier(statement)) info.exports.set(declaration.name.text, declaration.initializer)
      }
    } else if (ts.isExportAssignment(statement)) {
      info.defaultExport = statement.expression
      info.exports.set('default', statement.expression)
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause) && !statement.isTypeOnly) {
      const from = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? resolveSpecifier(file, statement.moduleSpecifier.text) : null
      for (const element of statement.exportClause.elements) {
        const localName = (element.propertyName ?? element.name).text
        if (from) info.exports.set(element.name.text, { from, name: localName })
        else info.exports.set(element.name.text, info.locals.get(localName) ?? { from: file, name: localName })
      }
    }
  }
  if (!info.defaultExport) {
    const fn = info.exports.get('default')
    if (fn && !('from' in fn)) info.defaultExport = fn
  }
  if (cacheable) moduleCache.set(file, info)
  return info
}

/** Name of the function a call targets: `f(...)` → `{ name: 'f' }`, `ns.f(...)` → `{ object: 'ns', name: 'f' }`. */
function calleeOf(call: ts.CallExpression): { object?: string, name: string } | null {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return { name: callee.text }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) return { object: callee.expression.text, name: callee.name.text }
  return null
}

const PASS_THROUGH_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken,
])

/** Is the value of `expression` used for a decision (condition / return / throw)? */
export function isResultConsumed(expression: ts.Node, depth = 0): boolean {
  if (depth > 8) return false
  let current: ts.Node = expression
  for (;;) {
    const parent = current.parent
    if (!parent) return false
    if (ts.isParenthesizedExpression(parent) || ts.isAwaitExpression(parent) || ts.isPrefixUnaryExpression(parent)
      || ts.isAsExpression(parent) || ts.isNonNullExpression(parent) || ts.isSatisfiesExpression(parent)) {
      current = parent
      continue
    }
    if (ts.isBinaryExpression(parent) && PASS_THROUGH_OPERATORS.has(parent.operatorToken.kind)) { current = parent; continue }
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) { current = parent; continue }
    if (ts.isCallExpression(parent)) { current = parent; continue } // method call on the value, or the value as an argument
    if (ts.isIfStatement(parent) && parent.expression === current) return true
    if (ts.isConditionalExpression(parent) && parent.condition === current) return true
    if (ts.isReturnStatement(parent) || ts.isThrowStatement(parent)) return true
    if (ts.isArrowFunction(parent) && parent.body === current) {
      // A concise arrow body is consumed only if the call it is passed to is.
      if (parent.parent && ts.isCallExpression(parent.parent)) { current = parent.parent; continue }
      return false
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current && ts.isIdentifier(parent.name)) {
      return identifierConsumed(parent.name, depth + 1)
    }
    return false
  }
}

function identifierConsumed(declared: ts.Identifier, depth: number): boolean {
  let scope: ts.Node = declared
  while (scope.parent && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent
  let consumed = false
  const visit = (node: ts.Node) => {
    if (consumed) return
    if (ts.isIdentifier(node) && node !== declared && node.text === declared.text && isResultConsumed(node, depth)) consumed = true
    else ts.forEachChild(node, visit)
  }
  visit(scope)
  return consumed
}

/**
 * Does the code reachable from `root` (in `module`) contain a check? Follows calls
 * to local functions and to functions imported from non-defining services/utils.
 */
function enforcesCheck(module: ModuleInfo, root: ts.Node, options: ClassifyOptions, visited: Set<string>, hops: number): boolean {
  let found = false
  const pending: ts.Node[] = [root]
  const seenLocals = new Set<string>()
  while (pending.length && !found) {
    const node = pending.pop()!
    const visit = (child: ts.Node) => {
      if (found) return
      if (ts.isCallExpression(child)) {
        const callee = calleeOf(child)
        if (callee && !callee.object) {
          if (STRONG_CHECK.test(callee.name) && !module.locals.has(callee.name)) {
            const imported = module.imports.get(callee.name)
            // A same-named helper imported from somewhere other than the defining
            // modules is followed like any other import rather than trusted by name.
            if (!imported || DEFINING_MODULES.has(rel(imported.module))) { found = true; return }
          }
          if (callee.name === 'checkPermission' && isResultConsumed(child)) {
            const imported = module.imports.get(callee.name)
            if (!imported || DEFINING_MODULES.has(rel(imported.module))) { found = true; return }
          }
          const local = module.locals.get(callee.name)
          if (local && !seenLocals.has(callee.name)) { seenLocals.add(callee.name); pending.push(local) }
        }
        if (callee && hops < MAX_HOPS) {
          const binding = callee.object ? module.imports.get(callee.object) : module.imports.get(callee.name)
          const importedName = callee.object ? (binding?.name === '*' ? callee.name : null) : binding?.name
          if (binding && importedName && importedFunctionEnforcesCheck(binding.module, importedName, options, visited, hops + 1)) { found = true; return }
        }
      }
      ts.forEachChild(child, visit)
    }
    visit(node)
  }
  return found
}

function importedFunctionEnforcesCheck(modulePath: string, name: string, options: ClassifyOptions, visited: Set<string>, hops: number): boolean {
  const relative = rel(modulePath)
  if (!/^server\/(services|utils)\//.test(relative) || DEFINING_MODULES.has(relative)) return false
  const key = `${modulePath}#${name}`
  if (visited.has(key)) return false
  visited.add(key)
  const module = loadModule(modulePath, options)
  if (!module) return false
  const target = module.exports.get(name)
  if (!target) return false
  if ('from' in target) return importedFunctionEnforcesCheck(target.from, target.name, options, visited, hops)
  return enforcesCheck(module, target, options, visited, hops)
}

/** `'enforced'` when the handler reaches a check, `null` when it does not. */
export function classifyHandler(file: string, options: ClassifyOptions = {}): 'enforced' | null {
  const module = loadModule(file, options)
  if (!module) return null
  const root = module.defaultExport ?? module.sourceFile
  return enforcesCheck(module, root, options, new Set(), 0) ? 'enforced' : null
}
