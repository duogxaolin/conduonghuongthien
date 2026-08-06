/**
 * Reader notifications — the pure logic, and the guards that keep the feature
 * cache-safe and reachable.
 *
 * Two things here are worth more than the rest:
 *
 *   1. **The page arithmetic.** A notification points at a *reply*, but the
 *      thread paginates over *top-level* comments. If the page number is wrong,
 *      every notification about an older question opens page 1 and shows nothing
 *      — which reads as the portal having deleted what the reader wrote. The
 *      arithmetic is pure so it can be pinned here; that it agrees with the real
 *      thread was verified against MySQL during development.
 *   2. **One page size, one place.** `COMMENT_THREAD_PER_PAGE` is imported by the
 *      thread endpoint rather than redeclared. A second copy is the failure mode
 *      that produces links landing *near* a comment instead of on it, with
 *      nothing failing anywhere.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  buildExcerpt,
  notificationTargetPage,
  COMMENT_THREAD_PER_PAGE,
  NOTIFICATION_EXCERPT_LENGTH,
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

describe('notificationTargetPage', () => {
  it('puts the first page of comments on page 1', () => {
    assert.equal(notificationTargetPage(0), 1)
    assert.equal(notificationTargetPage(COMMENT_THREAD_PER_PAGE - 1), 1)
  })

  it('rolls to the next page exactly at the boundary', () => {
    assert.equal(notificationTargetPage(COMMENT_THREAD_PER_PAGE), 2)
    assert.equal(notificationTargetPage(COMMENT_THREAD_PER_PAGE * 2), 3)
  })

  it('places a comment in the middle of a page correctly', () => {
    // 44 comments before it, 20 per page → page 3 (positions 40-59).
    assert.equal(notificationTargetPage(44, 20), 3)
  })

  /**
   * A NaN page number would serialise into the URL as `page=NaN`, and the
   * component's `Number.isSafeInteger` check would then reject it and silently
   * show page 1 — the exact "link goes nowhere" symptom, arrived at by a
   * different route.
   */
  it('never emits a non-finite page', () => {
    assert.equal(notificationTargetPage(Number.NaN), 1)
    assert.equal(notificationTargetPage(Number.POSITIVE_INFINITY), 1)
    assert.equal(notificationTargetPage(-5), 1)
    assert.equal(notificationTargetPage(10, 0), 1)
  })
})

describe('buildExcerpt', () => {
  it('leaves a short body exactly as written', () => {
    assert.equal(buildExcerpt('Cảm ơn ban quản trị.'), 'Cảm ơn ban quản trị.')
  })

  it('does not append an ellipsis to a body that fits', () => {
    assert.ok(!buildExcerpt('Ngắn').endsWith('…'))
  })

  it('bounds a long body and marks it as cut', () => {
    const excerpt = buildExcerpt('a'.repeat(500))
    assert.ok(excerpt.endsWith('…'))
    assert.ok(excerpt.length <= NOTIFICATION_EXCERPT_LENGTH + 1)
  })

  /**
   * The excerpt renders on one clamped line. A body whose first line is short
   * would otherwise look like the whole reply, so newlines collapse to spaces.
   */
  it('flattens newlines', () => {
    const excerpt = buildExcerpt('dòng một\n\ndòng hai')
    assert.ok(!excerpt.includes('\n'))
    assert.equal(excerpt, 'dòng một dòng hai')
  })

  it('cuts a run-on token rather than collapsing to nothing', () => {
    // No space anywhere: the word-boundary rule must not win here, or the
    // excerpt would be empty.
    const excerpt = buildExcerpt('x'.repeat(400))
    assert.ok(excerpt.length > NOTIFICATION_EXCERPT_LENGTH * 0.9)
  })
})

describe('one page size, imported not redeclared', () => {
  /**
   * The thread endpoint must not carry its own copy of the page size. If the two
   * drift, `notificationTargetPage` computes positions against one number while
   * the endpoint serves pages of another — links land near the comment instead of
   * on it, and nothing anywhere fails.
   */
  it('the comment thread endpoint imports the shared constant', () => {
    const source = read('server/api/public/comments/[articleSlug].get.ts')
    assert.match(source, /COMMENT_THREAD_PER_PAGE/, 'the endpoint no longer shares the notification page size')
    assert.match(
      stripComments(source),
      /const DEFAULT_PER_PAGE = COMMENT_THREAD_PER_PAGE/,
      'DEFAULT_PER_PAGE is a literal again — deep links will drift out of alignment',
    )
  })
})

describe('the notification is written with the reply, not after it', () => {
  const comments = read('server/services/comments.ts')

  /**
   * A reply that exists with nobody told about it is the exact state this feature
   * was built to prevent, and it fails silently: the thread looks correct to
   * everyone except the person waiting for an answer.
   */
  it('createComment inserts inside a transaction', () => {
    const start = comments.indexOf('export async function createComment')
    const body = comments.slice(start, comments.indexOf('\nexport ', start + 10))
    assert.match(body, /db\.transaction\(/, 'createComment no longer wraps its writes in a transaction')
    assert.match(body, /createReplyNotification\(/, 'createComment stopped announcing replies')
    assert.match(body, /tx,/, 'the notification is not being written on the transaction handle')
  })

  it('createAdminReply notifies on the transaction handle', () => {
    const start = comments.indexOf('export async function createAdminReply')
    const body = comments.slice(start)
    assert.match(body, /createReplyNotification\(/, 'the portal reply no longer notifies the citizen')
    // `db.insert` inside a transaction block still commits independently — the
    // notification has to ride the same `tx`.
    const call = body.slice(body.indexOf('createReplyNotification('))
    assert.match(call.slice(0, 260), /tx,/, 'admin reply notification is not on the transaction handle')
  })
})

describe('reader-scoped queries are bounded by the ticket', () => {
  const service = read('server/services/notifications.ts')

  /**
   * Filtering on id alone would let a caller mark somebody else's notifications
   * read. Small on its own, but it is the shape of query that later grows into
   * reading them.
   */
  it('markRead and markAllRead both filter on readerId', () => {
    for (const fn of ['markRead', 'markAllRead']) {
      const start = service.indexOf(`export async function ${fn}`)
      assert.ok(start !== -1, `${fn} no longer exists`)
      const body = service.slice(start, service.indexOf('\nexport ', start + 10) + 1 || undefined)
      assert.match(body, /readerNotifications\.readerId/, `${fn} does not bound its update by reader`)
    }
  })

  it('neither endpoint accepts a readerId from the request', () => {
    const list = stripComments(read('server/api/public/reader/notifications.get.ts'))
    const mark = stripComments(read('server/api/public/reader/notifications/read.post.ts'))
    for (const [name, source] of [['notifications.get', list], ['read.post', mark]] as const) {
      assert.match(source, /requireReader\(event\)/, `${name} does not require a reader ticket`)
      /**
       * Looks for a readerId taken from the REQUEST, not for the string itself:
       * `readerId: reader.id` is the correct shape (identity from the ticket,
       * passed to the service) and must not fail this guard. What would fail is
       * reading it off the query or the body.
       */
      assert.ok(
        !/(query|body|payload)\s*[.\[]\s*['"]?readerId/.test(source),
        `${name} reads a readerId from the request`,
      )
    }
  })

  /**
   * Charging allowance before the refusals would let a client with a malformed
   * body burn its own quota on calls that were always going to fail — the same
   * ordering mistake the comment and rename paths document.
   */
  it('the mark-read endpoint spends allowance after its refusals', () => {
    const source = read('server/api/public/reader/notifications/read.post.ts')
    // The CALL, not the import line at the top of the file.
    const limit = source.indexOf('await recordRateLimitHit')
    const refusal = source.indexOf('Không có thông báo nào được chỉ định')
    assert.ok(limit !== -1, 'the mark-read endpoint is no longer rate limited')
    assert.ok(refusal !== -1, 'the empty-request refusal is gone')
    assert.ok(limit > refusal, 'rate limit is charged before the request is validated')
  })
})

describe('notifications never enter server-rendered HTML', () => {
  /**
   * Public article routes are served with `swr: 60`, so anything reader-specific
   * that reached the server render would be handed to the next visitor from
   * cache — a notification list is one person's name, words and reading history.
   *
   * `/profile` DOES appear in routeRules now, as the destination of the 301 from
   * the old `/nguoi-doc`. That is required, not a regression — so this checks the
   * thing that actually matters: that no rule gives `/profile` a cache window.
   */
  it('/profile never gains a cache rule', () => {
    const config = stripComments(read('nuxt.config.ts'))
    const rules = config.slice(config.indexOf('routeRules'), config.indexOf('runtimeConfig'))

    // A key for the route itself — `'/profile': { ... }` — as opposed to the
    // `to: '/profile'` inside the redirect, which is the one legitimate mention.
    assert.ok(
      !/['"]\/profile(\/\*\*)?['"]\s*:/.test(rules),
      '/profile gained its own routeRules entry — an SWR window there would serve one reader\'s data to the next visitor',
    )
    // And the redirect that keeps old shared links alive must still be there.
    assert.match(rules, /['"]\/nguoi-doc['"]\s*:\s*\{\s*redirect/, 'the 301 from /nguoi-doc is gone — every shared link to it now 404s')
  })

  it('the profile page fetches notifications after mount, not via useFetch', () => {
    const page = stripComments(read('app/pages/profile.vue'))
    assert.ok(!/useFetch\(|useAsyncData\(/.test(page), 'the profile page gained an SSR data fetch')
    assert.match(page, /onMounted\(/, 'the profile page no longer loads after mount')
  })

  it('the header bell is wrapped in client-only', () => {
    const layout = read('app/layouts/default.vue')
    const bell = layout.indexOf('fa-bell')
    assert.ok(bell !== -1, 'the header bell is gone')
    // The nearest enclosing <client-only> opens before the bell and closes after.
    const before = layout.slice(0, bell)
    assert.ok(before.lastIndexOf('<client-only>') > before.lastIndexOf('</client-only>'),
      'the notification bell is rendered outside <client-only>')
  })
})

describe('the bell exists on BOTH surfaces', () => {
  const layout = read('app/layouts/default.vue')

  /**
   * Counted by occurrence, not by presence.
   *
   * The desktop block carries `hidden lg:flex`, so a later tidy-up that merged
   * the two surfaces into one would remove the mobile entry and the symptom would
   * appear only on phones — which is exactly what happened once already with the
   * sign-in button. Most citizens read this portal on a phone.
   */
  it('renders a bell on desktop and a notifications entry in the mobile drawer', () => {
    const bells = layout.match(/fa-bell/g) ?? []
    assert.ok(bells.length >= 2, `expected a bell on both surfaces, found ${bells.length}`)
  })

  it('shows the unread badge on both surfaces', () => {
    const badges = layout.match(/unreadCount > 9 \? '9\+' : unreadCount/g) ?? []
    assert.ok(badges.length >= 2, `expected an unread badge on both surfaces, found ${badges.length}`)
  })

  it('the mobile entry links to the notifications block on the profile page', () => {
    assert.match(layout, /\/profile#notifications/, 'the mobile drawer no longer reaches notifications')
  })
})

describe('the old Vietnamese paths keep working', () => {
  /**
   * All three routes were live on production, shared, and indexed — and the
   * chatbot itself cited /tai-lieu-hoi-dap in its answers. Renaming them without
   * these redirects kills every link already in the wild, including ones printed
   * on paper or sitting in somebody's messages. A link has no expiry date; the
   * cost of keeping it alive is three lines of config.
   */
  const REDIRECTS: Array<[string, string]> = [
    ['/nguoi-doc', '/profile'],
    ['/tai-lieu-hoi-dap', '/qa-documents'],
    ['/tro-ly', '/assistant'],
  ]

  const rules = (() => {
    const config = read('nuxt.config.ts')
    return config.slice(config.indexOf('routeRules'), config.indexOf('runtimeConfig'))
  })()

  for (const [from, to] of REDIRECTS) {
    it(`${from} still redirects to ${to}`, () => {
      const pattern = new RegExp(`['"]${from}['"]\\s*:\\s*\\{\\s*redirect:\\s*\\{[^}]*to:\\s*['"]${to}['"]`)
      assert.match(rules, pattern, `${from} no longer redirects — links already shared will 404`)
    })
  }

  /** 301, not 302: a temporary redirect leaves search engines indexing both
   *  addresses instead of moving the ranking across. */
  it('uses permanent redirects', () => {
    const permanent = rules.match(/statusCode:\s*301/g) ?? []
    assert.ok(permanent.length >= REDIRECTS.length, `expected ${REDIRECTS.length} permanent redirects, found ${permanent.length}`)
  })

  it('no Vietnamese page file remains', () => {
    for (const [from] of REDIRECTS) {
      const stale = new URL(`../app/pages${from}.vue`, import.meta.url)
      assert.ok(!existsSync(stale), `${from}.vue still exists — the redirect will never fire, the page wins`)
    }
  })
})

describe('every comment is addressable', () => {
  const component = read('app/components/ArticleComments.vue')

  /**
   * A notification has to have somewhere to land, and a reader has to be able to
   * share one comment. Both the top-level comment and each reply carry an id —
   * a notification about a reply anchors its parent, but the reply's own id is
   * what a "copy link" on that reply produces.
   */
  it('top-level comments and replies both carry an anchor id', () => {
    const anchors = component.match(/:id="`comment-\$\{(comment|reply)\.id\}`"/g) ?? []
    assert.equal(anchors.length, 2, `expected an id on both comments and replies, found ${anchors.length}`)
  })

  it('reads the requested page before the first load', () => {
    const mounted = component.slice(component.indexOf('onMounted(async'))
    const queryRead = mounted.indexOf('route.query.comments')
    const load = mounted.indexOf('loadThread()')
    assert.ok(queryRead !== -1, 'the component ignores the page a notification asked for')
    assert.ok(queryRead < load, 'the page is read after the thread loads — the anchor will not be found')
  })

  /**
   * `Number(hash)` alone yields NaN for junk, which then reaches getElementById
   * as the string "NaN". Same check /qa-documents uses for `#qa-<id>`.
   */
  it('validates the hash as a safe integer', () => {
    assert.match(component, /Number\.isSafeInteger\(raw\)/, 'the anchor id is no longer validated')
  })

  it('respects prefers-reduced-motion when scrolling', () => {
    assert.match(component, /prefers-reduced-motion/, 'the scroll no longer honours reduced motion')
  })

  it('renders bodies as text, never v-html', () => {
    assert.ok(!/v-html/.test(stripComments(component)), 'a comment body is being rendered as HTML')
  })
})
