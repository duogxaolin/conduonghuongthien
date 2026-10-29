import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test, { after, beforeEach } from 'node:test'

/**
 * Which MySQL error a failed query was — one walker (`server/utils/mysql-errors.ts`), read down
 * the `cause` chain because Drizzle 0.45 wraps every driver error in a `DrizzleQueryError` whose
 * own `code` is empty (slice R7, task item 5 and two findings it led to):
 *   - `isDeadlock` has ONE definition in `server/` (`utils/deadlock-retry.ts`); the page-view
 *     ingestion had a byte-identical copy. Its two callers — `withDeadlockRetry` and the
 *     ingestion's own retry loop — retry exactly the same errors;
 *   - small-talk create/update: a duplicate question was meant to be a 400, and was a 500 — the
 *     check read the top-level `code` (FINDING-R7-6);
 *   - admin user create: an existing username or e-mail was meant to be a 400, and fell to the
 *     500 branch, whose message was Drizzle's "Failed query: <SQL> params: …" — the new account's
 *     e-mail and password hash in the officer's toast (FINDING-R7-10).
 *
 * The routes run on the SQLite harness (`_ai-route-harness.ts`); a unique-key failure is the
 * error MySQL raises (`failNext` with errno 1062 — the harness's own SQLite error carries no MySQL
 * code), wrapped by Drizzle exactly as on MySQL.
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.chatbotSmallTalk, s.activityLogs],
  routes: async load => [
    { method: 'post', path: '/api/admin/chatbot/small-talk', handler: await load('../server/api/admin/chatbot/small-talk/index.post') },
    { method: 'put', path: '/api/admin/chatbot/small-talk/:id', handler: await load('../server/api/admin/chatbot/small-talk/[id].put') },
    { method: 'post', path: '/api/admin/users', handler: await load('../server/api/admin/users/index.post') },
  ],
})
after(() => h.server.close())
const { isDeadlock, withDeadlockRetry } = await import('../server/utils/deadlock-retry')
const { storeAnalyticsPageView } = await import('../server/services/analytics-ingestion')
const { chatbotSmallTalk, users } = h.schema

/** The driver's error, wrapped `levels` times as Drizzle (and a caller) would. */
function driverError(errno: number, code: string, levels = 1): Error {
  let error: Error = Object.assign(new Error(`driver ${code}`), { errno, code })
  for (let n = 0; n < levels; n++) error = Object.assign(new Error('Failed query: insert … params: secret'), { cause: error })
  return error
}

// ─── The walker ──────────────────────────────────────────────────────────────

test('hasMysqlError: the code or errno on the error or down its cause chain, at most five levels; nothing else', async () => {
  // Imported here, not at the top: the module is new in R7, and the suite's other tests run on the base too.
  const { hasMysqlError, isDuplicateEntry } = await import('../server/utils/mysql-errors')
  assert.equal(isDuplicateEntry(driverError(1062, 'ER_DUP_ENTRY', 0)), true)
  assert.equal(isDuplicateEntry(driverError(1062, 'ER_DUP_ENTRY', 1)), true, 'Drizzle-wrapped')
  assert.equal(isDuplicateEntry(Object.assign(new Error('x'), { cause: { errno: 1062 } })), true, 'errno alone')
  assert.equal(isDuplicateEntry(driverError(1062, 'ER_DUP_ENTRY', 4)), true)
  assert.equal(isDuplicateEntry(driverError(1062, 'ER_DUP_ENTRY', 5)), false, 'the sixth level is not read')
  const loop: { cause?: unknown } = {}
  loop.cause = loop
  for (const other of [driverError(1452, 'ER_NO_REFERENCED_ROW_2'), driverError(1213, 'ER_LOCK_DEADLOCK'), { errno: '1062' }, '1062', null, undefined, loop]) {
    assert.equal(isDuplicateEntry(other), false, String(other))
  }
  assert.equal(hasMysqlError(driverError(1205, 'ER_LOCK_WAIT_TIMEOUT', 2), 1205, 'ER_LOCK_WAIT_TIMEOUT'), true)
})

test('isDeadlock has one definition in server/ — in utils/deadlock-retry.ts', () => {
  const root = new URL('..', import.meta.url).pathname
  const found: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (path.endsWith('.ts') && /function isDeadlock\b|const isDeadlock\b/.test(readFileSync(path, 'utf8'))) found.push(relative(root, path))
    }
  }
  walk(join(root, 'server'))
  assert.deepEqual(found, ['server/utils/deadlock-retry.ts'])
})

test('both deadlock callers retry the same errors: withDeadlockRetry and the page-view ingestion loop', async () => {
  const samples: Array<[string, () => unknown, boolean]> = [
    ['1213 wrapped once', () => driverError(1213, 'ER_LOCK_DEADLOCK'), true],
    ['1213 wrapped four times', () => driverError(1213, 'ER_LOCK_DEADLOCK', 4), true],
    ['1213 wrapped five times', () => driverError(1213, 'ER_LOCK_DEADLOCK', 5), false],
    ['code only', () => Object.assign(new Error('x'), { code: 'ER_LOCK_DEADLOCK' }), true],
    ['lock-wait timeout', () => driverError(1205, 'ER_LOCK_WAIT_TIMEOUT'), false],
    ['duplicate', () => driverError(1062, 'ER_DUP_ENTRY'), false],
  ]
  const row = { occurredAt: new Date('2026-07-22T12:34:56.000Z'), eventDay: '2026-07-22', path: '/news', sourceCategory: 'search', deviceClass: 'mobile', countryCode: 'VN', regionCode: 'HN-1', visitorToken: 'v' }
  for (const [label, make, retried] of samples) {
    assert.equal(isDeadlock(make()), retried, label)
    let shared = 0
    await withDeadlockRetry(async () => { shared += 1; if (shared === 1) throw make() }, { sleep: async () => {} }).catch(() => {})
    let ingestion = 0
    const store = { async transaction() { ingestion += 1; if (ingestion === 1) throw make() } }
    await storeAnalyticsPageView(row as never, store as never, { sleep: async () => {} }).catch(() => {})
    assert.deepEqual([shared, ingestion], retried ? [2, 2] : [1, 1], label)
  }
})

// ─── FINDING-R7-6: small-talk duplicate question ─────────────────────────────

type Account = Awaited<ReturnType<typeof h.account>>
let officer: Account
beforeEach(async () => {
  h.reset()
  officer = await h.account([
    { resource: 'chatbot_knowledge', canRead: true, canCreate: true, canUpdate: true },
    { resource: 'users', canRead: true, canCreate: true },
  ], 'canbo')
})

const smallTalk = { category: 'social', question: 'Xin chào', answer: 'Chào bạn', patterns: [] }

test('FINDING-R7-6: a small-talk question that already exists is a 400 with the service\'s sentence, on create and on update', async () => {
  const created = await h.request('POST', '/api/admin/chatbot/small-talk', officer, smallTalk)
  assert.equal(created.status, 200)
  h.harness.failNext(/^insert into `chatbot_small_talk`/, { errno: 1062, code: 'ER_DUP_ENTRY' })
  const duplicate = await h.request('POST', '/api/admin/chatbot/small-talk', officer, { ...smallTalk, answer: 'Khác' })
  // Before: 500 — the check read the top-level code of Drizzle's wrapper.
  assert.deepEqual([duplicate.status, duplicate.body.statusMessage], [400, 'Đã có mục với câu hỏi này. Vui lòng dùng câu hỏi khác.'])

  const second = await h.request('POST', '/api/admin/chatbot/small-talk', officer, { ...smallTalk, question: 'Tạm biệt' })
  const id = (second.body.item as { id: number } | undefined)?.id ?? h.harness.rows(chatbotSmallTalk).at(-1)!.id
  h.harness.failNext(/^update `chatbot_small_talk`/, { errno: 1062, code: 'ER_DUP_ENTRY' })
  const renamed = await h.request('PUT', `/api/admin/chatbot/small-talk/${id}`, officer, { question: 'Xin chào' })
  assert.deepEqual([renamed.status, renamed.body.statusMessage], [400, 'Đã có mục với câu hỏi này. Vui lòng dùng câu hỏi khác.'])
  assert.deepEqual(h.harness.rows(chatbotSmallTalk).map(row => row.question), ['Xin chào', 'Tạm biệt'])

  h.harness.failNext(/^insert into `chatbot_small_talk`/, { errno: 1452, code: 'ER_NO_REFERENCED_ROW_2' })
  assert.equal((await h.request('POST', '/api/admin/chatbot/small-talk', officer, { ...smallTalk, question: 'Khác hẳn' })).status, 500, 'any other failure is still a 500')
})

// ─── FINDING-R7-10: admin user create ────────────────────────────────────────

async function roleToAssign() {
  const roleId = 900 + Math.floor(Math.random() * 90)
  await h.harness.db.insert(h.schema.roles).values({ id: roleId, name: `Vai trò ${roleId}`, isSystem: false })
  return roleId
}
const newUser = (roleId: number) => ({ username: 'nhanvien_moi', email: 'nv.moi@example.vn', password: 'Cuc-Ky-Kho-Doan-2026', roleId })

test('FINDING-R7-10: an existing username or e-mail is a 400 "đã tồn tại" — not a 500', async () => {
  const roleId = await roleToAssign()
  assert.equal((await h.request('POST', '/api/admin/users', officer, newUser(roleId))).status, 200)
  h.harness.failNext(/^insert into `users`/, { errno: 1062, code: 'ER_DUP_ENTRY' })
  const again = await h.request('POST', '/api/admin/users', officer, newUser(roleId))
  assert.deepEqual([again.status, again.body.statusMessage], [400, 'Tên đăng nhập hoặc Email đã tồn tại.'])
  assert.equal(h.harness.rows(users).filter(row => row.username === 'nhanvien_moi').length, 1)
})

test('FINDING-R7-10: any other failure is a 500 that names no SQL, e-mail or password hash; the driver\'s message goes to the log', async () => {
  const roleId = await roleToAssign()
  h.harness.failNext(/^insert into `users`/, { errno: 1452, code: 'ER_NO_REFERENCED_ROW_2' })
  const failed = await h.request('POST', '/api/admin/users', officer, newUser(roleId))
  const shown = JSON.stringify(failed.body)
  // Before: statusMessage "injected failure: insert into `users` …" (on MySQL: "Failed query: … params:
  // nhanvien_moi,nv.moi@example.vn,$2b$12$…").
  assert.deepEqual([failed.status, failed.body.statusMessage], [500, 'Lỗi hệ thống'])
  for (const leak of ['insert into', 'nv.moi@example.vn', '$2']) assert.ok(!shown.includes(leak), leak)
  assert.ok(h.logged.some(line => line.includes('admin_users.create_failed')), 'logged')
})
