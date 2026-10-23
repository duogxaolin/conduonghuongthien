import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Both public chat endpoints ran the instant moderation check BEFORE any rate
 * limit, and every message it blocks writes an `ai_moderation_queue` row (plus a
 * chat turn on /api/public/chatbot when a session is attached). An anonymous script
 * repeating one profane line therefore wrote rows without bound. The address limit
 * now runs first; these drive the real handlers and record the order of calls.
 */

const order: string[] = []
const recorded = { persist: 0, answer: 0 }
let allowedRequests = 3
let charged = 0

mock.module('h3', {
  namedExports: {
    setHeader: (event: { headers: Record<string, string> }, name: string, value: string) => { event.headers[name] = value },
    getRequestHeader: (event: { reqHeaders: Record<string, string> }, name: string) => event.reqHeaders[name],
    createError: (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
  },
})
mock.module('../server/services/chatbot-settings', { namedExports: { getChatbotSettings: async () => ({}) } })
mock.module('../server/utils/chatbot/chat', {
  namedExports: {
    answerChat: async () => { order.push('answer'); recorded.answer += 1; return { answer: 'Trả lời.', kind: 'curated', sources: [], retryAfter: null, askContact: false } },
  },
})
mock.module('../server/utils/chatbot/chat-policy', {
  namedExports: {
    // Trần độ dài ở cửa vào (`utils/chatbot/input-length.ts`) đọc hằng này.
    CHAT_LIMITS: Object.freeze({ maxBodyBytes: 64_000, maxMessageChars: 10_000, maxOutputChars: 8_000 }),
    validateChatRequestBody: () => {},
    chargeChatRateLimit: async () => {
      order.push('rate-limit')
      charged += 1
      return charged > allowedRequests ? 42 : null
    },
    CHAT_RATE_LIMITED_MESSAGE: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
  },
})
mock.module('../server/utils/chatbot/session-token', { namedExports: { verifySessionToken: () => 'session-abc' } })
mock.module('../server/utils/chatbot/session-db', { namedExports: { persistChatTurn: async () => { order.push('persist'); recorded.persist += 1 } } })
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '203.0.113.9' } })
mock.module('../server/utils/runtime-config', { namedExports: { analyticsHmacSecret: () => 'secret' } })
const moderationContexts: Array<Record<string, unknown>> = []
mock.module('../server/services/moderation-worker', {
  namedExports: {
    // Every message is "profane": the worst case for the review queue.
    fastPreModerate: async (_text: string, context: Record<string, unknown>) => {
      order.push('moderation')
      moderationContexts.push(context)
      return { blocked: true }
    },
    checkAndModerateContent: async () => ({ blocked: false }),
    // Earlier history turns are checked without filing a review row (chat-turns.ts).
    matchInstantRule: async () => null,
  },
})

type Event = { body: unknown, headers: Record<string, string>, reqHeaders: Record<string, string>, context: Record<string, unknown>, node?: undefined }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body

const publicHandler = (await import('../server/api/public/chatbot/index.post')).default as unknown as (event: Event) => Promise<string>
const legacyHandler = (await import('../server/api/chat.post')).default as unknown as (event: Event) => Promise<string>

const event = (body: unknown): Event => ({ body, headers: {}, reqHeaders: { 'x-chat-session': 'token' }, context: {} })
const PROFANE = { messages: [{ role: 'user', content: 'đm' }] }

function reset(limit: number) {
  order.length = 0
  moderationContexts.length = 0
  recorded.persist = 0
  recorded.answer = 0
  charged = 0
  allowedRequests = limit
}

function envelope(text: string) {
  const line = text.split('\n').find(entry => entry.startsWith('data: ') && entry !== 'data: [DONE]')!
  return JSON.parse(line.slice(6)) as { choices: Array<{ delta: { content: string } }>, chatbot: { kind: string, retryAfter: number | null } }
}

for (const [name, handler] of [['/api/public/chatbot', publicHandler], ['/api/chat', legacyHandler]] as const) {
  test(`${name}: the rate limit is charged before moderation runs`, async () => {
    reset(5)
    await handler(event(PROFANE))
    assert.deepEqual(order.slice(0, 2), ['rate-limit', 'moderation'])
    assert.equal(moderationContexts[0]!.capQueuePerSource, true, 'the review-queue cap is requested for this anonymous flow')
  })

  test(`${name}: a flood of blocked messages stops reaching moderation (and the queue) at the limit`, async () => {
    reset(3)
    const replies: string[] = []
    for (let i = 0; i < 50; i++) replies.push(await handler(event(PROFANE)))
    assert.equal(order.filter(step => step === 'moderation').length, 3, 'only the allowed requests are moderated')
    assert.equal(order.filter(step => step === 'rate-limit').length, 50)
    const last = envelope(replies.at(-1)!)
    assert.equal(last.chatbot.kind, 'rate_limited')
    assert.equal(last.chatbot.retryAfter, 42)
    assert.match(last.choices[0]!.delta.content, /quá nhiều yêu cầu/)
    assert.equal(recorded.answer, 0)
    if (name === '/api/public/chatbot') {
      assert.equal(recorded.persist, 3, 'a chat turn is stored only for the requests inside the limit')
    }
  })
}

test('/api/public/chatbot: a rate-limited request stores nothing and never answers', async () => {
  reset(0)
  const reply = await publicHandler(event({ messages: [{ role: 'user', content: 'xin chào' }] }))
  assert.deepEqual(order, ['rate-limit'])
  assert.equal(envelope(reply).chatbot.kind, 'rate_limited')
})
