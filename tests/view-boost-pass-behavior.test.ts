import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import test, { afterEach, beforeEach, mock } from 'node:test'

/**
 * The gradual view-boost delivery pass and its ticker (`server/services/view-boost-scheduler.ts`)
 * — the half `view-boost-scheduler.test.ts` (pure `computeBoostDue`) and the MySQL round trip
 * (`view-boost-integration`, gated) leave out (slice R7, task item 4):
 *   - one pass under the named lock `cdkt:articles:view-boost`, timeout 0, released after; a lock
 *     held elsewhere skips the pass (null) and touches nothing; no pool — null;
 *   - delivery is derived from absolute time: a pass mid-window delivers the elapsed fraction, a
 *     second pass at the same instant delivers nothing, a pass after downtime the whole shortfall,
 *     a pass past `ends_at` the remainder and closes the job; only `running` jobs are read;
 *   - the counter is claimed (guarded on `running`) before the views are written: a cancellation
 *     landing between the read and the claim delivers nothing; a failed view write loses that
 *     delivery (claimed, not written — the documented side to fail on), never doubles it;
 *   - the ticker: first pass deferred 60 s, then every 60 s, idempotent start, a failing pass is
 *     logged (`article_view_boost.scheduler_failed`) and the next tick still runs; stop stops the
 *     deferred first pass too — before, a stop inside the first minute still ran it
 *     (FINDING-R7-11; no production caller of stop today — dev reloads and tests).
 *
 * SQL on SQLite (`_sqlite-mysql-db.ts`; the daily row's `ON DUPLICATE KEY UPDATE … + ?` as SQLite's
 * upsert, with the unique key the schema declares). The pool is a fake that answers GET_LOCK /
 * RELEASE_LOCK and records them. Fake clocks: `now` for the pass, `mock.timers` for the ticker —
 * no real sleep.
 */

const schema = await import('../server/db/schema')
const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { articles, articleViewBoost, articleViewDaily } = schema
const harness = createSqliteMysqlDb([articles, articleViewBoost, articleViewDaily])
harness.sqlite.exec('CREATE UNIQUE INDEX daily_key ON article_view_daily (day, article_id, source_category)')

const lockCalls: Array<[string, unknown[]]> = []
const pool = { lockFree: true, released: 0, connections: 0 }
const fakePool = {
  async getConnection() {
    pool.connections += 1
    return {
      async query(sql: string, params: unknown[]) {
        lockCalls.push([sql, params])
        if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: pool.lockFree ? 1 : 0 }]]
        return [[]]
      },
      release() { pool.released += 1 },
    }
  },
}
let poolAvailable = true
const logged: string[] = []
const record = (level: string) => (entry: unknown) => { logged.push(`${level} ${inspect(entry, { depth: 6 })}`) }
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => (poolAvailable ? fakePool : null) } })
mock.module('../server/utils/logger', { namedExports: { logInfo: record('info'), logWarn: record('warn'), logError: record('error'), log: record('log') } })
const { runBoostPass, startViewBoostScheduler, stopViewBoostScheduler, TICK_INTERVAL_MS } = await import('../server/services/view-boost-scheduler')

const START = Date.UTC(2026, 9, 28, 1, 0, 0)
const MINUTE = 60_000
beforeEach(() => {
  harness.reset()
  lockCalls.length = 0
  logged.length = 0
  Object.assign(pool, { lockFree: true, released: 0, connections: 0 })
  poolAvailable = true
})
afterEach(() => {
  stopViewBoostScheduler()
  mock.timers.reset()
})

async function articleWithJob(job: Partial<typeof articleViewBoost.$inferInsert> = {}) {
  const [row] = await harness.db.insert(articles).values({ type: 'news', title: 'Bài', slug: `bai-${Math.random()}`, status: 'published' })
  const articleId = Number(row.insertId)
  const [boost] = await harness.db.insert(articleViewBoost).values({
    articleId, totalAmount: 600, appliedAmount: 0, durationMinutes: 60,
    startedAt: new Date(START), endsAt: new Date(START + 60 * MINUTE), status: 'running', ...job,
  })
  return { articleId, jobId: Number(boost.insertId) }
}
const at = (minutes: number) => ({ now: new Date(START + minutes * MINUTE) })
const job = (id: number) => harness.rows(articleViewBoost).find(row => row.id === id)!
const fabricated = (articleId: number) => harness.rows(articles).find(row => row.id === articleId)!.viewTotalFabricated
const boostDaily = () => harness.rows(articleViewDaily).map(row => [row.articleId, row.sourceCategory, row.fabricatedViews, row.realViews])

// ─── The lock ────────────────────────────────────────────────────────────────

test('a pass runs under the named lock cdkt:articles:view-boost (timeout 0) and releases it; held elsewhere → null, nothing touched', async () => {
  const { jobId } = await articleWithJob()
  assert.deepEqual(await runBoostPass(at(30)), { jobs: 1, delivered: 300, completed: 0 })
  assert.deepEqual(lockCalls, [['SELECT GET_LOCK(?, ?) AS acquired', ['cdkt:articles:view-boost', 0]], ['SELECT RELEASE_LOCK(?)', ['cdkt:articles:view-boost']]])
  assert.equal(pool.released, 1)

  pool.lockFree = false
  lockCalls.length = 0
  assert.equal(await runBoostPass(at(60)), null)
  assert.deepEqual(lockCalls.map(call => call[0]), ['SELECT GET_LOCK(?, ?) AS acquired'], 'not released: never held')
  assert.equal(pool.released, 2, 'the connection goes back to the pool either way')
  assert.deepEqual([job(jobId).appliedAmount, job(jobId).status], [300, 'running'])
})

test('no pool (no database configured) → null, no statement run', async () => {
  await articleWithJob()
  poolAvailable = false
  harness.statements.length = 0
  assert.equal(await runBoostPass(at(30)), null)
  assert.deepEqual([harness.statements, pool.connections], [[], 0])
})

// ─── Delivery from absolute time ─────────────────────────────────────────────

test('mid-window: the elapsed fraction is delivered once — fabricated half and the day\'s boost row; a second pass at the same instant delivers nothing', async () => {
  const { articleId, jobId } = await articleWithJob()
  assert.deepEqual(await runBoostPass(at(15)), { jobs: 1, delivered: 150, completed: 0 })
  assert.deepEqual(await runBoostPass(at(15)), { jobs: 1, delivered: 0, completed: 0 })
  assert.deepEqual([job(jobId).appliedAmount, job(jobId).status, fabricated(articleId)], [150, 'running', 150])
  assert.deepEqual(boostDaily(), [[articleId, 'boost', 150, 0]])
  assert.equal(logged.filter(line => line.includes('article_view_boost.pass')).length, 1, 'a pass that changed nothing logs nothing')
})

test('after downtime the next pass delivers the whole shortfall; past ends_at the remainder, and the job closes', async () => {
  const { articleId, jobId } = await articleWithJob()
  await runBoostPass(at(10))
  assert.deepEqual(await runBoostPass(at(40)), { jobs: 1, delivered: 300, completed: 0 }, 'minutes 10–40 in one pass')
  assert.deepEqual(await runBoostPass(at(240)), { jobs: 1, delivered: 200, completed: 1 })
  assert.deepEqual([job(jobId).appliedAmount, job(jobId).status, fabricated(articleId)], [600, 'completed', 600])
  assert.deepEqual(await runBoostPass(at(300)), { jobs: 0, delivered: 0, completed: 0 }, 'a completed job is not read again')
})

test('only running jobs are read; each job on its own window', async () => {
  const a = await articleWithJob()
  const b = await articleWithJob({ totalAmount: 60, startedAt: new Date(START + 30 * MINUTE), endsAt: new Date(START + 90 * MINUTE) })
  const cancelled = await articleWithJob({ status: 'cancelled', appliedAmount: 10 })
  assert.deepEqual(await runBoostPass(at(45)), { jobs: 2, delivered: 450 + 15, completed: 0 })
  assert.deepEqual([fabricated(a.articleId), fabricated(b.articleId), fabricated(cancelled.articleId)], [450, 15, 0])
  assert.equal(job(cancelled.jobId).appliedAmount, 10)
})

test('a cancellation landing between the read and the claim delivers nothing and keeps its status', async () => {
  const { articleId, jobId } = await articleWithJob()
  harness.beforeNext(/^update `article_view_boost`/, () => harness.sqlite.exec(`UPDATE article_view_boost SET status = 'cancelled' WHERE id = ${jobId}`))
  assert.deepEqual(await runBoostPass(at(240)), { jobs: 1, delivered: 0, completed: 0 })
  assert.deepEqual([job(jobId).status, job(jobId).appliedAmount, fabricated(articleId), boostDaily()], ['cancelled', 0, 0, []])
})

test('a failed view write loses that delivery (claimed, not written) and fails the pass; the lock is still released; never delivered twice', async () => {
  const { articleId, jobId } = await articleWithJob()
  harness.failNext(/^insert into `article_view_daily`/)
  await assert.rejects(runBoostPass(at(30)), (error: Error) => /^Failed query: insert into `article_view_daily`/.test(error.message) && /injected failure/.test(String(error.cause)))
  assert.equal(lockCalls.at(-1)![0], 'SELECT RELEASE_LOCK(?)')
  assert.deepEqual([job(jobId).appliedAmount, fabricated(articleId)], [300, 0], 'the claim stands; the views rolled back with their own transaction')
  assert.deepEqual(await runBoostPass(at(30)), { jobs: 1, delivered: 0, completed: 0 }, 'not replayed')
})

// ─── The ticker ──────────────────────────────────────────────────────────────

const flush = async () => { for (let n = 0; n < 20; n++) await new Promise(resolve => setImmediate(resolve)) }

test('the ticker: first pass after 60 s, then every TICK_INTERVAL_MS; start is idempotent; stop stops it', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  startViewBoostScheduler()
  startViewBoostScheduler()
  const passes = () => lockCalls.filter(call => call[0].startsWith('SELECT GET_LOCK')).length
  mock.timers.tick(59_999)
  await flush()
  assert.equal(passes(), 0, 'nothing before the first minute')
  mock.timers.tick(1)
  await flush()
  assert.equal(passes(), 2, 'the deferred pass and the first interval tick (both at 60 s)')
  mock.timers.tick(TICK_INTERVAL_MS)
  await flush()
  assert.equal(passes(), 3)
  stopViewBoostScheduler()
  mock.timers.tick(10 * TICK_INTERVAL_MS)
  await flush()
  assert.equal(passes(), 3)
})

test('FINDING-R7-11: a stop inside the first minute stops the deferred first pass too', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  startViewBoostScheduler()
  mock.timers.tick(30_000)
  stopViewBoostScheduler()
  mock.timers.tick(5 * TICK_INTERVAL_MS)
  await flush()
  // Before: the 60-second warm-up timer was never cleared — one pass ran after the stop.
  assert.equal(lockCalls.length, 0)
})

test('a failing pass is swallowed into one log line; the next tick runs again', async () => {
  await articleWithJob()
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  harness.failNext(/^select/)
  startViewBoostScheduler()
  mock.timers.tick(60_000)
  await flush()
  assert.equal(logged.filter(line => line.startsWith('error') && line.includes('article_view_boost.scheduler_failed') && line.includes('Failed query: select')).length, 1)
  mock.timers.tick(TICK_INTERVAL_MS)
  await flush()
  assert.equal(lockCalls.filter(call => call[0].startsWith('SELECT GET_LOCK')).length, 3, 'two passes at 60 s (one failed), one at 120 s')
})
