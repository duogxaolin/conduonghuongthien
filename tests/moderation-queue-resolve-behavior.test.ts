import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * POST /api/admin/ai/moderation/queue/:id/resolve — `ai.update` — one row of the AI
 * moderation queue resolved: `approve` (unhide the comment), `reject_delete` (delete it),
 * `ban_ip` (ban the author's address, delete the comment).
 *
 * The invariants:
 *   - the permission, and nothing written or audited on any refusal;
 *   - the row's new status, its target and the audit row (`meta` an object) commit together —
 *     a failed audit insert leaves the comment, the ban and the status as they were;
 *   - a contested transition: a resolve that loses to another resolve of the same row (the status
 *     it read is gone when its conditional UPDATE runs) is a 409 and everything it did rolls back
 *     — before, it overwrote the winner's status, deleted or re-showed the comment the winner had
 *     decided on, and logged a second resolution (FINDING-R7-1);
 *   - a ban is validated before anything is written: `unknown` (what the client-IP resolver
 *     stores when it had no address) or no address at all is a 400 — before, `unknown` became a
 *     ban row matching every visitor whose address could not be read, and no address gave
 *     "Đã cấm IP" with nothing banned (FINDING-R7-2);
 *   - KNOWN, the base's behaviour kept (FINDING-R7-3): two bans of one address at once — the
 *     second is ER_DUP_ENTRY's 500 and rolls back whole; clicking again goes through. Going on
 *     past the 1062 was tried and reverted (it held the failed INSERT's locks to commit — the
 *     doc's R7 section); any other failure of that insert is a 500 too.
 *
 * Pinned, not changed (owner's call — doc "R7"): the server accepts a resolve from any status
 * (approve of a row already rejected answers 200 "approved" while its comment is gone; the page
 * only offers approve on pending rows); approve of a chat or livestream row changes only the
 * queue — the worker's `is_flagged` / `is_deleted` stays (FINDING-R7-4).
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`). A competing resolve is
 * committed right before the first statement of the handler's transaction, which is still empty
 * then (`COMMIT; …; BEGIN`) — on MySQL the loser either starts after that commit or waits on the
 * comment row until it; the conditional UPDATE reads the committed row either way. The MySQL
 * replay is `mysql-resolve-race.sh` in the slice's proof directory.
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.aiModerationQueue, s.articleComments, s.readerIpBans, s.activityLogs],
  routes: async load => [
    { method: 'post', path: '/api/admin/ai/moderation/queue/:id/resolve', handler: await load('../server/api/admin/ai/moderation/queue/[id]/resolve.post') },
  ],
})
after(() => h.server.close())
const { aiModerationQueue, articleComments, readerIpBans, activityLogs } = h.schema
// The harness leaves unique keys out; this one is what makes a second ban a duplicate.
h.harness.sqlite.exec('CREATE UNIQUE INDEX reader_ip_bans_value ON reader_ip_bans (value)')

type Json = Record<string, unknown>
type Account = Awaited<ReturnType<typeof h.account>>
let officer: Account // ai: read + update

beforeEach(async () => {
  h.reset()
  officer = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }], 'kiemduyet')
})

async function comment(hidden = true) {
  const [row] = await h.harness.db.insert(articleComments).values({ body: 'Nội dung bị gắn cờ', isHidden: hidden, createdAt: new Date() })
  return Number(row.insertId)
}
async function queued(fields: Partial<typeof aiModerationQueue.$inferInsert> = {}) {
  const [row] = await h.harness.db.insert(aiModerationQueue).values({
    targetType: 'comment', authorIp: '203.0.113.5', contentSnippet: 'Nội dung bị gắn cờ',
    flaggedReason: 'Từ ngữ thô tục', status: 'pending', ...fields,
  })
  return Number(row.insertId)
}
const resolve = (id: number | string, body: unknown, who: Account | null = officer) =>
  h.request('POST', `/api/admin/ai/moderation/queue/${id}/resolve`, who, body)
const queueRows = () => h.harness.rows(aiModerationQueue).map(row => ({ id: row.id, status: row.status, reviewedBy: row.reviewedBy }))
const comments = () => h.harness.rows(articleComments).map(row => ({ id: row.id, isHidden: row.isHidden }))
const bans = () => h.harness.rows(readerIpBans).map(row => ({ value: row.value, reason: row.reason, createdBy: row.createdBy }))
const audits = () => h.harness.rows(activityLogs).map(row => ({ userId: row.userId, action: row.action, resource: row.resource, resourceId: row.resourceId, meta: row.meta as Json }))
const shape = (sql: string) => sql.replace(/^(\w+ (?:into |from )?)(?:.*? from )?(`\w+`).*?( for (?:update|share))?$/s, '$1$2$3')

// ─── Refusals ────────────────────────────────────────────────────────────────

test('ai.update is required: no session 401, read only or another resource 403; nothing written', async () => {
  const commentId = await comment()
  const id = await queued({ targetId: commentId })
  const readOnly = await h.account([{ resource: 'ai', canRead: true }], 'xem')
  const otherResource = await h.account([{ resource: 'comments', canRead: true, canUpdate: true, canDelete: true }], 'binhluan')
  assert.equal((await resolve(id, { action: 'approve' }, null)).status, 401)
  for (const who of [readOnly, otherResource]) {
    for (const action of ['approve', 'reject_delete', 'ban_ip']) assert.equal((await resolve(id, { action }, who)).status, 403, `${who.username} ${action}`)
  }
  assert.deepEqual([queueRows(), comments(), bans(), audits()], [[{ id, status: 'pending', reviewedBy: null }], [{ id: commentId, isHidden: true }], [], []])
})

test('a malformed id or action is a 400 and a missing row a 404, before anything is written', async () => {
  const id = await queued({ targetId: await comment() })
  for (const bad of ['abc', '0', '-3']) assert.equal((await resolve(bad, { action: 'approve' })).status, 400, bad)
  for (const body of [{}, { action: 'delete' }, { action: 'ban' }, 'approve']) {
    const response = await resolve(id, body)
    assert.deepEqual([response.status, response.body.statusMessage], [400, 'Thao tác không hợp lệ. Chọn approve, reject_delete hoặc ban_ip.'], JSON.stringify(body))
  }
  const missing = await resolve(9999, { action: 'approve' })
  assert.deepEqual([missing.status, missing.body.statusMessage], [404, 'Mục đối soát không tồn tại.'])
  assert.equal(queueRows()[0]!.status, 'pending')
  assert.deepEqual(audits(), [])
})

// ─── The three actions ───────────────────────────────────────────────────────

test('approve: the comment shows again, the row is approved by the officer, one audit row (meta an object)', async () => {
  const commentId = await comment()
  const other = await comment()
  const id = await queued({ targetId: commentId })
  const response = await resolve(id, { action: ' Approve ' })
  assert.deepEqual([response.status, response.body], [200, { ok: true, action: 'approve', id }])
  assert.deepEqual(comments(), [{ id: commentId, isHidden: false }, { id: other, isHidden: true }])
  assert.deepEqual(queueRows(), [{ id, status: 'approved', reviewedBy: officer.id }])
  assert.ok(h.harness.rows(aiModerationQueue)[0]!.reviewedAt instanceof Date)
  assert.deepEqual(audits(), [{ userId: officer.id, action: 'update', resource: 'ai', resourceId: id, meta: { type: 'resolve_moderation_queue', action: 'approve', targetType: 'comment', targetId: commentId } }])
})

test('reject_delete: the comment is deleted and the row rejected; statements in the base order, none under a lock', async () => {
  const commentId = await comment()
  const id = await queued({ targetId: commentId })
  assert.equal((await resolve(id, { action: 'reject_delete' })).status, 200)
  assert.deepEqual([comments(), queueRows()], [[], [{ id, status: 'rejected', reviewedBy: officer.id }]])
  assert.deepEqual(audits().map(a => a.meta.action), ['reject_delete'])
  assert.deepEqual(h.harness.txStatements.map(shape), ['delete from `article_comments`', 'update `ai_moderation_queue`', 'insert into `activity_logs`'])
})

test('ban_ip: the address is banned once with the flagged reason (first 200 characters), the comment deleted, the row banned', async () => {
  const commentId = await comment()
  const id = await queued({ targetId: commentId, flaggedReason: 'x'.repeat(300) })
  assert.equal((await resolve(id, { action: 'ban_ip' })).status, 200)
  assert.deepEqual(bans(), [{ value: '203.0.113.5', reason: `AI An ninh phát hiện vi phạm: ${'x'.repeat(200)}`, createdBy: officer.id }])
  assert.deepEqual([comments(), queueRows()], [[], [{ id, status: 'banned', reviewedBy: officer.id }]])
  assert.deepEqual(h.harness.txStatements.map(shape), ['select `reader_ip_bans`', 'insert into `reader_ip_bans`', 'delete from `article_comments`', 'update `ai_moderation_queue`', 'insert into `activity_logs`'])

  // A second row from the same address: the ban is already there, not inserted twice.
  const again = await queued({ targetId: await comment() })
  assert.equal((await resolve(again, { action: 'ban_ip' })).status, 200)
  assert.equal(bans().length, 1)
  assert.deepEqual(queueRows().map(row => row.status), ['banned', 'banned'])
})

test('FINDING-R7-2: ban_ip stores the address as the ban list does: an IPv4-mapped IPv6 author is banned (and found already banned) as its IPv4', async () => {
  const id = await queued({ targetId: await comment(), authorIp: '::FFFF:198.51.100.7' })
  assert.equal((await resolve(id, { action: 'ban_ip' })).status, 200)
  assert.deepEqual(bans().map(ban => ban.value), ['198.51.100.7'])
  const again = await queued({ targetId: await comment(), authorIp: '198.51.100.7' })
  assert.equal((await resolve(again, { action: 'ban_ip' })).status, 200)
  assert.equal(bans().length, 1)
})

test('FINDING-R7-2: ban_ip with no usable address is a 400 — no ban row, comment kept, row still pending', async () => {
  for (const authorIp of ['unknown', null, 'không-phải-ip', '203.0.113.0/33']) {
    h.reset()
    officer = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }], 'kiemduyet')
    const commentId = await comment()
    const id = await queued({ targetId: commentId, authorIp })
    const response = await resolve(id, { action: 'ban_ip' })
    // Before: `unknown` was stored as a ban (matching every visitor whose address could not be
    // read) and, with no address, the comment was deleted and the row said "Đã cấm IP".
    assert.deepEqual([response.status, response.body.statusMessage], [400, 'Mục này không có địa chỉ IP hợp lệ để chặn.'], String(authorIp))
    assert.deepEqual([bans(), comments(), queueRows().map(row => row.status), audits()], [[], [{ id: commentId, isHidden: true }], ['pending'], []], String(authorIp))
  }
})

// ─── All or nothing ──────────────────────────────────────────────────────────

test('a failed audit insert rolls the whole resolve back: comment, ban and status as they were', async () => {
  for (const action of ['approve', 'reject_delete', 'ban_ip']) {
    h.reset()
    officer = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }], 'kiemduyet')
    const commentId = await comment()
    const id = await queued({ targetId: commentId })
    h.harness.failNext(/^insert into `activity_logs`/)
    assert.equal((await resolve(id, { action })).status, 500, action)
    assert.deepEqual([comments(), bans(), queueRows()], [[{ id: commentId, isHidden: true }], [], [{ id, status: 'pending', reviewedBy: null }]], action)
  }
})

// ─── Contested transitions ───────────────────────────────────────────────────

/** Another officer's resolve, committed right before the first statement of this request's transaction. */
function competitorFirst(statements: string) {
  h.harness.beforeNext(/`(?:article_comments|reader_ip_bans)`/, () => h.harness.sqlite.exec(`COMMIT; ${statements}; BEGIN`))
}

test('FINDING-R7-1: an approve that loses to a reject is a 409 — the reject stands, nothing of the approve survives', async () => {
  const commentId = await comment()
  const id = await queued({ targetId: commentId })
  competitorFirst(`DELETE FROM article_comments WHERE id = ${commentId}; UPDATE ai_moderation_queue SET status = 'rejected', reviewed_by = 77 WHERE id = ${id}`)
  const response = await resolve(id, { action: 'approve' })
  // Before: 200, the row overwritten to "approved" (the comment it vouches for is gone) and a
  // second resolution in the audit log.
  assert.deepEqual([response.status, response.body.statusMessage], [409, 'Mục đối soát vừa được người khác xử lý. Vui lòng tải lại danh sách.'])
  assert.deepEqual([queueRows(), comments(), audits()], [[{ id, status: 'rejected', reviewedBy: 77 }], [], []])
})

test('FINDING-R7-1: a reject that loses to an approve is a 409 and its DELETE rolls back — the approved comment stays', async () => {
  const commentId = await comment()
  const id = await queued({ targetId: commentId })
  competitorFirst(`UPDATE article_comments SET is_hidden = 0 WHERE id = ${commentId}; UPDATE ai_moderation_queue SET status = 'approved', reviewed_by = 77 WHERE id = ${id}`)
  // Before: 200 — the comment another officer had just approved was deleted, the row "rejected".
  assert.equal((await resolve(id, { action: 'reject_delete' })).status, 409)
  assert.deepEqual([queueRows(), comments(), audits()], [[{ id, status: 'approved', reviewedBy: 77 }], [{ id: commentId, isHidden: false }], []])
})

test('FINDING-R7-1: a double click — the second of two identical approves is a 409, no second audit row', async () => {
  const commentId = await comment()
  const id = await queued({ targetId: commentId })
  // The first click committed while the second was between its read and its transaction.
  competitorFirst(`UPDATE article_comments SET is_hidden = 0 WHERE id = ${commentId}; UPDATE ai_moderation_queue SET status = 'approved', reviewed_by = ${officer.id} WHERE id = ${id}`)
  assert.equal((await resolve(id, { action: 'approve' })).status, 409)
  assert.deepEqual([queueRows(), comments(), audits()], [[{ id, status: 'approved', reviewedBy: officer.id }], [{ id: commentId, isHidden: false }], []])
})

test('FINDING-R7-1: a ban that loses the row to an approve is a 409 — the ban it inserted rolls back with it', async () => {
  const commentId = await comment()
  const id = await queued({ targetId: commentId })
  competitorFirst(`UPDATE article_comments SET is_hidden = 0 WHERE id = ${commentId}; UPDATE ai_moderation_queue SET status = 'approved', reviewed_by = 77 WHERE id = ${id}`)
  assert.equal((await resolve(id, { action: 'ban_ip' })).status, 409)
  assert.deepEqual([bans(), comments(), queueRows().map(row => row.status), audits()], [[], [{ id: commentId, isHidden: false }], ['approved'], []])
})

test('pinned (owner\'s call): a resolve from a non-pending status is accepted — approve after a reject answers "approved" over a deleted comment', async () => {
  const commentId = await comment()
  const id = await queued({ targetId: commentId })
  assert.equal((await resolve(id, { action: 'reject_delete' })).status, 200)
  assert.equal((await resolve(id, { action: 'approve' })).status, 200)
  assert.deepEqual([queueRows().map(row => row.status), comments()], [['approved'], []])
  assert.deepEqual(audits().map(a => a.meta.action), ['reject_delete', 'approve'])
})

test('pinned (FINDING-R7-4, owner\'s call): approve of a chat or livestream row changes only the queue row', async () => {
  const commentId = await comment()
  for (const targetType of ['chat', 'livestream_chat']) {
    const id = await queued({ targetType, targetId: commentId })
    assert.equal((await resolve(id, { action: 'approve' })).status, 200, targetType)
    assert.deepEqual(h.harness.txStatements.slice(-2).map(shape), ['update `ai_moderation_queue`', 'insert into `activity_logs`'], targetType)
  }
  assert.deepEqual(comments(), [{ id: commentId, isHidden: true }], 'a comment with the same id is not touched')
})

// ─── Two bans of one address ─────────────────────────────────────────────────

test('KNOWN (FINDING-R7-3, as the base): a ban that meets the same address banned since its read is a 500, everything rolled back — clicking again goes through', async () => {
  const commentId = await comment()
  const id = await queued({ targetId: commentId })
  // The other request's ban commits after this one's SELECT found none; its INSERT then hits the
  // unique key — MySQL answers ER_DUP_ENTRY (the harness's SQLite error carries no MySQL code).
  h.harness.beforeNext(/^insert into `reader_ip_bans`/, () => h.harness.sqlite.exec("COMMIT; INSERT INTO reader_ip_bans (value, reason) VALUES ('203.0.113.5', 'lượt kia'); BEGIN"))
  h.harness.failNext(/^insert into `reader_ip_bans`/, { errno: 1062, code: 'ER_DUP_ENTRY' })
  // Kept as the base answers it. Going on past the 1062 (tried in R7, reverted) kept the failed
  // INSERT's locks to commit and stalled bans of unrelated addresses — a lock-design change, its
  // own change. Only the other request's ban exists; nothing of this one survived.
  assert.equal((await resolve(id, { action: 'ban_ip' })).status, 500)
  assert.deepEqual([bans().map(ban => ban.reason), comments(), queueRows().map(row => row.status), audits()], [['lượt kia'], [{ id: commentId, isHidden: true }], ['pending'], []])
  assert.deepEqual(h.harness.txStatements.map(shape).slice(-2), ['select `reader_ip_bans`', 'insert into `reader_ip_bans`'], 'the transaction ends at the failed INSERT')

  // The officer clicks again: the read now finds the ban, nothing is inserted, the resolve goes through.
  assert.equal((await resolve(id, { action: 'ban_ip' })).status, 200)
  assert.deepEqual([bans().map(ban => ban.reason), comments(), queueRows().map(row => row.status), audits().length], [['lượt kia'], [], ['banned'], 1])
})

test('any other failure of the ban insert (a foreign key) is a 500 with everything rolled back', async () => {
  const commentId = await comment()
  const id = await queued({ targetId: commentId })
  h.harness.failNext(/^insert into `reader_ip_bans`/, { errno: 1452, code: 'ER_NO_REFERENCED_ROW_2' })
  assert.equal((await resolve(id, { action: 'ban_ip' })).status, 500)
  assert.deepEqual([bans(), comments(), queueRows().map(row => row.status), audits()], [[], [{ id: commentId, isHidden: true }], ['pending'], []])
})
