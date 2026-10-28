import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Khung SSE khi lớp chặn đầu ra thay câu trả lời (sovereignty-guard.ts, CHANGELOG § 28): handler thật
 * của `/api/public/chatbot`, `answerChat` giả gọi `onChunk` rồi `onReplace` như policy làm.
 *
 * - Widget mới (`parseSseLine` thật) cuối cùng chỉ còn đúng lập trường chính thức.
 * - Widget cũ chỉ biết nối `content`: vẫn nhận lập trường, đúng một lần.
 * - Máy chủ không phát lại `result.answer` sau khi đã thay (không nhân đôi), và bản lưu là lập trường.
 */

const OFFICIAL = 'Quần đảo Hoàng Sa và quần đảo Trường Sa là lãnh thổ của Việt Nam.'
const script = { before: [] as string[] }
const persisted: string[] = []

mock.module('h3', {
  namedExports: {
    setHeader: () => {},
    getRequestHeader: (event: { reqHeaders: Record<string, string> }, name: string) => event.reqHeaders[name],
    createError: (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
  },
})
mock.module('../server/services/chatbot-settings', { namedExports: { getChatbotSettings: async () => ({}) } })
mock.module('../server/utils/chatbot/chat', {
  namedExports: {
    answerChat: async (_event: unknown, _settings: unknown, _messages: unknown,
      onChunk?: (chunk: string) => Promise<void> | void, _onTool?: unknown, onReplace?: (answer: string) => Promise<void> | void) => {
      for (const chunk of script.before) await onChunk?.(chunk)
      await onReplace?.(OFFICIAL)
      return { answer: OFFICIAL, kind: 'curated', sources: [] }
    },
  },
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
  namedExports: { persistChatTurn: async (turn: { botText: string }) => { persisted.push(turn.botText) } },
})
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '203.0.113.9' } })
mock.module('../server/utils/runtime-config', { namedExports: { analyticsHmacSecret: () => 'secret' } })
mock.module('../server/services/moderation-worker', {
  namedExports: {
    fastPreModerate: async () => ({ blocked: false }),
    matchInstantRule: async () => null,
    checkAndModerateContent: async () => ({ blocked: false }),
  },
})

const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: { body: unknown }) => event.body

const handler = (await import('../server/api/public/chatbot/index.post')).default as unknown as (event: unknown) => Promise<unknown>
const { parseSseLine } = await import('../app/composables/useChatbot')

async function framesFor(before: string[]): Promise<string[]> {
  script.before = before
  persisted.length = 0
  let wire = ''
  await handler({
    body: { messages: [{ role: 'user', content: 'Đảo Ba Bình hiện do ai quản lý?' }] },
    reqHeaders: { 'x-chat-session': 'token' },
    context: {},
    node: { res: { write: (frame: string) => { wire += frame }, end: () => {} } },
  })
  return wire.split('\n').filter(line => line.startsWith('data: '))
}

for (const [name, before] of [['after part of the reply was shown', ['Đảo Ba Bình thuộc ']], ['before anything was shown', []]] as const) {
  test(`replace ${name}: new widget shows only the official answer, old widget gets it once, storage holds it`, async () => {
    const frames = await framesFor([...before])

    const target = { text: '', message: { id: 'bot-1', sender: 'bot', text: '' } as never }
    for (const frame of frames) parseSseLine(frame, target)
    assert.equal(target.text, OFFICIAL)

    const appended = frames.filter(frame => frame !== 'data: [DONE]')
      .map(frame => (JSON.parse(frame.slice(6)) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? '')
      .join('')
    assert.equal(appended.split(OFFICIAL).length - 1, 1, `an old widget sees the official answer exactly once: ${appended}`)

    assert.deepEqual(persisted, [OFFICIAL])
  })
}
