import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * The AI's verdict on a PENDING queue row whose mark its automatic hide reused (wave3/queue-ai-verdict).
 *
 * B01 (wave3/queue-restore): `insertQueueRowOnce` files one pending row per target, so when the AI
 * hides content that already has a pending row (a `flag_only` row filed while the AI was not
 * configured), no row is filed for the verdict and the hide writes the pending row's reason as its
 * mark. The verdict was then only in the log; officers saw "AI kiểm duyệt chưa cấu hình" next to
 * content the AI had judged violating. Now `noteAiVerdict` writes it on THAT row's `ai_verdict`
 * (one autocommit `UPDATE … WHERE id = ? AND status = 'pending'`), the queue tab and
 * `/admin/comments` show it, and `flagged_reason` — the mark "Bỏ ẩn" matches — is never touched.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_sqlite-mysql-db.ts`), the real `callAi` down to a
 * fake socket (`_ai-route-harness.ts`). Lock order and contention are NOT modelled here (one SQLite
 * connection): the statement's shape is pinned below, the MySQL 8 replay is in the change's proof.
 */

const { startAiRouteHarness, openAiReply } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.aiModerationQueue, s.aiModerationRules, s.articleComments, s.articles, s.mediaItems, s.livestreamMessages, s.readerAccounts, s.chatMessages, s.readerIpBans, s.activityLogs],
  routes: async load => [
    { method: 'post', path: '/api/admin/ai/moderation/queue/:id/resolve', handler: await load('../server/api/admin/ai/moderation/queue/[id]/resolve.post') },
    { method: 'get', path: '/api/admin/ai/moderation/queue', handler: await load('../server/api/admin/ai/moderation/queue.get') },
    { method: 'get', path: '/api/admin/comments', handler: await load('../server/api/admin/comments/index.get') },
  ],
})
after(() => h.server.close())
const worker = await import('../server/services/moderation-worker')
const { autoHideFlagReason } = await import('../server/utils/moderation-flag-reason')
const { QUEUE_AI_VERDICT_REASON_MAX_LENGTH } = await import('../shared/moderation-ai-verdict')
const { aiModerationQueue, aiModerationRules, articleComments, livestreamMessages, readerAccounts } = h.schema

const AUTHOR = 41
/** What `checkAndModerateContent` files when the AI is not configured and no keyword matched. */
const NOT_CONFIGURED = 'AI kiểm duyệt chưa cấu hình — cần con người đối soát nội dung'
const AI_REASON = 'Tuyên truyền xuyên tạc chính sách'

type Reply = { verdict?: unknown, intent?: unknown, riskLevel?: unknown, reason?: unknown }
const aiSays = (reply: Reply) => {
  h.network.reply = () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: openAiReply(JSON.stringify(reply)) })
}

let officer: Awaited<ReturnType<typeof h.account>>
beforeEach(async () => {
  h.reset()
  worker.invalidateModerationRulesCache()
  worker.resetWorkerStats()
  await h.seedAiService({ serviceKey: 'moderation' })
  aiSays({ verdict: 'violation', intent: 'propaganda', riskLevel: 'critical', reason: AI_REASON })
  officer = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }, { resource: 'comments', canRead: true }], 'kiemduyet')
  await h.harness.db.insert(readerAccounts).values({ id: AUTHOR, isBanned: false })
})

const insertId = (result: unknown) => Number((result as Array<{ insertId: number }>)[0]!.insertId)
const queued = async (fields: Partial<typeof aiModerationQueue.$inferInsert>) =>
  insertId(await h.harness.db.insert(aiModerationQueue).values({ targetType: 'comment', contentSnippet: 'Nội dung', flaggedReason: NOT_CONFIGURED, status: 'pending', ...fields }))
const comment = async (fields: Partial<typeof articleComments.$inferInsert> = {}) =>
  insertId(await h.harness.db.insert(articleComments).values({ body: 'nội dung mập mờ', isHidden: false, readerId: AUTHOR, createdAt: new Date(), ...fields }))
const queueRow = (id: number) => h.harness.rows(aiModerationQueue).find(row => row.id === id)!
const commentRow = (id: number) => h.harness.rows(articleComments).find(row => row.id === id)!
const check = (id: number, content = 'nội dung mập mờ') => worker.checkAndModerateContent({ content, targetType: 'comment', targetId: id })
const queueList = async (status: string) => {
  const response = await h.request('GET', `/api/admin/ai/moderation/queue?status=${status}`, officer)
  assert.equal(response.status, 200)
  return response.body.items as Array<{ id: number, flaggedReason: string, aiVerdict: unknown }>
}
const commentList = async (visibility: 'visible' | 'hidden') => {
  const response = await h.request('GET', `/api/admin/comments?visibility=${visibility}`, officer)
  assert.equal(response.status, 200)
  return response.body.comments as Array<{ id: number, flagReason: string | null, aiVerdict: unknown }>
}
/** Statements that wrote the verdict column. */
const verdictWrites = () => h.harness.statements.filter(sql => /^update `ai_moderation_queue` set `ai_verdict`/i.test(sql))

const NOTED = { verdict: 'violation', severity: 'critical', reason: AI_REASON }
/** Invisible characters, built from code points so this source carries none itself (Trojan Source). */
const RLO = String.fromCodePoint(0x202e) // RIGHT-TO-LEFT OVERRIDE
const ZWSP = String.fromCodePoint(0x200b) // ZERO WIDTH SPACE

test('the AI hides a comment that already has a pending flag_only row: its verdict lands on THAT row only — not the resolved row of the same comment, not another comment\'s, not a livestream row with the same id — and both admin lists show it', async () => {
  const id = await comment()
  const other = await comment({ isHidden: true, flagReason: 'Cán bộ ẩn tay' })
  const pending = await queued({ targetId: id })
  // Newer bait rows: each would take the verdict from a write that dropped one condition.
  const resolved = await queued({ targetId: id, flaggedReason: 'Lần duyệt trước của cán bộ', status: 'approved' })
  const otherRow = await queued({ targetId: other, flaggedReason: 'Hàng của bình luận khác' })
  const livestreamRow = await queued({ targetType: 'livestream_chat', targetId: id, flaggedReason: 'Hàng của tin livestream cùng id' })

  const out = await check(id)
  assert.deepEqual([out.action, out.hidden, out.failures], ['auto_hide', true, []])
  assert.equal(h.harness.rows(aiModerationQueue).length, 4, 'precondition: no row filed for the AI hide (a row about the comment is pending)')

  assert.deepEqual(queueRow(pending).aiVerdict, NOTED)
  assert.equal(queueRow(pending).flaggedReason, NOT_CONFIGURED, 'flagged_reason is the mark: never rewritten')
  for (const bait of [resolved, otherRow, livestreamRow]) assert.equal(queueRow(bait).aiVerdict, null, `row ${bait} must keep no verdict`)
  assert.deepEqual([commentRow(id).isHidden, commentRow(id).flagReason], [true, autoHideFlagReason(NOT_CONFIGURED)])

  const pendingItems = await queueList('pending')
  assert.deepEqual(pendingItems.map(item => [item.id, item.aiVerdict]).sort(), [[pending, NOTED], [otherRow, null], [livestreamRow, null]].sort())
  const hidden = await commentList('hidden')
  assert.deepEqual(hidden.map(row => [row.id, row.aiVerdict]).sort(), [[id, NOTED], [other, null]].sort())
})

test('after the officer approves, the row keeps its verdict (queue tab), the comment is shown again and carries none', async () => {
  const id = await comment()
  const pending = await queued({ targetId: id })
  await check(id)
  const response = await h.request('POST', `/api/admin/ai/moderation/queue/${pending}/resolve`, officer, { action: 'approve' })
  assert.deepEqual([response.status, response.body.restore], [200, 'restored'], 'the mark is untouched, so the approve still restores')
  assert.deepEqual([queueRow(pending).status, queueRow(pending).aiVerdict], ['approved', NOTED])
  assert.deepEqual((await queueList('approved')).map(item => [item.id, item.aiVerdict]), [[pending, NOTED]])
  assert.deepEqual((await commentList('visible')).map(row => [row.id, row.aiVerdict]), [[id, null]])
})

test('a rejected row keeps its verdict too (the comment is deleted with it)', async () => {
  const id = await comment()
  const pending = await queued({ targetId: id })
  await check(id)
  const response = await h.request('POST', `/api/admin/ai/moderation/queue/${pending}/resolve`, officer, { action: 'reject_delete' })
  assert.equal(response.status, 200)
  assert.deepEqual([queueRow(pending).status, queueRow(pending).aiVerdict], ['rejected', NOTED])
  assert.deepEqual((await queueList('rejected')).map(item => item.aiVerdict), [NOTED])
})

test('one autocommit UPDATE on the pool, by the row\'s primary key and `status = pending` (plus its own target) — no locking read, no transaction', async () => {
  const id = await comment()
  await queued({ targetId: id })
  const before = h.harness.transactionsBegun
  await check(id)
  assert.equal(h.harness.transactionsBegun, before, 'the check opens no transaction')
  const writes = verdictWrites()
  assert.equal(writes.length, 1)
  assert.match(writes[0]!, /^update `ai_moderation_queue` set `ai_verdict` = \? where \(`ai_moderation_queue`\.`id` = \? and `ai_moderation_queue`\.`status` = \? and `ai_moderation_queue`\.`target_type` = \? and `ai_moderation_queue`\.`target_id` = \?\)$/)
  assert.ok(h.harness.statements.every(sql => !/ for (?:update|share)$/i.test(sql)), 'no locking read anywhere in the check')
  // After the hide, never before it: the hide is what matters, the note is display only.
  const hideAt = h.harness.statements.findIndex(sql => /^update `article_comments` set `is_hidden`/i.test(sql))
  assert.ok(hideAt >= 0 && hideAt < h.harness.statements.indexOf(writes[0]!))
})

for (const status of ['approved', 'rejected', 'banned']) {
  test(`the row is resolved (${status}) between the lookup and the note: 0 rows, the column stays NULL, logged at info — the hide stands`, async () => {
    const id = await comment()
    const pending = await queued({ targetId: id })
    h.harness.beforeNext(/^update `ai_moderation_queue` set `ai_verdict`/i, () => {
      h.harness.sqlite.prepare('UPDATE ai_moderation_queue SET status = ? WHERE id = ?').run(status, pending)
    })
    const out = await check(id)
    assert.deepEqual([out.hidden, out.failures], [true, []])
    assert.deepEqual([queueRow(pending).status, queueRow(pending).aiVerdict], [status, null])
    const lines = h.logged.filter(line => line.includes('ai_moderation.verdict_row_resolved'))
    assert.equal(lines.length, 1)
    assert.ok(lines[0]!.startsWith('info ') && lines[0]!.includes(`queueId: ${pending}`), lines[0])
  })
}

test('the model\'s reason is cleaned and cut before it is stored: bidi/zero-width/control characters gone, white space one space, ≤ 300 code points, never half an emoji', async () => {
  const id = await comment()
  const pending = await queued({ targetId: id })
  // Cleaned, the prefix is 16 code points ("Lýdo bị ẩn ơơơơơ"), so the 299th kept code point is
  // the first emoji — whose high surrogate is UTF-16 unit 299: a cut by unit keeps half of it.
  aiSays({ verdict: 'spam', riskLevel: 'medium', reason: `Lý${RLO}do${ZWSP}  bị\n\tẩn ơơơơơ${'x'.repeat(282)}😀😀 đuôi` })
  await check(id)
  const stored = queueRow(pending).aiVerdict as { verdict: string, severity: string, reason: string }
  assert.deepEqual([stored.verdict, stored.severity], ['spam', 'medium'])
  const points = Array.from(stored.reason)
  assert.equal(points.length, QUEUE_AI_VERDICT_REASON_MAX_LENGTH)
  assert.ok(stored.reason.startsWith('Lýdo bị ẩn ơ'), stored.reason.slice(0, 30))
  assert.ok(stored.reason.endsWith('😀…'), 'cut by code point: the emoji whole, then the ellipsis')
  for (const gone of [RLO, ZWSP, '\n', '\t']) assert.ok(!stored.reason.includes(gone), `U+${gone.codePointAt(0)!.toString(16)} left in`)
  assert.doesNotMatch(stored.reason, /\p{Cs}/u)
})

test('a reply with a reason that is not a string, and an unknown risk level: the verdict is still noted (no reason, severity high) — "[object Object]" never reaches the column', async () => {
  const id = await comment()
  const pending = await queued({ targetId: id })
  aiSays({ verdict: 'violation', riskLevel: 'apocalyptic', reason: { text: 'lừa' } })
  const out = await check(id)
  assert.equal(out.hidden, true)
  assert.deepEqual(queueRow(pending).aiVerdict, { verdict: 'violation', severity: 'high', reason: '' })
})

test('nothing noted when the AI did not judge: the critical-keyword fallback after an AI error hides under the pending row\'s mark and writes no verdict', async () => {
  await h.harness.db.insert(aiModerationRules).values({ category: 'hostile_forces', ruleType: 'keyword', pattern: 'mập mờ', action: 'auto_hide', severity: 'critical', isEnabled: true })
  const id = await comment()
  const pending = await queued({ targetId: id })
  // The instant pre-screen would block on the rule first; its rules read fails (logged by nobody —
  // it falls back to the built-in dictionary), so the full check reaches the keyword fallback.
  h.harness.failNext(/^select .*from `ai_moderation_rules`/i)
  h.network.reply = () => ({ status: 500, headers: { 'content-type': 'application/json' }, body: '{"error":"down"}' })
  const out = await check(id)
  assert.deepEqual([out.action, out.severity, out.hidden, out.aiFailed], ['auto_hide', 'critical', true, true])
  assert.deepEqual([commentRow(id).isHidden, commentRow(id).flagReason], [true, autoHideFlagReason(NOT_CONFIGURED)])
  assert.equal(queueRow(pending).aiVerdict, null)
  assert.deepEqual(verdictWrites(), [])
  assert.deepEqual((await commentList('hidden')).map(row => row.aiVerdict), [null])
})

test('nothing noted when the AI filed its own row (nothing was pending): that row\'s reason IS the AI\'s', async () => {
  const id = await comment()
  await queued({ targetId: id, flaggedReason: 'Lần duyệt trước', status: 'approved' })
  await check(id)
  const rows = h.harness.rows(aiModerationQueue)
  assert.deepEqual(rows.map(row => [row.status, row.flaggedReason, row.aiVerdict]), [['approved', 'Lần duyệt trước', null], ['pending', AI_REASON, null]])
  assert.deepEqual(verdictWrites(), [])
})

test('nothing noted when the AI says safe', async () => {
  const id = await comment()
  const pending = await queued({ targetId: id })
  aiSays({ verdict: 'safe', riskLevel: 'low', reason: 'Bình thường' })
  const out = await check(id)
  assert.equal(out.flagged, false)
  assert.equal(queueRow(pending).aiVerdict, null)
  assert.deepEqual(verdictWrites(), [])
})

test('the note failing: logged (warn, the row id), counted on the worker — the hide still happened and `failures` is unchanged (a rescan would count it as a failed comment)', async () => {
  const id = await comment()
  const pending = await queued({ targetId: id })
  h.harness.failNext(/^update `ai_moderation_queue` set `ai_verdict`/i)
  const out = await check(id)
  assert.deepEqual([out.action, out.hidden, out.failures], ['auto_hide', true, []])
  assert.equal(commentRow(id).isHidden, true)
  assert.equal(queueRow(pending).aiVerdict, null)
  const failed = h.logged.filter(line => line.includes('ai_moderation.verdict_note_failed'))
  assert.equal(failed.length, 1)
  assert.ok(failed[0]!.startsWith('warn ') && failed[0]!.includes(`queueId: ${pending}`) && failed[0]!.includes('update `ai_moderation_queue` set `ai_verdict`'), failed[0])
  assert.equal(worker.getWorkerStats().errorCount, 1)
})

test('livestream: the live pass hides a message with a pending row — the verdict is noted on the livestream row', async () => {
  const id = insertId(await h.harness.db.insert(livestreamMessages).values({ sessionId: 9, readerId: AUTHOR, displayName: 'Bạn đọc C', content: 'tin mập mờ', isDeleted: false, createdAt: new Date() }))
  const pending = await queued({ targetType: 'livestream_chat', targetId: id })
  const commentBait = await queued({ targetType: 'comment', targetId: id, flaggedReason: 'Hàng của bình luận cùng id' })
  const out = await worker.checkAndModerateContent({ content: 'tin mập mờ', targetType: 'livestream_chat', targetId: id, sessionId: '9' })
  assert.deepEqual([out.hidden, out.failures], [true, []])
  assert.deepEqual([queueRow(pending).aiVerdict, queueRow(commentBait).aiVerdict], [NOTED, null])
})

test('/admin/comments: a verdict shows only next to the hide it explains — an officer\'s hide (another reason) and a hide whose matching row is no longer pending show none', async () => {
  const officerHidden = await comment({ isHidden: true, flagReason: 'Cán bộ ẩn: xúc phạm' })
  await queued({ targetId: officerHidden, aiVerdict: { verdict: 'violation', severity: 'high', reason: 'không thuộc lần ẩn này' } })
  const resolvedMark = await comment({ isHidden: true, flagReason: autoHideFlagReason(NOT_CONFIGURED) })
  await queued({ targetId: resolvedMark, status: 'approved', aiVerdict: { verdict: 'spam', severity: 'low', reason: 'hàng đã duyệt' } })
  const rows = await commentList('hidden')
  assert.deepEqual(rows.map(row => [row.id, row.aiVerdict]).sort(), [[officerHidden, null], [resolvedMark, null]].sort())
})

test('/admin/comments: two pending rows with the same mark — the newest decides, even when it has no verdict', async () => {
  const id = await comment({ isHidden: true, flagReason: autoHideFlagReason(NOT_CONFIGURED) })
  await queued({ targetId: id, aiVerdict: { verdict: 'violation', severity: 'high', reason: 'hàng cũ' } })
  await queued({ targetId: id })
  assert.deepEqual((await commentList('hidden')).map(row => row.aiVerdict), [null])
})

test('old and malformed stored values read as no verdict on both lists: NULL, a JSON string that is not an object, a wrong verdict, a wrong severity, an array, JSON null', async () => {
  // A JSON column holds only valid JSON (MySQL validates; MariaDB's alias carries a json_valid CHECK),
  // so "malformed" here is every valid JSON value that is not a verdict.
  const id = await comment({ isHidden: true, flagReason: autoHideFlagReason(NOT_CONFIGURED) })
  const legacy = await queued({ targetId: 999 })
  const stored = ['"không phải đối tượng"', '{"verdict":"safe","severity":"high","reason":"x"}', '{"verdict":"spam","severity":"extreme","reason":"x"}', '[1,2]', 'null']
  const ids: number[] = []
  for (const raw of stored) {
    const rowId = await queued({ targetId: id + 100 + ids.length })
    h.harness.sqlite.prepare('UPDATE ai_moderation_queue SET ai_verdict = ? WHERE id = ?').run(raw, rowId)
    ids.push(rowId)
  }
  const forComment = await queued({ targetId: id })
  h.harness.sqlite.prepare('UPDATE ai_moderation_queue SET ai_verdict = ? WHERE id = ?').run('{"verdict":"violation","reason":"thiếu mức độ"}', forComment)
  const items = await queueList('all')
  assert.deepEqual(items.map(item => item.aiVerdict), items.map(() => null))
  assert.equal(items.length, ids.length + 2)
  assert.ok(items.some(item => item.id === legacy))
  assert.deepEqual((await commentList('hidden')).map(row => row.aiVerdict), [null])
})

test('a stored reason is cleaned again on the way out (a row written by hand, or before the cleaning changed)', async () => {
  const id = await comment({ isHidden: true, flagReason: autoHideFlagReason(NOT_CONFIGURED) })
  const pending = await queued({ targetId: id })
  h.harness.sqlite.prepare('UPDATE ai_moderation_queue SET ai_verdict = ? WHERE id = ?')
    .run(JSON.stringify({ verdict: 'violation', severity: 'high', reason: `a${RLO}b\n<script>x</script>${'y'.repeat(400)}` }), pending)
  const [item] = await queueList('pending')
  const reason = (item!.aiVerdict as { reason: string }).reason
  assert.ok(reason.startsWith('ab <script>x</script>y'), 'bidi removed, newline a space; markup stays text — the page interpolates, never v-html')
  assert.equal(Array.from(reason).length, QUEUE_AI_VERDICT_REASON_MAX_LENGTH)
  assert.deepEqual((await commentList('hidden'))[0]!.aiVerdict, item!.aiVerdict)
})
