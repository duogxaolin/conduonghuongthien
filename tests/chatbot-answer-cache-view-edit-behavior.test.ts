import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `/admin/chatbot/answer-cache` — XEM toàn văn và SỬA một câu trả lời đã lưu, trên handler thật:
 * `GET …/answer-cache/:key`, `PUT …/answer-cache/:key` và đoạn xem trước ở danh sách.
 *
 * Lỗi gốc (2026-11-06): trang chỉ liệt kê câu HỎI — người quản trị không thấy được câu trả lời mà
 * cổng đang phát lại cho người dân, và cũng không có đường nào sửa một câu sai ngoài việc xoá.
 *
 * Bất biến:
 *   - xem = `chatbot_knowledge.read`; sửa = `chatbot_knowledge.update` (đọc được không sửa được);
 *   - sửa chỉ đổi `answer` + `follow_ups` (+ gia hạn hạn dùng); khoá, loại, nguồn, số lượt dùng giữ nguyên;
 *   - hàng và dòng audit commit CÙNG nhau; audit không chứa toàn văn câu trả lời;
 *   - đầu vào xấu bị TỪ CHỐI (không lặng lẽ cắt) và không để lại dòng audit;
 *   - lưu y nguyên thì không ghi gì; bản sửa là bản `readCachedAnswer` phát lại.
 */

process.env.JWT_SECRET = 'chatbot-answer-cache-view-edit-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const {
  roles, permissions, users, settings, userMfaFactors, activityLogs, chatbotAnswerCache, chatbotSettings,
} = await import('../server/db/schema')
const harness = createSqliteMysqlDb([
  roles, permissions, users, settings, userMfaFactors, activityLogs, chatbotAnswerCache, chatbotSettings,
])

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
const adminAuth = (await import('../server/middleware/admin-auth')).default
const listCache = (await import('../server/api/admin/chatbot/answer-cache/index.get')).default
const getOne = (await import('../server/api/admin/chatbot/answer-cache/[key].get')).default
const putOne = (await import('../server/api/admin/chatbot/answer-cache/[key].put')).default
const { readCachedAnswer, ANSWER_PREVIEW_CHARS, ANSWER_EDIT_MAX_CHARS, FOLLOW_UP_MAX_COUNT, FOLLOW_UP_MAX_CHARS, ANSWER_CACHE_TTL_DAYS } =
  await import('../server/services/chatbot-answer-cache')
const { signToken } = await import('../server/utils/auth')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/chatbot/answer-cache', handler: listCache },
  { method: 'get', path: '/api/admin/chatbot/answer-cache/:key', handler: getOne },
  { method: 'put', path: '/api/admin/chatbot/answer-cache/:key', handler: putOne },
], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const EDITOR: Account = { id: 1, username: 'cacheeditor', roleId: 2, roleName: 'Sửa kho chatbot' }
const READER: Account = { id: 2, username: 'cachereader', roleId: 3, roleName: 'Đọc kho chatbot' }

const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`

const keyOf = (n: number) => n.toString(16).padStart(64, '0')
const FIRST = keyOf(1)
const LONG_ANSWER = 'Điều 70 Bộ luật Hình sự quy định về xoá án tích. '.repeat(20).trim()
const SOURCES = [{ id: 7, kind: 'knowledge', source: { label: 'Điều 70', reference: 'BLHS 2015', url: null } }]
const FOLLOW_UPS = ['Xoá án tích mất bao lâu?', 'Cần giấy tờ gì?']

const call = (method: 'get' | 'put', path: string, account: Account | null, body?: unknown) =>
  server.request(method.toUpperCase(), path, { ...(account ? { cookie: cookieFor(account) } : {}), ...(body === undefined ? {} : { body }) })
const url = (key: string) => `/api/admin/chatbot/answer-cache/${key}`
const row = (key = FIRST) => harness.rows(chatbotAnswerCache).find(r => r.cacheKey === key)!
const audit = () => harness.rows(activityLogs)
const metaOf = (index: number) => audit()[index]!.meta as Record<string, unknown>

beforeEach(async () => {
  harness.reset()
  await harness.db.insert(roles).values([
    { id: EDITOR.roleId, name: EDITOR.roleName, isSystem: false },
    { id: READER.roleId, name: READER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: EDITOR.roleId, resource: 'chatbot_knowledge', canRead: true, canUpdate: true },
    { roleId: READER.roleId, resource: 'chatbot_knowledge', canRead: true },
  ])
  await harness.db.insert(users).values([EDITOR, READER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(chatbotSettings).values({ id: 1 })
  const now = new Date('2026-11-01T00:00:00Z')
  await harness.db.insert(chatbotAnswerCache).values({
    cacheKey: FIRST,
    question: 'Làm sao để xoá án tích?',
    answer: LONG_ANSWER,
    kind: 'provider',
    sources: SOURCES,
    followUps: FOLLOW_UPS,
    hits: 5,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(Date.now() + 86_400_000),
  })
})

test('the list shows the start of each answer, cut at the preview length', async () => {
  const response = await call('get', '/api/admin/chatbot/answer-cache', READER)
  assert.equal(response.status, 200)
  const item = response.body.items[0]
  assert.equal(item.answerPreview.length, ANSWER_PREVIEW_CHARS)
  assert.equal(item.answerPreview, LONG_ANSWER.slice(0, ANSWER_PREVIEW_CHARS))
  assert.equal(item.answer, undefined, 'the full answer stays out of the list payload')
})

test('detail returns the whole answer, follow-ups and sources to anyone who can read', async () => {
  const response = await call('get', url(FIRST), READER)
  assert.equal(response.status, 200)
  const { item } = response.body
  assert.equal(item.answer, LONG_ANSWER)
  assert.deepEqual(item.followUps, FOLLOW_UPS)
  assert.equal(item.sources.length, 1)
  assert.equal(item.sources[0].source.reference, 'BLHS 2015')
  assert.equal(item.hits, 5)

  const log = audit()
  assert.equal(log.length, 1, 'one audit row per read')
  assert.equal(metaOf(0).type, 'answer_cache_view')
  assert.equal(JSON.stringify(log[0]).includes('Điều 70'), false, 'the audit row never carries the answer text')
})

test('detail refuses without a session, for a malformed key, and for a key that is gone', async () => {
  assert.equal((await call('get', url(FIRST), null)).status, 401)
  assert.equal((await call('get', url('not-a-key'), READER)).status, 400)
  assert.equal((await call('get', url(keyOf(99)), READER)).status, 404)
  assert.equal(audit().length, 0, 'a refused read writes no audit row')
})

test('editing takes update: a reader changes nothing, the editor changes the answer', async () => {
  const body = { answer: 'Bản đã chỉnh.', followUps: ['Hỏi thêm gì?'] }
  assert.equal((await call('put', url(FIRST), READER, body)).status, 403)
  assert.equal((await call('put', url(FIRST), null, body)).status, 401)
  assert.equal(row().answer, LONG_ANSWER, 'the reader\'s attempt changed nothing')
  assert.equal(audit().length, 0)

  const response = await call('put', url(FIRST), EDITOR, body)
  assert.equal(response.status, 200)
  assert.equal(response.body.changed, true)
  assert.equal(response.body.item.answer, 'Bản đã chỉnh.')
  assert.equal(row().answer, 'Bản đã chỉnh.')
  assert.deepEqual(row().followUps, ['Hỏi thêm gì?'])
})

test('an edit keeps the key, kind, sources and hit count; extends expiry; and audits without the text', async () => {
  const before = row()
  const response = await call('put', url(FIRST), EDITOR, { answer: 'Câu trả lời mới, đã duyệt.', followUps: FOLLOW_UPS })
  assert.equal(response.status, 200)

  const after = row()
  assert.equal(after.cacheKey, FIRST)
  assert.equal(after.question, before.question, 'the question is not editable — it is part of what the key means')
  assert.equal(after.kind, 'provider')
  assert.equal(after.hits, 5)
  assert.deepEqual(after.sources, SOURCES)
  const ttl = ANSWER_CACHE_TTL_DAYS * 86_400_000
  assert.ok(Math.abs(new Date(after.expiresAt).getTime() - (Date.now() + ttl)) < 60_000, 'expiry extended by one TTL')

  assert.equal(audit().length, 1)
  assert.equal(audit()[0]!.action, 'update')
  assert.equal(audit()[0]!.userId, EDITOR.id)
  assert.equal(metaOf(0).type, 'answer_cache_update')
  assert.equal(metaOf(0).changedAnswer, true)
  assert.equal(metaOf(0).changedFollowUps, false)
  assert.equal(metaOf(0).answerLengthBefore, LONG_ANSWER.length)
  assert.equal(JSON.stringify(audit()[0]).includes('đã duyệt'), false, 'the new text is not copied into the log')
})

test('the edited answer is what readCachedAnswer replays to the next visitor', async () => {
  await call('put', url(FIRST), EDITOR, { answer: 'Đây là bản được sửa tay.', followUps: [] })
  const replayed = await readCachedAnswer(FIRST)
  assert.equal(replayed?.answer, 'Đây là bản được sửa tay.')
  assert.deepEqual(replayed?.followUps, [])
  assert.equal(replayed?.sources.length, 1, 'sources survive the edit')
})

test('input is normalised: CRLF, surrounding blanks, empty and repeated follow-ups', async () => {
  const response = await call('put', url(FIRST), EDITOR, {
    answer: '  Dòng một\r\nDòng hai  ',
    followUps: ['  Câu   A ', '', 'Câu A', '   ', 'Câu B'],
  })
  assert.equal(response.status, 200)
  assert.equal(row().answer, 'Dòng một\nDòng hai')
  assert.deepEqual(row().followUps, ['Câu A', 'Câu B'])
})

test('saving the same content writes nothing and leaves no audit row', async () => {
  const before = row()
  const response = await call('put', url(FIRST), EDITOR, { answer: LONG_ANSWER, followUps: FOLLOW_UPS })
  assert.equal(response.status, 200)
  assert.equal(response.body.changed, false)
  assert.equal(new Date(row().expiresAt).getTime(), new Date(before.expiresAt).getTime(), 'expiry untouched')
  assert.equal(audit().length, 0)
})

test('bad input is refused outright — never trimmed to fit — and changes nothing', async () => {
  const tooManyFollowUps = Array.from({ length: FOLLOW_UP_MAX_COUNT + 1 }, (_, index) => `Câu gợi ý ${index}`)
  const cases: Array<[string, unknown]> = [
    ['empty answer', { answer: '   ' }],
    ['missing answer', { followUps: [] }],
    ['non-string answer', { answer: 42 }],
    ['answer over the cap', { answer: 'x'.repeat(ANSWER_EDIT_MAX_CHARS + 1) }],
    ['too many follow-ups', { answer: 'ok', followUps: tooManyFollowUps }],
    ['follow-up over the cap', { answer: 'ok', followUps: ['y'.repeat(FOLLOW_UP_MAX_CHARS + 1)] }],
    ['follow-ups not a list', { answer: 'ok', followUps: 'a,b' }],
    ['non-string follow-up', { answer: 'ok', followUps: [1] }],
  ]
  for (const [name, body] of cases) {
    assert.equal((await call('put', url(FIRST), EDITOR, body)).status, 400, name)
  }
  assert.equal((await call('put', url('nope'), EDITOR, { answer: 'ok' })).status, 400, 'malformed key')
  assert.equal(row().answer, LONG_ANSWER)
  assert.deepEqual(row().followUps, FOLLOW_UPS)
  assert.equal(audit().length, 0, 'no refused edit leaves an audit row')
})

test('a key that is gone is a 404 with no audit row', async () => {
  const response = await call('put', url(keyOf(99)), EDITOR, { answer: 'Không có hàng này.' })
  assert.equal(response.status, 404)
  assert.equal(audit().length, 0)
})

test('if the audit row cannot be written, the answer is not changed', async () => {
  harness.failNext(/^insert into `activity_logs`/)
  const response = await call('put', url(FIRST), EDITOR, { answer: 'Sẽ bị huỷ cùng audit.', followUps: [] })
  assert.equal(response.status, 500)
  assert.equal(row().answer, LONG_ANSWER, 'row and audit commit together')
  assert.deepEqual(row().followUps, FOLLOW_UPS)
})
