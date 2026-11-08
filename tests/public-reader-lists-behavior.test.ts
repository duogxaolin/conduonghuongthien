import assert from 'node:assert/strict'
import test, { after, before, mock } from 'node:test'

/**
 * The two lists of the reader's profile page, run as the real handlers (real h3 app, the real
 * `requireReader` — signed `cdkt_reader` cookie + `reader_accounts` row —, Drizzle's own MySQL
 * statements executed on SQLite, tests/_sqlite-mysql-db.ts). Until now only the text of one
 * subquery was pinned (tests/correlated-subquery-qualification.test.ts); this file pins what a
 * signed-in reader gets back:
 *
 *   - `GET /api/public/reader/chats` — only the caller's conversations, most recent first, at
 *     most 20, each titled by its FIRST visitor question (first 120 characters, trimmed; the
 *     assistant's opening line never; no question → the fallback title);
 *   - `GET /api/public/reader/comments` — only the caller's comments that are not hidden,
 *     newest first, counted with the same condition; the page is clamped to the last one and
 *     the page size to 20; each comment carries its reply count, whether it is itself a reply,
 *     and whether its article still shows the thread (`readable`) — an article that is gone is
 *     `article: null`;
 *   - neither answers without a signed-in reader (401).
 */

process.env.JWT_SECRET = 'public-reader-lists-behavior-test-secret-0123456789'

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { readerAccounts, chatSessions, chatMessages, articleComments, articles } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([readerAccounts, chatSessions, chatMessages, articleComments, articles])
// MySQL's LEFT(str, n); SQLite has no such function. Same result for the strings used here.
harness.sqlite.function('LEFT', { deterministic: true }, (value, length) => (value === null ? null : String(value).slice(0, Number(length))))

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
const chats = (await import('../server/api/public/reader/chats.get')).default
const comments = (await import('../server/api/public/reader/comments.get')).default
const { signReaderToken } = await import('../server/utils/auth')

const server = await startHandlerServer([
  { method: 'get', path: '/api/public/reader/chats', handler: chats },
  { method: 'get', path: '/api/public/reader/comments', handler: comments },
])
after(() => server.close())

const ALICE = 21
const BOB = 22
const cookie = (readerId: number) => `cdkt_reader=${signReaderToken({ readerId, tokenVersion: 0 })}`
const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 3, minute))

before(async () => {
  harness.reset()
  await harness.db.insert(readerAccounts).values([{ id: ALICE, googleSub: 'google-alice' }, { id: BOB, googleSub: 'google-bob' }])

  // ── Conversations ──────────────────────────────────────────────────────────
  // Alice: 22 sessions (s01 … s22, s22 the most recent), so the cap of 20 drops s01 and s02.
  const sessions = Array.from({ length: 22 }, (_, index) => {
    const n = index + 1
    return { id: `s${String(n).padStart(2, '0')}`, readerId: ALICE, messageCount: n, startedAt: at(n), lastMessageAt: at(n + 30) }
  })
  await harness.db.insert(chatSessions).values([
    ...sessions,
    { id: 'bob-1', readerId: BOB, messageCount: 4, startedAt: at(1), lastMessageAt: at(59) },
    { id: 'nobody', readerId: null, messageCount: 2, startedAt: at(1), lastMessageAt: at(58) },
  ])
  const longQuestion = `  ${'Xin hỏi về thủ tục xoá án tích '.repeat(6)}  `
  await harness.db.insert(chatMessages).values([
    // s22: the assistant spoke first; the title is the visitor's first question, not the greeting.
    { sessionId: 's22', role: 'assistant', content: 'Xin chào, tôi có thể giúp gì?', createdAt: at(1) },
    { sessionId: 's22', role: 'user', content: '  Tôi muốn vay vốn  ', createdAt: at(2) },
    { sessionId: 's22', role: 'user', content: 'Câu thứ hai', createdAt: at(3) },
    // s21: a question longer than 120 characters is cut at 120, then trimmed.
    { sessionId: 's21', role: 'user', content: longQuestion, createdAt: at(1) },
    // s20: only the assistant spoke — fallback title.
    { sessionId: 's20', role: 'assistant', content: 'Chào bạn', createdAt: at(1) },
    // Bob's question must never title anything of Alice's.
    { sessionId: 'bob-1', role: 'user', content: 'Câu của Bob', createdAt: at(1) },
  ])

  // ── Comments ───────────────────────────────────────────────────────────────
  await harness.db.insert(articles).values([
    { id: 1, slug: 'bai-mo', title: 'Bài mở', status: 'published', commentsEnabled: true, type: 'document' },
    { id: 2, slug: 'bai-dong', title: 'Bài đã tắt bình luận', status: 'published', commentsEnabled: false },
    { id: 3, slug: 'bai-nhap', title: 'Bài đã gỡ', status: 'draft', commentsEnabled: true },
  ])
  const comment = (id: number, over: Partial<typeof articleComments.$inferInsert>) => ({ id, articleId: 1, readerId: ALICE, body: `Bình luận ${id}`, createdAt: at(id), ...over })
  await harness.db.insert(articleComments).values([
    comment(1, {}),
    comment(2, { articleId: 2 }),
    comment(3, { articleId: 3 }),
    comment(4, { isHidden: true }),
    comment(5, { readerId: BOB }),
    comment(6, { readerId: null, adminUserId: 1, parentId: 1, body: 'Trả lời của cổng' }),
    comment(7, { readerId: BOB, parentId: 1 }),
    comment(8, { parentId: 5, body: 'Alice trả lời Bob' }),
    comment(9, { articleId: 99, body: 'Bài không còn' }),
    // Same createdAt as 9: the id breaks the tie (newest id first).
    comment(10, { articleId: 1, createdAt: at(9) }),
  ])
})

type ChatsBody = { ok: boolean, sessions: Array<{ id: string, title: string, messageCount: number, startedAt: string | null, lastMessageAt: string | null }> }
type CommentsBody = {
  ok: boolean, total: number, page: number, perPage: number, totalPages: number,
  comments: Array<{ id: number, body: string, createdAt: string | null, isReply: boolean, replyCount: number, article: null | { title: string, slug: string, readable: boolean, url: string } }>
}

test('chats: signed out is a 401', async () => {
  assert.equal((await server.request('GET', '/api/public/reader/chats')).status, 401)
  assert.equal((await server.request('GET', '/api/public/reader/comments')).status, 401)
})

test('chats: only the caller\'s conversations, most recent first, at most 20', async () => {
  const response = await server.request('GET', '/api/public/reader/chats', { cookie: cookie(ALICE) })
  assert.equal(response.status, 200)
  const body = response.body as unknown as ChatsBody
  assert.equal(body.ok, true)
  assert.deepEqual(body.sessions.map(row => row.id), Array.from({ length: 20 }, (_, index) => `s${String(22 - index).padStart(2, '0')}`))
  const s22 = body.sessions[0]!
  assert.equal(s22.messageCount, 22)
  assert.equal(s22.startedAt, at(22).toISOString())
  assert.equal(s22.lastMessageAt, at(52).toISOString())

  const bob = (await server.request('GET', '/api/public/reader/chats', { cookie: cookie(BOB) })).body as unknown as ChatsBody
  assert.deepEqual(bob.sessions, [{ id: 'bob-1', title: 'Câu của Bob', messageCount: 4, startedAt: at(1).toISOString(), lastMessageAt: at(59).toISOString() }])
})

test('chats: titled by the visitor\'s first question, cut at 120 characters; fallback otherwise', async () => {
  const body = (await server.request('GET', '/api/public/reader/chats', { cookie: cookie(ALICE) })).body as unknown as ChatsBody
  const title = (id: string) => body.sessions.find(row => row.id === id)!.title
  assert.equal(title('s22'), 'Tôi muốn vay vốn', 'the first USER message, trimmed — not the assistant greeting, not the second question')
  const expected = `  ${'Xin hỏi về thủ tục xoá án tích '.repeat(6)}  `.slice(0, 120).trim()
  assert.equal(title('s21'), expected)
  assert.equal(title('s20'), 'Cuộc trò chuyện', 'no visitor question → the fallback title')
  assert.equal(title('s19'), 'Cuộc trò chuyện')
})

test('comments: only the caller\'s visible comments, newest first, with reply counts and article state', async () => {
  const response = await server.request('GET', '/api/public/reader/comments', { cookie: cookie(ALICE) })
  assert.equal(response.status, 200)
  const body = response.body as unknown as CommentsBody
  assert.equal(body.total, 6, 'hidden comments and other readers\' comments are not counted')
  assert.equal(body.page, 1)
  assert.equal(body.perPage, 10)
  assert.equal(body.totalPages, 1)
  assert.deepEqual(body.comments.map(row => row.id), [10, 9, 8, 3, 2, 1], 'newest first; the id breaks a tie')
  const byId = Object.fromEntries(body.comments.map(row => [row.id, row]))
  assert.equal(byId[1]!.replyCount, 2, 'the portal\'s reply and Bob\'s reply')
  assert.equal(byId[1]!.isReply, false)
  assert.deepEqual(byId[1]!.article, { title: 'Bài mở', slug: 'bai-mo', readable: true, url: '/news/bai-mo' })
  assert.equal(byId[8]!.isReply, true)
  assert.equal(byId[8]!.replyCount, 0)
  assert.equal(byId[2]!.article!.readable, false, 'comments turned off')
  assert.equal(byId[3]!.article!.readable, false, 'article no longer published')
  assert.equal(byId[9]!.article, null, 'the article is gone')
  assert.equal(byId[10]!.createdAt, at(9).toISOString())
})

test('comments: page size capped at 20, page clamped to the last page', async () => {
  const capped = (await server.request('GET', '/api/public/reader/comments?perPage=500', { cookie: cookie(ALICE) })).body as unknown as CommentsBody
  assert.equal(capped.perPage, 20)
  const first = (await server.request('GET', '/api/public/reader/comments?perPage=4', { cookie: cookie(ALICE) })).body as unknown as CommentsBody
  assert.deepEqual({ page: first.page, totalPages: first.totalPages, ids: first.comments.map(row => row.id) }, { page: 1, totalPages: 2, ids: [10, 9, 8, 3] })
  const second = (await server.request('GET', '/api/public/reader/comments?perPage=4&page=2', { cookie: cookie(ALICE) })).body as unknown as CommentsBody
  assert.deepEqual({ page: second.page, totalPages: second.totalPages, ids: second.comments.map(row => row.id) }, { page: 2, totalPages: 2, ids: [2, 1] })
  const beyond = (await server.request('GET', '/api/public/reader/comments?perPage=4&page=99', { cookie: cookie(ALICE) })).body as unknown as CommentsBody
  assert.deepEqual({ page: beyond.page, ids: beyond.comments.map(row => row.id) }, { page: 2, ids: [2, 1] }, 'a page past the end is the last page')
  const bob = (await server.request('GET', '/api/public/reader/comments', { cookie: cookie(BOB) })).body as unknown as CommentsBody
  assert.deepEqual(bob.comments.map(row => row.id), [7, 5])
})
