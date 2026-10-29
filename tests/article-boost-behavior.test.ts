import assert from 'node:assert/strict'
import test, { after, afterEach, beforeEach, mock } from 'node:test'

/**
 * Administrator-authorised view inflation of an article:
 *   POST   /api/admin/articles/:id/boost  (boost.post.ts — instant or gradual)
 *   DELETE /api/admin/articles/:id/boost  (boost.delete.ts — cancel the running job)
 * both on the article type's `update` permission.
 *
 * The invariants (the header of boost.post.ts and of services/article-views.ts):
 *   - every field is validated before anything is written;
 *   - fabricated views land only in `view_total_fabricated` / the `boost` row of the
 *     day — never in the real count — and the audit row commits with them;
 *   - one running gradual job per article, checked under the article row's lock inside
 *     the transaction that inserts the job — read before it, two requests could both
 *     see none and both insert (FINDING-R6-14);
 *   - an id of a type the caller may not update is the same 404 as a missing id, for
 *     the cancel too (FINDING-R6-13);
 *   - a cancel that loses the race with the scheduler (the job completed between the
 *     read and the guarded update) is a 409 with nothing recorded — it used to log and
 *     answer a cancellation of a job that had run to the end (FINDING-R6-15).
 *   - the day of a boost row is the UTC day (`viewDay`), whatever the process time
 *     zone — the same day the visitor token of real views is derived under.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`): the
 * `ON DUPLICATE KEY UPDATE … = col + ?` of the daily row runs as SQLite's upsert; the
 * real-MySQL round trip of the gradual schedule is `view-boost-integration`.
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.articles, s.articleViewBoost, s.articleViewDaily, s.activityLogs],
  routes: async load => [
    { method: 'post', path: '/api/admin/articles/:id/boost', handler: await load('../server/api/admin/articles/[id]/boost.post') },
    { method: 'delete', path: '/api/admin/articles/:id/boost', handler: await load('../server/api/admin/articles/[id]/boost.delete') },
  ],
})
after(() => h.server.close())
const { articles, articleViewBoost, articleViewDaily, activityLogs } = h.schema

type Json = Record<string, unknown>
type Account = Awaited<ReturnType<typeof h.account>>
let editor: Account // news: read + update
const NOW = Date.UTC(2026, 9, 28, 20, 0, 0) // 03:00 on 29 October in Hà Nội

beforeEach(async () => {
  h.reset()
  editor = await h.account([{ resource: 'news', canRead: true, canUpdate: true }], 'bientap')
})
afterEach(() => mock.timers.reset())

let seq = 0
async function article(type = 'news', views: { real?: number, fabricated?: number } = {}) {
  seq += 1
  const real = views.real ?? 0
  const fabricated = views.fabricated ?? 0
  const [row] = await h.harness.db.insert(articles).values({
    type, title: `Bài ${seq}`, slug: `bai-${seq}`, status: 'published',
    viewTotalReal: real, viewTotalFabricated: fabricated, viewTotal: real + fabricated,
  })
  return Number(row.insertId)
}
async function runningJob(articleId: number, fields: Json = {}) {
  const [row] = await h.harness.db.insert(articleViewBoost).values({
    articleId, totalAmount: 600, appliedAmount: 120, durationMinutes: 60,
    startedAt: new Date(NOW - 30 * 60_000), endsAt: new Date(NOW + 30 * 60_000), status: 'running', createdBy: editor.id, ...fields,
  } as typeof articleViewBoost.$inferInsert)
  return Number(row.insertId)
}
const boost = (id: number | string, body: unknown, who: Account = editor) => h.request('POST', `/api/admin/articles/${id}/boost`, who, body)
const cancel = (id: number | string, who: Account = editor) => h.request('DELETE', `/api/admin/articles/${id}/boost`, who)
const totals = (id: number) => {
  const row = h.harness.rows(articles).find(each => each.id === id)!
  return [row.viewTotalReal, row.viewTotalFabricated, row.viewTotal]
}
const audits = () => h.harness.rows(activityLogs).map(row => ({ userId: row.userId, action: row.action, resource: row.resource, resourceId: row.resourceId, meta: row.meta as Json }))
const jobs = () => h.harness.rows(articleViewBoost)

// ─── Permissions ─────────────────────────────────────────────────────────────

test('both routes need update on the article\'s type: no session → 401, read only → 403; nothing written', async () => {
  const id = await article()
  await runningJob(id)
  const readOnly = await h.account([{ resource: 'news', canRead: true }], 'xem')
  for (const send of [() => boost(id, { mode: 'instant', amount: 5 }, readOnly), () => cancel(id, readOnly)]) {
    assert.equal((await send()).status, 403)
  }
  assert.equal((await h.request('POST', `/api/admin/articles/${id}/boost`, null, { mode: 'instant', amount: 5 })).status, 401)
  assert.equal((await h.request('DELETE', `/api/admin/articles/${id}/boost`, null)).status, 401)
  assert.deepEqual(totals(id), [0, 0, 0])
  assert.equal(jobs()[0]!.status, 'running')
  assert.deepEqual(audits(), [])
})

test('FINDING-R6-13: an article of a type the caller may not update is the same 404 as a missing one — for the cancel too', async () => {
  const documentId = await article('document')
  await runningJob(documentId)
  const missing = 9999
  for (const id of [documentId, missing]) {
    const started = await boost(id, { mode: 'instant', amount: 5 })
    assert.deepEqual([started.status, started.body.statusMessage], [404, 'Bài viết không tồn tại.'], `boost ${id}`)
    const stopped = await cancel(id)
    // Before: 403 for the document (it exists), 404 for the missing id.
    assert.deepEqual([stopped.status, stopped.body.statusMessage], [404, 'Bài viết không tồn tại.'], `cancel ${id}`)
  }
  assert.equal(jobs()[0]!.status, 'running')
  assert.deepEqual(audits(), [])
})

test('the write-path scope (CLAUDE.md: read OR update): a type seen but not changeable is an honest 403; update without read still works', async () => {
  const documentId = await article('document')
  await runningJob(documentId)
  // Seen, not changeable: 403 on both — before (scope "update" only) the boost and the
  // cancel answered 404 as if the article did not exist (verifier L2).
  const seer = await h.account([{ resource: 'news', canRead: true, canUpdate: true }, { resource: 'documents', canRead: true }], 'xemvanban')
  for (const response of [await boost(documentId, { mode: 'instant', amount: 5 }, seer), await cancel(documentId, seer)]) {
    assert.deepEqual([response.status, response.body.statusMessage], [403, 'Forbidden: Insufficient permissions'])
  }
  // Changeable without being readable: allowed, as the update path of the article itself.
  const changer = await h.account([{ resource: 'documents', canUpdate: true }], 'suavanban')
  assert.equal((await cancel(documentId, changer)).status, 200)
  assert.equal((await boost(documentId, { mode: 'instant', amount: 5 }, changer)).status, 200)
  assert.deepEqual(audits().map(a => [a.userId, a.meta.mode]), [[changer.id, 'cancel'], [changer.id, 'instant']])
})

test('every field is checked before anything is written: a malformed id, mode, amount or duration is a 400', async () => {
  const id = await article()
  for (const bad of ['abc', '0', '1.5', '-2']) assert.equal((await boost(bad, { mode: 'instant', amount: 5 })).status, 400, bad)
  const bodies: Array<[unknown, string]> = [
    [['instant'], 'Dữ liệu không hợp lệ.'],
    [{ mode: 'fast', amount: 5 }, 'Chế độ tăng lượt xem phải là "instant" hoặc "gradual".'],
    [{ mode: 'instant', amount: 0 }, 'Số lượt xem phải là số nguyên từ 1 đến 1.000.000.'],
    [{ mode: 'instant', amount: 2.5 }, 'Số lượt xem phải là số nguyên từ 1 đến 1.000.000.'],
    [{ mode: 'instant', amount: '50' }, 'Số lượt xem phải là số nguyên từ 1 đến 1.000.000.'],
    [{ mode: 'instant', amount: 1_000_001 }, 'Số lượt xem phải là số nguyên từ 1 đến 1.000.000.'],
    [{ mode: 'gradual', amount: 50 }, 'Thời lượng phải là số nguyên phút từ 1 đến 10.080 (7 ngày).'],
    [{ mode: 'gradual', amount: 50, minutes: 10_081 }, 'Thời lượng phải là số nguyên phút từ 1 đến 10.080 (7 ngày).'],
  ]
  for (const [body, message] of bodies) {
    const response = await boost(id, body)
    assert.deepEqual([response.status, response.body.statusMessage], [400, message], JSON.stringify(body))
  }
  assert.deepEqual(totals(id), [0, 0, 0])
  assert.deepEqual([jobs(), h.harness.rows(articleViewDaily), audits()], [[], [], []])
})

// ─── Instant ─────────────────────────────────────────────────────────────────

for (const zone of ['UTC', 'Asia/Ho_Chi_Minh']) {
  test(`instant (TZ=${zone}): only the fabricated half and the day's boost row move, on the UTC day; audited in the same transaction`, async () => {
    const before = process.env.TZ
    process.env.TZ = zone
    try {
      mock.timers.enable({ apis: ['Date'], now: NOW })
      const id = await article('news', { real: 10, fabricated: 5 })
      const response = await boost(id, { mode: ' instant ', amount: 100 })
      assert.deepEqual([response.status, response.body], [200, { ok: true, mode: 'instant', amount: 100 }])
      assert.deepEqual(totals(id), [10, 105, 115])
      // 03:00 on the 29th in Hà Nội is still the 28th in UTC — the day `viewDay` keys on.
      assert.deepEqual(h.harness.rows(articleViewDaily).map(row => [row.day, row.articleId, row.sourceCategory, row.realViews, row.fabricatedViews]), [['2026-10-28', id, 'boost', 0, 100]])
      assert.deepEqual(audits(), [{ userId: editor.id, action: 'boost', resource: 'articles', resourceId: id, meta: { mode: 'instant', amount: 100, minutes: null, title: 'Bài ' + (seq) } }])
    } finally {
      process.env.TZ = before
    }
  })
}

test('instant is all or nothing: a failed audit insert leaves the counts and the daily rows as they were', async () => {
  const id = await article('news', { real: 3 })
  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await boost(id, { mode: 'instant', amount: 40 })).status, 500)
  assert.deepEqual(totals(id), [3, 0, 3])
  assert.deepEqual(h.harness.rows(articleViewDaily), [])
})

// ─── Gradual ─────────────────────────────────────────────────────────────────

test('gradual: one running job with its window, audited with it; a second while it runs is a 409 and writes nothing', async () => {
  mock.timers.enable({ apis: ['Date'], now: NOW })
  const id = await article()
  const response = await boost(id, { mode: 'gradual', amount: 600, minutes: 90 })
  assert.equal(response.status, 200)
  const [job] = jobs()
  assert.deepEqual(response.body, {
    ok: true, mode: 'gradual', amount: 600, minutes: 90,
    boost: { id: job!.id, totalAmount: 600, appliedAmount: 0, startedAt: new Date(NOW).toISOString(), endsAt: new Date(NOW + 90 * 60_000).toISOString() },
  })
  assert.deepEqual([job!.status, job!.totalAmount, job!.appliedAmount, job!.durationMinutes, job!.createdBy], ['running', 600, 0, 90, editor.id])
  assert.deepEqual([(job!.startedAt as Date).toISOString(), (job!.endsAt as Date).toISOString()], [new Date(NOW).toISOString(), new Date(NOW + 90 * 60_000).toISOString()])
  assert.deepEqual(audits().map(a => a.meta), [{ mode: 'gradual', amount: 600, minutes: 90, title: 'Bài ' + seq }])
  assert.deepEqual(totals(id), [0, 0, 0], 'nothing delivered yet — the scheduler does that')

  const second = await boost(id, { mode: 'gradual', amount: 10, minutes: 5 })
  assert.deepEqual([second.status, second.body.statusMessage], [409, 'Bài viết đang có một lượt tăng dần chạy dở. Vui lòng huỷ lượt đó trước.'])
  assert.equal(jobs().length, 1)
  assert.equal(audits().length, 1)

  h.harness.failNext(/^insert into `activity_logs`/)
  const other = await article()
  assert.equal((await boost(other, { mode: 'gradual', amount: 10, minutes: 5 })).status, 500)
  assert.equal(jobs().length, 1, 'a job with no audit row does not survive')
})

test('FINDING-R6-14: the running-job check runs inside the insert\'s transaction, under the article row\'s lock', async () => {
  const id = await article()
  assert.equal((await boost(id, { mode: 'gradual', amount: 60, minutes: 10 })).status, 200)
  const inTx = h.harness.txStatements.map(sql => sql.replace(/^(\w+ (?:into )?)(?:.*? from )?(`\w+`).*?( for update)?$/s, '$1$2$3'))
  // Before: the check ran on the pool before the transaction opened — two requests
  // for one article both found no running job and both inserted one.
  assert.deepEqual(inTx, ['select `articles` for update', 'select `article_view_boost`', 'insert into `article_view_boost`', 'insert into `activity_logs`'])
})

// ─── Cancel ──────────────────────────────────────────────────────────────────

test('cancel: the running job stops, delivered views stay, the audit row tells the whole story; nothing running → 404', async () => {
  const id = await article('news', { fabricated: 120 })
  const job = await runningJob(id)
  await runningJob(id, { status: 'completed', appliedAmount: 600 })
  const response = await cancel(id)
  assert.deepEqual([response.status, response.body], [200, { ok: true, cancelled: { id: job, appliedAmount: 120, totalAmount: 600 } }])
  assert.deepEqual(jobs().map(row => row.status), ['cancelled', 'completed'])
  assert.deepEqual(totals(id), [0, 120, 120])
  assert.deepEqual(audits(), [{ userId: editor.id, action: 'boost', resource: 'articles', resourceId: id, meta: { mode: 'cancel', amount: 600, minutes: 60, appliedAmount: 120, title: 'Bài ' + seq } }])

  const again = await cancel(id)
  assert.deepEqual([again.status, again.body.statusMessage], [404, 'Bài viết không có lượt tăng dần nào đang chạy.'])

  const other = await article()
  await runningJob(other)
  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await cancel(other)).status, 500)
  assert.equal(jobs().at(-1)!.status, 'running', 'a cancellation with no audit row does not survive')
})

test('FINDING-R6-15: a cancel that loses the race with the scheduler is a 409 and records nothing', async () => {
  const id = await article()
  await runningJob(id)
  // The scheduler's pass completes the job — and commits — after the cancel read it as
  // running. The cancel's transaction has written nothing yet when its guarded UPDATE
  // comes, so the pass is committed in its own transaction right before it (as on
  // MySQL, where that UPDATE reads the latest committed row).
  h.harness.beforeNext(/^update `article_view_boost`/, () => {
    h.harness.sqlite.exec("COMMIT; UPDATE article_view_boost SET status = 'completed', applied_amount = 600; BEGIN")
  })
  const response = await cancel(id)
  // Before: 200 "cancelled" with appliedAmount 120, and an audit row saying the job was
  // stopped at 120 of 600 — while all 600 had been delivered.
  assert.deepEqual([response.status, response.body.statusMessage], [409, 'Lượt tăng dần vừa kết thúc trước khi kịp huỷ. Vui lòng tải lại để xem số đã giao.'])
  assert.deepEqual(jobs().map(row => [row.status, row.appliedAmount]), [['completed', 600]])
  assert.deepEqual(audits(), [])
})
