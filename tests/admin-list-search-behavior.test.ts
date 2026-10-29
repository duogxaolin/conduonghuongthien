import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test, { after, beforeEach } from 'node:test'

/**
 * The admin lists' search box and paging (slice R7, task item 3):
 *   GET /api/admin/articles                 (articles/index.get.ts)
 *   GET /api/admin/articles/export-csv      (export-csv.get.ts — "theo filter hiện tại")
 *   GET /api/admin/media                    (media/index.get.ts)
 *   GET /api/admin/categories/:id/articles  (categories/[id]/articles.get.ts — paging only)
 *   GET /api/admin/chatbot/knowledge        (services/chatbot-knowledge.ts `listKnowledge`)
 *   GET /api/admin/chatbot/small-talk       (services/chatbot-small-talk.ts `listSmallTalk`)
 *
 * The invariants:
 *   - the search is for the text as typed: `_` and `%` match themselves, not "any character" /
 *     "anything" — before, `ban_hanh` also found `banXhanh` and `%` found every row
 *     (FINDING-R7-7, the R6-8 rule; `likeContains` from `server/utils/like-pattern.ts`, as the
 *     readers and media-portal lists). An ordinary search finds what it found before;
 *   - `perPage` goes through `finitePositive` before the floor of 10 — `?perPage=abc` was NaN past
 *     both clamps (LIMIT NaN: a 500 on MySQL, `perPage: null` in the JSON) and `12.5` a LIMIT MySQL
 *     refuses (FINDING-R7-8, the CLAUDE.md "query string số" rule);
 *   - rows that share `created_at` (an import, a bulk upload) come newest id first, so two pages
 *     never share or skip one (FINDING-R7-9, as R6-9) — the CSV export keeps the list's order.
 *
 * SQL on SQLite (`_ai-route-harness.ts`; LIKE escapes with `\` as MySQL's default). Two things
 * only MySQL shows, so not measured here: accent- and case-insensitive matching of the `_ci`
 * collations (every "unchanged search" below is exact-case), and the MySQL-only
 * `GROUP_CONCAT(DISTINCT CONCAT(…) SEPARATOR ',')` of the articles list's `translatedLangs` — this
 * suite rewrites that one expression to its SQLite twin (`a || ':' || b`, SQLite's default
 * separator is the same comma) and fails if it stops finding it; the list's real SQL runs on
 * MySQL 8 in `mysql-admin-search.sh` (proof directory).
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.articles, s.categories, s.articleTranslations, s.media, s.chatbotKnowledge, s.chatbotKnowledgeTerms, s.chatbotSmallTalk, s.activityLogs],
  routes: async load => [
    { method: 'get', path: '/api/admin/articles', handler: await load('../server/api/admin/articles/index.get') },
    { method: 'get', path: '/api/admin/articles/export-csv', handler: await load('../server/api/admin/articles/export-csv.get') },
    { method: 'get', path: '/api/admin/media', handler: await load('../server/api/admin/media/index.get') },
    { method: 'get', path: '/api/admin/categories/:id/articles', handler: await load('../server/api/admin/categories/[id]/articles.get') },
    { method: 'get', path: '/api/admin/chatbot/knowledge', handler: await load('../server/api/admin/chatbot/knowledge/index.get') },
    { method: 'get', path: '/api/admin/chatbot/small-talk', handler: await load('../server/api/admin/chatbot/small-talk/index.get') },
  ],
})
after(() => h.server.close())
const { articles, categories, articleTranslations, media, chatbotKnowledge, chatbotKnowledgeTerms, chatbotSmallTalk } = h.schema

const MYSQL_LANGS = /GROUP_CONCAT\(DISTINCT CONCAT\(`t`\.`lang_code`, ':', `t`\.`status`\) SEPARATOR ','\)/
let rewritten = 0
const prepare = h.harness.sqlite.prepare.bind(h.harness.sqlite)
h.harness.sqlite.prepare = ((sql: string) => {
  if (MYSQL_LANGS.test(sql)) rewritten += 1
  return prepare(sql.replace(MYSQL_LANGS, "GROUP_CONCAT(DISTINCT `t`.`lang_code` || ':' || `t`.`status`)"))
}) as typeof h.harness.sqlite.prepare

type Account = Awaited<ReturnType<typeof h.account>>
let officer: Account
beforeEach(async () => {
  h.reset()
  officer = await h.account([
    { resource: 'news', canRead: true }, { resource: 'media', canRead: true },
    { resource: 'categories', canRead: true }, { resource: 'chatbot_knowledge', canRead: true },
  ], 'canbo')
})

const get = (path: string) => h.request('GET', path, officer)
const SAME_SECOND = new Date('2026-10-20T03:00:00Z')
async function articlesTitled(titles: string[], fields: Partial<typeof articles.$inferInsert> = {}) {
  for (const [index, title] of titles.entries()) {
    await h.harness.db.insert(articles).values({ type: 'news', title, slug: `bai-${index}-${Math.random()}`, status: 'published', createdAt: SAME_SECOND, ...fields })
  }
}
const titles = (body: Record<string, unknown>) => (body.items as Array<{ title: string }>).map(item => item.title)
const ids = (body: Record<string, unknown>) => (body.items as Array<{ id: number }>).map(item => item.id)
const csvTitles = (text: unknown) => String(text).split('\r\n').slice(1).map(line => line.split(',')[1])

// ─── Search: the text as typed ───────────────────────────────────────────────

test('FINDING-R7-7: articles list and its CSV export search the title as typed — `_` and `%` are literal; an ordinary search is unchanged', async () => {
  await articlesTitled(['Kế hoạch 50% năm', 'Kế hoạch 501 năm', 'ban_hanh quyết định', 'banXhanh khác', 'Tin thường'])
  const cases: Array<[string, string[]]> = [
    ['50%', ['Kế hoạch 50% năm']],
    ['ban_hanh', ['ban_hanh quyết định']],
    ['%', ['Kế hoạch 50% năm']],
    ['_', ['ban_hanh quyết định']],
    ['Kế hoạch', ['Kế hoạch 50% năm', 'Kế hoạch 501 năm']],
  ]
  for (const [search, expected] of cases) {
    const list = await get(`/api/admin/articles?search=${encodeURIComponent(search)}`)
    assert.equal(list.status, 200, search)
    assert.deepEqual([...titles(list.body)].sort(), [...expected].sort(), `list ${search}`)
    assert.equal(list.body.pagination && (list.body.pagination as { total: number }).total, expected.length, `count ${search}`)
    const csv = await get(`/api/admin/articles/export-csv?search=${encodeURIComponent(search)}`)
    assert.deepEqual([...csvTitles(csv.body.text)].sort(), [...expected].sort(), `csv ${search}`)
  }
  assert.ok(rewritten > 0, 'the MySQL-only translatedLangs expression is still the one this suite rewrites')
})

test('FINDING-R7-7: the media library searches the file name as typed', async () => {
  for (const originalName of ['anh_1.png', 'anhX1.png', 'bao-cao 100%.pdf', 'bao-cao 1000.pdf']) {
    await h.harness.db.insert(media).values({ filename: originalName, originalName, mimeType: 'image/png', sizeBytes: 1, url: `/u/${originalName}`, storagePath: 'x' })
  }
  for (const [search, expected] of [['anh_1', ['anh_1.png']], ['100%', ['bao-cao 100%.pdf']], ['bao-cao', ['bao-cao 100%.pdf', 'bao-cao 1000.pdf']]] as const) {
    const response = await get(`/api/admin/media?search=${encodeURIComponent(search)}`)
    assert.deepEqual((response.body.items as Array<{ originalName: string }>).map(item => item.originalName).sort(), [...expected].sort(), search)
  }
})

test('FINDING-R7-7: the chatbot knowledge and small-talk lists search question, answer, topic and terms as typed', async () => {
  const entry = async (canonicalQuestion: string, terms: string[] = []) => {
    const [row] = await h.harness.db.insert(chatbotKnowledge).values({ canonicalQuestion, normalizedQuestion: canonicalQuestion, approvedAnswer: 'Trả lời', topic: 'chung' })
    for (const value of terms) await h.harness.db.insert(chatbotKnowledgeTerms).values({ knowledgeId: Number(row.insertId), kind: 'alias', value, normalizedValue: value })
  }
  await entry('Mẫu mau_01 là gì?')
  await entry('Mẫu mauX01 là gì?')
  await entry('Câu khác', ['bi danh 100%'])
  await entry('Câu nữa', ['bi danh 1000'])
  const knowledge = async (search: string) => ((await get(`/api/admin/chatbot/knowledge?search=${encodeURIComponent(search)}`)).body.items as Array<{ canonicalQuestion: string }>).map(item => item.canonicalQuestion).sort()
  assert.deepEqual(await knowledge('mau_01'), ['Mẫu mau_01 là gì?'])
  assert.deepEqual(await knowledge('100%'), ['Câu khác'], 'through an alias term')
  assert.deepEqual(await knowledge('Mẫu'), ['Mẫu mauX01 là gì?', 'Mẫu mau_01 là gì?'])

  for (const question of ['xin_chao bạn', 'xinXchao bạn']) {
    await h.harness.db.insert(chatbotSmallTalk).values({ category: 'greeting', question, normalizedQuestion: question, answer: 'Chào bạn' })
  }
  const smallTalk = async (search: string) => ((await get(`/api/admin/chatbot/small-talk?search=${encodeURIComponent(search)}`)).body.items as Array<{ question: string }>).map(item => item.question).sort()
  assert.deepEqual(await smallTalk('xin_chao'), ['xin_chao bạn'])
  assert.deepEqual(await smallTalk('bạn'), ['xinXchao bạn', 'xin_chao bạn'])
})

// ─── Paging ──────────────────────────────────────────────────────────────────

test('FINDING-R7-8: perPage is a whole number in [10, 100] — not a number falls back, a fraction is floored', async () => {
  const [category] = await h.harness.db.insert(categories).values({ name: 'Tin', slug: 'tin', type: 'news' })
  const categoryId = Number(category.insertId)
  await articlesTitled(Array.from({ length: 25 }, (_, n) => `Bài ${n}`), { categoryId })
  for (let n = 0; n < 35; n++) await h.harness.db.insert(media).values({ filename: `f${n}`, originalName: `f${n}`, mimeType: 'image/png', sizeBytes: 1, url: `/u/${n}`, storagePath: 'x' })
  const cases: Array<[string, number, number]> = [['abc', 20, 30], ['12.5', 12, 12], ['0', 10, 10], ['3', 10, 10], ['500', 100, 100], ['', 20, 30]]
  for (const [raw, articleDefault, mediaDefault] of cases) {
    for (const [path, expected] of [[`/api/admin/articles?perPage=${raw}`, articleDefault], [`/api/admin/categories/${categoryId}/articles?perPage=${raw}`, articleDefault], [`/api/admin/media?perPage=${raw}`, mediaDefault]] as const) {
      const response = await get(path)
      // Before: `abc` gave LIMIT NaN — `perPage: null` here, a 500 on MySQL — and 12.5 a LIMIT MySQL refuses.
      assert.equal(response.status, 200, path)
      const { perPage, totalPages } = response.body.pagination as { perPage: number, totalPages: number }
      assert.equal(perPage, expected, path)
      assert.ok(Number.isInteger(totalPages), path)
      assert.equal((response.body.items as unknown[]).length, Math.min(expected, path.includes('media') ? 35 : 25), path)
    }
  }
})

test('FINDING-R7-9: rows sharing created_at come newest id first — two pages never share or skip one; the CSV keeps that order', async () => {
  const [category] = await h.harness.db.insert(categories).values({ name: 'Tin', slug: 'tin', type: 'news' })
  const categoryId = Number(category.insertId)
  await articlesTitled(Array.from({ length: 12 }, (_, n) => `Bài ${n + 1}`), { categoryId })
  const all = h.harness.rows(articles).map(row => Number(row.id)).sort((a, b) => b - a)
  for (const base of ['/api/admin/articles?', `/api/admin/categories/${categoryId}/articles?`]) {
    const first = ids((await get(`${base}perPage=10&page=1`)).body)
    const second = ids((await get(`${base}perPage=10&page=2`)).body)
    assert.deepEqual([...first, ...second], all, base)
  }
  assert.deepEqual(csvTitles((await get('/api/admin/articles/export-csv')).body.text), all.map(id => `Bài ${id}`))

  for (let n = 0; n < 12; n++) await h.harness.db.insert(media).values({ filename: `f${n}`, originalName: `f${n}`, mimeType: 'image/png', sizeBytes: 1, url: `/u/${n}`, storagePath: 'x', createdAt: SAME_SECOND })
  const mediaIds = h.harness.rows(media).map(row => Number(row.id)).sort((a, b) => b - a)
  const pages = [...ids((await get('/api/admin/media?perPage=10&page=1')).body), ...ids((await get('/api/admin/media?perPage=10&page=2')).body)]
  assert.deepEqual(pages, mediaIds)
})

test('translatedLangs still lists each language once with its status (the expression rewritten for SQLite)', async () => {
  await articlesTitled(['Một'])
  const [row] = h.harness.rows(articles)
  await h.harness.db.insert(articleTranslations).values([{ articleId: Number(row!.id), langCode: 'en', status: 'published' }, { articleId: Number(row!.id), langCode: 'zh', status: 'ai_draft' }])
  const response = await get('/api/admin/articles')
  assert.deepEqual(String((response.body.items as Array<{ translatedLangs: string }>)[0]!.translatedLangs).split(',').sort(), ['en:published', 'zh:ai_draft'])
})

// ─── Guard ───────────────────────────────────────────────────────────────────

// One shape only: a "contains" pattern built as `%${…}%` inside `like(`. Prefix templates of
// normalised slugs (`utils/slug.ts`) and the media module's constant / `sql` patterns are other
// shapes this does not see — the census of every `like(` is in the R7 section of
// docs/test-coverage-baseline-2026-10.md.
test('FINDING-R7-7 guard: no like(column, `%${…}%`) — a "contains" pattern from a raw template — remains under server/', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (path.endsWith('.ts') && /\blike\([^)]*`%\$\{/.test(readFileSync(path, 'utf8'))) offenders.push(path)
    }
  }
  walk(new URL('../server', import.meta.url).pathname)
  assert.deepEqual(offenders, [])
})
