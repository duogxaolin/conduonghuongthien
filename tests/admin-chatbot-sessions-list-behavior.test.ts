import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * GET /api/admin/chatbot/sessions — `chatbot_knowledge.read` — the visitor chat session list, run
 * in-process (the only other suite that loads it, `admin-date-filters-vn-day`, runs it in a child
 * process on a fake database to compile its WHERE): which sessions, in which order, how many per
 * page; the filters (Vietnam calendar days, `hasContact`) and their 400s; and the audit row of
 * the read — one per request, with the filters and the admin's IP, after the reads, and a failed
 * audit insert fails the request (nothing is answered without its trace).
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`).
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.chatSessions, s.activityLogs],
  routes: async load => [
    { method: 'get', path: '/api/admin/chatbot/sessions', handler: await load('../server/api/admin/chatbot/sessions/index.get') },
  ],
})
after(() => h.server.close())
const { chatSessions, activityLogs } = h.schema

type Account = Awaited<ReturnType<typeof h.account>>
let reviewer: Account
beforeEach(async () => {
  h.reset()
  reviewer = await h.account([{ resource: 'chatbot_knowledge', canRead: true }], 'xemphien')
})

const at = (iso: string) => new Date(iso)
async function seedSessions() {
  await h.harness.db.insert(chatSessions).values([
    // started 2026-10-20 09:00 +07:00
    { id: 's-1', ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0', detectedPhone: '0903480985', detectedName: 'A', messageCount: 3, startedAt: at('2026-10-20T02:00:00Z'), lastMessageAt: at('2026-10-20T02:05:00Z') },
    // started 2026-10-22 01:00 +07:00 (still 2026-10-21 in UTC)
    { id: 's-2', ip: '198.51.100.4', userAgent: null, detectedPhone: null, detectedName: null, messageCount: 1, startedAt: at('2026-10-21T18:00:00Z'), lastMessageAt: at('2026-10-21T18:00:00Z') },
    // same last-message time as s-1: the id breaks the tie
    { id: 's-3', ip: '198.51.100.5', userAgent: 'curl/8', detectedPhone: null, detectedName: 'Bình', messageCount: 0, startedAt: at('2026-10-22T02:00:00Z'), lastMessageAt: at('2026-10-20T02:05:00Z') },
  ])
}
const list = (query = '', who: Account | null = reviewer) => h.request('GET', `/api/admin/chatbot/sessions${query}`, who)
const ids = (body: Record<string, unknown>) => (body.items as Array<{ id: string }>).map(item => item.id)
const audits = () => h.harness.rows(activityLogs).map(row => ({ userId: row.userId, action: row.action, resource: row.resource, meta: row.meta }))

test('chatbot_knowledge.read is required; a refused read is not audited', async () => {
  await seedSessions()
  const other = await h.account([{ resource: 'news', canRead: true }], 'khac')
  assert.equal((await list('', null)).status, 401)
  assert.equal((await list('', other)).status, 403)
  assert.deepEqual(audits(), [])
})

test('newest message first (ties by id, descending), the browser summarised, and one audit row with the filters and the IP', async () => {
  await seedSessions()
  const response = await list()
  assert.equal(response.status, 200)
  assert.deepEqual([response.body.page, response.body.pageSize, response.body.total, response.body.totalPages], [1, 25, 3, 1])
  assert.deepEqual(ids(response.body), ['s-2', 's-3', 's-1'])
  const first = (response.body.items as Array<Record<string, unknown>>)[2]!
  assert.deepEqual(Object.keys(first).sort(), ['browser', 'detectedName', 'detectedPhone', 'id', 'ip', 'lastMessageAt', 'messageCount', 'startedAt'])
  assert.equal(typeof first.browser, 'string')
  assert.deepEqual(audits(), [{ userId: reviewer.id, action: 'read', resource: 'chat_sessions', meta: { filters: { from: null, to: null, hasContact: null }, ip: '127.0.0.1' } }])
})

test('pages: pageSize rows from (page - 1) × pageSize, total over the whole filter', async () => {
  await seedSessions()
  const second = await list('?page=2&pageSize=2')
  assert.deepEqual([second.body.total, second.body.totalPages, ids(second.body)], [3, 2, ['s-1']])
  const beyond = await list('?page=5&pageSize=2')
  assert.deepEqual([beyond.body.total, ids(beyond.body)], [3, []])
})

test('from/to are Vietnam calendar days, the end day included; hasContact filters on the detected phone', async () => {
  await seedSessions()
  assert.deepEqual(ids((await list('?from=2026-10-20&to=2026-10-20')).body), ['s-1'])
  assert.deepEqual(ids((await list('?from=2026-10-22')).body), ['s-2', 's-3'], 's-2 started 01:00 +07:00 on the 22nd')
  assert.deepEqual(ids((await list('?to=2026-10-21')).body), ['s-1'])
  assert.deepEqual(ids((await list('?hasContact=yes')).body), ['s-1'])
  assert.deepEqual(ids((await list('?hasContact=no')).body), ['s-2', 's-3'])
  assert.deepEqual(ids((await list('?from=2026-10-20&to=2026-10-22&hasContact=no')).body), ['s-2', 's-3'])
  assert.deepEqual(audits().at(-1)!.meta, { filters: { from: '2026-10-20', to: '2026-10-22', hasContact: 'no' }, ip: '127.0.0.1' })
})

test('a bad page, size, day, range or hasContact is a 400 — refused before any read, not audited', async () => {
  await seedSessions()
  for (const query of ['?page=0', '?page=1.5', '?pageSize=101', '?pageSize=0', '?from=2026-02-30', '?to=hom-nay', '?from=2026-10-22&to=2026-10-20', '?hasContact=maybe']) {
    assert.equal((await list(query)).status, 400, query)
  }
  assert.deepEqual(audits(), [])
})

test('a failed audit insert fails the request: the list is not answered without its trace', async () => {
  await seedSessions()
  h.harness.failNext(/^insert into `activity_logs`/)
  const response = await list()
  assert.equal(response.status, 500)
  assert.equal(response.body.items, undefined)
  assert.deepEqual(audits(), [])
})
