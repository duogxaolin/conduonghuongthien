import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * "Bỏ ẩn" (`approve`) on a row of the AI moderation queue shows the content again — but only what
 * THAT row's automatic hide still hides (owner's decision 2026-10-31; before, a livestream message
 * stayed removed whatever the officer decided — FINDING-R7-4 — and a comment was unhidden even
 * when an officer had hidden it since). The source of a hide is `flag_reason`: the automatic hide
 * writes the queue row's reason (`autoHideFlagReason`), an officer's hide writes their own or NULL,
 * an officer's livestream removal writes none. Per source:
 *   - comment: restored (visible, `flag_reason` cleared); kept hidden when an officer hid it, when
 *     it was re-hidden under another reason; `gone` when deleted; `visible` when already showing;
 *   - livestream message: the same, plus never for a banned author (a ban does not touch the
 *     messages, so the restore must not put them back); live viewers get the message after the
 *     commit; a reject/ban of an APPROVED row takes it down again (the page offers "Xóa" on approved
 *     rows) and tells the viewers; a reject/ban of any other row writes nothing to it (the base's);
 *   - chatbot turn: nothing to restore (a refused question is stored as asked, nothing is hidden);
 *   - only a row read as `pending` restores anything;
 *   - contested: two officers at once — the loser is a 409 and shows nothing a second time.
 * End to end: the hides of an instant block reached through `checkAndModerateContent` and the
 * rescan file their target on the queue row, so the approve finds them (before: `target_id` NULL);
 * an automatic hide never overwrites a hide already there (an officer's, made while it ran).
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`); the competing request is
 * committed between two statements of the handler's transaction (`COMMIT; …; BEGIN`).
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.aiModerationQueue, s.aiModerationRules, s.articleComments, s.livestreamMessages, s.readerAccounts, s.chatMessages, s.readerIpBans, s.activityLogs],
  routes: async load => [
    { method: 'post', path: '/api/admin/ai/moderation/queue/:id/resolve', handler: await load('../server/api/admin/ai/moderation/queue/[id]/resolve.post') },
  ],
})
after(() => h.server.close())
const sse = await import('../server/utils/sse-manager')
const worker = await import('../server/services/moderation-worker')
const { aiModerationQueue, articleComments, livestreamMessages, readerAccounts, chatMessages, activityLogs } = h.schema

type Json = Record<string, unknown>
type Account = Awaited<ReturnType<typeof h.account>>
let officer: Account
const SESSION = 5
const AUTHOR = 7
const REASON = 'AI phân tích ngữ cảnh: lời lẽ xúc phạm người khác'

const pushed: Array<{ event?: string, data?: unknown }> = []
const stream = { push: (m: { event?: string, data?: unknown }) => { pushed.push(m); return Promise.resolve() }, close: () => Promise.resolve(), onClosed: () => {} }
after(() => sse.releaseStream(stream))

beforeEach(async () => {
  h.reset()
  pushed.length = 0
  sse.releaseStream(stream)
  sse.registerStream(stream, SESSION)
  officer = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }], 'kiemduyet')
  await h.harness.db.insert(readerAccounts).values({ id: AUTHOR, isBanned: false })
})

const insertId = (result: unknown) => Number((result as Array<{ insertId: number }>)[0]!.insertId)
const comment = async (fields: Partial<typeof articleComments.$inferInsert> = {}) =>
  insertId(await h.harness.db.insert(articleComments).values({ body: 'Bình luận bị ẩn', isHidden: true, flagReason: REASON, createdAt: new Date(), ...fields }))
const message = async (fields: Partial<typeof livestreamMessages.$inferInsert> = {}) =>
  insertId(await h.harness.db.insert(livestreamMessages).values({
    sessionId: SESSION, readerId: AUTHOR, displayName: 'Bạn đọc A', content: 'Tin bị gỡ', isDeleted: true, flagReason: REASON,
    createdAt: new Date('2026-10-30T10:00:00.123Z'), ...fields,
  }))
const queued = async (fields: Partial<typeof aiModerationQueue.$inferInsert> = {}) =>
  insertId(await h.harness.db.insert(aiModerationQueue).values({
    targetType: 'comment', authorIp: '203.0.113.5', contentSnippet: 'Nội dung', flaggedReason: REASON, status: 'pending', ...fields,
  }))
const resolve = (id: number, action: string) => h.request('POST', `/api/admin/ai/moderation/queue/${id}/resolve`, officer, { action })
const commentRows = () => h.harness.rows(articleComments).map(row => ({ id: row.id, isHidden: row.isHidden, flagReason: row.flagReason }))
const messageRows = () => h.harness.rows(livestreamMessages).map(row => ({ id: row.id, isDeleted: row.isDeleted, flagReason: row.flagReason }))
const statuses = () => h.harness.rows(aiModerationQueue).map(row => row.status)
const audits = () => h.harness.rows(activityLogs).map(row => row.meta as Json)
const events = () => pushed.map(m => ({ event: m.event, data: JSON.parse(String(m.data)) as Json }))

// ─── Comments ────────────────────────────────────────────────────────────────

test('comment: approve shows the comment this row hid — visible, its flag_reason cleared, restore "restored" in the answer and the audit row', async () => {
  const id = await comment()
  const other = await comment()
  const row = await queued({ targetId: id })
  const response = await resolve(row, 'approve')
  assert.deepEqual([response.status, response.body], [200, { ok: true, action: 'approve', id: row, restore: 'restored' }])
  assert.deepEqual(commentRows(), [{ id, isHidden: false, flagReason: null }, { id: other, isHidden: true, flagReason: REASON }])
  assert.deepEqual([statuses(), audits()], [['approved'], [{ type: 'resolve_moderation_queue', action: 'approve', targetType: 'comment', targetId: id, restore: 'restored' }]])
})

test('comment: hidden by an officer since (their reason, or none) — kept hidden, restore "not_restored"; the row is still approved', async () => {
  for (const flagReason of ['Cán bộ ẩn: spam lặp lại', null, `${REASON} `.toUpperCase()]) {
    h.reset()
    officer = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }], 'kiemduyet')
    const id = await comment({ flagReason })
    const row = await queued({ targetId: id })
    const response = await resolve(row, 'approve')
    // Before: 200 and the comment shown again — an officer's hide undone by an approve of the AI's.
    assert.deepEqual([response.status, response.body.restore], [200, 'not_restored'], String(flagReason))
    assert.deepEqual([commentRows(), statuses()], [[{ id, isHidden: true, flagReason }], ['approved']], String(flagReason))
    assert.equal(h.harness.txStatements.filter(sql => /^update `article_comments`/.test(sql)).length, 0, 'no write to a comment that is not ours to show')
  }
})

test('comment: already showing → "visible" (nothing written); deleted → "gone"', async () => {
  const shown = await comment({ isHidden: false, flagReason: null })
  assert.equal((await resolve(await queued({ targetId: shown }), 'approve')).body.restore, 'visible')
  assert.equal((await resolve(await queued({ targetId: 9999 }), 'approve')).body.restore, 'gone')
  assert.deepEqual(commentRows(), [{ id: shown, isHidden: false, flagReason: null }])
  assert.equal(h.harness.txStatements.filter(sql => /^update `article_comments`/.test(sql)).length, 0)
})

test('comment: the mark is the queue reason cut to 255 characters by code point — a long reason with an emoji at the cut still matches', async () => {
  const { autoHideFlagReason } = await import('../server/utils/moderation-flag-reason')
  const long = `${'ư'.repeat(254)}😀 và phần còn lại`
  assert.equal(Array.from(autoHideFlagReason(long)).length, 255)
  assert.ok(autoHideFlagReason(long).endsWith('😀'), 'cut by code point, never half a surrogate pair')
  const id = await comment({ flagReason: autoHideFlagReason(long) })
  assert.equal((await resolve(await queued({ targetId: id, flaggedReason: long }), 'approve')).body.restore, 'restored')
  assert.deepEqual(commentRows(), [{ id, isHidden: false, flagReason: null }])
})

test('only a row read as pending restores: approve of a resolved row (accepted, owner\'s call) shows nothing — "not_applicable"', async () => {
  const id = await comment()
  const row = await queued({ targetId: id, status: 'rejected' })
  const response = await resolve(row, 'approve')
  assert.deepEqual([response.status, response.body.restore, commentRows(), statuses()], [200, 'not_applicable', [{ id, isHidden: true, flagReason: REASON }], ['approved']])
})

// ─── Livestream messages ─────────────────────────────────────────────────────

test('livestream: approve shows the message again and, after the commit, sends it to the viewers of its broadcast', async () => {
  const id = await message()
  const other = await message({ content: 'tin khác' })
  const row = await queued({ targetType: 'livestream_chat', targetId: id, sessionId: String(SESSION) })
  const response = await resolve(row, 'approve')
  // Before (FINDING-R7-4): 200, the queue row "approved", the message still removed for everyone.
  assert.deepEqual([response.status, response.body.restore], [200, 'restored'])
  assert.deepEqual(messageRows(), [{ id, isDeleted: false, flagReason: null }, { id: other, isDeleted: true, flagReason: REASON }])
  assert.deepEqual(events(), [{ event: 'message', data: { id, displayName: 'Bạn đọc A', content: 'Tin bị gỡ', createdAt: '2026-10-30T10:00:00.123Z' } }])
  assert.deepEqual(audits().map(meta => meta.restore), ['restored'])
})

test('livestream: removed by an officer (no mark), re-hidden under another reason, or its author banned — kept removed, nothing broadcast', async () => {
  for (const [label, fields, banned] of [
    ['officer removal', { flagReason: null }, false],
    ['another reason', { flagReason: 'Mẫu regex: x+' }, false],
    ['author banned', {}, true],
  ] as const) {
    h.reset()
    pushed.length = 0
    officer = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }], 'kiemduyet')
    await h.harness.db.insert(readerAccounts).values({ id: AUTHOR, isBanned: banned })
    const id = await message(fields)
    const response = await resolve(await queued({ targetType: 'livestream_chat', targetId: id }), 'approve')
    assert.deepEqual([response.status, response.body.restore, messageRows()[0]!.isDeleted, events()], [200, 'not_restored', true, []], label)
  }
})

test('livestream: already showing → "visible", gone → "gone"; neither broadcasts', async () => {
  const shown = await message({ isDeleted: false, flagReason: null })
  assert.equal((await resolve(await queued({ targetType: 'livestream_chat', targetId: shown }), 'approve')).body.restore, 'visible')
  assert.equal((await resolve(await queued({ targetType: 'livestream_chat', targetId: 4242 }), 'approve')).body.restore, 'gone')
  assert.deepEqual(events(), [])
})

test('livestream: reject or ban AFTER an approve takes the message down again (an officer\'s removal, no mark) and tells the viewers', async () => {
  for (const action of ['reject_delete', 'ban_ip']) {
    h.reset()
    pushed.length = 0
    officer = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }], 'kiemduyet')
    const id = await message()
    const row = await queued({ targetType: 'livestream_chat', targetId: id })
    assert.equal((await resolve(row, 'approve')).body.restore, 'restored', action)
    const response = await resolve(row, action)
    // Without this the row read "Đã xóa" over a message every viewer could still read.
    assert.deepEqual([response.status, response.body.restore], [200, null], action)
    assert.deepEqual(messageRows(), [{ id, isDeleted: true, flagReason: null }], action)
    assert.deepEqual(events().map(e => [e.event, e.data.id]), [['message', id], ['removal', id]], action)
    // A later approve of that row (the server accepts it) does not show it again.
    assert.equal((await resolve(row, 'approve')).body.restore, 'not_applicable', action)
    assert.equal(messageRows()[0]!.isDeleted, true, action)
  }
})

test('livestream: reject of a pending row writes nothing to the message (it is already removed) and broadcasts nothing', async () => {
  const id = await message()
  assert.equal((await resolve(await queued({ targetType: 'livestream_chat', targetId: id }), 'reject_delete')).status, 200)
  assert.deepEqual([messageRows(), events(), statuses()], [[{ id, isDeleted: true, flagReason: REASON }], [], ['rejected']])
  assert.equal(h.harness.txStatements.filter(sql => /^update `livestream_messages`/.test(sql)).length, 0)
})

test('livestream: reject/ban of a row that is not approved is the base\'s — a message an AI "flag_only" verdict left showing stays, nothing broadcast', async () => {
  // Only an approved row's message was put back by this change; anything else keeps the base's
  // "reject unchanged" (owner's brief). A flag_only row's message was never hidden — KNOWN.
  for (const [action, status] of [['reject_delete', 'pending'], ['ban_ip', 'pending'], ['reject_delete', 'banned'], ['ban_ip', 'rejected']] as const) {
    h.reset()
    pushed.length = 0
    officer = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }], 'kiemduyet')
    const id = await message({ isDeleted: false, flagReason: null })
    assert.equal((await resolve(await queued({ targetType: 'livestream_chat', targetId: id, status }), action)).status, 200, `${action} ${status}`)
    assert.deepEqual([messageRows(), events()], [[{ id, isDeleted: false, flagReason: null }], []], `${action} ${status}`)
    assert.equal(h.harness.txStatements.filter(sql => /`livestream_messages`/.test(sql)).length, 0, `${action} ${status}`)
  }
})

// ─── Chatbot turns ───────────────────────────────────────────────────────────

test('chatbot turn: nothing to restore — the row has no target as filed, and a chat_messages row with the same id is never touched', async () => {
  const [stored] = await h.harness.db.insert(chatMessages).values({ sessionId: 's-1', role: 'user', content: 'câu hỏi', isFlagged: true, flagReason: REASON, createdAt: new Date() })
  for (const targetId of [null, Number(stored.insertId)]) {
    const response = await resolve(await queued({ targetType: 'chat', targetId }), 'approve')
    assert.deepEqual([response.status, response.body.restore], [200, 'not_applicable'], String(targetId))
  }
  assert.deepEqual(h.harness.rows(chatMessages).map(row => [row.isFlagged, row.flagReason]), [[true, REASON]])
})

// ─── Contested and all-or-nothing ────────────────────────────────────────────

/** Another officer's request, committed just before the next statement of this request's transaction that matches `at`. */
function competitor(at: RegExp, statements: string) {
  let fired = false
  h.harness.beforeNext(at, () => { fired = true; h.harness.sqlite.exec(`COMMIT; ${statements}; BEGIN`) })
  return () => assert.ok(fired, 'the competing request never ran — the race was not exercised')
}

test('double click on "Bỏ ẩn" (livestream): the second approve is a 409 — no second broadcast, no second audit row', async () => {
  const id = await message()
  const row = await queued({ targetType: 'livestream_chat', targetId: id })
  const ran = competitor(/`livestream_messages`/, `UPDATE livestream_messages SET is_deleted = 0, flag_reason = NULL WHERE id = ${id}; UPDATE ai_moderation_queue SET status = 'approved', reviewed_by = ${officer.id} WHERE id = ${row}`)
  assert.equal((await resolve(row, 'approve')).status, 409)
  ran()
  assert.deepEqual([messageRows(), statuses(), audits(), events()], [[{ id, isDeleted: false, flagReason: null }], ['approved'], [], []])
})

test('approve that loses to a reject (livestream) is a 409: the message stays removed, nothing broadcast', async () => {
  const id = await message()
  const row = await queued({ targetType: 'livestream_chat', targetId: id })
  const ran = competitor(/`livestream_messages`/, `UPDATE ai_moderation_queue SET status = 'rejected', reviewed_by = 77 WHERE id = ${row}`)
  assert.equal((await resolve(row, 'approve')).status, 409)
  ran()
  assert.deepEqual([messageRows(), statuses(), audits(), events()], [[{ id, isDeleted: true, flagReason: REASON }], ['rejected'], [], []])
})

test('an officer hides the comment between the read and the write: the conditional UPDATE re-checks — kept hidden, "not_restored"', async () => {
  const id = await comment()
  const row = await queued({ targetId: id })
  const ran = competitor(/^update `article_comments`/, `UPDATE article_comments SET flag_reason = 'Cán bộ ẩn tay' WHERE id = ${id}`)
  const response = await resolve(row, 'approve')
  ran()
  assert.deepEqual([response.status, response.body.restore, commentRows(), statuses()], [200, 'not_restored', [{ id, isHidden: true, flagReason: 'Cán bộ ẩn tay' }], ['approved']])
})

test('the same for a livestream message removed by an officer between the read and the write', async () => {
  const id = await message()
  const ran = competitor(/^update `livestream_messages`/, `UPDATE livestream_messages SET flag_reason = NULL WHERE id = ${id}`)
  const response = await resolve(await queued({ targetType: 'livestream_chat', targetId: id }), 'approve')
  ran()
  assert.deepEqual([response.body.restore, messageRows()[0]!.isDeleted, events()], ['not_restored', true, []])
})

test('a failed audit insert rolls the restore back: still hidden, row pending, nothing broadcast', async () => {
  const c = await comment()
  const m = await message()
  for (const [targetType, targetId] of [['comment', c], ['livestream_chat', m]] as const) {
    h.harness.failNext(/^insert into `activity_logs`/)
    assert.equal((await resolve(await queued({ targetType, targetId }), 'approve')).status, 500, targetType)
  }
  assert.deepEqual([commentRows()[0]!.isHidden, messageRows()[0]!.isDeleted, statuses(), events()], [true, true, ['pending', 'pending'], []])
})

// ─── End to end: the hide the worker writes is the one the approve finds ─────

test('instant block reached through checkAndModerateContent (a saved comment): the queue row carries the comment, the approve shows it again', async () => {
  const id = await comment({ isHidden: false, flagReason: null })
  const out = await worker.checkAndModerateContent({ content: 'mày djt', targetType: 'comment', targetId: id })
  assert.equal(out.hidden, true)
  const [row] = h.harness.rows(aiModerationQueue)
  // Before: `target_id` NULL — no approve could ever find the comment it hid.
  assert.deepEqual([row!.targetType, row!.targetId], ['comment', id])
  assert.equal((await resolve(Number(row!.id), 'approve')).body.restore, 'restored')
  assert.deepEqual(commentRows(), [{ id, isHidden: false, flagReason: null }])
})

test('an officer hid the content while the automatic check ran: the hide keeps the officer\'s reason, and the approve keeps it hidden', async () => {
  // The AI pass runs in the background for seconds; overwriting the officer's hide with the
  // automatic mark would let "Bỏ ẩn" on the queue row show what the officer hid.
  const c = await comment({ body: 'mày djt', flagReason: 'Cán bộ ẩn tay' })
  const m = await message({ content: 'kubet nạp tiền', flagReason: null })
  assert.equal((await worker.checkAndModerateContent({ content: 'mày djt', targetType: 'comment', targetId: c })).hidden, true)
  assert.equal((await worker.checkAndModerateContent({ content: 'kubet nạp tiền', targetType: 'livestream_chat', targetId: m })).hidden, true)
  assert.deepEqual([commentRows(), messageRows()], [[{ id: c, isHidden: true, flagReason: 'Cán bộ ẩn tay' }], [{ id: m, isDeleted: true, flagReason: null }]])
  const rows = h.harness.rows(aiModerationQueue).map(row => ({ id: Number(row.id), target: [row.targetType, row.targetId] }))
  assert.deepEqual(rows.map(row => row.target), [['comment', c], ['livestream_chat', m]])
  for (const row of rows) assert.equal((await resolve(row.id, 'approve')).body.restore, 'not_restored', String(row.target[0]))
  assert.deepEqual([commentRows(), messageRows(), events()], [[{ id: c, isHidden: true, flagReason: 'Cán bộ ẩn tay' }], [{ id: m, isDeleted: true, flagReason: null }], []])
})

test('rescan (rules only: AI not configured): the comment and the livestream message it hides come back with "Bỏ ẩn" on their rows', async () => {
  const bad = await comment({ isHidden: false, flagReason: null, body: 'đồ djt' })
  await comment({ isHidden: false, flagReason: null, body: 'Cảm ơn bài viết' })
  const msg = await message({ isDeleted: false, flagReason: null, content: 'kubet nạp tiền' })
  const summary = await worker.rescanExistingContent()
  assert.deepEqual([summary.aiUnavailable, summary.hiddenComments, summary.deletedMessages], [true, 1, 1])
  const rows = h.harness.rows(aiModerationQueue).map(row => ({ id: Number(row.id), targetType: row.targetType, targetId: row.targetId }))
  assert.deepEqual(rows.map(row => [row.targetType, row.targetId]), [['comment', bad], ['livestream_chat', msg]])
  for (const row of rows) assert.equal((await resolve(row.id, 'approve')).body.restore, 'restored', row.targetType)
  assert.equal(commentRows().find(c => c.id === bad)!.isHidden, false)
  assert.deepEqual([messageRows(), events().map(e => [e.event, e.data.id])], [[{ id: msg, isDeleted: false, flagReason: null }], [['message', msg]]])
})
