import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * The chat widget ships a field `_h` that a real browser never fills (it is hidden
 * and out of the tab order); a script that fills every field it finds gives itself
 * away. The server must answer such a request with a normal-looking 200 — a 400
 * would tell the script which field exposed it — and must do so BEFORE it spends
 * anything: no moderation call, no AI call, no quota. `tests/chatbot-live-sessions`
 * greps for the pieces; this runs the handler.
 */

const calls = { answer: 0, moderation: 0, persist: 0, rateLimit: 0 }

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
    answerChat: async () => { calls.answer += 1; return { answer: 'Một câu trả lời thật.', kind: 'curated', sources: [], retryAfter: null, askContact: false } },
  },
})
mock.module('../server/utils/chatbot/chat-policy', {
  namedExports: {
    // Read by the entry-point length cap (`utils/chatbot/input-length.ts`).
    CHAT_LIMITS: Object.freeze({ maxBodyBytes: 64_000, maxMessageChars: 10_000, maxOutputChars: 8_000 }),
    validateChatRequestBody: () => {},
    // The address rate limit now runs before moderation (see
    // chatbot-rate-limit-before-moderation.test.ts); here it always allows.
    chargeChatRateLimit: async () => { calls.rateLimit += 1; return null },
    CHAT_RATE_LIMITED_MESSAGE: 'quá nhiều yêu cầu',
  },
})
mock.module('../server/utils/chatbot/session-token', { namedExports: { verifySessionToken: () => null } })
mock.module('../server/utils/chatbot/session-db', { namedExports: { persistChatTurn: async () => { calls.persist += 1 } } })
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '203.0.113.9' } })
mock.module('../server/utils/runtime-config', { namedExports: { analyticsHmacSecret: () => 'secret' } })
mock.module('../server/services/moderation-worker', {
  namedExports: {
    fastPreModerate: async () => { calls.moderation += 1; return { blocked: false } },
    checkAndModerateContent: async () => ({ blocked: false }),
    // Earlier history turns are checked without filing a review row (chat-turns.ts).
    matchInstantRule: async () => null,
  },
})

type Event = { body: unknown, headers: Record<string, string>, reqHeaders: Record<string, string>, context: Record<string, unknown>, node?: undefined }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body

const handler = (await import('../server/api/public/chatbot/index.post')).default as unknown as (event: Event) => Promise<string>

const event = (body: unknown): Event => ({ body, headers: {}, reqHeaders: {}, context: {} })
const ASK = [{ role: 'user', content: 'có hỗ trợ vay vốn không?' }]

function parseEnvelope(text: string) {
  const line = text.split('\n').find(entry => entry.startsWith('data: ') && entry !== 'data: [DONE]')!
  return JSON.parse(line.slice(6)) as { choices: Array<{ delta: { content: string } }>, chatbot: Record<string, unknown> }
}

function reset() { calls.answer = 0; calls.moderation = 0; calls.persist = 0; calls.rateLimit = 0 }

test('a filled honeypot gets a normal 200 reply and costs nothing', async () => {
  reset()
  const e = event({ messages: ASK, _h: 'https://spam.example/buy' })
  const response = await handler(e)
  const envelope = parseEnvelope(response)
  assert.equal(envelope.chatbot.kind, 'not_found', 'a plausible "nothing found" answer, not an error')
  assert.equal(envelope.chatbot.askContact, false)
  assert.ok(envelope.choices[0]!.delta.content.length > 10)
  assert.match(response, /data: \[DONE\]/, 'the stream is well-formed, like a real reply')
  assert.match(e.headers['Content-Type'] ?? '', /text\/event-stream/)
  assert.deepEqual(calls, { answer: 0, moderation: 0, persist: 0, rateLimit: 0 }, 'no AI call, no moderation, nothing stored')
})

test('the honeypot is checked before the body is validated or moderated', async () => {
  reset()
  // Not even a valid message list: the honeypot still decides first.
  await handler(event({ _h: 'x' }))
  await handler(event({ messages: 'garbage', _h: 'x' }))
  assert.deepEqual(calls, { answer: 0, moderation: 0, persist: 0, rateLimit: 0 })
})

test('an empty or whitespace honeypot is a real visitor and gets a real answer', async () => {
  for (const empty of ['', '   ', '\n\t']) {
    reset()
    const response = await handler(event({ messages: ASK, _h: empty }))
    assert.equal(calls.answer, 1, JSON.stringify(empty))
    assert.equal(calls.moderation, 1)
    assert.equal(parseEnvelope(response).chatbot.kind, 'curated')
  }
})

test('a missing honeypot is a real visitor', async () => {
  reset()
  await handler(event({ messages: ASK }))
  assert.equal(calls.answer, 1)
})

test('only a string can trip it: a number or object in `_h` is not a form-filling script', async () => {
  for (const odd of [0, 1, true, {}, [], null]) {
    reset()
    await handler(event({ messages: ASK, _h: odd }))
    assert.equal(calls.answer, 1, JSON.stringify(odd))
  }
})

test('a request with no body is not mistaken for a bot: it goes on to the normal path', async () => {
  reset()
  // The honeypot reply is a 200 `not_found`; an empty body instead takes the normal
  // path and is refused there as an invalid history (400, checked before moderation
  // since rà soát 2026-10-22 — it used to be raised inside `answerChat`).
  await assert.rejects(handler(event(null)), (error: { statusCode?: number }) => error.statusCode === 400)
  assert.equal(calls.rateLimit, 1, 'it went through the normal path, rate limit included')
  assert.equal(calls.answer, 0)
})
