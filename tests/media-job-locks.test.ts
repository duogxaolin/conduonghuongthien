import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import type * as TS from 'typescript'

/**
 * The restore refuses while any media job lock is held — so the list it reads
 * (`MEDIA_JOB_LOCK_NAMES`, `pre-job-backup.ts`) must hold EVERY named lock those jobs
 * really take, and nothing else.
 *
 * Derived from the source, not from a hand list:
 *  - the job modules = every `server/services` file that calls
 *    `abortJobIfRestoreInProgress(` (a new job that adopts the restore check is covered
 *    the day it does), checked to contain the six known ones so the derivation cannot
 *    come back empty;
 *  - the locks = the 2nd argument of every `withNamedLock(…)` call in them (nested ones
 *    included), and the parameter of a raw `GET_LOCK` query (`media-scan.ts`), each
 *    resolved statically to its string: literal → local `const` → imported binding (into
 *    the exporting module) → property of an object literal (`MEDIA_JOB_LOCK.sync`).
 */

const ts = createRequire(import.meta.url)('typescript') as typeof TS
const SERVICES = new URL('../server/services/', import.meta.url).pathname
const EXPECTED_JOB_MODULES = ['articles-thumbnail-scan.ts', 'media-repair.ts', 'media-repoint.ts', 'media-scan.ts', 'media-self-heal.ts', 'media-sync.ts']

const sources = new Map<string, TS.SourceFile>()
function parse(file: string): TS.SourceFile {
  let source = sources.get(file)
  if (!source) {
    source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true)
    sources.set(file, source)
  }
  return source
}
function resolveModule(from: string, specifier: string): string {
  const base = path.resolve(path.dirname(from), specifier)
  return base.endsWith('.ts') ? base : `${base}.ts`
}
function unwrap(node: TS.Expression): TS.Expression {
  let current = node
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression
  return current
}
/** The initializer of a top-level `const <name>` in `file`, or the binding it is imported as. */
function lookup(file: string, name: string): { kind: 'expr', file: string, expr: TS.Expression } | { kind: 'import', file: string, name: string } {
  const source = parse(file)
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return { kind: 'expr', file, expr: declaration.initializer }
      }
    }
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.name.text === name) {
          const specifier = (statement.moduleSpecifier as TS.StringLiteral).text
          return { kind: 'import', file: resolveModule(file, specifier), name: (element.propertyName ?? element.name).text }
        }
      }
    }
  }
  throw new Error(`${path.basename(file)}: cannot find a const or an import named ${name}`)
}
function resolveName(file: string, name: string): { file: string, expr: TS.Expression } {
  const found = lookup(file, name)
  return found.kind === 'expr' ? { file: found.file, expr: found.expr } : resolveName(found.file, found.name)
}
/** The string a lock-name expression evaluates to. */
function resolveString(file: string, node: TS.Expression): string {
  const expr = unwrap(node)
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text
  if (ts.isIdentifier(expr)) {
    const target = resolveName(file, expr.text)
    return resolveString(target.file, target.expr)
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const target = resolveName(file, expr.expression.text)
    const object = unwrap(target.expr)
    assert.ok(ts.isObjectLiteralExpression(object), `${expr.getText()}: not an object literal`)
    const property = object.properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText() === expr.name.text)
    assert.ok(property && ts.isPropertyAssignment(property), `${expr.getText()}: no such property`)
    return resolveString(target.file, property.initializer)
  }
  throw new Error(`${path.basename(file)}: cannot resolve the lock name ${expr.getText()} statically`)
}
/** Every named lock a module takes: `withNamedLock(pool, <name>, …)` and `…query('… GET_LOCK …', [<name>, …])`. */
function locksTakenIn(file: string): string[] {
  const names: string[] = []
  const visit = (node: TS.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === 'withNamedLock' && node.arguments[1]) names.push(resolveString(file, node.arguments[1]))
      const [sql, params] = node.arguments
      if (sql && (ts.isStringLiteral(sql) || ts.isNoSubstitutionTemplateLiteral(sql)) && /\bGET_LOCK\s*\(/.test(sql.text)) {
        assert.ok(params && ts.isArrayLiteralExpression(params) && params.elements[0], `${path.basename(file)}: GET_LOCK without a parameter array`)
        names.push(resolveString(file, params.elements[0] as TS.Expression))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parse(file))
  return names
}

function jobModules(): string[] {
  return readdirSync(SERVICES)
    .filter(name => name.endsWith('.ts') && name !== 'pre-job-backup.ts')
    .filter(name => /\babortJobIfRestoreInProgress\(/.test(readFileSync(path.join(SERVICES, name), 'utf8')))
    .sort()
}

test('every media job module (derived: it calls abortJobIfRestoreInProgress) is found — the derivation is not empty', () => {
  const found = jobModules()
  for (const expected of EXPECTED_JOB_MODULES) assert.ok(found.includes(expected), `${expected} no longer calls abortJobIfRestoreInProgress`)
})

test('the restore reads exactly the named locks the media jobs take (no lock missing, no stale entry)', async () => {
  const { MEDIA_JOB_LOCK_NAMES } = await import('../server/services/pre-job-backup')
  const perModule = Object.fromEntries(jobModules().map(name => [name, locksTakenIn(path.join(SERVICES, name))]))
  for (const [name, locks] of Object.entries(perModule)) assert.ok(locks.length > 0, `${name}: no lock found — the parser no longer matches how it locks`)
  const taken = [...new Set(Object.values(perModule).flat())].sort()
  assert.deepEqual(taken, [...MEDIA_JOB_LOCK_NAMES].sort(), `locks taken by the media jobs: ${JSON.stringify(perModule)}`)
})

test('the restore asks about the shared list (through pre-job-backup), never a copy of the names', () => {
  const restore = readFileSync(path.join(SERVICES, 'backup-restore.ts'), 'utf8')
  assert.match(restore, /import \{[^}]*\bmediaJobsBlockingRestore\b[^}]*\} from '\.\/pre-job-backup'/)
  assert.match(restore, /await mediaJobsBlockingRestore\(pool\)/)
  assert.doesNotMatch(restore, /['"`]cdkt:(media|articles):/, 'a media job lock name is spelled out in backup-restore.ts')
  // …and the question it asks is built from the list itself.
  const shared = readFileSync(path.join(SERVICES, 'pre-job-backup.ts'), 'utf8')
  const fn = /export async function mediaJobsBlockingRestore[\s\S]*?\n\}/.exec(shared)?.[0] ?? ''
  assert.match(fn, /MEDIA_JOB_LOCK_NAMES\.map\(/)
  assert.match(fn, /\[\.\.\.MEDIA_JOB_LOCK_NAMES\]/)
})
