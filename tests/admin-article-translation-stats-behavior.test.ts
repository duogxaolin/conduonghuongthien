import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * `GET /api/admin/articles/translation-stats` (translation-stats.get.ts) — the figures of
 * the "Dịch toàn bộ" dialog (`ArticleGlobalTranslateModal.vue`):
 *   - `totalArticles`: PUBLISHED articles only — a draft is not something the portal shows
 *     in another language yet;
 *   - `languages`: every ACTIVE language except `vi` (the source), each with the published
 *     articles that have a translation that did not fail, and `missing` = the rest, never
 *     below zero;
 *   - `aiPendingTranslations`: AI translations still waiting for review (`ai_draft` /
 *     `reviewed`), of any article — the badge on "Xuất bản toàn bộ"; translating/failed
 *     and hand-written translations are not counted;
 *   - the route is `news:read`.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`).
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.articles, s.languages, s.articleTranslations],
  routes: async load => [
    { method: 'get', path: '/api/admin/articles/translation-stats', handler: await load('../server/api/admin/articles/translation-stats.get') },
  ],
})
after(() => h.server.close())
const { articles, languages, articleTranslations } = h.schema

type Account = Awaited<ReturnType<typeof h.account>>
let newsReader: Account
beforeEach(async () => {
  h.reset()
  newsReader = await h.account([{ resource: 'news', canRead: true }], 'doc')
})

let seq = 0
async function article(status: string) {
  seq += 1
  const [row] = await h.harness.db.insert(articles).values({ type: 'news', title: `Bài ${seq}`, slug: `bai-${seq}`, status })
  return Number(row.insertId)
}
async function translation(articleId: number, langCode: string, status: string, translatedBy = 'ai') {
  await h.harness.db.insert(articleTranslations).values({ articleId, langCode, status, translatedBy, title: 'T', content: '<p>x</p>' })
}

test('counts published articles, translated and missing per active non-vi language, and AI drafts awaiting review', async () => {
  await h.harness.db.insert(languages).values([
    { code: 'vi', name: 'Tiếng Việt', nativeName: 'Tiếng Việt', isActive: true },
    { code: 'en', name: 'Tiếng Anh', nativeName: 'English', isActive: true },
    { code: 'zh', name: 'Tiếng Trung', nativeName: '中文', isActive: true },
    { code: 'fr', name: 'Tiếng Pháp', nativeName: 'Français', isActive: false },
  ])
  const a = await article('published')
  const b = await article('published')
  const c = await article('published')
  const draft = await article('draft')
  await translation(a, 'en', 'published', 'human')
  await translation(b, 'en', 'ai_draft')
  await translation(c, 'en', 'failed')
  await translation(a, 'zh', 'reviewed')
  await translation(b, 'zh', 'translating')
  await translation(draft, 'en', 'ai_draft') // not published: not "translated", still awaiting review
  await translation(a, 'fr', 'published') // inactive language: never listed

  const response = await h.request('GET', '/api/admin/articles/translation-stats', newsReader)
  assert.equal(response.status, 200)
  const body = response.body as Record<string, unknown>
  assert.equal(body.ok, true)
  assert.equal(body.totalArticles, 3)
  const listed = (body.languages as Array<Record<string, unknown>>).map(l => ({ ...l })).sort((x, y) => String(x.code).localeCompare(String(y.code)))
  assert.deepEqual(listed, [
    { code: 'en', name: 'Tiếng Anh', nativeName: 'English', translated: 2, missing: 1 },
    { code: 'zh', name: 'Tiếng Trung', nativeName: '中文', translated: 2, missing: 1 },
  ])
  assert.equal(body.aiPendingTranslations, 3, 'ai_draft (b/en, draft/en) + reviewed (a/zh); human, translating and failed are not pending')
})

test('an empty portal answers zeros, and missing never goes below zero', async () => {
  let response = await h.request('GET', '/api/admin/articles/translation-stats', newsReader)
  assert.deepEqual(response.body, { ok: true, totalArticles: 0, languages: [], aiPendingTranslations: 0 })

  await h.harness.db.insert(languages).values({ code: 'en', name: 'Tiếng Anh', nativeName: 'English', isActive: true })
  const a = await article('published')
  // Two rows for one language of one article (no unique key in this harness): counted as rows.
  await translation(a, 'en', 'published', 'human')
  await translation(a, 'en', 'published', 'human')
  response = await h.request('GET', '/api/admin/articles/translation-stats', newsReader)
  const body = response.body as Record<string, unknown>
  assert.deepEqual(body.languages, [{ code: 'en', name: 'Tiếng Anh', nativeName: 'English', translated: 2, missing: 0 }])
})

test('the route is news:read', async () => {
  const media = await h.account([{ resource: 'media', canRead: true }], 'khac')
  assert.equal((await h.request('GET', '/api/admin/articles/translation-stats', media)).status, 403)
  assert.equal((await h.request('GET', '/api/admin/articles/translation-stats', null)).status, 401)
})
