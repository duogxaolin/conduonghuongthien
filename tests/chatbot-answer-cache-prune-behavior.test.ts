import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'
import { eq } from 'drizzle-orm'

/**
 * Lượt dọn cache câu trả lời (`server/services/chatbot-answer-cache-prune.ts`) trên SQL thật (SQLite).
 *
 * Lỗi gốc (2026-11-06): `pruneAnswerCache` không được gọi ở đâu. Mỗi lần tăng phiên bản (sửa bài, sửa kho)
 * để lại toàn bộ hàng cũ — không tra tới được nhưng vẫn giữ câu hỏi của người dân VÔ THỜI HẠN, ngoài phạm
 * vi lưu giữ `chat_sessions`; trần 20 000 hàng không có tác dụng.
 *
 * Bất biến: hàng hết hạn, hàng chết (khoá dựng lại từ câu hỏi + cấu hình + phiên bản hiện tại không khớp)
 * và phần vượt trần bị xoá; hàng còn sống thì giữ — kể cả hàng sửa tay còn sống.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { chatbotAnswerCache, chatbotSettings } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([chatbotAnswerCache, chatbotSettings])

const pool = { current: null as object | null }
mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => pool.current } })

const { answerCacheKey } = await import('../server/services/chatbot-answer-cache')
const { pruneAnswerCache, reportAnswerCachePrune } = await import('../server/services/chatbot-answer-cache-prune')

const SETTINGS = {
  mode: 'ai',
  outOfScopeBehavior: 'ai_freeform',
  model: 'delify-5.5',
  baseUrl: 'https://router.delify.vn/v1',
  systemPrompt: 'Chỉ trả lời theo tài liệu đã duyệt.',
}
const VERSION = 5
const DAY = 86_400_000

const keyFor = (question: string, version = VERSION, settings = SETTINGS) =>
  answerCacheKey({ question, settings, version, historyLength: 1 })!

async function put(cacheKey: string, question: string, expiresInMs = DAY) {
  const now = new Date()
  await harness.db.insert(chatbotAnswerCache).values({
    cacheKey, question, answer: `Trả lời: ${question}`, kind: 'provider', sources: [], followUps: [], hits: 0,
    createdAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + expiresInMs),
  })
}
const keys = () => harness.rows(chatbotAnswerCache).map(row => row.cacheKey).sort()

beforeEach(async () => {
  harness.reset()
  pool.current = null
  await harness.db.insert(chatbotSettings).values({ id: 1, ...SETTINGS, answerCacheVersion: VERSION })
})

test('expired, dead and unparseable rows go; live rows stay', async () => {
  const live = keyFor('Làm sao để xóa án tích?')
  const alsoLive = keyFor('Vay vốn ở đâu?')
  const oldVersion = keyFor('Thủ tục đăng ký tạm trú?', VERSION - 1)
  const oldModel = keyFor('Hỏi về việc làm', VERSION, { ...SETTINGS, model: 'model-cu' })
  const expired = keyFor('Câu đã hết hạn')
  const junk = 'f'.repeat(64)
  await put(live, 'Làm sao để xóa án tích?')
  await put(alsoLive, 'Vay vốn ở đâu?')
  await put(oldVersion, 'Thủ tục đăng ký tạm trú?')
  await put(oldModel, 'Hỏi về việc làm')
  await put(expired, 'Câu đã hết hạn', -DAY)
  await put(junk, 'Hàng không dựng lại được khoá')

  const result = await pruneAnswerCache()

  assert.deepEqual(keys(), [live, alsoLive].sort())
  assert.deepEqual(result, { expired: 1, dead: 3, overCap: 0 })
})

test('a version bump turns every existing row dead at the next pass', async () => {
  await put(keyFor('Làm sao để xóa án tích?'), 'Làm sao để xóa án tích?')
  await put(keyFor('Vay vốn ở đâu?'), 'Vay vốn ở đâu?')
  await harness.db.update(chatbotSettings).set({ answerCacheVersion: VERSION + 1 })

  const result = await pruneAnswerCache()
  assert.deepEqual(keys(), [])
  assert.equal(result.dead, 2)
})

test('the report never throws and says when there is no database', async () => {
  assert.deepEqual(await reportAnswerCachePrune(), { ran: false, skipped: 'no-database' })

  pool.current = {}
  await put(keyFor('Câu cũ', VERSION - 1), 'Câu cũ')
  assert.deepEqual(await reportAnswerCachePrune(), { ran: true, expired: 0, dead: 1, overCap: 0 })

  // CSDL hỏng giữa chừng: lỗi thành báo cáo, không thành rejection của timer.
  const original = harness.db.select.bind(harness.db)
  harness.db.select = (() => { throw new Error('connection lost') }) as typeof harness.db.select
  try {
    assert.deepEqual(await reportAnswerCachePrune(), { ran: false, error: 'connection lost' })
  } finally {
    harness.db.select = original
  }
})

test('over the row cap, the least recently used live rows go first', async () => {
  const questions = ['Câu một', 'Câu hai', 'Câu ba']
  for (const [index, question] of questions.entries()) {
    await put(keyFor(question), question)
    // Câu một dùng lâu nhất về trước, câu ba gần nhất.
    await harness.db.update(chatbotAnswerCache)
      .set({ lastUsedAt: new Date(Date.UTC(2026, 10, 1 + index)) })
      .where(eq(chatbotAnswerCache.cacheKey, keyFor(question)))
  }
  const result = await pruneAnswerCache({ maxRows: 2 })
  assert.deepEqual(result, { expired: 0, dead: 0, overCap: 1 })
  assert.deepEqual(keys(), [keyFor('Câu hai'), keyFor('Câu ba')].sort())
})

test('the dead-row scan pages through the table and still finds every dead row', async () => {
  const live = ['Câu một', 'Câu hai', 'Câu ba'].map(question => keyFor(question))
  for (const [index, question] of ['Câu một', 'Câu hai', 'Câu ba'].entries()) await put(live[index]!, question)
  for (const question of ['Cũ một', 'Cũ hai', 'Cũ ba', 'Cũ bốn']) await put(keyFor(question, VERSION - 1), question)
  const result = await pruneAnswerCache({ pageSize: 2 })
  assert.equal(result.dead, 4)
  assert.deepEqual(keys(), [...live].sort())
})
