/**
 * Child process for tests/ai-logs-date-filter.test.ts — run once per TZ. Runs the
 * real GET /api/admin/ai/logs handler against a fake DB, compiles the WHERE it
 * built to MySQL with Drizzle's dialect, and prints the bound parameters as JSON
 * on stdout: `{ "<label>": ["param", …], … }`.
 */
import { mock } from 'node:test'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

const dialect = new MySqlDialect()
let lastWhere: SQL | undefined
const fakeDb = {
  select: () => ({
    from: () => ({
      where: (where: SQL) => {
        lastWhere = where
        const rows = Object.assign(Promise.resolve([{ total: 0 }]), {
          orderBy: () => ({ limit: () => ({ offset: async () => [] }) }),
        })
        return rows
      },
    }),
  }),
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb } })
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

type Event = { context: Record<string, unknown>, query: Record<string, string> }
const g = globalThis as Record<string, unknown>
g.defineEventHandler = (handler: unknown) => handler
g.getQuery = (event: Event) => event.query

const handler = (await import('../server/api/admin/ai/logs/index.get')).default as unknown as (event: Event) => Promise<unknown>

const cases: Record<string, Record<string, string>> = {
  oneDay: { startDate: '2026-10-14', endDate: '2026-10-14' },
  range: { startDate: '2026-10-01', endDate: '2026-10-31' },
  impossible: { startDate: '2026-02-30', endDate: '2026-13-01' },
  notADate: { startDate: 'yesterday', endDate: '' },
}
const out: Record<string, unknown[]> = {}
for (const [label, query] of Object.entries(cases)) {
  await handler({ context: { adminUser: { id: 1, isSuperAdmin: true, permissions: [] } }, query })
  const { sql, params } = dialect.sqlToQuery(lastWhere!)
  // Param 0 is the rolling "last 90 days" floor (depends on now); keep the rest.
  out[label] = [sql.replace(/\s+/g, ' '), ...params.slice(1)]
}
process.stdout.write(JSON.stringify(out))
