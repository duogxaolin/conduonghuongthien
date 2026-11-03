import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Trần độ dài câu hỏi ở cửa vào của hai endpoint chat công khai.
 *
 * Trước đây trần (`min(CHAT_LIMITS.maxMessageChars, settings.maxInputChars)`) chỉ được
 * áp bên trong `answerChat` — SAU kiểm duyệt tức thì. Kiểm duyệt (luật regex tuỳ biến)
 * vì thế quét nguyên văn mọi câu hỏi tới trần thân request 64 KB. Nay câu hỏi quá dài
 * bị từ chối 400 TRƯỚC kiểm duyệt; thứ tự PR-3a giữ nguyên: honeypot → hạn mức →
 * độ dài → kiểm duyệt. Chạy handler thật với các phụ thuộc giả (cùng mẫu với
 * `tests/chatbot-rate-limit-before-moderation.test.ts`).
 */

const order: string[] = []
let rateLimited = false
let settings: Record<string, unknown> = { maxInputChars: 2000 }

mock.module('h3', {
  namedExports: {
    setHeader: (event: { headers: Record<string, string> }, name: string, value: string) => { event.headers[name] = value },
    getRequestHeader: (event: { reqHeaders: Record<string, string> }, name: string) => event.reqHeaders[name],
    createError: (input: { statusCode: number, statusMessage: string, message?: string }) => Object.assign(new Error(input.message ?? input.statusMessage), input),
  },
})
mock.module('../server/services/chatbot-settings', { namedExports: { getChatbotSettings: async () => settings } })
mock.module('../server/utils/chatbot/chat', {
  namedExports: {
    answerChat: async () => { order.push('answer'); return { answer: 'Trả lời.', kind: 'curated', sources: [], retryAfter: null, askContact: false } },
  },
})
mock.module('../server/utils/chatbot/chat-policy', {
  namedExports: {
    CHAT_LIMITS: Object.freeze({ maxBodyBytes: 64_000, maxMessageChars: 10_000, maxOutputChars: 8_000 }),
    validateChatRequestBody: () => {},
    chargeChatRateLimit: async () => { order.push('rate-limit'); return rateLimited ? 30 : null },
    CHAT_RATE_LIMITED_MESSAGE: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
  },
})
mock.module('../server/utils/chatbot/session-token', { namedExports: { verifySessionToken: () => 'session-abc' } })
mock.module('../server/utils/chatbot/session-db', { namedExports: { persistChatTurn: async () => { order.push('persist') } } })
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '203.0.113.9' } })
mock.module('../server/utils/runtime-config', { namedExports: { analyticsHmacSecret: () => 'secret' } })
const moderatedLengths: number[] = []
mock.module('../server/services/moderation-worker', {
  namedExports: {
    fastPreModerate: async (text: string) => { order.push('moderation'); moderatedLengths.push(text.length); return { blocked: false } },
    checkAndModerateContent: async () => ({ blocked: false }),
    // Earlier history turns are checked, in one batch, without filing a review row (chat-turns.ts).
    earlierTurnsToWithhold: async () => new Set<string>(),
  },
})

type Event = { body: unknown, headers: Record<string, string>, reqHeaders: Record<string, string>, context: Record<string, unknown>, node?: undefined }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body

const publicHandler = (await import('../server/api/public/chatbot/index.post')).default as unknown as (event: Event) => Promise<string>
const legacyHandler = (await import('../server/api/chat.post')).default as unknown as (event: Event) => Promise<string>
const { chatInputCharLimit } = await import('../server/utils/chatbot/input-length')

const event = (body: unknown): Event => ({ body, headers: {}, reqHeaders: { 'x-chat-session': 'token' }, context: {} })
const ask = (content: string, extra: Record<string, unknown> = {}) => ({ messages: [{ role: 'user', content }], ...extra })

function reset(next: Record<string, unknown> = { maxInputChars: 2000 }) {
  order.length = 0
  moderatedLengths.length = 0
  rateLimited = false
  settings = next
}

function envelope(text: string) {
  const line = text.split('\n').find(entry => entry.startsWith('data: ') && entry !== 'data: [DONE]')!
  return JSON.parse(line.slice(6)) as { chatbot: { kind: string } }
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as { statusCode?: number, message?: string, statusMessage?: string, data?: { maxChars?: number } }
  }
  assert.fail('handler không từ chối')
}

test('trần lấy từ cài đặt quản trị, luôn ≤ 10 000; cài đặt hỏng lùi về mặc định 2000 (không TẮT trần)', () => {
  assert.equal(chatInputCharLimit({ maxInputChars: 2000 }), 2000)
  assert.equal(chatInputCharLimit({ maxInputChars: 5000 }), 5000)
  assert.equal(chatInputCharLimit({ maxInputChars: 500 }), 500)
  assert.equal(chatInputCharLimit({ maxInputChars: 50_000 }), 10_000)
  assert.equal(chatInputCharLimit({}), 2000)
  assert.equal(chatInputCharLimit({ maxInputChars: Number.NaN }), 2000)
  assert.equal(chatInputCharLimit({ maxInputChars: 0 }), 2000)
  assert.equal(chatInputCharLimit(null), 2000)
})

for (const [name, handler] of [['/api/public/chatbot', publicHandler], ['/api/chat', legacyHandler]] as const) {
  test(`${name}: câu hỏi quá trần → 400 tiếng Việt, đã trừ hạn mức, KHÔNG tới kiểm duyệt/trả lời`, async () => {
    reset()
    const error = await rejection(handler(event(ask('a'.repeat(2001)))))
    assert.equal(error.statusCode, 400)
    assert.match(String(error.message), /không được vượt quá 2000 ký tự/)
    assert.equal(error.data?.maxChars, 2000)
    assert.deepEqual(order, ['rate-limit'])
  })

  test(`${name}: đúng bằng trần → vẫn được kiểm duyệt và trả lời`, async () => {
    reset()
    await handler(event(ask('a'.repeat(2000))))
    assert.deepEqual(order.slice(0, 3), ['rate-limit', 'moderation', 'answer'])
    assert.deepEqual(moderatedLengths, [2000])
  })

  test(`${name}: trần theo cài đặt quản trị (5000) — câu 3000 ký tự KHÔNG bị chặn bởi một con số cố định`, async () => {
    reset({ maxInputChars: 5000 })
    await handler(event(ask('b'.repeat(3000))))
    assert.ok(order.includes('moderation'))
    reset({ maxInputChars: 5000 })
    const error = await rejection(handler(event(ask('b'.repeat(5001)))))
    assert.equal(error.statusCode, 400)
  })

  test(`${name}: đã quá hạn mức + quá dài → vẫn là trả lời rate_limited (hạn mức đứng trước)`, async () => {
    reset()
    rateLimited = true
    const reply = await handler(event(ask('c'.repeat(9000))))
    assert.equal(envelope(reply).chatbot.kind, 'rate_limited')
    assert.deepEqual(order, ['rate-limit'])
  })
}

test('/api/public/chatbot: honeypot + quá dài → trả lời giả của honeypot (honeypot đứng trước, không lộ trường)', async () => {
  reset()
  const reply = await publicHandler(event(ask('d'.repeat(9000), { _h: 'bot' })))
  assert.equal(envelope(reply).chatbot.kind, 'not_found')
  assert.deepEqual(order, [])
})
