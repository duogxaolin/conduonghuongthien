/**
 * The page number in a notification link is the page the comment is actually on.
 *
 * A notification points at a *reply*, but the public thread paginates over
 * *top-level* comments. `notificationTargetPage` converts a comment's position
 * into a page number, and `loadCommentThread` is what actually serves that page —
 * two pieces of arithmetic in two modules that must agree exactly.
 *
 * Why a real database is the only thing that can check this:
 *
 *   - **The pure unit test cannot.** `notificationTargetPage(44) === 3` pins the
 *     division, not the claim that page 3 of the real thread contains that
 *     comment. The two can disagree the moment either ordering changes.
 *   - **The ordering lives in SQL.** `loadCommentThread` orders by
 *     `(created_at, id)` and the position subquery has to match it, tie-break
 *     included. Two comments written in the same second are ordered by `id`; get
 *     that wrong and readers land one page off, but only sometimes.
 *   - **A source-text test cannot.** It can assert both files mention a page
 *     size; it cannot assert they compute the same answer.
 *
 * What breaks when this drifts is quiet and looks like data loss: a notification
 * about an older question opens page 1, finds nothing, and reads to the citizen
 * as the portal having deleted what they wrote.
 *
 * Gated and self-cleaning, following the *-integration precedent:
 *
 *   NOTIFICATION_PAGE_INTEGRATION=1 NOTIFICATION_PAGE_PORT=33069 \
 *   NOTIFICATION_PAGE_USER=root NOTIFICATION_PAGE_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import mysql from 'mysql2/promise'

const enabled = process.env.NOTIFICATION_PAGE_INTEGRATION === '1'
const host = process.env.NOTIFICATION_PAGE_HOST || '127.0.0.1'
const port = Number(process.env.NOTIFICATION_PAGE_PORT || 3306)
const user = process.env.NOTIFICATION_PAGE_USER || 'root'
const password = process.env.NOTIFICATION_PAGE_PASSWORD || 'rootpassword'
const database = `cdkt_notif_page_${Date.now()}_${process.pid}`

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_notif_page_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

test('a notification link opens the page that holds the comment', {
  skip: !enabled,
  timeout: 180_000,
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

    const { getDb, closeDb } = await import('../server/utils/db')
    const { articles, readerAccounts, articleComments } = await import('../server/db/schema')
    const {
      createReplyNotification, listNotifications, countUnread,
      markRead, markAllRead, COMMENT_THREAD_PER_PAGE,
    } = await import('../server/services/notifications')
    const { loadCommentThread } = await import('../server/services/comments')

    const db = getDb()

    const [article] = await db.insert(articles).values({
      title: 'Bài kiểm thử phân trang', slug: 'bai-kiem-thu-phan-trang', type: 'news',
      status: 'published', commentsEnabled: true, content: 'x',
    })
    const articleId = Number(article.insertId)

    const makeReader = async (sub: string, name: string) => {
      const [row] = await db.insert(readerAccounts).values({
        googleSub: sub, email: `${sub}@example.com`, displayName: name, lastSeenAt: new Date(),
      })
      return Number(row.insertId)
    }
    const alice = await makeReader('np-alice', 'Alice Nguyen')
    const bob = await makeReader('np-bob', 'Bob Tran')

    /**
     * Enough comments to span three pages, plus a deliberate same-second pair.
     *
     * The identical timestamps are the point: `(created_at, id)` has to tie-break
     * on `id` in BOTH the thread query and the position subquery. A mismatch there
     * only shows up when two comments share a second — rare in a test, routine on
     * a busy article.
     */
    const base = new Date('2026-01-01T00:00:00Z')
    const topIds: number[] = []
    for (let i = 0; i < 45; i++) {
      const seconds = i >= 20 && i <= 21 ? 20 : i // indices 20 and 21 collide
      const [row] = await db.insert(articleComments).values({
        articleId, readerId: alice, parentId: null,
        body: `Câu hỏi số ${i + 1}`,
        createdAt: new Date(base.getTime() + seconds * 1000),
      })
      topIds.push(Number(row.insertId))
    }

    /** Reply to one top-level comment and return the URL the notification carries. */
    const notifyFor = async (parentId: number, bodyText: string) => {
      const [reply] = await db.insert(articleComments).values({
        articleId, readerId: bob, parentId,
        body: bodyText, createdAt: new Date(base.getTime() + 900_000),
      })
      const replyId = Number(reply.insertId)
      const recipient = await createReplyNotification({ commentId: replyId, parentId, actorReaderId: bob })
      assert.equal(recipient, alice, 'the parent author was not notified')
      const page = await listNotifications({ readerId: alice, page: 1, perPage: 50 })
      const item = page.items.find(entry => entry.excerpt.includes(bodyText.slice(0, 20)))
      assert.ok(item?.target, `no reachable target for the notification about ${parentId}`)
      return item.target!.url
    }

    /** Pull `?comments=N` out of the URL; absent means page 1. */
    const pageFromUrl = (url: string) => {
      const match = url.match(/[?&]comments=(\d+)/)
      return match ? Number(match[1]) : 1
    }

    /** Pull `#comment-N` out of the URL. */
    const anchorFromUrl = (url: string) => Number(url.match(/#comment-(\d+)/)?.[1] ?? 0)

    // ── The claim: for comments across all three pages, the link lands on them ──
    for (const index of [0, 19, 20, 21, 25, 44]) {
      const parentId = topIds[index]!
      const url = await notifyFor(parentId, `Trả lời cho câu hỏi số ${index + 1} đây nhé`)

      const claimedPage = pageFromUrl(url)
      assert.equal(anchorFromUrl(url), parentId,
        `the link anchors the wrong comment for index ${index}`)

      // The load-bearing assertion: serve that page for real and look for the comment.
      const thread = await loadCommentThread({
        articleId,
        page: claimedPage,
        perPage: COMMENT_THREAD_PER_PAGE,
        viewerReaderId: alice,
      })

      assert.ok(
        thread.comments.some(comment => comment.id === parentId),
        `notification for comment index ${index} claims page ${claimedPage}, but that page holds `
        + `[${thread.comments.map(c => c.id).join(', ')}] — the reader would find nothing`,
      )
    }

    // ── Read state, bounded by reader ──────────────────────────────────────────
    const before = await countUnread(alice)
    assert.equal(before, 6, `expected 6 unread notifications, got ${before}`)

    const listed = await listNotifications({ readerId: alice, page: 1, perPage: 50 })
    await markRead({ readerId: alice, ids: [listed.items[0]!.id] })
    assert.equal(await countUnread(alice), 5, 'markRead did not clear exactly one')

    // Another reader must not be able to mark Alice's rows.
    await markRead({ readerId: bob, ids: listed.items.map(item => item.id) })
    assert.equal(await countUnread(alice), 5, "markRead crossed the reader boundary")

    await markAllRead(alice)
    assert.equal(await countUnread(alice), 0, 'markAllRead left unread rows')

    // ── Deleting the reply removes its notification (FK CASCADE) ───────────────
    const { eq } = await import('drizzle-orm')
    const remaining = await listNotifications({ readerId: alice, page: 1, perPage: 50 })
    const victim = remaining.items[0]!
    const [replyRow] = await db
      .select({ id: articleComments.id })
      .from(articleComments)
      .where(eq(articleComments.body, `Trả lời cho câu hỏi số 1 đây nhé`))
      .limit(1)

    if (replyRow) {
      await db.delete(articleComments).where(eq(articleComments.id, replyRow.id))
      const after = await listNotifications({ readerId: alice, page: 1, perPage: 50 })
      assert.ok(
        after.items.length < remaining.items.length,
        'deleting a reply left its notification behind — the link now points at nothing',
      )
    }
    assert.ok(victim, 'expected at least one notification to inspect')

    await closeDb()
  } finally {
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    const cleanup = await mysql.createConnection({ host, port, user, password })
    await cleanup.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await cleanup.end()
  }
})
