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

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

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
  { file: 'server/services/comments.ts', fn: 'deleteComment', why: 'a public comment vanishes with no record of who removed it' },
  { file: 'server/services/readers.ts', fn: 'banReader', why: 'a flag set without the deletion leaves comments under a banned name' },
  { file: 'server/services/readers.ts', fn: 'deleteReader', why: 'an account and its comment history disappear untraceably' },
  { file: 'server/services/readers.ts', fn: 'purgeReaderComments', why: 'every comment a citizen wrote is removed with nothing recording it' },
  { file: 'server/services/readers.ts', fn: 'unbanReader', why: 'the account becomes unbanned with nothing recording who did it or when' },
  { file: 'server/services/ip-bans.ts', fn: 'createIpBan', why: 'a ban in force that no log explains cannot be lifted with confidence' },
  { file: 'server/services/ip-bans.ts', fn: 'deleteIpBan', why: 'the stored value is the only evidence of what was un-banned' },
  { file: 'server/services/google-oauth-settings.ts', fn: 'updateGoogleOAuthSettings', why: '"who turned Google sign-in on, and when" becomes unanswerable' },
  { file: 'server/services/google-oauth-settings.ts', fn: 'clearGoogleOAuthSecret', why: 'credentials are dropped with no record of it' },
  { file: 'server/services/articles.ts', fn: 'setArticleCommentsEnabled', why: 'a thread opens or closes with nobody accountable' },
  { file: 'server/services/comments.ts', fn: 'createAdminReply', why: 'an administrator\'s public reply exists with no record of which admin posted it' },
  // A rename is a write to a citizen's personal data, and it is the one audited
  // path here whose actor is NOT a member of staff — see the `userId: null` note in
  // renameReader for why the reader's id goes in `meta` instead of the user column.
  // "Who was this account called before, and when did that change" has to stay
  // answerable: a moderator acting on a report about a name needs to be able to
  // tell a renamed account from the wrong account.
  { file: 'server/services/readers.ts', fn: 'renameReader', why: 'a display name changes on every comment already published with nothing recording the old one' },
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
    const body = functionBody(read('server/services/comments.ts'), 'deleteReaderComments')
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
    file: 'server/api/admin/roles/[id].delete.ts',
    why: 'a permission role is destroyed with nothing recording who removed it',
  },
  {
    file: 'server/api/admin/users/[id]/mfa.delete.ts',
    why: "another administrator's second factors are stripped and the override leaves no trace",
  },
  {
    file: 'server/api/admin/pages/[id]/blocks/[blockId].delete.ts',
    why: 'a block disappears from a live page with nobody accountable',
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
      const source = read(file)

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
  'server/api/admin/home-sections/[id].put.ts',
  'server/api/admin/home-sections/[id]/toggle.patch.ts',
  'server/api/admin/media/upload.post.ts',
  'server/api/admin/pages/[id].put.ts',
  'server/api/admin/pages/[id]/blocks/[blockId].put.ts',
  'server/api/admin/pages/[id]/blocks/index.post.ts',
  'server/api/admin/pages/[id]/versions/[versionId]/restore.post.ts',
  'server/api/admin/pages/index.post.ts',
  'server/api/admin/roles/index.post.ts',
  'server/api/admin/settings/index.put.ts',
  'server/api/admin/settings/navigation.put.ts',
  'server/api/admin/settings/navigation/mobile.put.ts',
  'server/api/admin/settings/navigation/navbar.put.ts',
  'server/api/admin/users/[id].put.ts',
  'server/api/admin/users/index.post.ts',
]

describe('admin mutation endpoints commit their write and their audit row together', () => {
  for (const file of AUDITED_MUTATION_ENDPOINTS) {
    it(`${file.replace('server/api/admin/', '')} wraps both in one transaction`, () => {
      const source = read(file)
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
   */
  it('no pool-level write survives inside a transaction block', () => {
    for (const file of AUDITED_MUTATION_ENDPOINTS) {
      const source = read(file)
      const start = source.indexOf('db.transaction(')
      let depth = 0, started = false, end = start
      for (let i = start; i < source.length; i++) {
        if (source[i] === '{') { depth++; started = true }
        else if (source[i] === '}') depth--
        if (started && depth === 0) { end = i; break }
      }
      const body = source.slice(start, end)
      assert.ok(!/\bdb\.(insert|update|delete)\(/.test(body),
        `${file} performs a pool-level write inside its transaction — it commits independently`)
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
  ]) {
    it(`${file.replace('server/api/admin/', '')} still writes a cookie mid-request`, () => {
      const source = read(file)
      assert.match(source, /setSessionCookie\(|deleteCookie\(|setCookie\(/,
        'the cookie write is gone — re-evaluate whether this endpoint can now be wrapped in a transaction')
    })
  }
})

/**
 * Các SERVICE ghi audit — nhóm bị bỏ sót cho tới lượt rà này.
 *
 * Ba danh sách phía trên liệt kê **đường dẫn cụ thể** trong `server/api/admin/**`,
 * nên toàn bộ `server/services/**` nằm ngoài tầm với của chúng, trừ sáu service
 * phía người đọc được nêu tên riêng. Bảy đường ghi thật đã sống ở đó không ai
 * canh: `deleteUserById`, `setUserActive`, `deletePageById`, `deleteMediaById`,
 * `deleteSubmissionById`, `updateChatbotSettings`/`clearChatbotApiKey`, và bốn
 * hàm trong `chatbot-small-talk.ts`.
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
]

describe('service-layer writes commit their mutation and their audit row together', () => {
  for (const file of AUDITED_SERVICES) {
    it(`${file.replace('server/services/', '')} wraps every audited write`, () => {
      const source = read(file)
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
 * Cổng quét cả THƯ MỤC, không chỉ danh sách tên ở trên.
 *
 * Đây là phần đợt trước thiếu, và nó thiếu theo cách không nhìn thấy được: ba
 * danh sách kia liệt kê đường dẫn, nên chúng **xanh vĩnh viễn** với bất cứ tệp
 * nào không ai nghĩ ra để thêm vào. Một service mới ghi cặp mutation + audit
 * không bọc sẽ đi qua toàn bộ bộ test này mà không có gì đỏ.
 *
 * Guard này thì ngược lại: nó tự tìm mọi tệp trong `server/services/` có chạm
 * `activityLogs`, và đòi mỗi tệp đó **hoặc** có `db.transaction(`, **hoặc** được
 * nêu tên trong danh sách miễn trừ kèm lý do. Thêm một service mới là buộc phải
 * chọn một trong hai — không còn nhánh im lặng.
 */
const SERVICE_EXEMPTIONS: Record<string, string> = {
  // Ghi audit cho một lượt tăng lượt xem ảo đã do người gọi mở transaction; bọc
  // lần thứ hai ở đây là lồng transaction chứ không thêm bảo đảm nào.
  'article-views.ts': 'audits inside the caller-provided transaction',
  'view-boost-scheduler.ts': 'audits inside the caller-provided transaction',
}

describe('no service writes activity_logs outside a transaction', () => {
  it('every audited service is either wrapped or exempt with a stated reason', () => {
    const dir = 'server/services'
    const offenders: string[] = []
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.ts')) continue
      const source = read(join(dir, entry))
      if (!/activityLogs/.test(source)) continue
      if (/db\.transaction\(/.test(source)) continue
      if (SERVICE_EXEMPTIONS[entry]) continue
      offenders.push(entry)
    }
    assert.deepEqual(
      offenders,
      [],
      'ghi `activity_logs` mà không có `db.transaction(` — bọc lại, hoặc khai vào '
      + 'SERVICE_EXEMPTIONS kèm lý do. Một danh sách liệt kê tên tệp thì xanh vĩnh viễn '
      + 'với tệp nó chưa biết; guard này quét cả thư mục chính vì thế.',
    )
  })
})

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
 * (`db.delete(` / `tx.delete(`), và đòi mỗi tệp đó **hoặc** chạm `activityLogs`,
 * **hoặc** được nêu tên kèm lý do. Endpoint uỷ quyền cho một service (như
 * `knowledge/[id].delete.ts` → `deleteKnowledge`) không có lệnh xoá thô nào nên
 * không bị hỏi — chính service đó đã bị guard phía trên canh.
 */
const UNAUDITED_DELETE_EXEMPTIONS: Record<string, string> = {
  // Xoá một factor `pending` của CHÍNH tài khoản đang đăng nhập khi lượt gửi mã
  // OTP thất bại. Đây là dọn một hàng vừa tạo dở, không phải phá bản ghi: không
  // có trạng thái nào tồn tại trước request này để mà mất, và lượt bật yếu tố
  // thành công thì đã có dòng audit riêng của nó.
  'profile/mfa/enroll.post.ts': 'rolls back a half-created pending factor it just wrote itself',
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
      // has no raw delete here, and the service is covered by the guard above.
      if (!/\b(?:db|tx)\.delete\(/.test(source)) continue
      if (/activityLogs/.test(source)) continue
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
