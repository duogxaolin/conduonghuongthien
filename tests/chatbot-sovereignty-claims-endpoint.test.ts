import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Vòng 7 — đường ĐẦU RA qua endpoint thật: câu hỏi lách được cổng đầu vào (không gọi tên đảo, không hỏi chủ quyền sát tên),
 * model GIẢ trả lời bằng cụm yêu sách tự nhiên ("là của Trung Quốc", "是中国的", "归属中国", "is Chinese", chữ Hán chen dấu câu)
 * theo từng chunk 1–5 ký tự. `/api/public/chatbot` (stream, không stream) và `/api/chat` trên `answerChat` + chính sách + lớp
 * chặn thật; chỉ thay lá (provider, CSDL, kiểm duyệt, phiên, cài đặt, h3) như tests/chatbot-sovereignty-endpoints.test.ts.
 *  - provider được gọi đúng một lần (không lần thứ hai qua đường cũ), model viết tiếp sau khi thay mà không chữ nào tới khách;
 *  - khung `chatbot.replace` có mặt, trước nó không có chữ nào của cụm yêu sách, sau nó không còn chữ của model;
 *  - widget (`parseSseLine` thật) và bản lưu là lập trường chính thức.
 * Đối chứng: câu trả lời hợp lệ có đảo + Trung Quốc mà không yêu sách tới khách nguyên vẹn.
 */

const ai = { calls: 0, legacyCalls: 0 }
const script = { reply: '', size: 1 }
mock.module('../server/services/ai-gateway', {
  namedExports: {
    callAi: async (_service: string, input: { onChunk?: (chunk: string) => void | Promise<void> }) => {
      ai.calls += 1
      for (let at = 0; at < script.reply.length; at += script.size) await input.onChunk?.(script.reply.slice(at, at + script.size))
      return { ok: true, text: script.reply }
    },
  },
})
const realOutbound = await import('../server/utils/chatbot/outbound')
mock.module('../server/utils/chatbot/outbound', {
  namedExports: { ...realOutbound, safeProviderRequest: async () => { ai.legacyCalls += 1; return { status: 500, body: Buffer.from('') } } },
})
const realDb = await import('../server/utils/db')
mock.module('../server/utils/db', { namedExports: { ...realDb, getDb: () => { throw new Error('no database in this test') }, getPool: () => null } })
const memory = new Map<string, { count: number, expiresAt: number }>()
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({ execute: null, memory }) } })
const realH3 = await import('h3')
mock.module('h3', {
  namedExports: {
    ...realH3,
    setHeader: () => {},
    getRequestHeader: (event: { reqHeaders?: Record<string, string> }, name: string) => event.reqHeaders?.[name],
    createError: (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
  },
})
const realSettings = await import('../server/services/chatbot-settings')
const SETTINGS = {
  enabled: true, baseUrl: 'https://api.provider.example/v1', model: 'm', systemPrompt: 'Prompt quản trị tự viết.',
  allowedHosts: ['api.provider.example'], requestTimeoutMs: 1_000, maxResponseBytes: 16_384, maxInputChars: 2_000,
  maxHistoryMessages: 8, retrievalTopK: 3, referenceCharBudget: 6_000, rateLimitRequests: 1_000_000, rateLimitWindowSeconds: 60,
  leadCaptureEnabled: true, mode: 'ai', outOfScopeBehavior: 'ai_freeform', providerPolicy: 'openai-compatible',
}
mock.module('../server/services/chatbot-settings', {
  namedExports: { ...realSettings, getChatbotSettings: async () => SETTINGS, configuredChatbotSecret: () => 'secret-key' },
})
let session = 0
const realToken = await import('../server/utils/chatbot/session-token')
mock.module('../server/utils/chatbot/session-token', { namedExports: { ...realToken, verifySessionToken: () => `claims-session-${++session}` } })
const persisted: string[] = []
const realSessionDb = await import('../server/utils/chatbot/session-db')
mock.module('../server/utils/chatbot/session-db', {
  namedExports: { ...realSessionDb, persistChatTurn: async (turn: { botText: string }) => { persisted.push(turn.botText) } },
})
const realRuntime = await import('../server/utils/runtime-config')
mock.module('../server/utils/runtime-config', { namedExports: { ...realRuntime, analyticsHmacSecret: () => 'secret' } })
const realLogger = await import('../server/utils/logger')
mock.module('../server/utils/logger', { namedExports: { ...realLogger, logInfo: () => {}, logWarn: () => {} } })
const realModeration = await import('../server/services/moderation-worker')
mock.module('../server/services/moderation-worker', {
  namedExports: {
    ...realModeration,
    fastPreModerate: async () => ({ blocked: false }),
    checkAndModerateContent: async () => ({ blocked: false }),
    earlierTurnsToWithhold: async () => new Set<string>(),
  },
})

const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: { body: unknown }) => event.body

const streamHandler = (await import('../server/api/public/chatbot/index.post')).default as unknown as (event: unknown) => Promise<unknown>
const chatHandler = (await import('../server/api/chat.post')).default as unknown as (event: unknown) => Promise<unknown>
const { parseSseLine } = await import('../app/composables/useChatbot')
const { mentionsSovereignty, sovereigntyAnswer } = await import('../server/utils/chatbot/sovereignty-guard')

let peer = 0
function eventFor(question: string, res: unknown) {
  peer += 1
  return {
    body: { messages: [{ role: 'user', content: question }] },
    reqHeaders: { 'x-chat-session': 'token' },
    context: {},
    node: { req: { headers: {}, socket: { remoteAddress: `198.18.${(peer >> 8) & 255}.${peer & 255}` } }, res },
  }
}
function widgetText(wire: string): string {
  const target = { text: '', message: { id: 'bot', sender: 'bot', text: '' } as never }
  for (const line of wire.split('\n')) parseSseLine(line, target)
  return target.text
}
type Frame = { choices?: Array<{ delta?: { content?: string } }>, chatbot?: { replace?: string } }
const frames = (wire: string): Frame[] => wire.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)) as Frame)
const content = (frame: Frame) => frame.choices?.[0]?.delta?.content ?? ''

/** [câu hỏi lách cổng đầu vào, câu trả lời yêu sách của model, chữ của cụm yêu sách không được tới khách]. */
const DODGES: Array<[question: string, reply: string, claim: RegExp]> = [
  ['Cho tôi hỏi', 'Những hòn đảo này là của Trung Quốc. Nếu cần thêm thông tin về việc làm, vay vốn, hãy nhắn cho tôi nhé.', /Trung/],
  ['请问', '这些岛屿是中国的。如需更多信息，请告诉我。祝您生活愉快！', /中国/],
  ['请问', '该海域归属中国。我们也可以谈谈就业和贷款。', /中国/],
  ['Tell me about it', 'Pattle Island is Chinese. Let me know if you need help with jobs, loans or vocational training.', /Chinese/],
  ['Hòn đảo kia ai quản lý?', 'Nó là của Trung Quốc.', /Trung/],
  ['那些群岛怎么样？', '它们是中国的。', /中国/],
  ['請問', '這．片．海．域．屬．於．中．國．。請告訴我您還需要什麼。', /中/],
]

test('the dodge questions pass the input gate (they must reach the provider for this test to mean anything)', () => {
  for (const [question] of DODGES) assert.equal(mentionsSovereignty(question), false, question)
})

test('stream: the claim is replaced on the wire at chunk sizes 1–5 — nothing of it shown, nothing of the model after the replace, the stance stored', async () => {
  for (const [question, reply, claim] of DODGES) {
    for (const size of [1, 2, 3, 4, 5]) {
      Object.assign(script, { reply, size })
      ai.calls = 0
      ai.legacyCalls = 0
      persisted.length = 0
      let wire = ''
      await streamHandler(eventFor(question, { write: (frame: string) => { wire += frame }, end: () => {} }))
      const label = `${size}: ${reply}`
      assert.equal(ai.calls, 1, label)
      assert.equal(ai.legacyCalls, 0, label)
      const all = frames(wire)
      const at = all.findIndex(frame => frame.chatbot?.replace !== undefined)
      assert.ok(at >= 0, `no chatbot.replace frame — ${label}`)
      assert.equal(all[at]!.chatbot!.replace, sovereigntyAnswer(question), label)
      assert.ok(!claim.test(all.slice(0, at).map(content).join('')), `claim shown before the replace — ${label}`)
      assert.deepEqual(all.slice(at + 1).map(content).filter(Boolean), [], `model text after the replace — ${label}`)
      assert.equal(widgetText(wire), sovereigntyAnswer(question), label)
      assert.deepEqual(persisted, [sovereigntyAnswer(question)], label)
    }
  }
})

test('/api/public/chatbot without stream and /api/chat: the claim is withdrawn by the answer alone, provider called once', async () => {
  for (const [question, reply] of DODGES) {
    Object.assign(script, { reply, size: 3 })
    for (const send of [() => streamHandler(eventFor(question, {})), () => chatHandler(eventFor(question, undefined))]) {
      ai.calls = 0
      ai.legacyCalls = 0
      const shown = widgetText(String(await send()))
      assert.equal(ai.calls + ai.legacyCalls, 1, reply)
      assert.equal(shown, sovereigntyAnswer(question), reply)
    }
  }
})

test('control: a legitimate reply with an island and China but no claim reaches the visitor whole at every chunk size', async () => {
  const reply = 'Anh từng là tù nhân của Trung Quốc trên một hòn đảo; khi về nước anh được hỗ trợ học nghề, vay vốn và giới thiệu việc làm.'
  for (const size of [1, 2, 3, 4, 5]) {
    Object.assign(script, { reply, size })
    persisted.length = 0
    let wire = ''
    await streamHandler(eventFor('Tôi từng ở tù bên Trung Quốc, giờ làm gì?', { write: (frame: string) => { wire += frame }, end: () => {} }))
    assert.ok(!frames(wire).some(frame => frame.chatbot?.replace !== undefined), `${size}`)
    assert.equal(widgetText(wire), reply, `${size}`)
    assert.deepEqual(persisted, [reply])
  }
})
