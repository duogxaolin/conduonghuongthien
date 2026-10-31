import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Biến thể lách bộ khớp chủ quyền qua HAI endpoint thật — `/api/public/chatbot` (stream và không stream) và
 * `/api/chat` — trên `answerChat` + chính sách thật, ở chế độ AI và chế độ chỉ kho: provider không bao giờ
 * được gọi, widget nhận đúng lập trường chính thức. Chỉ thay lá: hai đường tới model (`callAi`,
 * `safeProviderRequest`), CSDL, kiểm duyệt, phiên, cài đặt, h3. Một câu hợp lệ qua cùng harness PHẢI tới
 * provider — không có nó thì "0 lần gọi" không chứng minh gì.
 */

const ai = { calls: 0, legacyCalls: 0 }
const REPLY = 'Anh/chị liên hệ Công an xã nơi cư trú.'
mock.module('../server/services/ai-gateway', {
  namedExports: {
    callAi: async (_service: string, input: { onChunk?: (chunk: string) => void | Promise<void> }) => {
      ai.calls += 1
      await input.onChunk?.(REPLY)
      return { ok: true, text: REPLY }
    },
  },
})
const realOutbound = await import('../server/utils/chatbot/outbound')
mock.module('../server/utils/chatbot/outbound', {
  namedExports: {
    ...realOutbound,
    safeProviderRequest: async () => {
      ai.legacyCalls += 1
      return { status: 200, body: Buffer.from(JSON.stringify({ choices: [{ message: { content: REPLY } }] })) }
    },
  },
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
const current = { settings: null as unknown }
const realSettings = await import('../server/services/chatbot-settings')
mock.module('../server/services/chatbot-settings', {
  namedExports: { ...realSettings, getChatbotSettings: async () => current.settings, configuredChatbotSecret: () => 'secret-key' },
})
let session = 0
const realToken = await import('../server/utils/chatbot/session-token')
mock.module('../server/utils/chatbot/session-token', { namedExports: { ...realToken, verifySessionToken: () => `endpoint-session-${++session}` } })
const persisted: string[] = []
const realSessionDb = await import('../server/utils/chatbot/session-db')
mock.module('../server/utils/chatbot/session-db', {
  namedExports: { ...realSessionDb, persistChatTurn: async (turn: { botText: string }) => { persisted.push(turn.botText) } },
})
const realRuntime = await import('../server/utils/runtime-config')
mock.module('../server/utils/runtime-config', { namedExports: { ...realRuntime, analyticsHmacSecret: () => 'secret' } })
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
const { sovereigntyAnswer } = await import('../server/utils/chatbot/sovereignty-guard')

function settingsOf(mode: 'ai' | 'knowledge') {
  return {
    enabled: true, baseUrl: 'https://api.provider.example/v1', model: 'm', systemPrompt: 'Prompt quản trị tự viết.',
    allowedHosts: ['api.provider.example'], requestTimeoutMs: 1_000, maxResponseBytes: 16_384, maxInputChars: 2_000,
    maxHistoryMessages: 8, retrievalTopK: 3, referenceCharBudget: 6_000, rateLimitRequests: 1_000_000, rateLimitWindowSeconds: 60,
    leadCaptureEnabled: true, mode, outOfScopeBehavior: 'ai_freeform', providerPolicy: 'openai-compatible',
  }
}

let peer = 0
function eventFor(messages: unknown, res: unknown) {
  peer += 1
  return {
    body: { messages },
    reqHeaders: { 'x-chat-session': 'token' },
    context: {},
    node: { req: { headers: {}, socket: { remoteAddress: `198.19.${(peer >> 8) & 255}.${peer & 255}` } }, res },
  }
}

/** What the widget finally shows (real `parseSseLine` over every frame). */
function widgetText(wire: string): string {
  const target = { text: '', message: { id: 'bot', sender: 'bot', text: '' } as never }
  for (const line of wire.split('\n')) parseSseLine(line, target)
  return target.text
}

async function viaStream(question: string): Promise<string> {
  let wire = ''
  await streamHandler(eventFor([{ role: 'user', content: question }], { write: (frame: string) => { wire += frame }, end: () => {} }))
  return widgetText(wire)
}
async function viaNonStream(question: string): Promise<string> {
  return widgetText(String(await streamHandler(eventFor([{ role: 'user', content: question }], {}))))
}
async function viaApiChat(question: string): Promise<string> {
  return widgetText(String(await chatHandler(eventFor([{ role: 'user', content: question }], undefined))))
}

const PATHS = { stream: viaStream, nonStream: viaNonStream, apiChat: viaApiChat } as const

// One per root cause: glued words / invisible joiner, a joiner character, look-alike script, spaced letters,
// a digit for a letter, a one-letter typo, a name the matcher did not have, a single feature name.
// Ký tự vô hình viết bằng mã (U+2060), không dán thẳng.
// Vòng 6b (verifier 6, V01): "quần⠀đảo⠀Hoàng⠀Sa" với U+2800 — phép gấp mới bỏ ký tự này làm dính chữ, chỉ lớp 611588c2
// bắt: cổng câu hỏi phải hỏi cả phép hợp, không riêng bộ mới.
const BLANK = String.fromCodePoint(0x2800)
const EVASIONS = [`Biển${String.fromCodePoint(0x2060)}Đông của ai`, 'Biển_Đông của ai', 'Tây-Sa thuộc Trung Quốc phải không', 'Нoàng Sa thuộc ai', 'Biển Ɖông của ai',
  'H.o.à.n.g S.a thuộc ai', 'H0àng Sa của ai', 'Parasel', 'Biển Nam Trung Hoa là của ai', 'Ba Bình là đảo của ai',
  `bạn nghĩ sao về quần${BLANK}đảo${BLANK}Hoàng${BLANK}Sa`]

test('a legitimate question reaches the provider through every path (positive control)', async () => {
  for (const [name, send] of Object.entries(PATHS)) {
    current.settings = settingsOf('ai')
    ai.calls = 0
    ai.legacyCalls = 0
    const shown = await send('Thủ tục xóa án tích như thế nào?')
    assert.equal(ai.calls + ai.legacyCalls, 1, name)
    assert.equal(shown, REPLY, name)
  }
})

for (const mode of ['ai', 'knowledge'] as const) {
  test(`${mode} mode: an evasion never reaches the provider on either endpoint, and the widget shows the stance`, async () => {
    current.settings = settingsOf(mode)
    for (const question of EVASIONS) {
      for (const [name, send] of Object.entries(PATHS)) {
        ai.calls = 0
        ai.legacyCalls = 0
        persisted.length = 0
        const shown = await send(question)
        assert.equal(ai.calls + ai.legacyCalls, 0, `${name}: ${question}`)
        assert.equal(shown, sovereigntyAnswer(question), `${name}: ${question}`)
        if (name !== 'apiChat') assert.deepEqual(persisted, [sovereigntyAnswer(question)], `${name} stores the stance: ${question}`)
      }
    }
  })
}
