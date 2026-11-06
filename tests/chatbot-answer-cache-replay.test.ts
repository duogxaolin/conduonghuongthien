import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'
import type { ChatbotSettings } from '../server/db/schema'
import type { ChatDependencies, ChatEvent } from '../server/utils/chatbot/chat-policy'

/**
 * Lượt TRÚNG cache câu trả lời (`answerGroundedChat`) — hai lỗi tìm thấy 2026-11-06:
 *
 *  1. Câu phát lại từ cache không qua lớp chặn chủ quyền ở đầu ra. Cache không gọi model, nên một lần
 *     lọt hiếm hoi thành câu phát lại y nguyên cho mọi người hỏi cùng câu, và lần nâng bộ khớp sau
 *     không áp cho hàng đã lưu (tới 30 ngày). Nay: bị bắt ⇒ khách nhận lập trường chính thức, hàng bị bỏ.
 *  2. Kho kiến thức giữ trong bộ nhớ 60 s không biết phiên bản cache: sửa kho xong (tăng phiên bản),
 *     câu trả lời từ kho CŨ được ghi dưới khoá MỚI. Nay lượt hỏi truyền phiên bản cho MỌI lượt nạp kho.
 *     Phiên bản là cột `answer_cache_version` của chính hàng cấu hình endpoint đã đọc (một ảnh chụp).
 *
 * Module cache được thay bằng bản giả (không CSDL); gateway AI giả đếm số lần gọi model.
 */

const cache = {
  stored: null as null | { answer: string, sources: unknown[], followUps: string[], kind: string },
  reads: 0,
  writes: 0,
  discarded: [] as string[],
}
const KEY = 'c'.repeat(64)

mock.module('../server/services/chatbot-answer-cache', {
  namedExports: {
    answerCacheKey: (input: { historyLength: number }) => (input.historyLength > 1 ? null : KEY),
    readCachedAnswer: async () => {
      cache.reads += 1
      return cache.stored
    },
    writeCachedAnswer: async () => {
      cache.writes += 1
      return true
    },
    discardCachedAnswer: async (key: string) => {
      cache.discarded.push(key)
      return true
    },
  },
})

const provider = { calls: 0, text: 'Anh/chị liên hệ Công an xã nơi cư trú để được hướng dẫn.' }
mock.module('../server/services/ai-gateway', {
  namedExports: {
    callAi: async (_service: string, input: { onChunk?: (chunk: string) => void | Promise<void> }) => {
      provider.calls += 1
      await input.onChunk?.(provider.text)
      return { ok: true, text: provider.text }
    },
  },
})

const { answerGroundedChat } = await import('../server/utils/chatbot/chat-policy')
const { mentionsSovereignty, sovereigntyAnswer } = await import('../server/utils/chatbot/sovereignty-guard')

const QUESTION = 'Làm sao để xóa án tích?'

function settingsOf(overrides: Partial<ChatbotSettings> = {}): ChatbotSettings {
  return {
    enabled: true,
    baseUrl: 'https://api.provider.example/v1',
    model: 'safe-model',
    systemPrompt: 'Prompt quản trị tự viết.',
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
    mode: 'ai',
    outOfScopeBehavior: 'ai_freeform',
    answerCacheVersion: 7,
    ...overrides,
  } as ChatbotSettings
}

/** Rate limit đã tính sẵn cho request (như endpoint làm) — test này không đo nó. */
const event = () => ({ node: { req: { headers: {}, socket: { remoteAddress: '198.51.100.9' } } }, context: { chatRateLimit: { retryAfter: null } } }) as unknown as ChatEvent

let loadedWith: Array<number | undefined> = []
const dependencies: ChatDependencies = {
  loadPublishedEntries: async (dataVersion?: number) => {
    loadedWith.push(dataVersion)
    return []
  },
  loadSmallTalkEntries: async () => [],
  configuredSecret: () => 'secret-key',
  providerRequest: async () => { throw new Error('the gateway answers in these tests') },
}

const ask = (question = QUESTION, onChunk?: (chunk: string) => void, settings = settingsOf()) =>
  answerGroundedChat(event(), settings, [{ role: 'user', content: question }], dependencies, onChunk)

beforeEach(() => {
  Object.assign(cache, { stored: null, reads: 0, writes: 0, discarded: [] })
  provider.calls = 0
  loadedWith = []
})

test('a clean cached answer is replayed without calling the model', async () => {
  cache.stored = { answer: 'Theo Điều 70 Bộ luật Hình sự, án tích được xoá khi…', sources: [], followUps: ['Cần giấy tờ gì?'], kind: 'provider' }
  const result = await ask()
  assert.equal(provider.calls, 0)
  assert.equal(result.answer, cache.stored.answer)
  assert.equal(result.kind, 'provider')
  assert.deepEqual(result.followUps, ['Cần giấy tờ gì?'])
  assert.deepEqual(cache.discarded, [])
})

test('a cached answer the stance guard now catches is withheld, discarded, and replaced by the official answer', async () => {
  assert.equal(mentionsSovereignty(QUESTION), false, 'precondition: the question itself is not a sovereignty question')
  for (const answer of [
    'Biển Đông là vùng biển có nhiều tranh chấp, anh/chị nên tìm hiểu thêm.',
    'Ngoài ra, quần đảo Hoàng Sa thuộc chủ quyền của nước khác.',
    '这些岛屿是中国领土。',
  ]) {
    Object.assign(cache, { stored: { answer, sources: [], followUps: [], kind: 'provider' }, discarded: [] })
    let shown = ''
    const result = await ask(QUESTION, (chunk) => { shown += chunk })
    assert.equal(result.answer, sovereigntyAnswer(QUESTION), answer)
    assert.equal(result.kind, 'curated')
    assert.deepEqual(result.sources, [])
    assert.deepEqual(cache.discarded, [KEY], `the row stays replayable: ${answer}`)
    assert.equal(shown, '', 'nothing of the cached text was streamed')
    assert.equal(provider.calls, 0)
  }
})

test('legitimate answers with look-alike words are replayed untouched (no false trip, no discard)', async () => {
  // Chặn oan ở đây đắt: khách hỏi xoá án tích nhận lập trường chủ quyền, hàng bị xoá, câu mới của model lại bị
  // chặn. Đo 2026-11-06 trên 1 362 câu hợp lệ của fixture: kiểm cả câu một lần không chặn câu nào mà đường
  // stream để qua (442 câu yêu sách: bắt 388, bằng đúng đường stream).
  for (const answer of [
    'Anh Hoàng Sang đã hoàn lương và mở xưởng mộc.',
    'Nhà trường sa thải giáo viên vì có tiền án là trái luật.',
    'Tôi từng làm việc ở Trung Quốc, nay muốn vay vốn.',
    'Anh từng chấp hành án tại trại giam Côn Đảo nay đã về địa phương, có thể vay vốn tại Ngân hàng Chính sách xã hội.',
    'Giá cả biến động, anh/chị nên vay vốn ưu đãi.',
    '越南海防市的社区矫正对象可以申请贷款。',
  ]) {
    Object.assign(cache, { stored: { answer, sources: [], followUps: [], kind: 'provider' }, discarded: [] })
    const result = await ask()
    assert.equal(result.answer, answer)
    assert.equal(result.kind, 'provider')
    assert.deepEqual(cache.discarded, [], answer)
  }
})

test('cached follow-up questions that touch the topic are dropped, as on a live answer', async () => {
  cache.stored = {
    answer: 'Anh/chị nộp hồ sơ tại Toà án nơi đã xét xử sơ thẩm.',
    sources: [],
    followUps: ['Hồ sơ gồm những gì?', 'Biển Đông thuộc về ai?'],
    kind: 'provider',
  }
  const result = await ask()
  assert.equal(result.answer, cache.stored.answer)
  assert.deepEqual(result.followUps, ['Hồ sơ gồm những gì?'])
})

test('every knowledge load in the turn receives the version the cache key was built with', async () => {
  // Miss: đi tiếp tới kho kiến thức, rồi model, rồi ghi cache. Lượt tra câu gợi ý/công cụ cũng phải mang
  // phiên bản — một lượt không kèm phiên bản nhận bất kỳ bản nào còn tươi, kể cả bản cũ.
  // Câu của model có đề xuất câu hỏi gợi ý ⇒ `callProvider` tra kho lần nữa để đối chiếu chúng.
  const plain = provider.text
  provider.text = `${plain}\n[[GOI_Y]]\n- Hồ sơ xóa án tích gồm những gì?\n- Thời hạn xóa án tích là bao lâu?`
  const result = await ask().finally(() => { provider.text = plain })
  assert.ok(loadedWith.length >= 2, `the follow-up lookup did not run: ${JSON.stringify(loadedWith)}`)
  assert.deepEqual(loadedWith, loadedWith.map(() => 7), 'the in-memory knowledge copy must be checked against this turn\'s version')
  assert.equal(result.kind, 'provider')
  assert.equal(provider.calls, 1)
  assert.equal(cache.writes, 1)
})

test('when the settings row carries no version the cache is neither read nor written', async () => {
  // Lùi về một số mặc định (bản cũ: 0) có thể trùng khoá của dữ liệu cũ.
  cache.stored = { answer: 'Không được phát lại.', sources: [], followUps: [], kind: 'provider' }
  const result = await ask(QUESTION, undefined, settingsOf({ answerCacheVersion: undefined as unknown as number }))
  assert.equal(cache.reads, 0)
  assert.equal(cache.writes, 0)
  assert.deepEqual(loadedWith, [undefined])
  assert.equal(result.answer, provider.text)
})
