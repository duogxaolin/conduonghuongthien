import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, getTableName, type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * The three translation READ routes (`[id]/translations`, `[id]/translations/:lang`,
 * `[id]/translations/:lang/progress`) checked only the fixed `news:read` grant and
 * never the article's own type: an officer allowed to read news could read the
 * translations of a document or role-model article by its id (rà soát 2026-10-22).
 * Every translation WRITE already checked the type in the service.
 *
 * Now each route looks the article up through `requireReadableArticle` — within
 * the types the actor may read — so another type's id answers 404, exactly like a
 * missing id. The bulk-translation status (`bulk-translate-status.get.ts`) named
 * the article being processed, of any type; its title is now shown only to
 * readers of that type. The real WHERE clauses are compiled with the MySQL dialect and run
 * against in-memory SQLite tables, as in `article-id-oracle-behavior.test.ts`.
 */

const { articles, articleTranslations } = await import('../server/db/schema')

const sqlite = new DatabaseSync(':memory:')
const dialect = new MySqlDialect()
for (const table of [articles, articleTranslations]) {
  sqlite.exec(`CREATE TABLE ${getTableName(table)} (${Object.values(getTableColumns(table)).map(c => `\`${c.name}\``).join(', ')})`)
}
const addArticle = sqlite.prepare('INSERT INTO articles (`id`, `type`, `title`, `status`) VALUES (?, ?, ?, ?)')
addArticle.run(31, 'news', 'Tin thường', 'published')
addArticle.run(32, 'document', 'Văn bản nội bộ', 'draft')
const addTranslation = sqlite.prepare('INSERT INTO article_translations (`id`, `article_id`, `lang_code`, `status`, `title`, `progress`) VALUES (?, ?, ?, ?, ?, ?)')
addTranslation.run(1, 31, 'en', 'published', 'Ordinary news', 100)
addTranslation.run(2, 32, 'en', 'ai_draft', 'Internal document', 100)

type Row = Record<string, unknown>
function rowsOf(table: typeof articles | typeof articleTranslations, where: SQL, projection?: Row): Row[] {
  const query = dialect.sqlToQuery(where)
  const raw = sqlite.prepare(`SELECT * FROM ${getTableName(table)} WHERE ${query.sql}`).all(...query.params as never[]) as Row[]
  const columns = getTableColumns(table) as Record<string, { name: string }>
  const full = raw.map(row => Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, row[column.name] ?? null])))
  return projection ? full.map(row => Object.fromEntries(Object.keys(projection).map(key => [key, row[key]]))) : full
}
function select(projection?: Row) {
  let table: typeof articles | typeof articleTranslations
  const builder = {
    from(t: typeof table) { table = t; return builder },
    where(where: SQL) {
      const rows = rowsOf(table, where, projection)
      return { limit: async () => rows, then: (resolve: (rows: Row[]) => unknown) => resolve(rows) }
    },
  }
  return builder
}
mock.module('../server/utils/db', { namedExports: { getDb: () => ({ select }) } })
// The in-memory bulk job, pointed at whichever article a test needs.
const bulkState = { active: true, total: 2, processed: 1, currentArticleId: null as number | null, currentArticleTitle: null as string | null, langCode: 'en', langName: 'English', startedAt: null, completedAt: null }
mock.module('../server/services/article-translation-bulk', {
  namedExports: { getBulkTranslationTaskState: () => ({ ...bulkState }), bulkTriggerTranslation: async () => ({ ok: true }) },
})

type Event = { params: Record<string, string>, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getRouterParam = (event: Event, key: string) => event.params[key]

const list = (await import('../server/api/admin/articles/[id]/translations/index.get')).default as unknown as (event: Event) => Promise<{ items: Row[] }>
const one = (await import('../server/api/admin/articles/[id]/translations/[lang].get')).default as unknown as (event: Event) => Promise<{ translation: Row }>
const progress = (await import('../server/api/admin/articles/[id]/translations/[lang]/progress.get')).default as unknown as (event: Event) => Promise<Row>
const bulkStatus = (await import('../server/api/admin/articles/bulk-translate-status.get')).default as unknown as (event: Event) => Promise<{ task: { currentArticleId: number | null, currentArticleTitle: string | null } }>

const grant = (resource: string) => ({ resource, canCreate: false, canRead: true, canUpdate: false, canDelete: false })
const newsReader = { id: 9, isSuperAdmin: false, permissions: [grant('news')] }
const newsAndDocsReader = { id: 9, isSuperAdmin: false, permissions: [grant('news'), grant('documents')] }
const at = (adminUser: unknown, id: number, lang = 'en'): Event => ({ params: { id: String(id), lang }, context: { adminUser } })
async function statusOf(run: () => Promise<unknown>): Promise<number | null> {
  try { await run(); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

test('a news-only reader cannot read the translations of another type — 404, like a missing id', async () => {
  for (const [name, route] of [['list', list], ['one', one], ['progress', progress]] as const) {
    assert.equal(await statusOf(() => route(at(newsReader, 32))), 404, `${name}: document article`)
    assert.equal(await statusOf(() => route(at(newsReader, 999))), 404, `${name}: missing article`)
  }
})

test('translations of a type the reader may read are still served', async () => {
  assert.equal((await list(at(newsReader, 31))).items.length, 1)
  assert.equal((await one(at(newsReader, 31))).translation.title, 'Ordinary news')
  assert.equal((await progress(at(newsReader, 31))).progress, 100)
  assert.equal((await one(at(newsAndDocsReader, 32))).translation.title, 'Internal document', 'documents:read opens the document article')
})

test('bulk translation status shows the current article only to someone who may read its type', async () => {
  bulkState.currentArticleId = 32
  bulkState.currentArticleTitle = 'Văn bản nội bộ'
  const hidden = await bulkStatus(at(newsReader, 0))
  assert.equal(hidden.task.currentArticleId, null)
  assert.equal(hidden.task.currentArticleTitle, null)
  assert.equal((await bulkStatus(at(newsAndDocsReader, 0))).task.currentArticleTitle, 'Văn bản nội bộ')
  assert.equal((await bulkStatus(at({ id: 1, isSuperAdmin: true, permissions: [] }, 0))).task.currentArticleTitle, 'Văn bản nội bộ')
  bulkState.currentArticleId = 31
  bulkState.currentArticleTitle = 'Tin thường'
  assert.equal((await bulkStatus(at(newsReader, 0))).task.currentArticleTitle, 'Tin thường')
})
