import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * The two admin READ routes of citizen submissions, run for real (only e2e loaded them before):
 *   GET /api/admin/submissions       (server/api/admin/submissions/index.get.ts)
 *   GET /api/admin/submissions/:id   (server/api/admin/submissions/[id]/index.get.ts)
 *
 * Pinned:
 *   - the list needs `submissions.read`; `status` and `viewed` filter on the SERVER, an unknown
 *     value of either is a 400 (never guessed); newest first; the counts are over the WHOLE table,
 *     never the filtered set;
 *   - a submission whose status was changed by an account that has since been deleted is still
 *     listed and read — `statusChangedByName` is null (leftJoin), the row is not dropped;
 *   - the detail stamps the first view (`firstView` true once, then false) and records every read
 *     in `activity_logs` BEFORE it reads the row, answers 404 for a missing id and 400 for a bad
 *     one, and returns the row with its timeline.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`).
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.submissions, s.submissionEvents, s.activityLogs],
  routes: async load => [
    { method: 'get', path: '/api/admin/submissions', handler: await load('../server/api/admin/submissions/index.get') },
    { method: 'get', path: '/api/admin/submissions/:id', handler: await load('../server/api/admin/submissions/[id]/index.get') },
  ],
})
after(() => h.server.close())
const { submissions, submissionEvents, activityLogs, users } = h.schema

type Account = Awaited<ReturnType<typeof h.account>>
let officer: Account
beforeEach(async () => {
  h.reset()
  officer = await h.account([{ resource: 'submissions', canRead: true }], 'tiepdan')
})

const T = (iso: string) => new Date(iso)
async function submission(values: Partial<typeof submissions.$inferInsert> = {}) {
  const [row] = await h.harness.db.insert(submissions).values({ fullName: 'Nguyễn Văn A', phone: '0901234567', createdAt: T('2026-10-01T01:00:00Z'), ...values })
  return Number(row.insertId)
}
type Listed = { id: number, status: string, statusChangedByName: string | null, firstViewedAt: string | null }
const list = async (query = '', who: Account | null = officer) => h.request('GET', `/api/admin/submissions${query}`, who)
const ids = (body: Record<string, unknown>) => (body.submissions as Listed[]).map(row => row.id)

test('the list needs submissions.read: no session → 401, another resource → 403, nothing read is returned', async () => {
  await submission()
  assert.equal((await list('', null)).status, 401)
  const other = await h.account([{ resource: 'news', canRead: true }], 'khac')
  const refused = await list('', other)
  assert.equal(refused.status, 403)
  assert.equal(refused.body.submissions, undefined)
})

test('status and viewed filter on the server, newest first; the counts cover the whole table', async () => {
  const oldNew = await submission({ createdAt: T('2026-10-01T01:00:00Z') })
  const resolved = await submission({ status: 'resolved', createdAt: T('2026-10-02T01:00:00Z'), firstViewedAt: T('2026-10-02T02:00:00Z') })
  const newest = await submission({ createdAt: T('2026-10-03T01:00:00Z'), firstViewedAt: T('2026-10-03T02:00:00Z') })

  const all = await list()
  assert.equal(all.status, 200)
  assert.deepEqual(ids(all.body), [newest, resolved, oldNew])
  assert.deepEqual(all.body.counts, { new: 2, resolved: 1 })

  const onlyNew = await list('?status=new')
  assert.deepEqual(ids(onlyNew.body), [newest, oldNew])
  assert.deepEqual(onlyNew.body.counts, { new: 2, resolved: 1 }, 'the counts do not follow the filter')

  assert.deepEqual(ids((await list('?viewed=yes')).body), [newest, resolved])
  assert.deepEqual(ids((await list('?viewed=no')).body), [oldNew])
  assert.deepEqual(ids((await list('?status=new&viewed=yes')).body), [newest])
  assert.deepEqual(ids((await list('?status=%20resolved%20')).body), [resolved], 'the value is trimmed')
})

test('an unknown filter value is refused, not guessed', async () => {
  await submission()
  for (const query of ['?status=xong', '?status=NEW', '?viewed=maybe', '?viewed=1']) {
    const response = await list(query)
    assert.equal(response.status, 400, query)
    assert.equal(response.body.submissions, undefined, query)
  }
  assert.equal((await list('?status=&viewed=')).status, 200, 'empty means no filter')
})

test('a submission handled by an account deleted since is still listed and read, its changer name null', async () => {
  const changer = await h.account([{ resource: 'submissions', canRead: true }], 'daxoa')
  const id = await submission({ status: 'in_progress', statusChangedBy: changer.id, statusChangedAt: T('2026-10-05T01:00:00Z') })
  const before = (await list()).body.submissions as Listed[]
  assert.equal(before[0]!.statusChangedByName, changer.username)

  h.harness.sqlite.exec(`DELETE FROM users WHERE id = ${changer.id}`)
  assert.equal(h.harness.rows(users).some(row => row.id === changer.id), false)
  const after = (await list()).body.submissions as Listed[]
  assert.deepEqual(after.map(row => [row.id, row.status, row.statusChangedByName]), [[id, 'in_progress', null]])
  const detail = await h.request('GET', `/api/admin/submissions/${id}`, officer)
  assert.equal(detail.status, 200)
  assert.equal((detail.body.submission as Listed).statusChangedByName, null)
})

test('the detail stamps the first view once, audits every read, and returns the row with its timeline', async () => {
  const id = await submission({ email: 'a@example.vn', message: 'Xin hỗ trợ', answers: [{ label: 'Nghề', value: 'Hàn' }], formTitle: 'Liên hệ' })

  const first = await h.request('GET', `/api/admin/submissions/${id}`, officer)
  assert.equal(first.status, 200)
  assert.equal(first.body.firstView, true)
  const row = first.body.submission as Record<string, unknown>
  assert.deepEqual(
    [row.id, row.fullName, row.phone, row.email, row.message, row.answers, row.formTitle, row.status, row.statusChangedByName],
    [id, 'Nguyễn Văn A', '0901234567', 'a@example.vn', 'Xin hỗ trợ', [{ label: 'Nghề', value: 'Hàn' }], 'Liên hệ', 'new', null],
  )
  assert.ok(row.firstViewedAt, 'the row read after the stamp carries it')
  const events = first.body.events as Array<{ eventType: string, actorId: number, actorName: string }>
  assert.deepEqual(events.map(event => [event.eventType, event.actorId, event.actorName]), [['view', officer.id, officer.username]])

  const second = await h.request('GET', `/api/admin/submissions/${id}`, officer)
  assert.equal(second.body.firstView, false)
  assert.equal((second.body.events as unknown[]).length, 1, 'only the first view enters the timeline')

  const audits = h.harness.rows(activityLogs).map(log => [log.userId, log.action, log.resource, log.resourceId, log.meta])
  assert.deepEqual(audits, [[officer.id, 'read', 'submissions', id, { firstView: true }], [officer.id, 'read', 'submissions', id, { firstView: false }]])
  assert.equal(h.harness.rows(submissionEvents).length, 1)
})

test('the detail: a bad id is 400, a missing one 404, a caller without submissions.read 403 — nothing stamped or audited', async () => {
  const id = await submission()
  for (const bad of ['abc', '0', '-3', '1.5']) assert.equal((await h.request('GET', `/api/admin/submissions/${bad}`, officer)).status, 400, bad)
  assert.equal((await h.request('GET', '/api/admin/submissions/9999', officer)).status, 404)
  const other = await h.account([{ resource: 'news', canRead: true }], 'khac')
  assert.equal((await h.request('GET', `/api/admin/submissions/${id}`, other)).status, 403)
  assert.equal(h.harness.rows(activityLogs).length, 0)
  assert.equal(h.harness.rows(submissions)[0]!.firstViewedAt, null)
})
