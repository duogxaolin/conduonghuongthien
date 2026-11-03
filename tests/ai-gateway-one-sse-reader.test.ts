/**
 * A provider's SSE stream is read in ONE place: `readChatSse` (`server/services/ai-sse.ts`).
 *
 * CLAUDE.md "Luồng SSE của AI đọc ở MỘT nơi": `callAi` once copied the read loop four times
 * (tool-loop step 1, step 2, the "answered directly" follow-up, the no-tool stream), and
 * every fix to one copy missed another — "0 results", then answers sent twice. The loops
 * were merged into `readChatSse` (bcd1d41) and pinned by behaviour
 * (`ai-gateway-streaming-paths`); until this file, nothing stopped a fifth copy from
 * coming back. Splitting `ai-gateway.ts` into parts (wave3 4.3) makes that easier: a
 * copied loop in a new part file is out of sight of anyone reading the barrel.
 *
 * What it checks, over the WHOLE gateway family (`_ai-gateway-family.ts`: the barrel,
 * every `ai-gateway-*.ts` part, and the earlier extractions), by TypeScript AST — a
 * comment that mentions `getReader()` or `data:` is not code:
 *   - outside `ai-sse.ts`, no file consumes a byte stream or parses SSE framing: no
 *     `getReader`, `TextDecoder`/`TextDecoderStream`, `fromWeb`, `pipeThrough`/`pipeTo`
 *     (as a name or a string key), no `for await`, no string or template carrying `data:`
 *     or `[DONE]`;
 *   - `readChatSse` is declared exactly once, in `ai-sse.ts`, and the gateway calls it at
 *     its four readings.
 *
 * Each rule has an injection proof below: the same check run on the family with a
 * violation planted in a part, and it must go red.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import {
  AI_GATEWAY_BARREL, AI_SSE_READER, AI_GATEWAY_PART, aiGatewayFiles, aiGatewaySourcesWith, isAiGatewayFile,
} from './_ai-gateway-family.ts'

/** Names that only a stream consumer needs. */
const STREAM_READER_NAMES = new Set(['getReader', 'TextDecoder', 'TextDecoderStream', 'fromWeb', 'pipeThrough', 'pipeTo'])
/** SSE framing: a parser of the stream must spell one of these. */
const SSE_FRAMING = /data:|\[DONE\]/

function sseReadingSites(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const sites: string[] = []
  const at = (node: ts.Node, what: string) => sites.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${what}`)
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && STREAM_READER_NAMES.has(node.text)) at(node, node.text)
    else if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (STREAM_READER_NAMES.has(node.text)) at(node, `'${node.text}'`)
      if (SSE_FRAMING.test(node.text)) at(node, `SSE framing ${JSON.stringify(node.text)}`)
    } else if (ts.isForOfStatement(node) && node.awaitModifier) at(node, 'for await')
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return sites
}

/** Stream-reading sites in every family file except the one reader. */
const readerViolations = (sources: Map<string, string>): string[] =>
  [...sources].filter(([file]) => file !== AI_SSE_READER).flatMap(([file, source]) => sseReadingSites(file, source))

/** Files that declare `readChatSse` at top level (function or const). */
function readChatSseDeclarations(sources: Map<string, string>): string[] {
  const out: string[] = []
  for (const [file, source] of sources) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const statement of sf.statements) {
      const names = ts.isFunctionDeclaration(statement) ? [statement.name?.text]
        : ts.isVariableStatement(statement) ? statement.declarationList.declarations.map(d => ts.isIdentifier(d.name) ? d.name.text : undefined) : []
      if (names.includes('readChatSse')) out.push(file)
    }
  }
  return out
}

/** Calls `readChatSse(…)` outside the reader itself. */
function readChatSseCalls(sources: Map<string, string>): number {
  let calls = 0
  for (const [file, source] of sources) {
    if (file === AI_SSE_READER) continue
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'readChatSse') calls++
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return calls
}

// ─── Real code ───────────────────────────────────────────────────────────────

test('the scan is the whole gateway family, derived from the directory', () => {
  const files = aiGatewayFiles()
  for (const file of [AI_GATEWAY_BARREL, AI_SSE_READER, 'server/services/ai-text-cleaner.ts', 'server/services/ai-response-parse.ts'])
    assert.ok(files.includes(file), `${file} vắng khỏi ${JSON.stringify(files)}`)
  assert.ok(isAiGatewayFile('ai-gateway-new-seam.ts'), 'a new part joins the scan without anyone listing it')
  for (const name of ['ai-gateway.js', 'ai-gateway-.ts', 'ai-gatewayx.ts', 'ai-budget.ts', 'ai-sse-v2.ts'])
    assert.ok(!AI_GATEWAY_PART.test(name), `${name} is not a part`)
})

test('outside ai-sse.ts, no file of the gateway family reads a stream or parses SSE framing', () => {
  const sources = aiGatewaySourcesWith()
  assert.deepEqual(readerViolations(sources), [])
  // Not an empty check: the reader itself is seen by the very same scan.
  const own = sseReadingSites(AI_SSE_READER, sources.get(AI_SSE_READER)!).map(site => site.replace(/^\S+ /, ''))
  for (const what of ['getReader', 'TextDecoder', 'SSE framing "data:"'])
    assert.ok(own.includes(what), `${what} vắng khỏi ${JSON.stringify(own)}`)
})

test('readChatSse is declared once, in ai-sse.ts, and the gateway reads the stream through it at its four readings', () => {
  const sources = aiGatewaySourcesWith()
  assert.deepEqual(readChatSseDeclarations(sources), [AI_SSE_READER])
  assert.equal(readChatSseCalls(sources), 4)
})

// ─── Injection proofs: each rule goes red ────────────────────────────────────

/**
 * One of the four copies `callAi` carried before bcd1d41 merged them — the no-tool stream
 * (`git show bcd1d41^:server/services/ai-gateway.ts`, the `getReader` at line 1046), trimmed
 * of its token bookkeeping and wrapped in a function so it parses on its own.
 */
const COPIED_LOOP = `export async function relay(response: { body: ReadableStream<Uint8Array> }, onChunk: (c: string) => Promise<void>) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let streamBuffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    streamBuffer += decoder.decode(value, { stream: true })
    const lines = streamBuffer.split('\\n')
    streamBuffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') continue
      const parsed = JSON.parse(trimmed.slice(5).trim())
      const delta = parsed?.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) await onChunk(delta)
    }
  }
}
`

test('proof: the old copied read loop in a new part goes red — on every signal it carries', () => {
  const sources = aiGatewaySourcesWith({ 'server/services/ai-gateway-relay.ts': COPIED_LOOP })
  const found = readerViolations(sources).map(site => site.replace(/^server\/services\/ai-gateway-relay\.ts:\d+ /, ''))
  assert.deepEqual(found, ['getReader', 'TextDecoder', 'SSE framing "data:"', 'SSE framing "data: [DONE]"'])
})

test('proof: the same loop appended to the barrel, or to an earlier extraction, goes red', () => {
  for (const file of [AI_GATEWAY_BARREL, 'server/services/ai-text-cleaner.ts']) {
    const sources = aiGatewaySourcesWith({ [file]: `${aiGatewaySourcesWith().get(file)}\n${COPIED_LOOP}` })
    assert.ok(readerViolations(sources).some(site => site.startsWith(`${file}:`)), file)
  }
})

test('proof: each signal alone goes red; a comment naming them does not', () => {
  const part = 'server/services/ai-gateway-probe.ts'
  const red = [
    'export const r = (b: ReadableStream) => b.getReader()',
    "export const r = (b: ReadableStream) => (b as never)['getReader']()",
    'export const d = new TextDecoder()',
    'export const s = (b: ReadableStream) => b.pipeThrough(new TextDecoderStream())',
    "import { Readable } from 'node:stream'\nexport const n = (b: ReadableStream) => Readable.fromWeb(b as never)",
    'export async function f(b: AsyncIterable<Uint8Array>) { for await (const c of b) void c }',
    "export const isEvent = (line: string) => line.startsWith('data:')",
    'export const prefix = `data: ${1}`',
    "export const end = (line: string) => line === '[DONE]'",
  ]
  for (const source of red)
    assert.notDeepEqual(readerViolations(aiGatewaySourcesWith({ [part]: source })), [], source)
  const quiet = '// body.getReader() then new TextDecoder(), lines start with data: until [DONE]\nexport const x = 1'
  assert.deepEqual(readerViolations(aiGatewaySourcesWith({ [part]: quiet })), [])
})

test('proof: a second readChatSse declared in a part goes red', () => {
  const sources = aiGatewaySourcesWith({ 'server/services/ai-gateway-sse-copy.ts': 'export async function readChatSse() { return null }' })
  assert.deepEqual(readChatSseDeclarations(sources), ['server/services/ai-gateway-sse-copy.ts', AI_SSE_READER])
})

test('proof: a file the directory scan would not read is never handed to the guard', () => {
  const sources = aiGatewaySourcesWith({ 'server/utils/ai-gateway-elsewhere.ts': COPIED_LOOP, 'server/services/ai-gatewayx.ts': COPIED_LOOP })
  assert.deepEqual(readerViolations(sources), [])
  assert.deepEqual([...sources.keys()], aiGatewayFiles())
})
