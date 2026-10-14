/**
 * Lượt gửi câu hỏi bị máy chủ TỪ CHỐI (400/413/429) khác lượt gửi HỎNG (mạng, 5xx).
 *
 * Bối cảnh: máy chủ chặn câu hỏi dài hơn `min(10000, cài đặt max_input_chars)` ở cửa
 * vào bằng HTTP 400 + câu tiếng Việt + `data: { reason: 'input_too_long', maxChars }`
 * (`server/utils/chatbot/input-length.ts`). Ô nhập phía trình duyệt ghim 2000 ký tự;
 * quản trị hạ cài đặt xuống (vd. 500) thì một câu 1500 ký tự qua được ô nhập nhưng bị
 * máy chủ từ chối.
 *
 * Lỗi đã gặp (đọc mã + chạy composable thật với `fetch` giả bên dưới):
 *  - mọi phản hồi không-ok thành MỘT câu chung "Không thể nhận phản hồi lúc này" — khách
 *    không biết phải rút gọn, bấm "Thử lại" gửi lại đúng câu đó và bị từ chối mãi;
 *  - câu bị từ chối Ở LẠI bản ghi hội thoại (đánh dấu lỗi) nên `boundedUserHistory()`
 *    gửi lại nó trong MỌI lượt sau — máy chủ kiểm độ dài từng tin trong lịch sử
 *    (`validateChatMessages`) → mọi câu hỏi sau đó cũng 400: cuộc trò chuyện chết.
 *
 * Test này chạy `useChatbot()` thật trong Node với `globalThis.fetch` giả.
 */
import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { useChatbot, describeChatSendFailure, CHATBOT_CLIENT_LIMITS } from '../app/composables/useChatbot'

type Call = { url: string, body: unknown }

const SERVER_TOO_LONG = 'Câu hỏi không được vượt quá 500 ký tự. Vui lòng rút gọn rồi gửi lại.'
const realFetch = globalThis.fetch

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function sseResponse(text: string): Response {
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: '' } }], chatbot: { kind: 'curated', sources: [] } })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
  return new Response(frames, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** `fetch` giả: phiên luôn cấp token; lượt chat lấy lần lượt từ `chatReplies`. */
function installFetch(chatReplies: Array<() => Response>): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null
    calls.push({ url, body })
    if (url === '/api/public/chatbot/session') return jsonResponse(200, { ok: true, token: 'tok.sig' })
    const next = chatReplies.shift()
    if (!next) throw new Error(`unexpected fetch ${url}`)
    return next()
  }) as typeof fetch
  return calls
}

afterEach(() => {
  globalThis.fetch = realFetch
  const chat = useChatbot()
  chat.stopTypewriter(true)
  chat.botInput.value = ''
  chat.botInputError.value = ''
})

const chatBodies = (calls: Call[]) => calls
  .filter(call => call.url === '/api/public/chatbot')
  .map(call => (call.body as { messages: Array<{ sender: string, text: string }> }).messages)

test('400 input_too_long: hiện ĐÚNG câu của máy chủ, giữ bản nháp, bỏ câu khỏi hội thoại (không đầu độc lượt sau)', async () => {
  const chat = useChatbot()
  chat.createConversation()
  const longQuestion = 'Xin hỏi về thủ tục xoá án tích '.repeat(40).trim() // ~1200 ký tự < 2000 của ô nhập
  assert.ok(longQuestion.length > 500 && longQuestion.length < CHATBOT_CLIENT_LIMITS.maxMessageChars)

  const calls = installFetch([
    () => jsonResponse(400, {
      error: true,
      statusCode: 400,
      statusMessage: SERVER_TOO_LONG,
      message: SERVER_TOO_LONG,
      data: { reason: 'input_too_long', maxChars: 500 },
    }),
    () => sseResponse('Chào bạn.'),
  ])

  chat.botInput.value = longQuestion
  await chat.submitBotQuestion(longQuestion)

  assert.equal(chat.botInputError.value, SERVER_TOO_LONG)
  assert.equal(chat.botInput.value, longQuestion, 'bản nháp phải còn nguyên để khách rút gọn')
  assert.equal(chat.isSubmitting.value, false)
  assert.ok(
    !chat.chatMessages.value.some(message => message.sender === 'user' && message.text === longQuestion),
    'câu bị từ chối không được ở lại bản ghi hội thoại (sẽ bị gửi lại trong lịch sử)',
  )
  // Ô nhập theo trần máy chủ vừa báo (chỉ hạ, không nâng quá 2000).
  assert.equal(chat.limits.value.maxMessageChars, 500)

  // Lượt sau (câu ngắn) KHÔNG mang câu bị từ chối trong lịch sử.
  await chat.submitBotQuestion('Thủ tục vay vốn?')
  const [, second] = chatBodies(calls)
  assert.ok(second, 'lượt thứ hai phải được gửi')
  assert.ok(!second.some(item => item.text === longQuestion), 'lịch sử gửi đi không được chứa câu đã bị từ chối')
  assert.ok(second.some(item => item.sender === 'user' && item.text === 'Thủ tục vay vốn?'))
  assert.equal(chat.botInputError.value, '')
})

test('câu dài hơn trần đã biết bị chặn ngay ở trình duyệt, không tốn một lượt gọi', async () => {
  const chat = useChatbot()
  chat.createConversation()
  const calls = installFetch([])
  const text = 'a'.repeat(chat.limits.value.maxMessageChars + 1)
  await chat.submitBotQuestion(text)
  assert.equal(calls.length, 0)
  assert.match(chat.botInputError.value, new RegExp(`${chat.limits.value.maxMessageChars} ký tự`))
})

test('429: câu tiếng Việt của máy chủ được hiện; câu hỏi giữ lại để thử lại sau', async () => {
  const chat = useChatbot()
  chat.createConversation()
  installFetch([() => jsonResponse(429, { statusCode: 429, message: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' })])
  await chat.submitBotQuestion('Hỏi nhanh')
  assert.equal(chat.botInputError.value, 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.')
  assert.equal(chat.botInput.value, 'Hỏi nhanh')
  const kept = chat.chatMessages.value.find(message => message.sender === 'user' && message.text === 'Hỏi nhanh')
  assert.equal(kept?.status, 'error', 'quá hạn mức là tạm thời — giữ câu với nút "Thử lại"')
})

test('400 khác (thông điệp tiếng Anh của máy chủ) → câu tiếng Việt cố định, không lộ chữ thô', async () => {
  const chat = useChatbot()
  chat.createConversation()
  installFetch([() => jsonResponse(400, { statusCode: 400, statusMessage: 'Invalid chat messages', message: 'Invalid chat messages' })])
  await chat.submitBotQuestion('Hỏi gì đó')
  assert.doesNotMatch(chat.botInputError.value, /Invalid/)
  assert.match(chat.botInputError.value, /cuộc trò chuyện mới/)
  assert.equal(chat.botInput.value, 'Hỏi gì đó')
})

test('5xx / thân không phải JSON → câu chung như trước, câu hỏi giữ lại với "Thử lại"', async () => {
  const chat = useChatbot()
  chat.createConversation()
  installFetch([() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })])
  await chat.submitBotQuestion('Hỏi lúc máy chủ hỏng')
  assert.equal(chat.botInputError.value, 'Không thể nhận phản hồi lúc này. Nội dung câu hỏi đã được giữ lại để bạn thử lại.')
  assert.equal(chat.botInput.value, 'Hỏi lúc máy chủ hỏng')
  const kept = chat.chatMessages.value.find(message => message.sender === 'user' && message.text === 'Hỏi lúc máy chủ hỏng')
  assert.equal(kept?.status, 'error')
})

// ─── Hàm thuần phân loại ─────────────────────────────────────────────────────

test('describeChatSendFailure: phân loại theo mã + thân lỗi', () => {
  const tooLong = describeChatSendFailure(400, { message: SERVER_TOO_LONG, data: { reason: 'input_too_long', maxChars: 500 } })
  assert.deepEqual(tooLong, { kind: 'rejected', message: SERVER_TOO_LONG, maxChars: 500 })

  // Thân thiếu `message` → tự soạn từ maxChars; maxChars rác → bỏ qua.
  assert.equal(describeChatSendFailure(400, { data: { reason: 'input_too_long', maxChars: 300 } }).message, 'Câu hỏi không được vượt quá 300 ký tự. Vui lòng rút gọn rồi gửi lại.')
  assert.equal(describeChatSendFailure(400, { data: { reason: 'input_too_long', maxChars: 'x' } }).maxChars, null)
  assert.equal(describeChatSendFailure(400, { data: { reason: 'input_too_long', maxChars: 0 } }).maxChars, null)

  assert.equal(describeChatSendFailure(413, null).kind, 'rejected')
  assert.match(describeChatSendFailure(413, null).message, /quá dài/)
  assert.equal(describeChatSendFailure(429, null).kind, 'rate_limited')
  assert.match(describeChatSendFailure(429, { message: 'Too many' }).message, /quá nhanh/)
  assert.equal(describeChatSendFailure(503, { message: 'Dịch vụ bận' }).kind, 'unavailable')
  assert.equal(describeChatSendFailure(500, 'not json').kind, 'unavailable')
  // `statusMessage` không được dùng thay `message` (dòng trạng thái HTTP mất dấu tiếng Việt).
  assert.match(describeChatSendFailure(400, { statusMessage: 'Câu hỏi qu dài', data: { reason: 'input_too_long', maxChars: 50 } }).message, /50 ký tự/)
})
