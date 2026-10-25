import assert from 'node:assert/strict'
import test, { after, before, beforeEach, mock } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/mysql2'
import { startH3TestServer, type H3TestServer } from './_h3-test-server'

/**
 * `GET /api/admin/languages/:code/translations` — the list behind the "Bản dịch UI"
 * tab, the Vietnamese source map and the "Dịch AI còn thiếu" scan.
 *
 * Found in the Wave 3 7.1 rollout: the handler capped every answer (200 by default,
 * 500 at most) and the service ran the search in JS AFTER that cut. With ~600 keys per
 * language, rows past 200 could neither be seen nor found in the tab, and the two
 * `?limit=500` callers got an incomplete list — the AI was sent the raw key as its
 * source text, and the missing-keys scan could report 100 % with keys untranslated.
 *
 * The handler runs as a real h3 handler; the service builds its query with the real
 * drizzle MySQL dialect, and the SQL it sends is executed on an in-memory SQLite table
 * (backtick identifiers, `?` placeholders and `like` are understood by both), so a
 * `limit`, a missing `order by` or a filter applied after the cut shows up in the
 * rows, not just in the source text.
 */

const sqlite = new DatabaseSync(':memory:')
sqlite.exec('CREATE TABLE `lang_translations` (`id` INTEGER PRIMARY KEY, `lang_code` TEXT, `group` TEXT, `key` TEXT, `value` TEXT, `is_ai_translated` INTEGER, `created_at` TEXT, `updated_at` TEXT)')
const insert = sqlite.prepare('INSERT INTO `lang_translations` (`id`, `lang_code`, `group`, `key`, `value`, `is_ai_translated`) VALUES (?, ?, ?, ?, ?, 0)')

/** 581 keys, as many as the seed had when the bug was found; ids interleave two languages. */
const KEY_COUNT = 581
const pad = (n: number) => String(n).padStart(4, '0')
for (let n = 1; n <= KEY_COUNT; n++) {
  const group = n % 2 ? 'nav' : 'footer'
  insert.run(n * 2 - 1, 'vi', group, `key-${pad(n)}`, `Giá trị ${pad(n)}`)
  insert.run(n * 2, 'en', group, `key-${pad(n)}`, n % 3 ? `Value ${pad(n)}` : null)
}

const queries: Array<{ sql: string, params: unknown[] }> = []
const pool = {
  query: async (options: { sql: string, rowsAsArray?: boolean }, params: unknown[] = []) => {
    queries.push({ sql: options.sql, params })
    const statement = sqlite.prepare(options.sql)
    if (options.rowsAsArray) statement.setReturnArrays(true)
    return [statement.all(...(params as never[]))]
  },
}

const schema = await import('../server/db/schema')
const db = drizzle(pool as never, { schema, mode: 'default' })
mock.module('../server/utils/db', { namedExports: { getDb: () => db } })
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

const h3 = await import('h3')
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = h3.defineEventHandler
globals.createError = h3.createError
globals.getRouterParam = h3.getRouterParam
globals.getQuery = h3.getQuery
const listHandler = (await import('../server/api/admin/languages/[code]/translations/index.get')).default

let server: H3TestServer
before(async () => {
  server = await startH3TestServer((router) => {
    router.get('/api/admin/languages/:code/translations', h3.defineEventHandler((event) => {
      event.context.adminUser = { id: 7, isSuperAdmin: true }
      return listHandler(event)
    }))
  })
})
after(() => server.close())
beforeEach(() => { queries.length = 0 })

type Row = { id: number, langCode: string, group: string, key: string, value: string | null }
async function list(path: string): Promise<{ items: Row[], groups: string[] }> {
  const response = await server.send('GET', path)
  assert.equal(response.status, 200, response.text)
  return response.json() as { items: Row[], groups: string[] }
}

test(`every key of a language comes back — all ${KEY_COUNT}, in id order (RED before: 200)`, async () => {
  const { items, groups } = await list('/api/admin/languages/vi/translations')
  assert.equal(items.length, KEY_COUNT)
  assert.deepEqual(items.map(row => row.id), Array.from({ length: KEY_COUNT }, (_, i) => i * 2 + 1))
  assert.ok(items.every(row => row.langCode === 'vi'))
  assert.deepEqual([...groups].sort(), ['footer', 'nav'])
})

test('a client still asking for ?limit=500 (the old page) gets every key, not the first 500 (RED before)', async () => {
  const { items } = await list('/api/admin/languages/vi/translations?limit=500')
  assert.equal(items.length, KEY_COUNT)
  assert.equal(items.at(-1)?.key, `key-${pad(KEY_COUNT)}`)
  const offset = await list('/api/admin/languages/vi/translations?limit=10&offset=570')
  assert.equal(offset.items.length, KEY_COUNT, 'paging parameters are not a way to get a partial list either')
})

test('the key at position 450 is findable by its key — the search runs before any cut (RED before: [])', async () => {
  const { items } = await list('/api/admin/languages/vi/translations?search=key-0450')
  assert.deepEqual(items.map(row => row.key), ['key-0450'])
})

test('the search matches the translated text too, and combines with the group filter', async () => {
  const byValue = await list(`/api/admin/languages/en/translations?search=${encodeURIComponent('Value 0577')}`)
  assert.deepEqual(byValue.items.map(row => row.key), ['key-0577'])

  const inGroup = await list('/api/admin/languages/en/translations?group=footer&search=key-05')
  assert.ok(inGroup.items.length > 0)
  assert.ok(inGroup.items.every(row => row.group === 'footer' && row.key.startsWith('key-05')), JSON.stringify(inGroup.items.slice(0, 3)))
  // key-0500 … key-0581 in group footer (even numbers): 41 rows.
  assert.equal(inGroup.items.length, 41)
})

test('the search is a bound LIKE operand with its wildcards escaped — "%" does not match everything', async () => {
  await list(`/api/admin/languages/vi/translations?search=${encodeURIComponent('50%_')}`)
  const search = queries.find(query => / like /i.test(query.sql))
  assert.ok(search, `no LIKE in ${JSON.stringify(queries.map(query => query.sql))}`)
  assert.ok(!search.sql.includes('50'), 'the typed text never reaches the SQL text')
  assert.ok(search.params.includes('%50\\%\\_%'), JSON.stringify(search.params))
})

test('the group filter alone narrows to that group; "all" means no filter', async () => {
  const nav = await list('/api/admin/languages/vi/translations?group=nav')
  assert.equal(nav.items.length, Math.ceil(KEY_COUNT / 2))
  const all = await list('/api/admin/languages/vi/translations?group=all')
  assert.equal(all.items.length, KEY_COUNT)
})
