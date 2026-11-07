import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The knowledge bank's lifecycle (draft → published → archived) through the REAL admin routes and the
 * REAL service (`server/services/chatbot-knowledge.ts`), on Drizzle's own MySQL statements run on
 * SQLite (tests/_sqlite-mysql-db.ts), over a real h3 app. Only the actor is injected (as
 * `admin-auth` would leave it in `event.context.adminUser`) — every permission check is the real
 * `requireChatbotKnowledgePermission`.
 *
 * Invariants:
 *   - each route does only its own action: `publish` needs `canPublish`, `archive` needs
 *     `canArchive`, create needs `canCreate`, update `canUpdate` — holding the neighbouring flag
 *     is a 403 and the row is untouched; a SuperAdmin needs no grant;
 *   - a row is born `draft` with no reviewer and no lifecycle dates, whatever the body says; a
 *     `status` key on create or update is a 400 and writes nothing;
 *   - publishing requires an answer and a source; an invalid publish leaves the row a draft; a
 *     successful one records the reviewer, the dates and one audit row;
 *   - editing a PUBLISHED row cannot strip its answer/source (it would publish an unsourced
 *     answer), and editing never changes the lifecycle fields or the status;
 *   - every successful write leaves an audit row of its own and bumps the answer-cache version.
 *
 * Before this file the three source-text blocks of `tests/chatbot-knowledge-lifecycle-contract.test.ts`
 * (route text, service text) stood for this; the editor-page block there stays (structure).
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { chatbotKnowledge, chatbotKnowledgeTerms, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([chatbotKnowledge, chatbotKnowledgeTerms, activityLogs])

let cacheBumps = 0
mock.module('../server/services/chatbot-answer-cache', {
  namedExports: { bumpAnswerCacheVersion: async () => { cacheBumps += 1 } },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const h3 = await import('h3')
const actorFromHeader = h3.defineEventHandler((event) => {
  const raw = h3.getRequestHeader(event, 'x-test-actor')
  if (raw) event.context.adminUser = JSON.parse(raw)
})
const create = (await import('../server/api/admin/chatbot/knowledge/index.post')).default
const update = (await import('../server/api/admin/chatbot/knowledge/[id].put')).default
const publish = (await import('../server/api/admin/chatbot/knowledge/[id]/publish.post')).default
const archive = (await import('../server/api/admin/chatbot/knowledge/[id]/archive.post')).default
const server = await startHandlerServer([
  { method: 'post', path: '/api/admin/chatbot/knowledge', handler: create },
  { method: 'put', path: '/api/admin/chatbot/knowledge/:id', handler: update },
  { method: 'post', path: '/api/admin/chatbot/knowledge/:id/publish', handler: publish },
  { method: 'post', path: '/api/admin/chatbot/knowledge/:id/archive', handler: archive },
], [actorFromHeader])
after(() => server.close())

const NO_GRANTS = { resource: 'chatbot_knowledge', canCreate: false, canRead: false, canUpdate: false, canDelete: false, canPublish: false, canArchive: false }
const actor = (id: number, grants: Partial<typeof NO_GRANTS> = {}, isSuperAdmin = false) =>
  ({ id, isSuperAdmin, permissions: [{ ...NO_GRANTS, ...grants }] })
const as = (who: ReturnType<typeof actor>) => ({ 'x-test-actor': JSON.stringify(who) })

const EDITOR = actor(6, { canCreate: true, canUpdate: true })
const PUBLISHER = actor(2, { canPublish: true })
const ARCHIVER = actor(4, { canArchive: true })
const SUPER = actor(1, {}, true)

const GOOD = { canonicalQuestion: 'Hoàn lương là gì?', approvedAnswer: 'Người đã chấp hành xong án phạt tù.', sourceLabel: 'Bộ luật Hình sự', topic: 'Hoàn lương' }
const post = (path: string, who: ReturnType<typeof actor> | null, body?: unknown) =>
  server.request('POST', `/api/admin/chatbot/knowledge${path}`, { headers: who ? as(who) : {}, body: body ?? {} })
const put = (id: number, who: ReturnType<typeof actor>, body: unknown) =>
  server.request('PUT', `/api/admin/chatbot/knowledge/${id}`, { headers: as(who), body })
const row = (id: number) => harness.rows(chatbotKnowledge).find(each => each.id === id)
const audit = () => harness.rows(activityLogs)

async function draft(body: Record<string, unknown> = GOOD): Promise<number> {
  const response = await post('', EDITOR, body)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  return Number((response.body.item as { id: number }).id)
}

beforeEach(() => {
  harness.reset()
  cacheBumps = 0
})

test('create: a row is born a draft with no reviewer or dates, whatever the body claims; the audit row names the author', async () => {
  const response = await post('', EDITOR, { ...GOOD, reviewerId: 99, reviewedAt: '2020-01-01', publishedAt: '2020-01-01', archivedAt: '2020-01-01', authorId: 55 })
  assert.equal(response.status, 200)
  const stored = row(Number((response.body.item as { id: number }).id))!
  assert.equal(stored.status, 'draft')
  assert.equal(stored.authorId, EDITOR.id, 'the author is the caller, not what the body says')
  assert.deepEqual([stored.reviewerId, stored.reviewedAt, stored.publishedAt, stored.archivedAt], [null, null, null, null])
  assert.deepEqual(audit().map(each => [each.userId, each.action, each.resource]), [[EDITOR.id, 'create', 'chatbot_knowledge']])
  assert.equal(cacheBumps, 1)
})

test('create/update with a status key, either value: 400 and nothing written', async () => {
  const id = await draft()
  const before = { rows: harness.rows(chatbotKnowledge), audit: audit().length, bumps: cacheBumps }
  for (const status of ['published', 'archived', 'draft']) {
    assert.equal((await post('', EDITOR, { ...GOOD, status })).status, 400, `create with status=${status}`)
    assert.equal((await put(id, EDITOR, { status })).status, 400, `update with status=${status}`)
  }
  assert.deepEqual(harness.rows(chatbotKnowledge), before.rows, 'no row changed or appeared')
  assert.equal(audit().length, before.audit)
  assert.equal(cacheBumps, before.bumps)
})

test('each route needs exactly its own flag: the neighbouring flag is a 403 and the row is untouched', async () => {
  const id = await draft()
  const stamp = harness.rows(chatbotKnowledge)
  const auditCount = audit().length

  assert.equal((await post(`/${id}/publish`, ARCHIVER)).status, 403, 'canArchive does not publish')
  assert.equal((await post(`/${id}/publish`, EDITOR)).status, 403, 'create/update does not publish')
  assert.equal((await post(`/${id}/archive`, PUBLISHER)).status, 403, 'canPublish does not archive')
  assert.equal((await post(`/${id}/archive`, EDITOR)).status, 403)
  assert.equal((await post('', PUBLISHER, GOOD)).status, 403, 'canPublish does not create')
  assert.equal((await put(id, PUBLISHER, { topic: 'x' })).status, 403, 'canPublish does not update')
  assert.equal((await post(`/${id}/publish`, null)).status, 401, 'no session')
  assert.deepEqual(harness.rows(chatbotKnowledge), stamp)
  assert.equal(audit().length, auditCount)

  assert.equal((await post(`/${id}/publish`, PUBLISHER)).status, 200)
  assert.equal(row(id)!.status, 'published')
  assert.equal((await post(`/${id}/archive`, ARCHIVER)).status, 200)
  assert.equal(row(id)!.status, 'archived')
})

test('a SuperAdmin with no grants can publish and archive', async () => {
  const id = await draft()
  assert.equal((await post(`/${id}/publish`, SUPER)).status, 200)
  assert.equal((await post(`/${id}/archive`, SUPER)).status, 200)
  assert.equal(row(id)!.status, 'archived')
})

test('publish needs an answer and a source: an invalid publish is a 400 that leaves the draft a draft', async () => {
  const noSource = await draft({ canonicalQuestion: 'Không nguồn', approvedAnswer: 'Có câu trả lời', topic: 'x' })
  const auditCount = audit().length
  const response = await post(`/${noSource}/publish`, PUBLISHER)
  assert.equal(response.status, 400)
  assert.equal(row(noSource)!.status, 'draft')
  assert.equal(row(noSource)!.reviewerId, null)
  assert.equal(audit().length, auditCount, 'a refused publish is not audited as a publish')

  assert.equal((await post('/999/publish', PUBLISHER)).status, 404, 'unknown id')
  assert.equal((await post('/abc/publish', PUBLISHER)).status, 400, 'a non-numeric id')
})

test('publish records the reviewer and dates and writes ONE audit row in the same transaction; archive likewise', async () => {
  const id = await draft()
  const [auditBefore, bumpsBefore, txBefore] = [audit().length, cacheBumps, harness.txStatements.length]

  assert.equal((await post(`/${id}/publish`, PUBLISHER)).status, 200)
  const published = row(id)!
  assert.equal(published.status, 'published')
  assert.equal(published.reviewerId, PUBLISHER.id)
  assert.ok(published.reviewedAt instanceof Date && published.publishedAt instanceof Date, 'reviewed and published dates are set')
  assert.equal(published.archivedAt, null)
  assert.deepEqual(audit().slice(auditBefore).map(each => [each.userId, each.action, each.resourceId]), [[PUBLISHER.id, 'publish', id]])
  const tx = harness.txStatements.slice(txBefore)
  assert.ok(tx.some(sql => /^update `chatbot_knowledge`/.test(sql)) && tx.some(sql => /^insert into `activity_logs`/.test(sql)),
    `the status change and its audit row must share one transaction: ${tx.join(' | ')}`)

  assert.equal((await post(`/${id}/archive`, ARCHIVER)).status, 200)
  const archived = row(id)!
  assert.equal(archived.status, 'archived')
  assert.equal(archived.reviewerId, ARCHIVER.id)
  assert.ok(archived.archivedAt instanceof Date)
  assert.deepEqual(audit().slice(auditBefore).map(each => each.action), ['publish', 'archive'])
  assert.equal(cacheBumps - bumpsBefore, 2, 'each lifecycle change refreshes the answer cache')
})

test('an audit failure rolls the status change back: no published answer without its trail', async () => {
  const id = await draft()
  harness.failNext(/^insert into `activity_logs`/)
  const response = await post(`/${id}/publish`, PUBLISHER)
  assert.equal(response.status, 500)
  assert.equal(row(id)!.status, 'draft')
  assert.equal(row(id)!.reviewerId, null)
})

test('updating a PUBLISHED row cannot strip its answer or source; allowed edits go through and never touch the lifecycle', async () => {
  const id = await draft()
  await post(`/${id}/publish`, PUBLISHER)
  const published = row(id)!

  assert.equal((await put(id, EDITOR, { approvedAnswer: '   ' })).status, 400, 'a blank answer')
  assert.equal((await put(id, EDITOR, { approvedAnswer: null })).status, 400, 'a null answer')
  assert.equal((await put(id, EDITOR, { sourceLabel: null })).status, 400, 'dropping the only source')
  assert.deepEqual(row(id), published, 'a refused edit changes nothing')

  const ok = await put(id, EDITOR, { approvedAnswer: 'Câu trả lời đã sửa.', topic: 'Pháp luật', reviewerId: 99, publishedAt: '2001-01-01', priority: 4 })
  assert.equal(ok.status, 200)
  const edited = row(id)!
  assert.equal(edited.approvedAnswer, 'Câu trả lời đã sửa.')
  assert.equal(edited.topic, 'Pháp luật')
  assert.equal(edited.priority, 4)
  assert.equal(edited.status, 'published', 'an edit never changes the status')
  assert.equal(edited.reviewerId, PUBLISHER.id, 'nor the reviewer')
  assert.deepEqual(edited.publishedAt, published.publishedAt, 'nor the dates')
})

test('a draft may be saved without a source (the source is required at publish, not at edit)', async () => {
  const id = await draft({ canonicalQuestion: 'Nháp', approvedAnswer: 'Tạm', topic: 'x' })
  assert.equal((await put(id, EDITOR, { approvedAnswer: 'Tạm sửa' })).status, 200)
  assert.equal(row(id)!.approvedAnswer, 'Tạm sửa')
  assert.equal(row(id)!.status, 'draft')
})
