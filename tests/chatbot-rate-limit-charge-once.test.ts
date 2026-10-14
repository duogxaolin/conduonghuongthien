import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import type { ChatbotSettings } from '../server/db/schema'

/**
 * The chat endpoints now charge the address rate limit before moderation and then
 * call `answerGroundedChat`, which charges it too for its other callers. The
 * decision is memoised on the event, so one request is one hit: an admin who
 * configured "N requests a minute" still gets N, not N/2.
 */

const memory = new Map<string, { count: number, expiresAt: number }>()
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({ execute: null, memory }) } })

const { answerGroundedChat, chargeChatRateLimit } = await import('../server/utils/chatbot/chat-policy')
type ChatEvent = Parameters<typeof chargeChatRateLimit>[0]

const settings = {
  enabled: true,
  mode: 'knowledge',
  baseUrl: 'https://api.provider.example/v1',
  model: 'safe-model',
  systemPrompt: 'x',
  allowedHosts: ['api.provider.example'],
  requestTimeoutMs: 1_000,
  maxResponseBytes: 16_384,
  maxInputChars: 2_000,
  maxHistoryMessages: 8,
  retrievalTopK: 3,
  referenceCharBudget: 6_000,
  rateLimitRequests: 3,
  rateLimitWindowSeconds: 60,
} as ChatbotSettings

const dependencies = {
  loadPublishedEntries: async () => [],
  loadSmallTalkEntries: async () => [],
  configuredSecret: () => null,
  providerRequest: async () => { throw new Error('no provider in this test') },
}

function event(address: string): ChatEvent {
  return { node: { req: { headers: {}, socket: { remoteAddress: address } } }, context: {} } as unknown as ChatEvent
}

const ASK = [{ role: 'user', content: 'thủ tục' }]

test('endpoint charge + answerGroundedChat count one request once', async () => {
  memory.clear()
  for (let i = 0; i < settings.rateLimitRequests; i++) {
    const e = event('203.0.113.70')
    assert.equal(await chargeChatRateLimit(e, settings), null, `request ${i + 1} is inside the limit`)
    const result = await answerGroundedChat(e, settings, ASK, dependencies)
    assert.notEqual(result.kind, 'rate_limited', `request ${i + 1} was refused — it was charged twice`)
  }
  const over = event('203.0.113.70')
  const retryAfter = await chargeChatRateLimit(over, settings)
  assert.ok(retryAfter && retryAfter > 0, 'the request after the limit is refused')
  const result = await answerGroundedChat(over, settings, ASK, dependencies)
  assert.equal(result.kind, 'rate_limited', 'and answerGroundedChat honours the same decision')
})

test('the decision is memoised per request: repeated checks do not add hits', async () => {
  memory.clear()
  const e = event('203.0.113.71')
  for (let i = 0; i < 10; i++) assert.equal(await chargeChatRateLimit(e, settings), null)
  // Two more distinct requests still fit (3 allowed in total).
  assert.equal(await chargeChatRateLimit(event('203.0.113.71'), settings), null)
  assert.equal(await chargeChatRateLimit(event('203.0.113.71'), settings), null)
  assert.ok(await chargeChatRateLimit(event('203.0.113.71'), settings))
})

test('answerGroundedChat alone (other callers) is still rate limited', async () => {
  memory.clear()
  let lastKind = ''
  for (let i = 0; i <= settings.rateLimitRequests; i++) {
    lastKind = (await answerGroundedChat(event('203.0.113.72'), settings, ASK, dependencies)).kind
  }
  assert.equal(lastKind, 'rate_limited')
})
