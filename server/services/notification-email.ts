/**
 * Emailing a reader when somebody answers them.
 *
 * Kept apart from services/notifications.ts on purpose: that module writes rows
 * inside the caller's transaction, and this one talks to a remote SMTP server.
 * Mixing them would put a network round trip inside a database transaction —
 * holding row locks open for however long a mail server takes to answer, which on
 * a slow or unreachable host is a very long time.
 *
 * Follows the mailer's existing "3C" policy exactly (see server/utils/mailer.ts):
 * persist first, send only if SMTP is configured, and NEVER let a mail failure
 * affect the request. A citizen's comment must land whether or not the mail
 * server is reachable — the in-portal notification is the record, the email is a
 * convenience on top of it.
 */

import { eq, sql } from 'drizzle-orm'

import { getDb } from '../utils/db'
import { articleComments, articles, mediaItems, readerAccounts } from '../db/schema'
import { getSmtpConfig, sendMail } from '../utils/mailer'
import { escapeHtml } from '../utils/escape-html'
import { logError } from '../utils/logger'
import { configuredBaseUrl } from '../utils/google-oauth/config'
import { buildExcerpt, notificationTargetPage, notificationUrl, sameItemPredicate } from './notifications'

/** Longer than the dropdown excerpt: an email is read once, away from the portal,
 *  and a two-line teaser makes the reader open the site to find out what was
 *  said. This is the one surface where more of the reply is the kinder choice. */
const EMAIL_EXCERPT_LENGTH = 400

export type ReplyEmailInput = {
  /** The reply that was just written. */
  commentId: number
  /** The comment it answers. */
  parentId: number
  /** Who to tell — resolved by createReplyNotification, so this is already
   *  guaranteed not to be the author of the reply. */
  recipientId: number
}

/**
 * Send "somebody replied to you", if everything needed is in place.
 *
 * Every exit below is a normal outcome, not an error: no SMTP configured, the
 * reader opted out, the account has no address, the article is no longer
 * readable. Returns whether a message was actually handed to the transport, which
 * is what the integration check asserts on.
 *
 * Throws nothing. The single try/catch is deliberate and total — see the module
 * comment. A logged event is the only trace a failure leaves.
 */
export async function sendReplyEmail(input: ReplyEmailInput): Promise<boolean> {
  try {
    // Cheapest gate first: an unconfigured portal skips every query below.
    const smtp = await getSmtpConfig()
    if (!smtp) return false

    const db = getDb()

    const [recipient] = await db
      .select({
        email:              readerAccounts.email,
        emailNotifications: readerAccounts.emailNotifications,
        isBanned:           readerAccounts.isBanned,
      })
      .from(readerAccounts)
      .where(eq(readerAccounts.id, input.recipientId))
      .limit(1)

    if (!recipient?.email) return false
    // Opted out. Checked against the stored row rather than anything passed in,
    // so the decision is read at send time and a preference changed a second ago
    // still counts.
    if (!recipient.emailNotifications) return false
    // A banned reader's comments are removed; mailing them about a thread that no
    // longer contains their question would be both confusing and pointless.
    if (recipient.isBanned) return false

    const [reply] = await db
      .select({
        body:        articleComments.body,
        adminUserId: articleComments.adminUserId,
        articleId:   articleComments.articleId,
        mediaItemId: articleComments.mediaItemId,
        readerName:       readerAccounts.displayName,
        readerCustomName: readerAccounts.customDisplayName,
      })
      .from(articleComments)
      .leftJoin(readerAccounts, eq(articleComments.readerId, readerAccounts.id))
      .where(eq(articleComments.id, input.commentId))
      .limit(1)

    if (!reply) return false

    /**
     * Which item the reply lives on, and whether it can still be opened.
     *
     * NOT `if (reply.articleId === null) return false`. A media comment has
     * `article_id = NULL`, so that guard — which was correct while articles were
     * the only kind — silently returns false for every media reply, and the
     * feature reads as "email notifications just do not work for videos" with
     * nothing logged anywhere. The test is "no item at all", not "no article".
     *
     * `resolveMailTarget` also enforces the three readability conditions the
     * article path always had: a slug to build the path from, a published item,
     * and commenting still enabled. Mailing a link to a thread the reader cannot
     * open is worse than sending nothing.
     */
    const target = await resolveMailTarget(reply)
    if (!target) return false

    // Same ordering loadCommentThread uses, so the page in the link is the page
    // the comment is actually on. Returns null when the parent is gone.
    const olderCount = await countOlderTopLevel(input.parentId)
    if (olderCount === null) return false
    const page = notificationTargetPage(olderCount)

    /**
     * An absolute URL, or no link at all.
     *
     * A relative path in an email is a dead string — there is no page for the
     * mail client to resolve it against. When PUBLIC_BASE_URL is unset the
     * message still goes out, saying what happened, and the reader can reach the
     * portal themselves; inventing a hostname would produce links that 404 for
     * everyone.
     */
    const base = configuredBaseUrl()
    const path = notificationUrl({
      kind:      target.kind,
      slug:      target.slug,
      page,
      commentId: input.parentId,
    })
    const url = base ? `${base}${path}` : ''

    const isAdminReply = reply.adminUserId !== null
    const authorName = isAdminReply
      ? 'Ban quản trị'
      : (reply.readerCustomName || reply.readerName || 'Một người đọc')

    const excerpt = buildExcerpt(reply.body ?? '', EMAIL_EXCERPT_LENGTH)

    const subject = isAdminReply
      ? '[Con Đường Hướng Thiện] Ban quản trị đã trả lời bình luận của bạn'
      : `[Con Đường Hướng Thiện] ${authorName} đã trả lời bình luận của bạn`

    const lines = [
      `${authorName} đã trả lời bình luận của bạn trong ${target.noun} "${target.title}".`,
      '',
      excerpt,
      '',
      url ? `Xem toàn bộ trao đổi: ${url}` : 'Mở cổng thông tin để xem toàn bộ trao đổi.',
      '',
      '— Cổng thông tin Con Đường Hướng Thiện',
      'Bạn nhận được email này vì đã bật thông báo qua email. Có thể tắt tại trang cá nhân.',
    ]

    // Every interpolated value is escaped: an article title, a display name and a
    // comment body are all citizen- or officer-authored text, and the body is
    // stored verbatim precisely because nothing is allowed to interpret it.
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;color:#1E251C;">
        <h2 style="color:#4A6741;font-size:18px;margin:0 0 16px;">Có người trả lời bình luận của bạn</h2>
        <p style="margin:0 0 12px;font-size:14px;color:#4A5545;">
          <strong>${escapeHtml(authorName)}</strong> đã trả lời bình luận của bạn trong ${escapeHtml(target.noun)}
          &ldquo;${escapeHtml(target.title)}&rdquo;.
        </p>
        <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #7CB342;background:#F4F9F0;font-size:14px;color:#2C3529;white-space:pre-wrap;">${escapeHtml(excerpt)}</blockquote>
        ${url
          ? `<p style="margin:0 0 20px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#4A6741;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">Xem toàn bộ trao đổi</a></p>`
          : '<p style="margin:0 0 20px;font-size:14px;color:#4A5545;">Mở cổng thông tin để xem toàn bộ trao đổi.</p>'}
        <hr style="border:none;border-top:1px solid #E2E8DF;margin:20px 0;" />
        <p style="margin:0;font-size:12px;color:#7A8675;">
          Cổng thông tin Con Đường Hướng Thiện.<br />
          Bạn nhận được email này vì đã bật thông báo qua email. Có thể tắt tại trang cá nhân.
        </p>
      </div>`

    await sendMail({ to: recipient.email, subject, text: lines.join('\n'), html, config: smtp })
    return true
  } catch (error) {
    // Total by design. A mail failure has no standing to affect a comment that is
    // already committed, and the in-portal notification already recorded the fact.
    logError({ event: 'reader_notification.email_failed', error })
    return false
  }
}

/**
 * The item a reply lives on, resolved to what the email needs: where to point,
 * what to call it, and what to name it in a sentence.
 *
 * Null means "do not mail about this" — no item at all, the item is gone, it is
 * not published, or its commenting has since been turned off. Every one of those
 * is a normal outcome rather than an error, which is why this returns null and
 * not a thrown failure: the reply is already committed, and the in-portal
 * notification already recorded it.
 *
 * The article branch reads exactly the three columns the old inline check read,
 * so the article path keeps its behaviour. The media branch applies the SAME
 * three conditions to `media_items` — published, commenting enabled, a slug to
 * build the path from — because the reason a link is worth mailing does not
 * depend on which table the item lives in.
 */
async function resolveMailTarget(reply: {
  articleId:   number | null
  mediaItemId: number | null
}): Promise<{ kind: 'article' | 'media', slug: string, title: string, noun: string } | null> {
  const db = getDb()

  if (reply.articleId !== null) {
    const [article] = await db
      .select({
        title:           articles.title,
        slug:            articles.slug,
        status:          articles.status,
        commentsEnabled: articles.commentsEnabled,
      })
      .from(articles)
      .where(eq(articles.id, reply.articleId))
      .limit(1)

    if (!article?.slug || article.status !== 'published' || !article.commentsEnabled) return null

    return { kind: 'article', slug: article.slug, title: article.title ?? '', noun: 'bài viết' }
  }

  if (reply.mediaItemId !== null) {
    const [item] = await db
      .select({
        title:           mediaItems.title,
        slug:            mediaItems.slug,
        // URL công khai của media giờ là `short_id`; `slug` vẫn select để kiểm
        // item còn (non-null) — nhưng đường dẫn trong email đi theo `short_id`.
        shortId:         mediaItems.shortId,
        status:          mediaItems.status,
        commentsEnabled: mediaItems.commentsEnabled,
      })
      .from(mediaItems)
      .where(eq(mediaItems.id, reply.mediaItemId))
      .limit(1)

    if (!item?.shortId || item.status !== 'published' || !item.commentsEnabled) return null

    return { kind: 'media', slug: item.shortId, title: item.title ?? '', noun: 'video' }
  }

  // Neither identifier set. The XOR invariant says this cannot happen, but the
  // shape that would result from assuming it — `articleId as number` — is a query
  // for article 0 that finds nothing and reads as "the article was deleted".
  return null
}

/**
 * Top-level comments on the same item that sort before `parentId`, using the same
 * `(created_at, id)` ordering the thread pages by.
 *
 * "Same item" is the shared `sameItemPredicate()` — the identical SQL the
 * notification list counts with. Two copies would be two chances to scope by the
 * wrong column, and this copy is the one nobody looks at: a wrong page number in
 * an email is only ever discovered by a reader who followed it.
 *
 * Null when the parent row is gone — distinct from 0, which means "it is the
 * first comment". Collapsing the two would send a link to page 1 of a thread the
 * comment is no longer in.
 */
async function countOlderTopLevel(parentId: number): Promise<number | null> {
  const [row] = await getDb()
    .select({
      olderCount: sql<number>`(
        SELECT COUNT(*) FROM \`article_comments\` \`older\`
        WHERE ${sameItemPredicate()}
          AND \`older\`.\`parent_id\` IS NULL
          AND (
            \`older\`.\`created_at\` < \`article_comments\`.\`created_at\`
            OR (\`older\`.\`created_at\` = \`article_comments\`.\`created_at\`
                AND \`older\`.\`id\` < \`article_comments\`.\`id\`)
          )
      )`,
    })
    .from(articleComments)
    .where(eq(articleComments.id, parentId))
    .limit(1)

  return row ? Number(row.olderCount ?? 0) : null
}
