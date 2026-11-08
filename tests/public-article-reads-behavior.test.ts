import assert from 'node:assert/strict'
import test, { after, before, mock } from 'node:test'

/**
 * Branches of the public article reads that the other suites leave alone, run as the real
 * handlers (real h3 app, Drizzle's own MySQL statements executed on SQLite —
 * tests/_sqlite-mysql-db.ts). tests/most-read-ranking.test.ts pins `sort=views` and the
 * statement shapes; tests/html-entities-plain-text.test.ts the decoded fields; this file the
 * filters and the language fallbacks:
 *
 *   - `GET /api/public/articles?categorySlug=` / `?categoryId=` — a root category lists itself
 *     and its children, a child only itself; an unknown one is an empty page (200, totalPages 0)
 *     after one lookup, not an error;
 *   - `?search=` — `%` and `_` are literal characters, not wildcards;
 *   - `?lang=` (or the `cdkt_lang` cookie) — a usable translation's title replaces the
 *     Vietnamese one, an empty one does not, a draft is never used;
 *   - `GET /api/public/articles/:slug?lang=` with no usable translation — the Vietnamese
 *     article, plus the languages it IS published in.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { articles, users, categories, articleTranslations } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([articles, users, categories, articleTranslations])

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
const list = (await import('../server/api/public/articles.get')).default
const detail = (await import('../server/api/public/articles/[slug].get')).default
const server = await startHandlerServer([
  { method: 'get', path: '/api/public/articles', handler: list },
  { method: 'get', path: '/api/public/articles/:slug', handler: detail },
])
after(() => server.close())

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 3))
type Seed = typeof articles.$inferInsert
const article = (id: number, slug: string, over: Partial<Seed> = {}): Seed => ({
  id, slug, title: `Bài ${slug}`, type: 'news', status: 'published', categoryId: 1, authorId: 1, content: `<p>${slug}</p>`, publishedAt: day(id), createdAt: day(id), ...over,
})

before(async () => {
  harness.reset()
  await harness.db.insert(users).values([{ id: 1, username: 'bientap', email: 'bt@example.vn', passwordHash: 'x', roleId: 1 }])
  await harness.db.insert(categories).values([
    { id: 1, name: 'Gốc', slug: 'goc', type: 'news' },
    { id: 2, name: 'Con', slug: 'con', type: 'news', parentId: 1 },
    { id: 3, name: 'Khác', slug: 'khac', type: 'news' },
  ])
  await harness.db.insert(articles).values([
    article(1, 'o-goc'),
    article(2, 'o-con', { categoryId: 2 }),
    article(3, 'o-khac', { categoryId: 3 }),
    article(4, 'nhap-o-goc', { status: 'draft' }),
    article(5, 'phan-tram', { categoryId: 3, title: 'Giảm 100% học phí' }),
    article(6, 'gach-duoi', { categoryId: 3, title: 'Mẫu a_b' }),
    article(7, 'trung-dai-dien', { categoryId: 3, title: 'Giảm 1000 học phí, mẫu axb' }),
  ])
  await harness.db.insert(articleTranslations).values([
    { articleId: 1, langCode: 'en', title: 'Root article', excerpt: 'EN', content: '<p>EN</p>', status: 'published' },
    { articleId: 2, langCode: 'en', title: '', excerpt: 'only an excerpt', status: 'ai_draft' },
    { articleId: 3, langCode: 'en', title: 'Draft EN', status: 'draft' },
    { articleId: 3, langCode: 'fr', title: 'Autre', status: 'published' },
    { articleId: 3, langCode: 'lo', title: 'Lao draft', status: 'ai_draft' },
  ])
})

type ListBody = { ok: boolean, articles: Array<{ slug: string, title: string, excerpt: string | null }>, pagination: { page: number, limit: number, total: number, totalPages: number } }
const get = async (query: string, cookie?: string) => {
  harness.statements.length = 0
  const response = await server.request('GET', `/api/public/articles${query}`, cookie ? { cookie } : {})
  return { status: response.status, body: response.body as unknown as ListBody }
}
const slugs = (body: ListBody) => body.articles.map(item => item.slug)

test('a root category lists itself and its children; a child only itself; drafts never', async () => {
  const root = await get('?categorySlug=goc')
  assert.deepEqual(slugs(root.body), ['o-con', 'o-goc'])
  assert.equal(root.body.pagination.total, 2)
  assert.deepEqual(slugs((await get('?categoryId=1')).body), ['o-con', 'o-goc'], 'by id as by slug')
  assert.deepEqual(slugs((await get('?categorySlug=con')).body), ['o-con'])
  assert.deepEqual(slugs((await get('?categoryId=2')).body), ['o-con'])
})

test('an unknown category is an empty page after one lookup, not an error', async () => {
  const { status, body } = await get('?categorySlug=khong-co&page=3&limit=4')
  assert.equal(status, 200)
  assert.deepEqual(body, { ok: true, articles: [], pagination: { page: 3, limit: 4, total: 0, totalPages: 0 } })
  assert.equal(harness.statements.length, 1, 'no list and no COUNT for a category that does not exist')
})

test('search treats % and _ as the characters a visitor typed', async () => {
  assert.deepEqual(slugs((await get('?search=100%25')).body), ['phan-tram'])
  assert.deepEqual(slugs((await get('?search=a_b')).body), ['gach-duoi'])
  assert.equal((await get('?search=100%25')).body.pagination.total, 1)
})

test('lang: a usable translation replaces the title; an empty title or a draft does not', async () => {
  const { body } = await get('?lang=en&categorySlug=goc')
  const bySlug = Object.fromEntries(body.articles.map(item => [item.slug, item]))
  assert.equal(bySlug['o-goc']!.title, 'Root article')
  assert.equal(bySlug['o-con']!.title, 'Bài o-con', 'an empty translated title falls back to Vietnamese')
  assert.equal(bySlug['o-con']!.excerpt, 'only an excerpt', 'an AI draft is a usable translation')
  const viaCookie = await get('?categorySlug=goc', 'cdkt_lang=EN')
  assert.equal(viaCookie.body.articles.find(item => item.slug === 'o-goc')!.title, 'Root article', 'the cookie picks the language when the query does not')
  const draft = (await get('?lang=en&categoryId=3')).body.articles.find(item => item.slug === 'o-khac')
  assert.equal(draft!.title, 'Bài o-khac', 'a draft translation is never served')
})

test('detail without a usable translation: the Vietnamese article and the published languages', async () => {
  const response = await server.request('GET', '/api/public/articles/o-khac?lang=en')
  assert.equal(response.status, 200)
  const body = response.body as { ok: boolean, article: { title: string }, availableTranslations: string[] }
  assert.equal(body.article.title, 'Bài o-khac')
  assert.deepEqual(body.availableTranslations, ['fr'], 'only PUBLISHED translations are offered — not the draft, not the AI draft')
  const translated = await server.request('GET', '/api/public/articles/o-goc?lang=en')
  assert.equal((translated.body as { article: { title: string, translatedFrom: string } }).article.title, 'Root article')
  assert.equal((translated.body as { article: { translatedFrom: string } }).article.translatedFrom, 'vi')
  assert.equal((await server.request('GET', '/api/public/articles/nhap-o-goc')).status, 404)
})
