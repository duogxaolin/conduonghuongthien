import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, getTableName, type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * Thông báo của bạn đọc chỉ là của chính bạn đọc đó (IDOR):
 *
 *   - `GET /api/public/reader/notifications` liệt kê, `POST …/notifications/read` đánh dấu
 *     đã đọc — danh tính lấy từ vé bạn đọc (`requireReader`), không bao giờ từ query/body;
 *   - `markRead`/`markAllRead` luôn chặn câu UPDATE theo `reader_id`, nên một id của
 *     người khác không đổi được gì;
 *   - lượt từ chối (body hỏng, không có id) không tốn hạn mức; hạn mức tính ngay trước
 *     lượt ghi.
 *
 * Trước đây ba điều này chỉ được giữ bằng khẳng định văn bản trong
 * `tests/reader-notifications.test.ts` (thân hàm phải chứa `readerNotifications.readerId`,
 * endpoint không được đọc `body.readerId`, `recordRateLimitHit` đứng sau câu từ chối).
 * Ở đây endpoint và service thật chạy; mệnh đề WHERE mà service dựng được biên dịch bằng
 * dialect MySQL rồi chạy trên bảng SQLite trong bộ nhớ (cùng harness với
 * `article-id-oracle-behavior.test.ts`), nên điều được kiểm là điều kiện thật
 * (docs/decisions/test-strategy.md).
 */

const { readerNotifications } = await import('../server/db/schema')

const TABLE = getTableName(readerNotifications)
const COLUMNS = getTableColumns(readerNotifications)
const sqlite = new DatabaseSync(':memory:')
sqlite.exec(`CREATE TABLE ${TABLE} (${Object.values(COLUMNS).map(column => `\`${column.name}\``).join(', ')})`)
const dialect = new MySqlDialect()
const driverValue = (value: unknown) => (typeof value === 'boolean' ? Number(value) : value)
const compile = (where: SQL) => {
  const query = dialect.sqlToQuery(where)
  return { sql: query.sql, params: query.params.map(driverValue) as never[] }
}

const READER = 7
const OTHER = 8
function seed() {
  sqlite.exec(`DELETE FROM ${TABLE}`)
  const insert = sqlite.prepare(`INSERT INTO ${TABLE} (\`id\`, \`reader_id\`, \`comment_id\`, \`type\`, \`is_read\`, \`created_at\`) VALUES (?, ?, ?, 'comment_reply', 0, ?)`)
  insert.run(1, READER, 101, '2026-10-01T08:00:00Z')
  insert.run(2, READER, 102, '2026-10-02T08:00:00Z')
  insert.run(3, OTHER, 103, '2026-10-03T08:00:00Z')
  insert.run(4, OTHER, 104, '2026-10-04T08:00:00Z')
}
const unread = () => (sqlite.prepare(`SELECT \`id\` FROM ${TABLE} WHERE \`is_read\` = 0 ORDER BY \`id\``).all() as Array<{ id: number }>).map(row => row.id)

/** Every statement the services sent, so a refused request can be shown to have sent none. */
const statements: string[] = []
const PROPERTY_BY_COLUMN = new Map(Object.entries(COLUMNS).map(([property, column]) => [column.name, property]))
function select(projection: Record<string, unknown>) {
  let where: SQL | undefined
  let limit = -1
  let offset = 0
  const run = () => {
    const { sql, params } = compile(where!)
    statements.push(`SELECT … WHERE ${sql}`)
    if ('total' in projection) {
      return [{ total: (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE ${sql}`).get(...params) as { n: number }).n }]
    }
    const rows = sqlite.prepare(`SELECT * FROM ${TABLE} WHERE ${sql} ORDER BY \`created_at\` DESC, \`id\` DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
    // Joined columns (comment body, article, author) read as null: the list then has no
    // link target, which is the shape for an item that can no longer be opened.
    return rows.map((row) => {
      const out: Record<string, unknown> = Object.fromEntries(Object.keys(projection).map(key => [key, null]))
      for (const [name, value] of Object.entries(row as Record<string, unknown>)) {
        const property = PROPERTY_BY_COLUMN.get(name)
        if (property && property in out) out[property] = property === 'createdAt' ? new Date(String(value)) : property === 'isRead' ? value === 1 : value
      }
      return out
    })
  }
  const query = {
    from: () => query,
    innerJoin: () => query,
    leftJoin: () => query,
    where: (condition: SQL) => { where = condition; return query },
    orderBy: () => query,
    limit: (n: number) => { limit = n; return query },
    offset: (n: number) => { offset = n; return query },
    then: (resolve: (rows: unknown) => unknown, reject: (error: unknown) => unknown) => {
      try { return Promise.resolve(resolve(run())) } catch (error) { return Promise.resolve(reject(error)) }
    },
  }
  return query
}
function update() {
  let values: Record<string, unknown> = {}
  return {
    set: (next: Record<string, unknown>) => {
      values = next
      return {
        where: async (condition: SQL) => {
          const { sql, params } = compile(condition)
          const assignments = Object.keys(values).map(key => `\`${COLUMNS[key as keyof typeof COLUMNS].name}\` = ?`).join(', ')
          statements.push(`UPDATE … WHERE ${sql}`)
          sqlite.prepare(`UPDATE ${TABLE} SET ${assignments} WHERE ${sql}`).run(...Object.values(values).map(driverValue) as never[], ...params)
        },
      }
    },
  }
}
mock.module('../server/utils/db', { namedExports: { getDb: () => ({ select, update }), getPool: () => null } })

type Event = { reader?: number, body?: unknown, query?: Record<string, string> }
const createError = (input: { statusCode: number, statusMessage?: string }) => Object.assign(new Error(input.statusMessage ?? String(input.statusCode)), input)
mock.module('../server/utils/reader-auth', {
  namedExports: {
    requireReader: async (event: Event) => {
      if (event.reader === undefined) throw createError({ statusCode: 401, statusMessage: 'Bạn cần đăng nhập.' })
      return { id: event.reader }
    },
  },
})
const charged: string[] = []
let blocked = false
mock.module('../server/utils/rate-limit-store', {
  namedExports: { recordRateLimitHit: async (key: string) => { charged.push(key); return { blocked, count: charged.length } } },
})
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({}) } })

const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.getQuery = (event: Event) => event.query ?? {}
globals.createError = createError

type Page = { ok: boolean, items: Array<{ id: number, isRead: boolean, target: unknown }>, total: number, unreadCount: number }
const list = (await import('../server/api/public/reader/notifications.get')).default as unknown as (event: Event) => Promise<Page>
const markRead = (await import('../server/api/public/reader/notifications/read.post')).default as unknown as (event: Event) => Promise<{ ok: boolean }>

async function statusOf(run: () => Promise<unknown>): Promise<number | null> {
  try { await run(); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

beforeEach(() => {
  seed()
  statements.length = 0
  charged.length = 0
  blocked = false
})

test('list: a reader sees their own notifications only, whatever readerId the query names', async () => {
  for (const query of [{}, { readerId: String(OTHER) }, { readerId: String(OTHER), reader_id: String(OTHER), perPage: '30' }]) {
    const page = await list({ reader: READER, query })
    assert.deepEqual(page.items.map(item => item.id), [2, 1], JSON.stringify(query))
    assert.equal(page.total, 2)
    assert.equal(page.unreadCount, 2)
  }
  assert.deepEqual((await list({ reader: OTHER })).items.map(item => item.id), [4, 3], 'the other reader still has theirs')
})

test('mark read: ids that belong to another reader are left unread, even when the body names that reader', async () => {
  await markRead({ reader: READER, body: { ids: [3, 4, 1], readerId: OTHER } })
  assert.deepEqual(unread(), [2, 3, 4])
  await markRead({ reader: READER, body: { ids: [3], reader_id: OTHER } })
  assert.deepEqual(unread(), [2, 3, 4])
})

test('mark all read: only the caller\'s rows change, whatever the body says', async () => {
  await markRead({ reader: READER, body: { all: true, readerId: OTHER } })
  assert.deepEqual(unread(), [3, 4])
  assert.equal((await list({ reader: OTHER })).unreadCount, 2)
})

test('without a reader ticket both endpoints answer 401 and send no statement', async () => {
  assert.equal(await statusOf(() => list({ query: { readerId: String(OTHER) } })), 401)
  assert.equal(await statusOf(() => markRead({ body: { all: true, readerId: OTHER } })), 401)
  assert.deepEqual(statements, [])
  assert.deepEqual(charged, [])
  assert.deepEqual(unread(), [1, 2, 3, 4])
})

test('a refused request costs no allowance; a valid one is charged once, to the caller, before the write', async () => {
  for (const body of [null, 'all', [], {}, { ids: [] }, { ids: ['x', -1, 0, 1.5] }, { all: 'true' }]) {
    assert.equal(await statusOf(() => markRead({ reader: READER, body })), 400, JSON.stringify(body))
  }
  assert.deepEqual(charged, [], 'a refusal spent allowance')
  assert.deepEqual(statements, [])

  await markRead({ reader: READER, body: { ids: [1] } })
  assert.deepEqual(charged, [`notif:read:${READER}`])
  assert.deepEqual(unread(), [2, 3, 4])
})

test('over the allowance the request is 429 and nothing is written', async () => {
  blocked = true
  assert.equal(await statusOf(() => markRead({ reader: READER, body: { all: true } })), 429)
  assert.deepEqual(statements, [])
  assert.deepEqual(unread(), [1, 2, 3, 4])
})
