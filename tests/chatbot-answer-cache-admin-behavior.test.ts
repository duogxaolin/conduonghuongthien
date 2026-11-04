import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * Trang `/admin/chatbot/answer-cache` — ba đường GHI của nó, chạy trên handler thật:
 * `DELETE …/answer-cache/:key`, `POST …/bulk-delete`, `POST …/clear-all`.
 *
 * Bộ đệm chỉ là bản phát lại của câu trả lời model, nên "xoá hỏng" không làm mất dữ
 * liệu nghiệp vụ — nhưng ba bất biến vẫn phải cùng đúng:
 *   - quyền là `chatbot_knowledge.delete`; `chatbot_knowledge.read` (đủ để XEM danh
 *     sách) không xoá được gì;
 *   - chỉ hàng có thật mới vào `deleted` (id gửi trùng, id lạ, mã sai định dạng);
 *   - hàng và dòng audit commit CÙNG nhau: audit không ghi được thì hàng còn nguyên.
 *
 * h3 thật + middleware `admin-auth` thật (vai trò/quyền đọc từ DB); SQL của Drizzle
 * chạy trên SQLite (`_sqlite-mysql-db.ts`, transaction thật).
 */

process.env.JWT_SECRET = 'chatbot-answer-cache-admin-behavior-test-secret-0123456789'
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
const deleteOne = (await import('../server/api/admin/chatbot/answer-cache/[key].delete')).default
const bulkDelete = (await import('../server/api/admin/chatbot/answer-cache/bulk-delete.post')).default
const clearAll = (await import('../server/api/admin/chatbot/answer-cache/clear-all.post')).default
const listCache = (await import('../server/api/admin/chatbot/answer-cache/index.get')).default
const { signToken } = await import('../server/utils/auth')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/chatbot/answer-cache', handler: listCache },
  { method: 'delete', path: '/api/admin/chatbot/answer-cache/:key', handler: deleteOne },
  { method: 'post', path: '/api/admin/chatbot/answer-cache/bulk-delete', handler: bulkDelete },
  { method: 'post', path: '/api/admin/chatbot/answer-cache/clear-all', handler: clearAll },
], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const DELETER: Account = { id: 1, username: 'cachedeleter', roleId: 2, roleName: 'Xoá kho chatbot' }
const READER: Account = { id: 2, username: 'cachereader', roleId: 3, roleName: 'Đọc kho chatbot' }

const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`

/**
 * Một khoá cache hợp lệ (64 ký tự hex) và KHÁC NHAU cho mỗi `n`. `String(n).repeat(…)`
 * từng làm `keyOf(1)` và `keyOf(11)` ra cùng một chuỗi `'1'.repeat(64)`: bài kiểm trần
 * khi đó gửi 201 id mà chỉ có 200 id khác nhau, và trần không bao giờ bị chạm.
 */
const keyOf = (n: number) => n.toString(16).padStart(64, '0')

const cacheKeys = () => harness.rows(chatbotAnswerCache).map(row => row.cacheKey).sort()
const auditRows = () => harness.rows(activityLogs)

const call = (method: 'get' | 'delete' | 'post', path: string, account: Account | null, body?: unknown) =>
  server.request(method.toUpperCase(), path, { ...(account ? { cookie: cookieFor(account) } : {}), ...(body === undefined ? {} : { body }) })

beforeEach(async () => {
  harness.reset()
  await harness.db.insert(roles).values([
    { id: DELETER.roleId, name: DELETER.roleName, isSystem: false },
    { id: READER.roleId, name: READER.roleName, isSystem: false },
  ])
  await harness.db.insert(permissions).values([
    { roleId: DELETER.roleId, resource: 'chatbot_knowledge', canRead: true, canDelete: true },
    { roleId: READER.roleId, resource: 'chatbot_knowledge', canRead: true },
  ])
  await harness.db.insert(users).values([DELETER, READER].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(chatbotSettings).values({ id: 1 })
  const now = new Date()
  await harness.db.insert(chatbotAnswerCache).values([1, 2, 3].map(n => ({
    cacheKey: keyOf(n),
    question: `Câu hỏi số ${n}`,
    answer: `Câu trả lời số ${n}`,
    kind: 'provider',
    sources: [],
    followUps: [],
    hits: n,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
  })))
})

test('reading the list takes read only; deleting takes delete — a reader deletes nothing', async () => {
  assert.equal((await call('get', '/api/admin/chatbot/answer-cache', READER)).status, 200, 'reader may list')
  const before = cacheKeys()

  assert.equal((await call('delete', `/api/admin/chatbot/answer-cache/${keyOf(1)}`, READER)).status, 403)
  assert.equal((await call('post', '/api/admin/chatbot/answer-cache/bulk-delete', READER, { keys: [keyOf(2)] })).status, 403)
  assert.equal((await call('post', '/api/admin/chatbot/answer-cache/clear-all', READER)).status, 403)
  assert.equal((await call('get', '/api/admin/chatbot/answer-cache', null)).status, 401, 'no session, no data')

  assert.deepEqual(cacheKeys(), before, 'nothing went away')
})

test('one delete removes only that row, and `deleted` counts rows actually removed', async () => {
  const response = await call('delete', `/api/admin/chatbot/answer-cache/${keyOf(2)}`, DELETER)
  assert.equal(response.status, 200)
  assert.equal(response.body.deleted, 1)
  assert.deepEqual(cacheKeys(), [keyOf(1), keyOf(3)])

  const audit = auditRows()
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.userId, DELETER.id)
  assert.equal(audit[0]!.action, 'delete')
  assert.equal(audit[0]!.resource, 'chatbot_knowledge')
  const meta = audit[0]!.meta as Record<string, unknown>
  assert.equal(meta.type, 'answer_cache_delete')
  assert.equal(meta.cacheKey, keyOf(2))
  assert.equal(meta.question, 'Câu hỏi số 2', 'audit says which answer went away')
})

test('an already-gone key and a malformed key each touch nothing', async () => {
  assert.equal((await call('delete', `/api/admin/chatbot/answer-cache/${keyOf(1)}`, DELETER)).status, 200)
  const before = cacheKeys()
  const audited = auditRows().length

  // Same key again: a 404, not a second "deleted: 1" in the log.
  const again = await call('delete', `/api/admin/chatbot/answer-cache/${keyOf(1)}`, DELETER)
  assert.equal(again.status, 404)
  // Not 64 hex characters: rejected before it reaches the database.
  assert.equal((await call('delete', '/api/admin/chatbot/answer-cache/not-a-key', DELETER)).status, 400)
  assert.equal((await call('delete', `/api/admin/chatbot/answer-cache/${'A'.repeat(64)}`, DELETER)).status, 400, 'uppercase is not a key')

  assert.deepEqual(cacheKeys(), before)
  assert.equal(auditRows().length, audited, 'a failed delete writes no audit row')
})

test('bulk delete removes exactly the listed rows; a duplicate or unknown key is not a second delete', async () => {
  const response = await call('post', '/api/admin/chatbot/answer-cache/bulk-delete', DELETER, {
    // Ba hàng có thật (1, 2, 3) + một id lặp + một id KHÔNG tồn tại nhưng đúng định dạng.
    // `deleted` phải là 3: chỉ hàng thực sự bị xoá mới đếm.
    keys: [keyOf(1), keyOf(1), keyOf(2), keyOf(3), keyOf(9)],
  })
  assert.equal(response.status, 200)
  assert.equal(response.body.deleted, 3, '1, 2, 3 and nothing else — the repeat and the unknown do not count')
  assert.deepEqual(cacheKeys(), [])

  const audit = auditRows()
  assert.equal(audit.length, 1)
  assert.equal((audit[0]!.meta as Record<string, unknown>).type, 'answer_cache_bulk_delete')
  assert.equal((audit[0]!.meta as Record<string, unknown>).count, 3)
})

test('a malformed key refuses the whole request instead of being dropped silently', async () => {
  const before = cacheKeys()
  // `readValidated` (wave2 D5) từ chối cả lượt: im lặng bỏ một khoá hỏng là cách để người
  // bấm "Xoá" tưởng đã xoá trong khi câu trả lời vẫn đang được phát lại.
  const response = await call('post', '/api/admin/chatbot/answer-cache/bulk-delete', DELETER, {
    keys: [keyOf(1), 'x'.repeat(64)],
  })
  assert.equal(response.status, 400)
  assert.deepEqual(cacheKeys(), before, 'the valid key in the same body was not deleted either')
  assert.equal(auditRows().length, 0)
})

test('bulk delete with nothing valid, or over the cap, refuses before touching a row', async () => {
  const before = cacheKeys()
  for (const body of [{ keys: [] }, { keys: ['nope'] }, {}, null, { keys: 'abc' }]) {
    assert.equal((await call('post', '/api/admin/chatbot/answer-cache/bulk-delete', DELETER, body)).status, 400, JSON.stringify(body))
  }
  // 201 id KHÁC nhau: trần 200 phải bị chạm, không phải được lách bằng trùng lặp.
  const tooMany = { keys: Array.from({ length: 201 }, (_, index) => keyOf(index)) }
  assert.equal((await call('post', '/api/admin/chatbot/answer-cache/bulk-delete', DELETER, tooMany)).status, 400)
  assert.deepEqual(cacheKeys(), before)
  assert.equal(auditRows().length, 0)
})

test('clear-all empties the cache and records the count', async () => {
  const response = await call('post', '/api/admin/chatbot/answer-cache/clear-all', DELETER)
  assert.equal(response.status, 200)
  assert.equal(response.body.deleted, 3)
  assert.deepEqual(cacheKeys(), [])

  const audit = auditRows()
  assert.equal(audit.length, 1)
  assert.equal((audit[0]!.meta as Record<string, unknown>).type, 'answer_cache_clear_all')
  assert.equal((audit[0]!.meta as Record<string, unknown>).count, 3)
})

test('if the audit row cannot be written, the cached answers are all still there', async () => {
  const before = cacheKeys()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await call('delete', `/api/admin/chatbot/answer-cache/${keyOf(1)}`, DELETER)).status, 500)
  assert.deepEqual(cacheKeys(), before)

  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await call('post', '/api/admin/chatbot/answer-cache/clear-all', DELETER)).status, 500)
  assert.deepEqual(cacheKeys(), before)
})
