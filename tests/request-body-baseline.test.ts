import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

/**
 * Baseline guard for request bodies (wave2 5.2, design D5, spec request-validation:
 * "the number of legacy endpoints that read bodies without the shared reader
 * SHALL NOT increase").
 *
 * A body read straight from h3 — `readBody(event).catch(() => ({}))`, `.catch(() =>
 * null)`, any other `.catch(…)`, or `readBody(…)` with no catch at all — is the
 * LEGACY form. New code reads through `server/utils/request-body.ts`
 * (`readJsonBody`, `readValidated`, `readValidatedQuery`): malformed JSON is a 400
 * instead of `{}`, and zod's issue list never reaches the client. h3's own
 * validators — `readValidatedBody`, `getValidatedQuery`, `getValidatedRouterParams`
 * — send that list in `data`, so they are forbidden the same way; and so is a
 * `.catch(…)` on the shared reader, which would turn its 400 back into "nothing
 * was sent".
 *
 * `LEGACY_BODY_READERS` names exactly the files that still read the legacy way:
 * 139 call sites in 139 files when the guard was written (TypeScript parser, wave1
 * integration tip 2516422), 138 after `admin/backup/run.post.ts` moved to
 * `readValidated` in the same change. The design's "133" was `grep 'readBody('`,
 * which misses the six generic calls `readBody<{ type?: string }>(event)`.
 *
 * Ratchet (all four fail the test):
 *  - a file NOT in the list with a forbidden use — use the shared reader;
 *  - a listed file with a SECOND use (each had exactly one when listed);
 *  - a listed file with none left (migrated or deleted) — remove its entry in the
 *    same change; an entry left behind would let that file go back to `readBody`
 *    and stay green;
 *  - more uses than the ceiling, which is the list's own length (one per entry).
 * Removing an entry is the only change the list ever needs.
 *
 * Scope is all of `server/` (a handler under `server/routes/` or a middleware reads
 * a body the same way), except the shared reader itself. Uses are found with the
 * TypeScript parser — a comment or a string mentioning `readBody(event)` is not a
 * use — by every route `scanSource` lists: the Nitro auto-import (no import line, as
 * in `settings/navigation/navbar.put.ts`), an aliased import, `h3.readBody`,
 * `h3['readBody']`, destructuring from the module, a re-export, and a call through
 * parentheses or `.call`, or the function passed or assigned as a value. A file that
 * declares its own `readBody` is not flagged for calling it: unimport injects no
 * auto-import for a name the file declares as a function, class or variable, and a
 * parameter of that name shadows it inside its function (`declaredInScope`).
 */

const REPO = resolve(new URL('..', import.meta.url).pathname)
const SHARED_READER = 'server/utils/request-body.ts'
/** h3 helpers no file may use directly: the legacy body read, and the three
 *  validators that put the validator's error (zod's issue list) in `data`. */
const H3_FORBIDDEN = new Set(['readBody', 'readValidatedBody', 'getValidatedQuery', 'getValidatedRouterParams'])
/** The shared reader's exports — a `.catch(…)` on one revives the swallow. */
const SHARED_READERS = new Set(['readJsonBody', 'readValidated', 'readValidatedQuery'])

const LEGACY_BODY_READERS: readonly string[] = [
  'server/api/admin/ai/budget/index.put.ts',
  'server/api/admin/ai/editorial.post.ts',
  'server/api/admin/ai/moderation/queue/[id]/resolve.post.ts',
  'server/api/admin/ai/moderation/rules.post.ts',
  'server/api/admin/ai/moderation/rules/[id].put.ts',
  'server/api/admin/ai/moderation/settings.put.ts',
  'server/api/admin/ai/pricing/[model].put.ts',
  'server/api/admin/ai/pricing/bulk-delete.post.ts',
  'server/api/admin/ai/pricing/index.post.ts',
  'server/api/admin/ai/providers/[id].put.ts',
  'server/api/admin/ai/providers/bulk-delete.post.ts',
  'server/api/admin/ai/providers/index.post.ts',
  'server/api/admin/ai/services/[id].put.ts',
  'server/api/admin/ai/test-call.post.ts',
  'server/api/admin/ai/translate-ui.post.ts',
  'server/api/admin/ai/translate.post.ts',
  'server/api/admin/articles/[id].put.ts',
  'server/api/admin/articles/[id]/boost.post.ts',
  'server/api/admin/articles/[id]/translations/[lang].put.ts',
  'server/api/admin/articles/[id]/translations/[lang]/status.patch.ts',
  'server/api/admin/articles/[id]/translations/translate-all.post.ts',
  'server/api/admin/articles/[id]/translations/translate.post.ts',
  'server/api/admin/articles/bulk-comments.post.ts',
  'server/api/admin/articles/bulk-delete.post.ts',
  'server/api/admin/articles/bulk-publish-translations.post.ts',
  'server/api/admin/articles/bulk-status.post.ts',
  'server/api/admin/articles/bulk-translate.post.ts',
  'server/api/admin/articles/export-google.post.ts',
  'server/api/admin/articles/index.post.ts',
  'server/api/admin/articles/scan-thumbnails.post.ts',
  'server/api/admin/auth/login.post.ts',
  'server/api/admin/auth/mfa/verify.post.ts',
  'server/api/admin/backup/drive/config.put.ts',
  'server/api/admin/backup/restore.post.ts',
  'server/api/admin/cache-clear.post.ts',
  'server/api/admin/categories/[id].put.ts',
  'server/api/admin/categories/bulk-delete.post.ts',
  'server/api/admin/categories/index.post.ts',
  'server/api/admin/chatbot/knowledge/[id].put.ts',
  'server/api/admin/chatbot/knowledge/bulk-delete.post.ts',
  'server/api/admin/chatbot/knowledge/bulk-quick-question.post.ts',
  'server/api/admin/chatbot/knowledge/bulk-status.post.ts',
  'server/api/admin/chatbot/knowledge/index.post.ts',
  'server/api/admin/chatbot/sessions/bulk-delete.post.ts',
  'server/api/admin/chatbot/settings/index.patch.ts',
  'server/api/admin/chatbot/small-talk/[id].put.ts',
  'server/api/admin/chatbot/small-talk/bulk-delete.post.ts',
  'server/api/admin/chatbot/small-talk/bulk-enabled.post.ts',
  'server/api/admin/chatbot/small-talk/index.post.ts',
  'server/api/admin/comments/[id]/visibility.patch.ts',
  'server/api/admin/comments/ai-moderate.post.ts',
  'server/api/admin/comments/reply.post.ts',
  'server/api/admin/content-types/[id].put.ts',
  'server/api/admin/content-types/bulk-delete.post.ts',
  'server/api/admin/content-types/index.post.ts',
  'server/api/admin/home-sections/[id].put.ts',
  'server/api/admin/home-sections/reorder.put.ts',
  'server/api/admin/ip-bans/index.post.ts',
  'server/api/admin/languages/[code].put.ts',
  'server/api/admin/languages/[code]/translations/index.put.ts',
  'server/api/admin/languages/ai-translate-chunk.post.ts',
  'server/api/admin/languages/ai-translate-key.post.ts',
  'server/api/admin/languages/ai-translate.post.ts',
  'server/api/admin/languages/index.post.ts',
  'server/api/admin/languages/reorder.post.ts',
  'server/api/admin/livestream/start.post.ts',
  'server/api/admin/livestream/stop.post.ts',
  'server/api/admin/media-portal/[id].put.ts',
  'server/api/admin/media-portal/[id]/process.post.ts',
  'server/api/admin/media-portal/[id]/thumbnail.post.ts',
  'server/api/admin/media-portal/categories/[id].put.ts',
  'server/api/admin/media-portal/categories/index.post.ts',
  'server/api/admin/media-portal/external.post.ts',
  'server/api/admin/media-portal/upload/[id]/complete.post.ts',
  'server/api/admin/media-portal/upload/housekeep.post.ts',
  'server/api/admin/media-portal/upload/init.post.ts',
  'server/api/admin/media-portal/youtube-meta.post.ts',
  'server/api/admin/media/bulk-delete.post.ts',
  'server/api/admin/media/repoint-r2-urls.post.ts',
  'server/api/admin/media/scan.post.ts',
  'server/api/admin/media/self-heal.post.ts',
  'server/api/admin/media/sync-storage.post.ts',
  'server/api/admin/pages/[id].put.ts',
  'server/api/admin/pages/[id]/blocks/[blockId].put.ts',
  'server/api/admin/pages/[id]/blocks/index.post.ts',
  'server/api/admin/pages/[id]/blocks/reorder.put.ts',
  'server/api/admin/pages/[id]/draft.put.ts',
  'server/api/admin/pages/[id]/publish.post.ts',
  'server/api/admin/pages/[id]/versions/index.post.ts',
  'server/api/admin/pages/bulk-delete.post.ts',
  'server/api/admin/pages/index.post.ts',
  'server/api/admin/profile/mfa/confirm.post.ts',
  'server/api/admin/profile/mfa/disable.post.ts',
  'server/api/admin/profile/mfa/enroll.post.ts',
  'server/api/admin/profile/mfa/recovery-codes.delete.ts',
  'server/api/admin/profile/mfa/recovery-codes.post.ts',
  'server/api/admin/profile/password.put.ts',
  'server/api/admin/readers/[id]/ban.post.ts',
  'server/api/admin/roles/[id].put.ts',
  'server/api/admin/roles/index.post.ts',
  'server/api/admin/settings/backup.put.ts',
  'server/api/admin/settings/google-oauth/index.patch.ts',
  'server/api/admin/settings/index.put.ts',
  'server/api/admin/settings/layout.put.ts',
  'server/api/admin/settings/media-portal.put.ts',
  'server/api/admin/settings/navigation.put.ts',
  'server/api/admin/settings/navigation/mobile.put.ts',
  'server/api/admin/settings/navigation/navbar.put.ts',
  'server/api/admin/settings/retention-run.post.ts',
  'server/api/admin/settings/retention.put.ts',
  'server/api/admin/settings/sitemap/index.put.ts',
  'server/api/admin/settings/test-email.post.ts',
  'server/api/admin/settings/test-r2.post.ts',
  'server/api/admin/social-links/[id].put.ts',
  'server/api/admin/social-links/index.post.ts',
  'server/api/admin/social-links/reorder.post.ts',
  'server/api/admin/submissions/[id]/contact.post.ts',
  'server/api/admin/submissions/[id]/notes.post.ts',
  'server/api/admin/submissions/[id]/status.put.ts',
  'server/api/admin/submissions/bulk-delete.post.ts',
  'server/api/admin/submissions/bulk-status.post.ts',
  'server/api/admin/system/universal-translate.post.ts',
  'server/api/admin/users/[id].put.ts',
  'server/api/admin/users/bulk-active.post.ts',
  'server/api/admin/users/bulk-delete.post.ts',
  'server/api/admin/users/index.post.ts',
  'server/api/chat.post.ts',
  'server/api/public/articles/[slug]/view.post.ts',
  'server/api/public/chatbot/index.post.ts',
  'server/api/public/chatbot/lead.post.ts',
  'server/api/public/comments/index.post.ts',
  'server/api/public/livestream/chat/send.post.ts',
  'server/api/public/media/[shortId]/view.post.ts',
  'server/api/public/reader/claim-chats.post.ts',
  'server/api/public/reader/notifications/read.post.ts',
  'server/api/public/reader/profile.put.ts',
  'server/api/public/reader/profile/email-notifications.put.ts',
  'server/api/submissions.post.ts',
]

type LegacyRead = { line: number, form: string }

/** Our own code: its definitions are scanned where they are written. */
const isOwnModule = (specifier: string) => /^(?:\.|~~?\/|@\/|#server\/)/.test(specifier)

function stripWrappers(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression
  }
  return current
}

/** `import('x')` / `require('x')` with a literal specifier → `x`. */
function dynamicImportSpecifier(node: ts.Expression): string | undefined {
  const call = stripWrappers(node)
  if (!ts.isCallExpression(call)) return undefined
  const isImport = call.expression.kind === ts.SyntaxKind.ImportKeyword
  const isRequire = ts.isIdentifier(call.expression) && call.expression.text === 'require'
  const argument = call.arguments[0]
  return (isImport || isRequire) && argument && ts.isStringLiteralLike(argument) ? argument.text : undefined
}

/** Every name a binding pattern (or plain identifier) declares. */
function bindsName(name: ts.BindingName, wanted: string): boolean {
  if (ts.isIdentifier(name)) return name.text === wanted
  return name.elements.some(element => !ts.isOmittedExpression(element) && bindsName(element.name, wanted))
}

function statementsDeclare(statements: ts.NodeArray<ts.Statement>, wanted: string): boolean {
  return statements.some(statement =>
    ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === wanted)
    || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => bindsName(declaration.name, wanted))))
}

/**
 * Is `wanted` declared in a scope enclosing `from` — a parameter, a function or
 * class, a `const`/`let`/`var` (destructuring too), a `for`/`catch` binding? Then
 * the name is that declaration: unimport injects no auto-import for a name the
 * file declares itself.
 */
function declaredInScope(from: ts.Node, wanted: string): boolean {
  for (let node: ts.Node | undefined = from.parent; node; node = node.parent) {
    if (ts.isFunctionLike(node)) {
      if (node.parameters.some(parameter => bindsName(parameter.name, wanted))) return true
      if ((ts.isFunctionExpression(node)) && node.name?.text === wanted) return true
    }
    if (ts.isClassExpression(node) && node.name?.text === wanted) return true
    if ((ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node))
      && statementsDeclare(node.statements, wanted)) return true
    if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node))
      && node.initializer && ts.isVariableDeclarationList(node.initializer)
      && node.initializer.declarations.some(declaration => bindsName(declaration.name, wanted))) return true
    if (ts.isCatchClause(node) && node.variableDeclaration && bindsName(node.variableDeclaration.name, wanted)) return true
  }
  return false
}

/** An identifier that READS a value — not a declaration, a member or key name, an
 *  import/export specifier, or anything inside a type. */
function isValueReference(id: ts.Identifier): boolean {
  const parent = id.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)
    || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isPropertySignature(parent)
    || ts.isMethodSignature(parent) || ts.isEnumMember(parent) || ts.isVariableDeclaration(parent)
    || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent)
    || ts.isClassExpression(parent) || ts.isParameter(parent) || ts.isTypeAliasDeclaration(parent)
    || ts.isInterfaceDeclaration(parent) || ts.isLabeledStatement(parent)) && parent.name === id) return false
  if (ts.isBindingElement(parent) || ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)
    || ts.isExportSpecifier(parent) || ts.isImportEqualsDeclaration(parent) || ts.isQualifiedName(parent)
    || ts.isBreakOrContinueStatement(parent)) return false
  for (let node: ts.Node = parent; !ts.isSourceFile(node); node = node.parent) {
    if (ts.isTypeNode(node)) return false
  }
  return true
}

/** The call `use` is the callee of — directly, in parentheses, or via `.call`/`.apply`. */
function calleeOf(use: ts.Expression): ts.CallExpression | undefined {
  let top: ts.Node = use
  while (ts.isParenthesizedExpression(top.parent)) top = top.parent
  const parent = top.parent
  if (ts.isCallExpression(parent) && parent.expression === top) return parent
  if (ts.isPropertyAccessExpression(parent) && parent.expression === top && (parent.name.text === 'call' || parent.name.text === 'apply')
    && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) return parent.parent
  return undefined
}

/** `call.catch(handler)` → the handler (`null` when none is passed); no `.catch` → undefined. */
function catchHandlerOf(call: ts.CallExpression): ts.Expression | null | undefined {
  const parent = call.parent
  if (ts.isPropertyAccessExpression(parent) && parent.expression === call && parent.name.text === 'catch'
    && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) return parent.parent.arguments[0] ?? null
  return undefined
}

function isEmptyObjectArrow(node: ts.Expression): boolean {
  if (!ts.isArrowFunction(node)) return false
  let body: ts.Node = node.body
  while (ts.isParenthesizedExpression(body)) body = body.expression
  return ts.isObjectLiteralExpression(body) && body.properties.length === 0
}

function isNullArrow(node: ts.Expression): boolean {
  if (!ts.isArrowFunction(node)) return false
  let body: ts.Node = node.body
  while (ts.isParenthesizedExpression(body)) body = body.expression
  return body.kind === ts.SyntaxKind.NullKeyword
}

/** How an h3 helper is used: for `readBody` called, which `.catch` (if any) follows. */
function formOf(use: ts.Expression, name: string): string {
  const call = calleeOf(use)
  if (!call) return `${name} used as a value`
  if (name !== 'readBody') return `h3 ${name}`
  const handler = catchHandlerOf(call)
  if (handler === undefined) return 'uncaught'
  return handler && isEmptyObjectArrow(handler) ? 'catch(() => ({}))'
    : handler && isNullArrow(handler) ? 'catch(() => null)'
      : 'catch(other)'
}

/**
 * Every forbidden use in one file:
 *  - an h3 body reader or validator (`H3_FORBIDDEN`) reached by any route — the
 *    Nitro auto-import (unless the file declares that name itself), a named import
 *    and its alias, `ns.readBody` / `ns['readBody']` on a module namespace
 *    (`import * as`, `await import()`, `require()`), destructuring from one, a
 *    re-export — whether it is called (`(readBody)(…)`, `readBody.call(…)`),
 *    passed, or assigned;
 *  - a `.catch(…)` chained onto the shared reader (`SHARED_READERS`), which turns
 *    its 400 back into "nothing was sent".
 */
function scanSource(fileName: string, source: string): LegacyRead[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const h3Imports = new Map<string, string>() // local name → h3 export, from a package (not our code)
  const ownImports = new Set<string>() // local names imported from our own code
  const sharedImports = new Map<string, string>() // local name → shared reader export
  const namespaces = new Set<string>() // local names bound to a package's module namespace

  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings) && !isOwnModule(specifier)) namespaces.add(bindings.name.text)
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const exported = (element.propertyName ?? element.name).text
      const local = element.name.text
      if (SHARED_READERS.has(exported)) sharedImports.set(local, exported)
      else if (isOwnModule(specifier)) ownImports.add(local)
      else if (H3_FORBIDDEN.has(exported)) h3Imports.set(local, exported)
    }
  }
  const collectNamespaces = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const specifier = dynamicImportSpecifier(node.initializer)
      if (specifier && !isOwnModule(specifier)) namespaces.add(node.name.text)
    }
    ts.forEachChild(node, collectNamespaces)
  }
  collectNamespaces(sf)

  const isPackageNamespace = (node: ts.Expression): boolean => {
    const inner = stripWrappers(node)
    if (ts.isIdentifier(inner)) return namespaces.has(inner.text) && !declaredInScope(inner, inner.text)
    const specifier = dynamicImportSpecifier(inner)
    return specifier !== undefined && !isOwnModule(specifier)
  }
  const h3NameOf = (id: ts.Identifier): string | undefined => {
    const exported = h3Imports.get(id.text)
      ?? (H3_FORBIDDEN.has(id.text) && !ownImports.has(id.text) && !sharedImports.has(id.text) ? id.text : undefined)
    return exported && !declaredInScope(id, id.text) ? exported : undefined
  }
  const sharedNameOf = (id: ts.Identifier): string | undefined => {
    const exported = sharedImports.get(id.text)
      ?? (SHARED_READERS.has(id.text) && !ownImports.has(id.text) && !h3Imports.has(id.text) ? id.text : undefined)
    return exported && !declaredInScope(id, id.text) ? exported : undefined
  }

  const reads: LegacyRead[] = []
  const record = (node: ts.Node, form: string) =>
    reads.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, form })

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && isValueReference(node)) {
      const h3Name = h3NameOf(node)
      if (h3Name) record(node, formOf(node, h3Name))
      const shared = sharedNameOf(node)
      const call = shared ? calleeOf(node) : undefined
      if (shared && call && catchHandlerOf(call) !== undefined) record(node, `${shared}(…).catch(…) swallows its 400`)
    } else if (ts.isPropertyAccessExpression(node) && H3_FORBIDDEN.has(node.name.text) && isPackageNamespace(node.expression)) {
      record(node, formOf(node, node.name.text))
    } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
      && H3_FORBIDDEN.has(node.argumentExpression.text) && isPackageNamespace(node.expression)) {
      record(node, formOf(node, node.argumentExpression.text))
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name
      const name = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : undefined
      const declaration = node.parent.parent
      if (name && H3_FORBIDDEN.has(name) && ts.isVariableDeclaration(declaration) && declaration.initializer
        && isPackageNamespace(declaration.initializer)) record(node, `${name} destructured from h3`)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      && !isOwnModule(node.moduleSpecifier.text) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const exported = (element.propertyName ?? element.name).text
        if (H3_FORBIDDEN.has(exported)) record(element, `${exported} re-exported`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return reads.sort((a, b) => a.line - b.line)
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(?:m?ts|m?js)$/.test(name)) out.push(path)
  }
  return out
}

/** Repo-relative path → its legacy body reads, for every file under `<root>/server`. */
function scan(root: string): Map<string, LegacyRead[]> {
  const found = new Map<string, LegacyRead[]>()
  for (const file of sourceFiles(join(root, 'server'))) {
    const rel = relative(root, file).split(sep).join('/')
    if (rel === SHARED_READER) continue
    const reads = scanSource(file, readFileSync(file, 'utf8'))
    if (reads.length) found.set(rel, reads)
  }
  return found
}

function compare(found: Map<string, LegacyRead[]>, baseline: readonly string[]) {
  const listed = new Set(baseline)
  const describe = (file: string, reads: LegacyRead[]) =>
    `${file} — ${reads.map(read => `line ${read.line}: ${read.form}`).join('; ')}`
  const added: string[] = []
  const grown: string[] = []
  let total = 0
  for (const [file, reads] of found) {
    total += reads.length
    if (!listed.has(file)) added.push(describe(file, reads))
    else if (reads.length > 1) grown.push(describe(file, reads))
  }
  // Listed but no longer reading the legacy way (migrated or deleted).
  const stale = baseline.filter(file => !found.has(file))
  // Each listed file had exactly one legacy read when it was listed.
  return { added, grown, stale, total, ceiling: baseline.length }
}

const HOW_TO = 'Read the body with readJsonBody / readValidated (and the query with readValidatedQuery) from server/utils/request-body.ts, without .catch.'

test('LEGACY_BODY_READERS names exactly the files that still read the legacy way — none new, none grown, none stale', () => {
  const { added, grown, stale, total, ceiling } = compare(scan(REPO), LEGACY_BODY_READERS)
  assert.deepEqual(added, [], `New legacy body reads (the list only shrinks). ${HOW_TO}`)
  assert.deepEqual(grown, [], `A listed file gained a second legacy body read. ${HOW_TO}`)
  assert.deepEqual(stale, [], 'These files no longer read a body the legacy way: remove them from LEGACY_BODY_READERS in the same change, so going back to readBody fails instead of passing on an old entry.')
  assert.ok(total <= ceiling, `${total} legacy reads, but the ceiling — one per listed file — is ${ceiling}`)
})

test('the baseline is sorted and has no duplicates', () => {
  assert.deepEqual([...LEGACY_BODY_READERS], [...new Set(LEGACY_BODY_READERS)].sort(), 'keep LEGACY_BODY_READERS sorted and unique')
})

// ─── The scanner bites ──────────────────────────────────────────────────────────

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'request-body-baseline-'))
  roots.push(root)
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), source)
  }
  return root
}

// One use per line, so each expected form below sits next to its source.
const EVERY_FORBIDDEN_USE = `import { readBody as rb, getValidatedQuery as gvq } from 'h3'
import * as h3 from 'h3'
export default defineEventHandler(async (event) => {
  const a = await readBody(event).catch(() => ({}))
  const b = await readBody(event).catch(() => null)
  const c = await readBody<{ ids?: number[] }>(event).catch(() => ({ ids: [] }))
  const d = await readBody<{ type?: string }>(event)
  const e = await rb(event)
  const f = await h3.readBody(event)
  const g = await h3['readBody'](event).catch(() => ({}))
  const h = await (readBody)(event)
  const i = await readBody.call(null, event)
  const read = readBody
  const { readBody: destructured } = h3
  const { readBody: fromImport } = await import('h3')
  const j = await readValidatedBody(event, (x: unknown) => x)
  const k = await gvq(event, (x: unknown) => x)
  const l = await getValidatedQuery(event, (x: unknown) => x)
  const m = await getValidatedRouterParams(event, (x: unknown) => x)
  const n = await readValidated(event, schema).catch(() => ({}))
  const o = await readJsonBody(event).catch(() => null)
  return { a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, read, destructured, fromImport, handlers: { readBody } }
})
export { readBody as legacyRead } from 'h3'
`
const EXPECTED_FORMS = [
  'line 4: catch(() => ({}))',
  'line 5: catch(() => null)',
  'line 6: catch(other)',
  'line 7: uncaught',
  'line 8: uncaught',
  'line 9: uncaught',
  'line 10: catch(() => ({}))',
  'line 11: uncaught',
  'line 12: uncaught',
  'line 13: readBody used as a value',
  'line 14: readBody destructured from h3',
  'line 15: readBody destructured from h3',
  'line 16: h3 readValidatedBody',
  'line 17: h3 getValidatedQuery',
  'line 18: h3 getValidatedQuery',
  'line 19: h3 getValidatedRouterParams',
  'line 20: readValidated(…).catch(…) swallows its 400',
  'line 21: readJsonBody(…).catch(…) swallows its 400',
  'line 22: readBody used as a value',
  'line 24: readBody re-exported',
]

const SHARED_READER_USE = `
import { readJsonBody, readValidated, readValidatedQuery } from '../utils/request-body'
import { readBody as readOwn } from '../utils/own-reader'
// await readBody(event).catch(() => ({})) — a comment is not a use
const note = 'await readBody(event)'
type Validator = typeof readValidatedBody
const labels = { readBody: 'x', getValidatedQuery: 'y' }
class Reader {
  readBody() { return 1 }
  run() { return this.readBody() }
}
export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event)
  const input = await readValidated(event, schema)
  const query = await readValidatedQuery(event, schema)
  try {
    await readValidated(event, schema)
  } catch (error) {
    throw error
  }
  const viaOwn = await readOwn(event)
  return { body, input, query, note, labels, viaOwn, reader: new Reader() }
})
`

// A file that declares its OWN \`readBody\`: Nitro (unimport) injects no auto-import
// there, so the bare name is that declaration, not h3's.
const OWN_READBODY = `
function readBody(stream: { text: string }) { return stream.text }
export default defineEventHandler(() => readBody({ text: 'x' }))
`
const OWN_READBODY_PARAMETER = `
export const wrap = (readBody: (event: unknown) => unknown) => (event: unknown) => readBody(event)
export const wrapAsync = async function (getValidatedQuery: () => unknown) { return getValidatedQuery() }
`

test('the scanner finds every use of an h3 body reader or validator, under every name, and every .catch on the shared reader', () => {
  const root = fixture({
    'server/api/new.post.ts': EVERY_FORBIDDEN_USE,
    'server/routes/hook.post.ts': 'export default defineEventHandler(async event => readBody(event))\n',
    'server/api/clean.post.ts': SHARED_READER_USE,
    'server/api/own.post.ts': OWN_READBODY,
    'server/utils/wrap.ts': OWN_READBODY_PARAMETER,
    [SHARED_READER]: `import { readBody } from 'h3'\nexport const readJsonBody = (event: unknown) => readBody(event as never, { strict: true })\n`,
  })
  const found = scan(root)
  assert.deepEqual([...found.keys()].sort(), ['server/api/new.post.ts', 'server/routes/hook.post.ts'])
  assert.deepEqual(found.get('server/api/new.post.ts')!.map(read => `line ${read.line}: ${read.form}`), EXPECTED_FORMS)
  assert.deepEqual(found.get('server/routes/hook.post.ts')!.map(read => read.form), ['uncaught'])
})

const LEGACY_A = 'export default defineEventHandler(async event => readBody(event).catch(() => ({})))\n'
const MIGRATED = 'export default defineEventHandler(async event => readJsonBody(event))\n'

test('the ratchet: a new file fails, and a second read in a listed file fails and breaks the ceiling', () => {
  const root = fixture({
    'server/api/legacy-a.post.ts': LEGACY_A,
    'server/api/legacy-b.post.ts': 'export default defineEventHandler(async (event) => { await readBody(event).catch(() => null); return readBody(event) })\n',
    'server/api/brand-new.post.ts': LEGACY_A,
  })
  const { added, grown, stale, total, ceiling } = compare(scan(root), ['server/api/legacy-a.post.ts', 'server/api/legacy-b.post.ts'])
  assert.deepEqual(added, ['server/api/brand-new.post.ts — line 1: catch(() => ({}))'])
  assert.deepEqual(grown, ['server/api/legacy-b.post.ts — line 1: catch(() => null); line 1: uncaught'])
  assert.deepEqual(stale, [])
  assert.equal(ceiling, 2, 'the ceiling is the length of the list, not a number written in the test')
  assert.equal(total, 4)
})

test('the ratchet: a migrated file still listed FAILS (stale) — and once removed, going back to readBody fails as new', () => {
  // Step 1: legacy-c migrated, but its entry stays. Must fail, or the entry would
  // keep a later relapse green.
  const migrated = fixture({ 'server/api/legacy-a.post.ts': LEGACY_A, 'server/api/legacy-c.post.ts': MIGRATED })
  const step1 = compare(scan(migrated), ['server/api/legacy-a.post.ts', 'server/api/legacy-c.post.ts'])
  assert.deepEqual(step1.stale, ['server/api/legacy-c.post.ts'])
  assert.deepEqual([step1.added, step1.grown], [[], []])

  // Step 2: the entry is removed — green.
  const step2 = compare(scan(migrated), ['server/api/legacy-a.post.ts'])
  assert.deepEqual([step2.added, step2.grown, step2.stale], [[], [], []])
  assert.ok(step2.total <= step2.ceiling)

  // Step 3: legacy-c goes back to readBody — red, as a new file.
  const relapsed = fixture({ 'server/api/legacy-a.post.ts': LEGACY_A, 'server/api/legacy-c.post.ts': LEGACY_A })
  const step3 = compare(scan(relapsed), ['server/api/legacy-a.post.ts'])
  assert.deepEqual(step3.added, ['server/api/legacy-c.post.ts — line 1: catch(() => ({}))'])
  assert.ok(step3.total > step3.ceiling)
})
