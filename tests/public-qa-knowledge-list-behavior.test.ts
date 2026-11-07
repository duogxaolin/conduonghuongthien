import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `GET /api/public/chatbot/knowledge` (server/api/public/chatbot/knowledge.get.ts) — the approved
 * knowledge bank as a public list, behind `/qa-documents`. Run as the real handler: real h3 app,
 * Drizzle's own MySQL statements executed on SQLite (tests/_sqlite-mysql-db.ts).
 *
 * Invariants:
 *   - only `published` rows are served — not drafts, not archived — in the list, in the total
 *     and in the topic facet (a facet built from the whole table advertises topics that open an
 *     empty list);
 *   - an item carries exactly `id, question, answer, topic, source`: no internal notes, author or
 *     reviewer ids, status, priority — whatever columns the table grows later;
 *   - `perPage` is capped at 50 (and floored at 1), a non-numeric `page`/`perPage` falls back
 *     instead of becoming NaN, and an unknown topic or search is an empty page, not an error;
 *   - a failed query is a 503 `ok: false` with `no-store`, never an empty bank.
 *
 * Before this file these were pinned by reading the handler's source in
 * `tests/public-qa-documents-page.test.ts` (docs/decisions/test-strategy.md). The page half of
 * that file (loading/error/empty template, accordion, deep link) stays there: it is structure.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { chatbotKnowledge } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([chatbotKnowledge])

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const handler = (await import('../server/api/public/chatbot/knowledge.get')).default
const server = await startHandlerServer([{ method: 'get', path: '/api/public/chatbot/knowledge', handler }])
after(() => server.close())

type Row = typeof chatbotKnowledge.$inferInsert
const row = (over: Partial<Row> & Pick<Row, 'canonicalQuestion' | 'topic' | 'status'>): Row => ({
  normalizedQuestion: over.canonicalQuestion.toLowerCase(),
  approvedAnswer: `Trả lời cho ${over.canonicalQuestion}`,
  sourceLabel: 'Luật Thi hành án hình sự',
  internalNotes: 'INTERNAL-NOTE-SENTINEL',
  authorId: 77,
  reviewerId: 88,
  priority: 0,
  ...over,
})

type Item = Record<string, unknown>
type ListBody = { ok: boolean, items: Item[], topics: Array<{ topic: string, total: number }>, pagination: { page: number, perPage: number, total: number, totalPages: number } }
const list = async (query = '') => {
  const response = await server.request('GET', `/api/public/chatbot/knowledge${query}`)
  return { ...response, body: response.body as unknown as ListBody }
}

beforeEach(async () => {
  harness.reset()
  await harness.db.insert(chatbotKnowledge).values([
    row({ canonicalQuestion: 'Hoàn lương là gì', topic: 'Hoàn lương', status: 'published', priority: 5 }),
    row({ canonicalQuestion: 'Xoá án tích khi nào', topic: 'Pháp luật', status: 'published', priority: 3 }),
    row({ canonicalQuestion: 'Vay vốn ưu đãi', topic: 'Pháp luật', status: 'published', priority: 1, sourceUrl: 'http://insecure.example/x', sourceLabel: null }),
    row({ canonicalQuestion: 'DRAFT-ONLY-WORD chưa duyệt', topic: 'Chỉ có bản nháp', status: 'draft', priority: 99 }),
    row({ canonicalQuestion: 'Đã lưu trữ ARCHIVED-ONLY-WORD', topic: 'Chỉ có bản lưu trữ', status: 'archived', priority: 98 }),
    row({ canonicalQuestion: 'Bản nháp cùng chủ đề', topic: 'Pháp luật', status: 'draft', priority: 97 }),
  ])
})

test('only published rows are listed and counted — not drafts, not archived', async () => {
  const { status, body } = await list()
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.items.map(item => item.question), ['Hoàn lương là gì', 'Xoá án tích khi nào', 'Vay vốn ưu đãi'], 'highest priority first, published only')
  assert.equal(body.pagination.total, 3, 'the total counts published rows only')
  assert.equal(body.pagination.totalPages, 1)
})

test('a topic filter and a search never reach an unpublished row', async () => {
  assert.deepEqual((await list('?topic=' + encodeURIComponent('Chỉ có bản nháp'))).body.items, [])
  assert.deepEqual((await list('?topic=' + encodeURIComponent('Chỉ có bản lưu trữ'))).body.items, [])
  assert.deepEqual((await list('?search=DRAFT-ONLY-WORD')).body.items, [])
  assert.deepEqual((await list('?search=ARCHIVED-ONLY-WORD')).body.items, [])
  const sameTopic = await list('?topic=' + encodeURIComponent('Pháp luật'))
  assert.deepEqual(sameTopic.body.items.map(item => item.question), ['Xoá án tích khi nào', 'Vay vốn ưu đãi'], 'a draft in a published topic stays out')
  assert.equal(sameTopic.body.pagination.total, 2)
})

test('the topic facet counts published rows only: a topic with nothing published is not offered', async () => {
  const { body } = await list()
  assert.deepEqual(body.topics, [{ topic: 'Pháp luật', total: 2 }, { topic: 'Hoàn lương', total: 1 }])
})

test('an item carries exactly id, question, answer, topic, source — no internal field, whatever the table grows', async () => {
  const { body } = await list()
  for (const item of body.items) {
    assert.deepEqual(Object.keys(item).sort(), ['answer', 'id', 'question', 'source', 'topic'])
  }
  const wire = JSON.stringify(body)
  for (const secret of ['INTERNAL-NOTE-SENTINEL', 'internalNotes', 'authorId', 'reviewerId', '"status"', '"priority"', 'normalizedQuestion']) {
    assert.ok(!wire.includes(secret), `${secret} left the server`)
  }
  const [first, , insecure] = body.items
  assert.deepEqual(first!.source, { label: 'Luật Thi hành án hình sự', reference: null, url: null })
  assert.equal((insecure!.source as { url: unknown } | null)?.url ?? null, null, 'a non-https source link is not handed out')
})

test('perPage is capped at 50 and floored at 1; a non-numeric value falls back to 20', async () => {
  await harness.db.insert(chatbotKnowledge).values(
    Array.from({ length: 60 }, (_, index) => row({ canonicalQuestion: `Câu hỏi số ${index}`, topic: 'Hàng loạt', status: 'published', priority: -index - 1 })),
  )
  const capped = await list('?perPage=9999')
  assert.equal(capped.body.items.length, 50)
  assert.equal(capped.body.pagination.perPage, 50)
  assert.equal(capped.body.pagination.total, 63)
  assert.equal(capped.body.pagination.totalPages, 2)
  for (const [query, expected] of [['?perPage=0', 1], ['?perPage=-4', 1], ['?perPage=abc', 20], ['?perPage=Infinity', 20]] as const) {
    const { body } = await list(query)
    assert.equal(body.pagination.perPage, expected, query)
    assert.equal(body.items.length, expected, query)
  }
})

test('a non-numeric or out-of-range page falls back to page 1 instead of NaN', async () => {
  for (const query of ['?page=abc', '?page=0', '?page=-3', '?page=', '?page=NaN']) {
    const { status, body } = await list(query)
    assert.equal(status, 200, query)
    assert.equal(body.pagination.page, 1, `${query}: page must be a number, not null`)
    assert.equal(body.items.length, 3, query)
  }
  const second = await list('?perPage=2&page=2')
  assert.equal(second.body.pagination.page, 2)
  assert.deepEqual(second.body.items.map(item => item.question), ['Vay vốn ưu đãi'])
})

test('an unknown topic or search is an empty page with ok: true, never an error', async () => {
  for (const query of ['?topic=khong-ton-tai', '?search=khong-ton-tai-trong-kho']) {
    const { status, body } = await list(query)
    assert.equal(status, 200, query)
    assert.equal(body.ok, true)
    assert.deepEqual(body.items, [])
    assert.equal(body.pagination.total, 0)
  }
})

test('a failed query is a 503 ok:false with no-store, distinguishable from an empty bank', async () => {
  harness.failNext(/from `chatbot_knowledge`/)
  const failed = await list()
  assert.equal(failed.status, 503)
  assert.equal(failed.body.ok, false)
  assert.deepEqual(failed.body.items, [])
  assert.match(failed.headers.get('cache-control') ?? '', /no-store/)

  harness.reset()
  const empty = await list()
  assert.equal(empty.status, 200)
  assert.equal(empty.body.ok, true, 'an empty bank is ok: true — the two must not look alike')
})
