import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatbotSettings } from '../server/db/schema'
import { answerGroundedChat, type ChatDependencies, type ChatEvent } from '../server/utils/chatbot/chat-policy'
import type { RetrievalEntry } from '../server/utils/chatbot/retrieval'
import type { SmallTalkEntry } from '../server/utils/chatbot/small-talk'

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
  { id: 1, category: 'social', answer: 'Xin chào anh/chị!', patterns: ['xin chao', 'chao ban', 'chao'], normalizedQuestion: 'xin chào', isEnabled: true, displayOrder: 0 },
  { id: 2, category: 'identity', answer: 'Tôi là trợ lý ảo.', patterns: ['ban la ai'], normalizedQuestion: 'bạn là ai', isEnabled: true, displayOrder: 1 },
]

let peer = 0
function event(): ChatEvent {
  peer += 1
  return { node: { req: { headers: {}, socket: { remoteAddress: `203.0.113.${peer % 250}` } } }, context: {} } as ChatEvent
}

type Harness = { dependencies: ChatDependencies; state: { calls: number; smallTalkLoads: number } }

function deps(overrides: Partial<ChatDependencies> = {}): Harness {
  const state = { calls: 0, smallTalkLoads: 0 }
  const dependencies: ChatDependencies = {
    loadPublishedEntries: async () => [entry()],
    loadSmallTalkEntries: async () => { state.smallTalkLoads += 1; return SMALL_TALK },
    configuredSecret: () => 'secret-key',
    providerRequest: async () => {
      state.calls += 1
      return { status: 200, body: Buffer.from(JSON.stringify({ choices: [{ message: { content: 'Câu trả lời từ AI.' } }] })) } as any
    },
    ...overrides,
  }
  return { dependencies, state }
}

const ask = (text: string) => [{ role: 'user', content: text }]

test('the approved bank wins: a matching business question is never routed to small talk', async () => {
  const { dependencies, state } = deps()
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('thủ tục xóa án tích'), dependencies)
  assert.equal(result.kind, 'curated')
  assert.equal(state.smallTalkLoads, 0, 'small talk must not load when references are non-empty')
})

test('knowledge mode: a greeting is answered from small talk (kind=small_talk, no contact prompt)', async () => {
  const { dependencies } = deps({ loadPublishedEntries: async () => [] })
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('xin chào'), dependencies)
  assert.equal(result.kind, 'small_talk')
  assert.equal(result.askContact ?? false, false)
  assert.match(result.answer, /Xin chào/)
})

test('ai mode: a greeting is answered locally, no provider call is spent', async () => {
  const { dependencies, state } = deps({ loadPublishedEntries: async () => [] })
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'ai', outOfScopeBehavior: 'ai_freeform' }), ask('xin chào'), dependencies)
  assert.equal(result.kind, 'small_talk')
  assert.equal(state.calls, 0, 'provider must not be called for a greeting')
})

test('switch off: a greeting returns not_found + askContact and the store is never queried', async () => {
  const { dependencies, state } = deps({ loadPublishedEntries: async () => [] })
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge', smallTalkEnabled: false }), ask('xin chào'), dependencies)
  assert.equal(result.kind, 'not_found')
  assert.equal(result.askContact, true)
  assert.equal(state.smallTalkLoads, 0, 'a disabled store must not be loaded')
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
