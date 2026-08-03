/**
 * Chat-history retention, driven against a real MySQL.
 *
 * `data-retention.test.ts` drives a fake pool, so it can pin the SQL text but is
 * structurally blind to the three failures that actually shipped in this feature:
 *
 *   1. `purgeOlderThan` hardcoded `created_at`. `chat_sessions` has no such
 *      column, so with the 90-day default the age branch ran on every pass and
 *      threw ER_BAD_FIELD_ERROR. The try/catch wraps the whole loop, so the
 *      ENTIRE pass returned `failed` — the rate-limit sweep never ran,
 *      bookkeeping never recorded, and `last_run_at` never advanced, which meant
 *      the 15-minute scheduler retried forever. A fake pool answers any column
 *      name, so it cannot see this.
 *   2. `purgeBeyondRowCap` ordered by `id`. That column is a UUID here, so
 *      "oldest first" became lexicographic and the cap evicted an arbitrary set
 *      of conversations. A fake pool returns whatever affectedRows it was
 *      queued with regardless of ORDER BY, so it cannot see this either.
 *   3. `chat_messages` was registered as its own retention target. Deleting
 *      messages on an independent window leaves a session row advertising N
 *      messages with none behind it, and a message row cap truncates a
 *      transcript mid-thread. The fix removes it as a target and leans on the
 *      FK cascade — an assumption only a real database can confirm.
 *
 * Gated and self-cleaning, following the *-ddl-integration precedent:
 *
 *   CHAT_RETENTION_INTEGRATION=1 CHAT_RETENTION_PORT=33069 CHAT_RETENTION_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import mysql from 'mysql2/promise'

const enabled = process.env.CHAT_RETENTION_INTEGRATION === '1'
const host = process.env.CHAT_RETENTION_HOST || '127.0.0.1'
const port = Number(process.env.CHAT_RETENTION_PORT || 3306)
const user = process.env.CHAT_RETENTION_USER || 'root'
const password = process.env.CHAT_RETENTION_PASSWORD || 'rootpassword'
const database = `cdkt_chat_retention_${Date.now()}_${process.pid}`

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_chat_retention_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

const DAY = 24 * 60 * 60 * 1000

test('chat history is purged by last_message_at, cascades to messages, and the cap evicts chronologically', {
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
    const { chatSessions, chatMessages, dataRetentionState } = await import('../server/db/schema')
    const { sql } = await import('drizzle-orm')
    const { runDataRetention } = await import('../server/services/data-retention')

    const db = getDb()
    const NOW = new Date('2026-08-02T03:00:00.000Z')

    /**
     * UUIDs chosen so that lexicographic order is the exact REVERSE of
     * chronological order. `aaaa…` is the newest conversation and `ffff…` the
     * oldest, so a purge that orders by `id` deletes precisely the rows a purge
     * ordering by `last_message_at` would keep. This is what makes the row-cap
     * assertion below able to tell correct from incorrect at all.
     */
    const seed = async (idPrefix: string, lastMessageDaysAgo: number, startedDaysAgo: number, messages: number) => {
      const id = `${idPrefix.repeat(8)}-0000-4000-8000-000000000000`
      const lastMessageAt = new Date(NOW.getTime() - lastMessageDaysAgo * DAY)
      await db.insert(chatSessions).values({
        id,
        ip: '203.0.113.7',
        userAgent: 'integration-probe',
        detectedPhone: '0903480985',
        messageCount: messages,
        startedAt: new Date(NOW.getTime() - startedDaysAgo * DAY),
        lastMessageAt,
      })
      for (let i = 0; i < messages; i += 1) {
        await db.insert(chatMessages).values({
          sessionId: id,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `tin nhắn ${i} của phiên ${idPrefix}`,
          kind: i % 2 === 0 ? null : 'knowledge',
          createdAt: lastMessageAt,
        })
      }
      return id
    }

    // ── The cascade ─────────────────────────────────────────────────────────
    // 200 days idle: comfortably past any window used below.
    await seed('f', 200, 400, 3)
    // Opened 300 days ago but still being replied to yesterday. Aging on
    // `started_at` would delete this live conversation; aging on
    // `last_message_at` keeps it. That difference is the whole point of the
    // per-table column map.
    const longRunning = await seed('a', 1, 300, 4)

    const beforeMessages = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(chatMessages)
    assert.equal(Number(beforeMessages[0]!.total), 7, 'fixture did not land')

    const aged = await runDataRetention({
      now: NOW,
      activityLogDays: 0,
      submissionDays: 0,
      chatSessionDays: 90,
      batchSize: 500,
      // Bookkeeping is deliberately gated on `trigger`, so a run without one
      // banks nothing. The counters are part of what this test proves.
      trigger: 'manual',
    })

    // Bug 1: this returned `failed` for every deployment with the default
    // 90-day window, because the statement named a column the table lacks.
    assert.equal(aged.status, 'success', `the pass failed: ${aged.message ?? ''}`)

    const sessionsLeft = await db.select({ id: chatSessions.id }).from(chatSessions)
    assert.deepEqual(
      sessionsLeft.map(r => r.id),
      [longRunning],
      'the age purge must delete by last_message_at, keeping a still-active conversation opened long ago',
    )

    // Bug 3: the cascade is what makes a message window unnecessary. If the FK
    // were not ON DELETE CASCADE, the three messages of the deleted session
    // would still be here, orphaned.
    const survivingMessages = await db.select({ sessionId: chatMessages.sessionId }).from(chatMessages)
    assert.equal(survivingMessages.length, 4, 'the deleted session left its messages orphaned')
    assert.ok(
      survivingMessages.every(m => m.sessionId === longRunning),
      'a message survived whose session is gone',
    )

    const orphans = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(chatMessages)
      .where(sql`session_id NOT IN (SELECT id FROM chat_sessions)`)
    assert.equal(Number(orphans[0]!.total), 0, 'orphaned transcript rows exist')

    // `chat_messages` must not be reported as a purged table: it is not a
    // retention target, and listing it would invite a future window on it.
    assert.deepEqual(
      aged.tables.map(t => t.table),
      ['activity_logs', 'submissions', 'chat_sessions'],
      'chat_messages must not be a retention target — the cascade owns it',
    )

    // ── The row cap ─────────────────────────────────────────────────────────
    await db.delete(chatSessions)

    // Five conversations, one day apart. IDs run a→e while recency runs e→a, so
    // ordering by `id` and ordering by `last_message_at` disagree on every row.
    const capIds = {
      newest: await seed('a', 1, 1, 1),
      second: await seed('b', 2, 2, 1),
      third: await seed('c', 3, 3, 1),
      fourth: await seed('d', 4, 4, 1),
      oldest: await seed('e', 5, 5, 1),
    }

    const capped = await runDataRetention({
      now: NOW,
      activityLogDays: 0,
      submissionDays: 0,
      chatSessionDays: 0,
      chatSessionMaxRows: 2,
      batchSize: 500,
      trigger: 'manual',
    })
    assert.equal(capped.status, 'success', `the cap pass failed: ${capped.message ?? ''}`)

    const kept = await db
      .select({ id: chatSessions.id, lastMessageAt: chatSessions.lastMessageAt })
      .from(chatSessions)
      .orderBy(chatSessions.lastMessageAt)

    assert.equal(kept.length, 2, 'the cap deleted the wrong number of rows')
    // Bug 2: ordering by the UUID would have kept `d` and `e` — the two OLDEST
    // conversations — and deleted the three most recent.
    assert.deepEqual(
      kept.map(r => r.id).sort(),
      [capIds.newest, capIds.second].sort(),
      'the row cap must evict by last_message_at, not by the UUID primary key',
    )

    const capReport = capped.tables.find(t => t.table === 'chat_sessions')!
    assert.equal(capReport.deletedByRowCap, 3)
    assert.equal(capReport.deletedByAge, 0, 'the age window was disabled for this pass')

    // Cascade again, this time under the cap rather than the age window.
    const afterCap = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(chatMessages)
    assert.equal(Number(afterCap[0]!.total), 2, 'the cap left messages behind')

    // ── Bookkeeping ─────────────────────────────────────────────────────────
    // The banked counter is the only evidence a purge ran, since the rows it
    // counted are gone. It has to name the session scope and no message scope.
    const banked = await db
      .select({ scope: dataRetentionState.scope, purgedTotal: dataRetentionState.purgedTotal })
      .from(dataRetentionState)
      .orderBy(dataRetentionState.scope)
    const names = banked.map(r => r.scope)
    assert.ok(names.includes('chat_sessions'), 'the chat scope was never banked')
    assert.ok(!names.includes('chat_messages'), 'chat_messages must not have a bookkeeping row')
    const chatRow = banked.find(r => r.scope === 'chat_sessions')!
    // 1 from the age pass + 3 from the cap pass, accumulated across both runs.
    assert.equal(Number(chatRow.purgedTotal), 4, 'purged_total must accumulate, not overwrite')

    // The pool is closed in `finally`, once. Ending it here too would leave the
    // finally block calling `.end()` on an already-closed pool.
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
