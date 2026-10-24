/**
 * "Đọc nhiều" — `GET /api/public/articles?sort=views` (spec `most-read-ranking`,
 * design D6).
 *
 * The ranking used to sum `article_view_daily` in a correlated subquery for every
 * published article of the type, then run a second `COUNT(*)` for a pagination
 * block nobody reads. It now orders by the maintained per-article total
 * (`articles.view_total` = real + fabricated, a plain column the write path keeps
 * in the same statement as each half — see tests/view-totals-integrity.test.ts)
 * and skips the count.
 *
 * The handler is run for real. Its queries are built by Drizzle, compiled with
 * the MySQL dialect (`drizzle.mock()`), and executed against an in-memory SQLite
 * holding the three columns exactly as the write path leaves them. There is no
 * `article_view_daily` table at all: a query that still aggregates daily rows
 * fails with "no such table" instead of passing quietly.
 *
 * `type=reintegration` stands for two stored types (`reintegration`,
 * `reintegration_model`). `type IN (…)` cannot be read in order from
 * `articles_status_type_views_idx` — MySQL falls back to a sort — so the ranking
 * reads each type in index order (`type = ?`, LIMIT offset + limit) and merges;
 * the query-shape test below pins that.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, getTableName, type Table } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'

const { articles, users, categories } = await import('../server/db/schema')

const sqlite = new DatabaseSync(':memory:')
const compiler = drizzle.mock()

function createTable(table: Table) {
  const columns = Object.values(getTableColumns(table)).map(column => `\`${column.name}\``)
  sqlite.exec(`CREATE TABLE \`${getTableName(table)}\` (${columns.join(', ')})`)
}
createTable(articles)
createTable(users)
createTable(categories)

const insertArticle = sqlite.prepare(
  'INSERT INTO `articles` (`id`, `type`, `title`, `slug`, `excerpt`, `status`, `published_at`, `created_at`, `view_total_real`, `view_total_fabricated`, `view_total`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
)
// id, type, status, published, real, fabricated — `view_total` is written as the
// write path leaves it: real + fabricated.
const FIXTURE: Array<[number, string, string, string, number, number]> = [
  [1, 'news', 'published', '2026-01-10 08:00:00', 10, 5], // A: 15
  [2, 'news', 'published', '2026-06-01 08:00:00', 12, 0], // B: 12 — newer, fewer views
  [3, 'news', 'published', '2026-03-01 08:00:00', 15, 0], // C: 15 — ties A, published later
  [4, 'news', 'draft', '2026-05-01 08:00:00', 900, 0],    // never listed
  [5, 'role_model', 'published', '2026-05-01 08:00:00', 500, 0], // other type
  [6, 'news', 'published', '2026-07-01 08:00:00', 0, 0],  // D: no views yet
  // `type=reintegration` covers both stored spellings.
  [11, 'reintegration', 'published', '2026-02-01 08:00:00', 20, 0],       // R1: 20
  [12, 'reintegration_model', 'published', '2026-01-01 08:00:00', 20, 5], // R2: 25, older
  [13, 'reintegration', 'published', '2026-03-01 08:00:00', 25, 0],       // R3: 25, newer → before R2
  [14, 'reintegration_model', 'published', '2026-04-01 08:00:00', 3, 2],  // R4: 5
  [15, 'reintegration_model', 'draft', '2026-04-01 08:00:00', 999, 0],    // never listed
]
for (const [id, type, status, publishedAt, real, fabricated] of FIXTURE) {
  insertArticle.run(id, type, `Bài ${id}`, `bai-${id}`, `Sapo ${id}`, status, publishedAt, publishedAt, real, fabricated, real + fabricated)
}

const executed: string[] = []

/**
 * `select(projection).from(table)` returns Drizzle's real builder (it mutates in
 * place, so `itemsQuery.leftJoin(...)` keeps working); awaiting it compiles the
 * query with the MySQL dialect and runs it on SQLite. Rows come back as arrays
 * and are mapped onto the projection's keys in order — Drizzle emits the select
 * list in that order, and named rows would collide on `slug`/`name`.
 */
function select(projection: Record<string, unknown>) {
  const builder = compiler.select(projection as never)
  return {
    from(table: Table) {
      const query = builder.from(table as never)
      Object.defineProperty(query, 'then', {
        configurable: true,
        value(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          try {
            const { sql, params } = query.toSQL()
            executed.push(sql)
            const statement = sqlite.prepare(sql)
            statement.setReturnArrays(true)
            const keys = Object.keys(projection)
            const rows = (statement.all(...params as never[]) as unknown as unknown[][])
              .map(row => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? null])))
            return Promise.resolve(rows).then(resolve, reject)
          } catch (error) {
            return Promise.reject(error).then(resolve, reject)
          }
        },
      })
      return query
    },
  }
}

mock.module('../server/utils/db', { namedExports: { getDb: () => ({ select }) } })
// A failing query must fail the test, not turn into a quiet `{ ok: false }`.
mock.module('../server/utils/public-read-failure', {
  namedExports: { reportPublicReadFailure: (_event: unknown, _name: string, error: unknown) => { throw error } },
})

type Event = { query: Record<string, string> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getQuery = (event: Event) => event.query
globals.getCookie = () => undefined

type ListItem = Record<string, unknown> & { id: number }
type ListResponse = { ok: boolean, articles: ListItem[], pagination: { page: number, limit: number, total: number, totalPages: number } }
const list = (await import('../server/api/public/articles.get')).default as unknown as (event: Event) => Promise<ListResponse>

test('sort=views ranks by real + fabricated, newest first on a tie — A (10 + 5) before B (12 + 0)', async () => {
  executed.length = 0
  const response = await list({ query: { type: 'news', sort: 'views', limit: '6' } })

  assert.equal(response.ok, true)
  assert.deepEqual(response.articles.map(article => article.id), [3, 1, 2, 6])
  assert.deepEqual(response.articles.map(article => Number(article.viewTotal)), [15, 15, 12, 0])
})

test('sort=views is one indexed read: no daily-row aggregate and no COUNT', async () => {
  executed.length = 0
  await list({ query: { type: 'news', sort: 'views', limit: '6' } })

  assert.equal(executed.length, 1, `expected the ranking query only, got:\n${executed.join('\n')}`)
  const [ranking] = executed
  assert.doesNotMatch(ranking!, /article_view_daily/)
  assert.doesNotMatch(ranking!, /\bcount\(/i)
  assert.match(ranking!, /order by `articles`\.`view_total` desc, `articles`\.`published_at` desc, `articles`\.`created_at` desc/)
})

test('sort=views exposes the combined total only — never the real/fabricated split', async () => {
  const response = await list({ query: { type: 'news', sort: 'views', limit: '6' } })
  for (const article of response.articles) {
    assert.deepEqual(
      Object.keys(article).filter(key => /real|fabricated/i.test(key)),
      [],
      'the public list must not reveal how much of a total was fabricated',
    )
  }
})

test('sort=views pagination: no COUNT, so total counts the rows up to this page (a lower bound)', async () => {
  const first = await list({ query: { type: 'news', sort: 'views', limit: '2' } })
  assert.deepEqual(first.articles.map(article => article.id), [3, 1])
  assert.deepEqual(first.pagination, { page: 1, limit: 2, total: 2, totalPages: 1 })

  const last = await list({ query: { type: 'news', sort: 'views', limit: '2', page: '2' } })
  assert.deepEqual(last.articles.map(article => article.id), [2, 6])
  assert.deepEqual(last.pagination, { page: 2, limit: 2, total: 4, totalPages: 2 })
})

test('the ordinary list is unchanged: newest first, exact COUNT, no view column', async () => {
  executed.length = 0
  const response = await list({ query: { type: 'news', limit: '10' } })

  assert.deepEqual(response.articles.map(article => article.id), [6, 2, 3, 1])
  assert.deepEqual(response.pagination, { page: 1, limit: 10, total: 4, totalPages: 1 })
  assert.equal(executed.length, 2, 'list + count')
  assert.doesNotMatch(executed[0]!, /view_total/, 'a plain list pays nothing for a column it does not show')
  for (const article of response.articles) assert.equal('viewTotal' in article, false)
})

test('type=reintegration with sort=views ranks both stored types together, newest first on a tie', async () => {
  const response = await list({ query: { type: 'reintegration', sort: 'views', limit: '6' } })
  assert.deepEqual(response.articles.map(article => article.id), [13, 12, 11, 14])
  assert.deepEqual(response.articles.map(article => Number(article.viewTotal)), [25, 25, 20, 5])
  assert.deepEqual(response.pagination, { page: 1, limit: 6, total: 4, totalPages: 1 })
})

test('type=reintegration with sort=views: one index-ordered read per stored type, never `type IN (…)`', async () => {
  // `IN (…)` on the second column of articles_status_type_views_idx cannot be read
  // in view_total order — MySQL falls back to a filesort over both types. One
  // `type = ?` read per type, each bounded by LIMIT, can (EXPLAIN in
  // docs/decisions/data-layer.md).
  executed.length = 0
  await list({ query: { type: 'reintegration', sort: 'views', limit: '6', page: '2' } })

  assert.equal(executed.length, 2, `expected one read per stored type, got:\n${executed.join('\n')}`)
  for (const statement of executed) {
    assert.match(statement, /`articles`\.`type` = \?/)
    assert.doesNotMatch(statement, /`articles`\.`type` in \(/i)
    assert.match(statement, /order by `articles`\.`view_total` desc, `articles`\.`published_at` desc, `articles`\.`created_at` desc limit \?$/)
    assert.doesNotMatch(statement, /\boffset\b/i, 'each read takes the top offset + limit rows; the page is cut after the merge')
    assert.doesNotMatch(statement, /\bcount\(/i)
  }
})

test('type=reintegration with sort=views pages across the merged ranking', async () => {
  const first = await list({ query: { type: 'reintegration', sort: 'views', limit: '2' } })
  assert.deepEqual(first.articles.map(article => article.id), [13, 12])
  assert.deepEqual(first.pagination, { page: 1, limit: 2, total: 2, totalPages: 1 })

  const second = await list({ query: { type: 'reintegration', sort: 'views', limit: '2', page: '2' } })
  assert.deepEqual(second.articles.map(article => article.id), [11, 14])
  assert.deepEqual(second.pagination, { page: 2, limit: 2, total: 4, totalPages: 2 })

  const beyond = await list({ query: { type: 'reintegration', sort: 'views', limit: '2', page: '3' } })
  assert.deepEqual(beyond.articles, [])
})

test('the ordinary reintegration list still reads both types in one query', async () => {
  executed.length = 0
  const response = await list({ query: { type: 'reintegration', limit: '10' } })
  assert.deepEqual(response.articles.map(article => article.id), [14, 13, 11, 12])
  assert.equal(executed.length, 2, 'list + count')
})
