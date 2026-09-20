/**
 * The comment engine, parameterized over articles and media items.
 *
 * The engine is ONE implementation serving two item kinds. That is the whole
 * design (design.md §1): a second table would have started from none of the seven
 * mechanisms `server/services/comments.ts` already carries — reply-depth
 * eligibility, two-key rate limiting, the notification written in the same
 * transaction as the reply, the reply email, the cascade-impact counter, the
 * admin-reply path, and `serializePublicComment` — and the loss would have been
 * silent, because a comment still saves fine without any of them.
 *
 * So the thing worth testing is not "media comments work". It is that the two
 * kinds are kept APART everywhere the article path used to be able to assume it
 * was the only kind, and that the article path still behaves exactly as it did.
 * Each `describe` below names the specific silent failure it prevents.
 *
 * What this file does NOT prove: that any of it runs against MySQL. The queries
 * here are read as source text. `tests/notification-page-integration.test.ts`
 * drives the real thread query, and the DDL assertions live in the schema tests.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  resolveCommentTarget,
  checkParentEligibility,
  parseCommentSource,
  COMMENT_MAX_PER_PAGE,
} from '../server/services/comments.ts'
import {
  notificationUrl,
  notificationTargetPage,
  COMMENT_THREAD_PER_PAGE,
} from '../server/services/notifications.ts'

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

/** Strip comments before asserting a thing must NOT appear, so the sentence
 *  explaining why it is forbidden does not fail the test explaining it. */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * One function's body, from its declaration to the next top-level `export`.
 *
 * `exported` is false for the two helpers in notification-email.ts, which are
 * module-private. Reaching them by text is the only option — exporting a function
 * purely so a test can see it widens the module's surface for the test's benefit,
 * which is the wrong direction. The `assert.ok` on the search is what keeps this
 * honest: a rename makes the guard fail loudly rather than silently assert
 * nothing, which is the failure mode a text search invites.
 */
function functionBody(source: string, name: string, exported = true): string {
  const prefixes = exported
    ? [`export async function ${name}`, `export function ${name}`]
    : [`async function ${name}`, `function ${name}`]
  const start = prefixes.map(prefix => source.indexOf(prefix)).find(at => at !== -1) ?? -1
  assert.ok(start !== -1, `${name} no longer exists — this guard is now testing nothing`)
  const next = source.indexOf('\nexport ', start + 10)
  return next === -1 ? source.slice(start) : source.slice(start, next)
}

describe('10.1 — exactly one item, enforced at runtime', () => {
  it('accepts an article on its own', () => {
    const resolved = resolveCommentTarget(3, null)
    assert.equal(resolved.ok, true)
    assert.deepEqual(resolved.ok && resolved.target, { kind: 'article', articleId: 3 })
  })

  it('accepts a media item on its own', () => {
    const resolved = resolveCommentTarget(null, 9)
    assert.equal(resolved.ok, true)
    assert.deepEqual(resolved.ok && resolved.target, { kind: 'media', mediaItemId: 9 })
  })

  it('refuses BOTH set rather than picking one', () => {
    // Picking one by precedence would store the comment on an item the caller may
    // not have meant, and the row would then be a permanent record of a decision
    // nobody made.
    assert.equal(resolveCommentTarget(3, 9).ok, false)
  })

  it('refuses NEITHER set', () => {
    assert.equal(resolveCommentTarget(null, null).ok, false)
    assert.equal(resolveCommentTarget(undefined, undefined).ok, false)
  })

  it('refuses values that are not usable identifiers', () => {
    // A route that read the id from a query string can hand over NaN, Infinity or
    // a negative number. All three are rejected here rather than becoming an
    // INSERT against item 0 — which would fail as a foreign key error, or worse,
    // succeed against a row nobody meant.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(resolveCommentTarget(bad, null).ok, false, `accepted articleId ${bad}`)
      assert.equal(resolveCommentTarget(null, bad).ok, false, `accepted mediaItemId ${bad}`)
    }
  })

  it('createComment resolves the target before it touches anything else', () => {
    const body = functionBody(read('server/services/comments.ts'), 'createComment')
    const resolveAt = body.indexOf('resolveCommentTarget(')
    const insertAt = body.indexOf('tx.insert(articleComments)')
    assert.ok(resolveAt !== -1, 'createComment no longer runs the XOR guard')
    assert.ok(insertAt !== -1, 'createComment no longer inserts a comment')
    assert.ok(resolveAt < insertAt, 'the XOR guard runs after the insert, so a bad target still writes')
  })
})

describe('10.2 — a parent must belong to the same item AND the same kind', () => {
  const articleTarget = { kind: 'article' as const, articleId: 3 }
  const mediaTarget = { kind: 'media' as const, mediaItemId: 9 }

  it('refuses a parent from a different media item', () => {
    // Article ids and media item ids are independent sequences, so a check that
    // reduced the target to a bare number would accept this whenever the numbers
    // happened to coincide.
    const parent = { id: 20, articleId: null, mediaItemId: 10, parentId: null }
    assert.equal(checkParentEligibility(parent, mediaTarget).ok, false)
  })

  it('refuses an article parent for a media reply, and the reverse, at the SAME id', () => {
    // The collision case. Both of these share an identifier with the target.
    const articleParent = { id: 30, articleId: 9, mediaItemId: null, parentId: null }
    const mediaParent = { id: 31, articleId: null, mediaItemId: 3, parentId: null }
    assert.equal(checkParentEligibility(articleParent, mediaTarget).ok, false)
    assert.equal(checkParentEligibility(mediaParent, articleTarget).ok, false)
  })

  it('accepts the matching cases', () => {
    assert.equal(
      checkParentEligibility({ id: 10, articleId: 3, mediaItemId: null, parentId: null }, articleTarget).ok,
      true,
    )
    assert.equal(
      checkParentEligibility({ id: 20, articleId: null, mediaItemId: 9, parentId: null }, mediaTarget).ok,
      true,
    )
  })

  it('refuses a parent carrying both identifiers', () => {
    // Unreachable through the write guard; the read must not depend on that,
    // because such a row would otherwise match both threads at once.
    const both = { id: 40, articleId: 3, mediaItemId: 9, parentId: null }
    assert.equal(checkParentEligibility(both, articleTarget).ok, false)
    assert.equal(checkParentEligibility(both, mediaTarget).ok, false)
  })

  it('takes the target as a kind plus an identity, not a bare id', () => {
    // The signature IS the guarantee here. `itemId: number | null` — the shape
    // before this change — could not distinguish "both are media comments" from
    // "both are on the same media item", so a reply could cross between two
    // videos with no check able to notice.
    const source = read('server/services/comments.ts')
    assert.match(
      source,
      /export function checkParentEligibility\(parent: ParentCandidate \| null \| undefined, target: CommentTarget\)/,
      'checkParentEligibility no longer takes a typed target — the kind has been dropped from the comparison',
    )
  })
})

describe('10.3 — the thread is scoped by item in BOTH passes', () => {
  const body = functionBody(read('server/services/comments.ts'), 'loadCommentThread')

  it('uses isNull, never eq(column, null)', () => {
    // Drizzle renders `eq(column, null)` as `= NULL`, which is unknown in SQL
    // rather than true — so a media thread would come back EMPTY rather than
    // erroring, and an empty thread reads as "nobody has commented".
    assert.match(body, /isNull\(articleComments\.mediaItemId\)/, 'the article thread no longer excludes media comments')
    assert.match(body, /isNull\(articleComments\.articleId\)/, 'the media thread no longer excludes article comments')
    assert.ok(
      !/eq\(articleComments\.(articleId|mediaItemId),\s*null\)/.test(body),
      'a null comparison is back — that branch matches nothing and returns an empty thread',
    )
  })

  it('scopes the count query', () => {
    const countAt = body.indexOf('COUNT(*)')
    const scopedAt = body.indexOf('const topLevel =')
    assert.ok(countAt !== -1 && scopedAt !== -1)
    assert.ok(scopedAt < countAt, 'the count runs before the item scope is built')
    assert.match(body.slice(countAt, countAt + 400), /\.where\(topLevel\)/, 'the count query is not scoped by item')
  })

  it('scopes the reply query too', () => {
    // Branching only the count would page an article's comments by a total taken
    // from videos; branching only the reply query would attach another item's
    // replies to this page's parents. Both render, and both look plausible.
    assert.match(
      body,
      /\.where\(and\(scoped, inArray\(articleComments\.parentId/,
      'the reply query is not scoped by item — another item\'s replies would attach to this page\'s parents',
    )
  })

  it('takes the same two optional identifiers as CreateCommentInput', () => {
    // One vocabulary for the engine. A `target: CommentTarget` parameter would
    // have forced every caller — including the article endpoint that was already
    // working — to build a union before it could read a thread.
    assert.match(
      body,
      /articleId\?:\s*number \| null/,
      'loadCommentThread no longer takes articleId',
    )
    assert.match(
      body,
      /mediaItemId\?:\s*number \| null/,
      'loadCommentThread no longer takes mediaItemId',
    )
    assert.match(body, /resolveCommentTarget\(params\.articleId, params\.mediaItemId\)/, 'the read path does not run the XOR guard')
  })
})

describe('10.4 — the moderation list carries both kinds, and neither join may drop a row', () => {
  const body = functionBody(read('server/services/comments.ts'), 'listCommentsForAdmin')

  it('joins media_items with a leftJoin', () => {
    // An inner join drops every comment whose media item is gone — which is
    // exactly the row most worth keeping, because it is unattributable from every
    // other screen.
    assert.match(
      body,
      /\.leftJoin\(mediaItems, eq\(articleComments\.mediaItemId, mediaItems\.id\)\)/,
      'the media join is missing, or is not a leftJoin',
    )
  })

  it('keeps the articles join a leftJoin, which is what lets media comments appear at all', () => {
    // The mirror of the point above, and the easier one to get wrong: a media
    // comment has `article_id = NULL`, so an inner join on `articles` removes
    // every video comment from the list meant to moderate them.
    assert.match(
      body,
      /\.leftJoin\(articles, eq\(articleComments\.articleId, articles\.id\)\)/,
      'the articles join is missing, or is not a leftJoin',
    )
  })

  it('selects the media columns the screen has to name the item by', () => {
    for (const column of ['mediaItemTitle', 'mediaItemSlug', 'mediaItemId']) {
      assert.match(body, new RegExp(`${column}:`), `the list no longer selects ${column}`)
    }
  })

  it('filters by source on the identifier being set, not on the other one being null', () => {
    assert.match(body, /params\.source === 'media'[\s\S]{0,120}isNotNull\(articleComments\.mediaItemId\)/, 'the media filter does not test the media column')
    assert.match(body, /params\.source === 'article'[\s\S]{0,120}isNotNull\(articleComments\.articleId\)/, 'the article filter does not test the article column')
  })

  it('refuses an unknown source instead of ignoring it', () => {
    // `?source=1` silently returning everything while the filter still shows
    // "Video" is how an officer concludes there are no article comments left.
    assert.equal(parseCommentSource('media').ok, true)
    assert.equal(parseCommentSource('article').ok, true)
    assert.equal(parseCommentSource('').ok, true, 'an empty source must mean "no filter"')
    assert.equal(parseCommentSource(undefined).ok, true)
    assert.equal(parseCommentSource('1').ok, false)
    assert.equal(parseCommentSource('MEDIA').ok, false)
    assert.equal(parseCommentSource('video').ok, false)
  })

  it('an absent source filters nothing', () => {
    const parsed = parseCommentSource(undefined)
    assert.equal(parsed.ok && parsed.source, null)
  })
})

describe('10.5 — a removal records which item it was on', () => {
  const body = functionBody(read('server/services/comments.ts'), 'deleteComment')

  it('reads mediaItemId in its first select', () => {
    assert.match(body, /mediaItemId:\s*articleComments\.mediaItemId/, 'deleteComment does not read the media identifier')
  })

  it('writes both identifiers into the audit meta', () => {
    const metaAt = body.indexOf('meta:')
    assert.ok(metaAt !== -1, 'deleteComment no longer writes an audit row')
    const meta = body.slice(metaAt, metaAt + 400)
    assert.match(meta, /articleId/, 'the audit row no longer names the article')
    assert.match(meta, /mediaItemId/, 'the audit row no longer names the media item')
  })

  it('never puts a slug or a URL in the audit row', () => {
    // Ids only. A slug is derived data that can change, and copying it into an
    // immutable log creates a second copy that no longer matches after a rename.
    const metaAt = body.indexOf('meta:')
    const meta = stripComments(body.slice(metaAt, metaAt + 400))
    for (const forbidden of ['slug', 'url', 'title', 'body']) {
      assert.ok(
        !new RegExp(`${forbidden}:`, 'i').test(meta),
        `the audit meta carries ${forbidden} — ids only, or the log disagrees with the row it describes`,
      )
    }
  })

  it('every deletion path still routes through this one function', () => {
    // Six callers share it. A second deletion path is how replies and
    // notifications stop being handled identically.
    const source = read('server/services/comments.ts')
    assert.match(source, /export async function deleteComment/, 'the single deletion path is gone')
    for (const file of [
      'server/services/readers.ts',
      'server/api/public/comments/[id].delete.ts',
    ]) {
      const caller = read(file)
      assert.match(caller, /deleteComment|deleteReaderComments/, `${file} no longer uses the shared deletion path`)
    }
  })
})

describe('10.6 — the notification link resolves to the right item kind', () => {
  it('builds a media link as /media/<slug>', () => {
    assert.equal(
      notificationUrl({ kind: 'media', slug: 'phong-chong-ma-tuy', page: 1, commentId: 45 }),
      '/media/phong-chong-ma-tuy#comment-45',
    )
  })

  it('builds a media link with the page when the comment is not on page 1', () => {
    // The whole point of the page number: without it the link opens page 1 and
    // the reader finds nothing, which reads as the portal deleting their comment.
    assert.equal(
      notificationUrl({ kind: 'media', slug: 'phong-chong-ma-tuy', page: 3, commentId: 45 }),
      '/media/phong-chong-ma-tuy?comments=3#comment-45',
    )
  })

  it('still builds the article link exactly as before', () => {
    assert.equal(
      notificationUrl({ kind: 'article', slug: 'tin-tuc', page: 1, commentId: 7 }),
      '/news/tin-tuc#comment-7',
    )
    assert.equal(
      notificationUrl({ kind: 'article', slug: 'tin-tuc', page: 2, commentId: 7 }),
      '/news/tin-tuc?comments=2#comment-7',
    )
  })

  it('the notification list uses it rather than assembling the string inline', () => {
    const body = functionBody(read('server/services/notifications.ts'), 'listNotifications')
    assert.match(body, /notificationUrl\(\{/, 'listNotifications builds its URL by hand again')
    assert.match(body, /kind:\s*isMedia \? 'media' : 'article'/, 'the list no longer picks the kind')
  })

  it('reads the media columns through a leftJoin', () => {
    // Same reasoning as the moderation list: a reply on an archived item must
    // still be listed, or the reader reads the list as the reply being deleted.
    const body = functionBody(read('server/services/notifications.ts'), 'listNotifications')
    assert.match(
      body,
      /\.leftJoin\(mediaItems, eq\(articleComments\.mediaItemId, mediaItems\.id\)\)/,
      'the media join is missing, or is not a leftJoin',
    )
  })

  it('counts older comments by whichever identifier the comment carries', () => {
    // A media comment has `article_id = NULL`, and `older.article_id = NULL` is
    // unknown rather than false — so scoping the count by the article column
    // alone makes it 0 for every media comment and every media link opens page 1.
    //
    // Matched with the backslash that is actually in the source: the predicate is
    // a template literal, so its backticks are escaped. A regex written with plain
    // backticks matches nothing and reports the predicate as missing.
    const service = read('server/services/notifications.ts')
    const predicate = functionBody(service, 'sameItemPredicate')
    assert.match(predicate, /\\`article_comments\\`\.\\`article_id\\` IS NOT NULL/, 'the predicate counts NULLs as matches')
    assert.match(predicate, /\\`article_comments\\`\.\\`media_item_id\\` IS NOT NULL/, 'the predicate has no media branch')
    // Both branches, joined by OR. An AND would require a comment to be on an
    // article AND a media item at once — which the XOR invariant says is nothing,
    // so every count would come back 0.
    assert.match(predicate, /\)\s*\n\s*OR \(/, 'the two branches are no longer alternatives')
  })

  it('the email counts older comments with the SAME predicate, not a copy', () => {
    // Two copies of this SQL are two chances to scope by the wrong column, and
    // the email's copy is the one nobody looks at — a wrong page in an email is
    // only ever discovered by a reader who followed it.
    const email = read('server/services/notification-email.ts')
    assert.match(email, /sameItemPredicate\(\)/, 'the email no longer shares the predicate')
    assert.ok(
      !/`older`\.`article_id` = `article_comments`\.`article_id`/.test(email),
      'the email has its own copy of the older-comment predicate',
    )
  })
})

describe('10.7 — one page size, and one ceiling, and they are different numbers', () => {
  it('the thread default and the thread ceiling are distinct roles', () => {
    // These are NOT duplicates and must not be merged. 20 is the page size a
    // notification's page arithmetic is computed against; 50 is the most a client
    // is allowed to ask for. Collapsing them to one number would either cap the
    // thread at 20 — changing article pagination for every existing reader — or
    // let a client request pages of 50 and put every notification link on the
    // wrong page.
    assert.equal(COMMENT_THREAD_PER_PAGE, 20)
    assert.equal(COMMENT_MAX_PER_PAGE, 50)
    assert.ok(
      COMMENT_MAX_PER_PAGE > COMMENT_THREAD_PER_PAGE,
      'the ceiling is at or below the default, which makes one of them meaningless',
    )
  })

  it('the thread default has exactly one declaration', () => {
    const notifications = stripComments(read('server/services/notifications.ts'))
    const declarations = notifications.match(/COMMENT_THREAD_PER_PAGE\s*=\s*\d+/g) ?? []
    assert.equal(declarations.length, 1, `COMMENT_THREAD_PER_PAGE is declared ${declarations.length} times`)
    assert.match(declarations[0] ?? '', /=\s*20$/)
  })

  it('no consumer re-declares the page size as its own literal', () => {
    // The email does not reference the constant by name, and it does not need to:
    // it calls `notificationTargetPage(olderCount)`, which defaults to
    // COMMENT_THREAD_PER_PAGE. Asserting the NAME appears in the email would be
    // asserting a spelling rather than the property — and the property is that no
    // consumer re-derives the page size for itself.
    //
    // notifications.ts is excluded because that is where the number is declared;
    // everywhere else a `...PER_PAGE = <number>` is a second page size, and two
    // page sizes is how a notification link lands beside its comment with nothing
    // reporting an error.
    const consumers = [
      'server/services/notification-email.ts',
      'server/api/public/comments/[articleSlug].get.ts',
    ]
    for (const file of consumers) {
      const source = stripComments(read(file))
      assert.ok(
        !/\w*PER_PAGE\s*=\s*\d/.test(source),
        `${file} declares its own page size instead of using the shared constant`,
      )
    }

    // And the endpoint that serves the thread imports the shared one by name,
    // rather than passing a number of its own.
    const endpoint = stripComments(read('server/api/public/comments/[articleSlug].get.ts'))
    assert.match(endpoint, /import \{ COMMENT_THREAD_PER_PAGE \}/, 'the thread endpoint no longer imports the shared page size')
    assert.match(endpoint, /const DEFAULT_PER_PAGE = COMMENT_THREAD_PER_PAGE/, 'the thread endpoint uses a different page size')
  })

  it('the page arithmetic is the shared one, on both surfaces', () => {
    const notifications = stripComments(read('server/services/notifications.ts'))
    const email = stripComments(read('server/services/notification-email.ts'))
    assert.match(notifications, /export function notificationTargetPage\(olderCount: number, perPage = COMMENT_THREAD_PER_PAGE\)/, 'notificationTargetPage no longer defaults to the shared page size')
    assert.match(email, /notificationTargetPage\(olderCount\)/, 'the email computes its page some other way')
  })
})

describe('10.8 — email for a media reply, and never inside the transaction', () => {
  const email = read('server/services/notification-email.ts')
  const send = functionBody(email, 'sendReplyEmail')

  it('does not bail out when articleId is null', () => {
    // The hard block that would have made the whole feature silently inert:
    // `if (reply.articleId === null) return false` was correct while articles
    // were the only kind, and becomes "media replies never email" the moment a
    // second kind exists — with nothing logged and nothing failing.
    assert.ok(
      !/if \(reply\.articleId === null\) return false/.test(stripComments(send)),
      'the article-only early return is back — every media reply would silently never email',
    )
  })

  it('resolves the item kind rather than assuming an article', () => {
    assert.match(send, /resolveMailTarget\(reply\)/, 'the email no longer resolves which item the reply is on')
    assert.match(email, /mediaItems\.slug/, 'the email never reads a media slug')
    assert.match(email, /mediaItems\.commentsEnabled/, 'the email does not check whether media commenting is on')
  })

  it('requires the media item to be published with comments enabled', () => {
    const resolver = functionBody(email, 'resolveMailTarget', false)
    const mediaBranch = resolver.slice(resolver.indexOf('reply.mediaItemId !== null'))
    assert.match(mediaBranch, /item\.status !== 'published'/, 'an unpublished media item would still be emailed')
    assert.match(mediaBranch, /item\.commentsEnabled/, 'a media item with commenting off would still be emailed')
    assert.match(mediaBranch, /item\?\.slug/, 'a media item with no slug would still be emailed')
  })

  it('sends after the transaction commits, never inside it', () => {
    // Inside, an unreachable SMTP host holds the comment's row locks open for the
    // length of a network timeout — a mail outage becomes a comment outage.
    const comments = read('server/services/comments.ts')
    for (const fn of ['createComment', 'createAdminReply']) {
      const body = functionBody(comments, fn)
      const sendAt = body.indexOf('await sendReplyEmail(')
      const txAt = body.indexOf('await db.transaction(')
      assert.ok(sendAt !== -1, `${fn} no longer sends the reply email`)
      assert.ok(txAt !== -1, `${fn} no longer wraps its writes in a transaction`)
      assert.ok(sendAt > txAt, `${fn} sends the email before its transaction`)

      /**
       * And outside the CALLBACK, not merely after its opening line.
       *
       * `body.indexOf('})\n', txAt)` was the first attempt and it was wrong: the
       * first `})` after `db.transaction(` is the close of `createReplyNotification({
       * … })`, which sits in the middle of the callback — so a send placed right
       * after it, still inside the transaction, passed. The control caught it:
       * moving the send inside left the suite green.
       *
       * Counting braces from the `async (tx) => {` that opens the callback is the
       * honest version: the send must appear after the depth returns to zero.
       */
      const callbackAt = body.indexOf('db.transaction(async (tx) => {', txAt)
      assert.ok(callbackAt !== -1, `${fn}'s transaction callback is no longer named \`tx\``)
      const openAt = body.indexOf('{', body.indexOf('async (tx) =>', callbackAt))
      let depth = 0
      let closeAt = -1
      for (let i = openAt; i < body.length; i += 1) {
        if (body[i] === '{') depth += 1
        else if (body[i] === '}') {
          depth -= 1
          if (depth === 0) { closeAt = i; break }
        }
      }
      assert.ok(closeAt !== -1, `${fn}'s transaction callback is not closed — this guard cannot judge it`)
      assert.ok(
        sendAt > closeAt,
        `${fn} sends the email from inside the transaction callback — an SMTP timeout would hold the row locks open`,
      )
    }
  })

  it('escapes every interpolated value', () => {
    // An item title, a display name and a comment body are all text a person
    // typed, and the body is stored verbatim precisely because nothing may
    // interpret it.
    const htmlStart = send.indexOf('const html =')
    const html = send.slice(htmlStart)
    assert.match(html, /escapeHtml\(authorName\)/, 'the author name is unescaped')
    assert.match(html, /escapeHtml\(target\.noun\)/, 'the item kind is unescaped')
    assert.match(html, /escapeHtml\(target\.title\)/, 'the item title is unescaped')
    assert.match(html, /escapeHtml\(excerpt\)/, 'the comment excerpt is unescaped')
    assert.match(html, /escapeHtml\(url\)/, 'the link is unescaped')
  })

  it('omits the link rather than emitting a relative one', () => {
    // A relative path in an email is a dead string — no page to resolve it
    // against. The message still goes out; it just says what happened.
    assert.match(send, /const base = configuredBaseUrl\(\)/, 'the email no longer checks for a base address')
    assert.match(send, /url = base \? `\$\{base\}\$\{path\}` : ''/, 'the email builds a link without a base address')
    assert.match(send, /url \? `Xem toàn bộ trao đổi/, 'the plain-text body does not fall back when there is no link')
  })

  it('names the item kind in the sentence rather than saying "bài viết" for a video', () => {
    assert.match(send, /trong \$\{target\.noun\} "/, 'the body hard-codes "bài viết"')
  })

  it('swallows a mail failure so the reply survives it', () => {
    // Total by design: the reply is already committed and the in-portal
    // notification already recorded it.
    assert.match(send, /catch \(error\)/, 'sendReplyEmail no longer catches its own failures')
    assert.match(send, /reader_notification\.email_failed/, 'a mail failure no longer leaves a log line')
  })
})

describe('10.9 — one thread component, parameterized on the item axis', () => {
  const component = read('app/components/ArticleComments.vue')

  it('takes the media item identifier as an optional prop', () => {
    assert.match(component, /mediaItemId\?:\s*number \| null/, 'the component has no mediaItemId prop')
  })

  it('parameterizes the endpoint rather than duplicating the component', () => {
    // A second component would have produced two threads that drift: one keeping
    // the draft-recovery path or the 401 handling, the other not, with nothing
    // reporting the difference.
    assert.match(component, /const threadQuery = computed\(/, 'the thread query is no longer parameterized')
    assert.match(component, /source: 'media'/, 'a media thread does not tell the server which kind it is')
    assert.match(component, /mediaSlug: props\.slug/, 'a media comment is not posted with a media slug')
  })

  it('keeps the article request byte-for-byte what it was', () => {
    // The article path serves production comments. An absent `source` reads as
    // the old behaviour; sending `source=article` would be a new parameter on a
    // request that already works.
    assert.match(component, /articleSlug: props\.slug/, 'the article POST body changed shape')
    assert.match(
      component,
      /isMedia\.value\s*\?\s*\{ page: page\.value, source: 'media' \}\s*:\s*\{ page: page\.value \}/,
      'the article GET query is no longer exactly `{ page }`',
    )
  })

  it('still renders comment bodies as text, never as markup', () => {
    // The body is stored verbatim, so this template is the only thing standing
    // between a citizen's text and being interpreted.
    assert.ok(!/v-html/.test(stripComments(component)), 'v-html is back in the comment thread')
  })

  it('still loads the thread after mount only', () => {
    // Public routes are cached for 60 seconds, so a thread rendered on the server
    // would be replayed to the next visitor — including the flags saying which
    // comments are the current reader's to delete.
    assert.match(component, /onMounted\(async \(\) => \{/, 'the component no longer defers its load to mount')
    assert.ok(
      !/useFetch|useAsyncData/.test(stripComments(component)),
      'the thread is fetched during setup, so it can enter server-rendered HTML',
    )
  })
})
