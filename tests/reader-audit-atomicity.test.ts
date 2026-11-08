/**
 * Every write path added by reader-google-login-comments commits its row and its
 * audit row together.
 *
 * The failure this guards is quiet and permanent. Written as delete-then-log, a
 * failed second statement leaves the row gone and nothing recording who removed
 * it — on a government portal, a citizen's public statement disappears and the
 * trail says it never happened. The reverse order is no better: a log claiming a
 * deletion that did not occur. The only correct answer is both or neither.
 *
 * `banReader` and `deleteReader` were written this way from the start; the other
 * five were not, and this file exists because nothing else noticed. Reviewed by
 * source text rather than by driving MySQL: a transaction boundary is a property
 * of how the code is written, and the assertion that would need a database
 * (rolling back a real failed insert) is covered by the fact that Drizzle's
 * `transaction()` rolls back on a thrown error — which is its documented contract,
 * not something this project should re-verify.
 *
 * DELIBERATELY EXCLUDED: `deleteArticleById` and `setArticleStatus` in
 * services/articles.ts predate this change and still write the pair unwrapped.
 * They are listed here as known exclusions rather than silently skipped, so the
 * gap is visible and a future change can close it on purpose.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import ts from 'typescript'
import {
  auditTableReferences, auditingUnits, mayWriteAuditTable, scanUnits, unitProblems,
  type Rule, type UnitFacts, type UnitProblem,
} from './_audit-atomicity-scan'
import { BACKUP_BARREL, backupServiceFiles, backupServiceSource } from './_backup-service-family'
import { commentServiceFiles } from './_comments-service-source'

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

/** Every `.ts` file under `dir` (repo-relative), recursively — a service moved into a sub-folder is still read. */
function walkTs(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) found.push(...walkTs(path))
    else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found.sort()
}

const scanned = new Map<string, UnitFacts[]>()
/** The per-function facts of a repo file (`tests/_audit-atomicity-scan.ts`), cached. */
function unitsOf(file: string): UnitFacts[] {
  let units = scanned.get(file)
  if (!units) scanned.set(file, units = scanUnits(file, read(file)))
  return units
}

/**
 * A list entry is a file (`server/api/admin/x.put.ts`) or ONE function of a file
 * (`server/services/admin-roles.ts#updateRoleWithAudit`). A service file may hold several
 * audited functions, so moving a listed endpoint into a service re-points its entry to the
 * function — the per-function checks below then hold for that function alone.
 */
function target(entry: string): { file: string, fn?: string } {
  const [file, fn] = entry.split('#')
  return fn ? { file: file!, fn } : { file: file! }
}

function unitNamed(file: string, fn: string): UnitFacts {
  const unit = unitsOf(file).find(u => u.name === fn)
  assert.ok(unit, `${fn} is no longer declared at the top level of ${file} — this entry is now testing nothing`)
  return unit
}

/** The text a list entry stands for: the whole file, or the named function's declaration. */
const entrySource = (entry: string) => {
  const { file, fn } = target(entry)
  return fn ? unitNamed(file, fn).text : read(file)
}

/** The per-function problems of the units an entry stands for (`auditOffTransaction` is the service rule). */
function entryProblems(entry: string): UnitProblem[] {
  const { file, fn } = target(entry)
  return unitProblems(unitsOf(file), { auditOffTransaction: false }).filter(p => fn === undefined || p.unit === fn)
}

/**
 * Pull one function body out of a service module. Crude but sufficient: these
 * files declare top-level `export`s in sequence, so the next `\nexport ` is the
 * end of the current body.
 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`)
  assert.ok(start !== -1, `${name} no longer exists — this guard is now testing nothing`)
  const next = source.indexOf('\nexport ', start + 10)
  return next === -1 ? source.slice(start) : source.slice(start, next)
}

/** Every path this change added that both mutates a row and audits the mutation. */
const AUDITED_WRITES: Array<{ file: string, fn: string, why: string }> = [
  // The comment service is split into `comments-*.ts` sub-files (wave2 D-SPLIT);
  // `comments.ts` is a barrel. Each entry names the file that holds the function —
  // the family check further down fails if a comment sub-file writes
  // `activity_logs` without appearing here or in SERVICE_EXEMPTIONS.
  { file: 'server/services/comments-deletion.ts', fn: 'deleteComment', why: 'a public comment vanishes with no record of who removed it' },
  { file: 'server/services/readers.ts', fn: 'banReader', why: 'a flag set without the deletion leaves comments under a banned name' },
  { file: 'server/services/readers.ts', fn: 'deleteReader', why: 'an account and its comment history disappear untraceably' },
  { file: 'server/services/readers.ts', fn: 'purgeReaderComments', why: 'every comment a citizen wrote is removed with nothing recording it' },
  { file: 'server/services/readers.ts', fn: 'unbanReader', why: 'the account becomes unbanned with nothing recording who did it or when' },
  { file: 'server/services/ip-bans.ts', fn: 'createIpBan', why: 'a ban in force that no log explains cannot be lifted with confidence' },
  { file: 'server/services/ip-bans.ts', fn: 'deleteIpBan', why: 'the stored value is the only evidence of what was un-banned' },
  { file: 'server/services/google-oauth-settings.ts', fn: 'updateGoogleOAuthSettings', why: '"who turned Google sign-in on, and when" becomes unanswerable' },
  { file: 'server/services/google-oauth-settings.ts', fn: 'clearGoogleOAuthSecret', why: 'credentials are dropped with no record of it' },
  { file: 'server/services/articles.ts', fn: 'setArticleCommentsEnabled', why: 'a thread opens or closes with nobody accountable' },
  { file: 'server/services/comments-admin-reply.ts', fn: 'createAdminReply', why:'an administrator\'s public reply exists with no record of which admin posted it' },
  // A rename is a write to a citizen's personal data, and it is the one audited
  // path here whose actor is NOT a member of staff — see the `userId: null` note in
  // renameReader for why the reader's id goes in `meta` instead of the user column.
  // "Who was this account called before, and when did that change" has to stay
  // answerable: a moderator acting on a report about a name needs to be able to
  // tell a renamed account from the wrong account.
  { file: 'server/services/readers.ts', fn: 'renameReader', why: 'a display name changes on every comment already published with nothing recording the old one' },
  // The policy that decides what the purge deletes. Until FINDING-R3-1 the keys
  // were written here on the pool and `settings/retention.put.ts` audited them
  // afterwards — a shape the endpoint scan cannot see (the handler holds no raw
  // write) and the service scan did not ask about (this file did not touch
  // `activityLogs`). Named by function so moving the audit back out turns this red.
  { file: 'server/services/retention-policy.ts', fn: 'saveRetentionPolicy', why: 'a shortened deletion window is in force with no record of who set it, or from what' },
]

describe('a row and its audit row commit together', () => {
  for (const { file, fn, why } of AUDITED_WRITES) {
    it(`${fn} wraps its write and its audit row in one transaction`, () => {
      const body = functionBody(read(file), fn)

      assert.match(
        body,
        /(db|getDb\(\))\.transaction\(/,
        `${fn} writes outside a transaction — if the audit insert fails, ${why}`,
      )

      // The audit insert has to be INSIDE the transaction, i.e. on the tx handle.
      // `db.insert(activityLogs)` inside a transaction block would run on the pool
      // and commit independently, which is the bug wearing a transaction's clothes.
      assert.match(
        body,
        /tx\.insert\(activityLogs\)/,
        `${fn} inserts its audit row on the pool rather than the transaction handle — it would commit independently`,
      )
      assert.ok(
        !/\bdb\.insert\(activityLogs\)/.test(body),
        `${fn} still has a pool-level activityLogs insert; move it onto the tx handle`,
      )
    })
  }

  it('the write itself is also on the transaction handle', () => {
    // A transaction that only carries the audit row is worse than none: the audit
    // would roll back while the deletion stood.
    for (const { file, fn } of AUDITED_WRITES) {
      const body = functionBody(read(file), fn)
      assert.match(
        body,
        /tx\.(insert|update|delete)\(/,
        `${fn} opens a transaction but performs its write outside it`,
      )
    }
  })

  /**
   * The same, read on the AST (`tests/_audit-atomicity-scan.ts`) rather than by regex: an
   * audit spelled `getDb().insert(activityLogs)` or on a handle not called `db`, a row
   * written in ONE transaction and audited in ANOTHER, or a pool write inside any of the
   * function's transactions — none of which the patterns above can see.
   */
  it('the AST agrees: every audit row is on the handle of a transaction that writes the row', () => {
    for (const { file, fn } of AUDITED_WRITES) {
      const unit = unitNamed(file, fn)
      assert.ok(unit.writes.some(w => w.audit), `${fn} no longer writes an activity_logs row`)
      assert.deepEqual(unit.writes.filter(w => w.audit && !w.onTx).map(w => `line ${w.line}`), [], `${fn} writes an audit row off its transaction handle`)
      assert.deepEqual(entryProblems(`${file}#${fn}`), [], `${fn}: the per-function scan objects`)
    }
  })
})

describe('known exclusions are named, not silently skipped', () => {
  it('the two pre-existing article paths are still the only unwrapped ones', () => {
    // If a future change wraps these, this test fails and the exclusion list above
    // should shrink — that is the intended way to find out it happened.
    const source = read('server/services/articles.ts')
    for (const fn of ['deleteArticleById', 'setArticleStatus']) {
      const body = functionBody(source, fn)
      assert.ok(
        !/transaction\(/.test(body),
        `${fn} now uses a transaction — remove it from the exclusion list in this file's header`,
      )
    }
  })
})

describe('the shared deletion path can join a caller transaction', () => {
  it('deleteReaderComments accepts an executor and uses it', () => {
    // Without this, purgeReaderComments could not delete and audit atomically: it
    // would have to either duplicate the DELETE (breaking the single-deletion-path
    // rule from design.md D8) or leave the pair unwrapped.
    const body = functionBody(read('server/services/comments-deletion.ts'), 'deleteReaderComments')
    assert.match(body, /executor\?:/, 'deleteReaderComments no longer accepts an executor')
    assert.match(
      body,
      /\(executor \?\? getDb\(\)\)/,
      'deleteReaderComments ignores the executor it was handed — the caller transaction would not cover the delete',
    )
  })

  it('purgeReaderComments hands its transaction down rather than deleting twice', () => {
    const body = functionBody(read('server/services/readers.ts'), 'purgeReaderComments')
    assert.match(body, /deleteReaderComments\(params\.readerId, tx\)/)
    assert.ok(
      !/tx\.delete\(articleComments\)/.test(body),
      'purgeReaderComments issues its own DELETE — deletion semantics must live in one function (design.md D8)',
    )
  })
})

/**
 * The same pairing, enforced on admin endpoints that query the database directly.
 *
 * The guard above covers `server/services/**`, where the reader-side write paths
 * live. But 92 of 171 endpoints call `getDb()` themselves, and 43 of those also
 * write an `activity_logs` row — so the identical defect class existed in a part
 * of the tree nothing was watching. All of them were written delete-then-log on
 * the pool, which is exactly the shape this file was created to reject.
 *
 * The destructive subset is guarded here. It is the subset where an audit insert
 * failing after the mutation is unrecoverable rather than merely untidy: the row
 * is already gone, so the log is the only remaining evidence of who removed it,
 * and it is the thing that failed. `activity_logs.user_id` is a foreign key into
 * `users` and `meta` is a JSON column, so the second statement has its own ways
 * to fail independently of the first — this is not a hypothetical ordering.
 *
 * Non-destructive endpoints (create/update) are deliberately NOT listed. A failed
 * audit after an update leaves a row that still exists and can be inspected,
 * compared and corrected; a failed audit after a delete leaves nothing at all.
 * Fixing 39 endpoints mechanically would also mean 39 chances to introduce a new
 * bug in code that is currently working, and the convention recorded in CLAUDE.md
 * is what governs the ones not listed here.
 */
const AUDITED_DELETE_ENDPOINTS: Array<{ file: string, why: string }> = [
  {
    // The transaction of roles/[id].delete.ts, moved out of the handler. Named by FUNCTION:
    // the checks below then read that function alone, whatever else the file holds.
    file: 'server/services/admin-role-delete.ts#deleteRoleWithAudit',
    why: 'a permission role is destroyed with nothing recording who removed it',
  },
  {
    file: 'server/services/admin-user-mfa-reset.ts#clearUserMfaFactors', // the transaction of users/[id]/mfa.delete.ts
    why: "another administrator's second factors are stripped and the override leaves no trace",
  },
  {
    file: 'server/api/admin/pages/[id]/versions/[versionId].delete.ts',
    why: 'a saved backup is discarded untraceably',
  },
  {
    file: 'server/api/admin/pages/[id]/versions/index.post.ts',
    why: 'the origin path deletes the old baseline before writing the new one — a failure between them leaves the page with no baseline at all',
  },
]

describe('destructive admin endpoints commit their delete and their audit row together', () => {
  for (const { file, why } of AUDITED_DELETE_ENDPOINTS) {
    it(`${file.replace('server/api/admin/', '')} wraps both in one transaction`, () => {
      assertEntryShape(file)
      const source = entrySource(file)

      assert.match(
        source,
        /db\.transaction\(/,
        `writes outside a transaction — if the audit insert fails, ${why}`,
      )
      assert.match(
        source,
        /tx\.insert\(activityLogs\)/,
        'the audit row is inserted on the pool rather than the transaction handle — it would commit independently',
      )
      assert.ok(
        !/\bdb\.insert\(activityLogs\)/.test(source),
        'a pool-level activityLogs insert remains; move it onto the tx handle',
      )
      assert.match(
        source,
        /tx\.(insert|update|delete)\(/,
        'opens a transaction but performs its mutation outside it — the audit would roll back while the deletion stood',
      )
    })
  }
})

/**
 * The per-function half of every named entry (delete and mutation lists alike):
 *   - a FILE entry stands for one audited function — a file that now holds two or more
 *     must be named by function (`file#fn`), or the regexes above would pass on whichever
 *     one still audits while the other lost its row;
 *   - the entry still writes an audit row, every one of them on a transaction handle, and
 *     the per-function scan has nothing to say about it (audit in a transaction that also
 *     writes the row; no pool write inside ANY of its transactions, not just the first).
 */
function assertEntryShape(entry: string) {
  const { file, fn } = target(entry)
  const units = fn ? [unitNamed(file, fn)] : unitsOf(file).filter(u => auditingUnits(unitsOf(file)).includes(u.name))
  if (!fn) {
    assert.equal(units.length, 1, `${file} holds ${units.length} audited functions (${units.map(u => u.name).join(', ')}) — name each one as \`${file}#<function>\``)
  }
  for (const unit of units) {
    assert.ok(unit.writes.some(w => w.audit), `${entry}: ${unit.name} no longer writes an activity_logs row`)
    assert.deepEqual(unit.writes.filter(w => w.audit && !w.onTx).map(w => `line ${w.line}`), [], `${entry}: ${unit.name} writes an audit row off its transaction handle`)
  }
  assert.deepEqual(entryProblems(entry), [], `${entry}: the per-function scan objects`)
}

describe('the MFA-confirm exclusion is deliberate and still correct', () => {
  /**
   * `profile/mfa/confirm.post.ts` mutates and audits WITHOUT a transaction, on
   * purpose: it calls `setSessionCookie(event, …)` between the two, which is a
   * side effect on the HTTP response that no rollback can retract. Wrapping it
   * would create a worse state than the one it fixes — a session cookie already
   * handed to the browser while the factor activation it represents was rolled
   * back.
   *
   * Asserted rather than assumed: if someone later moves the cookie write out of
   * the middle, this fails and the endpoint should join the list above.
   */
  it('the cookie is still issued between the mutation and the audit row', () => {
    const source = read('server/api/admin/profile/mfa/confirm.post.ts')
    const cookie = source.indexOf('setSessionCookie(event')
    const audit = source.indexOf('db.insert(activityLogs)')
    assert.ok(cookie !== -1, 'setSessionCookie is gone — re-evaluate whether this endpoint can now be wrapped')
    assert.ok(audit !== -1, 'the audit insert is gone')
    assert.ok(
      cookie < audit,
      'the cookie is no longer written between the mutation and the audit — this endpoint can and should now be wrapped in a transaction',
    )
  })
})


/**
 * Every remaining admin endpoint that mutates and audits on the same request.
 *
 * The destructive subset above was fixed first because a failed audit after a
 * delete is unrecoverable. This list is the rest: create and update paths, where
 * a failed audit leaves a row that still exists but no record of who changed it.
 * That is a weaker failure, not a harmless one — on a government portal, "who
 * granted this role", "who edited this article" and "who changed this setting"
 * are exactly the questions the log exists to answer.
 *
 * Discovered by measurement, not by reading: 43 of the 92 endpoints that call
 * `getDb()` directly also write `activity_logs`, and 39 of those wrote the pair
 * unwrapped. Nothing was watching that part of the tree.
 *
 * DELIBERATELY EXCLUDED, and asserted separately below:
 *   • profile/mfa/confirm.post.ts, profile/mfa/recovery-codes.post.ts,
 *     auth/logout.post.ts — each writes an HTTP cookie between the two database
 *     writes. A cookie is a side effect on the response that no rollback can
 *     retract, so wrapping would create a worse state than it fixes.
 *   • articles/[id]/boost.post.ts — audits through the shared boost service
 *     rather than inline, so it has no local pair to wrap.
 */
const AUDITED_MUTATION_ENDPOINTS: string[] = [
  'server/api/admin/articles/[id].put.ts',
  'server/api/admin/articles/index.post.ts',
  'server/api/admin/media/upload.post.ts',
  'server/api/admin/pages/[id].put.ts',
  'server/api/admin/pages/[id]/versions/[versionId]/restore.post.ts',
  'server/api/admin/pages/index.post.ts',
  // Factor, recovery codes, session generation and audit row in one transaction; the
  // cookie is written AFTER the commit, so it is no longer a cookie-between-writes
  // exception (2026-10-28 — the audit used to follow the cookie on the pool).
  'server/api/admin/profile/mfa/disable.post.ts',
  // Moved out of their handlers into services, each named by the FUNCTION holding the transaction.
  'server/services/admin-role-create.ts#createRoleWithAudit', // roles/index.post.ts
  // roles/[id].put.ts: guarded by the raw-delete scan below until its tx.delete(permissions) moved here
  'server/services/admin-role-update.ts#updateRoleWithAudit',
  'server/api/admin/settings/index.put.ts',
  'server/api/admin/settings/navigation/mobile.put.ts',
  'server/api/admin/settings/navigation/navbar.put.ts',
  'server/services/admin-user-update.ts#updateUserWithAudit', // users/[id].put.ts
  'server/services/admin-user-create.ts#createUserWithAudit', // users/index.post.ts
]

/** Every `.transaction(` block of `source` (brace-matched), not just the first. */
function transactionBlocks(source: string): string[] {
  const blocks: string[] = []
  for (let start = source.indexOf('.transaction('); start !== -1; start = source.indexOf('.transaction(', start + 1)) {
    let depth = 0, started = false, end = source.length
    for (let i = start; i < source.length; i++) {
      if (source[i] === '{') { depth++; started = true }
      else if (source[i] === '}') depth--
      if (started && depth === 0) { end = i; break }
    }
    blocks.push(source.slice(start, end))
  }
  return blocks
}

describe('admin mutation endpoints commit their write and their audit row together', () => {
  for (const file of AUDITED_MUTATION_ENDPOINTS) {
    it(`${file.replace('server/api/admin/', '')} wraps both in one transaction`, () => {
      assertEntryShape(file)
      const source = entrySource(file)
      assert.match(source, /db\.transaction\(/, 'the write and its audit row are not atomic')
      assert.match(source, /tx\.insert\(activityLogs\)/,
        'the audit row is inserted on the pool rather than the transaction handle — it would commit independently')
      assert.ok(!/\bawait db\.insert\(activityLogs\)/.test(source),
        'a pool-level activityLogs insert remains; move it onto the tx handle')
    })
  }

  /**
   * The mutation must be on `tx` too. A transaction carrying only the audit row
   * is worse than none: the log would roll back while the change stood.
   *
   * EVERY transaction of the entry, not only the first one in the file: a service file
   * holding two audited functions used to be read up to the end of its first block, so the
   * second function could write on the pool inside its transaction unseen. The AST half
   * (`assertEntryShape`) asks the same of every transaction on any handle name.
   */
  it('no pool-level write survives inside a transaction block', () => {
    for (const file of AUDITED_MUTATION_ENDPOINTS) {
      // Comments and string text blanked first (`normalizeSource`): a `.transaction(` or a
      // brace in prose would otherwise move the block boundaries.
      const blocks = transactionBlocks(normalizeSource(entrySource(file)))
      assert.ok(blocks.length > 0, `${file}: no transaction block found`)
      for (const body of blocks) {
        assert.ok(!/\bdb\s*\.\s*(insert|update|delete)\(/.test(body),
          `${file} performs a pool-level write inside its transaction — it commits independently`)
      }
    }
  })
})

describe('cookie-writing endpoints are excluded on purpose', () => {
  /**
   * Asserted rather than assumed. If the cookie write moves out from between the
   * two database writes, these fail and the endpoint should join the list above.
   */
  for (const file of [
    'server/api/admin/profile/mfa/confirm.post.ts',
    'server/api/admin/profile/mfa/recovery-codes.post.ts',
    'server/api/admin/auth/logout.post.ts',
    // Re-issues this session's cookie after bumping tokenVersion, so the caller
    // is not logged out by their own successful password change. Found by the
    // directory scan below, which is the point of having one.
    'server/api/admin/profile/password.put.ts',
  ]) {
    it(`${file.replace('server/api/admin/', '')} still writes a cookie mid-request`, () => {
      const source = read(file)
      assert.match(source, /setSessionCookie\(|deleteCookie\(|setCookie\(/,
        'the cookie write is gone — re-evaluate whether this endpoint can now be wrapped in a transaction')
    })
  }
})

/**
 * Cùng câu hỏi, nhưng QUÉT CẢ THƯ MỤC `server/api/admin/**` thay vì đọc một danh
 * sách tên tệp.
 *
 * `AUDITED_MUTATION_ENDPOINTS` phía trên liệt kê 18 đường dẫn, nên nó **xanh vĩnh
 * viễn với bất cứ tệp nào không ai nghĩ ra để thêm vào** — đúng lớp hỏng mà cổng
 * tầng service đã được viết lại để thoát khỏi, và lời giải thích đó đã nằm ngay
 * trong tệp này suốt thời gian qua trong khi nhóm endpoint vẫn là một danh sách.
 * Một danh sách không thể đỏ vì một cái tên nó không chứa, và nó im lặng: đọc ra
 * y hệt một cổng đang chạy đúng.
 *
 * Không phải giả thuyết. Lượt quét đầu tiên tìm ra **sáu** endpoint ghi cặp
 * mutation + audit không bọc mà không danh sách nào nhắc tới, trong đó
 * `articles/[id]/boost.post.ts` và `boost.delete.ts` là hai lượt ghi thật sự cần
 * bọc: một lượt tăng lượt xem ảo mà không truy được về người thực hiện đúng là
 * thứ tính năng đó không được phép sinh ra.
 *
 * ⚠️ GIỚI HẠN CÓ CHỦ ĐÍCH: guard chỉ hỏi những tệp **tự tay** ghi (`db.update(`,
 * `db.delete(`, `db.insert(` vào bảng khác `activityLogs`). Endpoint uỷ quyền
 * mutation cho một service rồi tự ghi audit trên pool — như `profile/mfa/disable.post.ts`
 * tới 2026-10-28 (nay bọc trong một transaction và nằm trong
 * `AUDITED_MUTATION_ENDPOINTS` ở trên, test hành vi ở `admin-mfa-disable-behavior`)
 * — không có lệnh ghi thô nào ở đây nên không bị hỏi, và cổng quét `server/services/`
 * bên dưới cũng không hỏi service đó nếu nó không chạm `activityLogs`. Đó đúng là
 * hình của FINDING-R3-1: `settings/retention.put.ts` từng gọi `saveRetentionPolicy`
 * (ghi khoá trên pool) rồi tự ghi audit — lọt qua cả hai cổng. Nay cặp ghi + audit
 * nằm trong transaction của service và hàm được nêu tên ở `AUDITED_WRITES`. Ghi ra
 * vì một giới hạn không nêu tên sẽ được đọc thành một bảo đảm không tồn tại.
 */
const MUTATION_SCAN_EXEMPTIONS: Record<string, string> = {
  // Cả bốn ghi một cookie HTTP **giữa** hai lượt ghi CSDL. Cookie là tác dụng phụ
  // lên phản hồi mà rollback không thu hồi được, nên bọc lại tạo ra trạng thái tệ
  // hơn: trình duyệt đã cầm cookie cho một thao tác đã bị rollback. Vị trí của
  // cookie được khẳng định riêng ở nhóm test ngay trên — dời nó đi là test đỏ và
  // endpoint phải vào diện bọc.
  'auth/logout.post.ts': 'writes an HTTP cookie between the two database writes',
  'profile/mfa/confirm.post.ts': 'writes an HTTP cookie between the two database writes',
  'profile/mfa/recovery-codes.post.ts': 'writes an HTTP cookie between the two database writes',
  'profile/password.put.ts': 'writes an HTTP cookie between the two database writes',
}

/**
 * Bỏ chú thích và nội dung chuỗi, rồi gom khoảng trắng về một dấu cách.
 *
 * Đây là phần quyết định guard có thấy được gì hay không, và bản đo đầu tiên đã
 * sai chính ở đây. `/db\.update\(/` **không** khớp lối viết chiếm đa số trong dự
 * án này:
 *
 *     await db
 *       .update(users)
 *
 * nên một guard tìm theo chuỗi liền sẽ báo an toàn cho gần hết các endpoint nó
 * đang soi. Bỏ chú thích trước khi tìm cũng cần thiết vì tệp này và nhiều tệp
 * khác **viết chính những mẫu bị cấm ra trong văn xuôi** để giải thích chúng.
 */
function normalizeSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\s+/g, ' ')
}

/** Ghi một hàng KHÁC dòng audit — tức là có cặp cần bọc. */
function writesItsOwnRow(normalized: string): boolean {
  return /\b(?:db|tx)\s*\.\s*(?:update|delete)\(/.test(normalized)
    || /\b(?:db|tx)\s*\.\s*insert\(\s*(?!activityLogs)/.test(normalized)
}

/** Dòng audit ghi trên pool (`db.insert(activityLogs)`), không phải trên `tx`. */
function auditsOnPool(normalized: string): boolean {
  return /\bdb\s*\.\s*insert\(\s*activityLogs\b/.test(normalized)
}

/**
 * Có cặp hàng + audit không nguyên tử.
 *
 * Có `db.transaction(` trong tệp CHƯA đủ: rà soát 2026-10-22 tìm thấy ba endpoint
 * (`home-sections/reorder.put.ts`, `pages/[id]/blocks/reorder.put.ts`,
 * `pages/[id]/publish.post.ts`) bọc lượt ghi trong transaction rồi ghi audit trên
 * pool **sau khi** transaction đã đóng — bản cũ của guard bỏ qua cả tệp chỉ vì
 * thấy chữ `db.transaction(`, nên cả ba đi qua.
 */
function unwrappedAuditPair(normalized: string): boolean {
  if (!writesAuditTable(normalized) || !writesItsOwnRow(normalized)) return false
  return !/\bdb\s*\.\s*transaction\(/.test(normalized) || auditsOnPool(normalized)
}

/**
 * The file WRITES `activity_logs` (2026-11-08). A `select … from(activityLogs)`, a join, a
 * count or an `activityLogs.<column>` is a read — a history page or a retention summary — and
 * asks no question about transactions. Fail closed: the named imports and the read shapes are
 * removed, and ANY mention left (an alias, `{ target: activityLogs }`) still counts as a write.
 */
function writesAuditTable(normalized: string): boolean {
  const withoutReads = normalized
    .replace(/\bimport\s+(?:type\s+)?\{[^}]*\}\s*from\s*(?:''|"")/g, ' ')
    .replace(/\.\s*(?:from|join|leftJoin|rightJoin|innerJoin|fullJoin|crossJoin)\(\s*activityLogs\s*[,)]/g, ' ')
    .replace(/\bactivityLogs\s*\.\s*[A-Za-z_$]/g, ' ')
  return /\bactivityLogs\b/.test(withoutReads)
}

describe('no admin endpoint writes a row and its audit row separately', () => {
  it('every audited mutation is either wrapped or exempt with a stated reason', () => {
    const root = 'server/api/admin'

    const walk = (dir: string): string[] => {
      const found: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) found.push(...walk(path))
        else if (entry.name.endsWith('.ts')) found.push(path)
      }
      return found
    }

    const offenders: string[] = []
    for (const file of walk(root)) {
      if (!unwrappedAuditPair(normalizeSource(read(file)))) continue
      const key = file.slice(`${root}/`.length)
      if (MUTATION_SCAN_EXEMPTIONS[key]) continue
      offenders.push(key)
    }

    assert.deepEqual(
      offenders,
      [],
      'ghi một hàng và dòng `activity_logs` của nó ngoài transaction — bọc lại, hoặc '
      + 'khai vào MUTATION_SCAN_EXEMPTIONS kèm lý do. Một danh sách liệt kê tên tệp thì '
      + 'xanh vĩnh viễn với tệp nó chưa biết; guard này quét cả thư mục chính vì thế.',
    )
  })

  /**
   * Phần phát hiện được kiểm chứng ngược trên mẫu dựng tay, vì một guard quét thư
   * mục mà không thấy gì thì **cũng xanh y hệt** một guard đang chạy đúng. Các mẫu
   * `caught` phải bị bắt, các mẫu `ignored` không được bị bắt.
   */
  it('the detector sees the multi-line style, and does not fire on comments', () => {
    const caught = [
      // Lối viết nhiều dòng — chiếm đa số trong repo này.
      'await db\n  .update(users)\n  .set({})\nawait db.insert(activityLogs).values({})',
      // Xoá rồi ghi log, cùng một dòng.
      'await db.delete(users); await db.insert(activityLogs).values({})',
      // Lượt ghi đã bọc, nhưng audit ghi trên pool sau khi transaction đóng.
      'await db.transaction(async (tx) => { await tx.update(users).set({}) })\nawait db.insert(activityLogs).values({})',
      // Như trên, lối viết nhiều dòng.
      'await db.transaction(async (tx) => {\n  await tx\n    .update(users)\n    .set({})\n})\nawait db\n  .insert(activityLogs)\n  .values({})',
    ]
    for (const sample of caught) {
      assert.ok(unwrappedAuditPair(normalizeSource(sample)), `bộ phát hiện bỏ sót một cặp ghi không bọc:\n${sample}`)
    }

    const ignored = [
      // Đã bọc.
      'await db.transaction(async (tx) => { await tx.update(users).set({}); await tx.insert(activityLogs).values({}) })',
      // Chỉ ghi audit, không có hàng nào khác — không có gì để làm nguyên tử.
      'await db.insert(activityLogs).values({})',
      // Mẫu bị cấm nằm trong CHÚ THÍCH: chính lối viết tệp này dùng để giải thích.
      '// await db.update(users) then db.insert(activityLogs) would be wrong\nawait db.insert(activityLogs).values({})',
    ]
    for (const sample of ignored) {
      assert.ok(!unwrappedAuditPair(normalizeSource(sample)), `bộ phát hiện báo sai trên mẫu hợp lệ:\n${sample}`)
    }

    // The per-function scanner (`_audit-atomicity-scan.ts`) sees every shape the regex
    // sees — the same samples, wrapped in a function, as a service would hold them.
    const asService = (body: string) => `import { activityLogs, users } from '../db/schema'\nexport async function act() {\n${body}\n}\n`
    for (const sample of caught) {
      const problems = unitProblems(scanUnits('sample.ts', asService(sample)), { auditOffTransaction: true })
      assert.ok(problems.length > 0, `the per-function scan misses a shape the regex catches:\n${sample}`)
    }
    for (const sample of ignored.slice(0, 1)) {
      assert.deepEqual(unitProblems(scanUnits('sample.ts', asService(sample)), { auditOffTransaction: true }), [], `the per-function scan objects to a wrapped pair:\n${sample}`)
    }
  })

  /**
   * Fix (3), 2026-11-08: a READ of `activity_logs` is not an audit. A retention summary or a
   * history page selects, joins and counts the table; asking it for a transaction made those
   * read-only endpoints impossible to move into a service honestly. Only a write counts — and
   * anything the narrowing cannot classify still counts as one (fail closed).
   */
  it('reading activity_logs asks no transaction question; an unclassifiable mention still does', () => {
    const reads = [
      'await db.select({ n: count() }).from(activityLogs).where(eq(activityLogs.userId, 1))\nawait db.update(users).set({})',
      'await db.select().from(users).leftJoin(activityLogs, eq(activityLogs.userId, users.id))\nawait db.delete(users)',
    ]
    for (const sample of reads) {
      assert.ok(!unwrappedAuditPair(normalizeSource(sample)), `a read of activity_logs is treated as an audit:\n${sample}`)
    }
    const failClosed = [
      'const t = { target: activityLogs }\nawait db.update(users).set({})',
      'await db.insert(activityLogs).values({})\nawait db.update(users).set({})',
    ]
    for (const sample of failClosed) {
      assert.ok(unwrappedAuditPair(normalizeSource(sample)), `an audit-table mention that is not a read dropped out of the scan:\n${sample}`)
    }
  })
})

/**
 * Các SERVICE ghi audit — nhóm bị bỏ sót cho tới lượt rà này.
 *
 * Ba danh sách phía trên liệt kê **đường dẫn cụ thể** trong `server/api/admin/**`,
 * nên toàn bộ `server/services/**` nằm ngoài tầm với của chúng, trừ sáu service
 * phía người đọc được nêu tên riêng. Bảy đường ghi thật đã sống ở đó không ai
 * canh: `deleteUserById`, `setUserActive`, `deletePageById`, `deleteMediaById`,
 * `deleteSubmissionById`, `updateChatbotSettings`/`clearChatbotApiKey`, và bốn
 * hàm trong `chatbot-small-talk.ts`. (`clearChatbotApiKey` đã xoá cùng route
 * `chatbot/settings/clear` không nơi gọi — CHANGELOG § 64; `chatbot-settings.ts`
 * vẫn ở danh sách vì `updateChatbotSettings`.)
 *
 * Nhóm này nghiêm trọng hơn nhóm endpoint theo một điểm **đo được**: cả năm hàm
 * xoá đều được gọi từ **cả** tuyến xoá một hàng **lẫn** tuyến `bulk-delete`
 * (`users/bulk-delete.post.ts`, `pages/`, `media/`, `submissions/`), nên một lượt
 * xoá hàng loạt nhân số cơ hội lỗi lên theo số bản ghi được chọn. `deleteSubmissionById`
 * là ca xấu nhất: nó xoá hồ sơ liên hệ của một công dân, và dòng audit là thứ duy
 * nhất còn lại sau đó.
 */
const AUDITED_SERVICES: string[] = [
  'server/services/users.ts',
  'server/services/pages.ts',
  'server/services/media.ts',
  'server/services/submissions.ts',
  'server/services/chatbot-settings.ts',
  'server/services/chatbot-small-talk.ts',
  // Vòng đời xử lý đơn: bốn đường ghi (xem lần đầu, đổi trạng thái, ghi chú, ghi
  // nhận đã liên hệ) và **cả bốn** ghi kèm một dòng `activity_logs`. Đây là hồ sơ
  // liên hệ của một công dân, nên câu "ai đã đóng hồ sơ này, lúc nào" phải trả lời
  // được — và một cặp ghi rời sẽ để lại một trạng thái đã đổi mà nhật ký nói là
  // chưa, hoặc ngược lại.
  'server/services/submission-workflow.ts',
  // Backup & khôi phục: tạo/xoá bản backup ghi hàng `backups` + audit trong một
  // transaction; khôi phục ghi `backup_restore` (kèm các hàng `backups` gắn lại)
  // trong một transaction và `backup_restore_failed` trong transaction riêng.
  // `backup.ts` là barrel từ 2026-10-25: mục này đọc CẢ nhóm tệp từng là nó
  // (`serviceSource`, `tests/_backup-service-family.ts`).
  BACKUP_BARREL,
  'server/services/backup-restore.ts',
]

/**
 * Text a service entry stands for. A service split into a barrel plus parts is
 * checked over ALL of its parts — the barrel alone holds no code, so reading only it
 * would pass vacuously, and reading one hand-picked part would miss a write moved to
 * another.
 */
const serviceSource = (file: string) => (file === BACKUP_BARREL ? backupServiceSource() : read(file))

describe('service-layer writes commit their mutation and their audit row together', () => {
  for (const file of AUDITED_SERVICES) {
    it(`${file.replace('server/services/', '')} wraps every audited write`, () => {
      const source = serviceSource(file)
      assert.match(source, /db\.transaction\(/, 'the write and its audit row are not atomic')
      // `chatbot-small-talk.ts` audits through a local `audit(store, …)` helper
      // whose PARAMETER is also named `db`, so a literal search for
      // `db.insert(activityLogs)` matches the helper body and reports a pool-level
      // write that does not exist. What decides atomicity there is the call site,
      // and that is asserted separately below. So the pool-write check is scoped
      // to files that write `activityLogs` inline.
      const auditsViaHelper = /async function audit\(/.test(source)
      if (!auditsViaHelper) {
        assert.ok(
          !/\bawait db\.insert\(activityLogs\)/.test(source),
          'a pool-level activityLogs insert remains; move it onto the tx handle',
        )
      }
      assert.ok(
        !/\baudit\(db,/.test(source),
        'the audit helper is still being handed the pool — pass `tx` so the row commits with the mutation',
      )
    })
  }
})

/**
 * The FUNCTIONS of the files above (and of every other named service file) that write an
 * audit row — one entry each (2026-11-08).
 *
 * The checks above read a file as a whole: `users.ts` passes while ONE of `deleteUserById`
 * and `setUserActive` still audits in a transaction, so the other could lose its audit row,
 * or move it onto the pool, and nothing turned red. Named here, each function is checked on
 * its own (`assertEntryShape`), and `every audited function of a named service file is
 * named` below fails when a function of these files starts — or stops — writing an audit row
 * without this list following.
 */
const AUDITED_SERVICE_FUNCTIONS: string[] = [
  'server/services/users.ts#deleteUserById',
  'server/services/users.ts#setUserActive',
  'server/services/pages.ts#deletePageById',
  'server/services/media.ts#deleteMediaById',
  'server/services/submissions.ts#deleteSubmissionById',
  'server/services/chatbot-settings.ts#updateChatbotSettings',
  // Through the file's `audit(store, …)` helper, handed `tx` — the scanner attributes the
  // helper's insert to each caller with the handle the caller passed.
  'server/services/chatbot-small-talk.ts#createSmallTalk',
  'server/services/chatbot-small-talk.ts#updateSmallTalk',
  'server/services/chatbot-small-talk.ts#setSmallTalkEnabled',
  'server/services/chatbot-small-talk.ts#deleteSmallTalk',
  'server/services/submission-workflow.ts#recordSubmissionView',
  'server/services/submission-workflow.ts#changeSubmissionStatus',
  'server/services/submission-workflow.ts#addSubmissionNote',
  'server/services/submission-workflow.ts#logSubmissionContact',
  'server/services/backup-catalog.ts#deleteBackup',
  'server/services/backup-run.ts#runBackup',
  'server/services/backup-restore.ts#runRestore',
  'server/services/backup-restore.ts#restoreUploaded',
  'server/services/backup-restore.ts#storeAndRestoreUpload',
  // readers.ts is named through AUDITED_WRITES; this is its one audited write not listed there.
  'server/services/readers.ts#setReaderEmailPreference',
]

describe('every audited function of a named service file is checked on its own', () => {
  for (const entry of AUDITED_SERVICE_FUNCTIONS) {
    it(`${entry.replace('server/services/', '')} writes its audit row on its own transaction`, () => {
      assertEntryShape(entry)
    })
  }
})

/**
 * Cổng quét cả THƯ MỤC, không chỉ danh sách tên ở trên.
 *
 * Đây là phần đợt trước thiếu, và nó thiếu theo cách không nhìn thấy được: ba
 * danh sách kia liệt kê đường dẫn, nên chúng **xanh vĩnh viễn** với bất cứ tệp
 * nào không ai nghĩ ra để thêm vào. Một service mới ghi cặp mutation + audit
 * không bọc sẽ đi qua toàn bộ bộ test này mà không có gì đỏ.
 *
 * Guard này thì ngược lại: nó tự tìm mọi tệp trong `server/services/**` có GHI
 * `activityLogs`, và đòi MỖI HÀM ghi dòng audit trên handle của một transaction —
 * **hoặc** hàm đó được nêu tên trong danh sách miễn trừ kèm lý do. Thêm một service
 * mới là buộc phải chọn một trong hai — không còn nhánh im lặng.
 *
 * Theo HÀM, không theo tệp (2026-11-08): bản cũ hỏi "tệp có chữ `db.transaction(`
 * không", nên một hàm thứ hai trong cùng tệp ghi audit trên pool (`getDb().insert(…)`,
 * hay một handle không tên `db`) đi qua nhờ transaction của hàm thứ nhất. Miễn trừ cả
 * tệp (`SERVICE_EXEMPTIONS`) còn lại đúng hai mục mà `tests/media-processing.test.ts`
 * ghim nguyên văn — hai tệp đó không ghi `activity_logs`, nên cổng quét theo lượt ghi
 * không còn hỏi chúng; các mục còn sống đã chuyển sang `SERVICE_POOL_AUDIT_EXEMPTIONS`
 * theo hàm. `article-views.ts` và `view-boost-scheduler.ts` đã bị gỡ: cả hai không còn
 * nhắc `activityLogs` (audit của lượt tăng lượt xem nằm trong transaction của
 * `articles/[id]/boost.post.ts` / `boost.delete.ts`, cùng lượt ghi qua `executor: tx`),
 * nên mục miễn cả tệp chỉ còn là một lối tắt chờ được dùng.
 */
const SERVICE_EXEMPTIONS: Record<string, string> = {
  // Hai tệp dưới đây **không ghi `activity_logs`** — chúng chỉ nhắc tới nó trong
  // phần đầu tệp, để giải thích vì sao chúng không ghi. Cổng quét từng khớp theo
  // chuỗi trên văn bản mã nguồn chứ không bỏ chú thích, nên nó bắt được lời giải
  // thích và hỏi một câu mà câu trả lời đúng là "không có lượt ghi nào để bọc".
  // Từ 2026-11-08 cổng chỉ hỏi tệp GHI bảng audit (AST), nên hai mục này không còn
  // miễn gì; giữ nguyên văn vì `tests/media-processing.test.ts` ghim chúng — sửa test
  // đó thì gỡ được cả hai.
  //
  // Hành động đáng ghi kiểm toán là **lượt tải lên**, và cặp hàng + nhật ký đó
  // nằm trong transaction của `completeUpload` (`server/services/chunked-upload-completion.ts`,
  // xuất lại qua barrel `chunked-upload.ts`).
  // Một lượt chuyển mã chạy hàng chục phút là sự kiện của máy, không phải hành
  // động của cán bộ, nên nó không có cặp hàng + audit nào để bọc.
  //
  // Mục này từng mang tên `video-processing.ts`. Từ khi tách tệp (wave2 5.4), tệp
  // đó chỉ còn là cửa vào re-export; `processMediaItem` và phần đầu tệp giải thích
  // (thứ cổng quét bắt) sống ở `video-transcode-pipeline.ts`.
  'video-transcode-pipeline.ts': 'holds no row+audit pair; the upload audit lives in chunked-upload-completion.ts own transaction',
  'media-processing-reaper.ts': 'holds no row+audit pair; a reclaim is a machine event, not an officer action',
}

/**
 * Miễn trừ "chỉ ghi audit" theo HÀM, không theo tệp.
 *
 * `auditCommentRead` chỉ ghi MỘT dòng audit "đã xem danh sách kiểm duyệt" —
 * không có hàng nghiệp vụ nào để nguyên tử cùng. Trước wave2 D-SPLIT nó nằm trong
 * `comments.ts` cùng các hàm có transaction nên cổng theo tệp không hỏi; tách tệp
 * làm nó lộ ra ở `comments-moderation.ts`, không phải mới. Cặp hàng + audit thật
 * của dịch vụ bình luận nằm ở `comments-deletion.ts`/`comments-admin-reply.ts`
 * (AUDITED_WRITES).
 *
 * Miễn theo TỆP (`SERVICE_EXEMPTIONS`) là sai ở đây: nó bỏ qua cả tệp, nên một
 * hành động "ẩn bình luận" thêm sau này vào cùng tệp — `db.execute(sql\`UPDATE …\`)`
 * rồi `db.insert(activityLogs)` trên pool — vẫn xanh, trong khi ở bản trước khi
 * tách cùng đoạn mã đó đỏ. Nên miễn trừ chỉ có hiệu lực khi TỆP đúng như tiền đề,
 * kiểm bằng AST (`auditOnlyFunctionProblems`): mọi tham chiếu `activityLogs` (trừ
 * import) nằm trong hàm được miễn, lời gọi ghi duy nhất của cả tệp là
 * `.insert(activityLogs)` trong hàm đó, và không hàm nào trong tệp gọi nó. Sai một
 * điều → tệp KHÔNG được miễn, các phép kiểm thường áp như mọi service khác, và
 * test riêng bên dưới nêu đúng điều sai.
 */
const AUDIT_ONLY_FUNCTION_EXEMPTIONS: Record<string, { fn: string, why: string }> = {
  'comments-moderation.ts': {
    fn: 'auditCommentRead',
    why: 'audit-only insert recording a read of the moderation list; no row write to pair it with',
  },
}

/** Lời gọi phương thức có thể ghi CSDL, trên bất kỳ handle nào (`db`, `tx`, `conn`, `getDb()`, `pool`…). */
const WRITE_METHODS = new Set(['insert', 'update', 'delete', 'execute', 'query', 'transaction'])
/** Hàm (gọi bằng tên) có dáng một lượt ghi — nằm ngoài hàm được miễn là tệp không còn "chỉ ghi audit". */
const WRITE_SHAPED_CALL = /^(?:delete|create|update|insert|set|ban|purge|hide|remove|save|write)/i

/** Query-builder steps that READ a table: `.from(activityLogs)`, `.leftJoin(activityLogs, …)`. */
const READ_STEPS = new Set(['from', 'join', 'leftJoin', 'rightJoin', 'innerJoin', 'fullJoin', 'crossJoin'])

/**
 * A READ of the audit table (fix 3, 2026-11-08): a column (`activityLogs.createdAt`) or the
 * table of a `from`/`join` step. A read service — a history page, a retention summary — keeps
 * its one read-audit insert exempt; anything else (an alias, `{ target: activityLogs }`)
 * still breaks the premise.
 */
function readsAuditTable(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return true
  return ts.isCallExpression(parent) && parent.arguments[0] === node
    && ts.isPropertyAccessExpression(parent.expression) && READ_STEPS.has(parent.expression.name.text)
}

/** `db.execute(sql\`SELECT …\`)`: a raw call whose SQL is a literal read. Anything else may write. */
function isReadQuery(node: ts.CallExpression): boolean {
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee) || (callee.name.text !== 'execute' && callee.name.text !== 'query')) return false
  const [first] = node.arguments
  let text: string | undefined
  if (first && ts.isTaggedTemplateExpression(first)) {
    text = ts.isNoSubstitutionTemplateLiteral(first.template) ? first.template.text : first.template.head.text
  } else if (first && ts.isStringLiteralLike(first)) text = first.text
  return text !== undefined && /^\s*(?:select|with|show)\b/i.test(text)
}

/**
 * Vì sao `source` KHÔNG còn đúng tiền đề "chỉ `fn` ghi, và chỉ ghi một dòng audit".
 * Mảng rỗng = miễn trừ giữ được. Phân tích AST (TypeScript compiler API): chú
 * thích và chuỗi không tính, mọi tên handle đều bị hỏi. Đọc bảng audit
 * (`readsAuditTable`) và câu SELECT thô (`isReadQuery`) ở hàm khác KHÔNG phá tiền
 * đề (2026-11-08): một service chỉ đọc — lịch sử, tóm tắt lưu trữ — vẫn giữ được
 * dòng audit "đã xem" của nó; mọi lượt ghi khác vẫn phá.
 */
function auditOnlyFunctionProblems(fileName: string, source: string, fn: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const allowed = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === fn,
  )
  if (!allowed) return [`${fn} is no longer declared in ${fileName}`]
  const inside = (node: ts.Node) => node.getStart(sourceFile) >= allowed.getStart(sourceFile) && node.end <= allowed.end
  const problems = new Set<string>()
  let auditInserts = 0

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return
    if (ts.isIdentifier(node)) {
      if (node.text === 'activityLogs' && !inside(node) && !readsAuditTable(node)) problems.add(`activityLogs referenced outside ${fn}`)
      // An in-file caller could pair its own write (through another module) with this audit row.
      if (node.text === fn && node !== allowed.name) problems.add(`${fn} is referenced inside the file — the audit could be paired with a write`)
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isPropertyAccessExpression(callee) && WRITE_METHODS.has(callee.name.text) && !isReadQuery(node)) {
        const [first] = node.arguments
        const isAudit = callee.name.text === 'insert' && first !== undefined && ts.isIdentifier(first) && first.text === 'activityLogs'
        if (isAudit && inside(node)) auditInserts += 1
        else problems.add(`.${callee.name.text}( call besides the one audit insert in ${fn}`)
      }
      if (ts.isIdentifier(callee) && WRITE_SHAPED_CALL.test(callee.text) && !inside(node)) problems.add(`call to write-shaped ${callee.text}(`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (auditInserts === 0) problems.add(`${fn} no longer inserts its audit row — drop the exemption`)
  return [...problems]
}

/** The scan's question for an exempted file: does the function-scoped premise still hold? */
function auditOnlyExemptionHolds(entry: string, source: string): boolean {
  const scoped = AUDIT_ONLY_FUNCTION_EXEMPTIONS[entry]
  return scoped !== undefined && auditOnlyFunctionProblems(entry, source, scoped.fn).length === 0
}

/**
 * Service CÓ `db.transaction(` nhưng vẫn còn dòng audit ghi trên pool.
 *
 * Cùng lỗ với guard endpoint phía trên: thấy chữ `db.transaction(` là cho qua cả
 * tệp, nên `article-translations.ts` (đánh dấu bản dịch "đang dịch" rồi ghi audit
 * trên pool, không bọc) đi qua cổng chỉ vì các hàm KHÁC trong tệp có bọc. Những
 * tệp dưới đây ghi audit trên pool một cách có chủ đích.
 *
 * Tệp ghi audit qua helper `audit(store, …)` (`chatbot-knowledge.ts`,
 * `chatbot-small-talk.ts`) có tham số tên `db` nên khớp chuỗi `db.insert(activityLogs)`
 * dù không ghi trên pool; tính nguyên tử ở đó do nơi gọi quyết định và đã được
 * khẳng định ở nhóm `AUDITED_SERVICES` (`audit(db,` bị cấm).
 *
 * Theo HÀM từ 2026-11-08 — khoá là `<tệp dưới server/services>#<hàm>`. Mục theo tệp cũ
 * (`'articles.ts'`) miễn cả tệp, nên một hàm thứ ba của `articles.ts` ghi audit trên pool
 * sẽ xanh; nay chỉ hai hàm được nêu tên. Helper `audit(store, …)` cục bộ (không export,
 * chỉ được gọi trực tiếp) không cần mục nào: bộ quét gán dòng audit của nó cho từng nơi
 * gọi, với đúng handle nơi gọi truyền vào. Mỗi mục phải miễn một hàm mà cổng quét đang
 * thật sự hỏi — mục chết làm test `… names only functions the scan flags` đỏ.
 */
const SERVICE_POOL_AUDIT_EXEMPTIONS: Record<string, string> = {
  // `deleteArticleById`/`setArticleStatus` chủ đích không bọc — khoá bởi test
  // `known exclusions are named` ở đầu tệp này.
  'articles.ts#deleteArticleById': 'named known exclusion (see known exclusions test)',
  'articles.ts#setArticleStatus': 'named known exclusion (see known exclusions test)',
  // Ghi lại một lượt XEM dữ liệu cá nhân người đọc (design.md D14) — chỉ một dòng audit,
  // không có hàng nghiệp vụ nào để nguyên tử cùng. Trước đây đi qua cổng theo tệp chỉ vì
  // viết `getDb().insert(…)` (không khớp `db.insert(`) — không phải vì đã được xét.
  'readers.ts#auditReaderRead': 'audit-only insert recording a read of reader personal data; no row write to pair it with',
  // `bulkTriggerTranslation` chỉ ghi MỘT dòng audit "đã yêu cầu dịch hàng loạt" rồi
  // đẩy việc sang nền; không có hàng nghiệp vụ nào được ghi cùng lúc để giữ nguyên
  // tử với nó. Các lượt ghi bản dịch xảy ra sau đó, ngoài request, trong worker
  // (`runBulkTranslation`, bộ quét thấy nó vì cùng tệp). Trước đây cùng đoạn này nằm
  // trong `article-translations.ts` (có transaction ở chỗ khác nên guard theo tệp không
  // thấy); tách tệp làm nó lộ ra, không phải mới. Chuyển từ SERVICE_EXEMPTIONS (cả tệp).
  'article-translation-bulk.ts#bulkTriggerTranslation': 'audit-only insert for a queued background job; no row write to pair it with',
  // Đồng bộ storage ghi audit TIẾN ĐỘ (mỗi đợt / tổng kết) bằng try/catch
  // best-effort — "audit hỏng không làm hỏng lượt sync đã thành công" là chủ đích.
  // Cặp hàng + thay URL + audit thật (đổi `provider`/`url` của một hàng `media`) nằm
  // trong `db.transaction` ở `media-sync-files.ts`. `media-sync-rewrite.ts` từng được
  // miễn (audit thay URL best-effort ngoài transaction); nay lượt thay URL và audit của
  // nó cùng transaction, nên tệp đó đi qua cổng như mọi service khác. Sau khi tách
  // (2026-11-06): audit tiến độ ở `media-sync-worker.ts` (hàm cục bộ `runLocked`, gán cho
  // `runSyncWorker`), audit tổng của đường cũ ở `media-sync-legacy.ts`. Chuyển từ
  // SERVICE_EXEMPTIONS (cả tệp).
  'media-sync-worker.ts#runSyncWorker': 'progress audits are best-effort by design; the row+audit pair is transactional in media-sync-files.ts',
  'media-sync-legacy.ts#syncMediaStorage': 'summary audit is best-effort by design; the row+audit pair is transactional in media-sync-files.ts',
  // Cùng hình với `media-sync-worker.ts`: job quét nền ghi audit TIẾN ĐỘ (mỗi lô / tổng kết,
  // ở hàm cục bộ `runScanWorker`) bằng try/catch best-effort. Cặp hàng `media` + audit
  // `create` của từng tệp nhập nằm trong `db.transaction` ở `media-scan-import.ts`.
  // Chuyển từ SERVICE_EXEMPTIONS (cả tệp).
  'media-scan.ts#startScanJob': 'progress/summary audits of a background scan job are best-effort by design; the row+audit pair is transactional in media-scan-import.ts',
}

/** The audit rules of the service layer: an audit row is written on a transaction handle. */
const SERVICE_AUDIT_RULES: ReadonlySet<Rule> = new Set(['audit-off-transaction', 'audit-off-transaction-with-row-write'])

/**
 * Every function of `server/services/**` that writes `activity_logs` off a transaction and
 * is not excused: `SERVICE_EXEMPTIONS` (whole file), the audit-only premise of
 * `AUDIT_ONLY_FUNCTION_EXEMPTIONS`, or `SERVICE_POOL_AUDIT_EXEMPTIONS` (one function).
 * An `activityLogs` reference the scanner cannot classify as a read or a write is an
 * offender on its own — the narrowing to WRITES fails closed.
 */
function serviceAuditOffenders(): { offenders: string[], excused: Set<string> } {
  const root = 'server/services'
  const offenders: string[] = []
  const excused = new Set<string>()
  for (const file of walkTs(root)) {
    const entry = file.slice(`${root}/`.length)
    const source = read(file)
    // In scope: the `activityLogs` identifier is written (or used unclassifiably), OR the AST
    // sees an audit insert the identifier check cannot — raw `INSERT INTO activity_logs`.
    if (!mayWriteAuditTable(file, source) && !fileWritesAuditRow(file)) continue
    if (SERVICE_EXEMPTIONS[entry]) continue
    for (const ref of auditTableReferences(file, source)) {
      if (ref.kind === 'unknown') offenders.push(`${entry}:${ref.line}: activityLogs used in a shape the scan cannot read as a read or a write — use it directly in .insert()/.from()/a column`)
    }
    const premise = auditOnlyExemptionHolds(entry, source) ? AUDIT_ONLY_FUNCTION_EXEMPTIONS[entry]!.fn : null
    for (const problem of unitProblems(unitsOf(file), { auditOffTransaction: true })) {
      if (!SERVICE_AUDIT_RULES.has(problem.rule)) continue
      const key = `${entry}#${problem.unit}`
      if (problem.unit === premise) continue
      if (SERVICE_POOL_AUDIT_EXEMPTIONS[key]) {
        excused.add(key)
        continue
      }
      offenders.push(`${key}: ${problem.detail}`)
    }
  }
  return { offenders, excused }
}

describe('no service writes activity_logs outside a transaction', () => {
  it('every audited service is either wrapped or exempt with a stated reason', () => {
    const { offenders } = serviceAuditOffenders()
    assert.deepEqual(
      offenders,
      [],
      'một HÀM ghi `activity_logs` không trên handle của transaction (không có transaction, '
      + 'hoặc có nhưng audit vẫn ghi trên pool / `getDb()` / handle khác) — bọc lại, hoặc khai '
      + 'vào SERVICE_POOL_AUDIT_EXEMPTIONS (`<tệp>#<hàm>`) hay AUDIT_ONLY_FUNCTION_EXEMPTIONS kèm '
      + 'lý do. Một danh sách liệt kê tên tệp thì xanh vĩnh viễn với tệp nó chưa biết; guard '
      + 'này quét cả thư mục (đệ quy), từng hàm, chính vì thế.',
    )
  })

  it('SERVICE_POOL_AUDIT_EXEMPTIONS names only functions the scan flags', () => {
    // A dead entry is a blanket waiting to be used: the function it names could start
    // writing a real row+audit pair on the pool and stay green.
    const { excused } = serviceAuditOffenders()
    assert.deepEqual(
      Object.keys(SERVICE_POOL_AUDIT_EXEMPTIONS).filter(key => !excused.has(key)),
      [],
      'these SERVICE_POOL_AUDIT_EXEMPTIONS entries excuse nothing the scan flags — drop them',
    )
  })

  it('a function-scoped audit-only exemption still holds', () => {
    for (const [entry, { fn }] of Object.entries(AUDIT_ONLY_FUNCTION_EXEMPTIONS)) {
      assert.ok(!SERVICE_EXEMPTIONS[entry], `${entry} must not also carry a whole-file exemption — that would skip the premise check`)
      assert.deepEqual(
        auditOnlyFunctionProblems(entry, read(join('server/services', entry)), fn),
        [],
        `${entry} được miễn vì chỉ ${fn} ghi một dòng audit — tiền đề không còn đúng, nên tệp bị xét như `
        + 'mọi service: bọc cặp hàng + audit trong transaction, hoặc đưa lượt ghi ra tệp khác',
      )
    }
  })

  /**
   * The detector, pinned on hand-made mutations of the real file — a scoped
   * exemption that misses a shape is green exactly like one that works.
   * X1–X5 / G12 are the verifier's mutations of the 5.5 split.
   */
  it('the scoped exemption is lost to a row write in any shape, on any handle', () => {
    const entry = 'comments-moderation.ts'
    const { fn } = AUDIT_ONLY_FUNCTION_EXEMPTIONS[entry]!
    const base = read(join('server/services', entry))
    const mutations: Record<string, string> = {
      // Raw UPDATE through execute, then an audit row on the pool.
      X1: 'export async function hideComment(id: number, actorId: number) {\n  const db = getDb()\n  await db.execute(sql`UPDATE article_comments SET is_hidden = 1 WHERE id = ${id}`)\n  await db.insert(activityLogs).values({ userId: actorId, action: \'hide\', resource: \'comments\', resourceId: id })\n}',
      // Same pair on a handle that is not called `db`.
      X2: 'export async function hideComment(id: number, actorId: number) {\n  const conn = getDb()\n  await conn.update(articleComments).set({ isHidden: true }).where(eq(articleComments.id, id))\n  await conn.insert(activityLogs).values({ userId: actorId, action: \'hide\', resource: \'comments\', resourceId: id })\n}',
      X3: 'export async function hideComment(id: number, actorId: number) {\n  const db = getDb()\n  await db.update(articleComments).set({ isHidden: true }).where(eq(articleComments.id, id))\n  await db.insert(activityLogs).values({ userId: actorId, action: \'hide\', resource: \'comments\', resourceId: id })\n}',
      X4: 'export async function hideComment(id: number, actorId: number) {\n  await getDb().update(articleComments).set({ isHidden: true }).where(eq(articleComments.id, id))\n  await getDb().insert(activityLogs).values({ userId: actorId, action: \'hide\', resource: \'comments\', resourceId: id })\n}',
      // The write happens in another service, the audit row here — still an unwrapped pair.
      X5: 'import { deleteComment as dc2 } from \'./comments-deletion\'\nexport async function removeAndLog(id: number, actorId: number) {\n  await dc2({ id, actor: { kind: \'system\', reason: \'retention\' } } as never)\n  await getDb().insert(activityLogs).values({ userId: actorId, action: \'delete\', resource: \'comments\', resourceId: id })\n}',
      // A second deletion path, no audit at all.
      G12: 'export async function purgeHidden() { await getDb().delete(articleComments).where(eq(articleComments.isHidden, true)) }',
      // A write elsewhere paired with the exempted audit function itself.
      caller: `export async function hideAndAudit(id: number, actorId: number) {\n  await hideElsewhere(id)\n  await ${fn}({ actorId, meta: { id } })\n}`,
      // A row write inside the exempted function.
      inside: base.replace('await getDb().insert(activityLogs)', 'await getDb().update(articleComments).set({ isHidden: true })\n  await getDb().insert(activityLogs)'),
    }
    assert.deepEqual(auditOnlyFunctionProblems(entry, base, fn), [], 'the clean file must keep its exemption')
    for (const [id, mutation] of Object.entries(mutations)) {
      const mutated = id === 'inside' ? mutation : `${base}\n${mutation}\n`
      assert.notEqual(mutated, base, `${id}: the mutation did not apply`)
      assert.ok(auditOnlyFunctionProblems(entry, mutated, fn).length > 0, `${id}: the scoped exemption still holds on a file that writes a row`)
      assert.equal(auditOnlyExemptionHolds(entry, mutated), false, `${id}: the directory scan would still skip this file`)
    }
  })
})

/**
 * Dịch vụ bình luận là MỘT họ tệp (`comments.ts` barrel + `comments-*.ts`, wave2
 * D-SPLIT). Trước khi tách, cả 1208 dòng nằm trong một tệp mà AUDITED_WRITES trỏ
 * tới; sau khi tách, mỗi tệp con ghi `activity_logs` phải được nêu tên — trong
 * AUDITED_WRITES (hàm ghi hàng + audit), AUDIT_ONLY_FUNCTION_EXEMPTIONS (miễn
 * theo hàm, tiền đề kiểm bằng AST) hoặc SERVICE_EXEMPTIONS (kèm lý do). Tập tệp
 * suy từ thư mục, nên tệp con thêm sau này cũng bị hỏi.
 */
describe('every comment-service file that writes activity_logs is named', () => {
  it('a comments*.ts touching activityLogs is in AUDITED_WRITES or exempt', () => {
    const files = commentServiceFiles()
    const auditing = files.filter(file => /activityLogs/.test(read(file)))
    assert.ok(auditing.length > 0, 'no comment-service file writes activity_logs — the scan is checking nothing')
    const unnamed = auditing.filter((file) => {
      const entry = file.replace('server/services/', '')
      return !AUDITED_WRITES.some(audited => audited.file === file)
        && !SERVICE_EXEMPTIONS[entry]
        && !AUDIT_ONLY_FUNCTION_EXEMPTIONS[entry]
    })
    assert.deepEqual(
      unnamed,
      [],
      'tệp con của dịch vụ bình luận ghi `activity_logs` mà không được nêu tên — thêm hàm ghi hàng + '
      + 'audit vào AUDITED_WRITES, hoặc khai miễn trừ kèm lý do',
    )
  })

  /**
   * The barrel holds re-exports and nothing else, so no code can sit where the
   * per-file guards above do not look for it. Checked on the AST: every statement
   * is a named `export { … } from './comments-…'` (type or value) — no
   * declaration, no import, no `export *` (which would also leak the sub-files'
   * internal exports into the public API).
   */
  it('comments.ts holds only named re-exports from ./comments-* sub-files', () => {
    assert.deepEqual(barrelProblems(read('server/services/comments.ts')), [])
  })

  it('the barrel check refuses code, star exports and foreign re-exports', () => {
    const base = read('server/services/comments.ts')
    for (const [id, mutated] of Object.entries({
      declaration: `${base}\nconst x = 1\n`,
      function: `${base}\nexport async function hide(): Promise<void> {}\n`,
      star: `${base}\nexport * from './comments-rules'\n`,
      foreign: `${base}\nexport { getDb } from '../utils/db'\n`,
      importThenExport: `import { sql } from 'drizzle-orm'\n${base}\nexport { sql }\n`,
    })) {
      assert.ok(barrelProblems(mutated).length > 0, `${id}: the barrel check accepted a non-re-export`)
    }
  })
})

function barrelProblems(source: string): string[] {
  const sourceFile = ts.createSourceFile('comments.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const problems: string[] = []
  if (sourceFile.statements.length === 0) problems.push('the barrel exports nothing')
  for (const statement of sourceFile.statements) {
    const text = statement.getText(sourceFile).slice(0, 60)
    if (!ts.isExportDeclaration(statement)) {
      problems.push(`not a re-export: ${text}`)
      continue
    }
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) problems.push(`not a NAMED re-export: ${text}`)
    const from = statement.moduleSpecifier
    if (!from || !ts.isStringLiteral(from) || !/^\.\/comments-[a-z-]+$/.test(from.text)) problems.push(`not re-exported from a ./comments-* sub-file: ${text}`)
  }
  return problems
}

/**
 * Câu hỏi mà KHÔNG cổng nào trong repo này từng đặt ra: "một endpoint quản trị
 * xoá dữ liệu thì có ghi lại rằng nó đã xoá không?"
 *
 * Ba cổng phía trên đều bắt đầu từ tiền đề "tệp có chạm `activityLogs`" rồi mới
 * hỏi tính nguyên tử. Một endpoint xoá hàng mà **không chạm `activityLogs` chút
 * nào** thì không có gì để chúng hỏi — nó đi qua toàn bộ bộ test này, đi qua
 * `typecheck`, đi qua `db:drift`, và không có gì đỏ ở đâu cả.
 *
 * Đó không phải giả thuyết. Hai endpoint xoá phiên trò chuyện đã sống ở đúng
 * khoảng trống này: `sessions/index.get.ts` ghi một dòng audit cho mỗi lượt
 * **xem** danh sách, còn hai đường **xoá** thì chỉ gọi `logInfo()` — một dòng
 * JSON ra stdout, không phải hàng trong bảng kiểm toán. Nghĩa là một cán bộ xem
 * danh sách phiên chat để lại dấu vết truy được ở `/admin/users/activity`, nhưng
 * cùng cán bộ đó xoá sạch những phiên ấy — kèm số điện thoại và câu hỏi của công
 * dân — thì trang đó không có gì. Chiều bất đối xứng đúng là chiều tệ nhất:
 * `logInfo` đi vào nhật ký tiến trình có thời hạn lưu riêng và không truy vấn
 * được từ giao diện, nên nó không thay thế được một hàng `activity_logs`.
 *
 * Guard này quét đệ quy `server/api/admin/**`, tìm mọi tệp **tự tay** xoá hàng
 * (`db.delete(` / `tx.delete(`), và đòi mỗi tệp đó **hoặc** GHI `activityLogs`,
 * **hoặc** được nêu tên kèm lý do.
 *
 * ⚠️ Câu cũ ở đây — "endpoint uỷ quyền cho một service không bị hỏi, chính service đó
 * đã bị guard phía trên canh" — SAI cho tới 2026-11-08: guard phía trên chỉ hỏi service
 * có chạm `activityLogs`, nên một service xoá hàng mà KHÔNG audit thì không ai hỏi.
 * `categories/[id].delete.ts` và `content-types/[id].delete.ts` sống đúng ở khoảng trống
 * đó từ khi lệnh xoá dời vào service (908c0e50). Nay cổng thứ hai bên dưới hỏi TỪNG HÀM
 * của `server/api/admin/**` và `server/services/**`: hàm xoá hàng (Drizzle hay SQL thô)
 * mà không ghi dòng audit nào thì đỏ — trừ helper cục bộ chỉ được gọi trực tiếp (xét ở
 * nơi gọi) và các mục nêu tên dưới đây. Khoá: đường dẫn dưới `server/api/admin/` (mục
 * cũ), hoặc `server/services/<tệp>#<hàm>`.
 */
const UNAUDITED_DELETE_EXEMPTIONS: Record<string, string> = {
  // (Mục `profile/mfa/enroll.post.ts` — "rolls back a half-created pending factor" — đã
  // gỡ 2026-11-08: lệnh xoá đó không còn từ ac0410a5, hàng `pending` được giữ để hết hạn;
  // mục chết là một lối tắt chờ được dùng, test `… names only deletes the scan flags` canh.)
  //
  // Danh mục Media Portal (`media_categories`) là cấu hình nhỏ — không chở dữ liệu
  // công dân, không phải phát ngôn công khai. Theo dõi mỗi lượt xoá tên danh mục
  // video không phải câu hỏi nhật ký kiểm toán phải trả lời; cùng lý do endpoint
  // tạo/sửa danh mục media không audit (xem `index.post.ts`). Dữ liệu công dân
  // nằm ở `media_items`/`submissions`/`reader_accounts`, đã được guard canh.
  'media-portal/categories/[id].delete.ts': 'media category is portal configuration, not citizen data — auditing its deletion is not an audit-log question',

  // ── server/services/** (2026-11-08), one FUNCTION each ─────────────────────────────
  // FINDING (để chủ repo quyết): cán bộ xoá một danh mục tin / một thể loại — qua tuyến
  // một hàng LẪN tuyến `bulk-delete` — và KHÔNG có dòng `activity_logs` nào ghi ai đã xoá.
  // Chưa từng được audit, kể cả trước 908c0e50 (khi lệnh xoá còn trong handler); cổng quét
  // endpoint không thấy vì handler chỉ gọi service, cổng quét service không hỏi vì tệp
  // không chạm `activityLogs`. Miễn ở đây để bộ test giữ màu hiện tại — KHÔNG phải vì đúng.
  'server/services/categories.ts#deleteCategoryById': 'FINDING: an admin deletes a news category (single and bulk routes) and no activity_logs row records who — never audited; owner to decide',
  'server/services/content-types.ts#deleteContentTypeById': 'FINDING: an admin deletes a content type (single and bulk routes) and no activity_logs row records who — never audited; owner to decide',
  // Đường xoá dùng chung (design.md D8). Nơi gọi duy nhất — `purgeReaderComments`
  // (readers.ts, AUDITED_WRITES) — truyền `tx` và ghi audit trong CHÍNH transaction đó;
  // test `deleteReaderComments has one caller …` bên dưới ghim điều đó.
  'server/services/comments-deletion.ts#deleteReaderComments': 'shared deletion path: its one caller, purgeReaderComments, deletes through it on its own transaction and audits in that transaction',
  // Máy chủ tự vệ: bỏ một câu trả lời đã cache mà lớp chặn chủ quyền vừa từ chối phát
  // lại. Dấu vết: log `chatbot.sovereignty_cached_answer_replaced` (+ thư cảnh báo) ở nơi gọi.
  'server/services/chatbot-answer-cache.ts#discardCachedAnswer': 'machine self-defence: drops a cached answer the sovereignty layer refused to replay; trail is the chatbot.sovereignty_cached_answer_replaced log at the caller',
  // Dọn cache câu trả lời theo nhịp (hết hạn / hàng chết / vượt trần). Hai hàm xuất của
  // tệp gọi tới nó đi qua cùng lượt xoá — miễn theo ĐƯỜNG xoá, không theo từng nơi gọi.
  'server/services/chatbot-answer-cache-prune.ts#pruneAnswerCache': 'timed prune of expired/dead/over-cap cache rows (a machine event); trail is the chatbot.answer_cache_pruned log with the counts',
  'server/services/backup-rotation.ts#rotateOldBackups': 'machine rotation of done backups beyond keepCount after a run; keepCount is set through the audited settings/backup.put.ts, failures log backup.rotate_failed',
  // Ghi lại (hoặc xoá) hàng `settings` nội bộ trạng thái scheduler sau khi khôi phục dump. Lượt
  // thành công: trong CHÍNH transaction ghi audit `backup_restore` (backup-restore.ts). Lượt hỏng:
  // một transaction riêng ở backup-restore-recovery.ts, dấu vết là log
  // `backup.restore_failed_scheduler_state_unwritten` khi hỏng, còn lượt khôi phục hỏng thì
  // `backup_restore_failed` đã được audit.
  'server/services/backup-scheduler.ts#keepSchedulerStateAcrossRestore': 'machine state (the scheduler-state settings row) restored after a dump: in the backup_restore audit transaction on success; alone on the failure path, where the failed restore is audited and a failed rewrite logs backup.restore_failed_scheduler_state_unwritten',
  'server/services/media-asset-cleanup.ts#processMediaAssetCleanup': 'outbox worker deleting cleanup tasks it finished; the replacement that queued them is audited in its own transaction (completeUpload)',
  'server/services/analytics-maintenance.ts#runAnalyticsMaintenance': 'nightly rebuild of derived analytics aggregates (delete-then-reinsert a day); each run is recorded in analytics_maintenance_runs',
  'server/services/data-retention.ts#runDataRetention': 'policy-driven retention purge (a machine event): counts banked in data_retention_state; the policy is audited by saveRetentionPolicy, a manual run by settings/retention-run.post.ts',
}

/** The file inserts an audit row somewhere (AST — an alias or a mere read does not count). */
function fileWritesAuditRow(file: string): boolean {
  return unitsOf(file).some(unit => unit.ownWrites.some(w => w.audit))
}

/** Exemption key of a delete-scan finding: the api-relative path, or `server/services/<file>#<fn>`. */
function deleteExemption(file: string, unit: string): string | undefined {
  const api = 'server/api/admin/'
  if (file.startsWith(api)) return UNAUDITED_DELETE_EXEMPTIONS[file.slice(api.length)] ? file.slice(api.length) : undefined
  return UNAUDITED_DELETE_EXEMPTIONS[`${file}#${unit}`] ? `${file}#${unit}` : undefined
}

/** Per-function deletes without an audit row, over `server/api/admin/**` and `server/services/**`. */
function unauditedDeletes(): { offenders: string[], excused: Set<string> } {
  const offenders: string[] = []
  const excused = new Set<string>()
  for (const file of [...walkTs('server/api/admin'), ...walkTs('server/services')]) {
    const isExcusedDeleter = (name: string) => deleteExemption(file, name) !== undefined
    for (const problem of unitProblems(unitsOf(file), { auditOffTransaction: false, excusedDeleter: isExcusedDeleter })) {
      if (problem.rule !== 'delete-without-audit') continue
      const key = deleteExemption(file, problem.unit)
      if (key) excused.add(key)
      else offenders.push(`${file}#${problem.unit}: ${problem.detail}`)
    }
  }
  return { offenders, excused }
}

describe('every admin endpoint that deletes rows records that it did', () => {
  it('each raw delete either writes activity_logs or is exempt with a stated reason', () => {
    const root = 'server/api/admin'

    const walk = (dir: string): string[] => {
      const found: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) found.push(...walk(path))
        else if (entry.name.endsWith('.ts')) found.push(path)
      }
      return found
    }

    const offenders: string[] = []
    for (const file of walk(root)) {
      const source = read(file)
      // Only files that delete rows themselves. A handler that calls a service
      // has no raw delete here; the service is asked by the per-function scan below.
      if (!/\b(?:db|tx)\.delete\(/.test(source)) continue
      // A WRITTEN audit row excuses the file, not a mention (2026-11-08): a file that only
      // reads activity_logs — or names it in prose — has recorded nothing.
      if (fileWritesAuditRow(file)) continue
      const key = file.slice(`${root}/`.length)
      if (UNAUDITED_DELETE_EXEMPTIONS[key]) continue
      offenders.push(key)
    }

    assert.deepEqual(
      offenders,
      [],
      'xoá hàng mà không ghi `activity_logs` — sau khi hàng mất thì dòng audit là '
      + 'bằng chứng duy nhất còn lại về việc ai đã xoá. `logInfo()` KHÔNG thay thế '
      + 'được: nó ra nhật ký tiến trình, không truy vấn được từ /admin/users/activity. '
      + 'Ghi audit, hoặc khai vào UNAUDITED_DELETE_EXEMPTIONS kèm lý do.',
    )
  })

  /**
   * The same question per FUNCTION, and over the services the deletes are moving into
   * (2026-11-08). A delete moved out of a handler used to drop out of the scan above —
   * and a service function that deletes without auditing was asked by nothing, because the
   * service scan started from "the file touches activityLogs". Now each function that
   * deletes a row (Drizzle `.delete(` on any handle, or raw `DELETE FROM`) must write an
   * audit row itself, or through a same-file helper it calls, or be named above.
   */
  it('each function that deletes rows, in admin endpoints and in services, writes activity_logs or is exempt', () => {
    assert.deepEqual(
      unauditedDeletes().offenders,
      [],
      'một HÀM xoá hàng mà không ghi dòng `activity_logs` nào — ghi audit trong cùng transaction, '
      + 'hoặc khai `server/services/<tệp>#<hàm>` vào UNAUDITED_DELETE_EXEMPTIONS kèm lý do '
      + '(lối máy chạy: nêu dấu vết thật — log event hay bảng trạng thái).',
    )
  })

  it('UNAUDITED_DELETE_EXEMPTIONS names only deletes the scan flags', () => {
    const { excused } = unauditedDeletes()
    const regexFlagged = new Set(walkTs('server/api/admin')
      .filter(file => /\b(?:db|tx)\.delete\(/.test(read(file)) && !fileWritesAuditRow(file))
      .map(file => file.slice('server/api/admin/'.length)))
    assert.deepEqual(
      Object.keys(UNAUDITED_DELETE_EXEMPTIONS).filter(key => !excused.has(key) && !regexFlagged.has(key)),
      [],
      'these UNAUDITED_DELETE_EXEMPTIONS entries excuse no delete any more — drop them',
    )
  })

  it('deleteReaderComments has one caller, which audits in the transaction it hands down', () => {
    // The exemption above rests on this: a second caller that deletes through it without
    // an audit row would be invisible to the per-function scan (another module).
    const callers = walkTs('server')
      .filter(file => file !== 'server/services/comments-deletion.ts' && file !== 'server/services/comments.ts')
      .filter(file => /\bdeleteReaderComments\(/.test(normalizeSource(read(file))))
    assert.deepEqual(callers, ['server/services/readers.ts'])
    const purge = unitNamed('server/services/readers.ts', 'purgeReaderComments')
    assert.match(purge.text, /deleteReaderComments\(params\.readerId, tx\)/)
    assert.ok(purge.writes.some(w => w.audit && w.onTx), 'purgeReaderComments no longer audits on its transaction')
  })

  it('the two chat-session delete paths audit on the transaction handle', () => {
    // Ghim đúng hai tệp đã từng ở trong khoảng trống trên, để một lần dọn dẹp sau
    // này không lặng lẽ đưa chúng về `logInfo` rồi lại xanh.
    for (const file of [
      'server/api/admin/chatbot/sessions/[id]/index.delete.ts',
      'server/api/admin/chatbot/sessions/bulk-delete.post.ts',
    ]) {
      const source = read(file)
      assert.match(source, /db\.transaction\(/, `${file}: lệnh xoá và dòng audit phải cùng commit`)
      assert.match(source, /tx\.insert\(activityLogs\)/, `${file}: dòng audit phải nằm trên handle tx`)
      assert.match(source, /tx\.delete\(/, `${file}: mở transaction nhưng xoá ở ngoài nó`)
      assert.ok(
        !/\bdb\.insert\(activityLogs\)/.test(source),
        `${file}: còn một lượt insert audit trên pool — nó commit độc lập`,
      )
      assert.match(
        source,
        /resource: 'chat_sessions'/,
        `${file}: phải dùng cùng resource với đường ĐỌC (sessions/index.get.ts), `
        + 'nếu không thì lọc theo đối tượng ở /admin/users/activity sẽ thấy lượt xem mà không thấy lượt xoá',
      )
    }
  })

  it('the delete audit records whether contact data went with it, but not the data itself', () => {
    // `hasContact` là boolean có chủ đích. Dòng audit ghi lại RẰNG có dữ liệu liên
    // hệ trong phần vừa xoá — đủ để đánh giá mức độ của một lượt xoá — mà không
    // nhân bản số điện thoại của công dân ra thêm một bảng có thời hạn lưu khác.
    for (const file of [
      'server/api/admin/chatbot/sessions/[id]/index.delete.ts',
      'server/api/admin/chatbot/sessions/bulk-delete.post.ts',
    ]) {
      const source = read(file)
      assert.match(source, /hasContact:/, `${file}: thiếu cờ hasContact`)
      assert.ok(
        !/meta:[\s\S]{0,400}detectedPhone:/.test(source),
        `${file}: số điện thoại đi vào meta — ghi cờ boolean, không ghi chính dữ liệu`,
      )
    }
  })
})

/**
 * Per-FUNCTION scans over every file the code is moving between (2026-11-08): all of
 * `server/api/**` and all of `server/services/**`, recursively.
 *
 * The directory scans above were written for handlers, one function per file, and read a
 * file as a whole. Moved into a service that groups a domain's functions, the same checks
 * pass a file while ANY one function still has its transaction and its audit row. These
 * scans read each top-level function on its own (`tests/_audit-atomicity-scan.ts`), and
 * attribute a same-file helper's writes to its callers with the handle each caller passes.
 */
describe('per-function scans follow the code into services', () => {
  /**
   * Inside ANY transaction callback, in any file of either tree, a write runs on that
   * transaction's handle — nothing to exempt today, so nothing may start. (The first-block
   * walk above read one transaction per listed file; `tests/transaction-pool-read-guard`
   * forbids pool READS by name; this asks the same of every write, on any handle.)
   */
  it('no write inside a transaction runs on a handle other than the transaction\'s', () => {
    const offenders: string[] = []
    for (const file of [...walkTs('server/api'), ...walkTs('server/services')]) {
      for (const problem of unitProblems(unitsOf(file), { auditOffTransaction: false })) {
        if (problem.rule === 'pool-write-in-transaction') offenders.push(`${file}#${problem.unit}: ${problem.detail}`)
      }
    }
    assert.deepEqual(offenders, [], 'a write inside a transaction block commits on its own — put it on the transaction handle')
  })

  /**
   * The row and its audit row in ONE transaction, per function:
   *   - an audit written off a transaction beside a row write (endpoints; the service layer
   *     is asked the same — and more — by `no service writes activity_logs outside a
   *     transaction` above), exempt only by MUTATION_SCAN_EXEMPTIONS (the cookie endpoints);
   *   - an audit row in a transaction that writes no row while the function writes its row
   *     elsewhere (in another transaction, or on the pool) — both trees. A transaction handed
   *     to another module's function (`addViews({ executor: tx })`) counts as writing there.
   */
  it('every function that writes a row and audits it does both in one transaction', () => {
    const offenders: string[] = []
    for (const file of [...walkTs('server/api'), ...walkTs('server/services')]) {
      const service = file.startsWith('server/services/')
      for (const problem of unitProblems(unitsOf(file), { auditOffTransaction: false })) {
        if (problem.rule === 'audit-transaction-without-row-write') {
          if (service && SERVICE_POOL_AUDIT_EXEMPTIONS[`${file.slice('server/services/'.length)}#${problem.unit}`]) continue
        } else if (problem.rule === 'audit-off-transaction-with-row-write') {
          if (service) continue // asked by the service-layer scan, with its function-scoped exemptions
        } else continue
        if (file.startsWith('server/api/admin/') && MUTATION_SCAN_EXEMPTIONS[file.slice('server/api/admin/'.length)]) continue
        offenders.push(`${file}#${problem.unit}: ${problem.detail}`)
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'một hàm ghi hàng và dòng audit không cùng một transaction — đưa cả hai vào cùng '
      + '`db.transaction(async (tx) => …)`, trên handle `tx`',
    )
  })

  /**
   * A service file named anywhere above is inventoried in full: every one of its functions
   * that writes an audit row is named — in AUDITED_WRITES, AUDITED_SERVICE_FUNCTIONS, a
   * `file#fn` entry of the delete/mutation lists, or a function-scoped exemption — and each
   * named one is checked on its own. So a second audited function added to a named file
   * cannot share the first one's checks, and either one losing its audit row (or moving it
   * onto the pool) turns red by name.
   */
  it('every audited function of a named service file is named', () => {
    const namedEntries = [
      ...AUDITED_WRITES.map(({ file, fn }) => `${file}#${fn}`),
      ...AUDITED_DELETE_ENDPOINTS.map(({ file }) => file),
      ...AUDITED_MUTATION_ENDPOINTS,
      ...AUDITED_SERVICE_FUNCTIONS,
      ...Object.keys(SERVICE_POOL_AUDIT_EXEMPTIONS).map(key => `server/services/${key}`),
      ...Object.entries(AUDIT_ONLY_FUNCTION_EXEMPTIONS).map(([file, { fn }]) => `server/services/${file}#${fn}`),
    ].filter(entry => entry.startsWith('server/services/'))
    const named = new Set(namedEntries.filter(entry => entry.includes('#')))
    const files = new Set([
      ...namedEntries.map(entry => target(entry).file),
      ...AUDITED_SERVICES.flatMap(file => (file === BACKUP_BARREL ? backupServiceFiles() : [file])),
    ])
    const unnamed: string[] = []
    for (const file of [...files].sort()) {
      for (const fn of auditingUnits(unitsOf(file))) if (!named.has(`${file}#${fn}`)) unnamed.push(`${file}#${fn}`)
    }
    assert.deepEqual(
      unnamed,
      [],
      'hàm ghi `activity_logs` trong một tệp service đã được nêu tên mà chính nó chưa được nêu — thêm '
      + '`<tệp>#<hàm>` vào AUDITED_SERVICE_FUNCTIONS (hoặc danh sách endpoint tương ứng)',
    )
  })
})

/**
 * The scanner itself, pinned on hand-made sources: a scan that misses a shape is green
 * exactly like one that works. Each case is a real service shape with one thing broken.
 */
describe('the per-function scanner sees what the per-file scans could not', () => {
  const header = "import { activityLogs, roles, permissions } from '../db/schema'\nimport { getDb } from '../utils/db'\n"
  const create = `export async function createRole(actorId: number, name: string) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.insert(roles).values({ name })
    await tx.insert(activityLogs).values({ userId: actorId, action: 'create', resource: 'roles' })
  })
}\n`
  const remove = `export async function deleteRole(actorId: number, id: number) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.delete(permissions).where(eq(permissions.roleId, id))
    await tx.delete(roles).where(eq(roles.id, id))
    await tx.insert(activityLogs).values({ userId: actorId, action: 'delete', resource: 'roles', resourceId: id })
  })
}\n`
  const dropAudit = (fn: string) => fn.replace(/\n {4}await tx\.insert\(activityLogs\)[^\n]*/, '')
  const problemsOf = (source: string) => unitProblems(scanUnits('fixture.ts', source), { auditOffTransaction: true })
    .map(p => `${p.unit}: ${p.rule}`)

  it('two audited functions in one file: clean, and each one breaks on its own', () => {
    const base = header + create + remove
    assert.deepEqual(problemsOf(base), [])
    assert.deepEqual(auditingUnits(scanUnits('fixture.ts', base)), ['createRole', 'deleteRole'])

    // The SECOND function's audit insert moved onto the pool, inside its tx block.
    const onPool = header + create + remove.replace('await tx.insert(activityLogs)', 'await db.insert(activityLogs)')
    assert.deepEqual(problemsOf(onPool), ['deleteRole: pool-write-in-transaction', 'deleteRole: audit-off-transaction-with-row-write'])
    // Same, spelled on `getDb()` — a shape the file-level regex never matched.
    const onGetDb = header + create + remove.replace('await tx.insert(activityLogs)', 'await getDb().insert(activityLogs)')
    assert.ok(problemsOf(onGetDb).includes('deleteRole: audit-off-transaction-with-row-write'))

    // The second function drops its audit row: it deletes and records nothing.
    assert.deepEqual(problemsOf(header + create + dropAudit(remove)), ['deleteRole: delete-without-audit'])
    // An INSERT/UPDATE that drops its audit breaks no rule — the inventory of named files
    // (`every audited function of a named service file is named`) is what names it.
    assert.deepEqual(auditingUnits(scanUnits('fixture.ts', header + dropAudit(create) + remove)), ['deleteRole'])
  })

  it('a row written in one transaction and audited in another is caught', () => {
    const split = `${header}export async function deleteRole(actorId: number, id: number) {
  const db = getDb()
  await db.transaction(async (tx) => { await tx.delete(roles).where(eq(roles.id, id)) })
  await db.transaction(async (tx) => { await tx.insert(activityLogs).values({ userId: actorId, action: 'delete', resource: 'roles' }) })
}\n`
    assert.deepEqual(problemsOf(split), ['deleteRole: audit-transaction-without-row-write'])
  })

  it('a pool write in the SECOND transaction of a function is caught', () => {
    const second = `${header}export async function rename(actorId: number, id: number) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.update(roles).set({ name: 'a' }).where(eq(roles.id, id))
    await tx.insert(activityLogs).values({ userId: actorId, action: 'update', resource: 'roles' })
  })
  await db.transaction(async (trx) => {
    await trx.update(roles).set({ name: 'b' }).where(eq(roles.id, id))
    await db.update(permissions).set({ canRead: true })
    await trx.insert(activityLogs).values({ userId: actorId, action: 'update', resource: 'roles' })
  })
}\n`
    assert.deepEqual(problemsOf(second), ['rename: pool-write-in-transaction'])
  })

  it('a same-file audit helper is judged at its callers, with the handle each one passes', () => {
    const helper = `async function audit(db: Store, actorId: number) {
  await db.insert(activityLogs).values({ userId: actorId, action: 'delete', resource: 'roles' })
}\n`
    const caller = (handle: string) => `export async function deleteRole(actorId: number, id: number) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.delete(roles).where(eq(roles.id, id))
    await audit(${handle}, actorId)
  })
}\n`
    assert.deepEqual(problemsOf(header + helper + caller('tx')), [])
    assert.deepEqual(problemsOf(header + helper + caller('db')), [
      'deleteRole: pool-write-in-transaction',
      'deleteRole: audit-off-transaction-with-row-write',
    ])
    // Passed by value, its callers cannot all be seen: the helper is judged on its own.
    assert.ok(problemsOf(`${header + helper + caller('tx')}export const auditor = audit\n`).includes('audit: audit-off-transaction'))
  })

  it('reading activity_logs is not an audit; an unclassifiable reference is reported', () => {
    const reads = `export async function history(userId: number) {
  return getDb().select({ id: activityLogs.id, n: count() }).from(activityLogs)
    .leftJoin(roles, eq(activityLogs.userId, roles.id)).where(eq(activityLogs.userId, userId))
}\n`
    const readAudit = `export async function auditHistoryRead(actorId: number) {
  await getDb().insert(activityLogs).values({ userId: actorId, action: 'read', resource: 'activity_logs' })
}\n`
    assert.deepEqual(problemsOf(header + reads), [])
    assert.equal(mayWriteAuditTable('fixture.ts', header + reads), false)
    assert.deepEqual(auditTableReferences('fixture.ts', header + reads).map(r => r.kind), ['read', 'read', 'read', 'read'])
    // A read service with its one read-audit insert: only that insert is asked about, and
    // the AUDIT_ONLY_FUNCTION_EXEMPTIONS premise holds despite the reads beside it.
    assert.deepEqual(problemsOf(header + reads + readAudit), ['auditHistoryRead: audit-off-transaction'])
    assert.deepEqual(auditOnlyFunctionProblems('fixture.ts', header + reads + readAudit, 'auditHistoryRead'), [])
    const aliased = `${header}const target = { table: activityLogs }\n`
    assert.deepEqual(auditTableReferences('fixture.ts', aliased).map(r => r.kind), ['unknown'])
    assert.equal(mayWriteAuditTable('fixture.ts', aliased), true, 'an unclassifiable reference must keep the file in scope')
  })

  it('a raw INSERT INTO activity_logs is an audit row, and keeps its file in the service scan', () => {
    const raw = `${header}export async function hide(id: number, actorId: number) {
  const db = getDb()
  await db.update(roles).set({ name: 'x' }).where(eq(roles.id, id))
  await db.execute(sql\`INSERT INTO activity_logs (user_id, action, resource) VALUES (\${actorId}, 'hide', 'roles')\`)
}\n`
    assert.deepEqual(problemsOf(raw), ['hide: audit-off-transaction-with-row-write'])
    // The identifier check alone would skip this file: the gate also asks the AST.
    assert.equal(mayWriteAuditTable('fixture.ts', raw), false)
    assert.ok(scanUnits('fixture.ts', raw).some(unit => unit.ownWrites.some(w => w.audit)))
  })

  it('a raw DELETE held in a const is still a delete', () => {
    const raw = `${header}export async function purge(conn: Conn, table: string) {
  const statement = \`DELETE FROM \${table} WHERE created_at < ?\`
  await conn.query(statement, [new Date()])
}\n`
    assert.deepEqual(problemsOf(raw), ['purge: delete-without-audit'])
  })
})
