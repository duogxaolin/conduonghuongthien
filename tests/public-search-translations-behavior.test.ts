import assert from 'node:assert/strict'
import test, { after, before, mock } from 'node:test'

/**
 * Two public reads the other suites only reach on their failure path, run as the real handlers
 * (real h3 app, Drizzle's own MySQL statements executed on SQLite — tests/_sqlite-mysql-db.ts).
 * tests/public-read-failure-behavior.test.ts pins the 503 of a failed search and its empty
 * success (no rows → no page is ever read); tests/search-paging.test.ts the slice arithmetic.
 * This file pins the rows a visitor gets:
 *
 *   - `GET /api/public/search` — published articles, then published Q&A, then pages, concatenated
 *     in that order and paged across the three; the counts of every tab whatever tab is shown;
 *     `%` and `_` are the characters the visitor typed, not wildcards; the `reintegration_model`
 *     tab covers both stored spellings; a draft article or Q&A is never found;
 *   - `GET /api/public/translations/:code` — an active language's dictionary grouped by group;
 *     an unknown or inactive language is an empty dictionary (200), never an error.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { articles, categories, chatbotKnowledge, pages, languages, langTranslations } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([articles, categories, chatbotKnowledge, pages, languages, langTranslations])

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
const search = (await import('../server/api/public/search.get')).default
const translations = (await import('../server/api/public/translations/[code].get')).default
const server = await startHandlerServer([
  { method: 'get', path: '/api/public/search', handler: search },
  { method: 'get', path: '/api/public/translations/:code', handler: translations },
])
after(() => server.close())

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 3))

before(async () => {
  harness.reset()
  await harness.db.insert(categories).values([{ id: 1, name: 'Tin tức', slug: 'tin-tuc', type: 'news' }])
  const article = (id: number, title: string, over: Partial<typeof articles.$inferInsert> = {}) => ({
    id, slug: `bai-${id}`, title, type: 'news', status: 'published', categoryId: 1, authorId: 1, publishedAt: day(id), createdAt: day(id), ...over,
  })
  await harness.db.insert(articles).values([
    article(1, 'Hoàn lương: vay vốn', { excerpt: '<p>Tóm t&#7855;t <b>một</b></p>' }),
    article(2, 'Gương hoàn lương', { type: 'role_model', categoryId: null, thumbnailUrl: '/uploads/a.jpg' }),
    article(3, 'Mô hình hoàn lương A', { type: 'reintegration' }),
    article(4, 'Mô hình hoàn lương B', { type: 'reintegration_model', publishedAt: null }),
    article(5, 'Bản nháp hoàn lương', { status: 'draft' }),
    article(6, 'Không khớp', { excerpt: 'nói về hoàn lương trong tóm tắt' }),
    article(7, 'Giảm 100% học phí'),
    article(8, 'Giảm 1000 học phí'),
    article(9, 'Mẫu a_b'),
    article(10, 'Mẫu axb'),
  ])
  await harness.db.insert(chatbotKnowledge).values([
    { id: 1, canonicalQuestion: 'Hoàn lương là gì?', normalizedQuestion: 'hoan luong la gi', approvedAnswer: '<p>Trả lời &amp; giải thích</p>', topic: 'Pháp luật', status: 'published', publishedAt: day(3) },
    { id: 2, canonicalQuestion: 'Câu khác', normalizedQuestion: 'cau khac', approvedAnswer: 'Có nhắc hoàn lương', topic: null, status: 'published', createdAt: day(4) },
    { id: 3, canonicalQuestion: 'Nháp hoàn lương', normalizedQuestion: 'nhap', approvedAnswer: 'x', status: 'draft' },
  ])
  await harness.db.insert(pages).values([
    { id: 1, slug: 'hoan-luong', title: 'Trang hoàn lương', seoDescription: 'Mô tả trang' },
    { id: 2, slug: 'gioi-thieu', title: 'Giới thiệu hoàn lương', seoDescription: null },
    { id: 3, slug: 'lien-he', title: 'Liên hệ' },
  ])
  await harness.db.insert(languages).values([
    { id: 1, code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', isActive: true, isDefault: true },
    { id: 2, code: 'en', name: 'English', nativeName: 'English', isActive: true },
    { id: 3, code: 'fr', name: 'French', nativeName: 'Français', isActive: false },
  ])
  await harness.db.insert(langTranslations).values([
    { langCode: 'en', group: 'nav', key: 'home', value: 'Home' },
    { langCode: 'en', group: 'nav', key: 'news', value: null },
    { langCode: 'en', group: 'footer', key: 'copy', value: '© Portal' },
    { langCode: 'vi', group: 'nav', key: 'home', value: 'Trang chủ' },
    { langCode: 'fr', group: 'nav', key: 'home', value: 'Accueil' },
  ])
})

type Item = { id: string | number, kind: string, type: string, typeLabel: string, title: string, excerpt: string, url: string, thumbnailUrl: string | null, publishedAt: string | null, categoryName: string | null }
type SearchBody = { ok: boolean, items: Item[], total: number, counts: Record<string, number>, pagination: { page: number, limit: number, total: number, totalPages: number } }
const find = async (query: string) => {
  const response = await server.request('GET', `/api/public/search${query}`)
  assert.equal(response.status, 200)
  return response.body as unknown as SearchBody
}
const ids = (body: SearchBody) => body.items.map(item => item.id)

test('search: articles, then Q&A, then pages; drafts never; counts for every tab', async () => {
  const body = await find('?q=ho%C3%A0n%20l%C6%B0%C6%A1ng')
  assert.equal(body.ok, true)
  assert.deepEqual(ids(body), [6, 3, 2, 1, 4, 'qa-2', 'qa-1', 'page-1', 'page-2'], 'articles newest published first (none last, as on MySQL), Q&A newest id first, pages by id')
  assert.equal(body.total, 9)
  assert.deepEqual(body.counts, { all: 9, news: 2, role_model: 1, reintegration_model: 2, document: 0, faq: 0, qa: 2, page: 2 })
  assert.deepEqual(body.pagination, { page: 1, limit: 10, total: 9, totalPages: 1 })

  const byId = Object.fromEntries(body.items.map(item => [item.id, item]))
  assert.deepEqual(byId[1], {
    id: 1, kind: 'article', type: 'news', typeLabel: 'Bản tin', typeIcon: 'fa-solid fa-newspaper', typeBadgeClass: 'bg-line text-[#2D5A27]',
    title: 'Hoàn lương: vay vốn', excerpt: 'Tóm tắt  một', url: '/news/bai-1', thumbnailUrl: null, publishedAt: day(1).toISOString(), categoryName: 'Tin tức',
  })
  assert.equal(byId[2]!.url, '/role-models/bai-2')
  assert.equal(byId[2]!.thumbnailUrl, '/uploads/a.jpg')
  assert.equal(byId[2]!.categoryName, null)
  assert.equal(byId[4]!.url, '/reintegration-models/bai-4')
  assert.equal(byId[4]!.publishedAt, day(4).toISOString(), 'no publishedAt → createdAt')
  assert.deepEqual(byId['qa-1'], {
    id: 'qa-1', kind: 'qa', type: 'qa', typeLabel: 'Tài liệu Hỏi – Đáp', typeIcon: 'fa-solid fa-comments', typeBadgeClass: 'bg-[#E8F5E9] text-[#2E7D32]',
    title: 'Hoàn lương là gì?', excerpt: 'Trả lời & giải thích', url: '/qa-documents#qa-1', thumbnailUrl: null, publishedAt: day(3).toISOString(), categoryName: 'Pháp luật',
  })
  assert.equal(byId['qa-2']!.categoryName, 'Hỏi đáp')
  assert.equal(byId['qa-2']!.publishedAt, day(4).toISOString())
  assert.deepEqual(byId['page-1'], {
    id: 'page-1', kind: 'page', type: 'page', typeLabel: 'Trang thông tin', typeIcon: 'fa-solid fa-file-invoice', typeBadgeClass: 'bg-[#F1F5F9] text-[#475569]',
    title: 'Trang hoàn lương', excerpt: 'Mô tả trang', url: '/hoan-luong', thumbnailUrl: null, publishedAt: null, categoryName: null,
  })
  assert.equal(byId['page-2']!.excerpt, 'Trang chuyên mục trên cổng thông tin')
})

test('search: one page reads across the sources in order', async () => {
  const second = await find('?q=ho%C3%A0n%20l%C6%B0%C6%A1ng&limit=4&page=2')
  assert.deepEqual(ids(second), [4, 'qa-2', 'qa-1', 'page-1'])
  assert.deepEqual(second.pagination, { page: 2, limit: 4, total: 9, totalPages: 3 })
  assert.deepEqual(ids(await find('?q=ho%C3%A0n%20l%C6%B0%C6%A1ng&limit=4&page=3')), ['page-2'])
  const past = await find('?q=ho%C3%A0n%20l%C6%B0%C6%A1ng&limit=4&page=9')
  assert.deepEqual(ids(past), [])
  assert.equal(past.total, 9)
})

test('search: a tab filters the rows, never the counts; reintegration covers both spellings', async () => {
  const reintegration = await find('?q=ho%C3%A0n%20l%C6%B0%C6%A1ng&type=reintegration_model')
  assert.deepEqual(ids(reintegration), [3, 4])
  assert.equal(reintegration.total, 2)
  assert.equal(reintegration.counts.all, 9)
  assert.deepEqual(ids(await find('?q=ho%C3%A0n%20l%C6%B0%C6%A1ng&type=news')), [6, 1])
  assert.deepEqual(ids(await find('?q=ho%C3%A0n%20l%C6%B0%C6%A1ng&type=qa')), ['qa-2', 'qa-1'])
  assert.deepEqual(ids(await find('?q=ho%C3%A0n%20l%C6%B0%C6%A1ng&type=page')), ['page-1', 'page-2'])
})

test('search: % and _ are the characters the visitor typed', async () => {
  assert.deepEqual(ids(await find('?q=100%25')), [7])
  assert.deepEqual(ids(await find('?q=a_b')), [9])
  assert.deepEqual(ids(await find('?search=a_b')), [9], '`search` is accepted as well as `q`')
})

type TranslationsBody = { ok: boolean, translations: Record<string, Record<string, string>> }
const dictionary = async (code: string) => {
  const response = await server.request('GET', `/api/public/translations/${code}`)
  assert.equal(response.status, 200)
  return response.body as unknown as TranslationsBody
}

test('translations: an active language\'s dictionary, grouped; vi is read like any other', async () => {
  assert.deepEqual(await dictionary('en'), { ok: true, translations: { nav: { home: 'Home', news: '' }, footer: { copy: '© Portal' } } })
  assert.deepEqual(await dictionary('vi'), { ok: true, translations: { nav: { home: 'Trang chủ' } } })
})

test('translations: an unknown or inactive language is an empty dictionary, not an error', async () => {
  assert.deepEqual(await dictionary('fr'), { ok: true, translations: {} })
  assert.deepEqual(await dictionary('xx'), { ok: true, translations: {} })
})
