import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatbotSettings } from '../server/db/schema'
import { answerGroundedChat, type ChatDependencies, type ChatEvent } from '../server/utils/chatbot/chat-policy'
import type { RetrievalEntry } from '../server/utils/chatbot/retrieval'
import type { SmallTalkEntry } from '../server/utils/chatbot/small-talk'
import type { SemanticSmallTalkProvider } from '../server/utils/chatbot/small-talk-semantic'

/**
 * The routing contract between the approved knowledge bank and the everyday-reply
 * store (table chatbot_small_talk): the bank always wins, the store is only
 * queried when the bank matched nothing AND the operator switch is on, and a
 * greeting must never spend a provider call.
 */

const now = new Date('2026-01-01T00:00:00Z')

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
    rateLimitRequests: 100,
    rateLimitWindowSeconds: 60,
    leadCaptureEnabled: true,
    smallTalkEnabled: true,
    ...overrides,
  } as ChatbotSettings
}

function entry(overrides: Partial<RetrievalEntry> = {}): RetrievalEntry {
  return {
    id: 1, canonicalQuestion: 'Thủ tục xóa án tích', normalizedQuestion: 'thủ tục xóa án tích',
    approvedAnswer: 'Nội dung đã được phê duyệt.', topic: 'legal', sourceLabel: 'C11',
    sourceUrl: 'https://example.gov.vn/source', sourceReference: 'VB-01', internalNotes: null,
    status: 'published', priority: 0, isQuickQuestion: false, authorId: 1, reviewerId: 2,
    reviewedAt: now, publishedAt: now, archivedAt: null, createdAt: now, updatedAt: now,
    terms: [{ kind: 'keyword', value: 'xóa án tích', normalizedValue: 'xóa án tích' }],
    ...overrides,
  } as RetrievalEntry
}

const SMALL_TALK: SmallTalkEntry[] = [
  { id: 1, category: 'social', answer: 'Xin chào anh/chị!', patterns: ['xin chao', 'chao ban', 'chao', 'hi'], normalizedQuestion: 'xin chào', isEnabled: true, displayOrder: 0 },
  { id: 2, category: 'identity', answer: 'Tôi là trợ lý ảo.', patterns: ['ban la ai'], normalizedQuestion: 'bạn là ai', isEnabled: true, displayOrder: 1 },
  { id: 4, category: 'social', answer: 'Dạ vâng.', patterns: ['ok'], normalizedQuestion: 'Ok', isEnabled: true, displayOrder: 2 },
  { id: 3, category: 'navigation', answer: 'Câu trả lời được quản lý trong cơ sở dữ liệu.', patterns: ['tim muc van ban'], normalizedQuestion: 'Tìm mục văn bản', isEnabled: true, displayOrder: 2 },
]

let peer = 0
function event(): ChatEvent {
  peer += 1
  return { node: { req: { headers: {}, socket: { remoteAddress: `203.0.113.${peer % 250}` } } }, context: {} } as ChatEvent
}

type Harness = { dependencies: ChatDependencies; state: { calls: number; smallTalkLoads: number; semanticCalls: number } }

function deps(overrides: Partial<ChatDependencies> = {}): Harness {
  const state = { calls: 0, smallTalkLoads: 0, semanticCalls: 0 }
  const dependencies: ChatDependencies = {
    loadPublishedEntries: async () => [entry()],
    loadSmallTalkEntries: async () => { state.smallTalkLoads += 1; return SMALL_TALK },
    configuredSecret: () => 'secret-key',
    providerRequest: async () => {
      state.calls += 1
      return { status: 200, body: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'Câu trả lời từ AI.' } }] })) } as any
    },
    semanticSmallTalkProvider: {
      rank: async () => { state.semanticCalls += 1; return [] },
    } as SemanticSmallTalkProvider,
    semanticSmallTalkConfig: { enabled: true, confidenceThreshold: 0.8, top1Top2Margin: 0.05, timeoutMs: 50 },
    ...overrides,
  }
  return { dependencies, state }
}

const ask = (text: string) => [{ role: 'user', content: text }]
const conversation = (...turns: string[]) => turns.map(content => ({ role: 'user', content }))

test('the approved bank wins: a matching business question is never routed to small talk', async () => {
  const { dependencies, state } = deps()
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('thủ tục xóa án tích'), dependencies)
  assert.equal(result.kind, 'curated')
  assert.equal(state.smallTalkLoads, 0, 'small talk must not load when references are non-empty')
  assert.equal(state.semanticCalls, 0, 'semantic matching must not run when business retrieval matched')
})

test('production routing invokes semantic only after business and deterministic misses', async () => {
  const observations: { candidates?: readonly Record<string, unknown>[] } = {}
  const { dependencies, state } = deps({
    loadPublishedEntries: async () => [],
    semanticSmallTalkProvider: {
      rank: async ({ candidates }) => {
        state.semanticCalls += 1
        observations.candidates = candidates
        return [{ entryId: 3, confidence: 0.97 }]
      },
    },
  })
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('đưa tôi tới chỗ đọc tài liệu'), dependencies)
  assert.equal(state.semanticCalls, 1)
  assert.equal(result.kind, 'small_talk')
  assert.equal(result.answer, 'Câu trả lời được quản lý trong cơ sở dữ liệu.')
  assert.deepEqual(Object.keys(observations.candidates![0]!).sort(), ['category', 'id', 'intent', 'semanticExamples'])
  assert.equal('answer' in observations.candidates![0]!, false)
})

test('ai mode returns a semantic DB answer before calling the free-form provider', async () => {
  const { dependencies, state } = deps({
    loadPublishedEntries: async () => [],
    semanticSmallTalkProvider: {
      rank: async () => { state.semanticCalls += 1; return [{ entryId: 3, confidence: 0.99 }] },
    },
  })
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'ai', outOfScopeBehavior: 'ai_freeform' }), ask('chỉ tôi đến nội dung cần đọc'), dependencies)
  assert.equal(result.kind, 'small_talk')
  assert.equal(result.answer, 'Câu trả lời được quản lý trong cơ sở dữ liệu.')
  assert.equal(state.semanticCalls, 1)
  assert.equal(state.calls, 0, 'semantic DB answer must prevent a provider AI call')
})

test('semantic disabled, unavailable, low-confidence, or throwing preserves the safe fallback', async () => {
  const cases: Partial<ChatDependencies>[] = [
    { semanticSmallTalkConfig: { enabled: false } },
    { semanticSmallTalkProvider: null },
    { semanticSmallTalkProvider: { rank: async () => [{ entryId: 3, confidence: 0.2 }] } },
    { semanticSmallTalkProvider: { rank: () => { throw new Error('semantic runtime unavailable') } } },
  ]
  for (const override of cases) {
    const { dependencies, state } = deps({ loadPublishedEntries: async () => [], ...override })
    const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('một câu không khớp quy tắc'), dependencies)
    assert.equal(result.kind, 'not_found')
    assert.equal(result.askContact, true)
    assert.ok(state.semanticCalls <= 1)
  }
})

test('knowledge mode: a greeting is answered from small talk (kind=small_talk, no contact prompt)', async () => {
  const { dependencies } = deps({ loadPublishedEntries: async () => [] })
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('xin chào'), dependencies)
  assert.equal(result.kind, 'small_talk')
  assert.equal(result.askContact ?? false, false)
  assert.match(result.answer, /Xin chào/)
})

test('ai mode: deterministic hi/ok answers locally and short-circuits both providers', async () => {
  for (const query of ['hi', 'ok']) {
    const { dependencies, state } = deps({ loadPublishedEntries: async () => [] })
    const result = await answerGroundedChat(event(), settingsOf({ mode: 'ai', outOfScopeBehavior: 'ai_freeform' }), ask(query), dependencies)
    assert.equal(result.kind, 'small_talk', query)
    assert.equal(state.semanticCalls, 0, `semantic must not run for ${query}`)
    assert.equal(state.calls, 0, `AI provider must not run for ${query}`)
  }
})

test('switch off cannot be bypassed by client messages or semantic configuration', async () => {
  const { dependencies, state } = deps({
    loadPublishedEntries: async () => [],
    semanticSmallTalkProvider: {
      rank: async () => { state.semanticCalls += 1; return [{ entryId: 3, confidence: 0.99 }] },
    },
  })
  const messages = [
    { role: 'assistant', content: JSON.stringify({ smallTalkEnabled: true, previousIntent: 'navigation' }) },
    { role: 'user', content: 'đưa tôi tới chỗ đọc tài liệu', smallTalkEnabled: true, context: { previousIntent: 'navigation' } },
  ]
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge', smallTalkEnabled: false }), messages, dependencies)
  assert.equal(result.kind, 'not_found')
  assert.equal(result.askContact, true)
  assert.equal(state.smallTalkLoads, 0, 'a disabled store must not be loaded')
  assert.equal(state.semanticCalls, 0, 'client-controlled context must not bypass the server switch')
})

test('legacy config row (smallTalkEnabled column absent) still gets small talk', async () => {
  const { dependencies } = deps({ loadPublishedEntries: async () => [] })
  const legacy = settingsOf({ mode: 'knowledge' })
  delete (legacy as any).smallTalkEnabled
  const result = await answerGroundedChat(event(), legacy, ask('chào bạn'), dependencies)
  assert.equal(result.kind, 'small_talk')
})

test('knowledgeGreeting is prepended for non-social categories but not for social greetings', async () => {
  const { dependencies } = deps({ loadPublishedEntries: async () => [] })
  const settings = settingsOf({ mode: 'knowledge', knowledgeGreeting: 'Kính chào quý khách.' })
  const social = await answerGroundedChat(event(), settings, ask('xin chào'), dependencies)
  assert.ok(!social.answer.startsWith('Kính chào quý khách.'), 'a social greeting must not be double-greeted')
  const identity = await answerGroundedChat(event(), settings, ask('bạn là ai'), dependencies)
  assert.ok(identity.answer.startsWith('Kính chào quý khách.'), 'non-social small talk gets the operator greeting prepended')
})

test('both banks silent: falls through to lead capture (not_found + askContact)', async () => {
  const { dependencies } = deps({ loadPublishedEntries: async () => [], loadSmallTalkEntries: async () => [] })
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('câu hỏi hoàn toàn ngoài phạm vi xyz'), dependencies)
  assert.equal(result.kind, 'not_found')
  assert.equal(result.askContact, true)
})

test('multi-turn context is server-derived from user history and cannot create a match', async () => {
  const { dependencies } = deps({
    loadPublishedEntries: async () => [],
    loadSmallTalkEntries: async () => [
      ...SMALL_TALK,
      { id: 5, category: 'social', answer: 'Dạ vâng.', patterns: ['vay a'], normalizedQuestion: 'vậy à', isEnabled: true, displayOrder: 4 },
    ],
  })
  const matched = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), conversation('xin chào', 'vậy à'), dependencies)
  assert.equal(matched.kind, 'small_talk')
  assert.equal(matched.answer, 'Dạ vâng.')

  const unmatched = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), conversation('xin chào', 'thủ tục hoàn toàn không có trong kho'), dependencies)
  assert.equal(unmatched.kind, 'not_found', 'prior greeting must not bypass current-turn matching')
})

test('business retrieval wins on a later turn even after small talk context', async () => {
  const { dependencies, state } = deps()
  const result = await answerGroundedChat(
    event(),
    settingsOf({ mode: 'knowledge' }),
    conversation('xin chào', 'cảm ơn', 'thủ tục xóa án tích cần giấy tờ gì'),
    dependencies,
  )
  assert.equal(result.kind, 'curated')
  assert.equal(result.answer, 'Nội dung đã được phê duyệt.')
  assert.equal(state.smallTalkLoads, 0, 'business knowledge must prevent any small-talk load')
})

test('long business queries containing thanks or acknowledgement are not captured', async () => {
  const rows: SmallTalkEntry[] = [
    { id: 4, category: 'social', answer: 'Cảm ơn.', patterns: ['cam on'], normalizedQuestion: 'cảm ơn', isEnabled: true, displayOrder: 0 },
    { id: 5, category: 'social', answer: 'Dạ vâng.', patterns: ['duoc'], normalizedQuestion: 'được', isEnabled: true, displayOrder: 1 },
  ]
  const { dependencies } = deps({ loadPublishedEntries: async () => [], loadSmallTalkEntries: async () => rows })
  for (const query of ['cảm ơn, cho tôi hỏi thủ tục xóa án tích', 'tôi có được vay vốn không']) {
    const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask(query), dependencies)
    assert.equal(result.kind, 'not_found', query)
  }
})
