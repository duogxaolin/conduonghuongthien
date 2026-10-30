/**
 * `ItemOf<T>` — one element of an array type — has ONE definition: `app/types/item-of.ts`
 * (wave3 D-FETCH, lot H).
 *
 * It had been copied into `app/types/admin-api.ts` and `app/types/moderation.ts`, each next
 * to the `Payload` copy D-DUP folded into app/types/handler-payload.ts. Same reason as that
 * guard (tests/handler-payload-single-definition.test.ts): a copy is right the day it is made;
 * the day one is changed (say, to stop accepting tuples) the other keeps the old rule and two
 * row types built from the same answer disagree without a type error.
 *
 * What it reads: every tracked `.ts` and `.vue` (script blocks) under `app/`, `shared/`,
 * `server/` and `scripts/` — not `tests/` — by TypeScript AST, so a comment quoting the
 * definition is not code. Red for:
 *   - a type alias named `ItemOf` anywhere but the shared file;
 *   - the same conditional anywhere but as the shared alias — under another name or inline:
 *     `X extends readonly (infer U)[] ? U : …`, with or without `readonly`, and its
 *     `Array<infer U>` / `ReadonlyArray<infer U>` spellings.
 * Left alone: a plain indexed access (`X[number]`), and a conditional that infers an array
 * element but answers something else (`… ? Wrapper<U> : …`). Each rule has a proof below.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = fileURLToPath(new URL('../', import.meta.url))
const SHARED_DEFINITION = 'app/types/item-of.ts'
const SCANNED = ['app', 'shared', 'server', 'scripts']

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

const unparen = (node: ts.TypeNode): ts.TypeNode => (ts.isParenthesizedTypeNode(node) ? unparen(node.type) : node)
const typeName = (node: ts.EntityName): string => ts.isIdentifier(node) ? node.text : node.right.text

/** `infer U` as an array element: `(infer U)[]`, `readonly (infer U)[]`, `Array<infer U>`, `ReadonlyArray<infer U>`. */
function inferredElement(node: ts.TypeNode): string | null {
  let n = unparen(node)
  if (ts.isTypeOperatorNode(n) && n.operator === ts.SyntaxKind.ReadonlyKeyword) n = unparen(n.type)
  const element = ts.isArrayTypeNode(n) ? n.elementType
    : ts.isTypeReferenceNode(n) && ['Array', 'ReadonlyArray'].includes(typeName(n.typeName)) && n.typeArguments?.length === 1 ? n.typeArguments[0]!
      : null
  const infer = element && unparen(element)
  return infer && ts.isInferTypeNode(infer) ? infer.typeParameter.name.text : null
}

/** `… extends <array of infer U> ? U : …` — the definition of `ItemOf`, whatever it is called. */
function isItemOfShape(node: ts.Node): node is ts.ConditionalTypeNode {
  if (!ts.isConditionalTypeNode(node)) return false
  const inferred = inferredElement(node.extendsType)
  const answer = unparen(node.trueType)
  return inferred !== null && ts.isTypeReferenceNode(answer) && !answer.typeArguments
    && ts.isIdentifier(answer.typeName) && answer.typeName.text === inferred
}

function itemOfCopies(sources: Map<string, string>): string[] {
  const problems: string[] = []
  for (const [file, source] of sources) {
    const shared = file === SHARED_DEFINITION
    for (const { code, firstLine } of scriptsOf(file, source)) {
      const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const at = (node: ts.Node) => `${file}:${firstLine + sf.getLineAndCharacterOfPosition(node.getStart(sf)).line}`
      const visit = (node: ts.Node) => {
        if (ts.isTypeAliasDeclaration(node) && node.name.text === 'ItemOf') {
          if (!shared) problems.push(`${at(node)} a second ItemOf — import it from ${SHARED_DEFINITION}`)
          // Its own conditional is the definition (shared) or already reported (a copy).
          node.typeParameters?.forEach(visit)
          if (!isItemOfShape(node.type)) visit(node.type)
          else ts.forEachChild(node.type, visit)
          return
        }
        if (isItemOfShape(node)) {
          problems.push(ts.isTypeAliasDeclaration(node.parent)
            ? `${at(node.parent)} ${node.parent.name.text} is ItemOf under another name — import ItemOf from ${SHARED_DEFINITION}`
            : `${at(node)} the ItemOf conditional written inline — import ItemOf from ${SHARED_DEFINITION}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
  }
  return problems
}

const REAL = trackedSources()
const withFiles = (files: Record<string, string>) => new Map([...REAL, ...Object.entries(files)])

test('the tree: ItemOf is defined once, in app/types/item-of.ts, and nothing else copies it', () => {
  assert.deepEqual(itemOfCopies(REAL), [])
})

test('the scan is not empty: it reads the shared definition and the files that import it', () => {
  assert.ok(REAL.has(SHARED_DEFINITION), `${SHARED_DEFINITION} is tracked (git add -N a new file)`)
  const definition = ts.createSourceFile(SHARED_DEFINITION, REAL.get(SHARED_DEFINITION)!, ts.ScriptTarget.Latest, true)
  const alias = definition.statements.find(ts.isTypeAliasDeclaration)
  assert.ok(alias && alias.name.text === 'ItemOf' && isItemOfShape(alias.type), 'the shared definition has the shape the guard looks for')
  const importers = [...REAL].filter(([, source]) => /import type \{ ItemOf \} from '\.\/item-of'/.test(source)).map(([file]) => file)
  assert.deepEqual(importers.sort(), ['app/types/admin-api.ts', 'app/types/moderation.ts'])
  assert.ok([...REAL.keys()].some(file => file.endsWith('.vue')), '.vue files are scanned')
})

// ─── Injection proofs ────────────────────────────────────────────────────────

/** Exactly the copy that was in app/types/admin-api.ts and app/types/moderation.ts. */
const COPY = "import type { Payload } from './handler-payload'\n\ntype ItemOf<T> = T extends readonly (infer U)[] ? U : never\n"

test('proof: the copy that was in two files goes red, once, at its line', () => {
  assert.deepEqual(itemOfCopies(withFiles({ 'app/types/admin-new-api.ts': COPY })), [
    `app/types/admin-new-api.ts:3 a second ItemOf — import it from ${SHARED_DEFINITION}`,
  ])
})

test('proof: the same conditional under another name goes red — with and without readonly, Array<> and ReadonlyArray<>', () => {
  const renamed = [
    'export const x = 1',
    'type Row<T> = T extends (infer U)[] ? U : never',
    'type Elem<L> = L extends ReadonlyArray<infer E> ? E : undefined',
    'export type One<T> = T extends Array<(infer V)> ? (V) : never',
  ].join('\n')
  assert.deepEqual(itemOfCopies(withFiles({ 'app/composables/useSomething.ts': renamed })), [
    `app/composables/useSomething.ts:2 Row is ItemOf under another name — import ItemOf from ${SHARED_DEFINITION}`,
    `app/composables/useSomething.ts:3 Elem is ItemOf under another name — import ItemOf from ${SHARED_DEFINITION}`,
    `app/composables/useSomething.ts:4 One is ItemOf under another name — import ItemOf from ${SHARED_DEFINITION}`,
  ])
})

test('proof: written inline in a .vue script block it goes red at its real line; a second ItemOf of another shape goes red by name', () => {
  const vue = '<template>\n  <div />\n</template>\n\n<script setup lang="ts">\nimport type { AdminUsersResponse } from \'~/types/admin-users-api\'\nconst rows = ref<Array<AdminUsersResponse[\'users\'] extends readonly (infer U)[] ? U : never>>([])\n</script>\n'
  assert.deepEqual(itemOfCopies(withFiles({ 'app/pages/admin/x.vue': vue })), [
    `app/pages/admin/x.vue:7 the ItemOf conditional written inline — import ItemOf from ${SHARED_DEFINITION}`,
  ])
  assert.deepEqual(itemOfCopies(withFiles({ 'shared/x.ts': 'export type ItemOf<T> = T[number]\n' })), [
    `shared/x.ts:1 a second ItemOf — import it from ${SHARED_DEFINITION}`,
  ])
})

test('proof: a comment quoting it, an import of the shared one, `X[number]` and a conditional answering something else stay green', () => {
  const quiet = [
    '// type ItemOf<T> = T extends readonly (infer U)[] ? U : never',
    "import type { ItemOf } from '../types/item-of'",
    'export type A = ItemOf<string[]>',
    'export type B = string[][number]',
    'export type C<T> = T extends (infer U)[] ? Promise<U> : never',
    'export type D<T> = T extends Promise<infer U> ? U : never',
  ].join('\n')
  assert.deepEqual(itemOfCopies(withFiles({ 'app/utils/x.ts': quiet })), [])
})
