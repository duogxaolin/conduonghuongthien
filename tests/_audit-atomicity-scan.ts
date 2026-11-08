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

  const units: RawUnit[] = []
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue
    const { name, exported } = unitName(statement, sourceFile)
    const params = (functionOf(statement)?.parameters ?? []).map(p => (ts.isIdentifier(p.name) ? p.name.text : ''))
    units.push({ name, exported, node: statement, params, ownWrites: [], callSites: [], mentions: new Map(), delegatedScopes: new Set() })
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
