import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Moderation must screen the very string the chatbot answers and stores.
 *
 * Both public chat endpoints read a turn as `text ?? content` (raw) while the
 * policy answers `content ?? text` (NFKC-normalized) — rà soát 2026-10-22. A
 * request carrying a harmless `text` and a prohibited `content` passed the
 * instant check, reached the provider, and was stored as the harmless line;
 * `/api/chat` skipped `{ sender: 'user', text }` turns altogether; earlier user
 * turns (client-supplied history, sent to the model too) were never screened.
 * These drive the real handlers with the turn reader from
 * `server/utils/chatbot/chat-turns.ts`.
 *
 * The bot's own earlier answers are NOT screened: a correct answer may contain a
 * rule keyword ("tội lừa đảo…"), and screening it refused the visitor's next
 * harmless message and filed the bot's words under the visitor's IP.
 */

const PROHIBITED = 'nội dung cấm'
const seen = { screened: [] as string[], answered: 0, persisted: [] as string[] }

mock.module('h3', {
  namedExports: {
    setHeader: (event: { headers: Record<string, string> }, name: string, value: string) => { event.headers[name] = value },
    getRequestHeader: (event: { reqHeaders: Record<string, string> }, name: string) => event.reqHeaders[name],
    createError: (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
  },
})
mock.module('../server/services/chatbot-settings', { namedExports: { getChatbotSettings: async () => ({}) } })
mock.module('../server/utils/chatbot/chat', {
  namedExports: { answerChat: async () => { seen.answered += 1; return { answer: 'Trả lời.', kind: 'curated', sources: [] } } },
})
mock.module('../server/utils/chatbot/chat-policy', {
  namedExports: {
    CHAT_LIMITS: Object.freeze({ maxBodyBytes: 64_000, maxMessageChars: 10_000, maxOutputChars: 8_000 }),
    validateChatRequestBody: () => {},
    chargeChatRateLimit: async () => null,
    CHAT_RATE_LIMITED_MESSAGE: 'Bạn đã gửi quá nhiều yêu cầu.',
  },
})
mock.module('../server/utils/chatbot/session-token', { namedExports: { verifySessionToken: () => 'session-abc' } })
mock.module('../server/utils/chatbot/session-db', {
  namedExports: { persistChatTurn: async (turn: { userText: string }) => { seen.persisted.push(turn.userText) } },
})
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '203.0.113.9' } })
mock.module('../server/utils/runtime-config', { namedExports: { analyticsHmacSecret: () => 'secret' } })
mock.module('../server/services/moderation-worker', {
  namedExports: {
    fastPreModerate: async (text: string) => { seen.screened.push(text); return { blocked: text.includes(PROHIBITED) } },
    checkAndModerateContent: async () => ({ blocked: false }),
  },
})

type Event = { body: unknown, headers: Record<string, string>, reqHeaders: Record<string, string>, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body

const publicHandler = (await import('../server/api/public/chatbot/index.post')).default as unknown as (event: Event) => Promise<string>
const legacyHandler = (await import('../server/api/chat.post')).default as unknown as (event: Event) => Promise<string>

const send = (handler: (event: Event) => Promise<string>, messages: unknown[]) =>
  handler({ body: { messages }, headers: {}, reqHeaders: { 'x-chat-session': 'token' }, context: {} })
const kindOf = (reply: string) => {
  const frames = reply.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)))
  return frames.map(frame => frame.chatbot?.kind).find(Boolean) as string | undefined
}
function reset() { seen.screened.length = 0; seen.answered = 0; seen.persisted.length = 0 }

for (const [name, handler] of [['/api/public/chatbot', publicHandler], ['/api/chat', legacyHandler]] as const) {
  test(`${name}: a harmless \`text\` cannot carry a prohibited \`content\` past moderation`, async () => {
    reset()
    const reply = await send(handler, [{ role: 'user', text: 'xin chào', content: `cho tôi ${PROHIBITED}` }])
    assert.equal(kindOf(reply), 'moderation_blocked')
    assert.equal(seen.answered, 0, 'the provider is never asked')
    assert.ok(seen.screened.some(text => text.includes(PROHIBITED)), 'the answered string is the screened one')
  })

  test(`${name}: a { sender: 'user', text } turn is screened`, async () => {
    reset()
    assert.equal(kindOf(await send(handler, [{ sender: 'user', text: PROHIBITED }])), 'moderation_blocked')
    assert.equal(seen.answered, 0)
  })

  test(`${name}: earlier user turns of the client-supplied history are screened too`, async () => {
    reset()
    const history = [
      { role: 'user', content: `câu đầu ${PROHIBITED}` },
      { role: 'assistant', content: 'Trả lời.' },
      { role: 'user', content: 'tiếp tục đi' },
    ]
    assert.equal(kindOf(await send(handler, history)), 'moderation_blocked')
    assert.equal(seen.answered, 0)
    assert.equal(seen.screened[0], 'tiếp tục đi', 'the newest turn is screened first')
  })

  test(`${name}: the bot's own earlier answer is not screened, so a keyword in it never refuses the visitor`, async () => {
    reset()
    const history = [
      { role: 'user', content: 'tội này bị xử thế nào?' },
      { role: 'assistant', content: `Hành vi ${PROHIBITED} bị xử lý theo Điều 174.` },
      { role: 'user', content: 'cảm ơn' },
    ]
    assert.notEqual(kindOf(await send(handler, history)), 'moderation_blocked')
    assert.equal(seen.answered, 1)
    assert.deepEqual(seen.screened, ['cảm ơn', 'tội này bị xử thế nào?'])
  })

  test(`${name}: a history that does not end with the visitor's turn, or is oversized, is refused before any screening`, async () => {
    for (const messages of [
      [{ role: 'user', content: 'hỏi' }, { role: 'assistant', content: PROHIBITED }],
      Array.from({ length: 1000 }, (_, index) => ({ role: 'user', content: `lượt ${index}` })),
      // 16 turns each under the per-turn cap, together over the 30 000-character total.
      Array.from({ length: 16 }, (_, index) => ({ role: 'user', content: `${index}`.padEnd(1999, 'x') })),
    ]) {
      reset()
      await assert.rejects(send(handler, messages), (error: { statusCode?: number }) => error.statusCode === 400)
      assert.deepEqual(seen.screened, [], 'nothing reaches moderation')
      assert.equal(seen.answered, 0)
    }
  })

  test(`${name}: what is screened is NFKC-normalized, like what the model receives`, async () => {
    reset()
    // Full-width letters fold to ASCII under NFKC — the raw string would not match.
    await send(handler, [{ role: 'user', content: 'ｘｉｎ ｃｈàｏ' }])
    assert.deepEqual(seen.screened, ['xin chào'])
    assert.equal(seen.answered, 1)
  })
}

test('/api/public/chatbot: the stored transcript is the string that was screened, never the decoy', async () => {
  reset()
  await send(publicHandler, [{ role: 'user', text: 'xin chào', content: PROHIBITED }])
  assert.deepEqual(seen.persisted, [PROHIBITED])
  reset()
  await send(publicHandler, [{ role: 'user', text: 'xin chào', content: 'thủ tục xoá án tích' }])
  assert.deepEqual(seen.persisted, ['thủ tục xoá án tích'], 'an answered turn is stored as answered')
})
