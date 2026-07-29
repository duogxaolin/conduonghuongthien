import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatbotSettings } from '../server/db/schema'
import { answerGroundedChat, type ChatDependencies, type ChatEvent } from '../server/utils/chatbot/chat-policy'
import type { RetrievalEntry } from '../server/utils/chatbot/retrieval'

/**
 * The assistant has two operator-selected answering modes:
 *   • 'knowledge' — answer only from the approved knowledge bank, never call AI;
 *   • 'ai'        — call the provider, grounded in the same approved bank.
 * When neither mode can answer, the visitor is invited to leave contact details
 * (lead capture) so staff can follow up.
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
    ...overrides,
  } as ChatbotSettings
}

function entry(overrides: Partial<RetrievalEntry> = {}): RetrievalEntry {
  return {
    id: 1,
    canonicalQuestion: 'Thủ tục xóa án tích',
    normalizedQuestion: 'thủ tục xóa án tích',
    approvedAnswer: 'Nội dung đã được phê duyệt.',
    topic: 'legal',
    sourceLabel: 'C11',
    sourceUrl: 'https://example.gov.vn/source',
    sourceReference: 'VB-01',
    internalNotes: 'GHI-CHU-NOI-BO',
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
  } as RetrievalEntry
}

let peer = 0
function event(): ChatEvent {
  peer += 1
  return { node: { req: { headers: {}, socket: { remoteAddress: `203.0.113.${peer % 250}` } } }, context: {} } as ChatEvent
}

type Harness = { dependencies: ChatDependencies; state: { calls: number } }

function deps(overrides: Partial<ChatDependencies> = {}): Harness {
  const state = { calls: 0 }
  const dependencies: ChatDependencies = {
    loadPublishedEntries: async () => [entry()],
    loadSmallTalkEntries: async () => [],
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

test('knowledge mode answers from the approved bank and never calls the provider', async () => {
  const { dependencies, state } = deps()
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('xóa án tích'), dependencies)
  assert.equal(result.kind, 'curated')
  assert.equal(result.answer, 'Nội dung đã được phê duyệt.')
  assert.equal(state.calls, 0, 'provider must not be contacted in knowledge mode')
})

test('knowledge mode prefixes the configured friendly greeting', async () => {
  const result = await answerGroundedChat(
    event(),
    settingsOf({ mode: 'knowledge', knowledgeGreeting: 'Dạ, em xin phép trả lời ạ.' }),
    ask('xóa án tích'),
    deps().dependencies,
  )
  assert.ok(result.answer.startsWith('Dạ, em xin phép trả lời ạ.'), result.answer)
  assert.ok(result.answer.includes('Nội dung đã được phê duyệt.'))
})

test('ai mode returns a provider answer grounded in the approved bank', async () => {
  const { dependencies, state } = deps()
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'ai' }), ask('xóa án tích'), dependencies)
  assert.equal(result.kind, 'provider')
  assert.equal(result.answer, 'Câu trả lời từ AI.')
  assert.equal(state.calls, 1)
})

test('an absent mode keeps the historical provider behaviour (upgrade safety)', async () => {
  const { dependencies, state } = deps()
  const result = await answerGroundedChat(event(), settingsOf(), ask('xóa án tích'), dependencies)
  assert.equal(result.kind, 'provider', 'existing deployments must not silently lose AI on upgrade')
  assert.equal(state.calls, 1)
})

test('ai mode degrades to the curated answer when the provider fails', async () => {
  const { dependencies } = deps({ providerRequest: async () => { throw new Error('network down') } })
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'ai' }), ask('xóa án tích'), dependencies)
  assert.equal(result.kind, 'curated')
  assert.equal(result.answer, 'Nội dung đã được phê duyệt.')
})

test('no match invites the visitor to leave contact details when lead capture is on', async () => {
  const { dependencies, state } = deps({ loadPublishedEntries: async () => [] })
  for (const mode of ['knowledge', 'ai'] as const) {
    const result = await answerGroundedChat(event(), settingsOf({ mode, leadCaptureEnabled: true }), ask('câu hỏi lạ'), dependencies)
    assert.equal(result.kind, 'not_found', mode)
    assert.equal(result.askContact, true, `${mode} should offer lead capture`)
    assert.equal(state.calls, 0, `${mode} must not call the provider without grounding`)
  }
})

test('no match falls back to the hotline when lead capture is off', async () => {
  const result = await answerGroundedChat(
    event(),
    settingsOf({ mode: 'knowledge', leadCaptureEnabled: false }),
    ask('câu hỏi lạ'),
    deps({ loadPublishedEntries: async () => [] }).dependencies,
  )
  assert.equal(result.kind, 'not_found')
  assert.ok(!result.askContact)
  assert.ok(result.answer.includes('0903.480.985'), result.answer)
})

test('the configured fallback message replaces the default wording', async () => {
  const result = await answerGroundedChat(
    event(),
    settingsOf({ mode: 'knowledge', fallbackMessage: 'Nội dung này chưa có trong kho ạ.' }),
    ask('câu hỏi lạ'),
    deps({ loadPublishedEntries: async () => [] }).dependencies,
  )
  assert.ok(result.answer.startsWith('Nội dung này chưa có trong kho ạ.'), result.answer)
})

test('out-of-scope questions reach the provider only when the operator opted in', async () => {
  const blocked = deps({ loadPublishedEntries: async () => [] })
  const blockedResult = await answerGroundedChat(
    event(), settingsOf({ mode: 'ai', outOfScopeBehavior: 'knowledge_only' }), ask('câu hỏi lạ'), blocked.dependencies,
  )
  assert.equal(blockedResult.kind, 'not_found')
  assert.equal(blocked.state.calls, 0)

  const allowed = deps({ loadPublishedEntries: async () => [] })
  const allowedResult = await answerGroundedChat(
    event(), settingsOf({ mode: 'ai', outOfScopeBehavior: 'ai_freeform' }), ask('câu hỏi lạ'), allowed.dependencies,
  )
  assert.equal(allowedResult.kind, 'provider')
  assert.equal(allowed.state.calls, 1)
})

test('internal notes never leak into an answer or its sources', async () => {
  const result = await answerGroundedChat(event(), settingsOf({ mode: 'knowledge' }), ask('xóa án tích'), deps().dependencies)
  assert.ok(!JSON.stringify(result).includes('GHI-CHU-NOI-BO'))
})
