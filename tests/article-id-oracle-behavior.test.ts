import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, getTableName, type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * `deleteArticleById` / `setArticleStatus` used to look the row up by id alone
 * and check the type permission second: a missing id answered 404 and an id of a
 * type the caller may not touch answered 403 — an oracle for which ids exist
 * (rà soát 2026-10-22). The lookup is now scoped with `articleActionScope(actor,
 * 'read')`, the rule the file itself documents.
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
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      select: () => ({ from: () => ({ where: (where: SQL) => ({ limit: async () => selectArticles(where) }) }) }),
      delete: () => ({ where: async () => { writes.push('delete') } }),
      update: () => ({ set: () => ({ where: async () => { writes.push('update') } }) }),
      insert: () => ({ values: async () => { writes.push('audit') } }),
    }),
  },
})

const { deleteArticleById, setArticleStatus } = await import('../server/services/articles')

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
