/**
 * The gradual-inflation schedule, driven against a real MySQL.
 *
 * `view-boost-scheduler.test.ts` proves `computeBoostDue` is correct, but it
 * builds `BoostJob` objects in memory, so it is structurally blind to the one
 * failure that actually shipped: `started_at` / `ends_at` are DATETIME, a type
 * carrying no zone, and the pass read them back through a code path whose
 * timezone handling did not match the one Drizzle wrote them with. Every job
 * came back seven hours early, so any job shorter than seven hours was already
 * past its `ends_at` on its first tick — the whole amount delivered at once and
 * the row closed. `computeBoostDue` was right the whole time; it was being fed
 * corrupted inputs, and no in-memory test can see that.
 *
 * So this suite asserts round-trip fidelity through the two real code paths, and
 * then the behavioural consequence: a freshly created hour-long job must deliver
 * a time-proportional sliver on its first tick, not the lot.
 *
 * It also holds the real-MySQL half of the per-article view totals (design D6,
 * spec `most-read-ranking`): `articles.view_total_real` / `view_total_fabricated`
 * must equal the sums of `article_view_daily` after real views, an instant boost,
 * the gradual passes and a concurrent burst; `articles.updated_at` must not move
 * (the column is `ON UPDATE CURRENT_TIMESTAMP`); and the one-time backfill at
 * boot must run when the totals are introduced and never again. The statement
 * shapes are pinned without a database in `tests/view-totals-integrity.test.ts`.
 *
 * Gated and self-cleaning, following the *-ddl-integration precedent:
 *
 *   VIEW_BOOST_INTEGRATION=1 VIEW_BOOST_PORT=33069 VIEW_BOOST_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'

const enabled = process.env.VIEW_BOOST_INTEGRATION === '1'
const host = process.env.VIEW_BOOST_HOST || '127.0.0.1'
const port = Number(process.env.VIEW_BOOST_PORT || 3306)
const user = process.env.VIEW_BOOST_USER || 'root'
const password = process.env.VIEW_BOOST_PASSWORD || 'rootpassword'
const database = `cdkt_view_boost_${Date.now()}_${process.pid}`
const backfillDatabase = `${database}_backfill`

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_view_boost_\d+_\d+(?:_backfill)?$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

type TotalsRow = RowDataPacket & {
  real: string | number
  fabricated: string | number
  total: string | number
  dailyReal: string | number
  dailyFabricated: string | number
  updatedAt: string
}

/** The article's maintained totals next to the sums they must equal. */
async function readTotals(connection: Connection, articleId: number) {
  const [[row]] = await connection.query<TotalsRow[]>(
    `SELECT a.view_total_real AS \`real\`, a.view_total_fabricated AS fabricated, a.view_total AS total,
            DATE_FORMAT(a.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt,
            (SELECT COALESCE(SUM(v.real_views), 0) FROM article_view_daily v WHERE v.article_id = a.id) AS dailyReal,
            (SELECT COALESCE(SUM(v.fabricated_views), 0) FROM article_view_daily v WHERE v.article_id = a.id) AS dailyFabricated
       FROM articles a WHERE a.id = ?`,
    [articleId],
  )
  return {
    real: Number(row!.real),
    fabricated: Number(row!.fabricated),
    total: Number(row!.total),
    dailyReal: Number(row!.dailyReal),
    dailyFabricated: Number(row!.dailyFabricated),
    updatedAt: row!.updatedAt,
  }
}

async function assertTotalsEqualDailySums(connection: Connection, articleId: number, updatedAt: string, label: string) {
  const totals = await readTotals(connection, articleId)
  assert.equal(totals.real, totals.dailyReal, `${label}: view_total_real must equal SUM(real_views)`)
  assert.equal(totals.fabricated, totals.dailyFabricated, `${label}: view_total_fabricated must equal SUM(fabricated_views)`)
  assert.equal(totals.total, totals.real + totals.fabricated, `${label}: view_total is the stored sum of the two halves`)
  assert.equal(totals.updatedAt, updatedAt, `${label}: counting a view must not touch articles.updated_at`)
  return totals
}

const PINNED_UPDATED_AT = '2026-01-02 03:04:05'

test('a gradual job survives the round trip through MySQL and delivers proportionally', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  assertDisposableDatabase(database)

  const admin = await mysql.createConnection({ host, port, user, password })
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`)
  await admin.end()

  // getDb() caches its pool on first call, so the env has to be in place before
  // anything imports a module that touches it.
  const previous = { ...process.env }
  Object.assign(process.env, {
    DB_HOST: host,
    DB_PORT: String(port),
    DB_USER: user,
    DB_PASSWORD: password,
    DB_NAME: database,
  })

  try {
    const { initDb } = await import('../server/db/init')
    await initDb()

    const { getDb } = await import('../server/utils/db')
    const { articles, articleViewBoost, articleViewDaily } = await import('../server/db/schema')
    const { and, eq } = await import('drizzle-orm')
    const { runBoostPass, computeBoostDue } = await import('../server/services/view-boost-scheduler')

    const db = getDb()

    await db.insert(articles).values({
      type: 'news',
      title: 'Bài viết dùng để kiểm thử lượt xem',
      slug: `view-boost-probe-${Date.now()}`,
      status: 'published',
    })
    const [article] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.type, 'news'))
      .limit(1)
    const articleId = article!.id

    // ── Round-trip fidelity ─────────────────────────────────────────────────
    // Written exactly as boost.post.ts writes it: two JS Dates through Drizzle.
    // A minute of elapsed time is planted so the first pass has something
    // non-zero but small to compute, which is where the bug was visible.
    const TOTAL = 10_000
    const MINUTES = 60
    const startedAt = new Date(Date.now() - 60_000)
    const endsAt = new Date(startedAt.getTime() + MINUTES * 60_000)

    await db.insert(articleViewBoost).values({
      articleId,
      totalAmount: TOTAL,
      appliedAmount: 0,
      durationMinutes: MINUTES,
      startedAt,
      endsAt,
      status: 'running',
    })

    const [stored] = await db
      .select({
        id: articleViewBoost.id,
        startedAt: articleViewBoost.startedAt,
        endsAt: articleViewBoost.endsAt,
      })
      .from(articleViewBoost)
      .where(eq(articleViewBoost.articleId, articleId))
      .limit(1)

    // DATETIME stores whole seconds, so the round trip legitimately moves the
    // value by up to half a second in either direction. That is the entire
    // tolerance allowed: the failure this test exists to catch is seven hours,
    // which is 25,200,000 ms outside this bound — there is no reading of a
    // one-second window that could hide it.
    const SECOND = 1000
    const drift = (wrote: Date, read: Date) => Math.abs(read.getTime() - wrote.getTime())
    assert.ok(
      drift(startedAt, stored!.startedAt) <= SECOND,
      `started_at shifted on the round trip: wrote ${startedAt.toISOString()}, read ${stored!.startedAt.toISOString()}`,
    )
    assert.ok(
      drift(endsAt, stored!.endsAt) <= SECOND,
      `ends_at shifted on the round trip: wrote ${endsAt.toISOString()}, read ${stored!.endsAt.toISOString()}`,
    )
    assert.ok(
      stored!.endsAt.getTime() > Date.now(),
      'a 60-minute job created a minute ago must still be in its window',
    )

    // ── The behavioural consequence ─────────────────────────────────────────
    // One minute of 60 at 10,000 views is 166 after flooring. The exact figure
    // depends on how many milliseconds the inserts above took, so the assertion
    // is on the order of magnitude that separates "proportional" from "the lot",
    // plus an equality against `computeBoostDue` fed the Drizzle-read values.
    // That second assertion is what ties the pass's own read to this one: if the
    // scheduler ever reads `started_at` through a path with different timezone
    // handling, the two answers diverge by hours' worth of views and this line
    // fails, whatever the round-trip check above said.
    const expected = computeBoostDue(
      { id: stored!.id, articleId, totalAmount: TOTAL, appliedAmount: 0, startedAt: stored!.startedAt, endsAt: stored!.endsAt },
      new Date(),
    )
    assert.equal(expected.done, false)

    const pass = await runBoostPass()
    assert.ok(pass, 'the lock must be free in a throwaway database')
    assert.equal(pass.jobs, 1)
    assert.ok(
      pass.delivered > 0 && pass.delivered < 400,
      `first tick of a 60-minute job must deliver a proportional sliver, got ${pass.delivered} of ${TOTAL}`,
    )
    // Milliseconds elapse between the two computations, so a couple of views of
    // slack is real; seven hours of skew is 70,000.
    assert.ok(
      Math.abs(pass.delivered - expected.deliver) <= 5,
      `the pass read a different window than Drizzle did: delivered ${pass.delivered}, expected about ${expected.deliver}`,
    )
    assert.equal(
      pass.completed,
      0,
      'a job one minute into a 60-minute window must not be closed on its first pass',
    )

    const [row] = await db
      .select({ appliedAmount: articleViewBoost.appliedAmount, status: articleViewBoost.status })
      .from(articleViewBoost)
      .where(eq(articleViewBoost.id, stored!.id))
      .limit(1)
    assert.equal(row!.appliedAmount, pass.delivered, 'applied_amount must match what the pass reported')
    assert.equal(row!.status, 'running')

    // The delivered amount landed as fabricated views and nowhere near the real
    // column — the whole point of the two-column split.
    const [daily] = await db
      .select({ real: articleViewDaily.realViews, fabricated: articleViewDaily.fabricatedViews })
      .from(articleViewDaily)
      .where(and(eq(articleViewDaily.articleId, articleId), eq(articleViewDaily.sourceCategory, 'boost')))
      .limit(1)
    assert.equal(daily!.fabricated, pass.delivered)
    assert.equal(daily!.real, 0)

    // ── A second pass in the same minute is close to a no-op ────────────────
    // The target is time-derived, so an immediate re-run delivers at most the
    // handful of views the intervening milliseconds earned — never a second
    // full share.
    const again = await runBoostPass()
    assert.ok(again)
    assert.ok(
      again.delivered < 20,
      `an immediate second pass must not re-deliver, got ${again.delivered}`,
    )
    assert.equal(again.completed, 0)

    // ── Past ends_at, the remainder lands and the row closes ────────────────
    const afterWindow = new Date(stored!.endsAt.getTime() + 60_000)
    const [beforeFinal] = await db
      .select({ appliedAmount: articleViewBoost.appliedAmount })
      .from(articleViewBoost)
      .where(eq(articleViewBoost.id, stored!.id))
      .limit(1)
    const final = await runBoostPass({ now: afterWindow })
    assert.ok(final)
    assert.equal(final.delivered, TOTAL - beforeFinal!.appliedAmount)
    assert.equal(final.completed, 1)

    const [closed] = await db
      .select({ appliedAmount: articleViewBoost.appliedAmount, status: articleViewBoost.status })
      .from(articleViewBoost)
      .where(eq(articleViewBoost.id, stored!.id))
      .limit(1)
    assert.equal(closed!.appliedAmount, TOTAL, 'cumulative delivery must land on totalAmount exactly')
    assert.equal(closed!.status, 'completed')

    // A completed row is not picked up again, so nothing can exceed the total.
    const idle = await runBoostPass({ now: afterWindow })
    assert.deepEqual(idle, { jobs: 0, delivered: 0, completed: 0 })

    // ── Per-article totals (design D6) ──────────────────────────────────────
    // Every delivery above went through addFabricatedViews without an executor
    // (the scheduler's path). Add real views and an instant boost the way
    // view.post.ts and boost.post.ts write them, then compare against the sums.
    const { recordArticleView, addFabricatedViews } = await import('../server/services/article-views')
    const raw = await mysql.createConnection({ host, port, user, password, database })
    try {
      await raw.query('UPDATE `articles` SET `updated_at` = ? WHERE `id` = ?', [PINNED_UPDATED_AT, articleId])

      await recordArticleView({ articleId, sourceCategory: 'direct' })
      await recordArticleView({ articleId, sourceCategory: 'search' })
      await recordArticleView({ articleId, sourceCategory: 'direct' })
      await db.transaction(async (tx) => {
        await addFabricatedViews({ articleId, amount: 50, executor: tx })
      })

      const totals = await assertTotalsEqualDailySums(raw, articleId, PINNED_UPDATED_AT, 'after record + instant + gradual')
      assert.equal(totals.real, 3, 'three real views, nothing else reached the real total')
      assert.equal(totals.fabricated, TOTAL + 50, 'the gradual job and the instant boost, nothing else')

      // ── Concurrent burst on a fresh day ───────────────────────────────────
      // The first view of a (day, article, source) INSERTs a daily row, which
      // takes a shared lock on the parent article row (FK check). With the
      // total bumped AFTER that insert, two such transactions each hold the
      // shared lock and wait for the other's exclusive one — a deadlock, and
      // view.post.ts swallows the error, so the view would silently vanish.
      // The total is bumped FIRST; this burst proves no write is lost.
      const burstDay = '2031-02-03'
      const sources = ['direct', 'search', 'social', 'referral'] as const
      const outcomes = await Promise.allSettled([
        ...Array.from({ length: 20 }, (_, index) => recordArticleView({ articleId, sourceCategory: sources[index % sources.length]!, day: burstDay })),
        addFabricatedViews({ articleId, amount: 7, day: burstDay }),
        addFabricatedViews({ articleId, amount: 5, day: burstDay }),
      ])
      const rejected = outcomes.filter(outcome => outcome.status === 'rejected')
      assert.deepEqual(rejected.map(outcome => String((outcome as PromiseRejectedResult).reason)), [], 'no concurrent view may fail')
      const afterBurst = await assertTotalsEqualDailySums(raw, articleId, PINNED_UPDATED_AT, 'after the concurrent burst')
      assert.equal(afterBurst.real, totals.real + 20)
      assert.equal(afterBurst.fabricated, totals.fabricated + 12)
    } finally {
      await raw.end()
    }
  } finally {
    // getDb() caches a pool with no exported teardown; left open it holds the
    // test runner's event loop past the last assertion.
    const { getPool } = await import('../server/utils/db')
    await getPool()?.end()
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    const cleanup = await mysql.createConnection({ host, port, user, password })
    await cleanup.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await cleanup.end()
  }
})

/**
 * The one-time backfill (design D6). Its trigger is schema state the conversion
 * itself removes: the index `articles_status_type_views_idx` is absent. The
 * sequence at boot is probe → add the three columns → backfill → add the index,
 * so
 *   - an upgrade (columns and index absent) backfills once;
 *   - a second boot finds the index and writes nothing — a total changed after
 *     the backfill stays as it is;
 *   - a boot that died after the columns but before the index resumes: the
 *     backfill runs again, and since it SETs the totals to the sums it lands on
 *     the same values an uninterrupted boot would have.
 * A fresh database is born with the columns and the index, so it never backfills.
 */
test('the view-total backfill runs when the totals are introduced, once, and resumes after an interrupted boot', {
  skip: !enabled,
  // Four full boots (initDb) — each one walks every table's DDL.
  timeout: 600_000,
}, async () => {
  assertDisposableDatabase(backfillDatabase)
  const admin = await mysql.createConnection({ host, port, user, password })
  await admin.query(`CREATE DATABASE \`${backfillDatabase}\` CHARACTER SET utf8mb4`)
  await admin.end()

  const previous = { ...process.env }
  Object.assign(process.env, { DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME: backfillDatabase })
  const connection = await mysql.createConnection({ host, port, user, password, database: backfillDatabase })
  try {
    const { initDb } = await import('../server/db/init')
    await initDb()

    const indexExists = async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'articles' AND INDEX_NAME = 'articles_status_type_views_idx' LIMIT 1",
        [backfillDatabase],
      )
      return rows.length > 0
    }
    assert.equal(await indexExists(), true, 'a fresh database is born with the index')

    // ── Simulate the previous release: no totals, no index ──────────────────
    await connection.query(
      'ALTER TABLE `articles` DROP INDEX `articles_status_type_views_idx`, DROP COLUMN `view_total`, DROP COLUMN `view_total_real`, DROP COLUMN `view_total_fabricated`',
    )
    await connection.query(
      "INSERT INTO `articles` (`id`, `type`, `title`, `slug`, `status`, `updated_at`) VALUES (1, 'news', 'Có lượt xem', 'co-luot-xem', 'published', ?), (2, 'news', 'Chưa ai xem', 'chua-ai-xem', 'published', ?)",
      [PINNED_UPDATED_AT, PINNED_UPDATED_AT],
    )
    await connection.query(
      `INSERT INTO \`article_view_daily\` (\`day\`, \`article_id\`, \`source_category\`, \`real_views\`, \`fabricated_views\`) VALUES
        ('2026-10-01', 1, 'direct', 40, 0),
        ('2026-10-01', 1, 'search', 2, 0),
        ('2026-10-02', 1, 'direct', 5, 0),
        ('2026-10-02', 1, 'boost', 0, 300)`,
    )

    // ── Boot 1: the upgrade ─────────────────────────────────────────────────
    await initDb()
    assert.equal(await indexExists(), true, 'the index is added after the backfill')
    const upgraded = await assertTotalsEqualDailySums(connection, 1, PINNED_UPDATED_AT, 'boot 1')
    assert.deepEqual([upgraded.real, upgraded.fabricated, upgraded.total], [47, 300, 347])
    const untouched = await assertTotalsEqualDailySums(connection, 2, PINNED_UPDATED_AT, 'boot 1, article without views')
    assert.deepEqual([untouched.real, untouched.fabricated], [0, 0])

    // ── Boot 2: nothing to convert, so nothing is written ───────────────────
    await connection.query('UPDATE `articles` SET `view_total_real` = 999, `updated_at` = `updated_at` WHERE `id` = 1')
    await initDb()
    const secondBoot = await readTotals(connection, 1)
    assert.equal(secondBoot.real, 999, 'a second boot must not re-run the backfill')
    assert.equal(secondBoot.updatedAt, PINNED_UPDATED_AT)

    // ── Interrupted boot: columns present, index never added ────────────────
    await connection.query('ALTER TABLE `articles` DROP INDEX `articles_status_type_views_idx`')
    await initDb()
    assert.equal(await indexExists(), true)
    const resumed = await assertTotalsEqualDailySums(connection, 1, PINNED_UPDATED_AT, 'resumed boot')
    assert.deepEqual([resumed.real, resumed.fabricated], [47, 300], 'the resumed backfill lands on the uninterrupted result')
  } finally {
    await connection.end()
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    const cleanup = await mysql.createConnection({ host, port, user, password })
    await cleanup.query(`DROP DATABASE IF EXISTS \`${backfillDatabase}\``)
    await cleanup.end()
  }
})
