/**
 * Livestream stop race, chạy trên MySQL thật.
 *
 * `livestream-toggle.test.ts` kiểm logic bằng fake pool (text log), và
 * `reader-audit-atomicity.test.ts` soi văn bản mã nguồn để đòi `db.transaction(`.
 * Cả hai đều **mù về cấu trúc** với điều thật sự dựa vào driver:
 *
 *   1. **Hai lượt dừng cùng lúc: chỉ MỘT lượt thắng.** `is_active = 1` nằm TRONG
 *      câu UPDATE, nên lượt thứ hai (sau lượt đầu commit) thấy `is_active = 0`
 *      và affect 0 hàng. Một fake pool trả về con số nó được nạp sẵn, bất kể
 *      mệnh đề WHERE — nên nó không phân biệt được "điều kiện trong UPDATE
 *      thật sự chặn" với "service chỉ check `affectedRows`". Chỉ driver thật
 *      phản đối: hai lượt đua thật trên một hàng thật thì đúng một lượt đổi.
 *   2. **`affectedRows` phân biệt 404 với 409.** Lượt dừng một phiên không tồn
 *      tại phải là 404; lượt dừng phiên đã dừng phải là 409. Cả hai đều `0` hàng
 *      đổi, nhưng lượt đọc phân giải sau đó phải chạy đúng. Một fake pool không
 *      kiểm được rằng `affectedRows` từ driver thật khớp với trạng thái hàng.
 *   3. **Cặp mutation + audit commit CÙNG NHAU.** Ép dòng audit hỏng bằng một
 *      `actorId` không tồn tại (FK sang `users`) rồi đòi trạng thái **không
 *      đổi** — `is_active` vẫn `1`. Lượt này throw (transaction reject), nên
 *      test bắt bằng `assert.rejects` rồi đòi rollback đã để hàng nguyên. Soi
 *      mã nguồn thấy `db.transaction(`; nó không chứng minh rollback thật sự
 *      xảy ra.
 *
 * Có cổng riêng và tự dọn, theo đúng tiền lệ `*-integration`:
 *
 *   LIVESTREAM_TOGGLE_INTEGRATION=1 LIVESTREAM_TOGGLE_PORT=33069 \
 *   LIVESTREAM_TOGGLE_USER=root LIVESTREAM_TOGGLE_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const enabled = process.env.LIVESTREAM_TOGGLE_INTEGRATION === '1'
const host = process.env.LIVESTREAM_TOGGLE_HOST || '127.0.0.1'
const port = Number(process.env.LIVESTREAM_TOGGLE_PORT || 3306)
const user = process.env.LIVESTREAM_TOGGLE_USER || 'root'
const password = process.env.LIVESTREAM_TOGGLE_PASSWORD || 'rootpassword'
const database = `cdkt_livestream_toggle_${Date.now()}_${process.pid}`

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_livestream_toggle_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

test('livestream stop race: one winner, 404 vs 409, audit atomicity', {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  assertDisposableDatabase(database)

  const mysql = await import('mysql2/promise')
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
    const { livestreamSessions, activityLogs, users } = await import('../server/db/schema')
    const { eq } = await import('drizzle-orm')
    const { stopLivestream } = await import('../server/services/livestream')

    const db = getDb()

    // ── Fixtures ──
    await db.insert(users).values({
      username: 'canbo_livestream',
      passwordHash: '$2b$10$integrationonlyplaceholderhashvalue000000000000000000',
      email: 'canbo.livestream@example.test',
      isActive: true,
    })
    const [officer] = await db.select({ id: users.id }).from(users).limit(1)
    assert.ok(officer, 'fixture officer did not land')

    const seedActiveSession = async (title: string) => {
      const [row] = await db.insert(livestreamSessions).values({
        title,
        source: 'youtube',
        isActive: true,
        startedAt: new Date(),
        createdBy: officer.id,
      })
      const id = Number(row.insertId ?? 0)
      assert.ok(id > 0, 'fixture session did not land')
      return id
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Hai lượt dừng cùng lúc: chỉ MỘT lượt thắng.
    // ─────────────────────────────────────────────────────────────────────────
    const sessionId = await seedActiveSession('Buổi đua dừng')
    const first = await stopLivestream({ sessionId, actorId: officer.id }, { db })
    const second = await stopLivestream({ sessionId, actorId: officer.id }, { db })

    assert.equal(first.ok, true, 'lượt đầu phải thắng')
    assert.equal(second.ok, false, 'lượt sau phải thua')
    assert.equal(second.ok === false && second.statusCode, 409, 'lượt sau là 409 — đã dừng rồi, không phải 404')

    // Đúng MỘT dòng audit — lượt thua không ghi.
    const auditRows = await db.select().from(activityLogs).where(eq(activityLogs.resourceId, sessionId))
    assert.equal(auditRows.length, 1, 'chỉ lượt thắng ghi audit')
    assert.equal(auditRows[0]!.action, 'update')
    assert.equal(auditRows[0]!.resource, 'livestream')

    // Trạng thái hàng: đã dừng.
    const [stopped] = await db
      .select({ isActive: livestreamSessions.isActive, endedAt: livestreamSessions.endedAt })
      .from(livestreamSessions)
      .where(eq(livestreamSessions.id, sessionId))
    assert.equal(stopped?.isActive, false, 'is_active phải là false sau khi dừng')
    assert.ok(stopped?.endedAt, 'endedAt phải được đóng dấu')

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Dừng một phiên không tồn tại là 404, không phải 409.
    // ─────────────────────────────────────────────────────────────────────────
    const missing = await stopLivestream({ sessionId: 999_999, actorId: officer.id }, { db })
    assert.equal(missing.ok, false)
    assert.equal(missing.ok === false && missing.statusCode, 404)

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Cặp mutation + audit commit CÙNG NHAU.
    // Ép dòng audit hỏng bằng `actorId` không tồn tại (FK sang `users`). Nếu
    // transaction rollback, `is_active` phải vẫn `true` — chưa dừng.
    // ─────────────────────────────────────────────────────────────────────────
    const racingId = await seedActiveSession('Buổi audit hỏng')
    // Lượt này **throw** (transaction reject vì FK `activity_logs.user_id → users.id`
    // không tồn tại), không trả `{ ok: false }` — `db.transaction` không bọc
    // try/catch quanh FK error. Test bắt bằng `assert.rejects`, rồi đòi rollback
    // đã để `is_active` nguyên.
    await assert.rejects(
      stopLivestream({ sessionId: racingId, actorId: 999_999 }, { db }),
      (err: unknown) => {
        const msg = err instanceof Error ? `${err.message} ${(err as Error & { cause?: Error }).cause?.message ?? ''}` : String(err)
        return /foreign key constraint/i.test(msg)
      },
      'lượt có audit FK hỏng phải throw — transaction rollback',
    )

    const [stillActive] = await db
      .select({ isActive: livestreamSessions.isActive })
      .from(livestreamSessions)
      .where(eq(livestreamSessions.id, racingId))
    assert.equal(stillActive?.isActive, true, 'rollback phải để is_active nguyên — chưa dừng')

    // Không có dòng audit nào cho lượt hỏng.
    const brokenAudit = await db.select().from(activityLogs).where(eq(activityLogs.resourceId, racingId))
    assert.equal(brokenAudit.length, 0, 'lượt rollback không được ghi audit')
  } finally {
    // Đóng pool của `getDb()` TRƯỚC khi DROP — pool giữ kết nối sống, mà một kết
    // nối sống là một handle giữ tiến trình Node mở. Thiếu dòng này thì suite
    // chạy xong, mọi khẳng định xanh, rồi treo mãi mãi. Lệnh DROP cũng bị chặn
    // nếu còn kết nối mở trên chính database đó. Tiền lệ: submission-workflow.
    const { getPool } = await import('../server/utils/db')
    await getPool()?.end()

    Object.assign(process.env, previous)

    const mysql = await import('mysql2/promise')
    const cleanup = await mysql.createConnection({ host, port, user, password })
    await cleanup.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await cleanup.end()
  }
})
