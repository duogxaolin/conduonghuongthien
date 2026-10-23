import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, getTableName, type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * `GET /api/public/comments/checkpoint` took any ids from anyone and returned
 * `isHidden` + `flagReason` — the officer's hide note, the AI's reasoning and the
 * literal blocklist pattern that matched (rà soát 2026-10-22). Now it answers only
 * for the signed-in reader's own comments, and never the reason. The real WHERE is
 * compiled with the MySQL dialect and run on SQLite.
 */

const { articleComments } = await import('../server/db/schema')

const sqlite = new DatabaseSync(':memory:')
const dialect = new MySqlDialect()
const columns = getTableColumns(articleComments) as Record<string, { name: string }>
sqlite.exec(`CREATE TABLE ${getTableName(articleComments)} (${Object.values(columns).map(c => `\`${c.name}\``).join(', ')})`)
const add = sqlite.prepare('INSERT INTO article_comments (`id`, `reader_id`, `is_hidden`, `flag_reason`) VALUES (?, ?, ?, ?)')
add.run(1, 7, 1, 'Khớp từ khóa an ninh: "mẫu-bí-mật"')
add.run(2, 8, 1, 'Ghi chú nội bộ của cán bộ')
add.run(3, 7, 0, null)

function select(projection: Record<string, unknown>) {
  return {
    from: () => ({
      where: async (where: SQL) => {
        const query = dialect.sqlToQuery(where)
        const rows = sqlite.prepare(`SELECT * FROM article_comments WHERE ${query.sql}`).all(...query.params as never[]) as Record<string, unknown>[]
        return rows.map(row => Object.fromEntries(Object.keys(projection).map(key => [key, row[columns[key]!.name]])))
      },
    }),
  }
}
mock.module('../server/utils/db', { namedExports: { getDb: () => ({ select }) } })
let signedIn: { id: number } | null = null
mock.module('../server/utils/reader-auth', { namedExports: { optionalReader: async () => signedIn } })

type Event = { query: Record<string, string> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getQuery = (event: Event) => event.query

const checkpoint = (await import('../server/api/public/comments/checkpoint.get')).default as unknown as (event: Event) => Promise<{ items: Array<Record<string, unknown>> }>
const ask = (ids: string) => checkpoint({ query: { ids } })

test('an anonymous caller learns nothing', async () => {
  signedIn = null
  assert.deepEqual((await ask('1,2,3')).items, [])
})

test('a reader sees only their own comments, and never the moderation reason', async () => {
  signedIn = { id: 7 }
  const items = (await ask('1,2,3')).items
  assert.deepEqual(items.map(item => item.id).sort(), [1, 3], 'comment 2 belongs to someone else')
  for (const item of items) assert.ok(!('flagReason' in item), 'no reason field at all')
  assert.ok(items.find(item => item.id === 1)!.isHidden)
})

test('another reader cannot read the first reader\'s comment state', async () => {
  signedIn = { id: 8 }
  assert.deepEqual((await ask('1,3')).items, [])
})
