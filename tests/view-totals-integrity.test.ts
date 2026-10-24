/**
 * Per-article view totals (design D6, spec `most-read-ranking`).
 *
 * `articles.view_total_real` / `articles.view_total_fabricated` exist so that the
 * "Đọc nhiều" ranking reads one indexed column instead of summing
 * `article_view_daily` for every article on every request. They are only worth
 * having if they never drift from the daily rows, and the property that keeps
 * them equal is structural: every write to a daily row changes the matching
 * total **in the same transaction**, and nothing else writes either.
 *
 * What this file pins, against the real write functions with Drizzle's real SQL
 * compiler (`drizzle.mock()`) and a fake transaction that commits or discards:
 *
 *   - a real view and a fabricated delivery each run two statements on ONE
 *     executor — the total first, then the daily upsert;
 *   - `articles` is locked first on purpose: inserting a new daily row takes a
 *     shared lock on the parent `articles` row (FK check), and two transactions
 *     that each hold that shared lock and then want the exclusive lock to bump
 *     the total deadlock each other. Parent first serialises them instead;
 *   - `updated_at` is pinned to itself: the column is `ON UPDATE
 *     CURRENT_TIMESTAMP`, so without it every page view would rewrite the
 *     article's "last modified" time (admin list, sitemap `lastmod`);
 *   - a real view never touches the fabricated total and vice versa (honesty
 *     invariant — the split stays recoverable with one column each);
 *   - a failure in the second statement discards the first;
 *   - the gradual scheduler (no executor) opens its own transaction, the
 *     instant boost (executor = its audit transaction) reuses it.
 *
 * The behaviour against a real MySQL — totals equal the daily sums after real
 * views, an instant boost, a gradual boost and a concurrent burst — is in
 * `tests/view-boost-integration.test.ts`.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test, { mock } from 'node:test'
import { drizzle } from 'drizzle-orm/mysql2'

type Statement = { sql: string, params: unknown[] }

const compiler = drizzle.mock()
const ledger = { pool: [] as Statement[], committed: [] as Statement[], rolledBack: [] as Statement[] }
let failOn: RegExp | null = null

function reset() {
  ledger.pool.length = 0
  ledger.committed.length = 0
  ledger.rolledBack.length = 0
  failOn = null
}

/**
 * Awaiting a Drizzle builder normally executes it through a driver session; the
 * mock has none. Overriding `then` on the builder instance compiles it with the
 * real MySQL dialect instead and records the statement — so what is asserted is
 * the SQL the service actually builds, not a hand-written stand-in.
 */
function recording<T extends object>(builder: T, sink: Statement[]): T {
  Object.defineProperty(builder, 'then', {
    configurable: true,
    value(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      try {
        const { sql, params } = (builder as unknown as { toSQL(): Statement }).toSQL()
        if (failOn?.test(sql)) throw new Error(`injected failure: ${sql}`)
        sink.push({ sql, params })
        return Promise.resolve([{ affectedRows: 1 }]).then(resolve, reject)
      } catch (error) {
        return Promise.reject(error).then(resolve, reject)
      }
    },
  })
  return builder
}

type AnyTable = Parameters<typeof compiler.insert>[0]
type AnyValues = Parameters<ReturnType<typeof compiler.insert>['values']>[0]
type AnySet = Parameters<ReturnType<typeof compiler.update>['set']>[0]

function executor(sink: Statement[]) {
  return {
    insert: (table: AnyTable) => {
      const builder = compiler.insert(table)
      return { values: (values: AnyValues) => recording(builder.values(values), sink) }
    },
    update: (table: AnyTable) => {
      const builder = compiler.update(table)
      return { set: (values: AnySet) => recording(builder.set(values), sink) }
    },
  }
}

mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      ...executor(ledger.pool),
      async transaction<T>(callback: (tx: ReturnType<typeof executor>) => Promise<T>): Promise<T> {
        const pending: Statement[] = []
        try {
          const result = await callback(executor(pending))
          ledger.committed.push(...pending)
          return result
        } catch (error) {
          ledger.rolledBack.push(...pending)
          throw error
        }
      },
    }),
    getPool: () => null,
  },
})

const { recordArticleView, addFabricatedViews } = await import('../server/services/article-views')

const DAY = '2026-10-24'
const TOTAL_REAL = /^update `articles` set `updated_at` = `articles`\.`updated_at`, `view_total_real` = `articles`\.`view_total_real` \+ \? where `articles`\.`id` = \?$/
const TOTAL_FABRICATED = /^update `articles` set `updated_at` = `articles`\.`updated_at`, `view_total_fabricated` = `articles`\.`view_total_fabricated` \+ \? where `articles`\.`id` = \?$/
const DAILY_REAL = /^insert into `article_view_daily` .* on duplicate key update `real_views` = `article_view_daily`\.`real_views` \+ 1$/
const DAILY_FABRICATED = /^insert into `article_view_daily` .* on duplicate key update `fabricated_views` = `article_view_daily`\.`fabricated_views` \+ \?$/

test('a real view bumps view_total_real in the same transaction as its daily row — articles first', async () => {
  reset()
  await recordArticleView({ articleId: 7, sourceCategory: 'search', day: DAY })

  assert.deepEqual(ledger.pool, [], 'nothing may be written outside the transaction')
  assert.equal(ledger.committed.length, 2, 'exactly the total and the daily row')
  const [total, daily] = ledger.committed
  assert.match(total!.sql, TOTAL_REAL)
  assert.deepEqual(total!.params, [1, 7], 'one real view on article 7')
  assert.doesNotMatch(total!.sql, /view_total_fabricated/, 'a real view must never reach the fabricated total')
  assert.match(daily!.sql, DAILY_REAL)
  assert.deepEqual(daily!.params, [DAY, 7, 'search', 1, 0], 'the daily row counts one real view and no fabricated one')
})

test('a fabricated delivery bumps view_total_fabricated by the amount, never the real total', async () => {
  reset()
  // The instant boost passes its audit transaction as the executor.
  const tx: Statement[] = []
  await addFabricatedViews({ articleId: 7, amount: 50, day: DAY, executor: executor(tx) as never })

  assert.deepEqual(ledger.pool, [], 'the pool is never used when an executor is given')
  assert.deepEqual(ledger.committed, [], 'no second transaction is opened inside the caller\'s')
  assert.equal(tx.length, 2)
  const [total, daily] = tx
  assert.match(total!.sql, TOTAL_FABRICATED)
  assert.deepEqual(total!.params, [50, 7])
  assert.doesNotMatch(total!.sql, /view_total_real/, 'a fabricated view must never reach the real total')
  assert.match(daily!.sql, DAILY_FABRICATED)
  assert.deepEqual(daily!.params, [DAY, 7, 'boost', 0, 50, 50])
})

test('the gradual scheduler (no executor) gets its own transaction around both statements', async () => {
  reset()
  await addFabricatedViews({ articleId: 9, amount: 3, day: DAY })

  assert.deepEqual(ledger.pool, [])
  assert.equal(ledger.committed.length, 2)
  assert.match(ledger.committed[0]!.sql, TOTAL_FABRICATED)
  assert.deepEqual(ledger.committed[0]!.params, [3, 9])
  assert.match(ledger.committed[1]!.sql, DAILY_FABRICATED)
})

test('a failed daily upsert discards the total with it — both or neither', async () => {
  reset()
  failOn = /article_view_daily/
  await assert.rejects(recordArticleView({ articleId: 7, sourceCategory: 'direct', day: DAY }), /injected failure/)
  assert.deepEqual(ledger.committed, [])
  assert.deepEqual(ledger.pool, [])
  assert.equal(ledger.rolledBack.length, 1)
  assert.match(ledger.rolledBack[0]!.sql, TOTAL_REAL)

  reset()
  failOn = /article_view_daily/
  await assert.rejects(addFabricatedViews({ articleId: 7, amount: 4, day: DAY }), /injected failure/)
  assert.deepEqual(ledger.committed, [])
  assert.equal(ledger.rolledBack.length, 1)
  assert.match(ledger.rolledBack[0]!.sql, TOTAL_FABRICATED)
})

test('an invalid fabricated amount writes nothing at all', async () => {
  reset()
  for (const amount of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(addFabricatedViews({ articleId: 7, amount, day: DAY }), /positive integer/)
  }
  assert.deepEqual(ledger, { pool: [], committed: [], rolledBack: [] })
})

// ─── Single write point ──────────────────────────────────────────────────────

const serverRoot = new URL('../server/', import.meta.url)

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(new URL(dir, serverRoot), { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

test('only article-views.ts writes the daily rows or the split totals', () => {
  // `server/db/` declares the columns and holds the one-time backfill; everything
  // else must go through recordArticleView / addFabricatedViews, or the totals
  // and the daily rows can be changed apart from each other.
  const offenders: string[] = []
  for (const file of walk('.')) {
    if (file.startsWith('db/') || file === 'services/article-views.ts') continue
    const source = readFileSync(new URL(file, serverRoot), 'utf8')
    const hits = source.match(/(?:insert|update)\(\s*articleViewDaily\b|(?:INTO|UPDATE)\s+\\?`?article_view_daily\b|viewTotalReal|viewTotalFabricated|view_total_real|view_total_fabricated/gi)
    if (hits) offenders.push(`${file}: ${[...new Set(hits)].join(', ')}`)
  }
  assert.deepEqual(offenders, [], 'only server/services/article-views.ts may write views or read the real/fabricated split')
})

test('both boost paths deliver through addFabricatedViews', () => {
  for (const file of ['api/admin/articles/[id]/boost.post.ts', 'services/view-boost-scheduler.ts']) {
    const source = readFileSync(new URL(file, serverRoot), 'utf8')
    assert.match(source, /addFabricatedViews\(\{/, `${file} must deliver fabricated views through addFabricatedViews`)
  }
})
