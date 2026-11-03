import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * GET /api/admin/chatbot/sessions/:id — `chatbot_knowledge.read` — one visitor chat session:
 * metadata, the transcript oldest first (ties by id), at most 500 turns with `truncated`, the
 * contact submissions whose phone shares the last nine digits of the number detected in the chat,
 * and an audit row for the read (the admin's IP in it) — slice R7, task item 6.
 *
 * What is checked where. The phone match is MySQL SQL:
 *   RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 9) = ?
 * SQLite has neither function, so this suite registers both on its SQLite connection as a JS
 * reimplementation (`String#replace(/[^0-9]/g, '')`, last n characters; NULL in → NULL out) — what
 * runs here is the query's shape and the handler around it (which rows, how many, in what order,
 * the nine-digit rule), NOT MySQL's REGEXP_REPLACE: its ICU regex dialect and its behaviour on
 * the real column collation are checked on MySQL 8 only, by `mysql-session-phone.sh` in the
 * slice's proof directory (same phones, same expected matches). The compiled SQL is pinned below
 * so the reimplementation cannot drift from the query it stands in for unnoticed.
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.chatSessions, s.chatMessages, s.submissions, s.activityLogs],
  routes: async load => [
    { method: 'get', path: '/api/admin/chatbot/sessions/:id', handler: await load('../server/api/admin/chatbot/sessions/[id].get') },
  ],
})
after(() => h.server.close())
const { chatSessions, chatMessages, submissions, activityLogs } = h.schema

h.harness.sqlite.function('REGEXP_REPLACE', (value, pattern, replacement) => (
  value === null ? null : String(value).replace(new RegExp(String(pattern), 'g'), String(replacement))
))
h.harness.sqlite.function('RIGHT', (value, length) => (value === null ? null : Number(length) <= 0 ? '' : String(value).slice(-Number(length))))

type Account = Awaited<ReturnType<typeof h.account>>
let reviewer: Account
beforeEach(async () => {
  h.reset()
  reviewer = await h.account([{ resource: 'chatbot_knowledge', canRead: true }], 'xemphien')
})

const SESSION = '3f2b8c1e-0000-4000-8000-000000000001'
const T0 = Date.UTC(2026, 9, 20, 2, 0, 0)
async function session(detectedPhone: string | null, id = SESSION) {
  await h.harness.db.insert(chatSessions).values({ id, ip: '203.0.113.9', userAgent: 'Mozilla/5.0', detectedPhone, detectedName: 'Nguyễn Văn A', messageCount: 0, startedAt: new Date(T0), lastMessageAt: new Date(T0) })
}
async function submission(phone: string, minutes: number) {
  await h.harness.db.insert(submissions).values({ fullName: `Người ${phone}`, phone, email: null, formTitle: 'Liên hệ', createdAt: new Date(T0 + minutes * 60_000) })
}
const open = (id = SESSION, who: Account | null = reviewer) => h.request('GET', `/api/admin/chatbot/sessions/${id}`, who)
const related = (body: Record<string, unknown>) => (body.relatedSubmissions as Array<{ phone: string }>).map(row => row.phone)

test('chatbot_knowledge.read is required; an id over 36 characters is a 400 and an unknown one a 404 — none audited', async () => {
  await session(null)
  const other = await h.account([{ resource: 'news', canRead: true }], 'khac')
  assert.equal((await open(SESSION, null)).status, 401)
  assert.equal((await open(SESSION, other)).status, 403)
  assert.deepEqual([(await open('x'.repeat(37))).status, (await open('khong-co')).status], [400, 404])
  assert.deepEqual(h.harness.rows(activityLogs), [])
})

test('the transcript is oldest first, ties broken by id; the read is audited with the session id and the admin\'s IP', async () => {
  await session(null)
  for (const [role, content, minutes] of [['assistant', 'đáp 2', 5], ['user', 'hỏi 1', 0], ['assistant', 'đáp 1', 0], ['user', 'hỏi 2', 5]] as const) {
    await h.harness.db.insert(chatMessages).values({ sessionId: SESSION, role, content, kind: role === 'assistant' ? 'knowledge' : null, createdAt: new Date(T0 + minutes * 60_000) })
  }
  const response = await open()
  assert.equal(response.status, 200)
  assert.deepEqual((response.body.messages as Array<{ content: string }>).map(m => m.content), ['hỏi 1', 'đáp 1', 'đáp 2', 'hỏi 2'])
  assert.deepEqual([response.body.truncated, response.body.relatedSubmissions], [false, []])
  assert.deepEqual((response.body.session as Record<string, unknown>).id, SESSION)
  assert.deepEqual(h.harness.rows(activityLogs).map(row => [row.userId, row.action, row.resource, row.meta]), [[reviewer.id, 'read', 'chat_sessions', { sessionId: SESSION, ip: '127.0.0.1' }]])
})

test('a transcript over 500 turns stops at 500 and says so', async () => {
  await session(null)
  await h.harness.db.insert(chatMessages).values(Array.from({ length: 501 }, (_, n) => ({ sessionId: SESSION, role: 'user' as const, content: `câu ${n}`, createdAt: new Date(T0 + n * 1000) })))
  const response = await open()
  const messages = response.body.messages as Array<{ content: string }>
  assert.deepEqual([messages.length, messages[0]!.content, messages.at(-1)!.content, response.body.truncated], [500, 'câu 0', 'câu 499', true])
})

test('related submissions: every spelling that shares the last nine digits, newest first, at most 20; a different number never', async () => {
  await session('0903 480 985')
  const same = ['+84903480985', '0903.480.985', '84 903 480 985', '(0903) 480-985']
  for (const [n, phone] of same.entries()) await submission(phone, n)
  await submission('0903480986', 10)
  await submission('903480985 9', 11) // the same nine digits, not at the end
  const response = await open()
  assert.deepEqual(related(response.body), [...same].reverse())
  // The cap: 25 matching rows, the 20 newest.
  for (let n = 0; n < 21; n++) await submission(`0903480985`, 100 + n)
  const capped = related((await open()).body)
  assert.equal(capped.length, 20)
})

test('fewer than nine digits detected (or none) asks for no related submission at all', async () => {
  for (const phone of ['12345678', 'không có số', null]) {
    h.reset()
    reviewer = await h.account([{ resource: 'chatbot_knowledge', canRead: true }], 'xemphien')
    await session(phone)
    await submission('12345678', 0)
    h.harness.statements.length = 0
    const response = await open()
    assert.deepEqual(response.body.relatedSubmissions, [], String(phone))
    assert.ok(!h.harness.statements.some(sql => sql.includes('`submissions`')), `${phone}: no submissions query`)
  }
})

test('the phone match compiles to the MySQL expression the registered SQLite functions stand in for', async () => {
  await session('0903480985')
  h.harness.statements.length = 0
  await open()
  const query = h.harness.statements.find(sql => sql.includes('from `submissions`'))
  assert.ok(query, 'the submissions query ran')
  assert.match(query, /where RIGHT\(REGEXP_REPLACE\(`submissions`\.`phone`, '\[\^0-9\]', ''\), 9\) = \? order by `submissions`\.`created_at` desc limit \?$/)
})
