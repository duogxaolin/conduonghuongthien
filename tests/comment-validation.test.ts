/**
 * Comment body validation, the one-level reply rule, and the public projection's
 * field list.
 *
 * All three are pure functions in server/services/comments.ts, and that is
 * deliberate: they are the rules most likely to be "simplified" in a later
 * refactor, and a rule only exercisable against a live MySQL server is a rule
 * nobody exercises.
 *
 * The projection test is the one worth arguing for. `article_comments` carries
 * `ip` and `user_agent`, and `reader_accounts` carries `email`. A future edit
 * that replaced the hand-listed fields with a table spread would publish all
 * three to a public endpoint, and nothing would fail — the response would just
 * get wider. So this file asserts the exact key set, not merely that the expected
 * keys are present.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const {
  COMMENT_MAX_LENGTH,
  ADMIN_REPLY_DISPLAY_NAME,
  validateBody,
  checkParentEligibility,
  serializePublicComment,
  initialsFrom,
} = await import('../server/services/comments.ts')

describe('validateBody', () => {
  it('accepts an ordinary comment and returns the trimmed text', () => {
    const result = validateBody('  Xin hỏi thủ tục xin xác nhận cư trú ạ.  ')
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.body, 'Xin hỏi thủ tục xin xác nhận cư trú ạ.')
  })

  it('normalises CRLF to LF so the same paragraph counts the same everywhere', () => {
    // Otherwise a Windows browser and a phone produce different lengths for
    // identical text, and the limit lands in a different place depending on the
    // device the citizen happened to use.
    const result = validateBody('dòng một\r\ndòng hai\rdòng ba')
    assert.equal(result.ok && result.body, 'dòng một\ndòng hai\ndòng ba')
  })

  it('keeps newlines and tabs, which are the two the render supports', () => {
    const result = validateBody('đoạn một\n\nđoạn hai\tcó tab')
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.body.includes('\n\n'), true)
    assert.equal(result.ok && result.body.includes('\t'), true)
  })

  it('refuses an empty or whitespace-only body', () => {
    for (const bad of ['', '   ', '\n\n', '\t']) {
      assert.equal(validateBody(bad).ok, false, `accepted: ${JSON.stringify(bad)}`)
    }
  })

  it('refuses a non-string body', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      assert.equal(validateBody(bad).ok, false, `accepted: ${JSON.stringify(bad)}`)
    }
  })

  it('refuses control characters other than newline and tab', () => {
    // Written as escapes: a literal control character in source is invisible in
    // every editor and diff, so the next reader could not see what is tested.
    for (const code of [0x00, 0x07, 0x0b, 0x1b, 0x7f]) {
      const body = `xin chào${String.fromCharCode(code)}bạn`
      assert.equal(validateBody(body).ok, false, `accepted control char 0x${code.toString(16)}`)
    }
  })

  it('refuses an over-length body and names the limit in the message', () => {
    const result = validateBody('a'.repeat(COMMENT_MAX_LENGTH + 1))
    assert.equal(result.ok, false)
    // Never silently truncated: a citizen whose last paragraph vanished has no
    // way to know it did.
    assert.match(result.ok === false ? result.message : '', new RegExp(String(COMMENT_MAX_LENGTH)))
  })

  it('accepts a body exactly at the limit', () => {
    assert.equal(validateBody('a'.repeat(COMMENT_MAX_LENGTH)).ok, true)
  })

  it('stores markup verbatim rather than sanitising it', () => {
    // design.md D12: the public component renders through `{{ }}`, so HTML is
    // never interpreted and there is nothing to strip. Rewriting the text here
    // would show a citizen words they did not type — angle brackets in a quoted
    // regulation, an ampersand in an office name.
    const raw = '<script>alert(1)</script> Nghị định 49/2020 & Điều 5 <b>khoản 2</b>'
    const result = validateBody(raw)
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.body, raw)
  })
})

describe('checkParentEligibility — exactly one reply level', () => {
  const parent = { id: 10, articleId: 3, parentId: null }

  it('accepts a top-level comment on the same article', () => {
    assert.equal(checkParentEligibility(parent, 3).ok, true)
  })

  it('refuses a missing parent', () => {
    assert.equal(checkParentEligibility(null, 3).ok, false)
    assert.equal(checkParentEligibility(undefined, 3).ok, false)
  })

  it('refuses a parent belonging to a different article', () => {
    // Without this a reply could be attached to a thread it does not belong to,
    // and would render on an article whose author never saw the question.
    assert.equal(checkParentEligibility(parent, 4).ok, false)
  })

  it('refuses replying to a reply', () => {
    // The depth limit is what keeps the thread renderable on a phone and the read
    // query a fixed two passes rather than a recursion.
    assert.equal(checkParentEligibility({ id: 11, articleId: 3, parentId: 10 }, 3).ok, false)
  })
})

describe('serializePublicComment — the field list is the boundary', () => {
  const row = {
    id: 5,
    articleId: 3,
    readerId: 42,
    adminUserId: null,
    parentId: null,
    body: 'Xin hỏi về thủ tục.',
    createdAt: new Date('2026-08-05T02:00:00.000Z'),
    readerName: 'Nguyễn Văn A',
  }

  it('publishes exactly the expected keys and nothing else', () => {
    const keys = Object.keys(serializePublicComment(row, 42)).sort()
    assert.deepEqual(keys, [
      'authorName', 'body', 'canDelete', 'createdAt', 'id', 'initials', 'isAdminReply', 'parentId',
    ])
  })

  it('never carries email, ip or user agent', () => {
    // Asserted by name as well as by the key set above, so the reason survives:
    // these three are the fields a table spread would leak.
    const serialised = serializePublicComment({ ...row } as never, 42) as Record<string, unknown>
    for (const forbidden of ['email', 'ip', 'userAgent', 'readerId', 'adminUserId', 'googleSub']) {
      assert.equal(forbidden in serialised, false, `${forbidden} reached a public response`)
    }
  })

  it('marks a comment deletable only for its own author', () => {
    assert.equal(serializePublicComment(row, 42).canDelete, true)
    assert.equal(serializePublicComment(row, 43).canDelete, false)
    assert.equal(serializePublicComment(row, null).canDelete, false)
  })

  it('shows the portal label for an administrator reply, never the officer name', () => {
    const reply = { ...row, readerId: null, adminUserId: 7, parentId: 5, readerName: null }
    const serialised = serializePublicComment(reply, 42)
    assert.equal(serialised.isAdminReply, true)
    assert.equal(serialised.authorName, ADMIN_REPLY_DISPLAY_NAME)
    // Not deletable from the public side by anyone: that restriction exists so
    // readers cannot remove the portal's answers.
    assert.equal(serialised.canDelete, false)
  })

  it('falls back to a neutral name when a reader has none on file', () => {
    const serialised = serializePublicComment({ ...row, readerName: null }, 42)
    assert.equal(serialised.authorName, 'Người dùng')
  })
})

describe('the deletion impact counts every row the cascade takes', () => {
  /**
   * The counting rule, extracted from `countImpact` and exercised directly.
   *
   * This mirrors the loop in server/services/comments.ts rather than calling it,
   * because that function issues two queries. That is a real limit — a divergence
   * between this copy and the source would not be caught here — but the bug it
   * guards against is a *rule* bug, not a query bug, and the rule is what shipped
   * wrong: the first version counted only `comments` + `adminReplies`, so a dialog
   * could truthfully say "2" while four rows disappeared.
   *
   * Nothing restricts who may reply, so reader B can answer reader A's question.
   * Deleting A takes B's reply through the parent_id cascade, and an officer told
   * the smaller number is agreeing to something other than what happens — which is
   * precisely what the confirmation dialog exists to prevent.
   */
  function countImpactRule(readerId: number, owned: Array<{ id: number, parentId: number | null }>, under: Array<{ parentId: number, adminUserId: number | null, readerId: number | null }>) {
    const topLevelIds = owned.filter(r => r.parentId === null).map(r => r.id)
    let adminReplies = 0
    let otherReaderReplies = 0
    for (const row of under) {
      if (!topLevelIds.includes(row.parentId)) continue
      if (row.adminUserId !== null) adminReplies += 1
      else if (row.readerId !== readerId) otherReaderReplies += 1
    }
    return { comments: owned.length, adminReplies, otherReaderReplies }
  }

  it('counts replies by OTHER readers, not just administrator ones', () => {
    const impact = countImpactRule(42, [{ id: 1, parentId: null }], [
      { parentId: 1, adminUserId: 7, readerId: null },
      { parentId: 1, adminUserId: null, readerId: 55 },
      { parentId: 1, adminUserId: null, readerId: 56 },
    ])
    assert.deepEqual(impact, { comments: 1, adminReplies: 1, otherReaderReplies: 2 })
    // The number that matters: what the dialog states must equal what disappears.
    assert.equal(
      impact.comments + impact.adminReplies + impact.otherReaderReplies,
      4,
      'the three counts must add up to every row the cascade removes',
    )
  })

  it('does not double-count the reader\'s own reply', () => {
    // A reply this reader wrote is already inside `owned`; counting it again under
    // otherReaderReplies would overstate the damage, which erodes trust in the
    // dialog just as surely as understating it.
    const impact = countImpactRule(42, [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
    ], [
      { parentId: 1, adminUserId: null, readerId: 42 },
    ])
    assert.equal(impact.comments, 2)
    assert.equal(impact.otherReaderReplies, 0)
  })

  it('ignores replies hanging off somebody else\'s comment', () => {
    const impact = countImpactRule(42, [{ id: 1, parentId: null }], [
      { parentId: 99, adminUserId: 7, readerId: null },
      { parentId: 99, adminUserId: null, readerId: 55 },
    ])
    assert.deepEqual(impact, { comments: 1, adminReplies: 0, otherReaderReplies: 0 })
  })

  it('reports zeros for a reader who has written nothing', () => {
    assert.deepEqual(countImpactRule(42, [], []), { comments: 0, adminReplies: 0, otherReaderReplies: 0 })
  })

  it('the service still returns all three fields and still splits by author', () => {
    // The copy above tests the RULE; this anchors it to the source, so a refactor
    // that drops the third counter or stops distinguishing authors fails here even
    // though the copy would keep passing happily on its own.
    const source = readFileSync(new URL('../server/services/comments.ts', import.meta.url), 'utf8')
    assert.match(source, /otherReaderReplies/, 'countImpact no longer counts other readers\' replies')
    assert.match(
      source,
      /row\.readerId !== readerId/,
      'countImpact no longer distinguishes another reader\'s reply from this reader\'s own',
    )
    assert.match(
      source,
      /adminUserId !== null/,
      'countImpact no longer separates administrator replies',
    )
  })
})

describe('initialsFrom — the locally drawn avatar', () => {
  it('takes first and last initial of a full name', () => {
    assert.equal(initialsFrom('Nguyễn Văn An'), 'NA')
  })

  it('takes one letter from a single-word name', () => {
    assert.equal(initialsFrom('An'), 'A')
  })

  it('never returns an empty string', () => {
    // The avatar renders this directly; an empty circle reads as a broken image,
    // which is the exact impression design.md D7 avoids by not loading one.
    for (const input of ['', '   ', '\n']) {
      assert.equal(initialsFrom(input), '?')
    }
  })
})
