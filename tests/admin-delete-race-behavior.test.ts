import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * Four admin write routes that no test loaded (slice R7, task item 7 — the 0 % write/delete routes
 * of `server/api`, picked by what they destroy):
 *   DELETE /api/admin/chatbot/sessions/:id          (one citizen conversation — chatbot_knowledge.delete)
 *   POST   /api/admin/chatbot/sessions/bulk-delete  (up to 100 — chatbot_knowledge.delete)
 *   DELETE /api/admin/ai/moderation/rules/:id       (ai.delete)
 *   PATCH  /api/admin/comments/:id/visibility       (comments.update)
 *
 * The invariants: the permission and nothing written on a refusal; the write and its audit row
 * (`meta` an object) commit together — a failed audit insert leaves the rows; and a row that is
 * gone by the time the write runs (another officer, the retention purge, a ban) is a 404 with no
 * audit row — before, each of the three single-row routes read the row outside its transaction,
 * wrote by id without counting, and answered 200 with an audit row for a deletion or a change
 * that did not happen (FINDING-R7-12, the R6-10 rule; same statements, same order, nothing read
 * under a lock). The bulk delete already counted (`deletedCount`); pinned as it is.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`). The competing delete is
 * committed right before the first statement of the handler's transaction (`COMMIT; …; BEGIN`).
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.chatSessions, s.chatMessages, s.aiModerationRules, s.articleComments, s.activityLogs],
  routes: async load => [
    { method: 'delete', path: '/api/admin/chatbot/sessions/:id', handler: await load('../server/api/admin/chatbot/sessions/[id]/index.delete') },
    { method: 'post', path: '/api/admin/chatbot/sessions/bulk-delete', handler: await load('../server/api/admin/chatbot/sessions/bulk-delete.post') },
    { method: 'delete', path: '/api/admin/ai/moderation/rules/:id', handler: await load('../server/api/admin/ai/moderation/rules/[id].delete') },
    { method: 'patch', path: '/api/admin/comments/:id/visibility', handler: await load('../server/api/admin/comments/[id]/visibility.patch') },
  ],
})
after(() => h.server.close())
const { chatSessions, chatMessages, aiModerationRules, articleComments, activityLogs } = h.schema

type Account = Awaited<ReturnType<typeof h.account>>
let officer: Account
beforeEach(async () => {
  h.reset()
  officer = await h.account([
    { resource: 'chatbot_knowledge', canRead: true, canDelete: true },
    { resource: 'ai', canRead: true, canDelete: true },
    { resource: 'comments', canRead: true, canUpdate: true },
  ], 'canbo')
})

const NOW = new Date(Date.UTC(2026, 9, 20, 2, 0, 0))
async function conversation(id: string, contact: string | null = null, messages = 2) {
  await h.harness.db.insert(chatSessions).values({ id, detectedPhone: contact, messageCount: messages, startedAt: NOW, lastMessageAt: NOW })
  for (let n = 0; n < messages; n++) await h.harness.db.insert(chatMessages).values({ sessionId: id, role: 'user', content: `câu ${n}`, createdAt: NOW })
}
async function rule(pattern = 'cờ bạc') {
  const [row] = await h.harness.db.insert(aiModerationRules).values({ category: 'gambling', pattern })
  return Number(row.insertId)
}
async function comment(hidden = false) {
  const [row] = await h.harness.db.insert(articleComments).values({ body: 'Bình luận', isHidden: hidden, createdAt: NOW })
  return Number(row.insertId)
}
const audits = () => h.harness.rows(activityLogs).map(row => ({ action: row.action, resource: row.resource, resourceId: row.resourceId, meta: row.meta as Record<string, unknown> }))
const sessionIds = () => h.harness.rows(chatSessions).map(row => row.id)
/** Another request's write, committed before the first statement of this request's transaction. */
const competitorFirst = (pattern: RegExp, statements: string) => h.harness.beforeNext(pattern, () => h.harness.sqlite.exec(`COMMIT; ${statements}; BEGIN`))

// ─── Refusals ────────────────────────────────────────────────────────────────

test('each route needs its permission: read-only is a 403 and nothing is written', async () => {
  await conversation('s-1')
  const ruleId = await rule()
  const commentId = await comment()
  const reader = await h.account([{ resource: 'chatbot_knowledge', canRead: true }, { resource: 'ai', canRead: true }, { resource: 'comments', canRead: true }], 'xem')
  for (const [method, path, body] of [
    ['DELETE', '/api/admin/chatbot/sessions/s-1', undefined],
    ['POST', '/api/admin/chatbot/sessions/bulk-delete', { ids: ['s-1'] }],
    ['DELETE', `/api/admin/ai/moderation/rules/${ruleId}`, undefined],
    ['PATCH', `/api/admin/comments/${commentId}/visibility`, { hidden: true }],
  ] as const) {
    assert.equal((await h.request(method, path, reader, body)).status, 403, path)
  }
  assert.deepEqual([sessionIds(), h.harness.rows(aiModerationRules).length, h.harness.rows(articleComments)[0]!.isHidden, audits()], [['s-1'], 1, false, []])
})

// ─── One conversation ────────────────────────────────────────────────────────

test('deleting a conversation removes it and its messages, audited with what it held; unknown → 404', async () => {
  await conversation('s-1', '0903480985', 3)
  await conversation('s-2')
  const response = await h.request('DELETE', '/api/admin/chatbot/sessions/s-1', officer)
  assert.deepEqual([response.status, response.body], [200, { ok: true, deleted: 's-1' }])
  assert.deepEqual([sessionIds(), h.harness.rows(chatMessages).map(row => row.sessionId)], [['s-2'], ['s-2', 's-2']])
  assert.deepEqual(audits(), [{ action: 'delete', resource: 'chat_sessions', resourceId: null, meta: { sessionId: 's-1', messageCount: 3, hasContact: true, ip: '127.0.0.1' } }])
  assert.equal((await h.request('DELETE', '/api/admin/chatbot/sessions/khong-co', officer)).status, 404)

  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await h.request('DELETE', '/api/admin/chatbot/sessions/s-2', officer)).status, 500)
  assert.deepEqual([sessionIds(), h.harness.rows(chatMessages).length], [['s-2'], 2], 'no audit row, no deletion')
})

test('FINDING-R7-12: a conversation deleted since the read (retention, another officer) is a 404 with no audit row', async () => {
  await conversation('s-1')
  competitorFirst(/^delete from `chat_messages`/, "DELETE FROM chat_messages WHERE session_id = 's-1'; DELETE FROM chat_sessions WHERE id = 's-1'")
  const response = await h.request('DELETE', '/api/admin/chatbot/sessions/s-1', officer)
  // Before: 200 and a "delete" audit row for a conversation this request did not remove.
  assert.equal(response.status, 404)
  assert.deepEqual(audits(), [])
})

// ─── Bulk ────────────────────────────────────────────────────────────────────

test('bulk delete: listed conversations and their messages go, one audit row with the counts; malformed lists are 400s', async () => {
  await conversation('s-1', '0903480985')
  await conversation('s-2')
  await conversation('s-3')
  const response = await h.request('POST', '/api/admin/chatbot/sessions/bulk-delete', officer, { ids: ['s-1', 's-2', 'khong-co', 7] })
  assert.deepEqual([response.status, response.body], [200, { ok: true, deleted: 2 }])
  assert.deepEqual([sessionIds(), h.harness.rows(chatMessages).every(row => row.sessionId === 's-3')], [['s-3'], true])
  assert.deepEqual(audits().map(a => a.meta), [{ requestedCount: 3, deletedCount: 2, hasContact: true, ip: '127.0.0.1' }])
  for (const body of [{}, { ids: [] }, { ids: [1, null] }, { ids: Array.from({ length: 101 }, (_, n) => `s-${n}`) }, { ids: 's-3' }]) {
    assert.equal((await h.request('POST', '/api/admin/chatbot/sessions/bulk-delete', officer, body)).status, 400, JSON.stringify(body).slice(0, 40))
  }
  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await h.request('POST', '/api/admin/chatbot/sessions/bulk-delete', officer, { ids: ['s-3'] })).status, 500)
  assert.deepEqual(sessionIds(), ['s-3'])
})

test('pinned: a bulk delete that finds nothing still writes its audit row, saying 0 were deleted', async () => {
  const response = await h.request('POST', '/api/admin/chatbot/sessions/bulk-delete', officer, { ids: ['khong-co'] })
  assert.deepEqual([response.status, response.body.deleted, audits().map(a => a.meta.deletedCount)], [200, 0, [0]])
})

// ─── Moderation rule ─────────────────────────────────────────────────────────

test('deleting a moderation rule removes it, audited with its pattern; unknown → 404; a failed audit keeps the rule', async () => {
  const id = await rule('đánh bạc')
  const response = await h.request('DELETE', `/api/admin/ai/moderation/rules/${id}`, officer)
  assert.deepEqual([response.status, response.body], [200, { ok: true }])
  assert.deepEqual([h.harness.rows(aiModerationRules), audits()], [[], [{ action: 'delete', resource: 'ai', resourceId: id, meta: { type: 'delete_moderation_rule', pattern: 'đánh bạc' } }]])
  assert.equal((await h.request('DELETE', `/api/admin/ai/moderation/rules/${id}`, officer)).status, 404)
  const kept = await rule()
  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await h.request('DELETE', `/api/admin/ai/moderation/rules/${kept}`, officer)).status, 500)
  assert.equal(h.harness.rows(aiModerationRules).length, 1)
})

test('FINDING-R7-12: a rule deleted by another officer since the read is a 404 with no second audit row', async () => {
  const id = await rule()
  competitorFirst(/^delete from `ai_moderation_rules`/, `DELETE FROM ai_moderation_rules WHERE id = ${id}`)
  assert.equal((await h.request('DELETE', `/api/admin/ai/moderation/rules/${id}`, officer)).status, 404)
  assert.deepEqual(audits(), [])
})

// ─── Comment visibility ──────────────────────────────────────────────────────

test('hide with a reason, show again (reason cleared), each audited; the same state with no reason writes nothing', async () => {
  const id = await comment()
  const hide = await h.request('PATCH', `/api/admin/comments/${id}/visibility`, officer, { hidden: true, reason: '  spam  ' })
  assert.deepEqual([hide.status, hide.body], [200, { ok: true, id, hidden: true }])
  assert.deepEqual(h.harness.rows(articleComments).map(row => [row.isHidden, row.flagReason]), [[true, 'spam']])
  assert.equal((await h.request('PATCH', `/api/admin/comments/${id}/visibility`, officer, { hidden: true })).status, 200)
  assert.equal(audits().length, 1, 'no change, no reason: nothing written')
  assert.equal((await h.request('PATCH', `/api/admin/comments/${id}/visibility`, officer, { hidden: false, reason: 'bỏ qua' })).status, 200)
  assert.deepEqual(h.harness.rows(articleComments).map(row => [row.isHidden, row.flagReason]), [[false, null]])
  assert.deepEqual(audits().map(a => a.meta), [{ visibility: 'hidden', reason: 'spam' }, { visibility: 'visible', reason: null }])
  for (const bad of ['abc', '0']) assert.equal((await h.request('PATCH', `/api/admin/comments/${bad}/visibility`, officer, { hidden: true })).status, 400)
  assert.equal((await h.request('PATCH', '/api/admin/comments/9999/visibility', officer, { hidden: true })).status, 404)
})

test('FINDING-R7-12: a comment deleted since the read (a ban, a purge) is a 404 with no audit row', async () => {
  const id = await comment()
  competitorFirst(/^update `article_comments`/, `DELETE FROM article_comments WHERE id = ${id}`)
  const response = await h.request('PATCH', `/api/admin/comments/${id}/visibility`, officer, { hidden: true, reason: 'spam' })
  // Before: 200 { hidden: true } and an audit row hiding a comment that no longer exists.
  assert.deepEqual([response.status, response.body.statusMessage], [404, 'Bình luận không tồn tại.'])
  assert.deepEqual(audits(), [])
})
