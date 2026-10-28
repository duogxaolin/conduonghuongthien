import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { articles, media, mediaItems, type ChatbotSettings } from '../server/db/schema'
import { retrieveKnowledge, type PublicKnowledgeReference, type RetrievalEntry } from '../server/utils/chatbot/retrieval'
import { CHATBOT_HOTLINE } from '../server/utils/chatbot/prompt-defaults'

/**
 * The seams of `answerGroundedChat`, run for real before and after `chat-policy.ts`
 * was split (wave3-long-term 4.3, D-SPLIT). Every other chatbot test reaches the
 * provider through the LEGACY direct path (`providerRequest`), because the AI gateway
 * finds no configuration in a test process. The gateway path — the one production
 * takes — and the five tools the model may call were never executed by any test.
 *
 * Only the leaves are replaced: the gateway (`callAi`), the database handle
 * (`getDb`) and the rate-limit store's backing (in-memory). Everything between —
 * request validation, rate limit, AI quota, retrieval, grounded prompt, tool
 * executors, evidence weaving, follow-up chips, fallbacks — is the real code, and the
 * article query is compiled to MySQL to check where the model's string ends up.
 */

const memory = new Map<string, { count: number, expiresAt: number }>()
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({ execute: null, memory }) } })

// ─── AI gateway: runs the tools it is handed, the way the real one does ─────

type Tool = { name: string, execute: (args: Record<string, unknown>) => unknown }
type GatewayInput = {
  prompt: string
  systemPrompt?: string
  variables?: Record<string, string>
  userId?: number | null
  history?: Array<{ role: string, content: string }>
  onChunk?: (chunk: string) => void | Promise<void>
  onToolCall?: unknown
  tools?: Tool[]
}
type Script =
  | { steps?: Array<{ name: string, args: Record<string, unknown> }>, chunks?: string[], result: { ok: boolean, text?: string, error?: string } }
  | 'throw'

let script: Script = { result: { ok: true, text: 'Câu trả lời của AI.' } }
const gatewayCalls: Array<{ service: string, input: GatewayInput }> = []
const toolOutputs: Array<{ name: string, data: unknown }> = []

mock.module('../server/services/ai-gateway', {
  namedExports: {
    callAi: async (service: string, input: GatewayInput) => {
      gatewayCalls.push({ service, input })
      if (script === 'throw') throw new Error('gateway exploded')
      const executed: Array<{ name: string, query?: string, count?: number, data?: unknown }> = []
      for (const step of script.steps ?? []) {
        const tool = input.tools?.find(candidate => candidate.name === step.name)
        assert.ok(tool, `tool ${step.name} was not offered to the model`)
        const data = await tool.execute(step.args)
        toolOutputs.push({ name: step.name, data })
        executed.push({ name: step.name, query: String(step.args.query ?? ''), count: Array.isArray(data) ? data.length : data ? 1 : 0, data })
      }
      for (const chunk of script.chunks ?? []) await input.onChunk?.(chunk)
      return { ...script.result, toolCallsExecuted: executed.length ? executed : undefined }
    },
  },
})

// ─── Database: records each query, answers with canned rows ─────────────────

type Query = { projection: string[], table: unknown, where?: SQL, orderBy: SQL[], limit: number | null }
const queries: Query[] = []
let rowsFor: (table: unknown) => unknown[] = () => []
let dbFailure: Error | null = null
const fakeDb = {
  select(projection: Record<string, unknown>) {
    const query: Query = { projection: Object.keys(projection), table: null, orderBy: [], limit: null }
    const chain = {
      from(table: unknown) { query.table = table; return chain },
      where(condition: SQL) { query.where = condition; return chain },
      orderBy(...order: SQL[]) { query.orderBy = order; return chain },
      limit(count: number) { query.limit = count; queries.push(query); return Promise.resolve(rowsFor(query.table)) },
    }
    return chain
  },
}
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => {
      if (dbFailure) throw dbFailure
      return fakeDb
    },
  },
})

const { answerGroundedChat, AI_QUOTA_RULE, HOTLINE } = await import('../server/utils/chatbot/chat-policy')
const { SOVEREIGNTY_PROMPT_RULES } = await import('../server/utils/chatbot/sovereignty-guard')
type ChatDependencies = Parameters<typeof answerGroundedChat>[3]
type ChatEvent = Parameters<typeof answerGroundedChat>[0]

const dialect = new MySqlDialect()
const compile = (expression: SQL) => dialect.sqlToQuery(expression)
const FORBIDDEN_IN_SQL = /SLEEP|UNION|DROP\s+TABLE|password_hash|OR 1=1/i
const TOOL_NAMES = ['search_c11_knowledge', 'search_c11_articles', 'search_c11_videos', 'search_c11_photos', 'get_c11_hotline_and_support']

const now = new Date('2026-01-01T00:00:00Z')
function entry(id: number, canonicalQuestion: string, keywords: string[]): RetrievalEntry {
  return {
    id,
    canonicalQuestion,
    normalizedQuestion: canonicalQuestion.toLowerCase(),
    approvedAnswer: `Câu trả lời đã duyệt cho mục ${id}.`,
    topic: 'legal',
    sourceLabel: 'C11',
    sourceUrl: null,
    sourceReference: `VB-${id}`,
    internalNotes: `GHI-CHU-NOI-BO-${id}`,
    status: 'published',
    priority: 0,
    isQuickQuestion: false,
    authorId: 1,
    reviewerId: 2,
    reviewedAt: now,
    publishedAt: now,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    terms: keywords.map(value => ({ kind: 'keyword', value, normalizedValue: value })),
  } as RetrievalEntry
}

const BANK = [
  entry(1, 'Thủ tục xóa án tích như thế nào?', ['xóa án tích']),
  entry(2, 'Người chấp hành xong án phạt tù có được vay vốn không?', ['vay vốn']),
  entry(3, 'Đăng ký cư trú sau khi ra tù ở đâu?', ['cư trú']),
]

function settingsOf(overrides: Partial<ChatbotSettings> = {}): ChatbotSettings {
  return {
    enabled: true,
    baseUrl: 'https://api.provider.example/v1',
    model: 'safe-model',
    systemPrompt: 'Chỉ trả lời theo tài liệu đã duyệt.',
    allowedHosts: ['api.provider.example'],
    requestTimeoutMs: 1_000,
    maxResponseBytes: 16_384,
    maxInputChars: 2_000,
    maxHistoryMessages: 8,
    retrievalTopK: 3,
    referenceCharBudget: 6_000,
    rateLimitRequests: 1_000,
    rateLimitWindowSeconds: 60,
    leadCaptureEnabled: true,
    ...overrides,
  } as ChatbotSettings
}

let visitor = 0
function eventOf(sessionId: string | null = null): ChatEvent {
  visitor += 1
  const context: Record<string, unknown> = {}
  if (sessionId) context.chatSessionId = sessionId
  return { node: { req: { headers: {}, socket: { remoteAddress: `198.51.100.${visitor}` } } }, context } as unknown as ChatEvent
}

function harness(overrides: Partial<ChatDependencies> = {}) {
  const calls = { load: 0, legacy: 0, legacyOptions: [] as unknown[] }
  const dependencies: ChatDependencies = {
    loadPublishedEntries: async () => { calls.load += 1; return BANK },
    loadSmallTalkEntries: async () => [],
    configuredSecret: () => 'secret-key',
    providerRequest: async (options) => {
      calls.legacy += 1
      calls.legacyOptions.push(options)
      const body = JSON.stringify({ choices: [{ message: { content: 'Câu trả lời từ đường gọi cũ.' } }] })
      return { status: 200, body: Buffer.from(body) } as unknown as Awaited<ReturnType<ChatDependencies['providerRequest']>>
    },
    ...overrides,
  }
  return { dependencies, calls }
}

const ask = (text: string) => [{ role: 'user', content: text }]

function reset(next: Script) {
  script = next
  gatewayCalls.length = 0
  toolOutputs.length = 0
  queries.length = 0
  rowsFor = () => []
  dbFailure = null
}

const outputOf = (name: string) => {
  const hit = toolOutputs.find(output => output.name === name)
  assert.ok(hit, `${name} did not run`)
  return hit.data
}

// ─── Gateway path: prompt, history, tools ────────────────────────────────────

test('the grounded AI path hands the gateway the grounded prompt, the visitor turn, the history and five tools in order', async () => {
  reset({ result: { ok: true, text: 'Câu trả lời của AI.' } })
  const { dependencies, calls } = harness()
  const history = [
    { role: 'user', content: 'Chào' },
    { sender: 'bot', text: 'Xin chào anh/chị.' },
    { role: 'user', content: 'Thủ tục xóa án tích?' },
  ]
  const toolEvents: unknown[] = []
  const onToolCall = (toolEvent: unknown) => { toolEvents.push(toolEvent) }
  const result = await answerGroundedChat(eventOf('s-prompt'), settingsOf(), history, dependencies, undefined, onToolCall)

  assert.equal(gatewayCalls.length, 1)
  const { service, input } = gatewayCalls[0]!
  assert.equal(service, 'chatbot')
  assert.equal(input.prompt, 'Thủ tục xóa án tích?')
  assert.equal(input.userId, null)
  // The policy hands the gateway a wrapper (a model-written tool query about the sovereignty topic is
  // dropped — sovereignty-guard.ts); any other tool event reaches the caller untouched, the same object.
  const toolEvent = { name: 'search_c11_knowledge', query: 'xóa án tích', status: 'calling' }
  await (input.onToolCall as (toolEvent: unknown) => unknown)(toolEvent)
  assert.equal(toolEvents.length, 1)
  assert.equal(toolEvents[0], toolEvent, 'tool events reach the caller untouched')
  assert.equal(input.onChunk, undefined, 'no stream filter without a stream')
  // A bot turn written as `{ sender: 'bot', text }` is still the assistant's turn.
  assert.deepEqual(input.history, [
    { role: 'user', content: 'Chào' },
    { role: 'assistant', content: 'Xin chào anh/chị.' },
    { role: 'user', content: 'Thủ tục xóa án tích?' },
  ])
  assert.match(input.systemPrompt!, /^Chỉ trả lời theo tài liệu đã duyệt\./)
  assert.match(input.systemPrompt!, /<UNTRUSTED_KNOWLEDGE_REFERENCES>\n\[REFERENCE 1\]\nQuestion: Thủ tục xóa án tích như thế nào\?\nApproved answer: Câu trả lời đã duyệt cho mục 1\./)
  assert.doesNotMatch(input.systemPrompt!, /GHI-CHU-NOI-BO/, 'internal notes never reach the model')
  // `{{question}}` lands inside the system prompt: fenced with a per-call tag, never raw
  // (tests/chatbot-question-variable-fence.test.ts); the visitor turn above stays as written.
  assert.match(input.variables?.question ?? '', /^<(cau_hoi_[0-9a-f]{12})>\nThủ tục xóa án tích\?\n<\/\1>$/)
  assert.deepEqual(input.tools?.map(tool => tool.name), TOOL_NAMES)
  assert.equal(calls.legacy, 0, 'a gateway answer never touches the legacy path')

  assert.equal(result.kind, 'provider')
  assert.equal(result.answer, 'Câu trả lời của AI.')
  assert.deepEqual(result.sources.map(source => [source.id, source.kind]), [[1, 'knowledge']])
  assert.equal(result.streamed, false)
})

test('evidence pulled through tools is woven into the answer, not listed as a source; bank rows the model fetched become chips', async () => {
  reset({
    steps: [
      { name: 'search_c11_articles', args: { query: 'xóa án tích', type: 'role_model' } },
      { name: 'search_c11_videos', args: { query: 'xóa án tích' } },
      { name: 'search_c11_knowledge', args: { query: 'cư trú' } },
    ],
    result: { ok: true, text: 'Câu trả lời có dẫn chứng.' },
  })
  rowsFor = (table) => table === articles
    ? [{ id: 7, title: 'Gương sáng', type: 'role_model', slug: 'guong-sang', excerpt: 'Sapo', content: '<p>Nội dung</p>', thumbnailUrl: null }]
    : table === mediaItems
      ? [{ id: 4, title: 'Phóng sự', slug: 'phong-su', shortId: 'ps1', description: 'Mô tả', thumbnailUrl: null }]
      : []
  // Keep the very array `answerGroundedChat` grounds on: the provider path appends to it.
  let grounding: PublicKnowledgeReference[] | null = null
  const { dependencies } = harness({
    retrieve: (entries, query, options) => {
      const out = retrieveKnowledge(entries, query, options)
      grounding ??= out
      return out
    },
  })
  const result = await answerGroundedChat(eventOf('s-evidence'), settingsOf(), ask('Thủ tục xóa án tích?'), dependencies)

  assert.equal(result.kind, 'provider')
  assert.equal(result.answer, 'Câu trả lời có dẫn chứng.')
  assert.ok(grounding)
  assert.deepEqual(
    grounding.filter(ref => ref.kind === 'evidence').map(ref => ({ id: ref.id, question: ref.question, answer: ref.answer, topic: ref.topic, source: ref.source })),
    [
      { id: 0, question: 'Gương sáng', answer: 'Nội dung', topic: 'role_model', source: { label: 'Tấm gương: Gương sáng', reference: null, url: '/news/guong-sang' } },
      { id: 0, question: 'Phóng sự', answer: '', topic: '', source: { label: 'Video: Phóng sự', reference: null, url: '/media/ps1' } },
    ],
    'article and video results join the grounding as evidence; knowledge rows (no title/url) do not',
  )
  assert.deepEqual(result.sources.map(source => [source.id, source.kind]), [[1, 'knowledge']], 'evidence is in the answer body, not repeated as a source')
  assert.deepEqual(result.toolCalls?.map(call => [call.name, call.arguments, call.count]), [
    ['search_c11_articles', 'xóa án tích', 1],
    ['search_c11_videos', 'xóa án tích', 1],
    ['search_c11_knowledge', 'cư trú', 1],
  ])
  for (const call of result.toolCalls ?? []) assert.match(call.id, new RegExp(`^call_${call.name}_\\d+$`))
  assert.deepEqual(result.followUps, ['Đăng ký cư trú sau khi ra tù ở đâu?'], 'the bank row the model fetched is offered next; the row just answered is not')
})

test('the article tool binds the model string as SQL parameters, published only, and returns readable Vietnamese', async () => {
  const payload = `x' OR SLEEP(5) -- `
  reset({ steps: [{ name: 'search_c11_articles', args: { query: payload, type: ' role_model ' } }], result: { ok: true, text: 'Đáp.' } })
  rowsFor = () => [
    { id: 7, title: 'G&#432;&#417;ng s&aacute;ng', type: 'role_model', slug: 'guong-sang', excerpt: 'Sapo &amp; t&oacute;m t&#7855;t', content: `<p>Ng&agrave;y</p>${'<b>x</b>'.repeat(400)}`, thumbnailUrl: '/uploads/a.jpg' },
    { id: 8, title: 'Mô hình', type: 'reintegration', slug: 'mo-hinh', excerpt: null, content: null, thumbnailUrl: null },
    { id: 9, title: 'Khác', type: 'other', slug: 'khac', excerpt: 'Chỉ có sapo', content: '', thumbnailUrl: null },
  ]
  const { dependencies } = harness()
  await answerGroundedChat(eventOf('s-articles'), settingsOf(), ask('Thủ tục xóa án tích?'), dependencies)

  assert.equal(queries.length, 1)
  const query = queries[0]!
  assert.equal(query.table, articles)
  assert.deepEqual(query.projection, ['id', 'title', 'type', 'slug', 'excerpt', 'content', 'thumbnailUrl'])
  assert.equal(query.limit, 5)
  const where = compile(query.where!)
  for (const part of [where, ...query.orderBy.map(compile)]) assert.doesNotMatch(part.sql, FORBIDDEN_IN_SQL, part.sql)
  assert.ok(where.params.includes('published'), 'published rows only')
  assert.ok(where.params.includes('role_model'), 'the type filter is trimmed and bound')
  assert.ok(query.orderBy.length >= 1)

  const [first, second, third] = outputOf('search_c11_articles') as Array<Record<string, unknown>>
  assert.equal(first!.title, 'Gương sáng')
  assert.equal(first!.summary, 'Sapo & tóm tắt')
  assert.equal(first!.url, '/news/guong-sang')
  assert.equal(first!.coverImage, '/uploads/a.jpg')
  assert.equal(first!.categoryArchiveUrl, '/news/role-models')
  assert.equal(first!.snippet, `${`Ngày ${'x '.repeat(400)}`.trim().slice(0, 350)}...`, 'tags stripped, entities decoded, cut at 350')
  assert.equal(second!.snippet, '')
  assert.equal(second!.coverImage, null)
  assert.equal(second!.categoryArchiveUrl, '/news/reintegration-models')
  assert.equal(third!.snippet, 'Chỉ có sapo', 'no body: the excerpt is the snippet')
  assert.equal(third!.categoryArchiveUrl, '/news')
})

test('video and photo tools bind an escaped LIKE operand, newest first, capped, shaped for the answer', async () => {
  reset({
    steps: [
      { name: 'search_c11_videos', args: { query: '100%_x' } },
      { name: 'search_c11_photos', args: { query: 'trao vốn' } },
    ],
    result: { ok: true, text: 'Đáp.' },
  })
  rowsFor = (table) => table === mediaItems
    ? [
        { id: 1, title: 'Có mã ngắn', slug: 'co-ma', shortId: 'abc', description: 'D1', thumbnailUrl: '/p.jpg' },
        { id: 2, title: 'Không mã ngắn', slug: 'khong-ma', shortId: null, description: 'D2', thumbnailUrl: null },
      ]
    : [{ id: 3, originalName: 'trao.von.2026.jpg', url: '/uploads/trao.jpg' }]
  const { dependencies } = harness()
  await answerGroundedChat(eventOf('s-media'), settingsOf(), ask('Thủ tục xóa án tích?'), dependencies)

  const [videoQuery, photoQuery] = queries
  assert.equal(videoQuery!.table, mediaItems)
  assert.equal(videoQuery!.limit, 3)
  assert.ok(compile(videoQuery!.where!).params.includes('%100\\%\\_x%'), 'wildcards typed by the model are escaped')
  assert.match(compile(videoQuery!.orderBy[0]!).sql, /`created_at` desc/i)
  assert.equal(photoQuery!.table, media)
  assert.equal(photoQuery!.limit, 4)
  assert.match(compile(photoQuery!.orderBy[0]!).sql, /`created_at` desc/i)

  assert.deepEqual(outputOf('search_c11_videos'), [
    { title: 'Có mã ngắn', url: '/media/abc', posterUrl: '/p.jpg', description: 'D1' },
    { title: 'Không mã ngắn', url: '/media/khong-ma', posterUrl: null, description: 'D2' },
  ])
  assert.deepEqual(outputOf('search_c11_photos'), [{ caption: 'trao.von.2026', url: '/uploads/trao.jpg' }])
})

test('the knowledge and hotline tools answer from the approved bank only; a blank query loads nothing', async () => {
  reset({
    steps: [
      { name: 'search_c11_knowledge', args: { query: '   ' } },
      { name: 'search_c11_knowledge', args: { query: 'vay vốn' } },
      { name: 'get_c11_hotline_and_support', args: {} },
    ],
    result: { ok: true, text: 'Đáp.' },
  })
  const { dependencies, calls } = harness()
  await answerGroundedChat(eventOf('s-knowledge'), settingsOf(), ask('Thủ tục xóa án tích?'), dependencies)

  const [blank, found, hotline] = toolOutputs
  assert.deepEqual(blank!.data, [])
  assert.deepEqual(found!.data, [{ id: 2, question: 'Người chấp hành xong án phạt tù có được vay vốn không?', answer: 'Câu trả lời đã duyệt cho mục 2.', source: 'C11' }])
  assert.equal(calls.load, 2, 'one load for grounding, one for the non-blank tool query — none for the blank one')
  assert.equal(HOTLINE, CHATBOT_HOTLINE)
  assert.equal((hotline!.data as { hotline: string }).hotline, CHATBOT_HOTLINE)
  assert.match((hotline!.data as { agency: string }).agency, /\(C11\) - Bộ Công an$/)
})

test('a tool whose read fails returns an empty list instead of failing the answer', async () => {
  reset({
    steps: TOOL_NAMES.slice(0, 4).map(name => ({ name, args: { query: 'xóa án tích' } })),
    result: { ok: true, text: 'Vẫn trả lời.' },
  })
  dbFailure = new Error('database unavailable')
  let loads = 0
  const { dependencies } = harness({
    loadPublishedEntries: async () => {
      loads += 1
      if (loads > 1) throw new Error('bank unavailable')
      return BANK
    },
  })
  const result = await answerGroundedChat(eventOf('s-fail'), settingsOf(), ask('Thủ tục xóa án tích?'), dependencies)
  assert.deepEqual(toolOutputs.map(output => [output.name, output.data]), TOOL_NAMES.slice(0, 4).map(name => [name, []]))
  assert.equal(result.kind, 'provider')
  assert.equal(result.answer, 'Vẫn trả lời.')
})

// ─── Streaming ───────────────────────────────────────────────────────────────

test('streamed chunks reach the reader without the follow-up block, and the answer is marked streamed', async () => {
  reset({
    chunks: ['Câu trả lời', ' đầy đủ.\n[[GO', 'I_Y]]\n- Hồ sơ gồm những gì?'],
    result: { ok: true, text: 'Câu trả lời đầy đủ.\n[[GOI_Y]]\n- Hồ sơ gồm những gì?' },
  })
  let streamed = ''
  const { dependencies } = harness()
  const result = await answerGroundedChat(eventOf('s-stream'), settingsOf(), ask('Thủ tục xóa án tích?'), dependencies, (chunk) => { streamed += chunk })
  assert.equal(typeof gatewayCalls[0]!.input.onChunk, 'function')
  assert.match(streamed, /^Câu trả lời đầy đủ\./)
  assert.doesNotMatch(streamed, /GOI_Y|\[\[|Hồ sơ gồm/, 'the marker and the proposals never reach the reader')
  assert.equal(result.answer, 'Câu trả lời đầy đủ.')
  assert.equal(result.streamed, true)
})

// ─── Gateway failures: budget, inactive, throwing ────────────────────────────

test('budget exceeded: no legacy provider call, the approved answer stands', async () => {
  reset({ result: { ok: false, error: 'budget_exceeded' } })
  const { dependencies, calls } = harness()
  const result = await answerGroundedChat(eventOf('s-budget'), settingsOf(), ask('Thủ tục xóa án tích?'), dependencies)
  assert.equal(gatewayCalls.length, 1)
  assert.equal(calls.legacy, 0, 'over budget must not be bypassed through the legacy path')
  assert.equal(result.kind, 'curated')
  assert.equal(result.answer, 'Câu trả lời đã duyệt cho mục 1.')
})

for (const [label, next] of [['inactive', { result: { ok: false, error: 'service_inactive' } }], ['throwing', 'throw']] as const) {
  test(`gateway ${label}: the legacy provider call answers with the same grounded prompt, inside the configured host and limits`, async () => {
    reset(next)
    const { dependencies, calls } = harness()
    const result = await answerGroundedChat(eventOf(`s-legacy-${label}`), settingsOf(), ask('Thủ tục xóa án tích?'), dependencies)
    assert.equal(calls.legacy, 1)
    const options = calls.legacyOptions[0] as { url: string, allowedHosts: string[], method: string, timeoutMs: number, maxResponseBytes: number, body: string }
    assert.equal(options.url, 'https://api.provider.example/v1/chat/completions')
    assert.deepEqual(options.allowedHosts, ['api.provider.example'])
    assert.equal(options.method, 'POST')
    assert.equal(options.timeoutMs, 1_000)
    assert.equal(options.maxResponseBytes, 16_384)
    assert.match(String(options.body), /UNTRUSTED_KNOWLEDGE_REFERENCES/)
    // The sovereignty stance rules ride on this path too (same grounded prompt, sovereignty-guard.ts).
    const legacySystem = (JSON.parse(String(options.body)) as { messages: Array<{ role: string, content: string }> }).messages[0]!
    assert.equal(legacySystem.role, 'system')
    assert.ok(legacySystem.content.includes(SOVEREIGNTY_PROMPT_RULES), 'the stance rules, whole, in the legacy system prompt')
    assert.equal(result.kind, 'provider')
    assert.equal(result.answer, 'Câu trả lời từ đường gọi cũ.')
  })
}

test('gateway inactive and no stored secret: the approved answer, no legacy request', async () => {
  reset({ result: { ok: false, error: 'no_api_key' } })
  const { dependencies, calls } = harness({ configuredSecret: () => null })
  const result = await answerGroundedChat(eventOf('s-nosecret'), settingsOf(), ask('Thủ tục xóa án tích?'), dependencies)
  assert.equal(calls.legacy, 0)
  assert.equal(result.kind, 'curated')
})

// ─── AI quota at the provider call ───────────────────────────────────────────

test('past the session AI quota, free-form answers with the quota message and grounded falls back to the bank — no provider call', async () => {
  const freeform = settingsOf({ outOfScopeBehavior: 'ai_freeform' } as Partial<ChatbotSettings>)
  const { dependencies: empty } = harness({ loadPublishedEntries: async () => [] })
  reset({ result: { ok: true, text: 'Trả lời tự do.' } })
  for (let call = 0; call < AI_QUOTA_RULE.limit; call += 1) {
    const allowed = await answerGroundedChat(eventOf('s-quota-free'), freeform, ask('Một câu hỏi ngoài kho'), empty)
    assert.equal(allowed.kind, 'provider', `call ${call + 1} is inside the allowance`)
  }
  assert.equal(gatewayCalls.length, AI_QUOTA_RULE.limit)
  const refused = await answerGroundedChat(eventOf('s-quota-free'), freeform, ask('Một câu hỏi ngoài kho'), empty)
  assert.equal(refused.kind, 'rate_limited')
  assert.ok((refused.retryAfter ?? 0) > 0)
  assert.match(refused.answer, /hết lượt hỏi trợ lý AI/)
  assert.ok(refused.answer.includes(CHATBOT_HOTLINE))
  assert.equal(gatewayCalls.length, AI_QUOTA_RULE.limit, 'the refused call reached no provider')

  reset({ result: { ok: true, text: 'Trả lời có căn cứ.' } })
  const { dependencies: bank } = harness()
  for (let call = 0; call < AI_QUOTA_RULE.limit; call += 1)
    await answerGroundedChat(eventOf('s-quota-grounded'), settingsOf(), ask('Thủ tục xóa án tích?'), bank)
  const curated = await answerGroundedChat(eventOf('s-quota-grounded'), settingsOf(), ask('Thủ tục xóa án tích?'), bank)
  assert.equal(curated.kind, 'curated', 'a question the bank answers is not refused')
  assert.equal(curated.answer, 'Câu trả lời đã duyệt cho mục 1.')
  assert.equal(gatewayCalls.length, AI_QUOTA_RULE.limit)
})

// ─── Request validation before any charge ────────────────────────────────────

test('a turn list that ends with the assistant, or is too long, is refused before any rate-limit hit or provider work', async () => {
  reset({ result: { ok: true, text: 'không được tới đây' } })
  const { dependencies, calls } = harness()
  const before = memory.size
  const lastIsAssistant = [{ role: 'user', content: 'Hỏi' }, { role: 'assistant', content: 'Đáp' }]
  await assert.rejects(answerGroundedChat(eventOf('s-invalid'), settingsOf(), lastIsAssistant, dependencies), /INVALID_MESSAGES/)
  const tooMany = Array.from({ length: 31 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `lượt ${index}` }))
  await assert.rejects(answerGroundedChat(eventOf('s-invalid'), settingsOf({ maxHistoryMessages: 100 }), tooMany, dependencies), /INVALID_MESSAGES/)
  await assert.rejects(answerGroundedChat(eventOf('s-invalid'), settingsOf(), ask('x'.repeat(70_000)), dependencies), /REQUEST_TOO_LARGE/)
  assert.equal(memory.size, before, 'no counter was created')
  assert.equal(gatewayCalls.length, 0)
  assert.equal(calls.load, 0)
})
