/**
 * Vòng đời xử lý đơn đăng ký, chạy trên MySQL thật.
 *
 * `submission-status.test.ts` kiểm sổ trạng thái bằng hàm thuần và
 * `reader-audit-atomicity.test.ts` soi văn bản mã nguồn để đòi có `db.transaction(`.
 * Cả hai đều **mù về cấu trúc** với năm điều thay đổi này thật sự dựa vào:
 *
 *   1. **`firstView` do `affectedRows` quyết định.** Điều kiện `first_viewed_at IS
 *      NULL` nằm TRONG câu UPDATE, và câu trả lời "mình có phải người đầu tiên
 *      không" là con số hàng bị đổi. Một fake pool trả về đúng con số nó được nạp
 *      sẵn, bất kể mệnh đề WHERE — nên nó không phân biệt được một phép đọc đúng
 *      với một phép đọc trên giá trị **chưa destructure** (dự án này đã trả giá sáu
 *      lần cho đúng lớp lỗi đó, và mỗi lần triệu chứng là một con số `0` trông hợp
 *      lý). Chỉ driver thật phản đối.
 *   2. **Hai cán bộ mở cùng một hồ sơ thì chỉ MỘT người là người đầu.** Đây là lý
 *      do phép kiểm không nằm ở một lượt SELECT trước đó. Không có CSDL thật thì
 *      không có gì để đua.
 *   3. **Cặp mutation + audit commit CÙNG NHAU.** Soi mã nguồn thấy được chữ
 *      `db.transaction(`; nó **không** chứng minh được rằng một lượt audit lỗi sẽ
 *      kéo trạng thái về. Ở đây ta ép dòng audit hỏng bằng một `userId` không tồn
 *      tại (FK sang `users`) rồi đòi trạng thái **không đổi**.
 *   4. **`submission_events` CASCADE theo đơn, và `actor_id` SET NULL theo cán bộ.**
 *      Đây là khẳng định về khoá ngoại. Nếu một FK bị viết thiếu luật xoá thì hàng
 *      chỉ đơn giản là nằm lại — mồ côi — và **mọi** test đơn vị vẫn xanh.
 *   5. **DATETIME đi qua CSDL rồi về không lệch múi giờ.** `status_changed_at` và
 *      `created_at` là DATETIME (kiểu **không mang múi giờ**), và hai nửa của
 *      Drizzle chỉ nghịch đảo nhau theo cặp. Cùng cái bẫy đã làm lịch cộng dần
 *      lượt xem âm thầm thoái hoá thành cộng ngay (xem `view-boost-integration`).
 *
 * Có cổng riêng và tự dọn, theo đúng tiền lệ `*-integration`:
 *
 *   SUBMISSION_WORKFLOW_INTEGRATION=1 SUBMISSION_WORKFLOW_PORT=33069 \
 *   SUBMISSION_WORKFLOW_USER=root SUBMISSION_WORKFLOW_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import mysql from 'mysql2/promise'

const enabled = process.env.SUBMISSION_WORKFLOW_INTEGRATION === '1'
const host = process.env.SUBMISSION_WORKFLOW_HOST || '127.0.0.1'
const port = Number(process.env.SUBMISSION_WORKFLOW_PORT || 3306)
const user = process.env.SUBMISSION_WORKFLOW_USER || 'root'
const password = process.env.SUBMISSION_WORKFLOW_PASSWORD || 'rootpassword'
const database = `cdkt_submission_workflow_${Date.now()}_${process.pid}`

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_submission_workflow_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

test('submission workflow: first-view race, audit atomicity, cascades, and DATETIME symmetry', {
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
    const { activityLogs, submissionEvents, submissions, users } = await import('../server/db/schema')
    const { and, eq } = await import('drizzle-orm')
    const {
      addSubmissionNote,
      changeSubmissionStatus,
      countSubmissionsByStatus,
      listSubmissionEvents,
      logSubmissionContact,
      recordSubmissionView,
    } = await import('../server/services/submission-workflow')

    const db = getDb()

    // ── Fixtures ──
    // The column is `passwordHash`, not `password`: Drizzle silently drops an
    // unknown key, so the wrong name sends `password_hash` as DEFAULT and the
    // NOT NULL column rejects the insert.
    await db.insert(users).values({
      username: 'canbo_workflow',
      passwordHash: '$2b$10$integrationonlyplaceholderhashvalue000000000000000000',
      email: 'canbo.workflow@example.test',
      isActive: true,
    })
    const [officer] = await db.select({ id: users.id }).from(users).limit(1)
    assert.ok(officer, 'fixture officer did not land')

    /**
     * An actor carrying every permission. `requireResourcePermission` reads the
     * permission matrix off the actor, so the workflow can be driven without
     * standing up roles — the RBAC rules themselves are pinned elsewhere.
     */
    const actor = {
      id: officer.id,
      username: 'canbo_workflow',
      isSuperAdmin: true,
      permissions: { submissions: { read: true, update: true, delete: true, create: true } },
    } as unknown as Parameters<typeof recordSubmissionView>[0]

    const seedSubmission = async (name: string) => {
      const [row] = await db.insert(submissions).values({
        fullName: name,
        phone: '0903480985',
        message: 'Xin hỗ trợ vay vốn sau khi chấp hành xong án phạt tù.',
      })
      const id = Number(row.insertId ?? 0)
      assert.ok(id > 0, 'fixture submission did not land')
      return id
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Every new submission starts at `new`, unseen, unnotified.
    // ─────────────────────────────────────────────────────────────────────────
    const first = await seedSubmission('Nguyễn Văn A')
    {
      const [row] = await db
        .select({
          status: submissions.status,
          firstViewedAt: submissions.firstViewedAt,
          notifiedAt: submissions.notifiedAt,
        })
        .from(submissions)
        .where(eq(submissions.id, first))
        .limit(1)
      assert.equal(row!.status, 'new', 'a fresh submission must default to `new`')
      assert.equal(row!.firstViewedAt, null)
      assert.equal(row!.notifiedAt, null, 'nothing has been mailed yet')
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. affectedRows decides `firstView`, and F5 does not re-decide it.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const opened = await recordSubmissionView(actor, first)
      assert.equal(opened.firstView, true, 'the first open must report firstView')

      const again = await recordSubmissionView(actor, first)
      assert.equal(again.firstView, false, 'reloading must NOT report a second first view')

      // Exactly one timeline entry, no matter how many times it was opened —
      // a "viewed" row per F5 would drown the entries that carry content.
      const events = await listSubmissionEvents(first)
      const views = events.filter((e) => e.eventType === 'view')
      assert.equal(views.length, 1, `expected 1 view entry, got ${views.length}`)
      assert.equal(views[0]!.actorName, 'canbo_workflow')

      // Both opens audit, though: reading a citizen's contact record is the thing
      // the audit log exists to record, and only the first is a state change.
      const reads = await db
        .select({ id: activityLogs.id })
        .from(activityLogs)
        .where(and(eq(activityLogs.resource, 'submissions'), eq(activityLogs.action, 'read')))
      assert.equal(reads.length, 2, 'every view must audit, not just the first')
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Two officers opening at once: only one is the first.
    //    This is why the NULL check lives inside the UPDATE.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const raced = await seedSubmission('Trần Thị B')
      const results = await Promise.all([
        recordSubmissionView(actor, raced),
        recordSubmissionView(actor, raced),
        recordSubmissionView(actor, raced),
      ])
      const firsts = results.filter((r) => r.firstView).length
      assert.equal(firsts, 1, `exactly one concurrent open may be the first, got ${firsts}`)

      const views = (await listSubmissionEvents(raced)).filter((e) => e.eventType === 'view')
      assert.equal(views.length, 1, 'the race must not write two "viewed" entries')
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Status changes, with the transition rules enforced by the server.
    // ─────────────────────────────────────────────────────────────────────────
    {
      await changeSubmissionStatus(actor, first, { status: 'in_progress', note: 'Đã tiếp nhận' })

      const [row] = await db
        .select({
          status: submissions.status,
          statusChangedBy: submissions.statusChangedBy,
          statusChangedAt: submissions.statusChangedAt,
        })
        .from(submissions)
        .where(eq(submissions.id, first))
        .limit(1)
      assert.equal(row!.status, 'in_progress')
      assert.equal(row!.statusChangedBy, officer.id)
      assert.ok(row!.statusChangedAt instanceof Date, 'status_changed_at must come back as a Date')

      // Re-asserting the same status is refused: it changes nothing yet would add
      // a timeline entry, and a timeline full of no-ops is one nobody reads.
      await assert.rejects(
        () => changeSubmissionStatus(actor, first, { status: 'in_progress' }),
        /trạng thái này/i,
      )

      // `new` is never a destination — going back would erase the very trace that
      // first_viewed_by exists to hold.
      await assert.rejects(
        () => changeSubmissionStatus(actor, first, { status: 'new' }),
        /Không thể chuyển/i,
      )

      // Unknown values are refused rather than coerced.
      await assert.rejects(
        () => changeSubmissionStatus(actor, first, { status: 'dang-xu-ly' }),
        /không hợp lệ/i,
      )

      // A closed file can be reopened: locking it would force a second record for
      // the same citizen, splitting their history across two rows.
      await changeSubmissionStatus(actor, first, { status: 'resolved' })
      await changeSubmissionStatus(actor, first, { status: 'in_progress' })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4b. Several officers changing the status at once.
    //     The status used to be read outside the transaction and updated by id
    //     only, so both passed the transition check against the same stale
    //     status, the second overwrote the first, and the timeline got two
    //     entries both claiming to start from `new`. The conditional UPDATE
    //     (`AND status = <read>`) is what decides now; a loser that read a stale
    //     status gets a 409.
    //
    //     What this may NOT assert is "exactly one wins". A call that starts after
    //     another has committed simply reads the NEW status and legitimately moves
    //     it on (a closed file can be reopened), so how many succeed depends on how
    //     the calls interleave — 1 on an idle laptop, up to all of them on a slow CI
    //     runner (staggering the calls by 12 ms makes the old "exactly one" check
    //     fail with 5 winners on correct code). The property that holds under EVERY
    //     interleaving, and that the old bug broke, is a serial history:
    //       - each success left exactly one status entry and one audit row, a
    //         failure left none;
    //       - read in commit order (entry id — taken after the UPDATE that holds the
    //         row lock), every entry starts from where the previous one ended,
    //         the first from `new`, and the last ends at the stored status;
    //       - no entry is a transition `canTransition` forbids;
    //       - every refusal is a 409 (lost the race) or 400 (the status it read was
    //         already the target / not allowed from it), never a success or a 500.
    //     Whether any loser gets a 409 in a burst is ALSO down to timing, so the 409
    //     path is pinned separately and deterministically in 4b' below; the burst is
    //     repeated on fresh files only to give the interleavings a chance to differ.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const { canTransition, isSubmissionStatus } = await import('../shared/submission-status')
      const targets = ['in_progress', 'rejected', 'transferred', 'resolved', 'in_progress'] as const
      for (let rounds = 1; rounds <= 8; rounds += 1) {
        const raced = await seedSubmission(`Phạm Văn D${rounds}`)
        const settled = await Promise.allSettled(
          targets.map((status) => changeSubmissionStatus(actor, raced, { status })),
        )
        const won = settled.filter((s): s is PromiseFulfilledResult<{ status: string }> => s.status === 'fulfilled')
        const lost = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected')
        assert.ok(won.length >= 1, `round ${rounds}: at least one concurrent status change must succeed`)
        for (const loss of lost) {
          const err = loss.reason as { statusCode?: number; statusMessage?: string }
          assert.ok(
            err.statusCode === 409 || err.statusCode === 400,
            `round ${rounds}: a refused concurrent change must be 409/400, got ${String(err.statusCode)} ${String(err.statusMessage)}`,
          )
        }

        const [row] = await db
          .select({ status: submissions.status })
          .from(submissions)
          .where(eq(submissions.id, raced))
          .limit(1)
        const statusEvents = (await listSubmissionEvents(raced))
          .filter((e) => e.eventType === 'status')
          .sort((a, b) => a.id - b.id)
        assert.equal(statusEvents.length, won.length, `round ${rounds}: ${won.length} changes succeeded but ${statusEvents.length} status entries were written`)

        let from = 'new'
        for (const e of statusEvents) {
          assert.equal(e.fromStatus, from, `round ${rounds}: an entry must start where the previous one ended (a lost update writes two entries from the same status)`)
          assert.ok(isSubmissionStatus(from) && isSubmissionStatus(e.toStatus), `round ${rounds}: unknown status in the timeline`)
          assert.ok(canTransition(from, e.toStatus), `round ${rounds}: forbidden transition ${from} → ${e.toStatus} slipped through`)
          from = e.toStatus
        }
        assert.equal(row!.status, from, `round ${rounds}: the stored status is not where the timeline ends`)
        assert.deepEqual(
          statusEvents.map((e) => e.toStatus).sort(),
          won.map((w) => w.value.status).sort(),
          `round ${rounds}: the statuses the winners were told they set are not the ones in the timeline`,
        )

        const audits = await db
          .select({ id: activityLogs.id })
          .from(activityLogs)
          .where(and(eq(activityLogs.resource, 'submissions'), eq(activityLogs.action, 'update'), eq(activityLogs.resourceId, raced)))
        assert.equal(audits.length, won.length, `round ${rounds}: audit rows (${audits.length}) must equal successful changes (${won.length}) — a loser left an audit row for a change that did not happen`)
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4b'. The conditional UPDATE, deterministically (no timing involved).
    //     A second connection changes the row and keeps it locked, uncommitted.
    //     `changeSubmissionStatus` reads the OLD status (a snapshot read does not
    //     wait), passes its transition check against it, and its UPDATE blocks on
    //     the row lock. Once the other connection commits, the UPDATE re-checks
    //     `status = <what it read>` against the committed row, matches nothing and
    //     must refuse with 409 — writing no timeline entry and no audit row.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const stale = await seedSubmission('Lê Văn G')
      const other = await mysql.createConnection({ host, port, user, password, database })
      let blocked: Promise<unknown>
      try {
        await other.query('START TRANSACTION')
        await other.query('UPDATE submissions SET status = ? WHERE id = ?', ['resolved', stale])
        blocked = changeSubmissionStatus(actor, stale, { status: 'in_progress' })
        blocked.catch(() => {}) // asserted below; never left unhandled while we wait
        // Wait until its UPDATE is parked on our lock (so it has already read `new`).
        const deadline = Date.now() + 15_000
        for (;;) {
          const [waiting] = await other.query("SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_state = 'LOCK WAIT'")
          if (Number((waiting as Array<{ n: number | string }>)[0]!.n) > 0) break
          assert.ok(Date.now() < deadline, 'the status change never reached the row lock: the stale-read setup did not happen')
          // Not tighter: polling information_schema.innodb_trx every few ms starves the very UPDATE we are waiting for.
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
        await other.query('COMMIT')
      } finally {
        await other.end()
      }
      await assert.rejects(blocked, (err: { statusCode?: number }) => err.statusCode === 409, 'a change decided on a stale status must lose with 409')

      const [row] = await db.select({ status: submissions.status }).from(submissions).where(eq(submissions.id, stale)).limit(1)
      assert.equal(row!.status, 'resolved', 'the loser must not have overwritten the committed status')
      const staleEvents = (await listSubmissionEvents(stale)).filter((e) => e.eventType === 'status')
      assert.equal(staleEvents.length, 0, 'a refused change must not write a timeline entry')
      const staleAudits = await db
        .select({ id: activityLogs.id })
        .from(activityLogs)
        .where(and(eq(activityLogs.resource, 'submissions'), eq(activityLogs.action, 'update'), eq(activityLogs.resourceId, stale)))
      assert.equal(staleAudits.length, 0, 'a refused change must not leave an audit row')
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4c. A legacy row with an unknown stored status still transitions. The
    //     conditional UPDATE must match the RAW stored value, not the normalised
    //     default, or such a row would 409 forever.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const legacy = await seedSubmission('Võ Thị E')
      await db.update(submissions).set({ status: 'cu_khong_ro' }).where(eq(submissions.id, legacy))
      await changeSubmissionStatus(actor, legacy, { status: 'in_progress' })
      const [row] = await db
        .select({ status: submissions.status })
        .from(submissions)
        .where(eq(submissions.id, legacy))
        .limit(1)
      assert.equal(row!.status, 'in_progress')
      const statusEvents = (await listSubmissionEvents(legacy)).filter((e) => e.eventType === 'status')
      assert.equal(statusEvents.length, 1)
      assert.equal(statusEvents[0]!.fromStatus, 'new', 'an unknown stored status reads as the default')
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. The audit row and the mutation commit TOGETHER.
    //    Forced by making the audit insert violate its FK to `users`.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const before = await db
        .select({ status: submissions.status })
        .from(submissions)
        .where(eq(submissions.id, first))
        .limit(1)

      const ghost = {
        id: 987_654_321, // no such user → activity_logs.user_id FK rejects the row
        username: 'khong_ton_tai',
        isSuperAdmin: true,
        permissions: { submissions: { read: true, update: true, delete: true, create: true } },
      } as unknown as Parameters<typeof changeSubmissionStatus>[0]

      await assert.rejects(
        () => changeSubmissionStatus(ghost, first, { status: 'transferred' }),
        'a failing audit insert must abort the whole transaction',
      )

      const after = await db
        .select({ status: submissions.status })
        .from(submissions)
        .where(eq(submissions.id, first))
        .limit(1)
      assert.equal(
        after[0]!.status,
        before[0]!.status,
        'the status moved even though its audit row could not be written',
      )

      // And no orphan timeline entry was left behind either.
      const stranded = (await listSubmissionEvents(first)).filter((e) => e.toStatus === 'transferred')
      assert.equal(stranded.length, 0, 'a timeline entry survived a rolled-back status change')
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Notes and contact log: separate entry types, both audited.
    // ─────────────────────────────────────────────────────────────────────────
    {
      await addSubmissionNote(actor, first, 'Đã chuyển hồ sơ cho Công an xã Tam Hưng.')
      await logSubmissionContact(actor, first, { channel: 'phone', note: 'Máy bận, gọi lại chiều.' })

      const events = await listSubmissionEvents(first)
      assert.equal(events.filter((e) => e.eventType === 'note').length, 1)

      const contacts = events.filter((e) => e.eventType === 'contact')
      assert.equal(contacts.length, 1)
      assert.equal(contacts[0]!.channel, 'phone')

      // An unknown channel is refused: a contact log nobody can read back is worse
      // than none, because it still reads as "we reached this person".
      await assert.rejects(
        () => logSubmissionContact(actor, first, { channel: 'sms' }),
        /không hợp lệ/i,
      )

      // An empty note is refused rather than stored blank.
      await assert.rejects(() => addSubmissionNote(actor, first, '   '), /nội dung ghi chú/i)

      // Over-long notes are REFUSED, never silently truncated — an officer who
      // lost the tail of a case note has no way of knowing they lost it.
      await assert.rejects(() => addSubmissionNote(actor, first, 'x'.repeat(2001)), /quá dài/i)

      // Control characters are refused, using the same shared guard as comments.
      await assert.rejects(() => addSubmissionNote(actor, first, 'a b'), /không hợp lệ/i)

      // The timeline reads oldest-first, so it renders as a chronology.
      const times = events.map((e) => e.createdAt?.getTime() ?? 0)
      assert.deepEqual(times, [...times].sort((a, b) => a - b), 'timeline is not chronological')
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. DATETIME survives the round trip. Same trap as view-boost: the writer and
    //    the reader are only self-inverse as a PAIR.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const marker = await seedSubmission('Lê Văn C')
      const sent = new Date('2026-03-15T02:30:00.000Z')
      await db.update(submissions).set({ notifiedAt: sent }).where(eq(submissions.id, marker))

      const [row] = await db
        .select({ notifiedAt: submissions.notifiedAt })
        .from(submissions)
        .where(eq(submissions.id, marker))
        .limit(1)
      assert.ok(row!.notifiedAt instanceof Date)
      assert.equal(
        row!.notifiedAt!.toISOString(),
        sent.toISOString(),
        'notified_at shifted going through MySQL — the DATETIME pair is no longer symmetric',
      )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. Counts are per status over the WHOLE table, not the filtered view.
    // ─────────────────────────────────────────────────────────────────────────
    {
      const counts = await countSubmissionsByStatus()
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
      const [{ rows } = { rows: 0 }] = await db
        .select({ rows: submissions.id })
        .from(submissions)
        .then((all) => [{ rows: all.length }])
      assert.equal(total, rows, 'the status tiles do not add up to the table')
      assert.ok((counts.new ?? 0) >= 1, 'the untouched fixtures should still be `new`')
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. Foreign keys. No unit test can confirm these — a missing delete rule
    //    leaves rows behind rather than erroring.
    // ─────────────────────────────────────────────────────────────────────────
    {
      // 9a. actor_id is SET NULL: deleting an officer must NOT erase the trace of
      //     what they did to a citizen's file. That is the trace worth most.
      const eventsBefore = await listSubmissionEvents(first)
      assert.ok(eventsBefore.length > 0)

      await db.delete(users).where(eq(users.id, officer.id))

      const eventsAfter = await listSubmissionEvents(first)
      assert.equal(
        eventsAfter.length,
        eventsBefore.length,
        'deleting the officer took their processing history with it',
      )
      assert.equal(eventsAfter[0]!.actorId, null, 'actor_id should be NULL after the user is gone')
      assert.equal(
        eventsAfter[0]!.actorName,
        'canbo_workflow',
        'the username snapshot is what keeps a deleted actor readable',
      )

      // 9b. submission_id is CASCADE: the log follows the file it describes.
      const [{ before } = { before: 0 }] = await db
        .select({ before: submissionEvents.id })
        .from(submissionEvents)
        .where(eq(submissionEvents.submissionId, first))
        .then((all) => [{ before: all.length }])
      assert.ok(before > 0)

      await db.delete(submissions).where(eq(submissions.id, first))

      const remaining = await db
        .select({ id: submissionEvents.id })
        .from(submissionEvents)
        .where(eq(submissionEvents.submissionId, first))
      assert.equal(remaining.length, 0, 'submission_events did not cascade with its submission')
    }
  } finally {
    /**
     * Đóng pool của `getDb()` TRƯỚC khi DROP, và đây không phải chuyện dọn dẹp cho
     * gọn: pool giữ những kết nối còn sống, mà một kết nối còn sống là một handle
     * giữ tiến trình Node mở. Thiếu dòng này thì suite **chạy xong, mọi khẳng định
     * xanh, rồi treo mãi mãi** — và triệu chứng đọc ra là "test bị treo", tức gần
     * như ngược lại nguyên nhân. Đã trả giá đúng một lần: lượt chạy đầu bị cắt ở
     * mốc 5 phút. Lệnh DROP cũng sẽ bị chặn nếu còn kết nối mở trên chính database
     * đó, nên thứ tự ở đây là ràng buộc thật.
     */
    const { getPool } = await import('../server/utils/db')
    await getPool()?.end()

    const cleanup = await mysql.createConnection({ host, port, user, password })
    await cleanup.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await cleanup.end()

    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key]
    }
    Object.assign(process.env, previous)
  }
})
