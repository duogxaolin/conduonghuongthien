import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * `GET /api/admin/articles/:id/stats` and `POST …/:id/boost` looked the article up
 * by id first and checked the type's permission second: 404 for a missing id, 403
 * for an id of a type the caller may not touch — an oracle for which ids exist.
 * The lookup is now scoped to the caller's permitted types, so both cases are the
 * same 404, and a caller with no article permission at all is refused before any
 * lookup. Runs the real handlers against a fake DB that applies the WHERE the
 * handler built (compiled to MySQL) to an in-memory article table.
 */

const ARTICLES = [
  { id: 1, type: 'news', title: 'Tin' },
  { id: 2, type: 'document', title: 'Văn bản' },
]
const dialect = new MySqlDialect()
let selects = 0

/** Evaluate the compiled WHERE against one row — only the shapes the scope produces. */
function matches(where: SQL, row: { id: number, type: string }): boolean {
  const { sql: text, params } = dialect.sqlToQuery(where)
  const id = Number(params[0])
  if (row.id !== id) return false
  if (/1 = 1/.test(text)) return true
  // `type in (?, …)` — possibly OR'd with "type not in (known types)" for news
  // holders, which matches no row in this table (both rows have known types).
  const inList = /`type` in \(([^)]*)\)/.exec(text)
  assert.ok(inList, `unexpected scope shape: ${text}`)
  const allowed = params.slice(1, 1 + inList[1]!.split(',').length).map(String)
  return allowed.includes(row.type)
}

const fakeDb = {
  select: () => ({
    from: () => ({
      where: (where: SQL) => ({
        // First query of each request: the article lookup.
        limit: async () => { selects += 1; return ARTICLES.filter(row => matches(where, row)) },
        // stats.get's second query (running boost job): none.
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
  }),
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb } })
mock.module('../server/services/article-views', {
  namedExports: {
    getArticleViewStats: async () => ({ total: 0 }),
    validateBoostInput: () => ({ ok: false, message: 'stop here' }),
    addFabricatedViews: async () => {},
  },
})

type Event = { params: Record<string, string>, context: Record<string, unknown>, body?: unknown, query?: Record<string, string> }
mock.module('h3', {
  namedExports: {
    defineEventHandler: (handler: unknown) => handler,
    getRouterParam: (event: Event, name: string) => event.params[name],
    getQuery: (event: Event) => event.query ?? {},
    readBody: async (event: Event) => event.body,
    createError: (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
  },
})

const stats = (await import('../server/api/admin/articles/[id]/stats.get')).default as unknown as (event: Event) => Promise<unknown>
const boost = (await import('../server/api/admin/articles/[id]/boost.post')).default as unknown as (event: Event) => Promise<unknown>

const perm = (resource: string, canRead: boolean, canUpdate: boolean) => ({ resource, canCreate: false, canRead, canUpdate, canDelete: false })
const newsEditor = { id: 9, isSuperAdmin: false, permissions: [perm('news', true, true)] }
const nobody = { id: 10, isSuperAdmin: false, permissions: [perm('media', true, true)] }

async function status(handler: (event: Event) => Promise<unknown>, id: number, adminUser: unknown) {
  try {
    await handler({ params: { id: String(id) }, context: { adminUser } })
    return 200
  } catch (error) {
    return (error as { statusCode?: number }).statusCode
  }
}

for (const [name, handler, okStatus] of [['stats', stats, 200], ['boost', boost, 400]] as const) {
  test(`${name}: a type the caller may not touch answers exactly like a missing id`, async () => {
    assert.equal(await status(handler, 2, newsEditor), 404, 'document id, news-only editor')
    assert.equal(await status(handler, 999, newsEditor), 404, 'missing id')
  })

  test(`${name}: the caller's own type still works`, async () => {
    // boost stops at body validation (400) — past the permission and lookup.
    assert.equal(await status(handler, 1, newsEditor), okStatus)
  })

  test(`${name}: a super admin reaches any article`, async () => {
    assert.equal(await status(handler, 2, { id: 1, isSuperAdmin: true, permissions: [] }), okStatus)
  })

  test(`${name}: no article permission at all is a 403 before any lookup`, async () => {
    selects = 0
    assert.equal(await status(handler, 1, nobody), 403)
    assert.equal(await status(handler, 999, nobody), 403)
    assert.equal(selects, 0, 'the database is not consulted')
  })
}
