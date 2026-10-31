import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * "Bỏ ẩn" (`approve`) when the automatic hide came from the AI verdict while ANOTHER row about the
 * same content was still pending (B01, verifier of wave3/queue-restore, 2026-10-31).
 *
 * `insertQueueRowOnce` files one pending row per target: a comment queued `flag_only` while the AI
 * was not configured keeps that row; when the AI later hides the comment (a rescan, or the live
 * pass of a livestream message), its own row is skipped. The hide used to write ITS reason as the
 * mark — which matched no row, so approving the only row about the content answered
 * `not_restored` and left it hidden for good (the base showed it again). Now the skipped hide
 * writes the mark of the row that is pending — the row the officer approves.
 *
 * The lookup reads exactly the row the skip saw (same target type, same id, `pending`): a resolved
 * row of the same content, a row of another comment and a row of another kind with the same id
 * are each newer than the pending one here, so a lookup that drops one filter takes the wrong mark.
 *
 * Its own file: the AI gateway caches a service's config for 60 s per key, so the `moderation`
 * service is seeded before every test of this file and never absent (the rules-only paths live in
 * `moderation-queue-restore-behavior.test.ts`). Real h3 app + `admin-auth`, SQL on SQLite, the real
 * `callAi` down to a fake socket (`_ai-route-harness.ts`).
 */

const { startAiRouteHarness, openAiReply } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.aiModerationQueue, s.aiModerationRules, s.articleComments, s.livestreamMessages, s.readerAccounts, s.chatMessages, s.readerIpBans, s.activityLogs],
  routes: async load => [
    { method: 'post', path: '/api/admin/ai/moderation/queue/:id/resolve', handler: await load('../server/api/admin/ai/moderation/queue/[id]/resolve.post') },
  ],
})
after(() => h.server.close())
const sse = await import('../server/utils/sse-manager')
const worker = await import('../server/services/moderation-worker')
const { autoHideFlagReason } = await import('../server/utils/moderation-flag-reason')
const { aiModerationQueue, articleComments, livestreamMessages, readerAccounts } = h.schema

const SESSION = 9
const AUTHOR = 41
/** What `checkAndModerateContent` files when the AI is not configured and no keyword matched. */
const NOT_CONFIGURED = 'AI kiểm duyệt chưa cấu hình — cần con người đối soát nội dung'
const AI_REASON = 'Tuyên truyền xuyên tạc chính sách'

const pushed: Array<{ event?: string, data?: unknown }> = []
const stream = { push: (m: { event?: string, data?: unknown }) => { pushed.push(m); return Promise.resolve() }, close: () => Promise.resolve(), onClosed: () => {} }
after(() => sse.releaseStream(stream))

let officer: Awaited<ReturnType<typeof h.account>>
beforeEach(async () => {
  h.reset()
  pushed.length = 0
  sse.releaseStream(stream)
  sse.registerStream(stream, SESSION)
  await h.seedAiService({ serviceKey: 'moderation' })
  h.network.reply = () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: openAiReply(JSON.stringify({ verdict: 'violation', intent: 'propaganda', riskLevel: 'high', reason: AI_REASON })) })
  officer = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }], 'kiemduyet')
  await h.harness.db.insert(readerAccounts).values({ id: AUTHOR, isBanned: false })
})

const insertId = (result: unknown) => Number((result as Array<{ insertId: number }>)[0]!.insertId)
const queued = async (fields: Partial<typeof aiModerationQueue.$inferInsert>) =>
  insertId(await h.harness.db.insert(aiModerationQueue).values({ targetType: 'comment', contentSnippet: 'Nội dung', flaggedReason: NOT_CONFIGURED, status: 'pending', ...fields }))
const resolve = (id: number) => h.request('POST', `/api/admin/ai/moderation/queue/${id}/resolve`, officer, { action: 'approve' })
const queueRows = () => h.harness.rows(aiModerationQueue).map(row => [row.targetType, row.targetId, row.status])

test('B01 comment: queued flag_only while the AI was not configured, hidden later by the AI on a rescan — the hide carries the pending row\'s mark, approving it shows the comment again', async () => {
  const id = insertId(await h.harness.db.insert(articleComments).values({ body: 'nội dung mập mờ', isHidden: false, readerId: AUTHOR, createdAt: new Date() }))
  // Hidden by an officer (not rescanned): its own pending row, newer than the one about `id`.
  const otherComment = insertId(await h.harness.db.insert(articleComments).values({ body: 'khác', isHidden: true, flagReason: 'Cán bộ ẩn tay', readerId: AUTHOR, createdAt: new Date() }))
  const pending = await queued({ targetId: id })
  await queued({ targetId: id, flaggedReason: 'Lần duyệt trước của cán bộ', status: 'approved' })
  await queued({ targetId: otherComment, flaggedReason: 'Hàng của bình luận khác' })
  await queued({ targetType: 'livestream_chat', targetId: id, flaggedReason: 'Hàng của tin livestream cùng id' })

  const summary = await worker.rescanExistingContent({ maxMessages: 0 })
  assert.equal(summary.hiddenComments, 1, 'precondition: the AI verdict hid the visible comment')
  assert.equal(h.harness.rows(aiModerationQueue).length, 4, 'precondition: no row filed for the AI hide (a row about the comment is pending)')
  const hidden = h.harness.rows(articleComments).find(row => row.id === id)!
  const response = await resolve(pending)
  // Before: the AI's own reason as the mark — no row carries it — so 200 "not_restored": the only
  // row about the comment could not show it again.
  assert.deepEqual([hidden.isHidden, hidden.flagReason, response.status, response.body.restore], [true, autoHideFlagReason(NOT_CONFIGURED), 200, 'restored'])
  const shown = h.harness.rows(articleComments).find(row => row.id === id)!
  assert.deepEqual([shown.isHidden, shown.flagReason], [false, null])
  assert.deepEqual(queueRows()[0], ['comment', id, 'approved'])
})

test('B01 livestream: a message with a pending row (a long reason, an emoji at the cut) hidden by the AI verdict of the live pass — approve shows it and tells the viewers once', async () => {
  const id = insertId(await h.harness.db.insert(livestreamMessages).values({ sessionId: SESSION, readerId: AUTHOR, displayName: 'Bạn đọc C', content: 'tin mập mờ', isDeleted: false, createdAt: new Date('2026-10-31T02:00:00.000Z') }))
  const long = `${'ơ'.repeat(254)}😀 phần sau dấu cắt`
  const pending = await queued({ targetType: 'livestream_chat', targetId: id, sessionId: String(SESSION), flaggedReason: long })
  await queued({ targetType: 'livestream_chat', targetId: id, flaggedReason: 'Lần duyệt trước của cán bộ', status: 'approved' })
  await queued({ targetType: 'comment', targetId: id, flaggedReason: 'Hàng của bình luận cùng id' })

  const out = await worker.checkAndModerateContent({ content: 'tin mập mờ', targetType: 'livestream_chat', targetId: id, sessionId: String(SESSION) })
  assert.deepEqual([out.action, out.hidden, out.failures], ['auto_hide', true, []])
  assert.equal(h.harness.rows(aiModerationQueue).length, 3, 'precondition: no row filed for the AI hide')
  const removed = h.harness.rows(livestreamMessages)[0]!
  const response = await resolve(pending)
  assert.deepEqual([removed.isDeleted, removed.flagReason, response.status, response.body.restore], [true, autoHideFlagReason(long), 200, 'restored'])
  const shown = h.harness.rows(livestreamMessages)[0]!
  assert.deepEqual([shown.isDeleted, shown.flagReason], [false, null])
  assert.deepEqual(pushed.filter(m => m.event === 'message').map(m => (JSON.parse(String(m.data)) as { id: number }).id), [id])
})

test('a hide that filed its own row still writes its own reason (nothing pending: no lookup changes the mark)', async () => {
  const id = insertId(await h.harness.db.insert(articleComments).values({ body: 'câu xấu', isHidden: false, readerId: AUTHOR, createdAt: new Date() }))
  await queued({ targetId: id, flaggedReason: 'Lần duyệt trước của cán bộ', status: 'approved' })
  const out = await worker.checkAndModerateContent({ content: 'câu xấu', targetType: 'comment', targetId: id })
  assert.deepEqual([out.action, out.hidden], ['auto_hide', true])
  const rows = h.harness.rows(aiModerationQueue)
  assert.deepEqual(rows.map(row => [row.status, row.flaggedReason]), [['approved', 'Lần duyệt trước của cán bộ'], ['pending', AI_REASON]])
  assert.equal(h.harness.rows(articleComments)[0]!.flagReason, autoHideFlagReason(AI_REASON))
  assert.equal((await resolve(Number(rows[1]!.id))).body.restore, 'restored')
})
