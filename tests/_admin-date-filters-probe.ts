/**
 * Child process for tests/admin-date-filters-vn-day.test.ts — run once per TZ.
 * Runs the real GET /api/admin/chatbot/sessions and GET /api/admin/activity-logs
 * handlers against a fake DB, compiles the WHERE each one built to MySQL with
 * Drizzle's dialect, and prints `{ "<handler>:<case>": [sql, ...params] | { status } }`
 * as JSON on stdout.
 */
import { mock } from 'node:test'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

const dialect = new MySqlDialect()
let wheres: SQL[] = []

type Builder = Record<string, unknown>
function builder(): Builder {
  const b: Builder = {}
  b.from = () => b
  b.leftJoin = () => b
  b.where = (where: SQL) => { wheres.push(where); return b }
  b.orderBy = () => b
  b.limit = () => b
  b.offset = () => b
  b.then = (resolve: (rows: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve([{ total: 0 }]).then(resolve, reject)
  return b
}
const fakeDb = { select: () => builder(), insert: () => ({ values: async () => {} }) }

mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb } })
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '127.0.0.1' } })

type Event = { context: Record<string, unknown>, query: Record<string, string> }
const g = globalThis as Record<string, unknown>
g.defineEventHandler = (handler: unknown) => handler
g.getQuery = (event: Event) => event.query
g.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const handlers = {
  sessions: (await import('../server/api/admin/chatbot/sessions/index.get')).default as unknown as (event: Event) => Promise<unknown>,
  activity: (await import('../server/api/admin/activity-logs/index.get')).default as unknown as (event: Event) => Promise<unknown>,
}

const cases: Record<string, Record<string, string>> = {
  oneDay: { from: '2026-10-14', to: '2026-10-14' },
  range: { from: '2026-10-01', to: '2026-10-31' },
  toOnly: { to: '2026-12-31' },
  impossible: { from: '2026-02-30' },
  zonelessTime: { from: '2026-10-14T00:00:00' },
  isoInstant: { to: '2026-10-14T23:59:59Z' },
  reversed: { from: '2026-10-15', to: '2026-10-14' },
}

const out: Record<string, unknown> = {}
for (const [name, handler] of Object.entries(handlers)) {
  for (const [label, query] of Object.entries(cases)) {
    wheres = []
    try {
      await handler({ context: { adminUser: { id: 1, isSuperAdmin: true, permissions: [] } }, query: { page: '1', pageSize: '25', ...query } })
      const { sql, params } = dialect.sqlToQuery(wheres[0]!)
      out[`${name}:${label}`] = [sql.replace(/\s+/g, ' '), ...params]
    } catch (error) {
      out[`${name}:${label}`] = { status: (error as { statusCode?: number }).statusCode ?? 500 }
    }
  }
}
process.stdout.write(JSON.stringify(out))
