import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatbotSettings } from '../server/db/schema'
import { answerGroundedChat, HOTLINE, type ChatDependencies, type ChatEvent } from '../server/utils/chatbot/chat-policy'
import { retrieveKnowledge, type RetrievalEntry } from '../server/utils/chatbot/retrieval'

const now = new Date('2026-01-01T00:00:00Z')
const settings = {
  enabled: true,
  baseUrl: 'https://api.provider.example/v1',
  model: 'safe-model',
  systemPrompt: 'Answer only from approved references.',
  allowedHosts: ['api.provider.example'],
  requestTimeoutMs: 1_000,
  maxResponseBytes: 16_384,
  maxInputChars: 2_000,
  maxHistoryMessages: 8,
  retrievalTopK: 3,
  referenceCharBudget: 6_000,
  rateLimitRequests: 100,
  rateLimitWindowSeconds: 60,
} as ChatbotSettings

function entry(overrides: Partial<RetrievalEntry> = {}): RetrievalEntry {
  return {
    id: 1,
    canonicalQuestion: 'Thủ tục tái hòa nhập',
    normalizedQuestion: 'thủ tục tái hòa nhập',
    approvedAnswer: 'Nội dung pháp luật đã được phê duyệt.',
    topic: 'legal',
    sourceLabel: 'C11',
    sourceUrl: 'https://example.gov.vn/source',
    sourceReference: 'VB-01',
    internalNotes: 'PRIVATE-NOTE',
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
    terms: [],
    ...overrides,
  }
}

function event(id: string, headers: Record<string, string> = {}): ChatEvent {
  return {
    node: { req: { headers, socket: { remoteAddress: `198.51.100.${id}` } } },
    context: {},
  } as ChatEvent
}

function anonymousEvent(headers: Record<string, string> = {}): ChatEvent {
  return { node: { req: { headers, socket: {} } }, context: {} } as ChatEvent
}

function dependencies(rows: RetrievalEntry[]) {
  const calls = { loading: 0, retrieval: 0, provider: 0, secret: 0 }
  const value: ChatDependencies = {
    loadPublishedEntries: async () => { calls.loading++; return rows },
    loadSmallTalkEntries: async () => [],
    retrieve: (entries, query, options) => { calls.retrieval++; return retrieveKnowledge(entries, query, options) },
    configuredSecret: () => { calls.secret++; return 'provider-secret' },
    providerRequest: async () => {
      calls.provider++
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'Provider explanation grounded in approved content.' } }] })) }
    },
  }
  return { calls, value }
}

test('zero approved references return explicit not-found guidance without provider or credential access', async () => {
  const fixture = dependencies([])
  const result = await answerGroundedChat(event('10'), settings, [{ role: 'user', content: 'Hãy tự tư vấn pháp lý cho tôi' }], fixture.value)
  assert.equal(result.kind, 'not_found')
  assert.deepEqual(result.sources, [])
  assert.match(result.answer, new RegExp(HOTLINE.replaceAll('.', '\\.')))
  assert.doesNotMatch(result.answer, /điều \d+|bạn phải|provider explanation/iu)
  assert.deepEqual(fixture.calls, { loading: 1, retrieval: 1, provider: 0, secret: 0 })
})

test('exact and keyword references remain provider-grounded when configured', async () => {
  for (const [id, query, rows] of [
    ['11', 'Thủ tục tái hòa nhập', [entry()]],
    ['12', 'Tôi cần thủ tục', [entry({ canonicalQuestion: 'Thông tin khác', normalizedQuestion: 'thông tin khác', terms: [{ kind: 'keyword', value: 'thủ tục', normalizedValue: 'thủ tục' }] as any })]],
  ] as const) {
    const fixture = dependencies([...rows])
    const result = await answerGroundedChat(event(id), settings, [{ role: 'user', content: query }], fixture.value)
    assert.equal(result.kind, 'provider')
    assert.equal(result.answer, 'Provider explanation grounded in approved content.')
    assert.equal(result.sources[0]?.answer, 'Nội dung pháp luật đã được phê duyệt.')
    assert.deepEqual(fixture.calls, { loading: 1, retrieval: 1, provider: 1, secret: 1 })
  }
})

test('retrieval source projection rejects credential-bearing HTTPS URLs', () => {
  for (const sourceUrl of ['https://user@example.gov.vn/source', 'https://user:password@example.gov.vn/source']) {
    const result = retrieveKnowledge([entry({ sourceUrl })], 'Thủ tục tái hòa nhập')
    assert.equal(result[0]?.source?.url, null)
    assert.doesNotMatch(JSON.stringify(result), /user|password/)
  }
})

test('provider failure falls back to the approved curated answer and source', async () => {
  const fixture = dependencies([entry()])
  fixture.value.providerRequest = async () => { fixture.calls.provider++; throw new Error('upstream detail') }
  const result = await answerGroundedChat(event('13'), settings, [{ role: 'user', content: 'Thủ tục tái hòa nhập' }], fixture.value)
  assert.equal(result.kind, 'curated')
  assert.equal(result.answer, 'Nội dung pháp luật đã được phê duyệt.')
  assert.equal(result.sources[0]?.source?.reference, 'VB-01')
  assert.deepEqual(fixture.calls, { loading: 1, retrieval: 1, provider: 1, secret: 1 })
})

test('oversized and rate-limited requests perform no retrieval or provider work', async () => {
  const oversized = dependencies([entry()])
  await assert.rejects(
    answerGroundedChat(event('14'), settings, [{ role: 'user', content: 'x'.repeat(64_001) }], oversized.value),
    error => error instanceof Error && error.message === 'REQUEST_TOO_LARGE',
  )
  assert.deepEqual(oversized.calls, { loading: 0, retrieval: 0, provider: 0, secret: 0 })

  const limitedSettings = { ...settings, rateLimitRequests: 1 } as ChatbotSettings
  const first = dependencies([entry()])
  await answerGroundedChat(event('15'), limitedSettings, [{ role: 'user', content: 'Thủ tục tái hòa nhập' }], first.value)
  const second = dependencies([entry()])
  const result = await answerGroundedChat(event('15'), limitedSettings, [{ role: 'user', content: 'Thủ tục tái hòa nhập' }], second.value)
  assert.equal(result.kind, 'rate_limited')
  assert.deepEqual(second.calls, { loading: 0, retrieval: 0, provider: 0, secret: 0 })
})

test('forged forwarding and client IP headers cannot rotate a socket peer rate-limit bucket', async () => {
  const limitedSettings = { ...settings, rateLimitRequests: 1 } as ChatbotSettings
  const first = dependencies([entry()])
  await answerGroundedChat(event('16', {
    'x-forwarded-for': '203.0.113.10',
    'x-real-ip': '203.0.113.11',
    'forwarded': 'for=203.0.113.12',
    'cf-connecting-ip': '203.0.113.13',
    'true-client-ip': '203.0.113.14',
  }), limitedSettings, [{ role: 'user', content: 'Thủ tục tái hòa nhập' }], first.value)

  const second = dependencies([entry()])
  const result = await answerGroundedChat(event('16', {
    'x-forwarded-for': '192.0.2.20, 192.0.2.21',
    'x-real-ip': '192.0.2.22',
    'forwarded': 'for=192.0.2.23',
    'cf-connecting-ip': '192.0.2.24',
    'true-client-ip': '192.0.2.25',
  }), limitedSettings, [{ role: 'user', content: 'Thủ tục tái hòa nhập' }], second.value)

  assert.equal(result.kind, 'rate_limited')
  assert.deepEqual(second.calls, { loading: 0, retrieval: 0, provider: 0, secret: 0 })
})

test('distinct socket peers have distinct rate-limit buckets', async () => {
  const limitedSettings = { ...settings, rateLimitRequests: 1 } as ChatbotSettings
  const first = dependencies([entry()])
  const second = dependencies([entry()])

  assert.equal((await answerGroundedChat(event('17'), limitedSettings, [{ role: 'user', content: 'Thủ tục tái hòa nhập' }], first.value)).kind, 'provider')
  assert.equal((await answerGroundedChat(event('18'), limitedSettings, [{ role: 'user', content: 'Thủ tục tái hòa nhập' }], second.value)).kind, 'provider')
  assert.deepEqual(second.calls, { loading: 1, retrieval: 1, provider: 1, secret: 1 })
})

test('missing socket identity uses one fail-closed anonymous bucket regardless of headers', async () => {
  const limitedSettings = { ...settings, rateLimitRequests: 1 } as ChatbotSettings
  const first = dependencies([entry()])
  await answerGroundedChat(anonymousEvent({ 'x-forwarded-for': '203.0.113.30', 'user-agent': 'first' }), limitedSettings, [{ role: 'user', content: 'Thủ tục tái hòa nhập' }], first.value)

  const second = dependencies([entry()])
  const result = await answerGroundedChat(anonymousEvent({ 'x-real-ip': '192.0.2.31', 'user-agent': 'rotated' }), limitedSettings, [{ role: 'user', content: 'Thủ tục tái hòa nhập' }], second.value)

  assert.equal(result.kind, 'rate_limited')
  assert.deepEqual(second.calls, { loading: 0, retrieval: 0, provider: 0, secret: 0 })
})
