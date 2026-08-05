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
import { readFileSync } from 'node:fs'
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
