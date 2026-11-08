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
import { join, relative, sep } from 'node:path'
import { describe, it } from 'node:test'
import ts from 'typescript'
import {
  auditCensus, auditCensusOf, auditTableReferences, auditingUnits, censusCounts, mayWriteAuditTable, scanUnits, unitProblems,
  type CensusResult, type Rule, type UnitFacts, type UnitProblem,
} from './_audit-atomicity-scan'
import { BACKUP_BARREL, backupServiceFiles, backupServiceSource } from './_backup-service-family'
import { ROOT as CALL_SITES_ROOT, directCallSites, repoSourceIndex } from './_call-sites'
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
const AUDITED_DELETE_ENDPOINTS: Array<{ file: string, handler: string, why: string }> = [
  {
    // The transaction of roles/[id].delete.ts, moved out of the handler. Named by FUNCTION:
    // the checks below then read that function alone, whatever else the file holds.
    file: 'server/services/admin-role-delete.ts#deleteRoleWithAudit',
    handler: 'roles/[id].delete.ts',
    why: 'a permission role is destroyed with nothing recording who removed it',
  },
  {
    file: 'server/services/admin-user-mfa-reset.ts#clearUserMfaFactors',
    handler: 'users/[id]/mfa.delete.ts',
    why: "another administrator's second factors are stripped and the override leaves no trace",
  },
  {
    file: 'server/services/admin-page-versions.ts#deletePageVersionWithAudit',
    handler: 'pages/[id]/versions/[versionId].delete.ts',
    why: 'a saved backup is discarded untraceably',
  },
  {
    file: 'server/services/admin-page-versions.ts#savePageVersionWithAudit',
    handler: 'pages/[id]/versions/index.post.ts',
    why: 'the origin path deletes the old baseline before writing the new one — a failure between them leaves the page with no baseline at all',
  },
  // The next four were guarded by the endpoint directory scans below until their transactions
  // moved out of their handlers (chatbot/sessions/[id]/index.delete.ts, sessions/bulk-delete.post.ts,
  // answer-cache/[key].delete.ts, answer-cache/bulk-delete.post.ts); named by FUNCTION here.
  {
    file: 'server/services/admin-chatbot-session-delete.ts#deleteChatSessionWithAudit',
    handler: 'chatbot/sessions/[id]/index.delete.ts',
    why: "a citizen's chat transcript (phone, name, questions) disappears with nothing recording who removed it",
  },
  {
    file: 'server/services/admin-chatbot-session-delete.ts#bulkDeleteChatSessionsWithAudit',
    handler: 'chatbot/sessions/bulk-delete.post.ts',
    why: 'up to 100 citizen conversations disappear with nothing recording who removed them',
  },
  {
    file: 'server/services/admin-chatbot-answer-cache-admin.ts#deleteCachedAnswerWithAudit',
    handler: 'chatbot/answer-cache/[key].delete.ts',
    why: 'a cached answer the portal was replaying to citizens is dropped untraceably',
  },
  {
    file: 'server/services/admin-chatbot-answer-cache-admin.ts#bulkDeleteCachedAnswersWithAudit',
    handler: 'chatbot/answer-cache/bulk-delete.post.ts',
    why: 'up to 200 cached answers are dropped untraceably',
  },
  // profile/mfa/recovery-codes.delete.ts: its transaction moved here (2026-11-08); the delete runs
  // through deleteAllRecoveryCodes(admin.id, tx), the audit row on the same `tx`.
  {
    file: 'server/services/admin-mfa-recovery-codes-clear.ts#clearRecoveryCodesWithAudit',
    handler: 'profile/mfa/recovery-codes.delete.ts',
    why: "every recovery code — the last way back into a locked account — is gone with nothing recording who removed them",
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

/**
 * The cookie-between-writes endpoints (2026-11-08: moved into services WITHOUT a new transaction).
 *
 * These endpoints write an HTTP cookie BETWEEN two database writes, on purpose: the session cookie
 * is re-issued after the mutation and before the audit row. A cookie is a side effect on the
 * response that no rollback can retract, so wrapping the pair in one transaction would create a
 * worse state than the one it fixes — a cookie already handed to the browser for a change that was
 * rolled back. `auth/logout.post.ts` has no cookie between its writes (the cookie is deleted after
 * both); its two writes are independent best-effort statements, each in its own try/catch, and a
 * transaction would let a failed audit roll back the token invalidation.
 *
 * Their DB statements moved into services; the order stayed in the handler. Asserted rather than
 * assumed, on the handler (comments and strings blanked — prose naming the calls must not satisfy
 * it): every step is CALLED, once, in this order, and the handler writes nothing itself. And on
 * each function a step stands for (AST): the write is still in it — the row write (on a transaction
 * handle where the original used one) — and the audit function writes exactly ONE row, the audit
 * row, off any transaction. Its `SERVICE_POOL_AUDIT_EXEMPTIONS` entry excuses that and nothing
 * else: a row write added to it, or the cookie moved out from between the calls, turns this red —
 * and the endpoint should then be wrapped in a transaction.
 */
const COOKIE_BETWEEN_WRITES: Array<{ handler: string, order: string[], writes: Array<{ entry: string, shape: 'row' | 'row-on-tx' | 'audit-only' }> }> = [
  {
    handler: 'server/api/admin/profile/mfa/confirm.post.ts',
    order: ['activatePendingFactor({', 'revokeSessions(admin.id)', 'setSessionCookie(event,', 'auditMfaFactorEnabled(admin.id,'],
    writes: [
      { entry: 'server/services/admin-mfa-confirm.ts#activatePendingFactor', shape: 'row-on-tx' },
      { entry: 'server/utils/mfa/factors.ts#revokeSessions', shape: 'row' },
      { entry: 'server/services/admin-mfa-confirm.ts#auditMfaFactorEnabled', shape: 'audit-only' },
    ],
  },
  {
    handler: 'server/api/admin/profile/mfa/recovery-codes.post.ts',
    order: ['issueRecoveryCodes(admin.id)', 'revokeSessions(admin.id)', 'setSessionCookie(event,', 'auditRecoveryCodesGenerated(admin.id,'],
    writes: [
      { entry: 'server/utils/mfa/recovery-codes.ts#issueRecoveryCodes', shape: 'row-on-tx' },
      { entry: 'server/utils/mfa/factors.ts#revokeSessions', shape: 'row' },
      { entry: 'server/services/admin-mfa-recovery-codes-issue.ts#auditRecoveryCodesGenerated', shape: 'audit-only' },
    ],
  },
  {
    // Re-issues this session's cookie after bumping tokenVersion, so the caller is not logged out
    // by their own successful password change. Found by the directory scan, which is the point of
    // having one.
    handler: 'server/api/admin/profile/password.put.ts',
    order: ['updateOwnPassword(admin,', 'clearRateLimit(bucket, deps)', 'readOwnTokenVersion(admin)', 'setSessionCookie(event,', 'auditOwnPasswordChange(admin,'],
    writes: [
      { entry: 'server/services/admin-profile-password.ts#updateOwnPassword', shape: 'row' },
      { entry: 'server/services/admin-profile-password.ts#auditOwnPasswordChange', shape: 'audit-only' },
    ],
  },
  {
    handler: 'server/api/admin/auth/logout.post.ts',
    order: ['try { await bumpAdminTokenVersion(adminUser.id) } catch', 'try { await auditAdminLogout(adminUser.id,', 'deleteCookie(event,'],
    writes: [
      { entry: 'server/services/admin-auth-logout.ts#bumpAdminTokenVersion', shape: 'row' },
      { entry: 'server/services/admin-auth-logout.ts#auditAdminLogout', shape: 'audit-only' },
    ],
  },
]

describe('cookie-between-writes endpoints keep their order, with no transaction across the cookie', () => {
  for (const { handler, order, writes } of COOKIE_BETWEEN_WRITES) {
    it(`${handler.replace('server/api/admin/', '')}: ${order.length} steps called once each, in order; each write still in its function`, () => {
      const code = normalizeSource(read(handler))
      let previous = -1
      for (const step of order) {
        const at = code.indexOf(step)
        assert.ok(at !== -1, `${handler}: \`${step}\` is no longer called — re-evaluate whether this endpoint can now be wrapped in a transaction`)
        assert.equal(code.indexOf(step, at + 1), -1, `${handler}: \`${step}\` is called more than once`)
        assert.ok(at > previous, `${handler}: \`${step}\` now runs before the step listed ahead of it — the cookie is no longer between the writes (re-evaluate: wrap the endpoint in a transaction)`)
        previous = at
      }
      assert.deepEqual(unitsOf(handler).flatMap(unit => unit.writes).map(w => `line ${w.line}`), [], `${handler} writes to the database itself again`)
      assert.ok(!/\.transaction\(/.test(code), `${handler} opens a transaction — one spanning the cookie cannot retract it`)

      for (const { entry, shape } of writes) {
        const { file, fn } = target(entry)
        const unit = unitNamed(file, fn!)
        if (shape === 'audit-only') {
          assert.deepEqual(unit.writes.map(w => ({ audit: w.audit, onTx: w.onTx })), [{ audit: true, onTx: false }],
            `${entry} must write exactly its audit row, on the pool — its SERVICE_POOL_AUDIT_EXEMPTIONS entry excuses that and nothing else`)
        } else {
          const rows = unit.writes.filter(w => !w.audit)
          assert.ok(rows.length > 0, `${entry} no longer writes the row this step stands for`)
          assert.ok(unit.writes.every(w => !w.audit), `${entry} now also writes an audit row — the pair moved; re-evaluate this endpoint`)
          if (shape === 'row-on-tx') assert.ok(rows.every(w => w.onTx), `${entry} writes a row off its transaction handle`)
        }
      }
    })
  }
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
 * DELIBERATELY EXCLUDED, and asserted separately above (COOKIE_BETWEEN_WRITES):
 *   • profile/mfa/confirm.post.ts, profile/mfa/recovery-codes.post.ts,
 *     profile/password.put.ts, auth/logout.post.ts — each writes an HTTP cookie
 *     between the two database writes (logout: two independent best-effort
 *     writes). A cookie is a side effect on the response that no rollback can
 *     retract, so wrapping would create a worse state than it fixes.
 *   (articles/[id]/boost.post.ts used to be listed here. It writes no cookie, and both
 *   of its paths already wrote the change and the audit row in one transaction; since
 *   2026-11-08 those transactions are in admin-article-boost.ts, named below.)
 */
const AUDITED_MUTATION_ENDPOINTS: Array<{ entry: string, handler: string }> = [
  { entry: 'server/services/admin-article-write.ts#updateArticleWithAudit', handler: 'articles/[id].put.ts' },
  { entry: 'server/services/admin-article-write.ts#createArticleWithAudit', handler: 'articles/index.post.ts' },
  // articles/[id]/boost.delete.ts: guarded by the endpoint directory scan below until its transaction moved here
  { entry: 'server/services/admin-article-boost.ts#cancelBoostWithAudit', handler: 'articles/[id]/boost.delete.ts' },
  // articles/[id]/boost.post.ts (instant / gradual): guarded by the endpoint directory scan below until its transactions moved here
  { entry: 'server/services/admin-article-boost.ts#startInstantBoostWithAudit', handler: 'articles/[id]/boost.post.ts' },
  { entry: 'server/services/admin-article-boost.ts#startGradualBoostWithAudit', handler: 'articles/[id]/boost.post.ts' },
  { entry: 'server/services/admin-media-upload.ts#insertUploadedMediaWithAudit', handler: 'media/upload.post.ts' },
  { entry: 'server/services/admin-page-write.ts#updatePageWithAudit', handler: 'pages/[id].put.ts' },
  { entry: 'server/services/admin-page-versions.ts#restorePageVersionWithAudit', handler: 'pages/[id]/versions/[versionId]/restore.post.ts' },
  { entry: 'server/services/admin-page-write.ts#createPageWithAudit', handler: 'pages/index.post.ts' },
  // pages/[id]/publish.post.ts: guarded by the endpoint directory scan below until its transaction moved here
  { entry: 'server/services/admin-page-publish.ts#publishPageWithAudit', handler: 'pages/[id]/publish.post.ts' },
  // comments/[id]/visibility.patch.ts: guarded by the endpoint directory scan below until its transaction moved here
  { entry: 'server/services/admin-comments-visibility.ts#setCommentVisibilityWithAudit', handler: 'comments/[id]/visibility.patch.ts' },
  // Factor, recovery codes, session generation and audit row in one transaction; the
  // cookie is written AFTER the commit, so it is no longer a cookie-between-writes
  // exception (2026-10-28 — the audit used to follow the cookie on the pool).
  { entry: 'server/services/admin-mfa-disable.ts#disableFactorWithAudit', handler: 'profile/mfa/disable.post.ts' },
  // Moved out of their handlers into services, each named by the FUNCTION holding the transaction.
  { entry: 'server/services/admin-role-create.ts#createRoleWithAudit', handler: 'roles/index.post.ts' },
  // roles/[id].put.ts: guarded by the raw-delete scan below until its tx.delete(permissions) moved here
  { entry: 'server/services/admin-role-update.ts#updateRoleWithAudit', handler: 'roles/[id].put.ts' },
  { entry: 'server/services/admin-settings-general.ts#saveGeneralSettingsWithAudit', handler: 'settings/index.put.ts' },
  { entry: 'server/services/admin-settings-navigation.ts#saveMobileMenuWithAudit', handler: 'settings/navigation/mobile.put.ts' },
  { entry: 'server/services/admin-settings-navigation.ts#saveNavbarMenuWithAudit', handler: 'settings/navigation/navbar.put.ts' },
  { entry: 'server/services/admin-user-update.ts#updateUserWithAudit', handler: 'users/[id].put.ts' },
  { entry: 'server/services/admin-user-create.ts#createUserWithAudit', handler: 'users/index.post.ts' },
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
  for (const { entry: file } of AUDITED_MUTATION_ENDPOINTS) {
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
    for (const { entry: file } of AUDITED_MUTATION_ENDPOINTS) {
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

/**
 * The handler half of the two lists above (soát độc lập sau khi dời, 2026-11-08).
 *
 * Before the move these lists named HANDLER files and asked each one for its transaction and
 * audit row. Now each entry names the service function holding them, and nothing asked whether
 * the handler still calls it: dropping `await updateUserWithAudit(…)` from `users/[id].put.ts`,
 * or swapping it for an unaudited `updateUser()`, stayed green. The audit census (bottom of this
 * file) now counts audit rows per call site, which catches a dropped call; this pins WHERE the
 * call is — the named handler's `export default`, exactly once, and nowhere else (`directCallSites`,
 * `tests/_call-sites.ts`: every direct call in `server/**` and `scripts/**`, or the reason they
 * cannot be listed — a re-export, a namespace import, a use by value — which fails here too).
 * A call moved to another endpoint keeps the census and turns this red.
 */
describe('each audited function of the two endpoint lists is called once, by the handler it stands for', () => {
  const index = repoSourceIndex()
  const entries = [
    ...AUDITED_DELETE_ENDPOINTS.map(({ file, handler }) => ({ entry: file, handler })),
    ...AUDITED_MUTATION_ENDPOINTS,
  ]
  for (const { entry, handler } of entries) {
    it(`${handler} calls ${target(entry).fn}`, () => {
      const { file, fn } = target(entry)
      const source = index.get(join(CALL_SITES_ROOT, file))
      const declaration = source?.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fn)
      assert.ok(declaration, `${fn} is no longer a function declared at the top level of ${file}`)
      const sites = directCallSites(index, join(CALL_SITES_ROOT, file), declaration)
      assert.ok(typeof sites !== 'string', `${entry}: its calls cannot be listed — ${String(sites)}`)
      assert.deepEqual(sites.map(site => relative(CALL_SITES_ROOT, site.file).split(sep).join('/')), [`server/api/admin/${handler}`],
        `${fn} must be called exactly once, from server/api/admin/${handler} — a call dropped, moved to another endpoint or duplicated leaves the write unrecorded or recorded under the wrong request`)
      let top: ts.Node = sites[0]!.call
      while (!ts.isSourceFile(top.parent)) top = top.parent
      assert.ok(ts.isExportAssignment(top), `${handler}: the call to ${fn} is not inside the handler's \`export default\``)
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
  // Trống từ 2026-11-08. Bốn mục cũ (`auth/logout.post.ts`, `profile/mfa/confirm.post.ts`,
  // `profile/mfa/recovery-codes.post.ts`, `profile/password.put.ts` — cookie HTTP **giữa** hai
  // lượt ghi CSDL) đã gỡ: lượt ghi của chúng dời vào service, handler không còn ghi gì để quét
  // này hỏi. Miễn trừ đi theo mã: hàm audit trên pool của mỗi endpoint nằm ở
  // SERVICE_POOL_AUDIT_EXEMPTIONS, và thứ tự lượt ghi → cookie → audit được khẳng định ở
  // COOKIE_BETWEEN_WRITES phía trên — dời cookie đi là test đỏ và endpoint phải vào diện bọc.
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
 * `admin-article-boost.ts` — của `boost.post.ts` / `boost.delete.ts` —, cùng lượt ghi qua `executor: tx`),
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
  // Moved verbatim from the read handlers (2026-11-08): each file holds the reads of one
  // endpoint plus its one read-audit insert, and writes nothing else.
  'admin-chatbot-sessions-list.ts': {
    fn: 'auditChatSessionListRead', // chatbot/sessions/index.get.ts
    why: 'audit-only insert recording a read of the visitor chat session list (IPs, phone numbers); no row write to pair it with — a failed insert fails the request, as before',
  },
  'admin-chatbot-session-detail.ts': {
    fn: 'auditChatSessionView', // chatbot/sessions/[id].get.ts
    why: "audit-only insert recording a read of one citizen's chat transcript; no row write to pair it with — a failed insert fails the request, as before",
  },
  'admin-chatbot-answer-cache-list-audit.ts': {
    fn: 'auditAnswerCacheListRead', // chatbot/answer-cache/index.get.ts
    why: 'audit-only insert recording a read of the cached-answer list; no row write to pair it with — best-effort (.catch), as before',
  },
  'admin-chatbot-answer-cache-view-audit.ts': {
    fn: 'auditAnswerCacheView', // chatbot/answer-cache/[key].get.ts
    why: 'audit-only insert recording a view of one cached answer; no row write to pair it with — best-effort (.catch), as before',
  },
  'admin-activity-logs-queries.ts': {
    fn: 'auditActivityLogRead', // activity-logs/index.get.ts
    why: "audit-only insert recording a read of every account's trail (IPs, login hours); no row write to pair it with — a failed insert fails the request, as before",
  },
  'admin-profile-history.ts': {
    fn: 'auditUserHistoryRead', // profile/history.get.ts
    why: "audit-only insert recording a SuperAdmin's read of another account's activity history; no row write to pair it with — a failed insert fails the request, as before",
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
 *
 * Mỗi mục GHIM hình lượt ghi của hàm (`writes`, soát độc lập sau khi dời, 2026-11-08): bản
 * trước miễn theo khoá nên một mục miễn cả `audit-off-transaction` lẫn
 * `audit-off-transaction-with-row-write` — thêm `await db.update(users)…` vào
 * `writeServerRestartAudit` (hàm "chỉ ghi audit") vẫn xanh. Nay mục chỉ miễn đúng một luật,
 * suy từ hình đã ghim (chỉ `audit` → `audit-off-transaction`; có hàng → `…-with-row-write`),
 * và chỉ khi lượt ghi của hàm (của chính nó và của helper cùng tệp nó gọi) đúng y như đã
 * ghim — thêm, bớt, đưa lên transaction một lượt ghi đều làm mục mất hiệu lực. Hàm chỉ ghi
 * audit còn không được gọi theo tên một hàm có dáng ghi (`WRITE_SHAPED_CALL`) — lượt ghi qua
 * module khác bộ quét không thấy.
 */
interface PoolAuditExemption {
  /**
   * Every write the function makes — its own and those of same-file helpers it calls — in the
   * scanner's order: `audit` for an activity_logs row, `<kind>(<table>)` for any other row; all
   * of them off a transaction (that is what is excused).
   */
  writes: string[]
  why: string
}

const writeSignature = (w: UnitFacts['writes'][number]) => `${w.audit ? 'audit' : `${w.kind}(${w.table})`}${w.onTx ? ' on tx' : ''}`

/** The one rule a pinned exemption excuses: an audit with no row beside it, or an unwrapped pair. */
const excusedRule = (exemption: PoolAuditExemption): Rule =>
  (exemption.writes.every(w => w === 'audit') ? 'audit-off-transaction' : 'audit-off-transaction-with-row-write')

/** Why `exemption` does not hold for function `fn` of `units`; `null` when it does. */
function pinnedExemptionMismatch(units: UnitFacts[], fn: string, exemption: PoolAuditExemption): string | null {
  const unit = units.find(u => u.name === fn)
  if (!unit) return `${fn} is no longer declared at the top level`
  const found = unit.writes.map(writeSignature)
  if (JSON.stringify(found) !== JSON.stringify(exemption.writes)) {
    return `writes ${JSON.stringify(found)}, the exemption is pinned to ${JSON.stringify(exemption.writes)}`
  }
  if (excusedRule(exemption) === 'audit-off-transaction') {
    const calls: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && WRITE_SHAPED_CALL.test(node.expression.text)) calls.push(node.expression.text)
      ts.forEachChild(node, visit)
    }
    visit(ts.createSourceFile(`${fn}.ts`, unit.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS))
    if (calls.length > 0) return `an audit-only function calls write-shaped ${calls.join(', ')}( — a row written there is paired with this pool audit`
  }
  return null
}

const SERVICE_POOL_AUDIT_EXEMPTIONS: Record<string, PoolAuditExemption> = {
  // `deleteArticleById`/`setArticleStatus` chủ đích không bọc — khoá bởi test
  // `known exclusions are named` ở đầu tệp này.
  'articles.ts#deleteArticleById': { writes: ['delete(articles)', 'audit'], why: 'named known exclusion (see known exclusions test)' },
  'articles.ts#setArticleStatus': { writes: ['update(articles)', 'audit'], why: 'named known exclusion (see known exclusions test)' },
  // Ghi lại một lượt XEM dữ liệu cá nhân người đọc (design.md D14) — chỉ một dòng audit,
  // không có hàng nghiệp vụ nào để nguyên tử cùng. Trước đây đi qua cổng theo tệp chỉ vì
  // viết `getDb().insert(…)` (không khớp `db.insert(`) — không phải vì đã được xét.
  'readers.ts#auditReaderRead': { writes: ['audit'], why: 'audit-only insert recording a read of reader personal data; no row write to pair it with' },
  // `bulkTriggerTranslation` chỉ ghi MỘT dòng audit "đã yêu cầu dịch hàng loạt" rồi
  // đẩy việc sang nền; không có hàng nghiệp vụ nào được ghi cùng lúc để giữ nguyên
  // tử với nó. Các lượt ghi bản dịch xảy ra sau đó, ngoài request, trong worker
  // (`runBulkTranslation`, bộ quét thấy nó vì cùng tệp). Trước đây cùng đoạn này nằm
  // trong `article-translations.ts` (có transaction ở chỗ khác nên guard theo tệp không
  // thấy); tách tệp làm nó lộ ra, không phải mới. Chuyển từ SERVICE_EXEMPTIONS (cả tệp).
  // Hai lượt ghi hàng trong `writes` là của `runBulkTranslation` — job nền mà hàm này hẹn bằng
  // `setTimeout` SAU dòng audit, ngoài request; bộ quét gán chúng cho hàm vì cùng tệp.
  'article-translation-bulk.ts#bulkTriggerTranslation': { writes: ['audit', 'update(articleTranslations)', 'insert(articleTranslations)'], why: 'audit-only insert for a queued background job; no row write to pair it with' },
  // Đồng bộ storage ghi audit TIẾN ĐỘ (mỗi đợt / tổng kết) bằng try/catch
  // best-effort — "audit hỏng không làm hỏng lượt sync đã thành công" là chủ đích.
  // Cặp hàng + thay URL + audit thật (đổi `provider`/`url` của một hàng `media`) nằm
  // trong `db.transaction` ở `media-sync-files.ts`. `media-sync-rewrite.ts` từng được
  // miễn (audit thay URL best-effort ngoài transaction); nay lượt thay URL và audit của
  // nó cùng transaction, nên tệp đó đi qua cổng như mọi service khác. Sau khi tách
  // (2026-11-06): audit tiến độ ở `media-sync-worker.ts` (hàm cục bộ `runLocked`, gán cho
  // `runSyncWorker`), audit tổng của đường cũ ở `media-sync-legacy.ts`. Chuyển từ
  // SERVICE_EXEMPTIONS (cả tệp).
  'media-sync-worker.ts#runSyncWorker': { writes: ['audit'], why: 'progress audits are best-effort by design; the row+audit pair is transactional in media-sync-files.ts' },
  'media-sync-legacy.ts#syncMediaStorage': { writes: ['audit'], why: 'summary audit is best-effort by design; the row+audit pair is transactional in media-sync-files.ts' },
  // Cùng hình với `media-sync-worker.ts`: job quét nền ghi audit TIẾN ĐỘ (mỗi lô / tổng kết,
  // ở hàm cục bộ `runScanWorker`) bằng try/catch best-effort. Cặp hàng `media` + audit
  // `create` của từng tệp nhập nằm trong `db.transaction` ở `media-scan-import.ts`.
  // Chuyển từ SERVICE_EXEMPTIONS (cả tệp).
  'media-scan.ts#startScanJob': { writes: ['audit', 'audit'], why: 'progress/summary audits of a background scan job are best-effort by design; the row+audit pair is transactional in media-scan-import.ts' },
  'admin-ai-moderation-ops.ts#writeModerationRescanAudit': { writes: ['audit'], why: 'moved verbatim from ai/moderation/rescan-all.post.ts: audit-only rows of a background rescan job (start; summary at finish via onFinished) — the only write of the request, no row to pair with; best-effort, a failed insert logs ai_moderation.rescan_audit_failed' },
  'admin-ai-moderation-ops.ts#writeServerRestartAudit': { writes: ['audit'], why: 'moved verbatim from ai/moderation/restart-server.post.ts: audit-only row before a SuperAdmin-requested process exit — the only write of the request, no row to pair with; best-effort, a failed insert is swallowed as in the handler, which then logs system.restart_requested' },
  'admin-ai-moderation-ops.ts#writeWorkerRestartAudit': { writes: ['audit'], why: 'moved verbatim from ai/moderation/restart-worker.post.ts: audit-only row after an in-memory reset (worker counters, rule cache) — the only write of the request, no row to pair with; best-effort, a failed insert logs ai_moderation.restart_worker_audit_failed' },
  'admin-settings-retention.ts#writeRetentionRunStartAudit': { writes: ['audit'], why: 'moved verbatim from settings/retention-run.post.ts: the audit row of a manual retention run, written under the lock before the first DELETE (beforePurge) — the purge deletes in batches on its own pool and cannot share a transaction with it; fail-closed in the handler (a failed insert logs retention.manual_start_audit_failed and the purge does not start)' },
  'admin-settings-retention.ts#writeRetentionRunResultAudit': { writes: ['audit'], why: 'moved verbatim from settings/retention-run.post.ts: the per-table summary row after a manual retention pass has committed — no row to pair with; best-effort in the handler (a failed insert logs retention.manual_result_audit_failed and answers auditFailed)' },
  'admin-cache-clear-audit.ts#auditPublicCacheClear': { writes: ['audit'], why: 'moved verbatim from cache-clear.post.ts: audit-only row after the public-page cache purge (storage, no database row) — the only write of the request, no row to pair with, the purge cannot be rolled back; a failed insert answers 500 with the cache already cleared and nothing else records who cleared it' },
  'admin-languages-audit.ts#writeLanguagesSeedDefaultAudit': { writes: ['audit'], why: 'moved verbatim from languages/seed-default.post.ts: audit row after seedDefaultLanguagesAndTranslations (languages.ts) has written its rows — not one transaction with them; best-effort in the handler (a failed insert logs languages.seed_default_audit_failed with the actor and the counts)' },
  'admin-languages-audit.ts#writeLanguageKeysSyncAudit': { writes: ['audit'], why: 'moved verbatim from languages/sync.post.ts: audit row after syncLanguageKeys (languages.ts) has written the missing keys — not one transaction with them; best-effort in the handler (a failed insert logs languages.sync_audit_failed with the actor and the counts)' },
  // The cookie-between-writes endpoints (COOKIE_BETWEEN_WRITES above pins the handler's order and
  // that each of these writes exactly its audit row): moved verbatim from their handlers, still on
  // the pool AFTER the session cookie, which a rollback could not retract.
  'admin-mfa-confirm.ts#auditMfaFactorEnabled': { writes: ['audit'], why: 'moved verbatim from profile/mfa/confirm.post.ts: written after activatePendingFactor (its own transaction), revokeSessions and setSessionCookie — the cookie sits between the writes, so no transaction may span them' },
  'admin-mfa-recovery-codes-issue.ts#auditRecoveryCodesGenerated': { writes: ['audit'], why: 'moved verbatim from profile/mfa/recovery-codes.post.ts: written after issueRecoveryCodes (its own transaction), revokeSessions and setSessionCookie — the cookie sits between the writes, so no transaction may span them' },
  'admin-profile-password.ts#auditOwnPasswordChange': { writes: ['audit'], why: 'moved verbatim from profile/password.put.ts: written after updateOwnPassword, the fresh token-version read and setSessionCookie — the cookie sits between the writes, so no transaction may span them' },
  'admin-auth-logout.ts#auditAdminLogout': { writes: ['audit'], why: 'moved verbatim from auth/logout.post.ts: best-effort, in its own try/catch after bumpAdminTokenVersion (its own try/catch) — one transaction would let a failed audit roll back the token invalidation; a failed insert logs auth.logout_audit_failed' },
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
    const judged = poolAuditJudgement(entry, unitsOf(file), premise)
    offenders.push(...judged.offenders)
    for (const key of judged.excused) excused.add(key)
  }
  return { offenders, excused }
}

/**
 * The service-layer audit rules for ONE file's functions: each flagged function is an offender
 * unless it is the audit-only premise of `AUDIT_ONLY_FUNCTION_EXEMPTIONS`, or its
 * `SERVICE_POOL_AUDIT_EXEMPTIONS` entry excuses exactly that rule and its writes are exactly as
 * pinned (`pinnedExemptionMismatch`).
 */
function poolAuditJudgement(entry: string, units: UnitFacts[], premise: string | null): { offenders: string[], excused: string[] } {
  const offenders: string[] = []
  const excused: string[] = []
  for (const problem of unitProblems(units, { auditOffTransaction: true })) {
    if (!SERVICE_AUDIT_RULES.has(problem.rule)) continue
    const key = `${entry}#${problem.unit}`
    if (problem.unit === premise) continue
    const exemption = SERVICE_POOL_AUDIT_EXEMPTIONS[key]
    if (exemption) {
      const mismatch = pinnedExemptionMismatch(units, problem.unit, exemption)
      if (mismatch === null && problem.rule === excusedRule(exemption)) {
        excused.push(key)
        continue
      }
      offenders.push(`${key}: ${problem.detail} — its SERVICE_POOL_AUDIT_EXEMPTIONS entry excuses ${excusedRule(exemption)} `
        + `for exactly ${JSON.stringify(exemption.writes)}${mismatch ? ` — ${mismatch}` : ''}`)
      continue
    }
    offenders.push(`${key}: ${problem.detail}`)
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

  it('each SERVICE_POOL_AUDIT_EXEMPTIONS entry holds for its function exactly as pinned', () => {
    const mismatches: string[] = []
    for (const [key, exemption] of Object.entries(SERVICE_POOL_AUDIT_EXEMPTIONS)) {
      const [file, fn] = key.split('#')
      const mismatch = pinnedExemptionMismatch(unitsOf(`server/services/${file}`), fn!, exemption)
      if (mismatch) mismatches.push(`${key}: ${mismatch}`)
    }
    assert.deepEqual(mismatches, [], 'một hàm được miễn đã đổi lượt ghi — mục miễn trừ chỉ che đúng hình đã ghim: '
      + 'bọc cặp hàng + audit trong transaction, hoặc (nếu vẫn có chủ đích) ghim lại hình mới kèm lý do')
  })

  /**
   * The review's probe (2026-11-08) and its neighbours, on the real file: each turned an
   * audit-only exempted function into something else, and each stayed green while the
   * exemption excused both off-transaction rules for its key.
   */
  it('a write added to an audit-only exempted function voids its exemption', () => {
    const entry = 'admin-ai-moderation-ops.ts'
    const key = `${entry}#writeServerRestartAudit`
    const base = read(`server/services/${entry}`)
    const opening = 'export async function writeServerRestartAudit(adminUser: { id?: number | null } | null | undefined) {\n  const db = getDb()\n'
    assert.equal(base.split(opening).length, 2, 'writeServerRestartAudit no longer opens as the probes expect — they would test nothing')
    const judged = (source: string) => poolAuditJudgement(entry, scanUnits(`server/services/${entry}`, source), null)
    assert.ok(judged(base).excused.includes(key), 'the clean file must keep its exemption')
    const mutations: Record<string, string> = {
      'a pool row write beside the audit (the review probe)': base.replace(opening, `${opening}  await db.update(users).set({ isActive: false })\n`)
        .replace("import { activityLogs } from '../db/schema'", "import { activityLogs, users } from '../db/schema'"),
      'a second audit row': base.replace(opening, `${opening}  await db.insert(activityLogs).values({ action: 'update', resource: 'ai' })\n`),
      'a row written through another module': base.replace(opening, `${opening}  await deleteUserById(1, null)\n`),
    }
    for (const [label, mutated] of Object.entries(mutations)) {
      assert.notEqual(mutated, base, `${label}: the mutation did not apply`)
      const { offenders, excused } = judged(mutated)
      assert.ok(!excused.includes(key) && offenders.some(o => o.startsWith(`${key}:`)), `${label}: the exemption still excuses writeServerRestartAudit`)
    }
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
  'server/services/admin-media-categories.ts#deleteMediaCategoryRow': 'media category is portal configuration, not citizen data — auditing its deletion is not an audit-log question', // media-portal/categories/[id].delete.ts

  // ── server/services/** (2026-11-08), one FUNCTION each ─────────────────────────────
  // FINDING (để chủ repo quyết): cán bộ xoá một danh mục tin / một thể loại — qua tuyến
  // một hàng LẪN tuyến `bulk-delete` — và KHÔNG có dòng `activity_logs` nào ghi ai đã xoá.
  // Chưa từng được audit, kể cả trước 908c0e50 (khi lệnh xoá còn trong handler); cổng quét
  // endpoint không thấy vì handler chỉ gọi service, cổng quét service không hỏi vì tệp
  // không chạm `activityLogs`. Miễn ở đây để bộ test giữ màu hiện tại — KHÔNG phải vì đúng.
  'server/services/categories.ts#deleteCategoryById': 'FINDING: an admin deletes a news category (single and bulk routes) and no activity_logs row records who — never audited; owner to decide',
  'server/services/content-types.ts#deleteContentTypeById': 'FINDING: an admin deletes a content type (single and bulk routes) and no activity_logs row records who — never audited; owner to decide',
  // Moved verbatim from profile/mfa/confirm.post.ts (2026-11-08). The handler's per-function scan
  // passed only because the same function also held the ACTIVATION's audit row — which these
  // three refusal paths never reach: they were never audited. What goes is the caller's OWN
  // pending, never-active enrollment (window lapsed / stored secret unreadable / emailed code
  // missed too often), guarded by the snapshot the handler read; it protected nothing yet. No
  // trail but the 4xx/500 answer — reported as a finding, owner to decide.
  'server/services/admin-mfa-confirm.ts#discardPendingFactor': "FINDING (low): drops the caller's own never-active pending MFA enrollment on a refused confirmation (lapsed window, unreadable secret, emailed code missed too often) — never audited, even in the handler; owner to decide",
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
    // này không lặng lẽ đưa chúng về `logInfo` rồi lại xanh. Transaction của chúng đã
    // dời sang service (2026-11-08): đọc đúng HÀM giữ transaction đó.
    for (const file of [
      'server/services/admin-chatbot-session-delete.ts#deleteChatSessionWithAudit', // sessions/[id]/index.delete.ts
      'server/services/admin-chatbot-session-delete.ts#bulkDeleteChatSessionsWithAudit', // sessions/bulk-delete.post.ts
    ]) {
      const source = entrySource(file)
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
      'server/services/admin-chatbot-session-delete.ts#deleteChatSessionWithAudit', // sessions/[id]/index.delete.ts
      'server/services/admin-chatbot-session-delete.ts#bulkDeleteChatSessionsWithAudit', // sessions/bulk-delete.post.ts
    ]) {
      const source = entrySource(file)
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
   *     transaction` above), exempt only by MUTATION_SCAN_EXEMPTIONS (empty since the cookie endpoints moved);
   *   - an audit row in a transaction that writes no row while the function writes its row
   *     elsewhere (in another transaction, or on the pool) — both trees. A transaction handed
   *     to another module's function (`addViews({ executor: tx })`) counts as writing there.
   */
  it('every function that writes a row and audits it does both in one transaction', () => {
    const offenders: string[] = []
    for (const file of [...walkTs('server/api'), ...walkTs('server/services')]) {
      const service = file.startsWith('server/services/')
      for (const problem of unitProblems(unitsOf(file), { auditOffTransaction: false })) {
        // `audit-transaction-without-row-write` is excused nowhere, in either tree (2026-11-08): no
        // SERVICE_POOL_AUDIT_EXEMPTIONS entry writes on a transaction, and each entry excuses only
        // the one off-transaction rule its pinned writes imply.
        if (problem.rule === 'audit-off-transaction-with-row-write') {
          if (service) continue // asked by the service-layer scan, with its function-scoped exemptions
        } else if (problem.rule !== 'audit-transaction-without-row-write') continue
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
      ...AUDITED_MUTATION_ENDPOINTS.map(({ entry }) => entry),
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

/**
 * Kiểm kê dòng audit (2026-11-08): MỌI dòng `activity_logs` mà `server/api/**`,
 * `server/services/**` và `server/utils/**` ghi, đếm theo `<resource>:<action>` — tức theo
 * điều được ghi lại, KHÔNG theo tệp hay hàm ghi nó — và tính MỘT LẦN MỖI NƠI GỌI hàm chứa
 * lượt ghi đó.
 *
 * Các cổng phía trên bắt cặp hàng + audit ghi sai chỗ và lệnh xoá mất audit, nhưng một lượt
 * INSERT/UPDATE làm rơi dòng audit trong một hàm chưa có tên ở danh sách nào thì không cổng
 * nào đỏ. Đợt dời ~150 endpoint sang service là đúng lúc chuyện đó dễ xảy ra nhất. Bảng này
 * khoá con số: dời mã giữa handler và service giữ nguyên nó; bỏ một lượt ghi audit, đổi
 * resource/action của nó, hay bỏ / tráo LỜI GỌI tới hàm ghi audit làm nó đỏ — kèm nơi các
 * dòng còn lại đang được ghi.
 *
 * Vì sao theo nơi gọi (soát độc lập sau khi dời, 2026-11-08): bản đầu đếm lượt ghi một lần ở
 * NƠI KHAI BÁO hàm. Trước khi dời, handler tự ghi cặp hàng + audit nên tệp handler có trong
 * danh sách; sau khi dời, mục danh sách là `server/services/x.ts#fooWithAudit` và không gì
 * kiểm handler còn gọi nó. Xoá `await updateUserWithAudit(…)` khỏi `users/[id].put.ts`, xoá
 * `await writeRetentionRunStartAudit(…)` khỏi `settings/retention-run.post.ts`, hay tráo
 * handler sang một `updateUser()` không audit — cả ba vẫn xanh. Nay cả ba đỏ (ca dò bên dưới).
 *
 * Cách đếm (`auditCensusOf`, `tests/_audit-atomicity-scan.ts`):
 *   - mỗi hàng của mỗi `.insert(activityLogs).values(…)` (mảng = nhiều hàng) tính một — nhân
 *     với số NƠI GỌI hàm export chứa nó (gọi trực tiếp, ở bất kỳ tệp nào của `server/**` và
 *     `scripts/**`). Hàm không ai gọi ghi 0 dòng. Nơi gọi nằm trong một hàm service khác vẫn
 *     là một nơi gọi (đếm theo chữ viết, không lần tiếp ai gọi hàm đó);
 *   - helper cục bộ (không export) tính một lần MỖI LẦN được nhắc trong tệp, đi tiếp tới hàm
 *     export hay điểm vào chứa lần nhắc đó; gọi trực tiếp thì tham số thay bằng đối số
 *     (`audit(tx, actorId, 'create', …)` → `…:create`);
 *   - `export default` (handler, plugin) và câu lệnh cấp cao nhất là điểm vào: một lần;
 *   - giá trị điều kiện của các chuỗi → `a|b`; giá trị không giải được → `‹mã nguồn›` (bền
 *     khi dời nguyên văn). Hai bộ dựng hàng của chatbot → `‹tên bộ dựng›:<operation>`.
 * Đếm theo TÊN, nên cái gì làm tên không còn đếm được thì đỏ thay vì đếm sai: hàm ghi audit
 * được truyền như giá trị, import/export dưới tên khác, gọi qua namespace, hay khai báo lần
 * thứ hai ở đâu đó (test "every audit-writing exported function is reached by direct calls").
 *
 * Thêm/bỏ/đổi một lượt ghi audit — hay một nơi gọi hàm ghi audit — có chủ đích → sửa bảng
 * này trong CÙNG commit, theo đúng số "found" trong thông báo lỗi.
 */
const AUDIT_CENSUS: Record<string, number> = {
  'activity_logs:read': 1,
  'ai:create': 3,
  'ai:delete': 7,
  'ai:update': 11,
  'article_comments:delete': 2,
  'articles:boost': 3,
  'articles:create': 1,
  'articles:delete': 2,
  'articles:update': 3,
  'auth:login': 2,
  'auth:logout': 1,
  'backup_drive_oauth:delete': 1,
  'backup_drive_oauth:update': 3,
  'chat_sessions:delete': 2,
  'chat_sessions:read': 2,
  'chatbot_knowledge:create': 1,
  'chatbot_knowledge:delete': 5,
  'chatbot_knowledge:read': 2,
  'chatbot_knowledge:toggle': 2,
  'chatbot_knowledge:update': 2,
  'comments:create': 1,
  'comments:delete': 1,
  'comments:read': 1,
  'comments:update': 1,
  'data_retention:delete': 2,
  'data_retention:update': 1,
  'google_oauth_settings:update': 2,
  'livestream:create': 1,
  'livestream:delete': 1,
  'livestream:update': 2,
  'media:articles_fix_thumbnails': 1,
  'media:create': 2,
  'media:delete': 2,
  'media:repair_urls': 1,
  'media:repoint_urls': 1,
  'media:scan_uploads': 1,
  'media:scan_uploads_batch': 1,
  'media:self_heal': 1,
  'media:self_heal_default_lost': 1,
  // `media:sync_storage` (syncMediaStorage, media-sync-legacy.ts) không còn trong bảng: không mã
  // chạy thật nào gọi đường đồng bộ cũ — chỉ barrel `media-sync.ts` và một test tích hợp.
  'media:sync_storage_batch': 1,
  // commitMove qua syncOneToR2/syncOneToLocal (gọi ở media-sync-legacy + media-sync-worker: 4) và
  // repairInterruptedSyncRewrites (gọi ở media-repair, media-sync-legacy, media-sync-worker: 3).
  'media:update': 7,
  'media_portal:create': 3,
  'media_portal:delete': 1,
  'media_portal:housekeep_uploads': 1,
  'media_portal:publish|update': 1,
  'media_portal:update': 5,
  'pages:create': 2,
  'pages:delete': 3,
  'pages:update': 3,
  'profile_mfa:update': 2,
  'profile_password:update': 1,
  'profile_recovery_codes:update': 2,
  'reader_ip_bans:create': 1,
  'reader_ip_bans:delete': 1,
  'readers:delete': 1,
  'readers:read': 2,
  'readers:update': 4,
  'roles:create': 1,
  'roles:delete': 1,
  'roles:update': 1,
  'settings:backup_restore': 2,
  'settings:backup_restore_failed': 2,
  // runBackup: backup/run.post.ts, lịch (backup-scheduler), bản pre-restore (backup-restore) và
  // năm bản sao lưu trước job media (articles-thumbnail-scan, media-repair, media-repoint,
  // media-self-heal, media-sync-worker).
  'settings:backup_run': 8,
  'settings:create': 5,
  'settings:delete': 4,
  'settings:update': 25,
  'settings:update media_portal_settings': 1,
  'submissions:delete': 2,
  'submissions:read': 1,
  'submissions:update': 4,
  'user_history:read': 1,
  'user_mfa:delete': 2,
  'users:create': 1,
  'users:delete': 2,
  'users:update': 2,
  // Bộ dựng hàng của chatbot (server/utils/chatbot/audit.ts) đặt resource bên trong bộ dựng
  // (`CHATBOT_RESOURCES.*`), nên khoá mang tên bộ dựng; action là `operation` truyền vào.
  '‹buildChatbotKnowledgeAudit›:archive|publish': 4,
  '‹buildChatbotKnowledgeAudit›:create': 2,
  '‹buildChatbotKnowledgeAudit›:delete': 2,
  '‹buildChatbotKnowledgeAudit›:update': 2,
  '‹buildChatbotSettingsAudit›:rotate_key|update': 1,
}

const CENSUS_ROOTS = ['server/api', 'server/services', 'server/utils']
/** Read for CALL SITES only: the rest of the server (plugins, routes, middleware, db) and the scripts. */
const CALLER_ROOTS = ['server', 'scripts']

/** Every `.ts` / `.mjs` source under `dir` (declarations excluded). */
function walkSources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) found.push(...walkSources(path))
    else if (/\.(?:ts|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(path)
  }
  return found.sort()
}

let repoCensusMemo: CensusResult | undefined
/** The census of the repo: inserts looked for in CENSUS_ROOTS, calls in all of CALLER_ROOTS. */
function repoCensus(): CensusResult {
  if (!repoCensusMemo) {
    const files = CENSUS_ROOTS.flatMap(walkTs)
    const inRoots = new Set(files)
    const callers = CALLER_ROOTS.flatMap(walkSources).filter(file => !inRoots.has(file))
    repoCensusMemo = auditCensusOf(files.map(file => ({ file, source: read(file) })), callers.map(file => ({ file, source: read(file) })))
  }
  return repoCensusMemo
}

/** The keys whose count differs, each with the sites that still write it (for the message). */
function censusDiff(found: Record<string, number>, declared: Record<string, number>, entries: Array<{ key: string, where: string }>): string[] {
  const keys = [...new Set([...Object.keys(found), ...Object.keys(declared)])].sort()
  return keys.filter(key => (found[key] ?? 0) !== (declared[key] ?? 0)).map((key) => {
    const sites = entries.filter(entry => entry.key === key).map(entry => entry.where)
    return `'${key}': declared ${declared[key] ?? 0}, found ${found[key] ?? 0}${sites.length > 0 ? ` — written at ${sites.join(', ')}` : ''}`
  })
}

describe('the audit census: every activity_logs row the server writes, by what it records', () => {
  it('server/api, server/services and server/utils write exactly the audited (resource, action) rows in AUDIT_CENSUS', () => {
    const { entries } = repoCensus()
    assert.deepEqual(
      censusDiff(censusCounts(entries), AUDIT_CENSUS, entries),
      [],
      'số dòng audit theo `<resource>:<action>` đã đổi. Dời mã giữa handler và service KHÔNG bao giờ '
      + 'đổi bảng này — nên một lượt ghi audit, hay một LỜI GỌI tới hàm ghi audit, vừa bị BỎ, bị đổi '
      + 'resource/action, hoặc được thêm. Có chủ đích → sửa AUDIT_CENSUS theo số "found" trong cùng '
      + 'commit; không → khôi phục dòng audit / lời gọi.',
    )
  })

  it('every audit-writing exported function is reached by direct calls the census can count', () => {
    assert.deepEqual(
      repoCensus().problems,
      [],
      'bảng kiểm kê đếm lời gọi theo TÊN hàm — gọi trực tiếp bằng đúng tên đó, không truyền hàm như '
      + 'giá trị, không import/export dưới tên khác, không gọi qua namespace, không khai báo trùng tên',
    )
  })

  /**
   * The review's probes (2026-11-08), on the real handler and service files: a handler that stops
   * calling its audited service — or calls an unaudited one instead — leaves the write gone or
   * unrecorded; the census must see it. Counted on the pair of files alone: each call site is one
   * row, so the repo census moves by the same amount.
   */
  it('a handler that stops calling its audited service, or calls an unaudited one instead, drops the census', () => {
    const probes: Array<{ service: string, handler: string, call: string, key: string }> = [
      { service: 'server/services/admin-user-update.ts', handler: 'server/api/admin/users/[id].put.ts', call: 'await updateUserWithAudit(adminUser, id, updateData)', key: 'users:update' },
      { service: 'server/services/admin-settings-retention.ts', handler: 'server/api/admin/settings/retention-run.post.ts', call: 'await writeRetentionRunStartAudit(admin.id, scopes)', key: 'data_retention:delete' },
      { service: 'server/services/admin-cache-clear-audit.ts', handler: 'server/api/admin/cache-clear.post.ts', call: 'await auditPublicCacheClear(admin.id, cleared)', key: 'settings:update' },
    ]
    for (const { service, handler, call, key } of probes) {
      const source = read(handler)
      assert.equal(source.split(call).length, 2, `${handler}: \`${call}\` is not written exactly once — the probe tests nothing`)
      const definitions = [{ file: service, source: read(service) }]
      const before = censusCounts(auditCensus(definitions, [{ file: handler, source }]))
      const after = censusCounts(auditCensus(definitions, [{ file: handler, source: source.replace(call, 'await Promise.resolve()') }]))
      assert.equal((before[key] ?? 0) - (after[key] ?? 0), 1, `${handler}: dropping \`${call}\` must drop one '${key}' row`)
    }

    // The swap: the handler calls a new service that updates the user and records nothing.
    const plain = "import { eq } from 'drizzle-orm'\nimport { getDb } from '../utils/db'\nimport { users } from '../db/schema'\n"
      + 'export async function updateUser(id: number, data: Record<string, unknown>) {\n  await getDb().update(users).set(data).where(eq(users.id, id))\n}\n'
    const handlerFile = 'server/api/admin/users/[id].put.ts'
    const handler = read(handlerFile)
    const swapped = handler
      .replace('await updateUserWithAudit(adminUser, id, updateData)', 'await updateUser(id, updateData)')
      .replace("import { findUserForEdit, updateUserWithAudit } from '../../../services/admin-user-update'",
        "import { findUserForEdit } from '../../../services/admin-user-update'\nimport { updateUser } from '../../../services/admin-user-update-plain'")
    assert.equal(swapped.includes('updateUserWithAudit'), false, 'the swap did not apply')
    const services = [
      { file: 'server/services/admin-user-update.ts', source: read('server/services/admin-user-update.ts') },
      { file: 'server/services/admin-user-update-plain.ts', source: plain },
    ]
    assert.equal(censusCounts(auditCensus(services, [{ file: handlerFile, source: handler }]))['users:update'], 1)
    assert.equal(censusCounts(auditCensus(services, [{ file: handlerFile, source: swapped }]))['users:update'], undefined)
  })

  const header = "import { activityLogs, roles } from '../db/schema'\nimport { getDb } from '../utils/db'\n"
  const countsOf = (...sources: Array<[string, string]>) => censusCounts(auditCensus(sources.map(([file, source]) => ({ file, source }))))
  const problemsOf = (...sources: Array<[string, string]>) => auditCensusOf(sources.map(([file, source]) => ({ file, source }))).problems

  it('the key does not depend on where the insert lives: handler and service give the same census', () => {
    const insert = `await tx.insert(activityLogs).values({ userId: 1, action: 'delete', resource: 'roles', resourceId: id })`
    const handler = `${header}export default defineEventHandler(async (event) => {
  const id = 1
  await getDb().transaction(async (tx) => { await tx.delete(roles); ${insert} })
})\n`
    const service = `${header}export async function deleteRoleWithAudit(id: number) {
  await getDb().transaction(async (tx) => { await tx.delete(roles); ${insert} })
}\n`
    const caller = (calls: number) => `import { deleteRoleWithAudit } from '../services/x'\nexport default defineEventHandler(async () => {${' await deleteRoleWithAudit(1);'.repeat(calls)} })\n`
    assert.deepEqual(countsOf(['server/api/admin/roles/x.delete.ts', handler]), { 'roles:delete': 1 })
    assert.deepEqual(countsOf(['server/api/admin/roles/x.delete.ts', caller(1)], ['server/services/x.ts', service]), { 'roles:delete': 1 })
    assert.deepEqual(countsOf(['server/api/admin/roles/x.delete.ts', caller(1)], ['server/services/x.ts', service.replace(insert, '')]), {})
    // Once per CALL: a handler that stops calling the service records nothing; two calls, two rows.
    assert.deepEqual(countsOf(['server/api/admin/roles/x.delete.ts', caller(0)], ['server/services/x.ts', service]), {})
    assert.deepEqual(countsOf(['server/api/admin/roles/x.delete.ts', caller(2)], ['server/services/x.ts', service]), { 'roles:delete': 2 })
    // A call from a file read for call sites only (a plugin, a script) counts like any other.
    assert.deepEqual(censusCounts(auditCensus([{ file: 'server/services/x.ts', source: service }], [{ file: 'server/plugins/x.ts', source: caller(1) }])), { 'roles:delete': 1 })
  })

  it('a local helper counts once per mention with its arguments, through to the exported function and its calls', () => {
    const local = `${header}async function audit(db: Store, action: 'create' | 'delete', id: number) {
  await db.insert(activityLogs).values({ userId: 1, action, resource: 'roles', resourceId: id })
}
export async function create(id: number) { await getDb().transaction(async (tx) => { await tx.insert(roles); await audit(tx, 'create', id) }) }
export async function remove(id: number, hard: boolean) { await getDb().transaction(async (tx) => { await tx.delete(roles); await audit(tx, hard ? 'delete' : 'create', id) }) }\n`
    const handler = (creates: number, removes: number) => "import { create, remove } from '../services/roles'\nexport default defineEventHandler(async () => {"
      + `${' await create(1);'.repeat(creates)}${' await remove(1, true);'.repeat(removes)} })\n`
    assert.deepEqual(countsOf(['server/services/roles.ts', local], ['server/api/admin/roles/x.post.ts', handler(1, 1)]), { 'roles:create': 1, 'roles:create|delete': 1 })
    // helper → exported function → handler, called 0, 1 and 2 times.
    assert.deepEqual(countsOf(['server/services/roles.ts', local], ['server/api/admin/roles/x.post.ts', handler(0, 1)]), { 'roles:create|delete': 1 })
    assert.deepEqual(countsOf(['server/services/roles.ts', local], ['server/api/admin/roles/x.post.ts', handler(2, 1)]), { 'roles:create': 2, 'roles:create|delete': 1 })
    assert.deepEqual(countsOf(['server/services/roles.ts', local]), {}, 'exported functions nobody calls write no row')
    // A helper passed by value (a callback) counts once per mention, its parameters unbound.
    const byValue = `${header}async function record(action: string) { await getDb().insert(activityLogs).values({ userId: 1, action, resource: 'roles' }) }
export default defineEventHandler(async () => { await withLock(record) })\n`
    assert.deepEqual(countsOf(['server/api/admin/roles/y.post.ts', byValue]), { 'roles:‹action›': 1 })
    // A helper nothing mentions writes nothing.
    assert.deepEqual(countsOf(['server/services/dead.ts', `${header}async function record() { await getDb().insert(activityLogs).values({ action: 'read', resource: 'roles' }) }\n`]), {})

    // An exported audit-only helper (`auditRoleRead`) is an exported function like any other: once per call, anywhere.
    const shared = `${header}export async function auditRoleRead(actorId: number) {
  await getDb().insert(activityLogs).values({ userId: actorId, action: 'read', resource: 'roles' })
}\n`
    const reader = (calls: number) => `import { auditRoleRead } from '../services/roles-read'\nexport default defineEventHandler(async () => {${' await auditRoleRead(1);'.repeat(calls)} })\n`
    assert.deepEqual(countsOf(['server/services/roles-read.ts', shared], ['server/api/admin/roles/index.get.ts', reader(1)], ['server/api/admin/roles/[id].get.ts', reader(1)]), { 'roles:read': 2 })
    assert.deepEqual(countsOf(['server/services/roles-read.ts', shared], ['server/api/admin/roles/index.get.ts', reader(1)], ['server/api/admin/roles/[id].get.ts', reader(0)]), { 'roles:read': 1 })
  })

  it('a reference the call count cannot follow is reported, not counted', () => {
    const service = `${header}export async function deleteRoleWithAudit(id: number) {
  await getDb().transaction(async (tx) => { await tx.delete(roles); await tx.insert(activityLogs).values({ action: 'delete', resource: 'roles', resourceId: id }) })
}\n`
    const svc: [string, string] = ['server/services/x.ts', service]
    const h = (body: string, importLine = "import { deleteRoleWithAudit } from '../services/x'"): [string, string] =>
      ['server/api/admin/roles/x.delete.ts', `${importLine}\nexport default defineEventHandler(async () => { ${body} })\n`]
    // Clean: a direct call, a type position, a re-export under the same name.
    assert.deepEqual(problemsOf(svc, h('await deleteRoleWithAudit(1); type F = typeof deleteRoleWithAudit')), [])
    assert.deepEqual(problemsOf(svc, ['server/services/barrel.ts', "export { deleteRoleWithAudit } from './x'\n"]), [])
    const unfollowable: Record<string, Array<[string, string]>> = {
      'passed by value': [svc, h('await withLock(deleteRoleWithAudit)')],
      'stored, then called': [svc, h('const run = deleteRoleWithAudit; await run(1)')],
      'shorthand property': [svc, h('await runAll({ deleteRoleWithAudit })')],
      'aliased import': [svc, h('await drop(1)', "import { deleteRoleWithAudit as drop } from '../services/x'")],
      'aliased re-export': [svc, ['server/services/barrel.ts', "export { deleteRoleWithAudit as dropRole } from './x'\n"]],
      'aliased local export': [['server/services/x.ts', `${service.replace('export async function', 'async function')}export { deleteRoleWithAudit as dropRole }\n`], h('await dropRole(1)')],
      'namespace call': [svc, h('await svc.deleteRoleWithAudit(1)', "import * as svc from '../services/x'")],
      'declared again': [svc, h('const deleteRoleWithAudit = async (id: number) => id; await deleteRoleWithAudit(1)', '')],
      'shadowed by a parameter': [svc, h('await [1].map(deleteRoleWithAudit => deleteRoleWithAudit)')],
    }
    for (const [shape, sources] of Object.entries(unfollowable)) {
      assert.ok(problemsOf(...sources).length > 0, `${shape}: the census counts by name and must report this reference`)
    }
    // Two files writing audit rows from a function of the same name cannot be told apart by calls.
    assert.ok(problemsOf(svc, ['server/services/y.ts', service]).some(p => p.includes('in both')))
    // An insert inside a function held by a top-level VALUE runs when a member is called — no name count sees it.
    const insert = "await getDb().insert(activityLogs).values({ action: 'delete', resource: 'roles' })"
    for (const held of [`export const roleOps = {\n  async remove() { ${insert} },\n}\n`, `const job = defineTask({ async run() { ${insert} } })\n`]) {
      assert.ok(problemsOf(['server/services/ops.ts', header + held]).some(p => p.includes('holds functions')), `not reported:\n${held}`)
      assert.deepEqual(countsOf(['server/services/ops.ts', header + held]), {}, `counted anyway:\n${held}`)
    }
    // Code that runs once at load (no function around the insert) is an entry point: one row, nothing to report.
    const atLoad = `${header}const seeded = ${insert}\n`
    assert.deepEqual(problemsOf(['server/services/boot.ts', atLoad]), [])
    assert.deepEqual(countsOf(['server/services/boot.ts', atLoad]), { 'roles:delete': 1 })
  })

  it('arrays, row builders and unresolvable values get readable keys', () => {
    const rows = `${header}import { buildRoleAudit } from '../utils/role-audit'
export async function many(kind: string) {
  await getDb().transaction(async (tx) => {
    await tx.insert(roles)
    await tx.insert(activityLogs).values([{ action: 'delete', resource: 'roles' }, { action: 'delete', resource: 'user_roles' }])
    await tx.insert(activityLogs).values(buildRoleAudit({ operation: 'rename' }))
    await tx.insert(activityLogs).values({ action: kind, resource: 'roles' })
  })
}\n`
    const caller = "import { many } from '../services/r'\nexport default defineEventHandler(async () => { await many('x') })\n"
    assert.deepEqual(countsOf(['server/services/r.ts', rows], ['server/api/admin/r.post.ts', caller]), {
      'roles:delete': 1, 'roles:‹kind›': 1, 'user_roles:delete': 1, '‹buildRoleAudit›:rename': 1,
    })
  })
})
