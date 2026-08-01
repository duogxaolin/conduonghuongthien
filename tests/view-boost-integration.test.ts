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
 * Gated and self-cleaning, following the *-ddl-integration precedent:
 *
 *   VIEW_BOOST_INTEGRATION=1 VIEW_BOOST_PORT=33069 VIEW_BOOST_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import mysql from 'mysql2/promise'

const enabled = process.env.VIEW_BOOST_INTEGRATION === '1'
const host = process.env.VIEW_BOOST_HOST || '127.0.0.1'
const port = Number(process.env.VIEW_BOOST_PORT || 3306)
const user = process.env.VIEW_BOOST_USER || 'root'
const password = process.env.VIEW_BOOST_PASSWORD || 'rootpassword'
const database = `cdkt_view_boost_${Date.now()}_${process.pid}`

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_view_boost_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

test('a gradual job survives the round trip through MySQL and delivers proportionally', {
  skip: !enabled,
  timeout: 120_000,
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
