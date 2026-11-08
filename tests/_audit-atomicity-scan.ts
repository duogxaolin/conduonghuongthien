/**
 * The scanner behind `tests/reader-audit-atomicity.test.ts`, per FUNCTION and per TRANSACTION
 * rather than per file.
 *
 * Why it exists (2026-11-08, `refactor/api-guards`): every direct DB access is moving out of
 * `server/api/**` into `server/services/**`. The guard's directory scans read whole files, so a
 * service file holding two audited functions let either lose its audit row unnoticed, and the
 * "no pool write inside a transaction" check read only the FIRST transaction of a file. This
 * module reads the TypeScript AST and reports, for every top-level function of a file, every
 * write it performs — its own, and those of same-file helpers it calls directly, attributed at
 * the call site with the handle the caller passed — and which transaction each one runs in.
 *
 * What counts:
 *   - a WRITE is `<handle>.insert|update|delete(<table>)` (Drizzle) where the table is an
 *     identifier imported from `db/schema` or the handle reads like a database handle, or a raw
 *     `<handle>.execute|query(…)` whose SQL (a literal, a `sql` template, or a same-function
 *     `const` holding one) starts with INSERT / UPDATE / DELETE / REPLACE;
 *   - an AUDIT row is an INSERT into `activityLogs` (raw: `activity_logs`). An update or delete of
 *     `activityLogs` is a write to the audit table, judged like any other row write (deleting
 *     audit rows unrecorded is exactly what the delete rule exists for). A `select` / `from` /
 *     `join` / column reference of `activityLogs` is a READ ({@link auditTableReferences});
 *   - a write is ON a transaction when its handle's root identifier is the parameter of an
 *     enclosing `.transaction(cb)` callback (inline, or a function passed by name); `txScope`
 *     names WHICH transaction, so a row written in one transaction and audited in another is
 *     visible as such.
 *
 * Helpers: a non-exported function whose every in-file mention is a direct call is judged at its
 * callers (its writes are inlined there, with the caller's handle), not on its own. Passed by
 * value, aliased or exported, it is judged on its own as well — its callers cannot be seen.
 *
 * Text, not behaviour: like the rest of the guard this proves the shape of the code. Writes made
 * through another MODULE are invisible here (that module is scanned on its own), and an aliased
 * table (`const t = activityLogs; tx.insert(t)`) reads as a row write, not an audit.
 */
import ts from 'typescript'

export type WriteKind = 'insert' | 'update' | 'delete'

export interface WriteSite {
  kind: WriteKind
  /** The table: the first argument's identifier (Drizzle) or the SQL table name (raw); `?` if unknown. */
  table: string
  /** An audit row: an INSERT into `activity_logs`. */
  audit: boolean
  /** The handle's text at the attributed site: `tx`, `db`, `getDb()`, `(executor ?? getDb())`. */
  handle: string
  /** The handle is the parameter of an enclosing transaction callback. */
  onTx: boolean
  /** The site sits inside a transaction callback. */
  inTx: boolean
  /** Which transaction the write runs in (`<unit>@<offset>`), when `onTx`. */
  txScope: string | null
  /** 1-based line of the attributed site in the scanned file. */
  line: number
  /** Set when the write was performed by a same-file helper called from this unit. */
  via?: string
  /** The same-file functions the write was reached through, outermost first (empty: own write). */
  path: string[]
}

export interface UnitFacts {
  /** Function name; `default` for `export default`; `<top-level:N>` for other statements. */
  name: string
  exported: boolean
  /** Own writes plus writes of same-file helpers it calls directly (transitively). */
  writes: WriteSite[]
  /** Writes lexically inside this unit only. */
  ownWrites: WriteSite[]
  /**
   * Transactions whose handle this unit hands to a function of ANOTHER module (`addViews({
   * executor: tx })`, `deleteReaderComments(id, tx)`): a row may be written there, out of sight.
   */
  delegatedScopes: string[]
  /** Same-file units that mention this unit's name. */
  referencedBy: string[]
  /** Every in-file mention of this unit is a direct call `name(…)`. */
  directCallOnly: boolean
  /** The unit's source text. */
  text: string
}

const AUDIT_TABLE = 'activityLogs'
const AUDIT_TABLE_SQL = 'activity_logs'
/** Handle roots that read like a database handle even when the table is not a schema import. */
const DB_HANDLE = /^(?:db|tx|trx|conn|connection|executor|store|pool)$|getDb\(\)|getPool\(\)|\bexecutor\b|\btx\b/
/** Stands for "the transaction handle" when a top-level function is passed to `.transaction(name)`. */
const TX_MARKER = '<transaction handle>'
const JOIN_METHODS = new Set(['from', 'join', 'leftJoin', 'rightJoin', 'innerJoin', 'fullJoin', 'crossJoin'])

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The receiver's root: `tx` for `tx.insert`, `db` for `db\n.update(…)`, `getDb()` for `getDb().delete`. */
function receiverRoot(expression: ts.Expression): ts.Expression {
  let node = expression
  while (ts.isNonNullExpression(node) || ts.isAsExpression(node)) node = node.expression
  return node
}

/** `const statement = \`DELETE FROM …\`` handed to `query(statement)`: its literal, in the same unit. */
function literalBehind(identifier: ts.Identifier, unit: ts.Node): ts.Expression | undefined {
  let found: ts.Expression | undefined
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === identifier.text && node.initializer) {
      found = node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(unit)
  return found
}

/** The SQL text of a raw call's first argument, and the first interpolation (a table passed as `${t}`). */
function sqlText(argument: ts.Expression | undefined, unit: ts.Node): { text: string, firstSpan?: ts.Expression } | null {
  let first = argument
  if (first && ts.isIdentifier(first)) first = literalBehind(first, unit)
  if (!first) return null
  if (ts.isTaggedTemplateExpression(first)) {
    const template = first.template
    return ts.isNoSubstitutionTemplateLiteral(template)
      ? { text: template.text }
      : { text: template.head.text, firstSpan: template.templateSpans[0]?.expression }
  }
  if (ts.isStringLiteralLike(first)) return { text: first.text }
  if (ts.isTemplateExpression(first)) return { text: first.head.text, firstSpan: first.templateSpans[0]?.expression }
  return null
}

function rawWrite(node: ts.CallExpression, unit: ts.Node): { kind: WriteKind, table: string } | null {
  const sqlArg = sqlText(node.arguments[0], unit)
  if (!sqlArg) return null
  const { text, firstSpan } = sqlArg
  const match = /^\s*(insert|update|delete|replace)\b/i.exec(text)
  if (!match) return null
  const verb = match[1]!.toLowerCase()
  const kind: WriteKind = verb === 'delete' ? 'delete' : verb === 'update' ? 'update' : 'insert'
  const named = verb === 'update'
    ? /^\s*update\s+(?:ignore\s+)?`?(\w+)`?/i.exec(text)
    : verb === 'delete'
      ? /\bfrom\s+`?(\w+)`?/i.exec(text)
      : /\binto\s+`?(\w+)`?/i.exec(text)
  if (named?.[1]) return { kind, table: named[1] }
  // `INSERT INTO ${activityLogs} …`: the table is the first interpolation.
  if (firstSpan && ts.isIdentifier(firstSpan) && /(?:\binto|^\s*update|\bfrom)\s*$/i.test(text)) {
    return { kind, table: firstSpan.text === AUDIT_TABLE ? AUDIT_TABLE_SQL : firstSpan.text }
  }
  return { kind, table: '?' }
}

/** The function a top-level statement declares, if any (declaration, `const f = …`, `export default defineX(fn)`). */
function functionOf(node: ts.Node): ts.SignatureDeclaration | undefined {
  if (ts.isFunctionDeclaration(node)) return node
  if (ts.isVariableStatement(node)) {
    const init = node.declarationList.declarations[0]?.initializer
    return init ? unwrapFunction(init) : undefined
  }
  if (ts.isExportAssignment(node)) return unwrapFunction(node.expression)
  return undefined
}

function unwrapFunction(expression: ts.Expression): ts.SignatureDeclaration | undefined {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression
  if (ts.isCallExpression(expression)) {
    for (const arg of expression.arguments) {
      const fn = unwrapFunction(arg)
      if (fn) return fn
    }
  }
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) return unwrapFunction(expression.expression)
  return undefined
}

function unitName(node: ts.Statement, sourceFile: ts.SourceFile): { name: string, exported: boolean } {
  const exported = ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) return { name: node.name.text, exported }
  if (ts.isVariableStatement(node)) {
    const first = node.declarationList.declarations[0]
    if (first && ts.isIdentifier(first.name)) return { name: first.name.text, exported }
  }
  if (ts.isExportAssignment(node)) return { name: 'default', exported: true }
  return { name: `<top-level:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}>`, exported: false }
}

/**
 * Local names a file exports through a list (`export { a, b as c }`, no `from`): such a function
 * is exported exactly like `export function a`, so its callers in other files cannot be seen.
 * Maps the local name to the name it is exported as.
 */
function localExportList(sourceFile: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || statement.isTypeOnly) continue
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue
    for (const el of statement.exportClause.elements) if (!el.isTypeOnly) out.set((el.propertyName ?? el.name).text, el.name.text)
  }
  return out
}

interface TxScope { id: string, param: string, start: number, end: number }

interface CallSite {
  callee: string
  args: string[]
  argRoots: string[]
  line: number
  /** Enclosing transaction scopes at the call site, innermost last. */
  scopes: TxScope[]
}

interface RawUnit {
  name: string
  exported: boolean
  node: ts.Statement
  params: string[]
  ownWrites: WriteSite[]
  callSites: CallSite[]
  /** Units this one mentions, and whether some mention is not a direct call. */
  mentions: Map<string, { indirect: boolean }>
  delegatedScopes: Set<string>
}

/** Identifiers handed to a call: plain arguments and the values of an object-literal argument. */
function handedIdentifiers(node: ts.CallExpression): string[] {
  const out: string[] = []
  for (const arg of node.arguments) {
    if (ts.isIdentifier(arg)) out.push(arg.text)
    else if (ts.isObjectLiteralExpression(arg)) {
      for (const property of arg.properties) {
        if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) out.push(property.initializer.text)
        else if (ts.isShorthandPropertyAssignment(property)) out.push(property.name.text)
      }
    }
  }
  return out
}

function parse(fileName: string, source: string) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

/** Every top-level unit of `source`, with its writes attributed per {@link UnitFacts}. */
export function scanUnits(fileName: string, source: string): UnitFacts[] {
  const sourceFile = parse(fileName, source)
  const schemaTables = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!/(?:^|\/)db\/schema(?:\.ts)?$/.test(statement.moduleSpecifier.text)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) schemaTables.add(el.name.text)
  }
  const lineOf = (node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

  const listed = localExportList(sourceFile)
  const units: RawUnit[] = []
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue
    if (ts.isExportDeclaration(statement)) continue // `export { a }` / `export … from`: names a unit, is not one
    const { name, exported } = unitName(statement, sourceFile)
    const params = (functionOf(statement)?.parameters ?? []).map(p => (ts.isIdentifier(p.name) ? p.name.text : ''))
    units.push({ name, exported: exported || listed.has(name), node: statement, params, ownWrites: [], callSites: [], mentions: new Map(), delegatedScopes: new Set() })
  }
  const unitNames = new Set(units.map(u => u.name))

  for (const unit of units) {
    const scopes: TxScope[] = []
    const enclosing = (node: ts.Node) => scopes
      .filter(s => node.getStart(sourceFile) >= s.start && node.end <= s.end)
      .sort((a, b) => a.start - b.start)

    /** Local functions, for a `.transaction(name)` callback passed by name. */
    const localFunctions = new Map<string, ts.SignatureDeclaration>()
    const collectLocals = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const fn = unwrapFunction(node.initializer)
        if (fn) localFunctions.set(node.name.text, fn)
      }
      if (ts.isFunctionDeclaration(node) && node.name && node !== unit.node) localFunctions.set(node.name.text, node)
      ts.forEachChild(node, collectLocals)
    }
    collectLocals(unit.node)

    const openScope = (fn: ts.SignatureDeclaration) => {
      const [first] = fn.parameters
      const start = fn.getStart(sourceFile)
      if (first && ts.isIdentifier(first.name)) scopes.push({ id: `${unit.name}@${start}`, param: first.name.text, start, end: fn.end })
    }

    // First pass: transaction scopes (a callback may be declared before the call that uses it).
    const findScopes = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'transaction') {
        const [cb] = node.arguments
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) openScope(cb)
        else if (cb && ts.isIdentifier(cb)) {
          const local = localFunctions.get(cb.text)
          if (local) openScope(local)
          else if (unitNames.has(cb.text)) {
            // A top-level function passed by name runs entirely on the transaction handle.
            const id = `${unit.name}@${node.getStart(sourceFile)}`
            unit.callSites.push({
              callee: cb.text, args: [TX_MARKER], argRoots: [TX_MARKER], line: lineOf(node),
              scopes: [...enclosing(node), { id, param: TX_MARKER, start: node.getStart(sourceFile), end: node.end }],
            })
          }
        }
      }
      ts.forEachChild(node, findScopes)
    }
    findScopes(unit.node)

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && unitNames.has(node.text) && node.text !== unit.name) {
        const parent = node.parent
        const isDeclarationName = (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent)
          || ts.isPropertyAssignment(parent) || ts.isBindingElement(parent)) && parent.name === node
        const isPropertyName = ts.isPropertyAccessExpression(parent) && parent.name === node
        if (!isDeclarationName && !isPropertyName) {
          const direct = ts.isCallExpression(parent) && parent.expression === node
          const seen = unit.mentions.get(node.text)
          unit.mentions.set(node.text, { indirect: (seen?.indirect ?? false) || !direct })
        }
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        const here = enclosing(node)
        if (ts.isPropertyAccessExpression(callee)) {
          const method = callee.name.text
          const root = receiverRoot(callee.expression)
          const handle = squash(root.getText(sourceFile))
          const rootIdent = ts.isIdentifier(root) ? root.text : null
          const scope = rootIdent === null ? undefined : [...here].reverse().find(s => s.param === rootIdent)
          const site = { handle, onTx: scope !== undefined, inTx: here.length > 0, txScope: scope?.id ?? null, line: lineOf(node), path: [] as string[] }
          if (method === 'insert' || method === 'update' || method === 'delete') {
            const [first] = node.arguments
            const table = first && ts.isIdentifier(first) ? first.text : first ? squash(first.getText(sourceFile)) : null
            const looksLikeDb = (first && ts.isIdentifier(first) && (schemaTables.has(first.text) || first.text === AUDIT_TABLE))
              || DB_HANDLE.test(handle) || site.onTx
            if (table !== null && looksLikeDb) {
              unit.ownWrites.push({ kind: method, table, audit: method === 'insert' && table === AUDIT_TABLE, ...site })
            }
          } else if (method === 'execute' || method === 'query') {
            const raw = rawWrite(node, unit.node)
            if (raw) unit.ownWrites.push({ ...raw, audit: raw.kind === 'insert' && raw.table === AUDIT_TABLE_SQL, ...site })
          }
        }
        const sameFileCall = ts.isIdentifier(callee) && unitNames.has(callee.text)
        if (!sameFileCall && !(ts.isPropertyAccessExpression(callee) && callee.name.text === 'transaction')) {
          const handed = handedIdentifiers(node)
          for (const scope of here) if (handed.includes(scope.param)) unit.delegatedScopes.add(scope.id)
        }
        if (ts.isIdentifier(callee) && unitNames.has(callee.text) && callee.text !== unit.name) {
          unit.callSites.push({
            callee: callee.text,
            args: node.arguments.map(a => squash(a.getText(sourceFile))),
            argRoots: node.arguments.map((a) => {
              const root = receiverRoot(a)
              return ts.isIdentifier(root) ? root.text : squash(root.getText(sourceFile))
            }),
            line: lineOf(node),
            scopes: here,
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(unit.node)
  }

  const byName = new Map(units.map(u => [u.name, u]))
  const resolved = new Map<string, WriteSite[]>()
  /** Writes of `unit` (own + direct callees), as seen from inside `unit`. */
  const resolve = (unit: RawUnit, stack: Set<string>): WriteSite[] => {
    const cached = resolved.get(unit.name)
    if (cached) return cached
    if (stack.has(unit.name)) return []
    stack.add(unit.name)
    const out: WriteSite[] = [...unit.ownWrites]
    for (const site of unit.callSites) {
      const callee = byName.get(site.callee)
      if (!callee) continue
      for (const write of resolve(callee, stack)) {
        let { handle, onTx, txScope } = write
        // A write on one of the callee's parameters runs on whatever the caller passed there.
        const paramIndex = write.onTx
          ? -1
          : callee.params.findIndex(p => p !== '' && new RegExp(`(?:^|[^\\w$])${p}(?:[^\\w$]|$)`).test(write.handle))
        if (paramIndex !== -1) {
          const passed = site.args[paramIndex]
          const passedRoot = site.argRoots[paramIndex]
          const scope = passedRoot === undefined ? undefined : [...site.scopes].reverse().find(s => s.param === passedRoot)
          handle = passed ?? `${write.handle} (nothing passed)`
          onTx = scope !== undefined
          txScope = scope?.id ?? null
        }
        out.push({
          ...write, handle, onTx, txScope,
          inTx: site.scopes.length > 0 || write.inTx,
          line: site.line,
          via: write.via ? `${site.callee} → ${write.via}` : site.callee,
          path: [site.callee, ...write.path],
        })
      }
    }
    stack.delete(unit.name)
    resolved.set(unit.name, out)
    return out
  }

  return units.map((unit) => {
    const referrers = units.filter(other => other !== unit && other.mentions.has(unit.name))
    return {
      name: unit.name,
      exported: unit.exported,
      writes: resolve(unit, new Set()),
      ownWrites: unit.ownWrites,
      delegatedScopes: [...unit.delegatedScopes],
      referencedBy: referrers.map(other => other.name),
      directCallOnly: referrers.every(other => !other.mentions.get(unit.name)!.indirect),
      text: unit.node.getText(sourceFile),
    }
  })
}

export type AuditTableReference = { kind: 'write' | 'read' | 'unknown', line: number }

/**
 * Every code reference to the `activityLogs` identifier, classified (imports skipped):
 *   - `write`: the first argument of `.insert|update|delete(…)`, or the table of a raw write;
 *   - `read`: `activityLogs.<column>`, an argument of `.from|join|…Join(…)`, or interpolated
 *     into a `sql` template that is not a write;
 *   - `unknown`: anything else (`{ target: activityLogs }`, an alias). Callers that narrow on
 *     "writes the audit table" must treat `unknown` as a write — fail closed.
 */
export function auditTableReferences(fileName: string, source: string): AuditTableReference[] {
  const sourceFile = parse(fileName, source)
  const out: AuditTableReference[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return
    if (ts.isIdentifier(node) && node.text === AUDIT_TABLE) {
      const parent = node.parent
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
      let kind: AuditTableReference['kind'] = 'unknown'
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) kind = 'read'
      else if (ts.isCallExpression(parent) && parent.arguments[0] === node && ts.isPropertyAccessExpression(parent.expression)) {
        const method = parent.expression.name.text
        if (method === 'insert' || method === 'update' || method === 'delete') kind = 'write'
        else if (JOIN_METHODS.has(method)) kind = 'read'
      } else if (ts.isTemplateSpan(parent)) {
        const template = parent.parent
        const tagged = template.parent
        if (ts.isTaggedTemplateExpression(tagged)) {
          kind = /^\s*(?:insert|update|delete|replace)\b/i.test(template.head.text) ? 'write' : 'read'
        }
      }
      out.push({ kind, line })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return out
}

/** The file writes `activity_logs` — or references it in a way that cannot be told from a write. */
export function mayWriteAuditTable(fileName: string, source: string): boolean {
  return auditTableReferences(fileName, source).some(ref => ref.kind !== 'read')
}

export type Rule =
  | 'pool-write-in-transaction'
  | 'audit-off-transaction-with-row-write'
  | 'audit-transaction-without-row-write'
  | 'audit-off-transaction'
  | 'delete-without-audit'

export interface UnitProblem { unit: string, rule: Rule, detail: string }

/** Units judged on their own: everything except non-exported helpers reached only by direct calls. */
export function judgedUnits(units: UnitFacts[]): UnitFacts[] {
  return units.filter(u => u.exported || !u.directCallOnly || u.referencedBy.length === 0)
}

const describeSite = (w: WriteSite) => `${w.kind}(${w.table}) on \`${w.handle}\` at line ${w.line}${w.via ? ` via ${w.via}` : ''}`

/**
 * The per-function rules. `pool-write-in-transaction`, the two pairing rules and
 * `delete-without-audit` hold everywhere; `audit-off-transaction` (an audit row written off a
 * transaction with no row of its own beside it — a read audit, a progress audit) is the service
 * layer's rule only, so it is opt-in.
 *
 * `excusedDeleter(name)`: a same-file function named as an unaudited deleter on purpose. Its
 * deletes stay excused when an in-file caller reaches them (`startScheduler → prune`); a delete
 * the caller makes itself is still judged.
 */
export function unitProblems(
  units: UnitFacts[],
  options: { auditOffTransaction: boolean, excusedDeleter?: (name: string) => boolean },
): UnitProblem[] {
  const problems: UnitProblem[] = []
  for (const unit of judgedUnits(units)) {
    const audits = unit.writes.filter(w => w.audit)
    const rows = unit.writes.filter(w => !w.audit)
    for (const w of unit.writes.filter(x => x.inTx && !x.onTx)) {
      problems.push({ unit: unit.name, rule: 'pool-write-in-transaction', detail: `${describeSite(w)} runs inside a transaction but not on its handle — it commits on its own` })
    }
    const offTx = audits.filter(w => !w.onTx)
    if (offTx.length > 0 && rows.length > 0) {
      problems.push({ unit: unit.name, rule: 'audit-off-transaction-with-row-write', detail: `audit ${describeSite(offTx[0]!)} is not on a transaction handle, beside ${describeSite(rows[0]!)}` })
    }
    if (rows.length > 0) {
      for (const a of audits.filter(w => w.onTx)) {
        const delegated = a.txScope !== null && unit.delegatedScopes.includes(a.txScope)
        if (!delegated && !rows.some(r => r.onTx && r.txScope === a.txScope)) {
          problems.push({ unit: unit.name, rule: 'audit-transaction-without-row-write', detail: `audit ${describeSite(a)} sits in a transaction that writes no row — the row (${describeSite(rows[0]!)}) commits separately` })
          break
        }
      }
    }
    if (options.auditOffTransaction && offTx.length > 0 && rows.length === 0) {
      problems.push({ unit: unit.name, rule: 'audit-off-transaction', detail: `audit ${describeSite(offTx[0]!)} is written off any transaction` })
    }
    const excused = options.excusedDeleter ?? (() => false)
    const deletes = rows.filter(w => w.kind === 'delete' && !w.path.some(excused))
    if (deletes.length > 0 && audits.length === 0) {
      problems.push({ unit: unit.name, rule: 'delete-without-audit', detail: `${describeSite(deletes[0]!)} writes no activity_logs row` })
    }
  }
  return problems
}

/** Names of the units that write an audit row (own, or through a same-file helper). */
export function auditingUnits(units: UnitFacts[]): string[] {
  return judgedUnits(units).filter(u => u.writes.some(w => w.audit)).map(u => u.name)
}

// ─── Census of audit rows, keyed by WHAT is recorded, not WHERE ─────────────────────────────

/** One audit row a site writes: `<resource>:<action>`, plus where it was found (messages only). */
export interface CensusEntry { key: string, where: string }

/** A value expression, and the parameter bindings of the function it is read in. */
interface Env { params: Map<string, { expr: ts.Expression, env: Env }>, unit: ts.Node }

/**
 * The literal(s) an expression stands for: a string; `a|b` for a conditional of literals;
 * a parameter resolved through the call that bound it; a same-function `const` holding one.
 * Anything else becomes `‹source text›` — stable when the code is moved verbatim, and
 * readable in the census.
 */
function literalOf(expr: ts.Expression | undefined, env: Env, sourceFile: ts.SourceFile, depth = 0): string {
  if (!expr) return '‹none›'
  if (depth > 6) return `‹${squash(expr.getText(sourceFile))}›`
  if (ts.isStringLiteralLike(expr)) return expr.text
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) return literalOf(expr.expression, env, sourceFile, depth + 1)
  if (ts.isConditionalExpression(expr)) {
    const options = new Set([
      ...literalOf(expr.whenTrue, env, sourceFile, depth + 1).split('|'),
      ...literalOf(expr.whenFalse, env, sourceFile, depth + 1).split('|'),
    ])
    return [...options].sort().join('|')
  }
  if (ts.isIdentifier(expr)) {
    const bound = env.params.get(expr.text)
    if (bound) return literalOf(bound.expr, bound.env, sourceFile, depth + 1)
    const declared = literalBehind(expr, env.unit)
    if (declared && (ts.isStringLiteralLike(declared) || ts.isConditionalExpression(declared))) return literalOf(declared, env, sourceFile, depth + 1)
  }
  return `‹${squash(expr.getText(sourceFile))}›`
}

/** The `<resource>:<action>` of each row handed to `.values(…)`. */
function rowKeys(arg: ts.Expression | undefined, env: Env, sourceFile: ts.SourceFile): string[] {
  if (!arg) return ['‹no values›:‹no values›']
  if (ts.isArrayLiteralExpression(arg)) return arg.elements.flatMap(el => rowKeys(el, env, sourceFile))
  const property = (object: ts.ObjectLiteralExpression, ...names: string[]) => {
    for (const prop of object.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && names.includes(prop.name.text)) return prop.initializer
      if (ts.isShorthandPropertyAssignment(prop) && names.includes(prop.name.text)) return prop.name
    }
    return undefined
  }
  if (ts.isObjectLiteralExpression(arg)) {
    return [`${literalOf(property(arg, 'resource'), env, sourceFile)}:${literalOf(property(arg, 'action'), env, sourceFile)}`]
  }
  // A row builder (`buildChatbotSettingsAudit({ operation: … })`): the builder names the
  // resource, its `operation`/`action` argument the action.
  if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) {
    const [first] = arg.arguments
    const action = first && ts.isObjectLiteralExpression(first) ? property(first, 'operation', 'action') : undefined
    return [`‹${arg.expression.text}›:${action ? literalOf(action, env, sourceFile) : `‹${arg.expression.text}›`}`]
  }
  return [`‹${squash(arg.getText(sourceFile))}›:‹${squash(arg.getText(sourceFile))}›`]
}

/** Audit insert sites lexically inside `node`: the rows of each `.insert(activityLogs).values(…)` / raw INSERT. */
function auditSites(node: ts.Node, env: Env, sourceFile: ts.SourceFile, out: Array<{ keys: string[], line: number }>): void {
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text
      const [first] = n.arguments
      if (method === 'insert' && first && ts.isIdentifier(first) && first.text === AUDIT_TABLE) {
        // Walk up the builder chain to its `.values(…)`.
        let values: ts.CallExpression | undefined
        for (let up: ts.Node = n; up.parent && !values; up = up.parent) {
          const parent = up.parent
          if (ts.isCallExpression(parent) && parent.expression === up && ts.isPropertyAccessExpression(up) && up.name.text === 'values') values = parent
          else if (!(ts.isPropertyAccessExpression(parent) && parent.expression === up) && !(ts.isCallExpression(parent) && parent.expression === up)) break
        }
        out.push({ keys: rowKeys(values?.arguments[0], env, sourceFile), line: sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile)).line + 1 })
      } else if ((method === 'execute' || method === 'query') && rawWrite(n, env.unit)?.table === AUDIT_TABLE_SQL && rawWrite(n, env.unit)?.kind === 'insert') {
        out.push({ keys: ['‹raw SQL›:‹raw SQL›'], line: sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile)).line + 1 })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
}

/** `node` is the name being declared (function, variable, parameter, destructured binding, class…). */
function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent
  return (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isVariableDeclaration(parent)
    || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isClassDeclaration(parent)
    || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)
    || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) && parent.name === node
}

/** A function, method or accessor anywhere inside `node`. */
function holdsFunction(node: ts.Node): boolean {
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
      || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

/** The result of {@link auditCensusOf}: the rows, and every reference the call-site count could not follow. */
export interface CensusResult { entries: CensusEntry[], problems: string[] }

/**
 * Every audit row the server writes, as `<resource>:<action>` — keyed by WHAT is recorded, never
 * by the file or function it is written from, and counted ONCE PER CALL SITE of the function the
 * insert runs in. Moving an insert between a handler and a service changes nothing here; dropping
 * one, changing what it records, or dropping (or swapping out) a CALL to a function that audits,
 * changes the count.
 *
 * Where an insert's rows are counted (`files`: where the inserts are looked for; `callers`: more
 * files read for call sites only — plugins, routes, scripts):
 *   - in an EXPORTED named function: once per call of that function anywhere in `files` +
 *     `callers` — `users/[id].put.ts` calling `updateUserWithAudit(…)` is one `users:update` row;
 *     the handler dropping that call, or calling an unaudited variant instead, drops it. A
 *     function nothing calls writes no row: it counts 0;
 *   - in a non-exported same-file helper: once per in-file mention, through to the exported
 *     function or entry point that mention sits in (a direct call binds the helper's parameters
 *     to its arguments — `audit(tx, actorId, 'create', …)` → `…:create`; a mention by value, a
 *     callback, binds none). A helper nothing mentions counts 0;
 *   - in an entry point — a file's `export default` (a Nitro handler, plugin, route) or a
 *     top-level statement: once.
 * Keys are resolved at the definition (an exported function's parameters stay unbound), so only
 * counts move when call sites do.
 *
 * Fail closed ({@link CensusResult.problems}): the count is by NAME, so an audit-writing exported
 * function referenced other than as a direct call (passed by value, aliased on import or export,
 * reached through a namespace object, declared a second time anywhere) is reported instead of
 * being counted wrong. `typeof f` (a type position) and import / re-export lines are not calls.
 * So is an audit insert inside a function held by a top-level VALUE (`export const ops = {
 * async remove() {…} }`, `const job = defineX({ run() {…} })`): it runs when a member is called,
 * which no name count can see.
 */
export function auditCensusOf(files: Array<{ file: string, source: string }>, callers: Array<{ file: string, source: string }> = []): CensusResult {
  const entries: CensusEntry[] = []
  const problems: string[] = []
  /** Exported function → where it is declared, and the rows ONE call of it writes. */
  const perCall = new Map<string, { file: string, line: number, decl: ts.Node, rows: Array<{ key: string, line: number, via: string }> }>()
  const parsed = files.map(({ file, source }) => ({ file, sourceFile: parse(file, source), units: scanUnits(file, source) }))
  const lineAt = (sourceFile: ts.SourceFile, node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

  for (const { file, sourceFile, units } of parsed) {
    const statements = new Map<string, ts.Statement>()
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isExportDeclaration(statement)) continue
      statements.set(unitName(statement, sourceFile).name, statement)
    }
    const aliasedExports = [...localExportList(sourceFile)].filter(([local, as]) => local !== as)
    const paramsOf = (name: string) => (functionOf(statements.get(name)!)?.parameters ?? []).map(p => (ts.isIdentifier(p.name) ? p.name.text : ''))
    /** Code that runs once, when the module loads or the route is hit: not a function anyone calls. */
    const isEntryPoint = (name: string) => name === 'default' || name.startsWith('<top-level:')
      || (ts.isVariableStatement(statements.get(name)!) && functionOf(statements.get(name)!) === undefined)

    /**
     * The environments a unit's code runs in, each with the ROOT it is reached from: an exported
     * function or an entry point is its own root; a non-exported unit runs once per in-file
     * mention, in each environment of the unit holding the mention. A cycle adds no root.
     */
    const contexts = (name: string, stack: Set<string>): Array<{ env: Env, root: string }> => {
      const node = statements.get(name)!
      const unit = units.find(u => u.name === name)!
      if (unit.exported || isEntryPoint(name)) return [{ env: { params: new Map(), unit: node }, root: name }]
      if (stack.has(name)) return []
      const out: Array<{ env: Env, root: string }> = []
      const params = paramsOf(name)
      for (const referrer of unit.referencedBy) {
        for (const outer of contexts(referrer, new Set([...stack, name]))) {
          const visit = (n: ts.Node): void => {
            if (ts.isIdentifier(n) && n.text === name && !isDeclarationName(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
              const bound = new Map<string, { expr: ts.Expression, env: Env }>()
              const call = ts.isCallExpression(n.parent) && n.parent.expression === n ? n.parent : undefined
              if (call) params.forEach((param, i) => { const arg = call.arguments[i]; if (param && arg) bound.set(param, { expr: arg, env: outer.env }) })
              out.push({ env: { params: bound, unit: node }, root: outer.root })
            }
            ts.forEachChild(n, visit)
          }
          visit(statements.get(referrer)!)
        }
      }
      return out
    }

    for (const unit of units) {
      if (!unit.ownWrites.some(w => w.audit)) continue
      for (const { env, root } of contexts(unit.name, new Set())) {
        const sites: Array<{ keys: string[], line: number }> = []
        auditSites(statements.get(unit.name)!, env, sourceFile, sites)
        const via = root === unit.name ? unit.name : `${root} → ${unit.name}`
        if (isEntryPoint(root)) {
          const declared = statements.get(root)!
          if (ts.isVariableStatement(declared) && holdsFunction(declared)) {
            problems.push(`${file}: ${root} holds functions (an object of methods, a callback) that write activity_logs — `
              + 'the census cannot tell how often they run; declare each one as a function')
            continue
          }
          for (const site of sites) for (const key of site.keys) entries.push({ key, where: `${file}#${via}:${site.line}` })
          continue
        }
        const known = perCall.get(root)
        if (known && known.file !== file) {
          problems.push(`${root} writes activity_logs in both ${known.file} and ${file} — the census counts its calls by name; rename one`)
          continue
        }
        const declared = statements.get(root)!
        const slot = known ?? { file, line: lineAt(sourceFile, declared), decl: ts.isVariableStatement(declared) ? declared.declarationList.declarations[0]! : declared, rows: [] }
        perCall.set(root, slot)
        for (const site of sites) for (const key of site.keys) slot.rows.push({ key, line: site.line, via })
      }
    }
    for (const [local, as] of aliasedExports) {
      if (perCall.get(local)?.file === file) problems.push(`${file} exports ${local} as ${as} — the census counts its calls by name; export it under its own name`)
    }
  }

  // Each call of an exported audit-writing function writes its rows once, wherever the call is.
  for (const { file, sourceFile } of [...parsed, ...callers.map(({ file, source }) => ({ file, sourceFile: parse(file, source) }))]) {
    const visit = (n: ts.Node): void => {
      const target = ts.isIdentifier(n) ? perCall.get(n.text) : undefined
      if (target && ts.isIdentifier(n)) {
        const parent = n.parent
        const at = `${file}:${lineAt(sourceFile, n)}`
        if (ts.isCallExpression(parent) && parent.expression === n) {
          for (const row of target.rows) entries.push({ key: row.key, where: `${at} → ${row.via} (${target.file}:${row.line})` })
        } else if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
          if (parent.propertyName) problems.push(`${at}: ${n.text} is imported or re-exported under another name — call it by its own name`)
        } else if (isDeclarationName(n)) {
          if (parent !== target.decl) problems.push(`${at}: ${n.text} is declared again — the census counts its calls by name; rename one`)
        } else if (!ts.isTypeQueryNode(parent)) {
          problems.push(`${at}: ${n.text} is used other than as a direct call (${ts.SyntaxKind[parent.kind]}) — the census cannot count the calls it leads to`)
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sourceFile)
  }
  return { entries, problems }
}

/** {@link auditCensusOf}'s rows alone — for fixtures whose references are all direct calls. */
export function auditCensus(files: Array<{ file: string, source: string }>, callers: Array<{ file: string, source: string }> = []): CensusEntry[] {
  return auditCensusOf(files, callers).entries
}

/** The census as `{ key: count }`, keys sorted. */
export function censusCounts(entries: CensusEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const { key } of [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) counts[key] = (counts[key] ?? 0) + 1
  return counts
}
