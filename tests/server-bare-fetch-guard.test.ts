import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

/**
 * No server code calls the global `fetch`, except the files named below with the
 * reason they are not a call to an AI provider.
 *
 * CLAUDE.md: "Đích AI (baseUrl) là bề mặt SSRF/lộ key … Đừng gọi `fetch` trần tới nhà
 * cung cấp." A provider call goes through `server/utils/chatbot/outbound.ts`
 * (`safeProviderRequest`/`safeProviderStream`): the URL policy, DNS → public IP pinned
 * to the socket, https/443, no redirects, a deadline and a byte cap. A bare `fetch`
 * has none of these. Three of them survived to Wave 3 — `ai/delify/sync.post.ts`,
 * `ai/delify/status.get.ts`, `utils/ai-budget.ts`, each sending the Delify API key in
 * a query string to a hard-coded host — because nothing but the rule's text stood in
 * the way. This guard is what stands in the way now.
 *
 * Found with the TypeScript parser, not a regex: a comment or a string that says
 * `fetch(` is not a call (three files have one), and the forms a regex would miss are
 * seen — `globalThis.fetch(…)`, `globalThis['fetch']`, and `fetch` passed or aliased
 * as a value (`const get = fetch`). A file that declares its own `fetch` binding is
 * not flagged for using it.
 */

const REPO = resolve(new URL('..', import.meta.url).pathname)

/** Bare `fetch` that is NOT a call to an AI provider, and why. Must match exactly. */
const NON_PROVIDER_BARE_FETCH: Record<string, string> = {
  'server/api/admin/media-portal/youtube-meta.post.ts':
    'YouTube oEmbed on the fixed host www.youtube.com for an id validated by extractYouTubeVideoId; no credential is sent',
  'server/api/public/media/[shortId]/thumb.get.ts':
    'proxies the thumbnail of a published external video so readers never contact the platform; no credential is sent',
}

const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window', 'self'])
const isGlobalObject = (node: ts.Expression) => ts.isIdentifier(node) && GLOBAL_OBJECTS.has(node.text)

/** `fetch` as a value: a call, an alias, an argument — not a property name or a declaration. */
function isValueReference(id: ts.Identifier): boolean {
  const parent = id.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)
    || ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isVariableDeclaration(parent)
    || ts.isFunctionDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)
    || ts.isImportSpecifier(parent) || ts.isImportClause(parent)) && parent.name === id) return false
  if (ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent) || ts.isTypeQueryNode(parent)) return false
  return true
}

/** Lines (1-based) where `source` uses the global `fetch`. */
export function bareFetchLines(source: string, file = 'x.ts'): number[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let declaresFetch = false
  const references: ts.Node[] = []
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === 'fetch') {
      const parent = node.parent
      const declaration = (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isParameter(parent)
        || ts.isBindingElement(parent) || ts.isImportSpecifier(parent) || ts.isImportClause(parent)) && parent.name === node
      if (declaration) declaresFetch = true
      else if (ts.isPropertyAccessExpression(parent) && parent.name === node && isGlobalObject(parent.expression)) references.push(parent)
      else if (isValueReference(node)) references.push(node)
    }
    if (ts.isElementAccessExpression(node) && isGlobalObject(node.expression)
      && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'fetch') references.push(node)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return references
    .filter(node => !declaresFetch || !ts.isIdentifier(node))
    .map(node => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
}

function serverFiles(dir = join(REPO, 'server')): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...serverFiles(path))
    else if (entry.name.endsWith('.ts')) found.push(relative(REPO, path).split(sep).join('/'))
  }
  return found.sort()
}

test('the scanner sees every form of a global fetch, and nothing that only mentions it', () => {
  const seen = [
    'await fetch(url)',
    'await globalThis.fetch(url)',
    "await globalThis['fetch'](url)",
    'const get = fetch',
    'request({ fetch })',
    'await window.fetch(url)',
  ]
  for (const line of seen) assert.deepEqual(bareFetchLines(line), [1], line)

  const notSeen = [
    '// a comment that says fetch(url)',
    "const text = 'fetch(url)'",
    'await $fetch(url)',
    'await ofetch(url)',
    'await client.fetch(url)',
    'const o = { fetch: 1 }',
    'class C { fetch() {} }',
    'type T = { fetch: () => void }',
    "import { fetch } from 'undici'\nawait fetch(url)",
    'function run(fetch: Fetcher) { return fetch(url) }',
  ]
  for (const line of notSeen) assert.deepEqual(bareFetchLines(line), [], line)
})

test('no file under server/ calls the global fetch, except the named non-provider exemptions', () => {
  const offenders = new Map<string, number[]>()
  for (const file of serverFiles()) {
    const lines = bareFetchLines(readFileSync(join(REPO, file), 'utf8'), file)
    if (lines.length) offenders.set(file, lines)
  }
  const unexpected = [...offenders].filter(([file]) => !(file in NON_PROVIDER_BARE_FETCH))
  assert.deepEqual(unexpected, [],
    'bare fetch — a provider call goes through server/utils/chatbot/outbound.ts (Delify usage: server/utils/ai/delify-usage.ts)')
  const stale = Object.keys(NON_PROVIDER_BARE_FETCH).filter(file => !offenders.has(file))
  assert.deepEqual(stale, [], 'an exemption whose file no longer calls fetch: remove its entry')
})

test('the code that decrypts an AI key never reaches the network on its own', () => {
  // Every file that opens an API key either sends through outbound.ts or delify-usage.ts.
  for (const file of serverFiles()) {
    const source = readFileSync(join(REPO, file), 'utf8')
    if (!/\bdecryptAiSecret\s*\(/.test(source) || file === 'server/utils/ai/crypto.ts') continue
    assert.deepEqual(bareFetchLines(source, file), [], file)
    assert.match(source, /safeProviderRequest|safeProviderStream|fetchDelifyUsage|callAi\b/, `${file} decrypts a key but sends it nowhere known`)
  }
})
