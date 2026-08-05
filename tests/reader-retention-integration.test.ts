/**
 * Reader-account retention, driven against a real MySQL.
 *
 * `data-retention.test.ts` drives a fake pool, which can pin the SQL text but is
 * structurally blind to the three things this change actually depends on:
 *
 *   1. **Ageing on `last_seen_at`, not `created_at`.** `reader_accounts` has both
 *      columns, so a purge written against `created_at` would not error — it would
 *      quietly delete the account of someone who registered two years ago and
 *      commented last week, taking their whole public comment history with it. A
 *      fake pool answers any column name, so only a real table can tell the two
 *      apart.
 *   2. **The row cap ordering by `last_seen_at`, not by `id`.** The primary key is
 *      AUTO_INCREMENT here, so `id` order is *signup* order. A cap ordered by id
 *      would evict the portal's earliest-registered readers even when they are the
 *      most active. A fake pool returns whatever affectedRows it was queued with
 *      regardless of ORDER BY.
 *   3. **The comment cascade, including administrator replies.** design.md D8
 *      states that deleting a reader removes their comments and that the
 *      `parent_id` self-cascade takes the portal's own replies with them. That is
 *      an assertion about foreign keys, and no fake can confirm it — if either FK
 *      were written without ON DELETE CASCADE, the rows would simply be left
 *      behind, orphaned, and every unit test would still pass.
 *
 * Gated and self-cleaning, following the *-integration precedent:
 *
 *   READER_RETENTION_INTEGRATION=1 READER_RETENTION_PORT=33069 READER_RETENTION_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import mysql from 'mysql2/promise'

const enabled = process.env.READER_RETENTION_INTEGRATION === '1'
const host = process.env.READER_RETENTION_HOST || '127.0.0.1'
const port = Number(process.env.READER_RETENTION_PORT || 3306)
const user = process.env.READER_RETENTION_USER || 'root'
const password = process.env.READER_RETENTION_PASSWORD || 'rootpassword'
const database = `cdkt_reader_retention_${Date.now()}_${process.pid}`

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_reader_retention_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

const DAY = 24 * 60 * 60 * 1000

test('reader accounts age by last_seen_at, cascade to comments and admin replies, and the cap evicts by recency', {
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
    const { readerAccounts, articleComments, articles, users, dataRetentionState } = await import('../server/db/schema')
    const { eq, sql } = await import('drizzle-orm')
    const { runDataRetention } = await import('../server/services/data-retention')

    const db = getDb()
    const NOW = new Date('2026-08-05T03:00:00.000Z')

    // One officer account, to author the administrator replies whose fate is the
    // point of assertion 3.
    await db.insert(users).values({
      username: 'canbo_integration',
      // The column is `passwordHash`, not `password`. Drizzle silently drops an
      // unknown key, so the wrong name here does not fail to compile — it sends
      // `password_hash` as DEFAULT, and the NOT NULL column rejects the insert.
      passwordHash: '$2b$10$integrationonlyplaceholderhashvalue000000000000000000',
      email: 'canbo@example.test',
      roleId: null,
      isActive: true,
    })
    const [officer] = await db.select({ id: users.id }).from(users).limit(1)

    const [inserted] = await db.insert(articles).values({
      type: 'news',
      title: 'Bài viết dùng cho kiểm thử lưu trữ',
      slug: `bai-viet-kiem-thu-${Date.now()}`,
      content: '<p>nội dung</p>',
      status: 'published',
      commentsEnabled: true,
    })
    const articleId = Number((inserted as unknown as { insertId?: number }).insertId ?? 0)
    assert.ok(articleId > 0, 'fixture article did not land')

    /**
     * `createdAt` is set the OPPOSITE way round from `lastSeenAt` on purpose: the
     * account that signed up longest ago is the one still active, and the newest
     * signup is the one that has gone idle. A purge ageing on `created_at` deletes
     * exactly the account that ageing on `last_seen_at` keeps, so assertion 1 can
     * tell correct from incorrect at all.
     */
    const seedReader = async (sub: string, lastSeenDaysAgo: number, createdDaysAgo: number) => {
      const [row] = await db.insert(readerAccounts).values({
        googleSub: sub,
        email: `${sub}@example.test`,
        displayName: `Người đọc ${sub}`,
        lastSeenAt: new Date(NOW.getTime() - lastSeenDaysAgo * DAY),
        createdAt: new Date(NOW.getTime() - createdDaysAgo * DAY),
        lastIp: '203.0.113.9',
        lastUserAgent: 'integration-probe',
      })
      return Number((row as unknown as { insertId?: number }).insertId ?? 0)
    }

    /** A citizen's question, plus one official reply underneath it. */
    const seedThread = async (readerId: number, label: string) => {
      const [question] = await db.insert(articleComments).values({
        articleId,
        readerId,
        body: `câu hỏi của ${label}`,
        createdAt: new Date(NOW.getTime() - DAY),
      })
      const questionId = Number((question as unknown as { insertId?: number }).insertId ?? 0)
      await db.insert(articleComments).values({
        articleId,
        readerId: null,
        adminUserId: officer!.id,
        parentId: questionId,
        body: `phản hồi của Ban quản trị cho ${label}`,
        createdAt: new Date(NOW.getTime() - DAY / 2),
      })
      return questionId
    }

    // ── The cascade and the ageing column ───────────────────────────────────
    // Idle 500 days, but only registered 400 days ago.
    const idle = await seedReader('sub-idle', 500, 400)
    // Registered 900 days ago — longer than anyone — but active yesterday. Ageing
    // on created_at would delete this reader; ageing on last_seen_at keeps them.
    const longStanding = await seedReader('sub-longstanding', 1, 900)

    await seedThread(idle, 'người đọc bỏ đi')
    await seedThread(longStanding, 'người đọc còn hoạt động')

    const before = await db.select({ total: sql<number>`COUNT(*)` }).from(articleComments)
    assert.equal(Number(before[0]!.total), 4, 'fixture comments did not land')

    const aged = await runDataRetention({
      now: NOW,
      activityLogDays: 0,
      submissionDays: 0,
      chatSessionDays: 0,
      readerAccountDays: 365,
      batchSize: 500,
      // Bookkeeping is gated on `trigger`, so a run without one banks nothing.
      trigger: 'manual',
    })
    assert.equal(aged.status, 'success', `the pass failed: ${aged.message ?? ''}`)

    const remaining = await db.select({ id: readerAccounts.id }).from(readerAccounts)
    assert.deepEqual(
      remaining.map(r => r.id),
      [longStanding],
      'the age purge must delete by last_seen_at — a long-registered but active reader has to survive',
    )

    // Assertion 3: the reader FK cascade removed their question, and the
    // parent_id self-cascade removed the portal's reply underneath it.
    const survivors = await db
      .select({ id: articleComments.id, readerId: articleComments.readerId, adminUserId: articleComments.adminUserId })
      .from(articleComments)
    assert.equal(survivors.length, 2, 'the cascade left comments or admin replies behind')
    assert.equal(
      survivors.filter(r => r.readerId === longStanding).length,
      1,
      'the surviving reader lost their comment',
    )
    assert.equal(
      survivors.filter(r => r.adminUserId !== null).length,
      1,
      'the administrator reply under a DELETED question survived, or the surviving one was removed',
    )

    const orphans = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(articleComments)
      .where(sql`reader_id IS NOT NULL AND reader_id NOT IN (SELECT id FROM reader_accounts)`)
    assert.equal(Number(orphans[0]!.total), 0, 'orphaned comment rows exist')

    // `article_comments` must not be reported as a purged table: it is not a
    // retention target, and listing it would invite a future window on it.
    assert.deepEqual(
      aged.tables.map(t => t.table),
      ['activity_logs', 'submissions', 'chat_sessions', 'reader_accounts'],
      'article_comments must not be a retention target — the cascades own it',
    )

    // Deleting a reader must NOT remove the officer's account, and must not remove
    // an official reply that sits on a surviving question.
    const officersLeft = await db.select({ id: users.id }).from(users)
    assert.equal(officersLeft.length, 1, 'the cascade reached the users table')

    // ── The row cap ─────────────────────────────────────────────────────────
    await db.delete(articleComments)
    await db.delete(readerAccounts)

    /**
     * Five accounts inserted oldest-signup-first, so `id` ascends a→e while
     * recency descends: `cap-a` has the LOWEST id and the MOST RECENT visit. A cap
     * ordering by id keeps a and b (the two earliest signups); a cap ordering by
     * last_seen_at keeps a and b as well — so the ids are deliberately reversed
     * below to break that coincidence.
     */
    const capIds = {
      // Lowest id, longest idle → must be evicted by a correct cap.
      stalest: await seedReader('cap-1', 50, 50),
      fourth:  await seedReader('cap-2', 40, 40),
      third:   await seedReader('cap-3', 30, 30),
      second:  await seedReader('cap-4', 20, 20),
      // Highest id, most recent visit → must be kept.
      newest:  await seedReader('cap-5', 1, 10),
    }

    const capped = await runDataRetention({
      now: NOW,
      activityLogDays: 0,
      submissionDays: 0,
      chatSessionDays: 0,
      readerAccountDays: 0,
      readerAccountMaxRows: 2,
      batchSize: 500,
      trigger: 'manual',
    })
    assert.equal(capped.status, 'success', `the cap pass failed: ${capped.message ?? ''}`)

    const kept = await db.select({ id: readerAccounts.id }).from(readerAccounts)
    assert.equal(kept.length, 2, 'the cap deleted the wrong number of rows')
    // Assertion 2: ordering by id would have kept `cap-1` and `cap-2` — the two
    // longest-idle accounts — and deleted the three most recently active.
    assert.deepEqual(
      kept.map(r => r.id).sort((a, b) => a - b),
      [capIds.second, capIds.newest].sort((a, b) => a - b),
      'the row cap must evict by last_seen_at, not by the AUTO_INCREMENT primary key',
    )
    assert.ok(!kept.some(r => r.id === capIds.stalest), 'the cap kept the stalest account')

    const capReport = capped.tables.find(t => t.table === 'reader_accounts')!
    assert.equal(capReport.deletedByRowCap, 3)
    assert.equal(capReport.deletedByAge, 0, 'the age window was disabled for this pass')

    // ── Bookkeeping ─────────────────────────────────────────────────────────
    // The banked counter is the only evidence a purge ran, since the rows it
    // counted are gone.
    const banked = await db
      .select({ scope: dataRetentionState.scope, purgedTotal: dataRetentionState.purgedTotal })
      .from(dataRetentionState)
    const names = banked.map(r => r.scope)
    assert.ok(names.includes('reader_accounts'), 'the reader scope was never banked')
    assert.ok(!names.includes('article_comments'), 'article_comments must not have a bookkeeping row')
    const readerRow = banked.find(r => r.scope === 'reader_accounts')!
    // 1 from the age pass + 3 from the cap pass, accumulated across both runs.
    assert.equal(Number(readerRow.purgedTotal), 4, 'purged_total must accumulate, not overwrite')

    // A disabled window must issue no delete at all — the shipped default for a
    // fresh deployment before anyone configures anything.
    const disabled = await runDataRetention({
      now: NOW,
      activityLogDays: 0,
      submissionDays: 0,
      chatSessionDays: 0,
      readerAccountDays: 0,
      trigger: 'manual',
    })
    assert.equal(disabled.status, 'success')
    const stillThere = await db.select({ total: sql<number>`COUNT(*)` }).from(readerAccounts)
    assert.equal(Number(stillThere[0]!.total), 2, 'a disabled window still deleted rows')

    // Deleting the ARTICLE removes its comments too (the other cascade on that
    // table) without touching the reader accounts.
    await db.delete(articles).where(eq(articles.id, articleId))
    const afterArticle = await db.select({ total: sql<number>`COUNT(*)` }).from(articleComments)
    assert.equal(Number(afterArticle[0]!.total), 0, 'deleting an article left its comments behind')
    const readersAfterArticle = await db.select({ total: sql<number>`COUNT(*)` }).from(readerAccounts)
    assert.equal(Number(readersAfterArticle[0]!.total), 2, 'deleting an article removed reader accounts')
  } finally {
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
