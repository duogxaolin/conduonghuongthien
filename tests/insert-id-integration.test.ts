/**
 * `db.insert(...)` resolves to an ARRAY, and reading `.insertId` off that array
 * gives `undefined` — silently.
 *
 * This suite exists because of a bug reported from production: the FIRST reader
 * sign-in showed "có lỗi xảy ra, không thể hoàn tất đăng nhập", and the second
 * one succeeded. Both facts came from the same line:
 *
 *     readerId = Number((inserted as unknown as { insertId?: number }).insertId ?? 0)
 *
 * `inserted` is `[ResultSetHeader, FieldPacket[]]`, so `.insertId` on it is
 * `undefined`, `?? 0` turns that into `0`, and the `if (!readerId)` guard below it
 * redirected to `failed` — *after the row had already been committed*. The second
 * attempt then found that row, took the `existing` branch (which never reads
 * insertId), and worked. A reader who tried twice saw a portal that "just needed
 * another go"; a reader who tried once concluded sign-in was broken.
 *
 * Why a real database is the only thing that could have caught this:
 *
 *   - **The compiler could not.** `as unknown as { insertId?: number }` asserts
 *     the shape rather than checking it, so the wrong read typechecked. That cast
 *     is the whole reason the mistake was invisible — and it appeared in exactly
 *     the two places written for this change (`callback.get.ts`, `ip-bans.ts`),
 *     while the ten older insert sites all destructure (`const [res] = ...`).
 *   - **A fake pool could not.** A stub returns whatever shape it was authored
 *     with. If the author believed `.insertId` sat on the result, the fake would
 *     confirm that belief. Only the real driver disagrees.
 *   - **A source-text test could not.** It can pin the characters of a read, not
 *     what the value turns out to be at runtime.
 *
 * The assertions below are therefore about the DRIVER's contract, not about our
 * wrappers: what `db.insert()` actually resolves to, plainly and in a transaction.
 *
 * Gated and self-cleaning, following the *-integration precedent:
 *
 *   INSERT_ID_INTEGRATION=1 INSERT_ID_PORT=33069 INSERT_ID_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import mysql from 'mysql2/promise'

const enabled = process.env.INSERT_ID_INTEGRATION === '1'
const host = process.env.INSERT_ID_HOST || '127.0.0.1'
const port = Number(process.env.INSERT_ID_PORT || 3306)
const user = process.env.INSERT_ID_USER || 'root'
const password = process.env.INSERT_ID_PASSWORD || 'rootpassword'
const database = `cdkt_insert_id_${Date.now()}_${process.pid}`

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_insert_id_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

test('a new reader account yields a usable id on the FIRST insert', {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  assertDisposableDatabase(database)

  const admin = await mysql.createConnection({ host, port, user, password })
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`)
  await admin.end()

  const previous = { ...process.env }
  Object.assign(process.env, {
    DB_HOST: host, DB_PORT: String(port), DB_USER: user,
    DB_PASSWORD: password, DB_NAME: database,
  })

  try {
    const { initDb } = await import('../server/db/init')
    await initDb()

    const { getDb } = await import('../server/utils/db')
    const { readerAccounts, readerIpBans, activityLogs, users } = await import('../server/db/schema')
    const { eq } = await import('drizzle-orm')

    const db = getDb()

    // ── The driver's actual contract ────────────────────────────────────────
    const inserted = await db.insert(readerAccounts).values({
      googleSub: 'sub-first-signin',
      email: 'nguoidoc@example.test',
      displayName: 'Người đọc mới',
      lastSeenAt: new Date(),
    })

    assert.ok(Array.isArray(inserted), 'db.insert() resolves to an array — this is the whole bug')
    assert.equal(
      (inserted as unknown as { insertId?: number }).insertId,
      undefined,
      'reading .insertId off the array must stay undefined; if this ever becomes a number, '
      + 'the guard rails below are no longer needed and this suite should be revisited',
    )

    const [header] = inserted
    const readerId = Number(header?.insertId ?? 0)
    assert.ok(readerId > 0, 'the destructured header must carry a real auto-increment id')

    // The row is present either way — that is precisely why the bug looked like a
    // transient error rather than a failure: the second attempt found this row.
    const [row] = await db
      .select({ id: readerAccounts.id, sub: readerAccounts.googleSub })
      .from(readerAccounts)
      .where(eq(readerAccounts.googleSub, 'sub-first-signin'))
      .limit(1)
    assert.ok(row, 'the account was not written at all')
    assert.equal(row.id, readerId, 'the id handed to the session ticket is not the row that was written')

    // ── The same read inside a transaction (the ip-bans shape) ──────────────
    // `ip-bans.ts` reads insertId inside db.transaction() and feeds it to the
    // audit row's resourceId. Read the wrong way it banked `resourceId: 0`: a ban
    // in force whose audit entry points at no row — the exact outcome that
    // wrapping the two writes in a transaction was meant to prevent.
    const [officer] = await db.insert(users).values({
      username: 'canbo_insertid',
      passwordHash: '$2b$10$integrationonlyplaceholderhashvalue000000000000000000',
      email: 'canbo.insertid@example.test',
      isActive: true,
    })
    const officerId = Number(officer?.insertId ?? 0)
    assert.ok(officerId > 0)

    let banId = 0
    await db.transaction(async (tx) => {
      const insertedBan = await tx.insert(readerIpBans).values({
        value: '203.0.113.77',
        reason: 'kiểm thử insertId trong transaction',
        createdBy: officerId,
      })
      assert.ok(Array.isArray(insertedBan), 'tx.insert() is an array too — same trap, same fix')
      assert.equal(
        (insertedBan as unknown as { insertId?: number }).insertId,
        undefined,
        'the undestructured read is undefined inside a transaction as well',
      )

      const [banHeader] = insertedBan
      banId = Number(banHeader?.insertId ?? 0)

      await tx.insert(activityLogs).values({
        userId: officerId,
        action: 'create',
        resource: 'reader_ip_bans',
        resourceId: banId,
        meta: { value: '203.0.113.77' },
      })
    })

    assert.ok(banId > 0, 'the ban id must be real, or its audit row points at nothing')
    const [logRow] = await db
      .select({ resourceId: activityLogs.resourceId })
      .from(activityLogs)
      .where(eq(activityLogs.resource, 'reader_ip_bans'))
      .limit(1)
    assert.ok(logRow, 'no audit row was written')
    assert.notEqual(logRow.resourceId, 0, 'the audit row points at row 0 — the ban cannot be traced')
    assert.equal(logRow.resourceId, banId, 'the audit row must name the ban it records')

    /**
     * ── The sibling shape: db.delete() and .affectedRows ────────────────────
     *
     * This suite was written for `insertId` and stopped there, so the identical
     * mistake on the delete side went on living: `bulk-delete.post.ts` read
     * `(result as unknown as { affectedRows?: number }).affectedRows` off the
     * array, always got `undefined`, and reported `deleted: 0` while removing
     * real conversations — and wrote that zero into `activity_logs`, so the only
     * record of a destructive action claimed nothing had been destroyed.
     *
     * The same three reasons apply: the cast satisfied the compiler, a fake pool
     * would have confirmed whatever shape its author believed in, and a
     * source-text test can pin the characters but not the value. Only the driver
     * objects — so the driver is asked here, about deletes as well as inserts.
     */
    const [banB] = await db.insert(readerIpBans).values({
      value: '203.0.113.78', reason: 'xoá thử', createdBy: officerId,
    })
    const [banC] = await db.insert(readerIpBans).values({
      value: '203.0.113.79', reason: 'xoá thử', createdBy: officerId,
    })
    const doomed = [Number(banB?.insertId ?? 0), Number(banC?.insertId ?? 0)]
    assert.ok(doomed.every(id => id > 0))

    const { inArray } = await import('drizzle-orm')
    const removed = await db.delete(readerIpBans).where(inArray(readerIpBans.id, doomed))

    assert.ok(Array.isArray(removed), 'db.delete() resolves to an array too')
    assert.equal(
      (removed as unknown as { affectedRows?: number }).affectedRows,
      undefined,
      'reading .affectedRows off the array must stay undefined — this is the bulk-delete bug',
    )

    const [deleteHeader] = removed
    assert.equal(
      Number(deleteHeader?.affectedRows ?? 0),
      2,
      'the destructured header must report the rows actually removed; reporting 0 while rows '
      + 'disappear is a destructive action whose audit trail denies it happened',
    )

    const survivors = await db
      .select({ id: readerIpBans.id })
      .from(readerIpBans)
      .where(inArray(readerIpBans.id, doomed))
    assert.equal(survivors.length, 0, 'the rows were reported gone but are still present')
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
