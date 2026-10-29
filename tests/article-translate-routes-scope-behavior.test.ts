import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The permission scope of the three routes that start an AI translation of articles — as it IS
 * (slice R7, task item 2: record the behaviour, change nothing; the policy is the owner's call):
 *   POST /api/admin/articles/:id/translations/translate      (translate.post.ts)
 *   POST /api/admin/articles/:id/translations/translate-all  (translate-all.post.ts)
 *   POST /api/admin/articles/bulk-translate                  (bulk-translate.post.ts)
 *
 * What these tests pin:
 *   - each route is gated on `news.update` FIXED, whatever the article's type, AND the service
 *     then asks `update` on the article's own type (`articleResource(type)`) — the gate is the
 *     intersection: no route lets `news.update` start a translation of a `document` article,
 *     and an editor of documents only cannot translate their own articles (403 at the gate);
 *   - existence is answered before permission (FINDING-R7-5, reported, not changed): a `document`
 *     the caller may not update is a 403, a missing id a 404 — the id oracle R6-13/R6-16 closed on
 *     other article routes. translate-all with nothing left to translate answers 200 for any
 *     existing id without asking about its type;
 *   - bulk-translate checks the type of every id it can FIND, skips the ones it cannot and still
 *     counts them, audits them and hands them to the background job — a fractional id passes the
 *     `> 0` filter, matches no row in the check and reaches the job's INSERT (on MySQL, 1.5 → 2:
 *     a row on article 2 whatever its type — `mysql-bulk-fractional-id.sh`; FINDING-R7-5).
 *
 * The AI worker is replaced (`runTranslationWorker` recorded, never called on a provider); the
 * bulk job's own loop is real and is awaited before each test ends, so no write lands after the
 * next test's reset. SQL on SQLite (`_ai-route-harness.ts`).
 */

const workerCalls: unknown[][] = []
mock.module('../server/services/article-translation-worker', {
  namedExports: {
    LANGUAGE_NAMES: { en: 'English', zh: 'Chinese' },
    parseTitleAndExcerpt: (text: string) => ({ title: text, excerpt: '' }),
    runTranslationWorker: async (...args: unknown[]) => { workerCalls.push(args) },
  },
})

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.articles, s.articleTranslations, s.languages, s.activityLogs],
  routes: async load => [
    { method: 'post', path: '/api/admin/articles/:id/translations/translate', handler: await load('../server/api/admin/articles/[id]/translations/translate.post') },
    { method: 'post', path: '/api/admin/articles/:id/translations/translate-all', handler: await load('../server/api/admin/articles/[id]/translations/translate-all.post') },
    { method: 'post', path: '/api/admin/articles/bulk-translate', handler: await load('../server/api/admin/articles/bulk-translate.post') },
  ],
})
after(() => h.server.close())
const { getBulkTranslationTaskState } = await import('../server/services/article-translations')
const { articles, articleTranslations, languages, activityLogs } = h.schema

type Account = Awaited<ReturnType<typeof h.account>>
let newsEditor: Account // news: read + update

beforeEach(async () => {
  h.reset()
  workerCalls.length = 0
  newsEditor = await h.account([{ resource: 'news', canRead: true, canUpdate: true }], 'tintuc')
  await h.harness.db.insert(languages).values([
    { code: 'vi', name: 'Tiếng Việt', nativeName: 'Tiếng Việt', isActive: true },
    { code: 'en', name: 'English', nativeName: 'English', isActive: true },
    { code: 'zh', name: 'Chinese', nativeName: '中文', isActive: true },
  ])
})

let seq = 0
async function article(type = 'news') {
  seq += 1
  const [row] = await h.harness.db.insert(articles).values({ type, title: `Bài ${seq}`, slug: `bai-${seq}`, status: 'published' })
  return Number(row.insertId)
}
/** The background work these routes start (a 0 ms timer, then the bulk job's loop) has finished. */
async function backgroundDone() {
  const timers = () => new Promise(resolve => setTimeout(resolve, 1)) // after every 0 ms job timer already queued
  await timers()
  for (let spins = 0; spins < 200; spins++) {
    if (!getBulkTranslationTaskState().active) return timers()
    await timers()
  }
  throw new Error('bulk translation still running')
}
const translate = (id: number | string, body: unknown, who: Account | null = newsEditor) => h.request('POST', `/api/admin/articles/${id}/translations/translate`, who, body)
const translateAll = (id: number | string, who: Account | null = newsEditor) => h.request('POST', `/api/admin/articles/${id}/translations/translate-all`, who, {})
const bulk = (body: unknown, who: Account | null = newsEditor) => h.request('POST', '/api/admin/articles/bulk-translate', who, body)
const translations = () => h.harness.rows(articleTranslations).map(row => [row.articleId, row.langCode, row.status])
const audits = () => h.harness.rows(activityLogs).map(row => row.meta as Record<string, unknown>)
const FORBIDDEN = [403, 'Forbidden: Insufficient permissions']

test('translate: news.update on a news article starts one job — a `translating` row and its audit row together, the worker after the response', async () => {
  const id = await article()
  const response = await translate(id, { langCode: ' EN ', targetStatus: 'published' })
  assert.deepEqual([response.status, response.body], [200, { ok: true, message: 'Đã bắt đầu dịch. Vui lòng đợi.' }])
  assert.deepEqual(translations(), [[id, 'en', 'translating']])
  assert.deepEqual(audits(), [{ operation: 'create_article_translation', articleId: id, langCode: 'en', translatedBy: 'ai' }])
  await backgroundDone()
  assert.deepEqual(workerCalls, [[id, 'en', 'English', 'published']])

  const again = await translate(id, { langCode: 'en' })
  assert.deepEqual([again.status, again.body.statusMessage], [409, 'Bản dịch đang được tạo, vui lòng đợi.'])
})

test('the route gate is news.update, fixed: no session 401, news read-only 403 — and an editor of documents only is refused on a document', async () => {
  const news = await article()
  const documentId = await article('document')
  const newsReader = await h.account([{ resource: 'news', canRead: true }], 'xem')
  const documentsEditor = await h.account([{ resource: 'documents', canRead: true, canUpdate: true }], 'vanban')
  assert.equal((await translate(news, { langCode: 'en' }, null)).status, 401)
  for (const [who, id] of [[newsReader, news], [documentsEditor, documentId]] as const) {
    for (const response of [await translate(id, { langCode: 'en' }, who), await translateAll(id, who), await bulk({ ids: [id], langCode: 'en' }, who)]) {
      assert.deepEqual([response.status, response.body.statusMessage], FORBIDDEN, who.username)
    }
  }
  await backgroundDone()
  assert.deepEqual([translations(), audits(), workerCalls], [[], [], []])
})

test('news.update cannot start a translation of a document on any route; news.update + documents.update can', async () => {
  const documentId = await article('document')
  for (const response of [await translate(documentId, { langCode: 'en' }), await translateAll(documentId), await bulk({ ids: [documentId], langCode: 'en' })]) {
    assert.deepEqual([response.status, response.body.statusMessage], FORBIDDEN)
  }
  await backgroundDone()
  assert.deepEqual([translations(), audits(), workerCalls], [[], [], []])

  const both = await h.account([{ resource: 'news', canUpdate: true }, { resource: 'documents', canUpdate: true }], 'cahai')
  assert.equal((await translate(documentId, { langCode: 'en' }, both)).status, 200)
  assert.deepEqual(translations(), [[documentId, 'en', 'translating']])
})

test('FINDING-R7-5 (reported, not changed): existence is answered before permission — a document the caller may not update 403, a missing id 404', async () => {
  const documentId = await article('document')
  for (const send of [(id: number) => translate(id, { langCode: 'en' }), translateAll]) {
    assert.deepEqual((await send(documentId)).status, 403)
    const missing = await send(99_999)
    assert.deepEqual([missing.status, missing.body.statusMessage], [404, 'Bài viết không tồn tại.'])
  }
  // translate-all with nothing left to translate never asks about the type: 200 for any existing id.
  await h.harness.db.insert(articleTranslations).values([{ articleId: documentId, langCode: 'en', status: 'published' }, { articleId: documentId, langCode: 'zh', status: 'ai_draft' }])
  const done = await translateAll(documentId)
  assert.deepEqual([done.status, done.body], [200, { ok: true, queued: 0, languages: [], message: 'Tất cả các ngôn ngữ đã có bản dịch!' }])
  assert.deepEqual(audits(), [])
})

test('translate-all queues every active language but vi that has no translation or a failed one; the type is checked before the first write', async () => {
  const id = await article()
  await h.harness.db.insert(articleTranslations).values({ articleId: id, langCode: 'zh', status: 'failed' })
  const response = await translateAll(id)
  assert.deepEqual([response.status, response.body.queued, response.body.languages], [200, 2, ['en', 'zh']])
  await backgroundDone()
  assert.deepEqual(workerCalls.map(call => call.slice(0, 2)), [[id, 'en'], [id, 'zh']])
  assert.deepEqual(audits().map(meta => meta.langCode), ['en', 'zh'])
})

test('bulk-translate: a missing id is skipped by the check but counted, audited and handed to the job; a 0 ms job after the response', async () => {
  const news = await article()
  const response = await bulk({ articleIds: [news, 99_999, 'x', -1, 0], langCode: 'en' })
  assert.deepEqual([response.status, response.body], [200, { ok: true, count: 2 }])
  assert.deepEqual(audits(), [{ operation: 'bulk_translate_articles', langCode: 'en', count: 2, articleIds: [news, 99_999] }])
  await backgroundDone()
  assert.deepEqual(workerCalls.map(call => call[0]), [news, 99_999])
  // The job inserts the `translating` row itself, outside any transaction (on MySQL the missing
  // article's row fails its foreign key and is logged; SQLite has no foreign keys here).
  assert.deepEqual(translations(), [[news, 'en', 'translating'], [99_999, 'en', 'translating']])
})

test('FINDING-R7-5 (reported, not changed): a fractional id passes the `> 0` filter, matches no row in the type check and reaches the job', async () => {
  const documentId = await article('document')
  assert.equal(documentId, 1)
  const plain = await bulk({ ids: [documentId], langCode: 'en' })
  assert.deepEqual(plain.status, 403)
  const fractional = await bulk({ ids: [documentId + 0.5], langCode: 'en' })
  // 200 for the same caller: `id = 1.5` finds nothing to check. The job then inserts a row with
  // article_id 1.5 — stored as 1.5 here; MySQL rounds it to 2 (the replay script).
  assert.deepEqual([fractional.status, fractional.body], [200, { ok: true, count: 1 }])
  await backgroundDone()
  assert.deepEqual(workerCalls.map(call => call[0]), [1.5])
  assert.deepEqual(translations(), [[1.5, 'en', 'translating']])
})

test('bulk-translate: no ids or no language is a 400 before anything is written', async () => {
  for (const body of [{ ids: [], langCode: 'en' }, { ids: [1] }, {}, { ids: ['1', null], langCode: 'en' }]) {
    assert.equal((await bulk(body)).status, 400, JSON.stringify(body))
  }
  await backgroundDone()
  assert.deepEqual([audits(), workerCalls], [[], []])
})
