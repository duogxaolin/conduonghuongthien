import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `GET /api/public/articles/:slug/related` (server/api/public/articles/[slug]/related.get.ts) —
 * what is read next, under an article. Run as the real handler: real h3 app, Drizzle's own MySQL
 * statements (joins, `COALESCE(NULLIF(…))`, `GROUP BY`) executed on SQLite
 * (tests/_sqlite-mysql-db.ts).
 *
 * Invariants, each seeded so that dropping its clause changes the answer:
 *   - a related article is `published` (three separate clauses: the anchor lookup, the article
 *     list and the per-topic count — a draft anchor must not leak its neighbours, a draft must not
 *     be listed, and a draft must not inflate the number on a topic chip);
 *   - it is never the article being read, and it has the same `type` (a role-model story under a
 *     news item's "related" label would link to the wrong route prefix);
 *   - an unknown slug is a 200 with empty lists — this is a side block of a page that handles
 *     its own 404; a thrown error would turn a readable article into an error page;
 *   - a failed query is a 503 `ok: false`, distinguishable from "nothing related".
 *
 * Before this file these were `/eq\(articles\.status, 'published'\)/` counts and similar patterns
 * over the handler's source in `tests/article-related-content.test.ts`; the pure roll-up
 * (`rollUpRelatedTopics`) and the page template are still tested there.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { articles, categories, articleTranslations } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([articles, categories, articleTranslations])

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const handler = (await import('../server/api/public/articles/[slug]/related.get')).default
const server = await startHandlerServer([{ method: 'get', path: '/api/public/articles/:slug/related', handler }])
after(() => server.close())

type RelatedBody = {
  ok: boolean
  articles: Array<Record<string, unknown>>
  topics: Array<{ name: string, slug: string, total: number, isCurrent: boolean }>
}
const related = async (slug: string, query = '') => {
  const response = await server.request('GET', `/api/public/articles/${slug}/related${query}`)
  return { ...response, body: response.body as unknown as RelatedBody }
}
const slugs = (body: RelatedBody) => body.articles.map(item => item.slug)

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 3))
type Seed = typeof articles.$inferInsert
const article = (id: number, slug: string, over: Partial<Seed> = {}): Seed => ({
  id, slug, title: `Bài ${slug}`, type: 'news', status: 'published', categoryId: 1, content: `<p>Thân ${slug}</p>`, publishedAt: day(id), createdAt: day(id), ...over,
})

beforeEach(async () => {
  harness.reset()
  await harness.db.insert(categories).values([
    { id: 1, name: 'Tin A', slug: 'tin-a', type: 'news' },
    { id: 2, name: 'Tin B', slug: 'tin-b', type: 'news' },
    { id: 3, name: 'Gương', slug: 'guong', type: 'role_model' },
  ])
  await harness.db.insert(articles).values([
    article(1, 'bai-chinh'),
    article(2, 'cung-muc'),
    article(3, 'khac-muc', { categoryId: 2 }),
    article(4, 'nhap-cung-loai', { status: 'draft' }),
    article(5, 'luu-tru', { status: 'archived', categoryId: 2 }),
    article(6, 'guong-mot', { type: 'role_model', categoryId: 3 }),
    article(7, 'bai-nhap', { status: 'draft' }),
    article(8, 'guong-hai', { type: 'role_model', categoryId: 3 }),
    article(9, 'nhap-khac-muc', { status: 'draft', categoryId: 2 }),
  ])
})

test('related articles: published only, same type, never the article itself — same category first', async () => {
  const { status, body } = await related('bai-chinh')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(slugs(body), ['cung-muc', 'khac-muc'], 'drafts (4, 9), archived (5), other types (6, 8) and the article itself (1) are out')
  for (const item of body.articles) {
    assert.deepEqual(Object.keys(item).sort(), ['categoryName', 'categorySlug', 'createdAt', 'excerpt', 'id', 'publishedAt', 'slug', 'thumbnailUrl', 'title'])
  }
})

test('the same-type rule holds for the other type as well: a role-model story gets role-model neighbours', async () => {
  const { body } = await related('guong-mot')
  assert.deepEqual(slugs(body), ['guong-hai'])
  assert.deepEqual(body.topics, [{ name: 'Gương', slug: 'guong', total: 2, isCurrent: true }])
})

test('a topic chip counts published articles only: drafts and archived ones do not inflate it', async () => {
  const { body } = await related('bai-chinh')
  // Tin A: published 1 + 2; draft 4 and 7 would make it 4. Tin B: published 3; archived 5 and draft 9 would make it 3 + 2.
  assert.deepEqual(body.topics, [
    { name: 'Tin A', slug: 'tin-a', total: 2, isCurrent: true },
    { name: 'Tin B', slug: 'tin-b', total: 1, isCurrent: false },
  ])
  assert.ok(!body.topics.some(topic => topic.slug === 'guong'), 'a topic of another type is not offered')
})

test('a draft or archived article is not an anchor: it reveals no neighbours and no topics', async () => {
  for (const slug of ['bai-nhap', 'luu-tru', 'nhap-cung-loai']) {
    const { status, body } = await related(slug)
    assert.equal(status, 200, slug)
    assert.deepEqual(body, { ok: true, articles: [], topics: [] }, slug)
  }
})

test('an unknown or odd slug is an empty answer, never an error', async () => {
  for (const slug of ['khong-co-bai-nay', '%20', '..%2Fetc', encodeURIComponent('bài-có-dấu')]) {
    const { status, body } = await related(slug)
    assert.equal(status, 200, slug)
    assert.deepEqual(body, { ok: true, articles: [], topics: [] }, slug)
  }
})

test('?lang=en serves the translated title where a usable translation exists, and the same set of articles', async () => {
  await harness.db.insert(articleTranslations).values([
    { articleId: 2, langCode: 'en', title: 'Same category EN', excerpt: 'EN excerpt', status: 'published' },
    { articleId: 3, langCode: 'en', title: 'Half done EN', status: 'translating' },
    { articleId: 4, langCode: 'en', title: 'Draft article EN', status: 'published' },
  ])
  const { body } = await related('bai-chinh', '?lang=en')
  assert.deepEqual(slugs(body), ['cung-muc', 'khac-muc'], 'a translation does not widen the set: the draft stays out')
  assert.deepEqual(body.articles.map(item => item.title), ['Same category EN', 'Bài khac-muc'], 'an unfinished translation falls back to the original title')
})

test('a failed query is a 503 ok:false, not an empty "nothing related"', async () => {
  harness.failNext(/from `articles`/)
  const anchor = await related('bai-chinh')
  assert.equal(anchor.status, 503)
  assert.deepEqual(anchor.body, { ok: false, articles: [], topics: [] })
  assert.match(anchor.headers.get('cache-control') ?? '', /no-store/)

  harness.failNext(/^select `id`, `name`, `slug`, `parent_id`/)
  const topics = await related('bai-chinh')
  assert.equal(topics.status, 503, 'a failure after the anchor must not return a half answer')
  assert.equal(topics.body.ok, false)

  const nothing = await related('khong-co-bai-nay')
  assert.equal(nothing.status, 200)
  assert.equal(nothing.body.ok, true, '"nothing related" and "broken" must not look alike')
})
