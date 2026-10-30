/**
 * `Payload<T>` — a handler's answer as the browser holds it after JSON — has ONE definition:
 * `app/types/handler-payload.ts` (wave3 D-DUP).
 *
 * It had been copied into eight `app/types/*` files, each copy with its own comment. A
 * copy is right on the day it is made; the day one is changed (say, to stop mapping
 * `unknown` columns to `never`, the known gap) the others keep the old rule and two
 * types for the same endpoint disagree without a type error. Three copies were folded in
 * with the D-DUP slice that created the shared file, the last five in the `callAi` split
 * slice; this guard keeps it at one.
 *
 * What it reads: every tracked `.ts` and `.vue` (script blocks) under `app/`, `shared/`,
 * `server/` and `scripts/` — not `tests/` — by TypeScript AST, so a comment quoting the
 * definition is not code. Red for:
 *   - a type alias named `Payload` anywhere but the shared file;
 *   - a type alias of the same SHAPE under any name: `Serialize<Awaited<ReturnType<…>>>`;
 *   - `Serialize` taken from nitropack anywhere but the shared file — by `import`, or inline
 *     as `import('nitropack/types').Serialize` (the way a copy would come back). A new,
 *     different use of `Serialize` should go through `Payload` or be listed here with why.
 * Each rule has an injection proof below.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = fileURLToPath(new URL('../', import.meta.url))
const SHARED_DEFINITION = 'app/types/handler-payload.ts'
const SCANNED = ['app', 'shared', 'server', 'scripts']
const NITROPACK = /^nitropack(?:\/types)?$/

function trackedSources(): Map<string, string> {
  const files = execFileSync('git', ['ls-files', '-z', '--', ...SCANNED], { cwd: REPO, encoding: 'utf8' })
    .split('\0').filter(file => /\.(?:ts|vue)$/.test(file))
  return new Map(files.map(file => [file, readFileSync(`${REPO}${file}`, 'utf8')]))
}

/** The script blocks of a `.vue` file with their first line, or the whole `.ts` file. */
function scriptsOf(file: string, source: string): Array<{ code: string, firstLine: number }> {
  if (!file.endsWith('.vue')) return [{ code: source, firstLine: 1 }]
  const blocks: Array<{ code: string, firstLine: number }> = []
  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const start = match.index! + match[0].indexOf('>') + 1
    blocks.push({ code: match[1]!, firstLine: source.slice(0, start).split('\n').length })
  }
  return blocks
}

const typeName = (node: ts.EntityName): string => ts.isIdentifier(node) ? node.text : node.right.text

/**
 * `Serialize<Awaited<ReturnType<…>>>` — `Serialize` by its own name, by a local alias of the
 * import (`serializeNames`), qualified, or as an inline `import('nitropack/types').Serialize`.
 */
function isPayloadShape(node: ts.TypeNode, serializeNames: ReadonlySet<string> = new Set(['Serialize'])): boolean {
  const args = (n: ts.TypeNode, names: ReadonlySet<string>): readonly ts.TypeNode[] | null => {
    if (ts.isTypeReferenceNode(n) && names.has(typeName(n.typeName))) return n.typeArguments ?? []
    if (ts.isImportTypeNode(n) && n.qualifier && names.has(typeName(n.qualifier))) return n.typeArguments ?? []
    return null
  }
  const serialized = args(node, serializeNames)?.[0]
  const awaited = serialized && args(serialized, new Set(['Awaited']))?.[0]
  return Boolean(awaited && args(awaited, new Set(['ReturnType'])))
}

/** `Serialize` plus every local name a nitropack import gives it (`import { Serialize as S }`). */
function serializeNamesOf(sf: ts.SourceFile): Set<string> {
  const names = new Set(['Serialize'])
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !NITROPACK.test(statement.moduleSpecifier.text)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements) if ((element.propertyName ?? element.name).text === 'Serialize') names.add(element.name.text)
  }
  return names
}

function payloadCopies(sources: Map<string, string>): string[] {
  const problems: string[] = []
  for (const [file, source] of sources) {
    const shared = file === SHARED_DEFINITION
    for (const { code, firstLine } of scriptsOf(file, source)) {
      const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const at = (node: ts.Node) => `${file}:${firstLine + sf.getLineAndCharacterOfPosition(node.getStart(sf)).line}`
      const serializeNames = serializeNamesOf(sf)
      const visit = (node: ts.Node) => {
        if (ts.isTypeAliasDeclaration(node)) {
          if (node.name.text === 'Payload' && !shared) problems.push(`${at(node)} a second Payload — import it from ${SHARED_DEFINITION}`)
          else if (isPayloadShape(node.type, serializeNames) && !(shared && node.name.text === 'Payload'))
            problems.push(`${at(node)} ${node.name.text} is Payload under another name — import Payload from ${SHARED_DEFINITION}`)
        }
        if (!shared && ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && NITROPACK.test(node.moduleSpecifier.text)) {
          const bindings = node.importClause?.namedBindings
          const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.map(e => (e.propertyName ?? e.name).text) : []
          if (names.includes('Serialize') || (bindings && ts.isNamespaceImport(bindings)))
            problems.push(`${at(node)} Serialize imported from ${node.moduleSpecifier.text} — use Payload from ${SHARED_DEFINITION}`)
        }
        if (!shared && ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)
          && NITROPACK.test(node.argument.literal.text) && node.qualifier && typeName(node.qualifier) === 'Serialize')
          problems.push(`${at(node)} Serialize imported inline from ${node.argument.literal.text} — use Payload from ${SHARED_DEFINITION}`)
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
  }
  return problems
}

const REAL = trackedSources()
const withFiles = (files: Record<string, string>) => new Map([...REAL, ...Object.entries(files)])

test('the tree: Payload is defined once, in app/types/handler-payload.ts, and nothing else copies it', () => {
  assert.deepEqual(payloadCopies(REAL), [])
})

test('the scan is not empty: it reads the shared definition and the files that import it', () => {
  assert.ok(REAL.has(SHARED_DEFINITION))
  const definition = ts.createSourceFile(SHARED_DEFINITION, REAL.get(SHARED_DEFINITION)!, ts.ScriptTarget.Latest, true)
  const alias = definition.statements.find(ts.isTypeAliasDeclaration)
  assert.ok(alias && alias.name.text === 'Payload' && isPayloadShape(alias.type), 'the shared definition has the shape the guard looks for')
  const importers = [...REAL].filter(([, source]) => /import type \{ Payload \} from '\.\/handler-payload'/.test(source)).map(([file]) => file)
  for (const file of ['app/types/admin-api.ts', 'app/types/admin-profile.ts', 'app/types/media-scan.ts', 'app/types/moderation.ts', 'app/types/public-api.ts'])
    assert.ok(importers.includes(file), `${file} imports the shared Payload`)
  assert.ok([...REAL.keys()].some(file => file.endsWith('.vue')), '.vue files are scanned')
})

// ─── Injection proofs ────────────────────────────────────────────────────────

const COPY = "import type { Serialize } from 'nitropack/types'\n\ntype Payload<T> = Serialize<Awaited<ReturnType<T extends (...args: never[]) => unknown ? T : never>>>\n"

test('proof: the copy that was in five files goes red — the alias and the import', () => {
  assert.deepEqual(payloadCopies(withFiles({ 'app/types/admin-new-api.ts': COPY })), [
    `app/types/admin-new-api.ts:1 Serialize imported from nitropack/types — use Payload from ${SHARED_DEFINITION}`,
    `app/types/admin-new-api.ts:3 a second Payload — import it from ${SHARED_DEFINITION}`,
  ])
})

test('proof: the same shape under another name, inline-imported, in a composable goes red', () => {
  const renamed = "type HandlerAnswer<T> = import('nitropack/types').Serialize<Awaited<ReturnType<T extends (...args: never[]) => unknown ? T : never>>>\n"
  const problems = payloadCopies(withFiles({ 'app/composables/useSomething.ts': `export const x = 1\n${renamed}` }))
  assert.deepEqual(problems, [
    `app/composables/useSomething.ts:2 HandlerAnswer is Payload under another name — import Payload from ${SHARED_DEFINITION}`,
    `app/composables/useSomething.ts:2 Serialize imported inline from nitropack/types — use Payload from ${SHARED_DEFINITION}`,
  ])
})

test('proof: a copy in a .vue script block goes red at its real line; a Payload of another shape goes red by name', () => {
  const vue = `<template>\n  <div />\n</template>\n\n<script setup lang="ts">\nimport type { Serialize as S } from 'nitropack'\ntype Answer<T> = S<Awaited<ReturnType<T extends (...a: never[]) => unknown ? T : never>>>\n</script>\n`
  assert.deepEqual(payloadCopies(withFiles({ 'app/pages/admin/x.vue': vue })), [
    `app/pages/admin/x.vue:6 Serialize imported from nitropack — use Payload from ${SHARED_DEFINITION}`,
    `app/pages/admin/x.vue:7 Answer is Payload under another name — import Payload from ${SHARED_DEFINITION}`,
  ])
  assert.deepEqual(payloadCopies(withFiles({ 'shared/x.ts': 'export type Payload = { ok: boolean }\n' })), [
    `shared/x.ts:1 a second Payload — import it from ${SHARED_DEFINITION}`,
  ])
})

test('proof: a comment quoting the definition, and an import of the shared Payload, stay green', () => {
  const quiet = `// type Payload<T> = Serialize<Awaited<ReturnType<T>>> — from 'nitropack/types'\nimport type { Payload } from '../types/handler-payload'\nexport type R = Payload<() => { ok: true }>\n`
  assert.deepEqual(payloadCopies(withFiles({ 'app/utils/x.ts': quiet })), [])
})
