import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, getTableName, type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * `GET`/`PUT /api/admin/articles/:id`, `deleteArticleById` and `setArticleStatus`
 * used to look the row up by id alone and check the type permission second: a
 * missing id answered 404 and an id of a type the caller may not touch answered
 * 403 — an oracle for which ids exist (rà soát 2026-10-22). The lookup is now
 * scoped with `articleActionScope`: reads by `'read'`, writes by `'read'` OR the
 * write's own action (owner's decision), the rule the service file documents.
 *
 * The real WHERE clause is compiled with the MySQL dialect and run against an
 * in-memory SQLite table (same harness as `mfa-concurrency.test.ts`), so what is
 * tested is the condition the service actually builds, not a stand-in for it.
 */

const { articles } = await import('../server/db/schema')

const sqlite = new DatabaseSync(':memory:')
const dialect = new MySqlDialect()
const columns = Object.values(getTableColumns(articles))
sqlite.exec(`CREATE TABLE ${getTableName(articles)} (${columns.map(c => `\`${c.name}\``).join(', ')})`)
const insertRow = sqlite.prepare(`INSERT INTO ${getTableName(articles)} (\`id\`, \`type\`, \`title\`, \`status\`) VALUES (?, ?, ?, ?)`)
insertRow.run(31, 'news', 'Tin thường', 'draft')
insertRow.run(32, 'role_model', 'Gương điển hình', 'draft')
insertRow.run(33, null, 'Bài không loại', 'draft')

function selectArticles(where: SQL) {
  const query = dialect.sqlToQuery(where)
  const rows = sqlite.prepare(`SELECT * FROM ${getTableName(articles)} WHERE ${query.sql}`).all(...query.params as never[])
  return rows.map(row => Object.fromEntries(Object.entries(getTableColumns(articles)).map(([key, column]) => [
    key, (row as Record<string, unknown>)[column.name] ?? null,
  ])))
}

const writes: string[] = []
/** select / select({..}) → from → [leftJoin] → where → limit; joined columns read as null. */
function select(projection?: Record<string, unknown>) {
  const builder = {
    from: () => builder,
    leftJoin: () => builder,
    where: (where: SQL) => ({
      limit: async () => selectArticles(where).map(row => (projection
        ? Object.fromEntries(Object.keys(projection).map(key => [key, (row as Record<string, unknown>)[key] ?? null]))
        : row)),
    }),
  }
  return builder
}
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      select,
      delete: () => ({ where: async () => { writes.push('delete') } }),
      update: () => ({ set: () => ({ where: async () => { writes.push('update') } }) }),
      insert: () => ({ values: async () => { writes.push('audit') } }),
    }),
  },
})

const { deleteArticleById, setArticleStatus } = await import('../server/services/articles')

type Event = { body: unknown, params: Record<string, string>, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.getRouterParam = (event: Event, key: string) => event.params[key]
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)
const getArticle = (await import('../server/api/admin/articles/[id].get')).default as unknown as (event: Event) => Promise<{ article: { title: string } }>
const putArticle = (await import('../server/api/admin/articles/[id].put')).default as unknown as (event: Event) => Promise<unknown>
const request = (adminUser: unknown, id: number, body: unknown = {}): Event => ({ body, params: { id: String(id) }, context: { adminUser } })

const grant = (resource: string, flags: Partial<Record<'canCreate' | 'canRead' | 'canUpdate' | 'canDelete', boolean>>) => ({
  resource, canCreate: false, canRead: false, canUpdate: false, canDelete: false, ...flags,
})
const actor = (permissions: unknown[], isSuperAdmin = false) => ({ id: 9, isSuperAdmin, permissions }) as Parameters<typeof deleteArticleById>[0]
async function statusOf(run: () => Promise<unknown>): Promise<number | null> {
  try { await run(); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

const newsReader = actor([grant('news', { canRead: true })])
const newsEditor = actor([grant('news', { canRead: true, canUpdate: true, canDelete: true })])

test('delete: an id of a type you cannot read answers exactly like an id that does not exist', async () => {
  writes.length = 0
  assert.equal(await statusOf(() => deleteArticleById(newsEditor, 32)), 404, 'role_model id, news-only editor')
  assert.equal(await statusOf(() => deleteArticleById(newsEditor, 999)), 404, 'missing id')
  assert.deepEqual(writes, [])
})

test('delete: an article you can see but not delete is still 403, and one you may delete is deleted', async () => {
  writes.length = 0
  assert.equal(await statusOf(() => deleteArticleById(newsReader, 31)), 403)
  assert.deepEqual(writes, [])
  await deleteArticleById(newsEditor, 31)
  assert.deepEqual(writes, ['delete', 'audit'])
})

test('delete: untyped and dynamic-type articles stay reachable through the news permission', async () => {
  writes.length = 0
  await deleteArticleById(newsEditor, 33)
  assert.deepEqual(writes, ['delete', 'audit'])
})

test('status: same rule — unreadable and missing ids are both 404', async () => {
  writes.length = 0
  assert.equal(await statusOf(() => setArticleStatus(newsEditor, 32, 'archived')), 404)
  assert.equal(await statusOf(() => setArticleStatus(newsEditor, 999, 'archived')), 404)
  assert.equal(await statusOf(() => setArticleStatus(newsReader, 31, 'archived')), 403)
  assert.deepEqual(writes, [])
  await setArticleStatus(newsEditor, 31, 'archived')
  assert.deepEqual(writes, ['update', 'audit'])
})

test('a superadmin reaches every article', async () => {
  writes.length = 0
  await setArticleStatus(actor([], true), 32, 'published')
  assert.deepEqual(writes, ['update', 'audit'])
})

test('delete/status: a type you may change without reading is still reachable — scope is read OR the action', async () => {
  // Rare but legal role: delete/update on role models, no read on them.
  const blindEditor = actor([grant('news', { canRead: true }), grant('role_models', { canUpdate: true, canDelete: true })])
  writes.length = 0
  await setArticleStatus(blindEditor, 32, 'archived')
  await deleteArticleById(blindEditor, 32)
  assert.deepEqual(writes, ['update', 'audit', 'delete', 'audit'])
})

test('GET /api/admin/articles/:id — an unreadable type answers 404, exactly like a missing id', async () => {
  assert.equal(await statusOf(() => getArticle(request(newsReader, 32))), 404, 'role_model id, news-only reader')
  assert.equal(await statusOf(() => getArticle(request(newsReader, 999))), 404, 'missing id')
  assert.equal((await getArticle(request(newsReader, 31))).article.title, 'Tin thường')
})

test('PUT /api/admin/articles/:id — out-of-scope id is 404; visible but read-only is an honest 403', async () => {
  writes.length = 0
  assert.equal(await statusOf(() => putArticle(request(newsEditor, 32, { title: 'Sửa' }))), 404, 'role_model id, news-only editor')
  assert.equal(await statusOf(() => putArticle(request(newsEditor, 999, { title: 'Sửa' }))), 404, 'missing id')
  assert.equal(await statusOf(() => putArticle(request(newsReader, 31, { title: 'Sửa' }))), 403, 'can see it, may not edit it')
  assert.deepEqual(writes, [])
})
