import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

/**
 * No server code reaches the network with a generic HTTP client, except the files
 * named below with the reason.
 *
 * CLAUDE.md: "Đích AI (baseUrl) là bề mặt SSRF/lộ key … Đừng gọi `fetch` trần tới nhà
 * cung cấp." A provider call goes through `server/utils/chatbot/outbound.ts`
 * (`safeProviderRequest`/`safeProviderStream`): the URL policy, DNS → public IP pinned
 * to the socket, https/443, no redirects, a deadline and a byte cap. Three bare
 * `fetch` calls to Delify (`ai/delify/sync`, `ai/delify/status`, `utils/ai-budget.ts`)
 * survived to Wave 3 because nothing but the rule's text stood in the way.
 *
 * What counts as a client:
 *   - the globals `fetch` and `$fetch` (Nitro's outbound client — not only a path to
 *     internal routes) used as a value: a call, an alias, an argument, a cast;
 *   - the same through a global object — `globalThis.fetch`, `(globalThis as any).fetch`,
 *     `globalThis['fetch']`, `globalThis!.fetch`, `const { fetch } = globalThis`;
 *   - any value import, `require` or `import()` of `http`/`https`/`http2` (with or
 *     without `node:`), `ofetch`, `undici`, `node-fetch`, `axios`, `got`.
 * Vendor SDKs (S3, Google APIs, SMTP) talk to destinations their own configuration
 * fixes and are out of scope.
 *
 * Bindings are resolved per scope by the TypeScript type checker (one program over
 * `server/`, no lib, every file a module): a parameter or local named `fetch` is not
 * the global, and an unrelated `function helper(fetch)` does not hide a real
 * `fetch(u)` elsewhere in the same file — the per-file flag of the first version did.
 */

const REPO = resolve(new URL('..', import.meta.url).pathname)

/** Generic HTTP clients that are NOT a call to an AI provider, and why. Must match exactly. */
const ALLOWED_NETWORK_CLIENTS: Record<string, string> = {
  'server/utils/chatbot/outbound.ts':
    'the sanctioned path itself: node:https with the checked IP pinned to the socket, https/443, no redirect, deadline, byte cap',
  'server/api/admin/media-portal/youtube-meta.post.ts':
    'fetch: YouTube oEmbed on the fixed host www.youtube.com for an id validated by extractYouTubeVideoId; no credential is sent',
  'server/api/public/media/[shortId]/thumb.get.ts':
    'fetch: proxies the thumbnail of a published external video so readers never contact the platform; no credential is sent',
  'server/api/auth/google/callback.get.ts':
    '$fetch: OAuth code exchange at the fixed GOOGLE_TOKEN_ENDPOINT (oauth2.googleapis.com) — Google sign-in, not an AI provider',
  'server/api/admin/backup/drive/callback.get.ts':
    '$fetch: OAuth code exchange at the fixed GOOGLE_TOKEN_ENDPOINT (oauth2.googleapis.com) — backup Drive, not an AI provider',
}

const GLOBAL_CLIENTS = new Set(['fetch', '$fetch'])
const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window', 'self'])
const NETWORK_MODULES = new Set([
  'http', 'https', 'http2', 'node:http', 'node:https', 'node:http2', 'ofetch', 'undici', 'node-fetch', 'axios', 'got',
])

/** `(x as any)`, `x!`, `<T>x`, `x satisfies T`, `(x)` → `x`. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression
  return current
}

function inTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return true
    if (ts.isStatement(current) || ts.isSourceFile(current) || ts.isExpressionStatement(current)) return false
  }
  return false
}

/** Name positions that are not a reference to a binding: property and declaration names. */
function isNamePosition(id: ts.Identifier): boolean {
  const parent = id.parent
  if (ts.isPropertyAccessExpression(parent)) return parent.name === id
  if (ts.isBindingElement(parent)) return parent.name === id || parent.propertyName === id
  if (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)
    || ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent)
    || ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)
    || ts.isClassDeclaration(parent) || ts.isParameter(parent) || ts.isEnumMember(parent)) return parent.name === id
  return ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent)
}

export type NetworkUse = { line: number, what: string }

/** Every generic-HTTP-client use in `files` (path → source), by file. */
export function networkUses(files: Record<string, string>): Map<string, NetworkUse[]> {
  const options: ts.CompilerOptions = {
    noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleDetection: ts.ModuleDetectionKind.Force,
  }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (name, version) => (name in files ? ts.createSourceFile(name, files[name]!, version, true, ts.ScriptKind.TS) : undefined)
  host.fileExists = name => name in files
  host.readFile = name => files[name]
  const program = ts.createProgram(Object.keys(files), options, host)
  const checker = program.getTypeChecker()
  const found = new Map<string, NetworkUse[]>()

  for (const sf of program.getSourceFiles()) {
    if (!(sf.fileName in files)) continue
    const uses: NetworkUse[] = []
    const add = (node: ts.Node, what: string) => uses.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, what })
    const declaredHere = (symbol: ts.Symbol | undefined) => symbol?.declarations?.some(d => d.getSourceFile() === sf) === true
    const isGlobalObject = (node: ts.Expression) => {
      const target = unwrap(node)
      return ts.isIdentifier(target) && GLOBAL_OBJECTS.has(target.text) && !declaredHere(checker.getSymbolAtLocation(target))
    }
    const networkModule = (node: ts.Node | undefined) => node && ts.isStringLiteralLike(node) && NETWORK_MODULES.has(node.text) ? node.text : null

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        const module = networkModule(node.moduleSpecifier)
        const bindings = node.importClause?.namedBindings
        const onlyTypes = !node.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(e => e.isTypeOnly)
        if (module && !onlyTypes) add(node, `import from '${module}'`)
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const module = networkModule(node.arguments[0])
        if (module) add(node, `load '${module}'`)
      } else if (ts.isIdentifier(node) && GLOBAL_CLIENTS.has(node.text) && !isNamePosition(node) && !inTypePosition(node)) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node)
        if (!declaredHere(symbol)) add(node, `global ${node.text}`)
      } else if ((ts.isPropertyAccessExpression(node) && GLOBAL_CLIENTS.has(node.name.text))
        || (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && GLOBAL_CLIENTS.has(node.argumentExpression.text))) {
        if (isGlobalObject(node.expression)) add(node, `global object .${ts.isPropertyAccessExpression(node) ? node.name.text : 'fetch'}`)
      } else if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isGlobalObject(node.initializer)) {
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name
          if (ts.isIdentifier(property) && GLOBAL_CLIENTS.has(property.text)) add(element, `destructure ${property.text} from a global object`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    if (uses.length) found.set(sf.fileName, uses)
  }
  return found
}

const linesOf = (source: string) => (networkUses({ 'sample.ts': source }).get('sample.ts') ?? []).map(use => use.line)

function serverFiles(dir = join(REPO, 'server')): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...serverFiles(path))
    else if (entry.name.endsWith('.ts')) out.push(relative(REPO, path).split(sep).join('/'))
  }
  return out.sort()
}

test('the scanner sees every way to reach a generic client — including the planted bypasses of the first version', () => {
  const seen: Array<[string, number[]]> = [
    ['await fetch(url)', [1]],
    ['await globalThis.fetch(url)', [1]],
    ["await globalThis['fetch'](url)", [1]],
    ['const get = fetch', [1]],
    ['request({ fetch })', [1]],
    ['await window.fetch(url)', [1]],
    // Plants the first version missed:
    ['await (globalThis as any).fetch(url)', [1]],
    ['const { fetch } = globalThis\nawait fetch(url)', [1]],
    ['function helper(fetch: unknown) { return fetch }\nawait fetch(url)', [2]],
    ['await $fetch(url)', [1]],
    // …and their relatives:
    ['await (globalThis!).fetch(url)', [1]],
    ['await (globalThis satisfies object).$fetch(url)', [1]],
    ['const { $fetch: get } = (globalThis as never)', [1]],
    ['const typed = $fetch as unknown as (u: string) => Promise<unknown>', [1]],
    ["import { ofetch } from 'ofetch'", [1]],
    ["import https from 'node:https'\nhttps.request(url)", [1]],
    ["import { request } from 'https'", [1]],
    ["const http = require('node:http')", [1]],
    ["const { fetch: f } = await import('undici')", [1]],
  ]
  for (const [source, lines] of seen) assert.deepEqual(linesOf(source), lines, source)

  const notSeen = [
    '// a comment that says fetch(url) and $fetch(url)',
    "const text = 'fetch(url)'",
    'await ofetch(url)',
    'await client.fetch(url)',
    'const o = { fetch: 1, $fetch: 2 }',
    'class C { fetch() {} }',
    'type T = { fetch: () => void }\nlet t: typeof fetch',
    'function run(fetch: (u: string) => void) { return fetch(url) }',
    'const fetch = makeFetch()\nawait fetch(url)',
    "import type { IncomingMessage } from 'node:http'",
    "import { type RequestOptions } from 'node:https'",
    'const window = { fetch() {} }\nwindow.fetch()',
  ]
  for (const source of notSeen) assert.deepEqual(linesOf(source), [], source)
})

test('no file under server/ uses a generic HTTP client, except the named exemptions', () => {
  const sources = Object.fromEntries(serverFiles().map(file => [file, readFileSync(join(REPO, file), 'utf8')]))
  const found = networkUses(sources)
  const unexpected = [...found].filter(([file]) => !(file in ALLOWED_NETWORK_CLIENTS))
  assert.deepEqual(unexpected, [],
    'a generic HTTP client — a provider call goes through server/utils/chatbot/outbound.ts (Delify usage: server/utils/ai/delify-usage.ts)')
  const stale = Object.keys(ALLOWED_NETWORK_CLIENTS).filter(file => !found.has(file))
  assert.deepEqual(stale, [], 'an exemption whose file no longer uses a client: remove its entry')
})

test('the code that decrypts an AI key never reaches the network on its own', () => {
  // Every file that opens an API key sends it through outbound.ts or delify-usage.ts.
  const files = serverFiles().filter(file => file !== 'server/utils/ai/crypto.ts')
  for (const file of files) {
    const source = readFileSync(join(REPO, file), 'utf8')
    if (!/\bdecryptAiSecret\s*\(/.test(source)) continue
    assert.deepEqual(networkUses({ [file]: source }).get(file) ?? [], [], file)
    assert.match(source, /safeProviderRequest|safeProviderStream|fetchDelifyUsage|callAi\b/, `${file} decrypts a key but sends it nowhere known`)
  }
})
